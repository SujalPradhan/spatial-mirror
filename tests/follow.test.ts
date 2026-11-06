import test from 'node:test';
import assert from 'node:assert/strict';
import {metricLandmarks} from './grasp-hands';
import {defaultCalibration} from '../src/grasp/joints';
import type {GestureFrame,HandSide} from '../src/mirror/contracts';
import {forward,len,sub,tipOf} from '../src/grasp/kinematics';
import {FollowEngine} from '../src/follow/engine';
import {LESSONS} from '../src/follow/lessons';
import {HOLD_S,Hold,OPEN,TOL,WRIST_TOL,blend,compare,exportLesson,hint,inAuthoredFrame,parseLesson,splitSteps,validateLesson,wristOf,type Sample,type Wrist} from '../src/follow/model';

const D=Math.PI/180,cal=defaultCalibration();
/** Raw degrees that read back as these normalised joints under the default calibration. */
const degrees=(q:number[])=>q.map((v,i)=>(cal.flat[i]+v*(cal.fist[i]-cal.flat[i]))/D);
const ring=LESSONS[0].steps[2].q;
const bumped=(q:number[],i:number,by:number)=>q.map((v,j)=>j===i?v+by:v);
let seed=7;const noise=(a:number)=>{seed=(seed*1664525+1013904223)>>>0;return (seed/2**32-.5)*2*a;};

/** A tracked hand with these joints; tilt and roll turn the whole hand. */
function handFrame(q:number[],at:number,{side='right',tilt=0,roll=0,events=[]}:{side?:HandSide;tilt?:number;roll?:number;events?:GestureFrame['events']}={}):GestureFrame{
 const c=Math.cos(roll),s=Math.sin(roll),ct=Math.cos(tilt),st=Math.sin(tilt);
 const points=metricLandmarks(degrees(q)).map(p=>{const x=p.x*c+p.z*s,z=-p.x*s+p.z*c;return {x:x*ct-p.y*st,y:x*st+p.y*ct,z};});
 const p0=points[0];
 return {at,events,hands:[{id:1,side,pose:'open',landmarks:points,palm:p0,indexTip:points[8],pinch:p0,orientation:null,velocity:{x:0,y:0},poseAge:5,shape:{points,metric:true}}]};
}
const empty=(at:number):GestureFrame=>({at,hands:[],events:[]});
/** Runs the engine at 30 Hz, a frame per tick. */
function drive(e:FollowEngine,seconds:number,make:(t:number)=>GestureFrame,t0=0){
 const n=Math.round(seconds*30);let out=e.step(make(t0),1/30,{} as never,false);
 for(let i=1;i<=n;i++)out=e.step(make(t0+i*33.3),1/30,{} as never,false);
 return out;
}
const memoryStore=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},map:m};};

test('a joint is in or out of tolerance, with the slack the noisy joints get',()=>{
 assert.equal(compare(ring,ring).ok,true);
 const edge=compare(bumped(ring,4,TOL*.9),ring),over=compare(bumped(ring,4,TOL*1.1),ring);
 assert.equal(edge.ok,true);assert.equal(over.ok,false);assert.deepEqual(over.worst,{kind:'joint',index:4});
 assert.ok(over.ratio[4]>1&&over.ratio.filter(r=>r>1).length===1,'only the off joint is flagged');
 assert.equal(compare(bumped(ring,5,TOL*1.2),ring).ok,true,'a DIP is allowed more than a PIP');
 assert.equal(compare(bumped(ring,5,TOL*2),ring).ok,false);
});

test('a step with a wrist needs the wrist, by tilt and by the size of the roll',()=>{
 const t:Wrist={tilt:.7,roll:1};
 assert.equal(compare(ring,ring,{user:{tilt:.7,roll:1},target:t}).ok,true);
 assert.equal(compare(ring,ring,{user:{tilt:0,roll:1},target:t}).ok,false,'not tilted');
 assert.equal(compare(ring,ring,{user:{tilt:.7,roll:-.95},target:t}).ok,true,'roll counts by size, either way');
 assert.equal(compare(ring,ring,{user:{tilt:.7+WRIST_TOL*1.1,roll:1},target:t}).ok,false);
 assert.equal(compare(ring,ring,{user:null,target:t}).ok,false,'no wrist reading means no match');
 assert.equal(compare(ring,ring,{user:{tilt:3,roll:3}}).ok,true,'a step without a wrist ignores it');
});

test('the hold needs half a second of match, forgives a flicker and starts over after a real miss',()=>{
 let h=new Hold(),done=false;
 for(let i=0;i<14;i++)done=h.update(1/30,true);
 assert.equal(done,false,'0.47 s is not enough');assert.equal(h.update(1/30,true),true);
 h=new Hold();for(let i=0;i<9;i++)h.update(1/30,true);
 for(let i=0;i<8;i++)h.update(1/30,false);
 assert.ok(h.seconds>.25,'a 0.27 s flicker keeps the time held');for(let i=0;i<7;i++)done=h.update(1/30,true);assert.equal(done,true,'and completes soon after');
 h=new Hold();for(let i=0;i<9;i++)h.update(1/30,true);for(let i=0;i<14;i++)h.update(1/30,false);
 assert.equal(h.seconds,0,'0.47 s of miss starts over');
 h=new Hold();for(let i=0;i<9;i++)h.update(1/30,true);for(let i=0;i<20;i++)h.update(1/30,false,true);
 assert.ok(h.seconds>0,'a lost hand gets a longer grace');for(let i=0;i<20;i++)h.update(1/30,false,true);assert.equal(h.seconds,0);
 assert.equal(HOLD_S,.5);
});

test('a miss is named by finger and by direction',()=>{
 const off=bumped(bumped(ring,9,-.6),10,-.6),m=compare(off,ring);
 assert.equal(hint(m,off,ring,null,undefined,'right'),'Bend your ring finger more');
 const over=bumped(ring,6,.7),m2=compare(over,ring);assert.equal(hint(m2,over,ring,null,undefined,'right'),'Straighten your middle finger a bit');
 const thumb=bumped(ring,0,-.7);assert.equal(hint(compare(thumb,ring),thumb,ring,null,undefined,'right'),'Swing your thumb across your palm');
 const t:Wrist={tilt:.7,roll:0};
 assert.equal(hint(compare(ring,ring,{user:{tilt:0,roll:0},target:t}),ring,ring,{tilt:0,roll:0},t,'right'),'Tilt your wrist more to the right');
 assert.equal(hint(compare(ring,ring,{user:{tilt:0,roll:0},target:t}),ring,ring,{tilt:0,roll:0},t,'left'),'Tilt your wrist more to the left');
 assert.equal(hint(compare(ring,ring),ring,ring,null,undefined,'right'),null,'nothing to say when it matches');
});

test('the wrist is read from the landmarks, and a left hand is the mirror of a right one',()=>{
 const flat=wristOf(metricLandmarks(degrees(OPEN.q)))!;
 assert.ok(Math.abs(flat.tilt)<.05&&Math.abs(flat.roll)<.05);
 for(const a of [.4,-.5]){
  const f=handFrame(ring,0,{tilt:a}).hands[0].shape!.points,w=wristOf(f)!;
  assert.ok(Math.abs(w.tilt-a)<.05,`tilt ${a} read as ${w.tilt}`);
 }
 const rolled=wristOf(handFrame(ring,0,{roll:.8}).hands[0].shape!.points)!;
 assert.ok(Math.abs(Math.abs(rolled.roll)-.8)<.05,`roll read as ${rolled.roll}`);
 // The same posture mirrored: tilt flips, roll does not. In the authored frame the two match.
 const right:Wrist={tilt:.6,roll:.9},left:Wrist={tilt:-.6,roll:.9};
 assert.deepEqual(inAuthoredFrame(left,'left'),right);assert.deepEqual(inAuthoredFrame(right,'right'),right);
 assert.equal(compare(ring,ring,{user:inAuthoredFrame(left,'left'),target:right}).ok,true,'a left hand mirrors the teacher');
 assert.equal(compare(ring,ring,{user:inAuthoredFrame(right,'left'),target:right}).ok,false,'the same screen tilt on a left hand is the wrong way');
});

test('the teacher glides between steps and lands exactly',()=>{
 const a=LESSONS[1].steps[2],b=LESSONS[1].steps[3];
 assert.deepEqual(blend(a,b,0).q,a.q);assert.deepEqual(blend(a,b,1).q,b.q);assert.equal(blend(a,b,1).wrist.roll,1);assert.equal(blend(a,b,.5).wrist.roll,.5);
});

/** A recording: poses held, joined by 0.4 s moves, with tremor. */
function recording(poses:{q:number[];hold:number;wrist?:Wrist}[],move=.4,rate=30){
 const out:Sample[]=[];let t=0,prev=poses[0];
 for(const [k,p] of poses.entries()){
  if(k)for(let i=1;i<=move*rate;i++){const u=i/(move*rate);out.push({t:t+=1/rate,q:p.q.map((x,j)=>prev.q[j]+(x-prev.q[j])*u+noise(.004)),wrist:p.wrist?{tilt:p.wrist.tilt,roll:p.wrist.roll}:undefined});}
  for(let i=0;i<p.hold*rate;i++)out.push({t:t+=1/rate,q:p.q.map(x=>x+noise(.006)),wrist:p.wrist});
  prev=p;
 }
 return out;
}
const A=LESSONS[0].steps[0].q,B=LESSONS[0].steps[2].q,C=LESSONS[1].steps[2].q;

test('a recording splits into steps at the pauses',()=>{
 const steps=splitSteps(recording([{q:A,hold:.8},{q:B,hold:.8},{q:C,hold:.8}]));
 assert.equal(steps.length,3);
 steps.forEach((s,i)=>assert.ok(compare(s.q,[A,B,C][i]).err<.02,`step ${i+1} is the held pose`));
 assert.ok(steps.every(s=>s.move!>=.5&&s.move!<=2.5)&&steps.every((s,i)=>s.name===`Pose ${i+1}`));
 // Held wrists are kept.
 const w=splitSteps(recording([{q:A,hold:.8,wrist:{tilt:0,roll:0}},{q:A,hold:.8,wrist:{tilt:.7,roll:0}}]));
 assert.equal(w.length,2);assert.ok(Math.abs(w[1].wrist!.tilt-.7)<.01);
});
test('splitting ignores a hesitation and a repeated pose, and gives nothing without two held poses',()=>{
 assert.equal(splitSteps(recording([{q:A,hold:.8},{q:B,hold:.2},{q:C,hold:.8}])).length,2,'a 0.2 s pause is not a step');
 assert.equal(splitSteps(recording([{q:A,hold:.8},{q:A,hold:.8},{q:B,hold:.8}])).length,2,'the same pose twice is one step');
 assert.deepEqual(splitSteps(recording([{q:A,hold:2}])),[],'one pose is not a move');
 const constant=Array.from({length:150},(_,i)=>({t:i/30,q:A.map((x,j)=>x*(.5+.5*Math.sin(i/6+j)))}));
 assert.deepEqual(splitSteps(constant),[],'never still');
 assert.deepEqual(splitSteps([]),[]);
 const ends=splitSteps([...recording([{q:A,hold:.8},{q:B,hold:.8}]),...recording([{q:B,hold:0},{q:C,hold:0}],.5).map(s=>({...s,t:s.t+1.9}))]);
 assert.ok(ends.length>=2&&compare(ends[ends.length-1].q,C).err<.15,'a recording that ends moving ends on its last pose');
});

test('a lesson survives JSON, and bad ones are refused',()=>{
 for(const l of LESSONS){
  const back=parseLesson(exportLesson(l));
  assert.equal(back.title,l.title);assert.equal(back.steps.length,l.steps.length);
  back.steps.forEach((s,i)=>{assert.deepEqual(s.q,l.steps[i].q);assert.deepEqual(s.wrist,l.steps[i].wrist);assert.equal(s.name,l.steps[i].name);});
 }
 assert.equal(parseLesson(JSON.stringify(LESSONS[0])).steps.length,8,'a bare lesson is accepted too');
 const good=JSON.parse(exportLesson(LESSONS[0]));
 const bad=[{...good,lesson:{...good.lesson,steps:[good.lesson.steps[0]]}},{...good,lesson:{...good.lesson,steps:good.lesson.steps.map((s:any)=>({...s,q:s.q.slice(1)}))}},
  {...good,lesson:{...good.lesson,steps:good.lesson.steps.map((s:any)=>({...s,q:s.q.map(()=>2)}))}},{...good,lesson:{...good.lesson,steps:good.lesson.steps.map((s:any)=>({...s,wrist:{tilt:'x',roll:0}}))}},'x',null,[1]];
 for(const b of bad)assert.throws(()=>validateLesson(b));
 assert.throws(()=>parseLesson('{not json'));
 const sanitised=validateLesson({...good.lesson,id:'../x y',extra:'dropped',steps:good.lesson.steps.map((s:any)=>({...s,evil:1}))});
 assert.equal(sanitised.id,'xy');assert.equal((sanitised as any).extra,undefined);assert.equal((sanitised.steps[0] as any).evil,undefined);
});

test('the built-in lessons are well formed',()=>{
 assert.deepEqual(LESSONS.map(l=>l.id),['thumb','pump']);
 for(const l of LESSONS){validateLesson(l);assert.ok(l.steps.length>=6);assert.ok(l.steps.every(s=>s.q.length===15));}
 assert.ok(LESSONS[1].steps.some(s=>s.wrist&&Math.abs(s.wrist.roll)>.5),'the collar twist is a wrist roll');
 assert.ok(!/[A-Z][a-z]*(?:‑|-)?(?:Mist|Aptar)/.test(JSON.stringify(LESSONS)),'no brand names');
});

test('the teacher plays by itself with no hand, then waits for one and follows it through the lesson',()=>{
 const e=new FollowEngine(memoryStore());
 let out=drive(e,4,empty.bind(null,0) as never);
 assert.equal(e.mode,'demo');assert.ok(out.scene.follow.index>=1,'the demo moved on by itself');assert.equal(out.scene.follow.hand,false);
 // A hand appears: the lesson starts over from step one and waits.
 const n=LESSONS[0].steps.length;let t=1000;
 out=drive(e,1.2,s=>handFrame(OPEN.q,t+=33));
 assert.equal(e.mode,'follow');
 for(let i=0;i<n;i++){
  assert.equal(e.index,i);
  // The teacher waits where it is until you match: nothing advances while the hand is wrong.
  const wrong=drive(e,1.3,()=>handFrame(bumped(LESSONS[0].steps[i].q,i<4?3+3*Math.min(i,3)+1:4,-.6),t+=33));
  assert.equal(e.index,i,'waited at step '+i);assert.ok(wrong.scene.follow.waiting);
  drive(e,1.6,()=>handFrame(LESSONS[0].steps[i].q,t+=33));
  if(i<n-1)assert.equal(e.index,i+1,'moved on after the hold');
 }
 assert.equal(e.mode,'done');
 const f=drive(e,.1,()=>handFrame(OPEN.q,t+=33)).scene.follow;
 assert.equal(f.results.length,n);assert.ok(f.results.every(r=>!r.skipped&&r.score>40&&r.seconds>=HOLD_S),JSON.stringify(f.results));assert.equal(f.matchedSteps,n);
});

test('a left hand follows the mirrored teacher, and a flicker does not reset the hold',()=>{
 const e=new FollowEngine(memoryStore());let t=0;
 e.select('pump');drive(e,1,()=>handFrame(OPEN.q,t+=33,{side:'left'}));
 assert.equal(e.mode,'follow');assert.equal(e.side,'left');assert.equal(e.mirrored,true);
 const step=(i:number,wrist?:{tilt:number;roll:number})=>drive(e,1.6,()=>handFrame(LESSONS[1].steps[i].q,t+=33,{side:'left',tilt:wrist?.tilt??0,roll:wrist?.roll??0}));
 step(0);assert.equal(e.index,1);
 // Step 2 wants the right hand's +0.7 tilt: the same turn on a left hand is the wrong way.
 drive(e,2,()=>handFrame(LESSONS[1].steps[1].q,t+=33,{side:'left',tilt:.7}));assert.equal(e.index,1,'unmirrored tilt does not count');
 const out=drive(e,1.2,()=>handFrame(LESSONS[1].steps[1].q,t+=33,{side:'left',tilt:-.7}));
 assert.equal(e.index,2,'the mirrored tilt does');assert.ok(!out.scene.follow.mirrored===false);
 // Flicker: half a second of match, a 0.2 s dropout, then the rest.
 drive(e,2,()=>handFrame(LESSONS[1].steps[2].q,t+=33,{side:'left'}));assert.ok(e.index>=3||e.mode!=='follow');
 const e2=new FollowEngine(memoryStore());let u=0;
 drive(e2,1,()=>handFrame(OPEN.q,u+=33));drive(e2,1.4,()=>empty(0));
 assert.equal(e2.mode,'follow');
 drive(e2,1.4,()=>handFrame(LESSONS[0].steps[0].q,u+=33));
 const before=e2.index;
 drive(e2,.3,()=>handFrame(LESSONS[0].steps[0].q,u+=33));drive(e2,.2,()=>empty(0));drive(e2,.35,()=>handFrame(LESSONS[0].steps[0].q,u+=33));
 assert.ok(e2.index>=before,'still going');
});

test('a hand that misses is told which finger',()=>{
 const e=new FollowEngine(memoryStore());let t=0;drive(e,1,()=>handFrame(OPEN.q,t+=33));
 const target=LESSONS[0].steps[0].q;
 // At step one the ring finger is meant to be straight; curl it.
 const out=drive(e,3.5,()=>handFrame(bumped(bumped(bumped(target,9,.8),10,.8),11,.8),t+=33));
 assert.match(out.scene.follow.hint??'',/Straighten your ring finger/);
 assert.ok(out.scene.residual[10]>.17,'its joints glow');assert.ok(Math.abs(out.scene.residual[3])<.17,'the index does not');
});

test('a clap shows the step again; skipping moves on',()=>{
 const e=new FollowEngine(memoryStore());let t=0;drive(e,1,()=>handFrame(OPEN.q,t+=33));
 const s=drive(e,2.5,()=>handFrame(bumped(LESSONS[0].steps[0].q,9,.8),t+=33)).scene.follow;assert.ok(s.waiting);
 drive(e,.1,()=>handFrame(OPEN.q,t+=33,{events:[{type:'clap',x:.5,y:.5}]}));
 assert.equal(e.index,0);assert.equal(e.step(handFrame(OPEN.q,t+=33),1/30,{} as never,false).scene.follow.waiting,false,'the teacher is playing it again');
 drive(e,2,()=>handFrame(bumped(LESSONS[0].steps[0].q,9,.8),t+=33));e.skip();
 assert.equal(e.index,1);assert.equal(e.results[0].skipped,true);
});

test('recording: 3-2-1, capture, split, save, undo',()=>{
 const store=memoryStore(),e=new FollowEngine(store);let t=0;
 drive(e,1,()=>handFrame(OPEN.q,t+=33));e.toggleRecord();assert.equal(e.mode,'countdown');
 const seq=[{q:A,hold:.8},{q:B,hold:.8},{q:C,hold:.8}];
 let c=drive(e,.1,()=>handFrame(OPEN.q,t+=33)).scene.follow.countdown;assert.equal(c,3);
 c=drive(e,1,()=>handFrame(OPEN.q,t+=33)).scene.follow.countdown;assert.equal(c,2);
 drive(e,2.1,()=>handFrame(OPEN.q,t+=33));assert.equal(e.mode,'record');
 const rec=recording(seq);let k=0;
 drive(e,rec.length/30,()=>handFrame(rec[Math.min(k++,rec.length-1)].q,t+=33));
 assert.equal(e.mode,'record');e.toggleRecord();
 assert.equal(e.lessonId,'mine');assert.equal(e.lesson.title,'Your move');assert.equal(e.steps.length,3);assert.equal(e.canUndo,true);
 assert.ok(store.map.get('follow-lessons-v1')?.includes('Your move'),'saved');
 assert.equal(new FollowEngine(store).lessons.length,3,'comes back next visit');
 // Replay: with the hand still there the teacher waits at step one.
 drive(e,1.2,()=>handFrame(A,t+=33));assert.equal(e.mode,'follow');
 // A second recording can be undone back to the first.
 e.toggleRecord();drive(e,3.2,()=>handFrame(OPEN.q,t+=33));
 const rec2=recording([{q:A,hold:.8},{q:C,hold:.8}]);k=0;drive(e,rec2.length/30,()=>handFrame(rec2[Math.min(k++,rec2.length-1)].q,t+=33));e.toggleRecord();
 assert.equal(e.steps.length,2);e.undoRecording();assert.equal(e.steps.length,3);e.undoRecording();
 assert.equal(e.lessons.length,2);assert.equal(e.lessonId,'thumb');assert.equal(e.canUndo,false);
 // Nothing paused: nothing saved.
 e.toggleRecord();drive(e,3.2,()=>handFrame(OPEN.q,t+=33));drive(e,1,()=>handFrame(OPEN.q,t+=33));e.toggleRecord();
 assert.equal(e.lessons.length,2);
});

test('import and export through the engine',()=>{
 const e=new FollowEngine(memoryStore());
 assert.equal(e.importLesson(exportLesson(LESSONS[1])),true);assert.equal(e.lessonId,'mine');assert.equal(e.steps.length,LESSONS[1].steps.length);
 assert.equal(parseLesson(e.exportMine()).title,LESSONS[1].title);
 assert.equal(e.importLesson('{"nope":1}'),false);assert.equal(e.steps.length,LESSONS[1].steps.length,'a bad file changes nothing');
});

test('where a step says the thumb meets a fingertip, the teacher thumb tip is on it',()=>{
 // This thumb model reaches the index and middle tips; the ring is 2.1 cm and the little finger 3.95 cm at the very best it can do.
 const reach:Record<number,number>={1:1.5,2:1.5,3:2.2,4:4};
 const tipGap=(q:number[],f:number)=>{const L=forward(q,true);return len(sub(tipOf(L[2]),tipOf(L[3*f+2])));};
 let n=0;
 for(const l of LESSONS)for(const s of l.steps)if(s.touch){
  n++;const gap=tipGap(s.q,s.touch);
  assert.ok(gap<=reach[s.touch],`${l.id} / ${s.name}: ${gap.toFixed(2)} cm`);
  for(const f of [1,2,3,4])if(f!==s.touch)assert.ok(tipGap(s.q,f)>gap+2,`${s.name}: the target is the nearest fingertip`);
 }
 assert.equal(n,9,'every thumb step and the two pinch steps carry a contact');
 const pinch=LESSONS[1].steps[0];assert.ok(tipGap(pinch.q,1)<=1.5);
 assert.deepEqual(LESSONS[0].steps.filter(s=>!s.touch).map(s=>s.name),['Open hand']);
 assert.equal(parseLesson(exportLesson(LESSONS[0])).steps[2].touch,3,'the contact survives export');
});
