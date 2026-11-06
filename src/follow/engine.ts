/**
 * The follow loop: your hand's 15 joints (and wrist) against a teacher that holds each step until you match it, then plays on to the next.
 * Nothing here reads gestures except the clap, which repeats the step: the hands are the content.
 */
import type {GestureFrame,MirrorDriver,MirrorViewState,TrackedHand,HandSide} from '../mirror/contracts';
import {JOINT_COUNT,forward} from '../grasp/kinematics';
import {JointReader,defaultCalibration,normalise,validCalibration,type Calibration} from '../grasp/joints';
import {CALIBRATION_KEY} from '../grasp/engine';

import type {Coupling} from '../grasp/synergy';
import {LESSONS} from './lessons';
import {MAX_RECORD_S,OPEN,Hold,blend,closeness,compare,exportLesson,hint,inAuthoredFrame,parseLesson,splitSteps,validateLesson,wristOf,type Lesson,type Match,type Sample,type Step,type Wrist} from './model';
import type {FollowInfo,FollowMode,FollowOutput,FollowScene,FollowSound,StepResult} from './contracts';

export const LESSONS_KEY='follow-lessons-v1';
const DEMO_WAIT_S=1.1,SEEN_S=.5,GONE_S=8,HINT_AFTER_S=1.2,PRESENT_S=.3;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
interface Store {getItem(k:string):string|null;setItem(k:string,v:string):void}
const memory=():Store=>{const m=new Map<string,string>();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>{m.set(k,v);}};};
const NONE:Coupling={k:0 as never,motors:[],offset:[],driven:[],title:'',blurb:''};
const VERDICT={score:0,stable:false,held:false,contacts:0,oppose:0,balance:0,support:0,kind:null,forces:[],weight:0,capacity:0,reason:''};

export class FollowEngine implements MirrorDriver<FollowOutput> {
 idle=false;readonly position=0;readonly speed=0;
 mode:FollowMode='demo';lessons:Lesson[];lessonId='thumb';index=0;
 private store:Store;private calibration:Calibration;private reader=new JointReader();private handId:number|null=null;
 private clock=0;private lastFrame=NaN;private lastHandAt=-Infinity;private presentFor=0;private goneFor=0;
 private you=new Array(JOINT_COUNT).fill(0);private youWrist:Wrist|null=null;side:HandSide='right';
 private from:Step=OPEN;private shown:Step=OPEN;private moveT=0;private moveDur=1;private waited=0;
 private hold=new Hold();private stepTime=0;private errSum=0;private errTime=0;private missFor=0;
 private hintText:string|null=null;private hintAt=-Infinity;private match:Match|null=null;
 results:StepResult[]=[];
 private countdown=0;private recordT=0;private samples:Sample[]=[];private sampleAt=0;
 private mine:Lesson|null=null;private previous:Lesson|null=null;
 private sounds:FollowSound[]=[];private noteText:{text:string;at:number}|null=null;
 constructor(store?:Store){
  this.store=store??(typeof localStorage==='undefined'?memory():localStorage);
  let saved:Calibration|null=null;try{saved=validCalibration(JSON.parse(this.store.getItem(CALIBRATION_KEY)??'null'));}catch{saved=null;}
  this.calibration=saved??defaultCalibration();
  try{const s=JSON.parse(this.store.getItem(LESSONS_KEY)??'null');if(s?.mine)this.mine=validateLesson(s.mine);if(s?.previous)this.previous=validateLesson(s.previous);}catch{this.mine=this.previous=null;}
  this.lessons=[...LESSONS.map(l=>({...l})),...(this.mine?[this.mine]:[])];
 }
 get lesson(){return this.lessons.find(l=>l.id===this.lessonId)??this.lessons[0];}
 get steps(){return this.lesson.steps;}
 get present(){return this.clock-this.lastHandAt<PRESENT_S;}
 get mirrored(){return this.side==='left';}
 // The shell's pointer and motion hooks: the mouse has no part here.
 seek(){}kick(){}
 pointerDown(){return false;}pointerMove(){}pointerUp(){}hover(){}
 reset(){this.restart(true);}
 private say(text:string){this.noteText={text,at:this.clock};}
 private save(){try{this.store.setItem(LESSONS_KEY,JSON.stringify({mine:this.mine,previous:this.previous}));}catch{/* Private modes refuse storage; the lesson lasts the visit. */}}
 private rebuild(){this.lessons=[...LESSONS.map(l=>({...l})),...(this.mine?[this.mine]:[])];}

 select(id:string){
  if(!this.lessons.some(l=>l.id===id)||this.mode==='record'||this.mode==='countdown')return;
  this.lessonId=id;this.restart(true);
 }
 /** From step one, the teacher moving on from where it stands. In demo it goes on by itself until a hand is in view. */
 restart(demo:boolean){
  this.mode=demo?'demo':'follow';this.results=[];this.goTo(0,this.shown);this.sounds.push({type:'go'});
 }
 private goTo(index:number,from:Step){
  this.index=index;this.from=from;this.moveT=0;this.moveDur=this.steps[index].move??1;this.waited=0;
  this.hold.reset();this.stepTime=0;this.errSum=this.errTime=this.missFor=0;this.hintText=null;this.match=null;
 }
 private get target():Step{return this.steps[this.index];}
 private get arrived(){return this.moveT>=this.moveDur;}
 /** Clap: the teacher shows this step again. */
 repeat(){
  if(this.mode==='done'){this.restart(false);return;}
  if(this.mode==='demo'){this.restart(true);return;}
  if(this.mode!=='follow')return;
  this.goTo(this.index,this.index?this.steps[this.index-1]:OPEN);
 }
 skip(){
  if(this.mode!=='follow'||!this.arrived)return;
  this.finishStep(true);
 }
 private finishStep(skipped:boolean){
  this.results[this.index]={score:skipped||!this.errTime?0:closeness(this.errSum/this.errTime),seconds:+this.stepTime.toFixed(2),skipped};
  if(this.index+1<this.steps.length){this.sounds.push({type:'step'});this.goTo(this.index+1,this.target);}
  else{this.mode='done';this.sounds.push({type:'done'});}
 }

 // ---- Recording ----
 toggleRecord(){
  if(this.mode==='countdown'||this.mode==='record'){
   if(this.mode==='record')this.finishRecord();else{this.say('Recording cancelled.');this.restart(true);}
   return;
  }
  this.mode='countdown';this.countdown=3;this.samples=[];this.recordT=0;this.sounds.push({type:'tick'});
  this.say(this.present?'Get ready: do your move, pausing between steps.':'Show your hand: the recording starts after the count.');
 }
 private finishRecord(){
  const steps=splitSteps(this.samples);
  if(steps.length<2){this.say('No steps found. Pause for half a second between poses.');this.restart(true);return;}
  this.previous=this.mine;
  this.mine={id:'mine',title:'Your move',blurb:`${steps.length} steps from your recording.`,steps};
  this.save();this.rebuild();this.lessonId='mine';this.say(`Saved ${steps.length} steps as Your move.`);
  this.restart(true);
 }
 undoRecording(){
  if(!this.mine&&!this.previous)return;
  this.mine=this.previous;this.previous=null;this.save();this.rebuild();
  if(!this.mine&&this.lessonId==='mine')this.lessonId='thumb';
  this.say(this.mine?'Back to your earlier recording.':'Recording removed.');this.restart(true);
 }
 get canUndo(){return !!this.mine&&this.mode!=='record'&&this.mode!=='countdown';}
 exportMine(){return this.mine?exportLesson(this.mine):exportLesson(this.lesson);}
 importLesson(json:string){
  try{
   const l=parseLesson(json);this.previous=this.mine;this.mine={...l,id:'mine',builtin:undefined};this.save();this.rebuild();this.lessonId='mine';
   this.say(`Imported ${l.title}, ${l.steps.length} steps.`);this.restart(true);return true;
  }catch(e){this.say(`Could not import: ${(e as Error).message}`);return false;}
 }

 // ---- The hand ----
 private driver(frame:GestureFrame):TrackedHand|null{
  const hands=frame.hands.filter(h=>h.shape&&h.landmarks.length===21);if(!hands.length)return null;
  return hands.find(h=>h.id===this.handId)??[...hands].sort((a,b)=>a.id-b.id)[0];
 }
 private readHand(frame:GestureFrame,h:number){
  const hand=this.driver(frame);if(!hand?.shape)return;
  if(this.handId!==hand.id){this.reader.reset();this.handId=hand.id;this.youWrist=null;}
  const read=this.reader.read(hand.shape.points,frame.at);if(!read)return;
  this.lastHandAt=this.clock;this.you=normalise(read.smooth,this.calibration);
  if(hand.side!=='unknown')this.side=hand.side;
  const w=wristOf(hand.shape.points);
  if(w){const a=1-Math.exp(-Math.max(h,.016)/.07);this.youWrist=this.youWrist?{tilt:this.youWrist.tilt+(w.tilt-this.youWrist.tilt)*a,roll:this.youWrist.roll+(w.roll-this.youWrist.roll)*a}:w;}
 }

 step(frame:GestureFrame,dt:number,_view:MirrorViewState,_frozen:boolean):FollowOutput{
  const h=Number.isFinite(dt)?clamp(dt,0,.05):0;this.clock+=h;
  if(frame.at!==this.lastFrame){this.lastFrame=frame.at;this.readHand(frame,h);for(const e of frame.events)if(e.type==='clap')this.repeat();}
  const present=this.present;
  if(!present)this.you=this.you.map(x=>x*(1-Math.min(1,h*3)));
  this.presentFor=present?this.presentFor+h:0;this.goneFor=present?0:this.goneFor+h;
  this.advance(h,present);
  return this.output();
 }
 private teacher(){const t=this.target;return this.arrived?{q:t.q,wrist:t.wrist??{tilt:0,roll:0}}:blend(this.from,t,this.moveT/this.moveDur);}
 private advance(h:number,present:boolean){
  if(this.mode==='countdown'){
   const before=Math.ceil(this.countdown);this.countdown-=h;
   if(Math.ceil(this.countdown)!==before&&this.countdown>0)this.sounds.push({type:'tick'});
   if(this.countdown<=0){this.mode='record';this.recordT=0;this.sampleAt=0;this.samples=[];this.sounds.push({type:'go'});}
   return;
  }
  if(this.mode==='record'){
   this.recordT+=h;this.sampleAt-=h;
   if(present&&this.sampleAt<=0){this.sampleAt=1/30;this.samples.push({t:this.recordT,q:[...this.you],wrist:this.youWrist?inAuthoredFrame(this.youWrist,this.side):undefined});}
   if(this.recordT>=MAX_RECORD_S)this.finishRecord();
   return;
  }
  if(this.mode==='done')return;
  this.moveT=Math.min(this.moveDur,this.moveT+h);
  if(this.mode==='demo'){
   if(this.presentFor>=SEEN_S){this.restart(false);return;}
   if(this.arrived){this.waited+=h;if(this.waited>=DEMO_WAIT_S)this.goTo(this.index+1<this.steps.length?this.index+1:0,this.target);}
   return;
  }
  // follow
  if(this.goneFor>GONE_S){this.mode='demo';this.say('No hand in view. The teacher plays on its own.');this.restart(true);return;}
  if(!this.arrived){this.match=null;return;}
  this.stepTime+=h;
  const t=this.target,uw=this.youWrist&&present?inAuthoredFrame(this.youWrist,this.side):null;
  const m=present?compare(this.you,t.q,{user:uw,target:t.wrist}):null;this.match=m;
  const ok=!!m?.ok;
  if(ok){this.errSum+=m!.err*h;this.errTime+=h;this.missFor=0;}else if(present)this.missFor+=h;
  if(this.hold.update(h,ok,!present))this.finishStep(false);
  else if(m&&this.missFor>HINT_AFTER_S&&this.clock-this.hintAt>.6){this.hintAt=this.clock;this.hintText=hint(m,this.you,t.q,uw,t.wrist,this.side);}
  if(ok)this.hintText=null;
 }

 private output():FollowOutput{
  const tp=this.mode==='record'||this.mode==='countdown'?{q:this.you,wrist:this.youWrist?inAuthoredFrame(this.youWrist,this.side):{tilt:0,roll:0}}:this.teacher();
  const m=this.match,live=this.mode==='follow'&&this.arrived&&this.present;
  const residual=this.you.map((_,i)=>live&&m?Math.sign(m.diff[i])*m.ratio[i]*.17:0);
  const youW=this.youWrist?inAuthoredFrame(this.youWrist,this.side):{tilt:0,roll:0};
  const q=this.you;this.shown={name:'',q:[...tp.q],wrist:tp.wrist};
  const sim={q:[...q],free:[...q],links:forward(q,false),motors:[],blocked:new Array(JOINT_COUNT).fill(false),stops:new Array(JOINT_COUNT).fill(null),contacts:[],surplus:new Array(JOINT_COUNT).fill(0)};
  const follow:FollowInfo={
   mode:this.mode,lessons:this.lessons.map(l=>({id:l.id,title:l.title,blurb:l.blurb})),lessonId:this.lessonId,steps:this.steps.map(s=>s.name),index:this.index,name:this.target.name,touch:this.mode==='follow'||this.mode==='demo'?this.target.touch??null:null,
   waiting:this.mode==='follow'&&this.arrived,arrived:this.arrived,hold:this.hold.fill,matched:!!m?.ok,hint:this.hintText,ratio:m?[...m.ratio]:new Array(JOINT_COUNT).fill(0),wristRatio:m?.wrist??null,
   results:this.results.map(r=>({...r})),matchedSteps:this.results.filter(r=>r&&!r.skipped).length,
   hand:this.present,side:this.side,mirrored:this.mirrored,teacherWrist:tp.wrist,youWrist:youW,
   countdown:this.mode==='countdown'?Math.max(1,Math.ceil(this.countdown)):null,recordSeconds:this.mode==='record'?this.recordT:null,canUndo:this.canUndo,hasMine:!!this.mine,
   note:this.noteText&&this.clock-this.noteText.at<5?this.noteText.text:null,
  };
  const scene:FollowScene={
   coupling:NONE,object:'mug',user:[...tp.q],spread:[0,0,0,0],command:[],free:[...q],residual,sim:sim as never,verdict:VERDICT as never,lift:1,
   source:this.present?'hand':'rest',preset:null,thumbUncertain:false,calibration:{phase:null,progress:0,doneFor:Infinity},
   explained:{1:1,2:1,3:1,5:1},samples:0,taxonomy:{},best:{},inspect:1,charging:null,note:null,follow,
  };
  const sounds=this.sounds;this.sounds=[];
  return {scene,view:null,sounds,holding:false};
 }
}
