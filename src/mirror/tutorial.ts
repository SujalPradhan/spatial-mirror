import type {GestureFrame,HandPose} from './contracts';

const HOLD_MS=600,HINT_MS=8000,STORAGE_KEY='mirror-tutorial-v1';
export type TutorialPose=HandPose|'both-pinch'|'both-fist'|'clap';
export interface TutorialStep {id:string;glyph:string;label:string;pose:TutorialPose}
export interface TutorialOptions {holdMs?:number;hintMs?:number}
/** index===total and step===null once done. justCompleted is true only on the one update that finished a step. */
export interface TutorialView {index:number;total:number;step:TutorialStep|null;progress:number;hint:boolean;done:boolean;justCompleted:boolean;needsRelease:boolean}
export type TutorialStorage=Pick<Storage,'getItem'|'setItem'>;
export function tutorialCore(steps:TutorialStep[],native=false){return native?[]:['fist','open','pinch'].flatMap(id=>steps.filter(step=>step.id===id));}
const pairs:Partial<Record<TutorialPose,HandPose>>={'both-pinch':'pinch','both-fist':'fist'};
function matches(step:TutorialStep,frame:GestureFrame){
 if(step.pose==='clap')return frame.events.some(e=>e.type==='clap');
 const pose=pairs[step.pose]??step.pose as HandPose;
 return frame.hands.filter(h=>h.pose===pose).length>=(pairs[step.pose]?2:1);
}
/** Whether anything satisfying `held` also satisfies `next`. Only then can a held pose pass a step on its own, so a different or stricter pose never waits for a release. */
const implied=(held:TutorialStep,next:TutorialStep)=>held.pose===next.pose||pairs[held.pose]===next.pose;

export class Tutorial {
 private index=0;private hold:number|null=null;private best=0;private moved:number|null=null;private blocked:TutorialStep|null=null;private finished=false;
 private readonly holdMs:number;private readonly hintMs:number;
 constructor(private readonly steps:TutorialStep[],opts:TutorialOptions={}){this.holdMs=opts.holdMs??HOLD_MS;this.hintMs=opts.hintMs??HINT_MS;this.finished=!steps.length;}
 update(frame:GestureFrame,now:number):TutorialView {
  if(this.finished)return this.view(0,false,false);
  const step=this.steps[this.index];
  // The clock starts with the first frame, not at construction, so a slow camera start does not count as being stuck.
  this.moved??=now;
  if(this.blocked&&!matches(this.blocked,frame))this.blocked=null;
  if(!this.blocked&&matches(step,frame)){
   if(step.pose==='clap')return this.complete(now);
   this.hold??=now;
   const held=now-this.hold;if(held>=this.holdMs)return this.complete(now);
   if(held>this.best){this.best=held;this.moved=now;}
   return this.view(held/this.holdMs,now-this.moved>=this.hintMs,false);
  }
  this.hold=null;
  return this.view(0,now-this.moved>=this.hintMs,false);
 }
 skip(){this.index=this.steps.length;this.finished=true;}
 get current(){return this.view(0,false,false);}
 previous(){return this.navigate(-1);}
 next(){return this.navigate(1);}
 private navigate(direction:-1|1){
  const next=Math.max(0,Math.min(this.steps.length,this.index+direction));
  if(next===this.index)return this.current;
  this.index=next;this.finished=next===this.steps.length;this.blocked=this.steps[next]??null;
  this.hold=this.moved=null;this.best=0;
  return this.current;
 }
 restart(){this.index=0;this.finished=!this.steps.length;this.blocked=null;this.hold=this.moved=null;this.best=0;}
 private complete(now:number){
  const held=this.steps[this.index],next=this.steps[++this.index];
  this.hold=null;this.best=0;this.moved=now;
  if(next)this.blocked=implied(held,next)?held:null;else this.finished=true;
  return this.view(0,false,true);
 }
 private view(progress:number,hint:boolean,justCompleted:boolean):TutorialView {
  const total=this.steps.length,done=this.finished;
  return {index:done?total:this.index,total,step:done?null:this.steps[this.index],progress:done?1:progress,hint:hint&&!done,done,justCompleted,needsRelease:!done&&!!this.blocked};
 }
}
export function tutorialSeen(storage:TutorialStorage){try{return storage.getItem(STORAGE_KEY)!==null;}catch{return false;}}
export function markTutorialSeen(storage:TutorialStorage){try{storage.setItem(STORAGE_KEY,'1');}catch{/* Private modes refuse storage; the tutorial just shows again. */}}
