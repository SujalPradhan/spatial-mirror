import {createControlRoom} from '../control-room.mjs';

const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const code=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>alphabet[n&31]).join('');
const watchSecret=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>alphabet[n&31]).join('');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const error=(message,status=400)=>json({error:message},status);
const normalCode=value=>String(value).toUpperCase().replace(/[-\s]/g,'');
const validCode=value=>/^[A-HJ-NP-Z2-9]{8}$/.test(value);

export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin');
  if(!env.ALLOWED_ORIGINS.split(',').includes(origin))return error('This origin is not allowed.',403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'3600','Vary':'Origin'}});
  const url=new URL(request.url);
  let response;
  try{
   if(request.method==='POST'&&(url.pathname==='/rooms'||/^\/rooms\/[^/]+\/join$/.test(url.pathname))){
    const ip=request.headers.get('CF-Connecting-IP')||'local';
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip))),n=>n.toString(16).padStart(2,'0')).join('');
    const rate=env.ROOMS.get(env.ROOMS.idFromName('rate:'+digest));
    const gate=await rate.fetch('https://internal/rate',{method:'POST',body:url.pathname==='/rooms'?'create':'join'});
    if(!gate.ok)response=error('Too many attempts. Please wait a minute.',429);
   }
   if(!response&&url.pathname==='/rooms'&&request.method==='POST'){
    for(let attempt=0;attempt<4;attempt++){
     const name=code(),stub=env.ROOMS.get(env.ROOMS.idFromName(name));
     response=await stub.fetch('https://internal/init',{method:'POST',body:JSON.stringify({code:name,host:secret(),phone:secret()})});
     if(response.status!==409)break;
    }
   }else if(!response){
    const match=url.pathname.match(/^\/rooms\/([^/]+)(\/join|\/stream)?$/);
    const name=normalCode(match?.[1]);
    if(!match||!validCode(name))response=error('That code is not valid. Check the code on the laptop.',404);
    else{
     const stub=env.ROOMS.get(env.ROOMS.idFromName(name));
     const path=match[2]||'/status';
     response=await stub.fetch(new Request('https://internal'+path+url.search,request));
    }
   }
  }catch{response=error('The connection service is temporarily unavailable.',503);}
  if(response.status===101)return response;
  const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');
  return new Response(response.body,{status:response.status,headers});
 }
};

export class ControllerRoom {
 constructor(state){
  this.state=state;this.meta=null;
  // Standard WebSockets keep this object's in-memory coordinator alive. On a
  // runtime restart the sockets close; a larger epoch requires a fresh ACK.
  this.room=createControlRoom({initialEpoch:Date.now(),requireFresh:true});
  state.blockConcurrencyWhile(async()=>{this.meta=await state.storage.get('meta')||null;});
 }
 async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/rate'&&request.method==='POST'){
   const kind=await request.text(),windowMs=kind==='create'?3600000:60000,limit=kind==='create'?60:30;
   const key=kind+':'+Math.floor(Date.now()/windowMs);
   const allowed=await this.state.storage.transaction(async tx=>{const n=await tx.get(key)||0;if(n>=limit)return false;await tx.put(key,n+1);return true;});
   await this.state.storage.setAlarm(Date.now()+3700000);
   return json({ok:allowed},allowed?200:429);
  }
  if(url.pathname==='/init'&&request.method==='POST'){
   // blockConcurrencyWhile keeps allocation collision-safe across storage awaits.
   return this.state.blockConcurrencyWhile(async()=>{
    if(this.meta)return error('Code already allocated.',409);
    const input=await request.json(),now=Date.now();
    this.meta={...input,paired:false,joinExpiresAt:now+10*60000,expiresAt:now+24*3600000};
    await this.state.storage.put('meta',this.meta);await this.state.storage.setAlarm(this.meta.expiresAt);
    return json(this.session('desktop'));
   });
  }
  if(!this.meta||this.meta.revoked||Date.now()>=this.meta.expiresAt){
   if(url.pathname==='/stream'&&request.headers.get('Upgrade')==='websocket')return this.closedSocket(4001,'Pairing expired');
   return error('This connection has ended. Create a new code on the laptop.',410);
  }
  if(url.pathname==='/join'&&request.method==='POST'){
   return this.state.blockConcurrencyWhile(async()=>{
    if(this.meta.paired)return error('That code has already been used. Ask the laptop for a new code.',409);
    if(Date.now()>this.meta.joinExpiresAt)return error('That code expired. Ask the laptop for a new code.',410);
    this.meta.paired=true;await this.state.storage.put('meta',this.meta);
    return json(this.session('phone'));
   });
  }
  if(url.pathname==='/status'){
   const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
   if(token!==this.meta.host&&token!==this.meta.phone)return error('Invalid connection.',403);
   if(request.method==='DELETE'){
    if(token!==this.meta.host)return error('Only the laptop can end this connection.',403);
    this.meta.revoked=true;await this.state.storage.put('meta',this.meta);this.room.close(4001,'Connection ended');await this.state.storage.setAlarm(Date.now()+60000);
    return json({ok:true});
   }
   if(request.method==='GET')return json({paired:this.meta.paired,expiresAt:this.meta.expiresAt});
  }
  if(url.pathname==='/stream'&&request.headers.get('Upgrade')==='websocket'){
   const role=url.searchParams.get('role'),token=url.searchParams.get('token');
   if(role==='viewer'){
    if(!this.meta.watch||token!==this.meta.watch)return this.closedSocket(4001,'Invalid connection');
   }else if(!['desktop','phone','presenter'].includes(role)||token!==this.meta[role==='phone'?'phone':'host']||role==='phone'&&!this.meta.paired)return this.closedSocket(4001,'Invalid connection');
   if(role==='presenter'&&!this.meta.watch){this.meta.watch=watchSecret();await this.state.storage.put('meta',this.meta);}
   if(this.meta.watch)this.room.watchCode=this.meta.code+this.meta.watch;
   const [client,server]=Object.values(new WebSocketPair());server.accept();this.room.connect(server,role);
   return new Response(null,{status:101,webSocket:client});
  }
  return error('Not found.',404);
 }
 session(role){return {code:this.meta.code,token:this.meta[role==='desktop'?'host':'phone'],role,paired:this.meta.paired,joinExpiresAt:this.meta.joinExpiresAt,expiresAt:this.meta.expiresAt};}
 closedSocket(code,reason){const [client,server]=Object.values(new WebSocketPair());server.accept();server.close(code,reason);return new Response(null,{status:101,webSocket:client});}
 async alarm(){this.room.close(4001,'Connection expired');await this.state.storage.deleteAll();this.meta=null;}
}
