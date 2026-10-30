import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {AtpPhoneInput,AtpHandInput} from '../src/atp/input';
import {atpFineSeek} from '../src/atp/phone-panel';
import type {AtpInputTarget,AtpState,AtpInputSource} from '../src/atp/contracts';
import type {Packet,Quat} from '../src/types';
import {imageHand,metricHand} from './hand-fixtures';
const q=(degrees:number,axis=new Vector3(1,0,0))=>new Quaternion().setFromAxisAngle(axis,degrees*Math.PI/180).toArray() as Quat;
function fixture(tool:'view'|'rotor'='rotor'){
 const state:AtpState={schema:1,chapter:0,guided:true,tool,representation:'mechanism',phase:0,selected:null,view:{q:[0,0,0,1],zoom:1,x:0,y:0},frozen:false};
 let owner:AtpInputSource|null=null,allowed=true,navigation:'orbit'|'pan'|'zoom'='orbit';const events:string[]=[];
 const target:AtpInputTarget={state:()=>state,begin(source){if(!allowed||owner&&owner!==source)return false;owner=source;events.push('begin:'+source);return true;},end(source){if(owner===source){owner=null;events.push('end:'+source);}},view(value){state.view.q=value;events.push('view');},phase(value){state.phase=value;events.push('phase');},status(){},navigation:()=>navigation,zoom(value){state.view.zoom=value;},pan(x,y){state.view.x=x;state.view.y=y;}};
 return {state,target,events,allow(value:boolean){allowed=value;},nav(value:typeof navigation){navigation=value;}};
}
const frame=(degrees=0,hold=true,extra:Partial<Packet>={}):Packet=>({type:'frame',q:q(degrees),hold,active:true,visible:true,screenAngle:0,source:'orientation',...extra});
test('ATP fine completion commits a bounded final seek only on deliberate completion',()=>{
 for(const event of ['pointerup','change','keyup']){
  assert.deepEqual(atpFineSeek({type:'state',workspace:'atp',tool:'rotor'},293,event),{action:'atp-checkpoint',value:293});
  assert.deepEqual(atpFineSeek({type:'state',workspace:'atp',tool:'view'},2.25,event),{action:'atp-set-zoom',value:2.25});
 }
 for(const event of ['pointercancel','blur'])assert.equal(atpFineSeek({type:'state',workspace:'atp',tool:'rotor'},293,event),null);
 assert.equal(atpFineSeek({type:'state',workspace:'shapes',tool:'rotor'},293,'pointerup'),null);
 assert.equal(atpFineSeek({type:'state',workspace:'atp',tool:'rotor'},361,'pointerup'),null);
 assert.equal(atpFineSeek({type:'state',workspace:'atp',tool:'view'},2.6,'change'),null);
});
test('phone requires release, clutches rotor at accepted state, and leaves view alone',()=>{
 const f=fixture(),p=new AtpPhoneInput(f.target);f.state.phase=40;
 p.frame(frame(0),0);p.frame(frame(20),20);assert.equal(f.state.phase,40);assert.equal(p.held,false);
 p.frame(frame(10,false),30);p.frame(frame(10),40);p.frame(frame(35),50);
 assert.equal(Math.round(f.state.phase),90);assert.deepEqual(f.state.view.q,[0,0,0,1]);
 p.frame(frame(35,false),60);assert.equal(p.held,false);p.tick(70);assert.equal(Math.round(f.state.phase),90);
 p.frame(frame(-60),80);assert.equal(Math.round(f.state.phase),90,'repositioned phone captures a new neutral');
 assert.deepEqual(f.events.filter(x=>x.startsWith('begin:')||x.startsWith('end:')),['begin:phone','end:phone','begin:phone']);
});
test('phone view applies relative pose without changing phase and release cancels pending motion',()=>{
 const f=fixture('view'),p=new AtpPhoneInput(f.target);f.state.phase=120;
 p.frame(frame(0,false),0);p.frame(frame(0),10);p.frame(frame(35),20);const view=[...f.state.view.q];
 assert.ok(new Quaternion().fromArray(view).angleTo(new Quaternion())>.5);assert.equal(f.state.phase,120);
 p.release();p.frame(frame(90),30);p.tick(400);assert.deepEqual(f.state.view.q,view);
});
test('phone stale, invalid, source, screen and mode interruptions require a fresh release',()=>{
 for(const interrupt of ['stale','invalid','source','screen','tool','frozen'] as const){
  const f=fixture(),p=new AtpPhoneInput(f.target);p.frame(frame(0,false),0);p.frame(frame(0),1);p.frame(frame(10),2);
  if(interrupt==='stale')p.tick(403);
  if(interrupt==='invalid')p.frame(frame(20,true,{q:[0,0,0,0]}),3);
  if(interrupt==='source')p.frame(frame(20,true,{source:'different'}),3);
  if(interrupt==='screen')p.frame(frame(20,true,{screenAngle:90}),3);
  if(interrupt==='tool'){f.state.tool='view';p.tick(3);f.state.tool='rotor';}
  if(interrupt==='frozen'){f.state.frozen=true;p.tick(3);f.state.frozen=false;}
  assert.equal(p.held,false,interrupt);const phase=f.state.phase;p.frame(frame(50),404);assert.equal(f.state.phase,phase,interrupt+' silently resumed');
 }
});
test('phone signed angle remains continuous through wrap and quaternion sign flips',()=>{
 const f=fixture(),p=new AtpPhoneInput(f.target);p.frame(frame(0,false),0);p.frame(frame(0),1);
 p.frame(frame(170),2);assert.equal(Math.round(f.state.phase),340);
 p.frame(frame(181),3);assert.equal(f.state.phase,360);p.frame(frame(175),4);assert.equal(Math.round(f.state.phase),350);
 const same=q(175).map(n=>-n) as Quat;p.frame(frame(0,true,{q:same}),5);assert.equal(Math.round(f.state.phase),350);
});
test('phone respects input ownership and explicit invert',()=>{
 const f=fixture(),p=new AtpPhoneInput(f.target);f.allow(false);p.frame(frame(0,false),0);p.frame(frame(0),1);p.frame(frame(20),2);assert.equal(f.state.phase,0);assert.equal(p.held,false);
 f.allow(true);f.state.phase=180;p.frame(frame(0,false,{invert:true}),3);p.frame(frame(0,true,{invert:true}),4);p.frame(frame(20,true,{invert:true}),5);assert.equal(Math.round(f.state.phase),140);
});
function grab(h:AtpHandInput){h.update([imageHand(0)],0,[metricHand(0)]);h.update([imageHand(4)],10,[metricHand(4)]);h.update([imageHand(4)],140,[metricHand(4)]);}
const moved=(dy:number,dx=0)=>imageHand(4).map(p=>({...p,x:p.x+dx,y:p.y+dy}));
test('hand retains open-fist-release gate and clamps rotor without changing view',()=>{
 const f=fixture(),h=new AtpHandInput(f.target);h.region='any';h.update([imageHand(4)],-100,[metricHand(4)]);assert.equal(h.held,false);
 grab(h);assert.equal(h.held,true);h.update([moved(-.1)],150,[metricHand(4)]);assert.equal(Math.round(f.state.phase),72);assert.deepEqual(f.state.view.q,[0,0,0,1]);
 h.update([imageHand(0)],160,[metricHand(0)]);assert.equal(h.held,false);const phase=f.state.phase;h.update([moved(-.2)],170,[metricHand(4)]);assert.equal(f.state.phase,phase);
});
test('hand loss, timeout and tool change release ownership; a held fist cannot silently resume',()=>{
 for(const interrupt of ['lost','stale','tool'] as const){const f=fixture(),h=new AtpHandInput(f.target);h.region='any';grab(h);
  if(interrupt==='lost')h.update([],150);
  if(interrupt==='stale')h.tick(391);
  if(interrupt==='tool'){f.state.tool='view';h.tick(150);f.state.tool='rotor';}
  assert.equal(h.held,false);h.update([moved(-.1)],400,[metricHand(4)]);h.update([moved(-.1)],550,[metricHand(4)]);assert.equal(f.state.phase,0);assert.ok(f.events.includes('end:hand'));
 }
});
test('hand view navigation changes orbit/pan/zoom independently from illustrated phase',()=>{
 for(const mode of ['orbit','pan','zoom'] as const){const f=fixture('view'),h=new AtpHandInput(f.target);h.region='any';f.nav(mode);f.state.phase=120;grab(h);h.update([moved(-.1,.05)],150,[metricHand(4)]);
  assert.equal(f.state.phase,120);
  if(mode==='orbit')assert.notDeepEqual(f.state.view.q,[0,0,0,1]);
  if(mode==='pan'){assert.ok(f.state.view.x<0);assert.ok(f.state.view.y>0);}
  if(mode==='zoom')assert.ok(f.state.view.zoom>1);
 }
});
