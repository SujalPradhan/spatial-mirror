import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore The deployed Worker is intentionally plain JavaScript.
import worker,{PartyRoom} from '../relay/worker.mjs';

const ORIGIN='https://spatial-mirror.pages.dev';
class Sock {
 readyState=1;bufferedAmount=0;messages:any[]=[];closed:[number,string]|null=null;private handlers=new Map<string,Function[]>();
 accept(){}
 send(raw:string){this.messages.push(JSON.parse(raw));}
 addEventListener(type:string,handler:Function){this.handlers.set(type,[...this.handlers.get(type)??[],handler]);}
 close(code=1000,reason=''){if(this.readyState===3)return;this.readyState=3;this.closed=[code,reason];for(const h of this.handlers.get('close')??[])h({});}
 say(p:Record<string,unknown>){for(const h of this.handlers.get('message')??[])h({data:JSON.stringify({v:1,...p})});}
}
const NativeResponse=Response;
const pairs:{client:Sock;server:Sock}[]=[];
function install(){
 // Node cannot build a 101 Response; stand in for the Workers runtime just enough to read it back.
 (globalThis as any).Response=class extends NativeResponse{
  fake:number|undefined;ws:unknown;
  constructor(body:BodyInit|null,init:ResponseInit&{webSocket?:unknown}={}){super(body,{...init,status:init.status===101?200:init.status});this.fake=init.status;this.ws=init.webSocket;}
  get status(){return this.fake??super.status;}
 };
 (globalThis as any).WebSocketPair=class{0:Sock;1:Sock;constructor(){const pair={client:new Sock(),server:new Sock()};pairs.push(pair);this[0]=pair.client;this[1]=pair.server;}};
}
function restore(){(globalThis as any).Response=NativeResponse;delete (globalThis as any).WebSocketPair;}

function world(){
 const rooms=new Map<string,{fetch(r:Request|string,init?:RequestInit):Promise<Response>}>();const writes:string[]=[];
 const make=(id:string)=>{
  const values=new Map<string,unknown>();
  const storage={get:async(k:string)=>values.get(k),put:async(k:string,v:unknown)=>{writes.push(id+':'+k);values.set(k,v);},deleteAll:async()=>values.clear(),setAlarm:async()=>{},transaction:async(fn:(s:any)=>Promise<unknown>)=>fn(storage)};
  let ready:Promise<unknown>=Promise.resolve();
  const state={storage,blockConcurrencyWhile(fn:()=>Promise<unknown>){return ready=ready.then(fn);}};
  const room=new PartyRoom(state);return {fetch:async(r:Request|string,init?:RequestInit)=>{await ready;return room.fetch(typeof r==='string'?new Request(r,init):r);}};
 };
 const env={ALLOWED_ORIGINS:ORIGIN+',http://localhost:4174',PARTIES:{idFromName:(n:string)=>n,get:(id:string)=>{if(!rooms.has(id))rooms.set(id,make(id));return rooms.get(id)!;}},ROOMS:{}};
 return {env,writes};
}
const call=(env:any,path:string,init:RequestInit&{headers?:Record<string,string>}={})=>worker.fetch(new Request('https://relay.test'+path,{...init,headers:{Origin:ORIGIN,...init.headers}}),env);

test('create, status and an unknown code that writes nothing',async()=>{
 const {env,writes}=world();
 const made=await call(env,'/parties',{method:'POST'});assert.equal(made.status,200);
 const party=await made.json();assert.match(party.code,/^[A-HJ-NP-Z2-9]{5}$/);assert.match(party.token,/^[0-9a-f]{48}$/);
 assert.equal(made.headers.get('Access-Control-Allow-Origin'),ORIGIN);
 const status=await call(env,`/parties/${party.code.toLowerCase()}/status`);assert.equal(status.status,200);
 assert.deepEqual(await status.json().then((s:any)=>({players:s.players,host:s.host})),{players:0,host:false});
 const before=writes.length;
 assert.equal((await call(env,'/parties/ZZZZZ/status')).status,404);
 assert.equal((await call(env,'/parties/not-a-code/status')).status,404);
 assert.equal((await call(env,'/parties',{method:'GET'})).status,404);
 assert.equal(writes.length,before,'unknown codes write no storage');
});
test('origins: a foreign or missing origin is refused before any party work',async()=>{
 const {env,writes}=world();
 for(const origin of ['https://evil.example','null',undefined]){
  const res=await worker.fetch(new Request('https://relay.test/parties',{method:'POST',headers:origin?{Origin:origin}:{}}),env);
  assert.equal(res.status,403);
 }
 assert.equal(writes.length,0);
 assert.equal((await call(env,'/parties',{method:'OPTIONS'})).status,204);
});
test('creating parties is rate limited; joining has its own, larger bucket',async()=>{
 const {env}=world();let last=0;
 for(let i=0;i<61;i++)last=(await call(env,'/parties',{method:'POST',headers:{'CF-Connecting-IP':'1.2.3.4'}})).status;
 assert.equal(last,429);
 assert.equal((await call(env,'/parties',{method:'POST',headers:{'CF-Connecting-IP':'9.9.9.9'}})).status,200,'another address is not limited');
 install();try{
  const code=(await (await call(env,'/parties',{method:'POST',headers:{'CF-Connecting-IP':'5.5.5.5'}})).json()).code;
  const join=()=>call(env,`/parties/${code}/stream?role=player`,{headers:{Upgrade:'websocket','CF-Connecting-IP':'6.6.6.6'}});
  let ok=0;for(let i=0;i<150;i++)if((await join()).status===101)ok++;
  assert.equal(ok,150,'a whole class on one address can join');
  let cut=0;for(let i=0;i<1200&&!cut;i++)if((await join()).status===429)cut=i;
  assert.ok(cut>0,'the join bucket still has a ceiling');
 }finally{restore();}
});
test('streams: the host needs its token, players need nothing, and messages flow',async()=>{
 const {env}=world();install();try{
  const party=await (await call(env,'/parties',{method:'POST'})).json();
  const up={Upgrade:'websocket'};
  assert.equal((await call(env,`/parties/${party.code}/stream?role=host&token=wrong`,{headers:up})).status,101);
  assert.deepEqual(pairs.at(-1)!.server.closed,[4001,'Invalid connection']);
  await call(env,`/parties/${party.code}/stream?role=bogus`,{headers:up});assert.equal(pairs.at(-1)!.server.closed![0],4001);
  assert.equal((await call(env,`/parties/${party.code}/stream?role=host&token=${party.token}`)).status,426,'plain HTTP is not a stream');
  await call(env,`/parties/${party.code}/stream?role=host&token=${party.token}`,{headers:up});const host=pairs.at(-1)!.server;
  await call(env,`/parties/${party.code}/stream?role=player&name=${encodeURIComponent('<b>Zed</b>')}`,{headers:up});const player=pairs.at(-1)!.server;
  assert.equal(player.closed,null);const welcome=player.messages.find(m=>m.type==='welcome');assert.equal(welcome.name,'bZed/b');assert.equal(welcome.host,true);
  player.say({type:'throw'});assert.equal(host.messages.filter(m=>m.type==='throw')[0].from,welcome.id);
  host.say({type:'catch',to:welcome.id,n:1});assert.equal(player.messages.filter(m=>m.type==='catch').length,1);
  const status=await (await call(env,`/parties/${party.code}/status`)).json();assert.equal(status.players,1);assert.equal(status.host,true);
 }finally{restore();}
});
test('hand messages reach only the host through the Worker, cleaned and throttled, with no storage writes',async()=>{
 const {env,writes}=world();install();try{
  const party=await (await call(env,'/parties',{method:'POST'})).json(),up={Upgrade:'websocket'};
  await call(env,`/parties/${party.code}/stream?role=host&token=${party.token}`,{headers:up});const host=pairs.at(-1)!.server;
  await call(env,`/parties/${party.code}/stream?role=player`,{headers:up});const a=pairs.at(-1)!.server;
  await call(env,`/parties/${party.code}/stream?role=player`,{headers:up});const b=pairs.at(-1)!.server;
  const before=writes.length,id=a.messages.find(m=>m.type==='welcome').id;
  a.say({type:'hand',x:.25,y:.75,pose:'pinch',c:.9,from:'spoof',landmarks:[[0,0,0]]});
  a.say({type:'hand',x:.3,y:.75,pose:'pinch',c:.9});
  a.say({type:'hand',x:2,y:.75,pose:'open'});
  b.say({type:'hand',x:.5,y:.5,pose:'fist'});
  const hands=host.messages.filter(m=>m.type==='hand');
  assert.deepEqual(hands.map(m=>[m.from===id,m.pose,m.x]),[[true,'pinch',.25],[false,'fist',.5]],'the second message inside 66 ms is throttled, the bad one dropped');
  assert.ok(!('landmarks' in hands[0]));
  assert.equal(a.messages.filter(m=>m.type==='hand').length+b.messages.filter(m=>m.type==='hand').length,0);
  assert.equal(writes.length,before,'hand traffic never touches storage');
 }finally{restore();}
});
