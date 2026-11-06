import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Shared relay implementation is plain JavaScript for Node/Workers.
import {createControlRoom} from '../control-room.mjs';
class Peer {
 readyState=1;bufferedAmount=0;messages:any[]=[];closed:number|null=null;private seq=0;private handlers=new Map<string,Function[]>();
 send(raw:string){this.messages.push(JSON.parse(raw));}
 addEventListener(type:string,handler:Function){this.handlers.set(type,[...this.handlers.get(type)??[],handler]);}
 close(code?:number){this.closed??=code??1000;this.readyState=3;for(const handler of this.handlers.get('close')??[])handler({});}
 receive(p:Record<string,unknown>){for(const handler of this.handlers.get('message')??[])handler({data:JSON.stringify({v:2,seq:this.seq++,...p})});}
 of(type:string){return this.messages.filter(m=>m.type===type);}
}
const descriptor=()=>({enabled:true,frozen:false,context:0,chapter:0,guided:true,tool:'view',representation:'structure',phase:0,selected:null,zoom:1,playing:false});
const state=(phase=0)=>({tool:'view',phase,frozen:false,view:{q:[0,0,0,1],zoom:1,x:0,y:0}});
const hand=(id=1)=>({id,side:'right',pose:'open',l:Array(63).fill(500),o:null,v:[0,0],a:3});
function watchRoom(maxViewers?:number){
 const room=createControlRoom(maxViewers?{maxViewers}:{}),presenter=new Peer();room.connect(presenter,'presenter');
 const viewer=()=>{const v=new Peer();const ok=room.connect(v,'viewer');return {v,ok};};
 return {room,presenter,viewer};
}
let clock=1000;
const realNow=Date.now;
test.beforeEach(()=>{clock=1000;Date.now=()=>clock;});
test.afterEach(()=>{Date.now=realNow;});

test('broadcasts fan out to every viewer and only to viewers',()=>{
 const {presenter,viewer}=watchRoom(),a=viewer().v,b=viewer().v;
 const desktop=new Peer(),phone=new Peer();
 presenter.receive({type:'broadcast',full:true,state:state(10),eng:[10,0,0],hands:[hand()],on:false,keep:false});
 for(const v of [a,b]){const m=v.of('watch').at(-1);assert.equal(m.state.phase,10);assert.equal(m.hands.length,1);assert.equal(m.full,true);}
 assert.equal(desktop.messages.length+phone.messages.length,0);
});
test('presenter is told how many are watching, and viewers when the presenter leaves',()=>{
 const {presenter,viewer}=watchRoom(),a=viewer().v;viewer();
 assert.equal(presenter.of('viewers').at(-1).count,2);
 a.close();assert.equal(presenter.of('viewers').at(-1).count,1);
 const {v}=viewer();assert.equal(v.of('watch-presence').at(-1).online,true);
 presenter.close();assert.equal(v.of('watch-presence').at(-1).online,false);
});
test('late joiners receive the merged latest snapshot including ink and the latest hands',()=>{
 const {presenter,viewer}=watchRoom();
 presenter.receive({type:'broadcast',full:true,state:state(5),eng:[5,0,0],hands:[],on:true,keep:false,ink:{add:[{id:1,c:'#f00',w:.008,from:0,p:[100,100,200,200],d:0}]}});
 clock+=100;presenter.receive({type:'broadcast',state:state(80),hands:[hand()],ink:{add:[{id:1,c:'#f00',w:.008,from:2,p:[300,300],d:1},{id:2,c:'#0f0',w:.008,from:0,p:[1,1],d:0}]}});
 clock+=100;presenter.receive({type:'broadcast',ink:{rm:[2]}});
 const {v}=viewer(),snap=v.of('watch')[0];
 assert.equal(snap.full,true);assert.equal(snap.state.phase,80);assert.equal(snap.hands.length,1);assert.equal(snap.on,true);
 assert.deepEqual(snap.ink.add.map((s:any)=>[s.id,s.p.length,s.d]),[[1,6,1]]);
});
test('a new presenter replaces the old one and starts from a clean snapshot',()=>{
 const {room,presenter,viewer}=watchRoom();presenter.receive({type:'broadcast',full:true,state:state(5)});
 const next=new Peer();room.connect(next,'presenter');assert.equal(presenter.closed,4010);
 const {v}=viewer();assert.equal(v.of('watch')[0].state,null);
 presenter.receive({type:'broadcast',state:state(9)});assert.equal(v.of('watch').length,1,'the old socket no longer broadcasts');
});
test('viewer cap rejects the next viewer and frees up when one leaves',()=>{
 const {viewer}=watchRoom(3),vs=[viewer(),viewer(),viewer()];assert.ok(vs.every(x=>x.ok));
 const extra=viewer();assert.equal(extra.ok,false);assert.equal(extra.v.closed,4008);
 vs[0].v.close();assert.equal(viewer().ok,true);
});
test('the default cap is 20 viewers',()=>{
 const {viewer}=watchRoom();for(let i=0;i<20;i++)assert.ok(viewer().ok);assert.equal(viewer().ok,false);
});
test('viewers can only ping: commands, broadcasts and shares are ignored',()=>{
 const {room,presenter,viewer}=watchRoom(),desktop=new Peer(),phone=new Peer();room.connect(desktop,'desktop');room.connect(phone,'phone');
 desktop.receive({type:'activate',workspace:'atp',documentId:'atp',focused:true,visible:true,state:descriptor()});
 const {v}=viewer();phone.messages.length=0;desktop.messages.length=0;presenter.messages.length=0;const before=v.messages.length;
 for(const p of [{type:'broadcast',full:true,state:state(99)},{type:'activate',workspace:'atp',documentId:'x',focused:true,visible:true,state:descriptor()},{type:'action',action:'atp-play',epoch:room.status.epoch,context:0},{type:'ack',epoch:room.status.epoch,context:0,documentId:'atp'},{type:'frame',hold:false},{type:'share'},{type:'release',epoch:room.status.epoch},{type:'state',epoch:room.status.epoch,state:descriptor()}])v.receive(p);
 assert.equal(v.messages.length,before,'nothing comes back');assert.equal(desktop.messages.length+phone.messages.length+presenter.messages.length,0);
 assert.equal(room.status.workspace,'atp');
 v.receive({type:'ping',t:5});assert.equal(v.of('pong').at(-1).t,5);
 const w=viewer().v;assert.equal(w.of('watch')[0].state,null,'the room state never changed');
});
test('a non-presenter desktop cannot broadcast',()=>{
 const {room,viewer}=watchRoom(),desktop=new Peer();room.connect(desktop,'desktop');const {v}=viewer();const n=v.messages.length;
 desktop.receive({type:'broadcast',full:true,state:state(1)});assert.equal(v.messages.length,n);
});
test('malformed broadcasts are dropped, oversize messages close the socket, broadcasts above 15 Hz are thinned',()=>{
 const {presenter,viewer}=watchRoom(),{v}=viewer();const n=()=>v.of('watch').length,base=n();
 presenter.receive({type:'broadcast',full:true,state:state(1)});assert.equal(n(),base+1);
 clock+=100;for(const bad of [{hands:[{id:1}]},{hands:[hand(),hand(),hand()]},{eng:'x'},{state:'x'},{ink:{add:[{id:1,c:'x',w:1,from:0,p:[1],d:0}]}},{ev:'x'}])presenter.receive({type:'broadcast',...bad});
 assert.equal(n(),base+1);
 clock+=100;presenter.receive({type:'broadcast',state:state(2)});clock+=1;presenter.receive({type:'broadcast',state:state(3)});
 assert.equal(n(),base+2,'a second delta within 40 ms is dropped');
 const big=new Peer();const w=createControlRoom();w.connect(big,'presenter');big.receive({type:'broadcast',state:{pad:'x'.repeat(130*1024)}});assert.equal(big.closed,1009);
});
test('a viewer behind on its socket is resynced with a snapshot instead of a gap',()=>{
 const {presenter,viewer}=watchRoom(),{v}=viewer();presenter.receive({type:'broadcast',full:true,state:state(1),ink:{add:[{id:1,c:'#f00',w:.01,from:0,p:[1,1],d:0}]}});
 v.bufferedAmount=300*1024;clock+=100;presenter.receive({type:'broadcast',state:state(2),ink:{add:[{id:1,c:'#f00',w:.01,from:1,p:[2,2],d:0}]}});
 const n=v.messages.length;v.bufferedAmount=0;clock+=100;presenter.receive({type:'broadcast',state:state(3)});
 const m=v.messages[n];assert.equal(m.full,true);assert.equal(m.state.phase,3);assert.deepEqual(m.ink.add[0].p,[1,1,2,2]);
});
test('share returns the room watch code to the presenter',()=>{
 const room=createControlRoom();room.watchCode='CODE';const p=new Peer();room.connect(p,'presenter');p.receive({type:'share'});assert.equal(p.of('watch-code')[0].code,'CODE');
});
test('phone path is unchanged: viewers and presenters never appear in status, clients or phone messages',()=>{
 const room=createControlRoom(),desktop=new Peer(),phone=new Peer();room.connect(desktop,'desktop');room.connect(phone,'phone');
 desktop.receive({type:'activate',workspace:'atp',documentId:'atp',focused:true,visible:true,state:descriptor()});
 const snapshot=()=>JSON.stringify([phone.messages,desktop.messages,room.status]);
 const before=snapshot();
 const p=new Peer(),v=new Peer();room.connect(p,'presenter');room.connect(v,'viewer');p.receive({type:'broadcast',full:true,state:state(1)});v.close();p.close();
 assert.equal(snapshot(),before);assert.equal(room.status.clients,2);
 const second=new Peer();room.connect(second,'phone');assert.equal(second.closed,4009,'a second phone is still refused');
});
test('closing the room closes viewers and the presenter too',()=>{
 const {room,presenter,viewer}=watchRoom(),{v}=viewer();room.close(4001,'gone');assert.equal(v.closed,4001);assert.equal(presenter.closed,4001);
});
test('page parts merge per key into the snapshot and oversize or malformed parts are dropped',()=>{
 const {presenter,viewer}=watchRoom();
 presenter.receive({type:'broadcast',full:true,state:state(1),page:{a:{n:1},b:{n:2}}});
 clock+=100;presenter.receive({type:'broadcast',page:{a:{n:3}}});
 clock+=100;presenter.receive({type:'broadcast',page:{big:{pad:'x'.repeat(11000)}}});
 clock+=100;presenter.receive({type:'broadcast',page:Array(3)});
 clock+=100;presenter.receive({type:'broadcast',page:Object.fromEntries(Array.from({length:7},(_,i)=>['k'+i,1]))});
 const {v}=viewer();assert.deepEqual(v.of('watch')[0].page,{a:{n:3},b:{n:2}});
});
