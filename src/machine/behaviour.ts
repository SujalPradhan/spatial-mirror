import {ease} from '../mirror/engine';
import type {MirrorBehaviour,MirrorContext} from '../mirror/contracts';
import {clothTravel,machinePose,outcomeOf,TIMING,type Stitch} from './model';
import {bodyParts,followers} from './parts';
import type {MachineScene,MachineSceneExtra,MachineSkin,MachineSound,MachineWorld,Removable} from './contracts';

const REV=360,IDLE=.16*REV,IDLE_TAU=.6,MOTOR=1.1*REV,MOTOR_TAU=.35,CAP=2.5*REV,FRICTION_TAU=.77,REST=2,KICK=.75*REV,KICK_CAP=1.5*REV;
/** One finger circle is one stitch: the wheel follows the finger directly, with no flywheel in the way. */
const STIR_LET_GO=.25;
export const STITCH_CAP=24;
const PULL_OUT=.9,CLOSE_TAU=.55,PARTED=.7,PARTED_TAU=.22;
/** Zoom past the first closes in on the plate, back past the second returns to the whole machine. */
export const CLOSE_AT=1.35,WHOLE_AT=.85;
const CLOSE_SCALE=3.15,PUSH=.32,INTRO=1.4,REDUCED_START=1;
const WHOLE_FOCUS=[64,46,0],CLOSE_FOCUS=[0,-17,0],LOOP_FOCUS=[-2,-11,-1];
export const TIMING_STEPS=[{offset:0,label:'on time'},{offset:30,label:'30° late'},{offset:-25,label:'25° early'}] as const;
const beats:Record<string,string>={thrown:'The needle rises and the slack thread bulges into a loop',carried:'The hook point enters the loop and carries it round the bobbin case',casting:'The take-up pulls the loop off the back of the case',pulling:'The lock is drawn up into the cloth'};
const faults:Record<string,string>={
 skipped:'',
 loose:'No take-up lever: nothing pulls the lock tight, so loops hang under the cloth',
 stationary:'No feed dog: the cloth stays put and stitches pile into one hole',
 'single-thread':'No bobbin: the loop has nothing to lock around and pulls straight back out',
};
const smooth=(n:number)=>{const u=Math.max(0,Math.min(1,n));return u*u*(3-2*u);};
const mix=(a:number,b:number,u:number)=>a+(b-a)*u;
const mod=(n:number,m:number)=>((n%m)+m)%m;
/** 0 away from the first loop throw, 1 across it. */
export const throwBeat=(deg:number)=>smooth((deg-186)/18)*(1-smooth((deg-232)/34));
type Context=MirrorContext<MachineSkin,MachineSceneExtra,MachineSound>;

/** The crank, the stitch record and the framing. The model is pure, so everything that depends on history lives here. */
export class MachineBehaviour implements MirrorBehaviour<MachineSkin,MachineSceneExtra,MachineSound> {
 crank=0;omega=0;idle=false;removed:Removable[]=[];timing=0;stitches:Stitch[]=[];count=0;close=false;travel=clothTravel(0);caption='';
 private driving=0;private started=false;private mark=0;private lastCrank=0;private stirring=0;private index=0;private intro=INTRO;private u=0;private lastZoom=NaN;private parted=0;
 private removable=new Map<number,Removable>();private ids:string[]=[];
 constructor(private world:MachineWorld){}
 get timingOffset(){return TIMING_STEPS[this.timing].offset;}
 get options(){return {hookTimingOffset:this.timingOffset,removed:this.removed};}
 initialScene():MachineSceneExtra{return {machine:{...machinePose(0),stitches:this.stitches},options:{hookTimingOffset:0,removed:[]},close:0,scale:1,focus:[...WHOLE_FOCUS] as [number,number,number],parted:0,hidden:new Set(),fade:{}};}
 fit(n:number){
  this.removable.clear();this.ids=[];
  for(let i=0;i<n;i++){const p=this.world.partInfo(i);this.ids[i]=p.id;if(p.removable)this.removable.set(i,p.id as Removable);}
 }
 describe(i:number){const p=this.world.partInfo(i);return {title:p.title,detail:p.removable?`${p.role}. Pull it out to see why it is there`:p.role};}
 drive(direction:number){this.driving=direction;}
 stir(speed:number,elapsed:number){this.crank+=speed*elapsed*180/Math.PI;this.omega=0;this.stirring=STIR_LET_GO;}
 advance(h:number,c:Context){
  this.started=true;this.framing(h,c);this.spin(h,c);this.tally(c);
  if(this.intro>0){this.intro-=h;if(this.intro<=0)this.close=true;}
 }
 settle(h:number,c:Context){
  const s=c.scene;
  for(const [i,id] of this.removable){
   if(this.removed.includes(id)||s.partGlow[i]<1)continue;
   if(Math.hypot(s.partOffsets[i*3],s.partOffsets[i*3+1],s.partOffsets[i*3+2])>PULL_OUT)this.remove(id,c);
  }
  let open=0;for(const f of s.fields)open=Math.max(open,f.strength);
  this.parted+=(open*PARTED-this.parted)*ease(Math.max(h,1e-6),PARTED_TAU);
 }
 publish(c:Context){
  const s=c.scene,o=s.options,m=s.machine,beat=throwBeat(mod(this.crank,REV))*(1-smooth(Math.abs(this.omega)/(.6*REV)));
  o.hookTimingOffset=this.timingOffset;o.removed=this.removed;
  Object.assign(m,machinePose(this.crank,o));m.clothTravel=this.travel;m.stitches=this.stitches;
  const u=this.u,push=beat*u;
  s.close=u;s.parted=this.parted;s.scale=mix(1,CLOSE_SCALE,u*u*(3-2*u))*(1+PUSH*push);
  for(let i=0;i<3;i++)s.focus[i]=mix(mix(WHOLE_FOCUS[i],CLOSE_FOCUS[i],u),LOOP_FOCUS[i],push*.8);
  const fade=1-smooth((u-.08)/.5);s.hidden.clear();
  for(const id of this.removed)s.hidden.add(id);
  for(const [id,leader] of Object.entries(followers))if(s.hidden.has(leader))s.hidden.add(id);
  for(const id of bodyParts){s.fade[id]=fade;if(fade<=0)s.hidden.add(id);}
  this.caption=this.describeNow(m.loop.stage,m.feed.phase);
  c.sound({type:'motor',speed:this.quiet?0:this.omega/REV});
 }
 reset(s:MachineScene){
  this.travel=clothTravel(0);this.crank=this.omega=this.driving=this.mark=this.lastCrank=this.count=this.index=this.stirring=this.parted=this.u=this.timing=0;
  this.removed=[];this.stitches=[];this.started=false;this.close=false;this.intro=INTRO;this.lastZoom=NaN;s.hidden.clear();
 }
 /** Saved phases are 0..360 and the crank is unbounded, so a scrub takes the shortest arc and the stitch tally stays honest; before the first step it restores silently. */
 seek(n:number){
  if(!Number.isFinite(n))return;
  this.omega=0;
  if(!this.started){this.crank=this.lastCrank=n;this.mark=this.markAt(n);this.travel=clothTravel(n);return;}
  this.crank+=mod(n-this.crank+180,REV)-180;
 }
 kick(direction:1|-1){
  const next=this.omega+direction*KICK;
  this.omega=direction>0?Math.max(this.omega,Math.min(next,KICK_CAP)):Math.min(this.omega,Math.max(next,-KICK_CAP));
 }
 remove(id:Removable,c?:Context){
  if(this.removed.includes(id))return;
  this.removed=[...this.removed,id];this.close=true;this.intro=0;c?.sound({type:'fault'});
 }
 /** Puts every part back and retimes the hook. Stitches already sewn stay in the cloth. */
 restore(){this.removed=[];this.timing=0;this.close=true;this.intro=0;}
 cycleTiming(){this.timing=(this.timing+1)%TIMING_STEPS.length;this.intro=0;this.close=true;return TIMING_STEPS[this.timing];}
 setClose(on:boolean){this.close=on;this.intro=0;}

 private get quiet(){return this.idle&&!this.driving&&this.omega>=0&&this.omega<IDLE*1.25;}
 private describeNow(stage:string,feed:string){
  const kind=outcomeOf(this.options);
  if(kind==='skipped'){const o=this.timingOffset;return o>0?`Hook ${o}° late: the loop has drawn shut before the point arrives, so the stitch skips`:`Hook ${-o}° early: the point passes before the loop has opened, so the stitch skips`;}
  if(faults[kind])return faults[kind];
  if(this.u<.5)return '';
  return beats[stage]??(feed==='forward'?'The feed dog walks the cloth one stitch':'');
 }
 private framing(h:number,c:Context){
  const zoom=c.view.zoom,last=this.lastZoom;this.lastZoom=zoom;
  if(last<CLOSE_AT&&zoom>=CLOSE_AT)this.setClose(true);
  else if(last>WHOLE_AT&&zoom<=WHOLE_AT)this.setClose(false);
  // With motion reduced there is no opening move: the page simply starts on the close-up.
  if(!this.idle&&this.intro===INTRO&&Number.isNaN(last)){this.intro=0;this.close=true;this.u=REDUCED_START;}
  this.u+=(+this.close-this.u)*ease(Math.max(h,1e-6),CLOSE_TAU);
  if(Math.abs(+this.close-this.u)<.002)this.u=+this.close;
 }
 private spin(h:number,c:Context){
  this.stirring=Math.max(0,this.stirring-h);
  const motor=this.driving*MOTOR,idle=this.idle&&!c.frozen&&!this.driving&&!this.stirring;
  if(this.driving&&this.omega*this.driving<MOTOR)this.omega+=(motor-this.omega)*ease(h,MOTOR_TAU);
  else if(idle&&this.omega<IDLE)this.omega+=(IDLE-this.omega)*ease(h,IDLE_TAU);
  else if(h>0)this.omega=idle?IDLE+(this.omega-IDLE)*Math.exp(-h/FRICTION_TAU):this.omega*Math.exp(-h/FRICTION_TAU);
  this.omega=Math.max(-CAP,Math.min(CAP,this.omega));
  if(!this.driving&&!idle&&Math.abs(this.omega)<REST)this.omega=0;
  // The idle motor lingers on the loop throw: it is over in a blink at any steady speed.
  const linger=idle?1-.72*throwBeat(mod(this.crank,REV)):1;
  this.crank+=this.omega*h*linger;
 }
 private markAt(crank:number){return Math.floor((crank-TIMING.set)/REV)+1;}
 /** The model recomputes every stitch from today's options, so a record is kept here: a part pulled out changes only the stitches after it. */
 private tally(c:Context){
  const o=this.options,fed=!this.removed.includes('feedDog');
  if(fed)this.travel+=clothTravel(this.crank)-clothTravel(this.lastCrank);
  this.lastCrank=this.crank;
  const next=this.markAt(this.crank);
  while(this.mark<next){
   this.mark++;
   // A fast frame lands past the stitch, so the hole is measured back to where the crank crossed it.
   const kind=outcomeOf(o),locked=kind!=='skipped'&&kind!=='single-thread',x=this.travel-(fed?clothTravel(this.crank)-clothTravel(TIMING.set+(this.mark-1)*REV):0);
   this.stitches=[...this.stitches.slice(1-STITCH_CAP),{index:this.index++,kind,x,locked}];
   if(locked)this.count++;
   if(!this.quiet)c.sound({type:locked?'stitch':'fault'});
  }
  while(this.mark>next){
   this.mark--;
   const gone=this.stitches.at(-1);if(!gone)continue;
   this.stitches=this.stitches.slice(0,-1);this.index--;if(gone.locked)this.count--;
  }
 }
}
