import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {AtpEngine} from '../src/atp/engine';
import {atpSkins,type AtpViewState,type AtpWorld,type GestureEvent,type GestureFrame,type HandPose,type MirrorPoint,type TrackedHand} from '../src/atp/contracts';
import type {Quat} from '../src/types';

const DT=1/60;
const count=(sounds:{type:string}[],type:string)=>sounds.filter(s=>s.type===type).length;
const axisQ=(degrees:number,axis=new Vector3(0,1,0))=>new Quaternion().setFromAxisAngle(axis,degrees*Math.PI/180).toArray() as Quat;
const turned=(a:Quat,b:Quat)=>new Quaternion().fromArray(a).angleTo(new Quaternion().fromArray(b))*180/Math.PI;
function world(chain:(p:{x:number;y:number})=>number=()=>2){
 const w:AtpWorld&{picks:number}={picks:0,chainCount:22,mirrorToWorld:(p:MirrorPoint)=>({x:(p.x-.5)*10,y:(.5-p.y)*10,z:0}),chainAt(p){w.picks++;return chain(p);},
  chainInfo:i=>({id:'F',name:i===2?'ATP synthase subunit beta':'ATP synthase subunit c',component:'head',residues:458}),headPoint:()=>({x:0,y:2,z:0})};
 return w;
}
function hand(id:number,pose:HandPose,x=.3,y=.5,orientation:Quat|null=null,poseAge=5):TrackedHand{
 const p={x,y,z:0};
 return {id,side:'right',pose,landmarks:Array.from({length:21},()=>p),palm:p,indexTip:p,pinch:p,orientation,velocity:{x:0,y:0},poseAge};
}
function rig(chain?:(p:{x:number;y:number})=>number){
 const w=world(chain),engine=new AtpEngine(w),view:AtpViewState={q:[0,0,0,1],zoom:1,x:0,y:0};let at=1;
 const run=(hands:TrackedHand[],events:GestureEvent[]=[],frozen=false,dt=DT)=>{
  const frame:GestureFrame={at:at++,hands,events},out=engine.step(frame,dt,view,frozen);
  if(out.view)Object.assign(view,out.view);return out;
 };
 const idle=(seconds:number,hands:TrackedHand[]=[],frozen=false)=>{const frame:GestureFrame={at:at++,hands,events:[]};let out=engine.step(frame,DT,view,frozen);for(let t=DT;t<seconds;t+=DT)out=engine.step(frame,DT,view,frozen);return out;};
 return {w,engine,view,run,idle};
}
const turn=(r:ReturnType<typeof rig>,from:number,to:number)=>{
 const sign=Math.sign(to-from);let out=r.run([]);
 for(let a=from;a!==to;){a+=sign*Math.min(30,Math.abs(to-a));r.engine.setRotorDegrees(a);out=r.run([],[],false,0);}
 return out;
};

test('labels map the structure names',()=>{
 const r=rig(),out=(r.run([hand(1,'pinch')]),r.run([hand(1,'pinch')]));
 assert.equal(out.scene.label?.title,'β subunit');
 assert.equal(out.scene.label?.detail,'Chain F · 458 residues · catalytic head');
});
test('a fist holds the molecule with no jump at grab, 1:1 after',()=>{
 const r=rig();r.view.q=axisQ(40);r.view.x=1;r.view.y=-.5;
 const grab=axisQ(70,new Vector3(1,0,0)),out=r.run([hand(1,'fist',.3,.5,grab)]);
 assert.equal(out.holding,true);assert.ok(turned(r.view.q,axisQ(40))<.01);assert.equal(r.view.x,1);
 const moved=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.5).multiply(new Quaternion().fromArray(grab)).toArray() as Quat;
 r.run([hand(1,'fist',.4,.4,moved)]);
 assert.ok(Math.abs(turned(r.view.q,axisQ(40))-.5*180/Math.PI)<.01);
 assert.ok(Math.abs(r.view.x-2)<1e-9);assert.ok(Math.abs(r.view.y-.5)<1e-9);
 assert.equal(r.run([]).holding,false);
});
test('a fist without orientation orbits, and gaining orientation does not jump',()=>{
 const r=rig();r.run([hand(1,'fist',.3,.5)]);r.run([hand(1,'fist',.4,.5)]);
 const q=[...r.view.q] as Quat;assert.ok(turned(q,[0,0,0,1])>10);
 r.run([hand(1,'fist',.4,.5,axisQ(90))]);assert.ok(turned(r.view.q,q)<.01);
});
test('two fists take over from one and hand back with no jump',()=>{
 const r=rig();r.run([hand(1,'fist',.3,.5,axisQ(0))]);r.run([hand(1,'fist',.35,.5,axisQ(20))]);
 const q=[...r.view.q] as Quat,x=r.view.x;
 r.run([hand(1,'fist',.35,.5,axisQ(20)),hand(2,'fist',.65,.5)]);
 assert.ok(turned(r.view.q,q)<.01);assert.ok(Math.abs(r.view.x-x)<1e-9);assert.equal(r.view.zoom,1);
 r.run([hand(1,'fist',.2,.5),hand(2,'fist',.8,.5)]);assert.ok(Math.abs(r.view.zoom-2)<1e-9);
 r.run([hand(1,'fist',.2,.7),hand(2,'fist',.8,.3)]);
 assert.ok(turned(r.view.q,q)>30,'rolls with the angle between hands');
 r.run([hand(1,'fist',0,.5),hand(2,'fist',1,.5)]);assert.ok(r.view.zoom<=2.5);
 const held=[...r.view.q] as Quat,zoom=r.view.zoom,hx=r.view.x;
 r.run([hand(2,'fist',.8,.5,axisQ(5))]);
 assert.ok(turned(r.view.q,held)<.01);assert.equal(r.view.zoom,zoom);assert.ok(Math.abs(r.view.x-hx)<1e-9);
});
test('open palm eases a field in and out over 150ms',()=>{
 const r=rig();assert.ok(r.run([hand(1,'open')]).scene.fields[0].strength<.2);
 const on=r.idle(.3,[hand(1,'open')]).scene.fields[0];assert.equal(on.strength,1);assert.equal(on.radius,1.5);assert.ok(Math.abs(on.x+2)<1e-9);
 assert.equal(r.idle(.3).scene.fields.length,0);
});
test('pinch plucks with a soft limit, then the chain wobbles home',()=>{
 const r=rig();let out=r.run([hand(1,'pinch',.5,.5)]);
 assert.equal(count(out.sounds,'pluck'),1);
 out=r.idle(.4,[hand(1,'pinch',.6,.5)]);
 assert.ok(Math.abs(out.scene.chainOffsets[6]-1)<.01);assert.equal(out.scene.chainGlow[2],1);
 out=r.idle(.4,[hand(1,'pinch',1.5,.5)]);
 const stretched=out.scene.chainOffsets[6];assert.ok(stretched>3&&stretched<4.5);
 out=r.idle(.4,[hand(1,'pinch',.6,.5)]);const start=out.scene.chainOffsets[6];
 const released=r.run([]);assert.equal(count(released.sounds,'snap'),1);
 assert.notEqual(released.scene.chainOffsets[9],0,'neighbour jolts');
 let crossings=0,was=Math.sign(start),peak=0,t=DT;
 const empty:GestureFrame={at:-1,hands:[],events:[]};
 for(;t<.9;t+=DT){const x=r.engine.step(empty,DT,r.view,false).scene.chainOffsets[6],s=Math.sign(x);if(s&&s!==was){crossings++;was=s;}if(t>.25)peak=Math.max(peak,Math.abs(x));}
 assert.ok(crossings>=3,`underdamped, got ${crossings}`);assert.ok(peak>.02,'still visibly wobbling');
 for(;t<1.6;t+=DT)r.engine.step(empty,DT,r.view,false);
 assert.ok(Math.abs(r.engine.step(empty,DT,r.view,false).scene.chainOffsets[6])<.03);
});
test('pinching empty space does nothing, mouse plucks and reports the grab',()=>{
 const r=rig(()=>-1);assert.equal(count(r.run([hand(1,'pinch')]).sounds,'pluck'),0);
 assert.equal(r.engine.pointerDown({x:0,y:0,z:0}),false);
 const m=rig();assert.equal(m.engine.pointerDown({x:0,y:0,z:0}),true);m.engine.pointerMove({x:1,y:0,z:0});
 const out=m.idle(.3);assert.ok(Math.abs(out.scene.chainOffsets[6]-1)<.01);
 m.engine.pointerUp();assert.equal(count(m.run([]).sounds,'snap'),1);
});
test('stirring spins a coasting flywheel, a still finger only hovers',()=>{
 const r=rig();let out=r.run([]);
 for(let i=0;i<30;i++){const a=i*.2;out=r.run([hand(1,'point',.5+.2*Math.cos(a),.5-.2*Math.sin(a))],[],false,1/25);}
 assert.ok(out.scene.rotorSpeed>.3,`stirred to ${out.scene.rotorSpeed}`);
 const spun=out.scene.rotorSpeed;
 assert.ok(r.idle(1).scene.rotorSpeed>spun*.1);assert.equal(r.idle(4).scene.rotorSpeed,0);
 const s=rig(),frame:GestureFrame={at:1,hands:[hand(1,'point',.5,.1)],events:[]};
 let label=null;for(let i=0;i<120;i++)label=s.engine.step(frame,DT,s.view,false).scene.label;
 assert.equal(label,null,'one frame never proves stillness');
 s.idle(.01,[hand(1,'point',.5,.1)]);
 const f2:GestureFrame={at:900,hands:[hand(1,'point',.5,.1)],events:[]};
 s.engine.step(f2,DT,s.view,false);s.w.picks=0;
 for(let i=0;i<120;i++)label=s.engine.step(f2,DT,s.view,false).scene.label;
 assert.equal(label?.title,'β subunit');assert.ok(s.w.picks<=21,`${s.w.picks} picks in 2s`);
});
test('victory eases a slice that tracks the hand, then off',()=>{
 const r=rig();const out=r.run([hand(1,'victory',.6,.5)]);assert.equal(count(out.sounds,'slice'),1);
 const on=r.idle(.6,[hand(1,'victory',.6,.5)]).scene.slice;assert.equal(on.amount,1);assert.ok(Math.abs(on.x-1)<.01);
 assert.equal(r.idle(.4).scene.slice.amount,0);
});
test('thumbs drive the motor both ways below the cap',()=>{
 const r=rig();assert.ok(Math.abs(r.idle(4,[hand(1,'thumbUp')]).scene.rotorSpeed-1.5)<.02);
 assert.ok(Math.abs(r.idle(4,[hand(1,'thumbDown')]).scene.rotorSpeed+1.5)<.02);
});
test('kick every frame stays bounded and a keypress coasts',()=>{
 const r=rig();let out=r.run([]);
 for(let i=0;i<300;i++){r.engine.kick(1);out=r.run([]);assert.ok(out.scene.rotorSpeed<=1.5);}
 assert.ok(out.scene.rotorSpeed>1.4);
 const s=rig();s.engine.kick(-1);assert.ok(s.run([]).scene.rotorSpeed<-.5);assert.equal(s.idle(5).scene.rotorSpeed,0);
});
test('rotorDegrees reports the unbounded angle and scrubs take the short arc',()=>{
 const r=rig();r.engine.setRotorDegrees(300);assert.ok(Math.abs(r.engine.rotorDegrees-300)<1e-9);
 const out=r.run([]);assert.equal(out.atp,0,'restoring before the first step mints nothing');
 r.engine.setRotorDegrees(10);r.run([]);assert.ok(Math.abs(r.engine.rotorDegrees-370)<1e-9);
});
test('360 degrees forward gives exactly 3 ATP and 10 protons, also under the motor',()=>{
 const r=rig(),out=turn(r,0,360);
 assert.equal(out.atp,3);
 assert.equal(out.scene.sparks.filter(s=>s.kind==='atp').length,3);
 assert.equal(out.scene.sparks.filter(s=>s.kind==='proton').length,10);
 const m=rig();let last=m.run([]);const frame:GestureFrame={at:5,hands:[hand(1,'thumbUp')],events:[]};
 while(m.engine.rotorDegrees<360)last=m.engine.step(frame,DT,m.view,false);
 assert.ok(last.atp>=3&&last.atp<=4);
});
test('jitter and rewinding around a boundary never double count',()=>{
 const r=rig();let out=turn(r,0,130);assert.equal(out.atp,1);
 for(let i=0;i<20;i++){r.engine.setRotorDegrees(119.9);r.run([]);r.engine.setRotorDegrees(120.1);out=r.run([]);}
 assert.equal(out.atp,1);
 out=turn(r,130,30);assert.equal(out.atp,1);out=turn(r,30,130);assert.equal(out.atp,1);
});
test('reverse burns ATP with inbound sparks and stops at zero',()=>{
 const r=rig();turn(r,0,360);const before=r.run([]).scene.sparks.filter(s=>s.kind==='atp').length;
 let out=turn(r,360,240);assert.equal(out.atp,2);assert.equal(out.scene.sparks.filter(s=>s.kind==='atp').length,before+1);
 const spark=out.scene.sparks.filter(s=>s.kind==='atp').at(-1)!,gap=()=>Math.hypot(spark.x,spark.y-2,spark.z),far=gap();
 r.run([]);assert.ok(gap()<far,'hydrolysis sparks fly inward');
 out=turn(r,240,-600);assert.equal(out.atp,0);assert.equal(r.engine.atp,0);
 out=turn(r,-600,-480);assert.equal(out.atp,1,'forward again synthesises from the floor');
});
test('events are not reprocessed for an identical frame.at',()=>{
 const r=rig(),frame:GestureFrame={at:7,hands:[],events:[{type:'clap',x:.5,y:.5},{type:'pose',handId:1,pose:'love'}]};
 const first=r.engine.step(frame,DT,r.view,false);
 assert.equal(count(first.sounds,'shock'),1);assert.equal(count(first.sounds,'skin'),1);
 const second=r.engine.step(frame,DT,r.view,false);
 assert.equal(count(second.sounds,'shock'),0);assert.equal(count(second.sounds,'skin'),0);
 assert.equal(second.scene.shocks.length,1);assert.equal(second.scene.skin,atpSkins[1]);
});
test('two-hand pinch tears apart then returns to rest',()=>{
 const r=rig();r.run([hand(1,'pinch',.4,.5),hand(2,'pinch',.6,.5)]);
 let out=r.idle(.3,[hand(1,'pinch',.2,.5),hand(2,'pinch',.8,.5)]);
 assert.ok(out.scene.explode>.95);
 const moved=rig();moved.run([hand(1,'pinch',.4,.5),hand(2,'pinch',.6,.5)]);
 let tears=0;for(let i=0;i<20;i++)tears+=count(moved.run([hand(1,'pinch',.2,.5),hand(2,'pinch',.8,.5)]).sounds,'tear');
 assert.equal(tears,1);
 out=r.idle(.75);assert.ok(out.scene.explode>.2&&out.scene.explode<.8);
 assert.equal(r.idle(.85).scene.explode,0);
});
test('clap sends a shock through every chain, springs return, shock expires',()=>{
 const r=rig();let out=r.run([],[{type:'clap',x:.3,y:.5}]);
 assert.equal(out.scene.shocks.length,1);assert.equal(count(out.sounds,'shock'),1);
 out=r.run([]);let moved=0;for(let i=0;i<22;i++)if(Math.hypot(out.scene.chainOffsets[i*3],out.scene.chainOffsets[i*3+1],out.scene.chainOffsets[i*3+2])>.01)moved++;
 assert.equal(moved,22);
 out=r.idle(1.8);assert.equal(out.scene.shocks.length,0);assert.ok(Math.max(...out.scene.chainOffsets)<.05);
});
test('love steps the skin once per gesture',()=>{
 const r=rig(),love:GestureEvent={type:'pose',handId:1,pose:'love'};
 assert.equal(r.run([],[love]).scene.skin,atpSkins[1]);
 assert.equal(r.run([],[love]).scene.skin,atpSkins[1],'a repeat without leaving the pose is the same gesture');
 r.run([],[{type:'pose',handId:1,pose:'open'}]);assert.equal(r.run([],[love]).scene.skin,atpSkins[2]);
});
test('frozen ignores gestures, releases holds and decays to rest',()=>{
 const r=rig();r.engine.kick(1);r.run([hand(1,'fist',.3,.5,axisQ(0))]);
 const out=r.run([hand(1,'fist',.5,.5,axisQ(40))],[{type:'clap',x:.5,y:.5},{type:'pose',handId:1,pose:'love'}],true);
 assert.equal(out.holding,false);assert.equal(out.view,null);assert.equal(out.scene.shocks.length,0);assert.equal(out.scene.skin,atpSkins[0]);
 assert.equal(r.run([hand(1,'thumbUp')],[],true).scene.rotorSpeed<=.75,true);
 assert.equal(r.engine.pointerDown({x:0,y:0,z:0}),false);
 const rest=r.idle(5,[hand(1,'thumbUp')],true);assert.equal(rest.scene.rotorSpeed,0);
 assert.equal(rest.scene.hands.length,1,'hands are still drawn');assert.equal(rest.scene.hands[0].active,false);
});
test('frozen drops a live pluck, and a pinch held through a freeze is not new',()=>{
 const r=rig();r.run([hand(1,'pinch',.5,.5)]);
 assert.equal(count(r.run([hand(1,'pinch',.5,.5)],[],true).sounds,'snap'),1);
 assert.equal(count(r.run([hand(1,'pinch',.5,.5)]).sounds,'pluck'),0);
});
test('a hand touching an ATP spark pops it, protons pass through',()=>{
 const r=rig();r.engine.setRotorDegrees(0);turn(r,0,120);
 const before=r.run([]).scene.sparks.filter(s=>s.kind==='atp').length;assert.equal(before,1);
 const s=r.run([]).scene.sparks.find(x=>x.kind==='atp')!,mirror={x:s.x/10+.5,y:.5-s.y/10};
 const out=r.run([hand(1,'point',mirror.x,mirror.y)]);
 assert.equal(count(out.sounds,'pop'),1);assert.equal(out.scene.sparks.filter(x=>x.kind==='atp').length,0);
});
test('spark caps hold and sparks expire',()=>{
 const r=rig();let out=r.run([]);
 for(let a=0;a<36000;a+=30){r.engine.setRotorDegrees(a);out=r.run([],[],false,0);
  assert.ok(out.scene.sparks.filter(s=>s.kind==='atp').length<=60);assert.ok(out.scene.sparks.filter(s=>s.kind==='proton').length<=80);}
 assert.equal(out.scene.sparks.filter(s=>s.kind==='atp').length,60);assert.equal(out.scene.sparks.filter(s=>s.kind==='proton').length,80);
 assert.equal(out.atp,299,'35970 degrees');
 assert.equal(r.idle(4.2).scene.sparks.length,0);
});
test('scene buffers are reused, chains can arrive after construction, reset clears',()=>{
 const w=world();w.chainCount=0;const e=new AtpEngine(w),v:AtpViewState={q:[0,0,0,1],zoom:1,x:0,y:0},f:GestureFrame={at:0,hands:[],events:[]};
 e.step(f,DT,v,false);w.chainCount=22;const a=e.step(f,DT,v,false).scene.chainOffsets;
 assert.equal(a.length,66);assert.equal(e.step(f,DT,v,false).scene.chainOffsets,a);
 const r=rig();turn(r,0,360);r.engine.reset();assert.equal(r.engine.atp,0);assert.equal(r.engine.rotorDegrees,0);assert.equal(r.run([]).scene.sparks.length,0);
});
test('motor sound reports rev/s every step and dt is clamped',()=>{
 const r=rig();r.engine.kick(1);const out=r.run([],[],false,10);
 const motor=out.sounds.find(s=>s.type==='motor');assert.ok(motor&&motor.type==='motor'&&motor.speed>0);
 assert.ok(r.engine.rotorDegrees<.05*.75*360+1);
});
