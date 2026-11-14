import test from 'node:test';
import assert from 'node:assert/strict';
import {AtomEngine} from '../src/atom/engine';
import {atomWalkthrough} from '../src/atom/walkthrough';
import {AtpEngine} from '../src/atp/engine';
import {atpWalkthrough} from '../src/atp/walkthrough';
import type {GestureEvent,GestureFrame,HandPose,MirrorPoint,MirrorViewState,TrackedHand} from '../src/mirror/contracts';
import {FeedbackGate,diagnoseHands,palmSize} from '../src/mirror/hand-feedback';
import {Tutorial,markTutorialSeen,tutorialSeen,type TutorialStep} from '../src/mirror/tutorial';
import {gestureHelp,quatAngle,type MirrorProbe,type MirrorWalkthroughStep} from '../src/mirror/walkthrough-steps';
import {posedHand} from './hand-fixtures';
import {GestureTracker} from '../src/mirror/gestures';

const DT=1/60;
// ---- The step machine ----
const frame=(at:number,poses:HandPose[]=[],events:GestureEvent[]=[]):GestureFrame=>({at,events,hands:poses.map((pose,id)=>({id,pose}) as TrackedHand)});
const effectStep=(pose:TutorialStep['pose'],needsEffect=true):TutorialStep=>({id:pose,glyph:'',label:pose,pose,needsEffect});
const hold=(t:Tutorial,pose:HandPose,from:number,to:number,effect=false)=>{let v=t.current;for(let at=from;at<=to;at+=50)v=t.update(frame(at,[pose]),at,effect);return v;};

test('a step that needs its effect is not finished by the pose alone',()=>{
 const t=new Tutorial([effectStep('fist'),effectStep('open')]);
 const v=hold(t,'fist',0,5000);
 assert.deepEqual([v.phase,v.index,v.justCompleted,v.done],['do',0,false,false],'five seconds of the pose stays in the effect phase');
 const old=new Tutorial([effectStep('fist',false),effectStep('open',false)]);
 assert.equal(hold(old,'fist',0,700).index,1,'a step with no effect still passes on the pose, as before');
});
test('the effect finishes the step, and only after the pose has been shown',()=>{
 const t=new Tutorial([effectStep('fist'),effectStep('open')]);
 const early=t.update(frame(0),0,true);
 assert.deepEqual([early.phase,early.index],['show',0],'an effect before the pose is shown does not count');
 hold(t,'fist',100,800);
 assert.equal(t.current.phase,'do');
 const done=t.update(frame(900,['fist']),900,true);
 assert.deepEqual([done.justCompleted,done.index,done.phase,done.step?.id],[true,1,'show','open']);
});
test('the effect phase asks for help when stuck, and Next, Previous and skipping reset to the pose phase',()=>{
 const t=new Tutorial([effectStep('fist'),effectStep('open'),effectStep('pinch')],{hintMs:3000});
 hold(t,'fist',0,700);
 assert.equal(t.update(frame(2000),2000).hint,false);assert.equal(t.update(frame(4000),4000).hint,true);
 const next=t.next();assert.deepEqual([next.index,next.phase],[1,'show']);
 hold(t,'open',1000,3000);t.next();
 assert.equal(t.previous().phase,'show');
 t.restart();assert.equal(t.current.phase,'show');
});
test('a clap or two-handed step can carry an effect too',()=>{
 const t=new Tutorial([effectStep('both-pinch')]);
 let v=t.current;for(let at=0;at<=700;at+=50)v=t.update({at,events:[],hands:[{pose:'pinch'},{pose:'pinch'}] as TrackedHand[]},at);
 assert.equal(v.phase,'do');assert.equal(t.update(frame(800),800,true).done,true);
});

// ---- Seen flags ----
const store=(init:Record<string,string>={})=>{const m=new Map(Object.entries(init));return {m,getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);}};};
test('seen is kept per page, and the old shared flag counts for ATP only',()=>{
 const s=store();assert.equal(tutorialSeen(s,'atp'),false);
 markTutorialSeen(s,'atp');assert.equal(tutorialSeen(s,'atp'),true);assert.equal(tutorialSeen(s,'atom'),false);assert.deepEqual([...s.m.keys()],['mirror-tutorial-v1:atp']);
 const old=store({'mirror-tutorial-v1':'1'});
 assert.equal(tutorialSeen(old,'atp'),true);assert.equal(tutorialSeen(old,'atom'),false);assert.equal(tutorialSeen(old,'perfume'),false);assert.equal(tutorialSeen(old),true,'without a page the old key is read');
 assert.equal(tutorialSeen({getItem(){throw new Error('blocked');},setItem(){}},'atp'),false);
});

// ---- Hand feedback ----
const hand=(pose:HandPose,x=.5,y=.5,size=.12,aspect=16/9):TrackedHand=>{
 const base=posedHand(pose==='none'?'open':pose as never),landmarks:MirrorPoint[]=base.map(p=>({x:x+p.x*size,y:y+p.y*size*aspect,z:p.z*size}));
 return {id:1,side:'right',pose,landmarks,palm:landmarks[0],indexTip:landmarks[8],pinch:landmarks[8],orientation:null,velocity:{x:0,y:0},poseAge:5};
};
const fr=(...hands:TrackedHand[]):GestureFrame=>({at:0,events:[],hands});
test('feedback names what is wrong, most basic first',()=>{
 const code=(f:GestureFrame,pose:Parameters<typeof diagnoseHands>[1],camera=true)=>diagnoseHands(f,pose,16/9,camera)?.code??null;
 assert.equal(code(fr(),'fist',false),'camera-off');
 assert.equal(code(fr(),'fist'),'no-hand');
 assert.equal(code(fr(hand('fist',.5,.6,.02)),'fist'),'far');
 assert.equal(code(fr(hand('fist',.5,.6,.5)),'fist'),'close');
 assert.equal(code(fr(hand('fist',.02,.6)),'fist'),'edge');
 assert.equal(code(fr(hand('fist',.5,.99)),'fist'),'edge');
 assert.equal(code(fr(hand('open',.5,.6)),'both-pinch'),'one-hand');
 assert.equal(code(fr(hand('open',.5,.6)),'clap'),'one-hand');
 assert.equal(code(fr(hand('fist',.5,.6)),'thumbUp'),'looks-fist');
 assert.equal(code(fr(hand('none',.5,.6)),'fist'),'unclear');
 assert.equal(code(fr(hand('fist',.5,.6)),'fist'),null);
 assert.equal(code(fr(hand('thumbUp',.5,.6)),'thumbUp'),null);
 assert.equal(code(fr({...hand('pinch',.3,.6),id:1},{...hand('fist',.7,.6),id:2}),'both-pinch'),'looks-fist','a second hand in the wrong pose is named');
 assert.equal(code(fr({...hand('pinch',.3,.6),id:1},{...hand('pinch',.7,.6),id:2}),'both-pinch'),null);
 assert.equal(code(fr({...hand('open',.2,.6),id:1},{...hand('open',.8,.6),id:2}),'clap'),null);
});
test('the thumbs-up correction reads as a sentence the viewer can act on',()=>{
 assert.equal(diagnoseHands(fr(hand('fist',.5,.6)),'thumbUp',16/9)?.text,'That looks like a fist. Point your thumb up.');
 assert.equal(diagnoseHands(fr(hand('thumbUp',.5,.6)),'thumbDown',16/9)?.text,'That looks like a thumbs up. Point your thumb down.');
});
test('size is measured on the screen whatever the camera shape',()=>{
 for(const aspect of [.6,1,16/9])assert.ok(Math.abs(palmSize(hand("fist",.5,.6,.12,aspect),aspect)-.12*Math.hypot(.15,1))<1e-9,`aspect ${aspect}`);
});
test('the gate shows a problem only once it lasts, and clears it a moment after it ends',()=>{
 const g=new FeedbackGate(900,400),problem={code:'no-hand' as const,text:'x'};
 assert.equal(g.update(problem,0),null);assert.equal(g.update(problem,800),null);assert.equal(g.update(problem,950)?.text,'x');
 assert.equal(g.update(null,1000)?.text,'x','a frame without a problem does not clear it at once');
 assert.equal(g.update(problem,1100)?.text,'x');
 assert.equal(g.update(null,1200)?.text,'x');assert.equal(g.update(null,1700),null);
 const flicker=new FeedbackGate(900,400);
 for(let at=0;at<3000;at+=100)assert.equal(flicker.update(at%300===0?null:problem,at),null,'a problem that keeps dropping out never shows');
 const swap=new FeedbackGate(900,400);swap.update(problem,0);swap.update(problem,1000);
 assert.equal(swap.update({code:'far',text:'y'},1100)?.text,'x','a different problem waits its turn');assert.equal(swap.update({code:'far',text:'y'},2100)?.text,'y');
});

// ---- Effects against the real engines ----
const lookup=<E>(list:readonly MirrorWalkthroughStep<E>[],gesture:string)=>list.find(s=>s.gesture===gesture)!;
function handAt(id:number,pose:HandPose,x:number,y:number):TrackedHand{const p={x,y,z:0};return {id,side:'right',pose,landmarks:Array.from({length:21},()=>p),palm:p,indexTip:p,pinch:p,orientation:null,velocity:{x:0,y:0},poseAge:5};}
const flat=(p:MirrorPoint)=>({x:(p.x-.5)*10,y:(.5-p.y)*10,z:0});
function atpRig(){
 const world={partCount:22,mirrorToWorld:flat,partAt:()=>2,partInfo:(i:number)=>({id:'F',name:i===2?'ATP synthase subunit beta':'ATP synthase subunit c',component:'head' as const,residues:458}),headPoint:()=>({x:0,y:2,z:0})};
 const engine=new AtpEngine(world),view:MirrorViewState={q:[0,0,0,1],zoom:1,x:0,y:0};let at=1,out=engine.step({at:0,hands:[],events:[]},DT,view,false);
 engine.idle=true;
 const run=(seconds:number,at_:(t:number)=>TrackedHand[],events:GestureEvent[]=[])=>{for(let t=0;t<seconds;t+=DT){out=engine.step({at:at++,hands:at_(t),events:t===0?events:[]},DT,view,false);if(out.view)Object.assign(view,out.view);}};
 const probe=():MirrorProbe<AtpEngine>=>({engine,state:{tool:'view',phase:0,view,frozen:false},scene:out.scene as never});
 return {engine,view,run,probe};
}
type Rig=ReturnType<typeof atpRig>;
const checks=(r:Rig,gesture:string)=>{const s=lookup(atpWalkthrough,gesture);let before=s.snapshot?.(r.probe());return ()=>s.check!(r.probe(),before);};

test('at rest, no ATP effect check is already true',()=>{
 for(const s of atpWalkthrough.filter(s=>s.check)){const r=atpRig();r.run(1,()=>[]);assert.equal(checks(r,s.gesture)(),false,s.gesture);}
});
test('ATP: holding a fist still does not turn the molecule; moving it does',()=>{
 const still=atpRig(),a=checks(still,'fist');still.run(2,()=>[handAt(1,'fist',.5,.5)]);assert.equal(a(),false);
 const move=atpRig(),b=checks(move,'fist');move.run(1.5,t=>[handAt(1,'fist',.3+.2*t,.5)]);assert.equal(b(),true);
});
test('ATP: Part needs the palm over the molecule',()=>{
 const away=atpRig(),a=checks(away,'open');away.run(1,()=>[handAt(1,'open',.95,.5)]);assert.equal(a(),false);
 const over=atpRig(),b=checks(over,'open');over.run(1,()=>[handAt(1,'open',.5,.5)]);assert.equal(b(),true);
 const fist=atpRig(),c=checks(fist,'open');fist.run(1,()=>[handAt(1,'fist',.5,.5)]);assert.equal(c(),false,'the wrong pose in the right place');
});
test('ATP: Pluck needs the chain pulled out, not just a pinch',()=>{
 const still=atpRig(),a=checks(still,'pinch');still.run(1.5,()=>[handAt(1,'pinch',.5,.5)]);assert.equal(a(),false);
 const pull=atpRig(),b=checks(pull,'pinch');pull.run(1.5,t=>[handAt(1,'pinch',.5+.2*Math.min(t,1),.5)]);assert.equal(b(),true);
});
test('ATP: Stir needs a fingertip circling, not a pointing hand held still',()=>{
 const still=atpRig(),a=checks(still,'point');still.run(2,()=>[handAt(1,'point',.6,.5)]);assert.equal(a(),false);
 const small=atpRig(),s=checks(small,'point');small.run(2,t=>[handAt(1,'point',.5+.02*Math.cos(t*8),.5+.02*Math.sin(t*8))]);assert.equal(s(),false,'a tiny circle near the centre is ignored');
 const circle=atpRig(),b=checks(circle,'point');circle.run(2,t=>[handAt(1,'point',.5+.12*Math.cos(t*8),.5+.12*Math.sin(t*8))]);assert.equal(b(),true);
});
test('ATP: Slice, Make and Burn follow the rotor and the cut',()=>{
 const slice=atpRig(),a=checks(slice,'victory');slice.run(1,()=>[handAt(1,'victory',.5,.5)]);assert.equal(a(),true);
 const make=atpRig(),b=checks(make,'thumbUp');make.run(3,()=>[handAt(1,'thumbUp',.5,.5)]);assert.equal(b(),true);
 const makeWrong=atpRig(),c=checks(makeWrong,'thumbUp');makeWrong.run(3,()=>[handAt(1,'thumbDown',.5,.5)]);assert.equal(c(),false);
 const burn=atpRig(),d=checks(burn,'thumbDown');burn.run(3,()=>[handAt(1,'thumbDown',.5,.5)]);assert.equal(d(),true);
 const burnWrong=atpRig(),e=checks(burnWrong,'thumbDown');burnWrong.run(3,()=>[handAt(1,'thumbUp',.5,.5)]);assert.equal(e(),false);
});
test('ATP: Skin changes the look only when the sign is made, not while it is held from before',()=>{
 const r=atpRig();r.run(1,()=>[handAt(1,'love',.5,.5)],[{type:'pose',handId:1,pose:'love'}]);
 const check=checks(r,'love');r.run(1,()=>[handAt(1,'love',.5,.5)]);assert.equal(check(),false,'holding the sign that already changed it');
 r.run(.2,()=>[handAt(1,'fist',.5,.5)],[{type:'pose',handId:1,pose:'fist'}]);r.run(.2,()=>[handAt(1,'love',.5,.5)],[{type:'pose',handId:1,pose:'love'}]);assert.equal(check(),true);
});
test('ATP: Tear and Scale need the hands to move apart',()=>{
 const still=atpRig(),a=checks(still,'both-pinch');still.run(1.5,()=>[handAt(1,'pinch',.35,.5),handAt(2,'pinch',.65,.5)]);assert.equal(a(),false);
 const apart=atpRig(),b=checks(apart,'both-pinch');apart.run(1.5,t=>[handAt(1,'pinch',.35-.15*Math.min(t,1),.5),handAt(2,'pinch',.65+.15*Math.min(t,1),.5)]);assert.equal(b(),true);
 const hold=atpRig(),c=checks(hold,'both-fist');hold.run(1.5,()=>[handAt(1,'fist',.4,.5),handAt(2,'fist',.6,.5)]);assert.equal(c(),false);
 const zoom=atpRig(),d=checks(zoom,'both-fist');zoom.run(1.5,t=>[handAt(1,'fist',.4-.2*Math.min(t,1),.5),handAt(2,'fist',.6+.2*Math.min(t,1),.5)]);assert.equal(d(),true);
 const out=atpRig(),e=checks(out,'both-fist');out.run(1.5,t=>[handAt(1,'fist',.4+.08*Math.min(t,1),.5),handAt(2,'fist',.6-.08*Math.min(t,1),.5)]);assert.equal(e(),true,'bringing them together zooms out');
});

function atomRig(){
 const world={partCount:30,mirrorToWorld:flat,partAt:()=>-1};
 const engine=new AtomEngine(world),view:MirrorViewState={q:[0,0,0,1],zoom:1,x:0,y:0};let at=1,out=engine.step({at:0,hands:[],events:[]},DT,view,false);
 const run=(seconds:number,hands:(t:number)=>TrackedHand[])=>{for(let t=0;t<seconds;t+=DT){out=engine.step({at:at++,hands:hands(t),events:[]},DT,view,false);if(out.view)Object.assign(view,out.view);}};
 const check=(gesture:string)=>{const s=lookup(atomWalkthrough,gesture);return s.check!({engine,state:{tool:'view',phase:0,view,frozen:false},scene:out.scene as never},s.snapshot?.({engine,state:{tool:'view',phase:0,view:structuredClone(view),frozen:false},scene:out.scene as never}));};
 return {run,check};
}
test('Atom: the effects follow the electrons, not the hand shape',()=>{
 const rest=atomRig();rest.run(1,()=>[]);for(const s of atomWalkthrough.filter(s=>s.check))assert.equal(rest.check(s.gesture),false,s.gesture);
 const take=atomRig();take.run(1.5,()=>[handAt(1,'open',.7,.5)]);assert.equal(take.check('open'),true);
 const fist=atomRig();fist.run(1.5,()=>[handAt(1,'fist',.7,.5)]);assert.equal(fist.check('open'),false);
 const up=atomRig();up.run(2,()=>[handAt(1,'thumbUp',.5,.5)]);assert.equal(up.check('thumbUp'),true);assert.equal(up.check('thumbDown'),false);
 const down=atomRig();down.run(3,()=>[handAt(1,'thumbDown',.5,.5)]);assert.equal(down.check('thumbDown'),true);assert.equal(down.check('thumbUp'),false);
 const tear=atomRig();tear.run(1.5,t=>[handAt(1,'pinch',.35-.15*Math.min(t,1),.5),handAt(2,'pinch',.65+.15*Math.min(t,1),.5)]);assert.equal(tear.check('both-pinch'),true);
});

// ---- Contract and copy ----
test('every ATP and Atom guide gesture has a plain instruction and no brand names or em dashes',()=>{
 for(const list of [atpWalkthrough,atomWalkthrough])for(const s of list){
  assert.ok(s.howTo.length>20&&s.howTo.length<140,s.gesture);assert.ok(!/—|–/.test(s.howTo+(s.tip??'')),s.gesture);
  if(s.check)assert.ok(s.tip,`${s.gesture} has a tip for when the viewer is stuck`);
 }
 assert.deepEqual(atpWalkthrough.map(s=>s.gesture),['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-pinch','both-fist','clap']);
 assert.equal(Object.keys(gestureHelp).length,11);for(const h of Object.values(gestureHelp))assert.ok(!/—|–/.test(h.pose+h.what));
});
test('the tracker produces frames the feedback can read',()=>{
 const t=new GestureTracker(),pts=posedHand('fist').map(p=>({x:.5+p.x*.12,y:.6+p.y*.12*16/9,z:p.z*.12}));
 let f=t.update([pts],0,[],[],16/9);for(let at=50;at<400;at+=50)f=t.update([pts],at,[],[],16/9);
 assert.equal(f.hands[0].pose,'fist');assert.equal(diagnoseHands(f,'fist',16/9),null);assert.equal(diagnoseHands(f,'thumbUp',16/9)?.code,'looks-fist');
});
test('quaternion angle',()=>{assert.ok(Math.abs(quatAngle([0,0,0,1],[0,Math.sin(.25),0,Math.cos(.25)])-.5)<1e-9);});
