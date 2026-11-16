import {WebSocketServer} from 'ws';
import {createPartyRoom,normalPartyCode,validPartyCode,partyCode,partySecret} from './party-room.mjs';

const EXPIRY_MS=6*3600000;
export function attachPartyRelay(server,{port}){
 const wss=new WebSocketServer({noServer:true,maxPayload:4*1024}),parties=new Map();
 const origins=[`http://localhost:${port}`,`http://127.0.0.1:${port}`];
 const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const find=code=>{const name=normalPartyCode(code),party=validPartyCode(name)?parties.get(name):null;if(party&&Date.now()>=party.expiresAt){party.room.close(4001,'Party ended');parties.delete(name);return null;}return party??null;};
 function handle(req,res){
  const url=new URL(req.url,`http://localhost:${port}`);
  if(url.pathname!=='/parties'&&!url.pathname.startsWith('/parties/'))return false;
  if(url.pathname==='/parties'&&req.method==='POST'){
   let name;do name=partyCode();while(parties.has(name));
   const party={code:name,token:partySecret(),room:createPartyRoom(),expiresAt:Date.now()+EXPIRY_MS};parties.set(name,party);
   reply(res,200,{code:name,token:party.token,expiresAt:party.expiresAt});return true;
  }
  const match=url.pathname.match(/^\/parties\/([^/]+)\/status$/);
  if(match&&req.method==='GET'){
   const party=find(match[1]);
   if(!party)reply(res,404,{error:'That party is not running. Check the code on the big screen.'});
   else reply(res,200,{...party.room.status,expiresAt:party.expiresAt});
   return true;
  }
  reply(res,404,{error:'Not found.'});return true;
 }
 server.on('upgrade',(req,socket,head)=>{
  const url=new URL(req.url,`http://localhost:${port}`),match=url.pathname.match(/^\/parties\/([^/]+)\/stream$/);
  if(!match)return;
  if(!origins.includes(req.headers.origin)){socket.destroy();return;}
  const role=url.searchParams.get('role'),party=find(match[1]);
  wss.handleUpgrade(req,socket,head,ws=>{
   if(!party||!['host','player'].includes(role)||role==='host'&&url.searchParams.get('token')!==party.token){ws.close(4001,'Invalid connection');return;}
   party.room.connect(ws,{role,name:url.searchParams.get('name'),resume:url.searchParams.get('resume')});
  });
 });
 return {handle,get count(){return parties.size;},close(){for(const p of parties.values())p.room.close();wss.close();}};
}
