/** Lockstitch kinematics. One unwrapped crank angle (degrees, 0 = needle top dead centre) drives every part. */
export type Removable='takeUp'|'feedDog'|'bobbin';
export type StitchKind='formed'|'skipped'|'loose'|'stationary'|'single-thread';
export type FeedPhase='rise'|'forward'|'drop'|'return';
export type LoopStage='idle'|'thrown'|'carried'|'casting'|'pulling';
export interface MachineOptions {hookTimingOffset?:number;removed?:readonly Removable[]}
export interface Stitch {index:number;kind:StitchKind;x:number;locked:boolean}
export interface LoopPose {stage:LoopStage;open:number;apexDeg:number;pull:number}
export interface FeedPose {phase:FeedPhase;x:number;y:number}
export interface TakeUpPose {x:number;y:number;lift:number}
export interface MachinePose {crank:number;deg:number;cycle:number;needleTip:number;eye:number;rise:number;takeUp:TakeUpPose;hookDeg:number;feed:FeedPose;clothTravel:number;loop:LoopPose;caught:boolean;outcome:StitchKind}
export interface MachineState extends MachinePose {stitches:Stitch[]}

export const NEEDLE={crank:17,rod:52,tipAtBottom:-15.5,eyeAboveTip:2.5} as const;
export const PITCH=7;
/** Nominal crank angles: the hook meets the needle just after bottom dead centre, then the rest of the stitch follows. */
export const TIMING={catch:212,cast:312,pull:340,set:352,takeUpLow:270,takeUpTop:350,feedRise:300,feedForward:352,feedDrop:70,feedReturn:100} as const;
/** Needle rise above bottom dead centre over which a usable loop stands open. Below: no bulge yet. Above: drawn shut. */
export const LOOP_RISE={open:.8,close:4} as const;

const mod=(n:number,m:number)=>((n%m)+m)%m;
const rad=(d:number)=>d*Math.PI/180;
const clamp01=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>{const u=clamp01(n);return u*u*(3-2*u);};
const span=(v:number,a:number,b:number)=>(v-a)/(b-a);
const offsetOf=(o?:MachineOptions)=>o?.hookTimingOffset??0;
const without=(o:MachineOptions|undefined,part:Removable)=>!!o?.removed?.includes(part);

/** Slider-crank: needle tip height. A connecting rod gives the longer dwell at the bottom that a loop relies on. */
export function needleTip(crank:number):number {
 const {crank:r,rod:l,tipAtBottom}=NEEDLE,a=rad(crank),s=r*Math.sin(a);
 return r*Math.cos(a)+Math.sqrt(l*l-s*s)-(l-r)+tipAtBottom;
}
export const needleRise=(crank:number)=>needleTip(crank)-NEEDLE.tipAtBottom;

/** 0 at the low dwell, 1 at the top. A phase warp fits the rise into 80 degrees and the fall into 280. */
export function takeUpPhase(crank:number):number {
 const {takeUpLow:low,takeUpTop:top}=TIMING,d=mod(crank-low,360),rise=top-low;
 return d<rise?Math.PI*d/rise:Math.PI*(1+(d-rise)/(360-rise));
}
export function takeUp(crank:number):TakeUpPose {
 const psi=takeUpPhase(crank);
 return {x:5.5*Math.sin(psi),y:-Math.cos(psi)*8,lift:(1-Math.cos(psi))/2};
}
/** Lift per crank degree; positive while pulling thread, negative while releasing it. */
export const takeUpSpeed=(crank:number)=>(takeUp(crank+.05).lift-takeUp(crank-.05).lift)/.1;

/** Hook point angle: 0 at the needle, clockwise from there, turning twice per crank turn. */
export const hookAngle=(crank:number,offset=0)=>mod(2*(crank-TIMING.catch-offset),360);

/** How far a loop stands open at this crank angle, 0..1. */
export function loopOpen(crank:number):number {
 const d=mod(crank,360);
 if(d<=180)return 0;
 const rise=needleRise(d);
 return ease(rise/LOOP_RISE.open)*(1-ease(span(rise,LOOP_RISE.close,LOOP_RISE.close+3)));
}
/** The hook only enters the loop while the needle rise sits inside the loop window. */
export function catches(offset=0):boolean {
 const at=TIMING.catch+offset;
 if(at<=180||at>=300)return false;
 const rise=needleRise(at);
 return rise>=LOOP_RISE.open&&rise<=LOOP_RISE.close;
}
/** Timing offsets, in crank degrees, at the edges of the catch window. */
export function catchWindow():{early:number;late:number} {
 let early=0,late=0;
 while(catches(early-.25))early-=.25;
 while(catches(late+.25))late+=.25;
 return {early,late};
}

export function feedPose(crank:number):FeedPose {
 const {feedRise:r,feedForward:f,feedDrop:d,feedReturn:b}=TIMING,a=mod(crank,360),since=(from:number)=>mod(a-from,360);
 if(a>=r&&a<f)return {phase:'rise',x:0,y:ease(span(a,r,f))};
 if(a>=f||a<d)return {phase:'forward',x:ease(since(f)/mod(d-f,360)),y:1};
 if(a<b)return {phase:'drop',x:1,y:1-ease(span(a,d,b))};
 return {phase:'return',x:1-ease(span(a,b,r)),y:0};
}
/** Total cloth movement: one pitch per forward stroke, none without a feed dog. */
export function clothTravel(crank:number,options?:MachineOptions):number {
 if(without(options,'feedDog'))return 0;
 const u=crank-TIMING.feedForward,k=Math.floor(u/360),d=mod(TIMING.feedDrop-TIMING.feedForward,360);
 return PITCH*(k+ease((u-k*360)/d));
}

/** A miss outranks everything: with no loop there is nothing for a removed part to change. */
export function outcomeOf(options?:MachineOptions):StitchKind {
 if(!catches(offsetOf(options)))return 'skipped';
 if(without(options,'bobbin'))return 'single-thread';
 if(without(options,'takeUp'))return 'loose';
 if(without(options,'feedDog'))return 'stationary';
 return 'formed';
}
export function loopPose(crank:number,options?:MachineOptions):LoopPose {
 const a=mod(crank,360),at=TIMING.catch+offsetOf(options),{cast,pull,set}=TIMING,open=loopOpen(a),idle={stage:'idle',open:0,apexDeg:0,pull:0} as LoopPose;
 if(a<=180)return idle;
 if(!catches(offsetOf(options))||a<at)return open>0?{stage:'thrown',open,apexDeg:0,pull:0}:idle;
 if(a<cast)return {stage:'carried',open:1,apexDeg:2*(a-at),pull:0};
 const from=2*(cast-at);
 if(a<pull)return {stage:'casting',open:1,apexDeg:from+(352-from)*ease(span(a,cast,pull)),pull:0};
 if(a<set)return {stage:'pulling',open:1,apexDeg:352,pull:ease(span(a,pull,set))};
 return idle;
}
/** Every stitch set up to this crank angle. A stitch is settled when the take-up finishes pulling. */
export function stitchesUpTo(crank:number,options?:MachineOptions):Stitch[] {
 const kind=outcomeOf(options),locked=kind!=='skipped'&&kind!=='single-thread',count=Math.max(0,Math.floor((crank-TIMING.set)/360)+1),moves=!without(options,'feedDog');
 return Array.from({length:count},(_,index)=>({index,kind,x:moves?index*PITCH:0,locked}));
}
/** Every moving part at one crank angle. Cost does not grow with the crank, unlike the full stitch list. */
export function machinePose(crank:number,options?:MachineOptions):MachinePose {
 const offset=offsetOf(options),tip=needleTip(crank);
 return {crank,deg:mod(crank,360),cycle:Math.floor(crank/360),needleTip:tip,eye:tip+NEEDLE.eyeAboveTip,rise:tip-NEEDLE.tipAtBottom,takeUp:takeUp(crank),hookDeg:hookAngle(crank,offset),feed:feedPose(crank),clothTravel:clothTravel(crank,options),loop:loopPose(crank,options),caught:catches(offset),outcome:outcomeOf(options)};
}
export const machineState=(crank:number,options?:MachineOptions):MachineState=>({...machinePose(crank,options),stitches:stitchesUpTo(crank,options)});
