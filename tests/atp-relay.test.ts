import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Shared relay implementation is plain JavaScript for Node/Workers.
import {createControlRoom,freshInput} from '../control-room.mjs';
class Peer {
 readyState=1;bufferedAmount=0;messages:any[]=[];private seq=0;private handlers=new Map<string,Function[]>();
 send(raw:string){this.messages.push(JSON.parse(raw));}
 addEventListener(type:string,handler:Function){this.handlers.set(type,[...this.handlers.get(type)??[],handler]);}
 close(){this.readyState=3;for(const handler of this.handlers.get('close')??[])handler({});}
 receive(p:Record<string,unknown>){for(const handler of this.handlers.get('message')??[])handler({data:JSON.stringify({v:2,seq:this.seq++,...p})});}
}
const descriptor=()=>({enabled:true,frozen:false,context:0,chapter:0,guided:true,tool:'view',representation:'structure',phase:0,selected:null,zoom:1,playing:false});
function fixture(state=descriptor(),requireFresh=false){
 const room=createControlRoom({requireFresh}),desktop=new Peer(),phone=new Peer();room.connect(desktop,'desktop');room.connect(phone,'phone');
 desktop.receive({type:'activate',workspace:'atp',documentId:'atp',focused:true,visible:true,state});
 return {room,desktop,phone,ack(){phone.receive({type:'ack',epoch:room.status.epoch,context:state.context,documentId:'atp'});},action(action:string,value?:number,extra={}){phone.receive({type:'action',epoch:room.status.epoch,context:state.context,action,...value===undefined?{}:{value},...extra});}};
}
test('ATP accepts bounded descriptors; rejects malformed lesson state without taking ownership',()=>{
 const f=fixture();assert.equal(f.room.status.workspace,'atp');assert.ok(f.phone.messages.some(p=>p.type==='state'&&p.workspace==='atp'));
 for(const invalid of [{chapter:6},{chapter:1.5},{phase:-1},{phase:361},{tool:'draw'},{representation:'simulation'},{selected:'atom'},{guided:0},{zoom:3},{playing:1}]){
  const bad=fixture({...descriptor(),...invalid} as any);assert.equal(bad.room.status.workspace,null,JSON.stringify(invalid));
 }
});
test('ATP action delivery requires acknowledgement, current epoch and context',()=>{
 const f=fixture();f.action('atp-next');assert.equal(f.desktop.messages.filter(p=>p.type==='action').length,0);f.ack();
 f.action('atp-next',undefined,{epoch:f.room.status.epoch-1});f.action('atp-next',undefined,{context:1});f.action('atp-next');
 assert.deepEqual(f.desktop.messages.filter(p=>p.type==='action').map(p=>p.action),['atp-next']);
 f.desktop.receive({type:'state',epoch:f.room.status.epoch,state:{...descriptor(),context:1}});f.action('atp-play',undefined,{context:1});assert.equal(f.desktop.messages.filter(p=>p.type==='action').length,1,'new scope requires a fresh ack');
});
test('ATP scalar/actions have bounds and cannot leak into another workspace',()=>{
 const f=fixture();f.ack();for(const [action,value] of [['atp-phase',-1],['atp-phase',361],['atp-phase',NaN],['atp-zoom',.1],['atp-zoom',2.6],['atp-set-zoom',.1],['atp-set-zoom',2.6],['atp-checkpoint',400],['atp-unknown',undefined],['atp-play',1]] as const)f.action(action,value);
 assert.equal(f.desktop.messages.filter(p=>p.type==='action').length,0);
 for(const [action,value] of [['atp-phase',360],['atp-zoom',.65],['atp-checkpoint',120],['atp-set-zoom',2.25],['atp-play',undefined]] as const)f.action(action,value);
 assert.equal(f.desktop.messages.filter(p=>p.type==='action').length,5);
 f.desktop.receive({type:'activate',workspace:'shapes',documentId:'shapes',focused:true,visible:true,state:{enabled:true,frozen:false,context:1,solid:'cone',depth:0}});
 f.phone.receive({type:'ack',epoch:f.room.status.epoch,context:1,documentId:'shapes'});f.action('atp-play',undefined,{context:1});f.action('atp-set-zoom',2,{context:1});assert.equal(f.desktop.messages.filter(p=>p.type==='action').length,5);
});
test('ATP discrete buttons allow roundtrip latency; continuous motion/zoom keep short deadline',()=>{
 for(const action of ['atp-next','atp-view','atp-play','atp-recenter','atp-checkpoint','atp-set-zoom','atp-select-rotor']){
  assert.ok(freshInput({type:'action',action,at:1000},1650));assert.equal(freshInput({type:'action',action,at:1000},2501),null);
 }
 for(const action of ['atp-phase','atp-zoom'])assert.equal(freshInput({type:'action',action,at:1000},1301),null);
 assert.equal(freshInput({type:'frame',hold:true,at:1000},1301),null);
 const release=freshInput({type:'frame',hold:false,active:true,visible:true,q:[0,0,0,1],at:1000},3000);assert.equal(release.active,false);assert.equal(release.q,null);
});
test('a delayed final seek survives dropped live updates while retaining the context fence',()=>{
 const f=fixture(descriptor(),true);f.ack();const at=Date.now();
 f.action('atp-phase',29,{at});f.action('atp-phase',293,{at:at-650});f.action('atp-checkpoint',293,{at:at-650});f.action('atp-set-zoom',2.25,{at:at-650});
 assert.deepEqual(f.desktop.messages.filter(p=>p.type==='action').map(p=>[p.action,p.value]),[['atp-phase',29],['atp-checkpoint',293],['atp-set-zoom',2.25]]);
 f.desktop.receive({type:'state',epoch:f.room.status.epoch,state:{...descriptor(),context:1}});
 f.action('atp-checkpoint',120,{at});f.action('atp-set-zoom',1,{at});
 assert.equal(f.desktop.messages.filter(p=>p.type==='action').length,3,'a delayed completion cannot edit a changed tool/chapter scope');
});
