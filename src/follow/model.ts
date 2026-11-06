/**
 * Follow my hands, without a screen: poses in the grasp joint model, how close you are, the hold, and lessons.
 * Joints are the grasp 15, normalised 0 flat to 1 fist. A step may also fix the wrist: tilt (fingers leaning to the right on screen) and roll (palm turned about the fingers), radians.
 * Lessons are authored for a right hand; a left hand is shown the mirror, so its tilt is read with the sign flipped.
 */
import {JOINT_COUNT} from '../grasp/kinematics';
import {palmFrame,type P} from '../grasp/joints';
import type {HandSide} from '../mirror/contracts';

export interface Wrist {tilt:number;roll:number}
export interface Step {name:string;q:number[];wrist?:Wrist;
 /** Seconds the teacher takes to get here. */
 move?:number;
 /** The finger (1 index to 4 little) whose tip the thumb tip meets here: drawn as a contact line. */
 touch?:1|2|3|4}
export interface Lesson {id:string;title:string;blurb:string;steps:Step[];builtin?:boolean}
export interface Sample {t:number;q:number[];wrist?:Wrist}

/** Generous: about 30% of a joint's range. */
export const TOL=.32;
/** Radians; about 23°. */
export const WRIST_TOL=.4;
export const HOLD_S=.5;
/** A lapse shorter than this does not reset the hold; a lost hand gets longer. */
export const GRACE_S=.4;
export const LOST_GRACE_S=.9;
/** The DIP joints and the thumb tip are noisy on a webcam, so they are allowed more. */
const SLACK=[1,1.2,1.3, 1,1,1.7, 1,1,1.7, 1,1,1.7, 1,1,1.7];
export const MAX_RECORD_S=10;
export const PAUSE_S=.4;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export const FINGER_NAMES=['index','middle','ring','little'];

export interface Match {
 /** |difference| over what is allowed, per joint: above 1 is off. */
 ratio:number[];diff:number[];wrist:{tilt:number;roll:number}|null;ok:boolean;
 /** Mean absolute joint difference, normalised units. */
 err:number;worst:{kind:'joint';index:number}|{kind:'tilt'}|{kind:'roll'}|null}

/** Wrist of a landmark set in the page's mirrored image space (y down), or null. */
export function wristOf(h:P[]):Wrist|null{
 if(!h||h.length!==21)return null;
 const f=palmFrame(h);if(!(f.width>1e-6))return null;
 const tilt=Math.atan2(f.y[0],-f.y[1]),roll=Math.atan2(f.z[0],Math.abs(f.z[2]));
 return Number.isFinite(tilt)&&Number.isFinite(roll)?{tilt,roll}:null;
}
/** A measured wrist in the authored (right hand) frame. */
export const inAuthoredFrame=(w:Wrist,side:HandSide):Wrist=>side==='left'?{tilt:-w.tilt,roll:w.roll}:{...w};
/** How the wrist is drawn: the teacher of a left hand is a mirror image. */
export const displayWrist=(w:Wrist,side:HandSide):Wrist=>side==='left'?{tilt:-w.tilt,roll:-w.roll}:{...w};

export function compare(user:ArrayLike<number>,target:ArrayLike<number>,wrists?:{user:Wrist|null;target?:Wrist},tol=TOL):Match{
 const diff:number[]=[],ratio:number[]=[];let sum=0,worst=0,worstAt:Match['worst']=null;
 for(let i=0;i<JOINT_COUNT;i++){
  const d=user[i]-target[i],r=Math.abs(d)/(tol*SLACK[i]);diff.push(d);ratio.push(r);sum+=Math.abs(d)/SLACK[i];
  if(r>worst){worst=r;worstAt={kind:'joint',index:i};}
 }
 let wrist:Match['wrist']=null;
 if(wrists?.target){
  const u=wrists.user,t=wrists.target;
  // Roll is read by size: which way the forearm turns depends on the hand.
  wrist=u?{tilt:Math.abs(u.tilt-t.tilt)/WRIST_TOL,roll:Math.abs(Math.abs(u.roll)-Math.abs(t.roll))/WRIST_TOL}:{tilt:Infinity,roll:Infinity};
  if(wrist.tilt>worst){worst=wrist.tilt;worstAt={kind:'tilt'};}
  if(wrist.roll>worst){worst=wrist.roll;worstAt={kind:'roll'};}
 }
 return {ratio,diff,wrist,ok:worst<=1,err:sum/JOINT_COUNT,worst:worstAt};
}
/** 0..100: how close a held step was. */
export const closeness=(err:number)=>Math.round(100*clamp(1-err/(TOL*2),0,1));

/** A short, kind sentence about the most-missed part, or null when everything is in tolerance. */
export function hint(m:Match,user:ArrayLike<number>,target:ArrayLike<number>,uw:Wrist|null,tw:Wrist|undefined,side:HandSide):string|null{
 if(m.ok||!m.worst)return null;
 const w=m.worst;
 if(w.kind==='tilt'&&uw&&tw)return `Tilt your wrist more to the ${(tw.tilt-uw.tilt)*(side==='left'?-1:1)>0?'right':'left'}`;
 if(w.kind==='roll'&&uw&&tw)return Math.abs(uw.roll)<Math.abs(tw.roll)?'Twist your wrist more':'Twist your wrist back a little';
 if(w.kind!=='joint')return 'Show your hand to the camera';
 const i=w.index,d=i<3?0:Math.floor(i/3),more=user[i]<target[i];
 if(d===0)return i===0?(more?'Swing your thumb across your palm':'Swing your thumb back out'):(more?'Bend your thumb more':'Straighten your thumb a little');
 const n=FINGER_NAMES[d-1];return more?`Bend your ${n} finger more`:`Straighten your ${n} finger a bit`;
}

/** Hold a match for HOLD_S. A lapse shorter than the grace keeps the time so far; a longer one starts over. */
export class Hold {
 seconds=0;private lapse=0;
 reset(){this.seconds=0;this.lapse=0;}
 get fill(){return clamp(this.seconds/HOLD_S,0,1);}
 update(dt:number,matched:boolean,lost=false){
  if(matched){this.seconds+=dt;this.lapse=0;}
  else{this.lapse+=dt;if(this.lapse>(lost?LOST_GRACE_S:GRACE_S))this.seconds=0;}
  return this.seconds>=HOLD_S-1e-9;
 }
}

export const OPEN:Step={name:'Open hand',q:new Array(JOINT_COUNT).fill(0)};
const smooth=(t:number)=>t*t*(3-2*t);
/** The teacher between two steps, t in 0..1. A missing wrist is a neutral one. */
export function blend(a:Step,b:Step,t:number):{q:number[];wrist:Wrist}{
 const s=smooth(clamp(t,0,1)),wa=a.wrist??{tilt:0,roll:0},wb=b.wrist??{tilt:0,roll:0};
 return {q:a.q.map((x,i)=>x+(b.q[i]-x)*s),wrist:{tilt:wa.tilt+(wb.tilt-wa.tilt)*s,roll:wa.roll+(wb.roll-wa.roll)*s}};
}

// ---- Recording ----
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
export interface SplitOptions {pause?:number;speed?:number;merge?:number;window?:number}
/**
 * Splits a recording into steps at pauses: wherever the hand moves slower than `speed` (mean joint change per second) for `pause` seconds
 * (a 0.4 s pause reads as about 0.3 s once the joint smoothing's lag is taken off),
 * the pose held there becomes a step. Pauses on nearly the same pose merge; a recording that ends moving ends on its last pose.
 * Returns [] when fewer than two distinct poses were held.
 */
export function splitSteps(samples:Sample[],{pause=PAUSE_S-.1,speed=.1,merge=.12,window=.1}:SplitOptions={}):Step[]{
 const n=samples.length;if(n<4)return [];
 const vel=samples.map((s,i)=>{
  let a=i,b=i;while(a>0&&s.t-samples[a].t<window)a--;while(b<n-1&&samples[b].t-s.t<window)b++;
  const dt=samples[b].t-samples[a].t;if(dt<=0)return 0;
  let d=0;for(let j=0;j<JOINT_COUNT;j++)d+=Math.abs(samples[b].q[j]-samples[a].q[j]);
  const wa=samples[a].wrist,wb=samples[b].wrist;if(wa&&wb)d+=3*(Math.abs(wb.tilt-wa.tilt)+Math.abs(wb.roll-wa.roll));
  return d/JOINT_COUNT/dt;
 });
 const runs:{a:number;b:number}[]=[];
 for(let i=0;i<n;){
  if(vel[i]>=speed){i++;continue;}
  let j=i;while(j+1<n&&vel[j+1]<speed)j++;
  if(samples[j].t-samples[i].t>=pause)runs.push({a:i,b:j});
  i=j+1;
 }
 const key=(a:number,b:number):Step=>{
  const part=samples.slice(a,b+1),q=Array.from({length:JOINT_COUNT},(_,j)=>median(part.map(s=>s.q[j])));
  const ws=part.filter(s=>s.wrist);
  return {name:'',q,wrist:ws.length>part.length/2?{tilt:median(ws.map(s=>s.wrist!.tilt)),roll:median(ws.map(s=>s.wrist!.roll))}:undefined};
 };
 const keys=runs.map(r=>({...key(r.a,r.b),from:samples[r.a].t,to:samples[r.b].t}));
 if(runs.length&&runs[runs.length-1].b<n-1&&samples[n-1].t-samples[runs[runs.length-1].b].t>.15)keys.push({...key(n-1,n-1),from:samples[n-1].t,to:samples[n-1].t});
 const out:(Step&{from:number;to:number})[]=[];
 for(const k of keys){
  const last=out[out.length-1];
  if(last&&Math.max(...k.q.map((x,i)=>Math.abs(x-last.q[i])))<merge&&(!k.wrist||!last.wrist||Math.abs(k.wrist.tilt-last.wrist.tilt)<WRIST_TOL/2))continue;
  out.push(k);
 }
 if(out.length<2)return [];
 return out.map((k,i)=>({name:`Pose ${i+1}`,q:k.q.map(x=>+clamp(x,0,1).toFixed(3)),wrist:k.wrist?{tilt:+k.wrist.tilt.toFixed(3),roll:+k.wrist.roll.toFixed(3)}:undefined,move:+clamp(i?k.from-out[i-1].to:.8,.5,2.5).toFixed(2)}));
}

// ---- Lessons as JSON ----
const finite=(x:unknown,a:number,b:number):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=a&&x<=b;
const text=(x:unknown,max:number,fallback:string)=>typeof x==='string'&&x.trim()?x.trim().slice(0,max):fallback;
/** A fresh, allow-listed lesson, or a thrown Error. */
export function validateLesson(value:unknown):Lesson{
 const v=(value as {lesson?:unknown})?.lesson??value;
 if(typeof v!=='object'||v===null||Array.isArray(v))throw Error('Not a lesson.');
 const r=v as Record<string,unknown>,steps=r.steps;
 if(!Array.isArray(steps)||steps.length<2||steps.length>40)throw Error('A lesson needs 2 to 40 steps.');
 return {id:text(r.id,24,'mine').replace(/[^\w-]/g,'')||'mine',title:text(r.title,60,'Your move'),blurb:text(r.blurb,160,''),steps:steps.map((s,i)=>{
  const o=s as Record<string,unknown>;
  if(!o||!Array.isArray(o.q)||o.q.length!==JOINT_COUNT||!o.q.every(x=>finite(x,0,1)))throw Error(`Step ${i+1} needs ${JOINT_COUNT} joints between 0 and 1.`);
  const w=o.wrist as Record<string,unknown>|undefined;
  if(w!==undefined&&!(w&&finite(w.tilt,-1.6,1.6)&&finite(w.roll,-1.6,1.6)))throw Error(`Step ${i+1} has a bad wrist.`);
  return {name:text(o.name,60,`Pose ${i+1}`),q:[...o.q as number[]],wrist:w?{tilt:w.tilt as number,roll:w.roll as number}:undefined,move:finite(o.move,.3,5)?o.move:1,touch:[1,2,3,4].includes(o.touch as number)?o.touch as 1|2|3|4:undefined};
 })};
}
export const exportLesson=(l:Lesson)=>JSON.stringify({format:'follow-lesson',version:1,lesson:{id:l.id,title:l.title,blurb:l.blurb,steps:l.steps}},null,1);
export const parseLesson=(json:string)=>validateLesson(JSON.parse(json));
