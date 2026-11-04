import test from 'node:test';
import assert from 'node:assert/strict';
import {ARM_S,EMBROIDERY_CAP,FULL,SLOW,STITCH_CAP,throwBeat} from '../src/machine/behaviour';
import {machineSkins} from '../src/machine/contracts';
import {MachineEngine} from '../src/machine/engine';
import {initialMachine,validateMachine} from '../src/machine/state';
import {bodyParts,machineExtras,machineParts} from '../src/machine/parts';
import {PITCH} from '../src/machine/model';
import type {GestureEvent,GestureFrame,HandPose,TrackedHand} from '../src/mirror/contracts';

let threaded=false;
const world={partCount:machineParts.length,mirrorToWorld:(p:{x:number;y:number;z:number})=>p,partAt:()=>-1,partInfo:(i:number)=>machineParts[i],screenOf:()=>({x:0,y:0}),onThread:()=>threaded};
const frame:GestureFrame={at:0,hands:[],events:[]};
const fresh=()=>{const e=new MachineEngine(world),view=initialMachine().view;return {e,m:e.machine,view,step:(n=1)=>{let out;for(let i=0;i<n;i++)out=e.step(frame,.02,view,false);return out!;}};};
/** Sews by moving the crank in small jumps, as a stepping frame would. */
function sew(t:ReturnType<typeof fresh>,turns:number,step=30){for(let d=0;d<turns*360;d+=step){t.m.crank+=step;t.step();}}

test('the machine has 15 to 20 named parts, and exactly the three that can come out',()=>{
 assert.ok(machineParts.length>=15&&machineParts.length<=20);
 assert.deepEqual(machineParts.filter(p=>p.removable).map(p=>p.id),['takeUp','feedDog','bobbin']);
 assert.equal(new Set([...machineParts,...machineExtras].map(p=>p.id)).size,machineParts.length+machineExtras.length);
 for(const p of machineParts)assert.ok(p.title&&p.role,p.id);
 for(const id of bodyParts)assert.ok(machineParts.some(p=>p.id===id),id);
});
test('a stitch per turn, and the record stays capped however long it runs',()=>{
 const t=fresh();sew(t,5);assert.equal(t.m.count,5);assert.equal(t.m.stitches.length,5);
 t.m.stitches.forEach((s,i)=>{assert.ok(Math.abs(s.x-i*PITCH)<1e-9);assert.equal(s.index,i);});
 sew(t,STITCH_CAP*3);assert.equal(t.m.stitches.length,STITCH_CAP);assert.equal(t.m.count,5+STITCH_CAP*3);
 assert.equal(t.m.stitches.at(-1)!.index,t.m.count-1);
});
test('a pulled part changes only the stitches after it',()=>{
 const t=fresh();sew(t,3);t.m.remove('bobbin');sew(t,2);
 assert.deepEqual(t.m.stitches.map(s=>s.kind),['formed','formed','formed','single-thread','single-thread']);
 assert.equal(t.m.count,3,'a stitch with no lock is not a stitch');
 t.m.restore();sew(t,1);assert.equal(t.m.stitches.at(-1)!.kind,'formed');assert.equal(t.m.count,4);
});
test('without the feed dog the cloth stops where it is, not back at the start',()=>{
 const t=fresh();sew(t,4);const at=t.m.travel;assert.ok(at>2*PITCH);
 t.m.remove('feedDog');sew(t,3);assert.equal(t.m.travel,at);
 assert.deepEqual(t.m.stitches.slice(-3).map(s=>s.kind),['stationary','stationary','stationary']);
 assert.equal(new Set(t.m.stitches.slice(-3).map(s=>s.x)).size,1);
});
test('hook timing steps both miss, and Recenter puts it back',()=>{
 const t=fresh();sew(t,2);
 assert.equal(t.e.cycleTiming()!.offset>0,true);sew(t,2);assert.equal(t.m.stitches.at(-1)!.kind,'skipped');assert.equal(t.m.count,2);assert.ok(t.m.caption.includes('late'));
 assert.equal(t.e.cycleTiming()!.offset<0,true);sew(t,1);assert.equal(t.m.stitches.at(-1)!.kind,'skipped');assert.ok(t.m.caption.includes('early'));
 t.e.restore();sew(t,1);assert.equal(t.m.stitches.at(-1)!.kind,'formed');
});
test('running backwards unpicks, and a scrub wraps without unsewing',()=>{
 const t=fresh();sew(t,4);assert.equal(t.m.count,4);
 for(let d=0;d<720;d+=30){t.m.crank-=30;t.step();}
 assert.equal(t.m.count,2);assert.equal(t.m.stitches.length,2);
 const before=t.m.crank,count=t.m.count;t.e.seek(((before%360)+10)%360);t.step();
 assert.ok(Math.abs(t.m.crank-before-10)<1e-9,'shortest arc from the unwrapped crank');assert.equal(t.m.count,count);
 assert.ok(Math.abs(t.e.position-t.m.crank)<1e-9);
});
test('a saved phase restores silently before the first step',()=>{
 const t=fresh();t.e.seek(300);t.step();assert.equal(t.m.count,0);assert.equal(t.m.crank,300);
 t.m.crank=370;t.step();assert.equal(t.m.count,1);
});
test('stir turns the wheel directly, one circle to a stitch, and fades nothing into the flywheel',()=>{
 const t=fresh();t.m.omega=100;t.m.stir(Math.PI*2,.5);assert.equal(t.m.crank,180);assert.equal(t.m.omega,0);
});
test('idle runs slowly and lingers on the loop throw; off, it does not move',()=>{
 const t=fresh();t.step(50);assert.equal(t.m.crank,0);
 const u=fresh();u.e.idle=true;u.step(300);assert.ok(u.m.omega>40&&u.m.omega<70,String(u.m.omega));
 u.m.crank=210;const a=u.m.crank;u.step(10);const slow=u.m.crank-a;u.m.crank=30;u.step(10);assert.ok(slow<(u.m.crank-30)*.5);
 assert.equal(throwBeat(100),0);assert.equal(throwBeat(212),1);assert.equal(throwBeat(300),0);
});
test('zoom crosses out to the whole machine and back in, with a margin between',()=>{
 const t=fresh();t.e.idle=true;t.step();assert.equal(t.m.close,true,'the page opens on the close-up');
 t.view.zoom=.8;t.step();assert.equal(t.m.close,false);
 t.view.zoom=1;t.step();assert.equal(t.m.close,false);
 t.view.zoom=1.4;t.step();assert.equal(t.m.close,true);
 t.view.zoom=1;t.step(200);assert.equal(t.m.close,true,'nothing changes the framing by itself');
});
test('with nothing touched the camera never moves: no opening zoom, no breathing on the loop throw',()=>{
 for(const idle of [true,false]){
  const t=fresh();t.e.idle=idle;const first=t.step().scene,scale=first.scale,focus=[...first.focus];
  for(let i=0;i<5*50;i++){const s=t.step().scene;assert.equal(s.scale,scale,`scale at step ${i}`);assert.deepEqual([...s.focus],focus);}
  if(idle)assert.ok(t.m.count>0||t.m.crank>30,'the idle motor still sews');
 }
});
test('the loop throw is lit instead of zoomed',()=>{
 const t=fresh();t.e.idle=true;let lit=0;for(let i=0;i<600;i++)lit=Math.max(lit,t.step().scene.loopLight);
 assert.ok(lit>.5,String(lit));
});
test('a removal is hidden, and the framing stays where the viewer left it',()=>{
 const t=fresh();t.e.idle=true;t.step();t.m.setClose(false);
 const i=machineParts.findIndex(p=>p.id==='takeUp'),out=t.step(),s=out.scene;
 s.partGlow[i]=1;s.partOffsets[i*3]=1;t.m.settle(.02,(t.e as any).context);
 assert.deepEqual(t.m.removed,['takeUp']);assert.equal(t.m.close,false);assert.ok(t.step().scene.hidden.has('takeUp'));
 t.m.restore();assert.equal(t.m.close,false,'putting parts back does not move the camera either');t.m.cycleTiming();assert.equal(t.m.close,false);
 t.m.remove('bobbin');const hidden=t.step().scene.hidden;assert.ok(hidden.has('bobbin')&&hidden.has('bobbinRims'),'its rims go with it');
});
test('saved state is validated and allow-listed',()=>{
 const good=initialMachine();assert.deepEqual(validateMachine({...good,extra:1}),good);
 assert.throws(()=>validateMachine({...good,phase:500}));assert.throws(()=>validateMachine({...good,schema:2}));
});

/** A tracked hand at one point: every joint there, so palm, pinch and fingertip agree. */
const hand=(pose:HandPose,x:number,y:number,id=1):TrackedHand=>{const p={x,y,z:0};return {id,side:'right',pose,landmarks:Array.from({length:21},()=>({...p})),palm:p,indexTip:p,pinch:p,orientation:null,velocity:{x:0,y:0},poseAge:5};};
let clock=0;
const live=(t:ReturnType<typeof fresh>,hands:TrackedHand[],events:GestureEvent[]=[],dt=1/60)=>t.e.step({at:++clock,hands,events},dt,t.view,false);

test('three skins: solid, x-ray, light painting, and painting exposes the crank it has seen',()=>{
 assert.deepEqual(machineSkins,['glass','xray','paint']);
 const t=fresh();for(let i=0;i<2;i++)live(t,[hand('love',0,0)],[{type:'pose',handId:1,pose:'love'}]),live(t,[],[{type:'lost',handId:1}]);
 assert.equal(t.step().scene.skin,'paint');sew(t,1);assert.ok(t.step().scene.exposure>=330,'a turn exposed');
});
test('one open hand steers the cloth the other way, and the holes trace the hand',()=>{
 const t=fresh();for(let i=0;i<40;i++)live(t,[hand('open',0,0)]);
 assert.equal(t.m.drawing,true);assert.ok(Math.abs(t.m.omega)<1,'the regulator holds the needle while the hand is still');
 for(let i=1;i<=120;i++)live(t,[hand('open',i*.01,0)]);
 assert.ok(t.m.ox<-10,'cloth slides opposite the hand');assert.ok(t.m.embroidery.count>5,'stitches while moving');
 const e=t.m.embroidery,xs=Array.from(e.x.slice(0,e.count));assert.ok(xs.at(-1)!>xs[0]+8,'the line runs the way the hand went');
 assert.equal(t.m.stitches.length,0,'free motion leaves the straight seam alone');
 for(let i=0;i<40;i++)live(t,[]);assert.equal(t.m.drawing,false);assert.ok(t.step().scene.draw>.9,'the view lingers on the drawing');
});
test('free motion starts only from a palm held still, never from a reaching hand',()=>{
 const t=fresh(),scale=t.step().scene.scale;
 for(let i=0;i<120;i++){const out=live(t,[hand('open',-2+i*.04,Math.sin(i/9)*.5)]);assert.equal(out.scene.scale,scale);}
 assert.equal(t.m.drawing,false,'a moving open hand is a reach');assert.equal(t.m.arming,0);
 let from=-1,to=-1,ring=0;
 for(let i=0;i<120&&to<0;i++){
  const out=live(t,[hand('open',2.76,.2)]);if(from<0&&t.m.arming>0)from=i;if(t.m.drawing)to=i;
  for(const a of out.scene.aims??[])if(a.kind==='arming')ring=Math.max(ring,a.amount);
 }
 assert.ok(from>=0&&to>0,`${from} ${to}`);assert.ok((to-from)/60>=ARM_S-.04,'held still for the count-in first');assert.ok(ring>.8,'the fill ring is drawn as it counts');
 threaded=true;try{const u=fresh();for(let i=0;i<60;i++)live(u,[hand('open',0,0)]);assert.equal(u.m.drawing,false,'a palm on the thread is reaching for it');}finally{threaded=false;}
});
test('free motion keeps the newest 400 holes',()=>{
 const t=fresh();for(let i=0;i<40;i++)live(t,[hand('open',0,0)]);
 for(let i=0;i<4000;i++)live(t,[hand('open',Math.sin(i/30)*1.2,Math.cos(i/23)*.8)]);
 assert.equal(t.m.embroidery.count,EMBROIDERY_CAP);assert.ok(t.m.count>EMBROIDERY_CAP);
});
test('a pinch on the thread sets its tension, the stitches follow, and too far snaps it',()=>{
 threaded=true;
 try{
  const t=fresh();live(t,[hand('pinch',0,0)]);for(let i=1;i<=30;i++)live(t,[hand('pinch',0,-i*.04)]);
  assert.ok(t.m.tension<.2,'down feeds slack');assert.match(t.m.caption,/Slack/);
  sew(t,1);live(t,[hand('pinch',0,-1.2)]);assert.ok(t.m.stitches.at(-1)!.tension!<.3,'a slack stitch is recorded');
  for(let i=1;i<=60;i++)live(t,[hand('pinch',0,-1.2+i*.06)]);
  assert.equal(t.m.broken,true);assert.match(t.m.caption,/Snapped/);
  sew(t,1);live(t,[hand('pinch',0,2.4)]);assert.equal(t.m.stitches.at(-1)!.kind,'skipped','no top thread, no stitch');
  for(let i=0;i<120;i++)live(t,[]);assert.equal(t.m.broken,false,'letting go rethreads');assert.ok(Math.abs(t.m.tension-.5)<.1,'and the discs take over');
 }finally{threaded=false;}
});
test('holding the thread leaves the camera alone, and letting go keeps the tension',()=>{
 threaded=true;
 try{
  const t=fresh(),before=t.step().scene,scale=before.scale,close=t.m.close;
  live(t,[hand('pinch',0,0)]);for(let i=1;i<=20;i++){const s=live(t,[hand('pinch',0,i*.04)]).scene;assert.equal(s.scale,scale);}
  assert.ok(t.m.held,'held');assert.equal(t.m.close,close);const kept=t.m.tension;assert.ok(kept>.7,String(kept));
  for(let i=0;i<200;i++)live(t,[]);assert.equal(t.m.held,null);assert.ok(Math.abs(t.m.tension-kept)<1e-9,'released, the tension stays');
  assert.match(t.m.caption,/Tight.*again/);
  sew(t,1);assert.ok(t.m.stitches.at(-1)!.tension!>.7,'and the next stitches are sewn at it');
  t.m.restore();assert.equal(t.m.tension,.5,'Recenter puts it back');
 }finally{threaded=false;}
});
test('the thread wins a near-tie with a removable part, and a reticle snaps to it as fingers close',()=>{
 const takeUp=machineParts.findIndex(p=>p.id==='takeUp');let d=20;
 const w={...world,partAt:()=>takeUp,threadDistance:()=>d,threadNear:()=>({x:9,y:9,z:0})};
 const e=new MachineEngine(w),view=initialMachine().view,m=e.machine;
 assert.deepEqual(m.aim({x:0,y:0,z:0}),{x:9,y:9,z:0});assert.equal(m.claim(1,{x:0,y:0,z:0}),true);assert.equal(e.step(frame,.02,view,false).scene.label,null);
 const f=new MachineEngine(w).machine;d=40;assert.equal(f.aim({x:0,y:0,z:0}),null,'clearly on the part, the part');assert.equal(f.claim(1,{x:0,y:0,z:0}),false);
 const g=new MachineEngine({...w,partAt:()=>-1}).machine;assert.equal(g.claim(1,{x:0,y:0,z:0}),true,'40 px from the thread with nothing else there still catches it');
 d=70;assert.equal(new MachineEngine({...w,partAt:()=>-1}).machine.claim(1,{x:0,y:0,z:0}),false);
});
test('a pinch off the thread does not take it',()=>{const t=fresh();for(let i=0;i<20;i++)live(t,[hand('pinch',0,-i*.05)]);assert.equal(t.m.tension,.5);assert.equal(t.m.held,null);});
test('a clap stops time mid-stitch; another, or six seconds, lets it run',()=>{
 const t=fresh();t.m.omega=900;live(t,[]);const at=t.m.crank;
 live(t,[],[{type:'clap',x:0,y:0}]);assert.equal(t.m.frozen,true);for(let i=0;i<60;i++)live(t,[]);
 assert.ok(Math.abs(t.m.crank-at)<20,'stopped');assert.match(t.m.caption,/Time stopped/);
 assert.ok(t.step().scene.partOffsets.every(v=>v===0),'the clap does not jolt the parts');
 live(t,[],[{type:'clap',x:0,y:0}]);assert.equal(t.m.frozen,false);assert.ok(t.m.omega>0,'the motor picks up where it was');
 live(t,[],[{type:'clap',x:0,y:0}]);for(let i=0;i<6.2*60;i++)live(t,[]);assert.equal(t.m.frozen,false);
});
test('Slice films full speed fifty times slower',()=>{
 const t=fresh();for(let i=0;i<30;i++)live(t,[hand('victory',0,0)]);
 const a=t.m.crank;live(t,[hand('victory',0,0)],[],.05);assert.ok(Math.abs(t.m.crank-a-FULL/SLOW*.05)<1e-6);assert.equal(t.m.spm,800);assert.ok(t.m.realMs>0);
});
test('Run ramps to full speed under a strobe; reduced motion keeps it gentle and unstrobed',()=>{
 const t=fresh();for(let i=0;i<300;i++)live(t,[hand('thumbUp',0,0)]);
 assert.ok(t.m.spm>760,String(t.m.spm));assert.equal(t.m.strobing,true);
 const shown=t.step().scene.machine.crank;let moved=0;for(let i=0;i<3;i++){const c=live(t,[hand('thumbUp',0,0)]).scene.machine.crank;if(c!==shown)moved++;}
 assert.ok(moved<3,'the pose only changes on a flash');
 const r=fresh();r.m.reduced=true;for(let i=0;i<300;i++)live(r,[hand('thumbUp',0,0)]);assert.ok(r.m.spm<80);assert.equal(r.m.strobing,false);
});
test('Reverse unpicks, and each lock pulled out is shown leaving',()=>{
 const t=fresh();sew(t,4);for(let i=0;i<200;i++)live(t,[hand('thumbDown',0,0)]);
 assert.ok(t.m.count<4);assert.ok(t.step().scene.unpicked.length>0);assert.match(t.m.caption,/Unpicking/);
});
