import {ease,type MirrorAssist,type MirrorAssisted} from '../mirror/engine';
import type {MirrorBehaviour,MirrorContext,WorldPoint} from '../mirror/contracts';
import {clothTravel,FULL_SPM,machinePose,outcomeOf,TIMING,type Stitch} from './model';
import {bodyParts,followers,UNIT} from './parts';
import type {Embroidery,MachineScene,MachineSceneExtra,MachineSkin,MachineSound,MachineWorld,Removable} from './contracts';

const REV=360,IDLE=.16*REV,APART=.45*REV,IDLE_TAU=.6,FRICTION_TAU=.6,REST=2,KICK=.75*REV,KICK_CAP=1.5*REV;
/** Thumb up runs to full speed. With motion reduced the motor stays gentle and there is no strobe. */
export const FULL=FULL_SPM/60*REV;
const FULL_TAU=.9,GENTLE=1.1*REV,BACK=1.2*REV,BACK_TAU=.35,CAP=FULL*1.05;
/** A strobe lamp a hair faster than the crank at full speed: the machine seems to creep backwards. */
export const STROBE_HZ=816/60;
const STROBE_FROM=3*REV;
/** Slow motion: filmed at 50 times the playback rate, of a machine at full speed. */
export const SLOW=50;
const FREEZE=6,FREEZE_CALM=1.2,HS_TAU=.15;
/** Free motion. The cloth slides opposite the hand, so the holes trace the hand's own path. */
export const EMBROIDERY_CAP=400,DRAW_SCALE=2.2,DRAW_PITCH=1.05,HOOP_R=44;
const DRAW_TAU=.45,DRAW_LINGER=2.5,STEER_TAU=.07,STITCH_LEN=1.8,DRAW_MAX=14*REV,REGULATE_TAU=.12,RECENTER_TAU=.8,DRAW_FOCUS=[0,1.6,0],JUMP=12;
/** Top thread tension: change per stage height of pinch travel (per world unit where the world has no stage), and where it snaps. */
/** Seconds after a pinch forms in which it may still take the thread, since a pose settles over a few frames. */
const GRACE_S=.25,LET_GO=.6,TENSION_STAGE=3,TENSION_GAIN=.35,TENSION_TAU=.08,SNAP=1,RELAX_TAU=.6,BALANCED=.5,OFF_BALANCE=.06;
/** Screen pixels: how near a pinch must land to the thread, and how near to still win over a removable part under it. */
export const THREAD_REACH=60,THREAD_TIE=26;
/** Free motion starts only from a deliberate open palm: held this long, nearly still, away from anything to take. */
export const ARM_S=.4;
const ARM_STILL=1.6,ARM_SPEED_TAU=.12,HOT_TAU=.12;
const ASSIST:MirrorAssist={grace:.5,regrab:.6,lock:.3};
/** The plate, the strip of cloth and all beneath: faded out while drawing, so the hooped fabric reads alone. */
const UNDER=['hook','caseShell','bobbinCase','bobbin','bobbinRims','lowerShaft','feedDog','plate','cloth','clothMarks'];
const UNPICK_LIFE=1.4,UNPICK_KEEP=6;
/** One finger circle is one stitch: the wheel follows the finger directly, with no flywheel in the way. */
const STIR_LET_GO=.25;
export const STITCH_CAP=24;
const PULL_OUT=.9,CLOSE_TAU=.55;
/** Zoom past the first closes in on the plate, back past the second returns to the whole machine. */
export const CLOSE_AT=1.35,WHOLE_AT=.85;
/** The close-up sits a little lower and wider than the plate's own middle, so the thread and the hook come where a seated hand reaches easily. */
const CLOSE_SCALE=2.8;
const WHOLE_FOCUS=[64,46,0],CLOSE_FOCUS=[0,-4,0];
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
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
/** 0 away from the first loop throw, 1 across it. */
export const throwBeat=(deg:number)=>smooth((deg-186)/18)*(1-smooth((deg-232)/34));
export const emptyEmbroidery=():Embroidery=>({x:new Float32Array(EMBROIDERY_CAP),z:new Float32Array(EMBROIDERY_CAP),jump:new Uint8Array(EMBROIDERY_CAP),count:0,head:0,version:0,hoop:[0,0]});
type Context=MirrorContext<MachineSkin,MachineSceneExtra,MachineSound>;

/** The crank, the stitch record, the framing and every hand effect. The model is pure, so everything that depends on history lives here. */
export class MachineBehaviour implements MirrorBehaviour<MachineSkin,MachineSceneExtra,MachineSound>,MirrorAssisted {
 readonly assist=ASSIST;
 /** The page opens on the close-up and stays there: framing changes only when the viewer asks. */
 crank=0;omega=0;idle=false;reduced=false;removed:Removable[]=[];timing=0;stitches:Stitch[]=[];count=0;close=true;travel=clothTravel(0);caption='';
 /** 0 to 1 while an open palm counts in to free motion, and where it is. */
 arming=0;
 /** Free motion: cloth offset, whether a hand steers it, and every hole sewn. */
 ox=0;oz=0;drawing=false;embroidery=emptyEmbroidery();
 tension=BALANCED;broken=false;held:WorldPoint|null=null;
 highSpeed=0;realMs=0;exposure=0;freezeLeft=0;flashes=0;unpicked:{x:number;age:number}[]=[];
 private driving=0;private started=false;private mark=0;private lastCrank=0;private stirring=0;private index=0;private u=1;private lastZoom=NaN;
 private tilt=0;private linger=0;private anchor:{x:number;y:number;ox:number;oz:number}|null=null;private steer=0;private session=false;
 private threadHand:number|null=null;private threadY=NaN;private threadFrom=BALANCED;private pinching=new Map<number,number>();private grabbedRemovable=false;private letGo=0;
 private hot=0;private hotTarget=0;private palm:{x:number;y:number}|null=null;private palmSpeed=0;private armAt:WorldPoint|null=null;private loop=0;
 private painting=false;private saved=0;private calm=0;private shown=0;private strobeClock=0;private explode=0;
 private removable=new Map<number,Removable>();private ids:string[]=[];
 constructor(private world:MachineWorld){}
 get timingOffset(){return TIMING_STEPS[this.timing].offset;}
 get options(){return {hookTimingOffset:this.timingOffset,removed:this.removed};}
 /** Signed stitches a minute; the slow-motion film is always of a machine at full speed. */
 get spm(){return this.highSpeed>.5?FULL_SPM:Math.round(this.omega/REV*60);}
 get strobing(){return !this.reduced&&this.freezeLeft<=0&&this.highSpeed<.5&&!this.drawing&&Math.abs(this.omega)>STROBE_FROM;}
 get frozen(){return this.freezeLeft>0;}
 initialScene():MachineSceneExtra{return {machine:{...machinePose(0),stitches:this.stitches},options:{hookTimingOffset:0,removed:[]},close:1,scale:CLOSE_SCALE,focus:[...CLOSE_FOCUS] as [number,number,number],aims:[],threadHot:0,loopLight:0,draw:0,cloth:[0,0],embroidery:this.embroidery,tension:{value:BALANCED,held:null,broken:false},highSpeed:0,realMs:0,exposure:0,freeze:0,unpicked:this.unpicked,hidden:new Set(),fade:{}};}
 fit(n:number){
  this.removable.clear();this.ids=[];
  for(let i=0;i<n;i++){const p=this.world.partInfo(i);this.ids[i]=p.id;if(p.removable)this.removable.set(i,p.id as Removable);}
 }
 describe(i:number){const p=this.world.partInfo(i);return {title:p.title,detail:p.removable?`${p.role}. Pull it out to see why it is there`:p.role};}
 drive(direction:number){this.driving=this.frozen?0:direction;}
 stir(speed:number,elapsed:number){if(this.frozen)return;this.crank+=speed*elapsed*180/Math.PI;this.omega=0;this.stirring=STIR_LET_GO;}
 grabbed(part:number){if(this.removable.has(part))this.grabbedRemovable=true;}
 released(part:number){if(this.removable.has(part))this.grabbedRemovable=false;}
 /** A pinch on the thread holds the part behind it still. */
 dragged(){return this.threadHand!==null;}
 /** Screen pixels from a point to the top thread, judged together with any removable part under it: the thread wins near-ties. */
 private reach(p:WorldPoint){
  const w=this.world,d=w.threadDistance?w.threadDistance(p):w.onThread?.(p)?0:Infinity;
  if(!(d<THREAD_REACH))return null;
  if(d>THREAD_TIE&&this.removable.has(w.partAt(p)))return null;
  return d;
 }
 aim(p:WorldPoint){
  if(this.frozen||this.threadHand!==null||this.reach(p)===null)return null;
  this.hotTarget=1;
  return this.world.threadNear?.(p)??p;
 }
 claim(hand:number,p:WorldPoint){
  if(this.frozen||this.threadHand!==null||this.reach(p)===null)return false;
  this.take(hand);return true;
 }
 private take(hand:number){this.threadHand=hand;this.letGo=0;this.threadY=NaN;this.threadFrom=this.tension;}
 advance(h:number,c:Context){
  this.started=true;const from=this.lastCrank;
  this.clapped(h,c);this.thread(h,c);this.steering(h,c);this.framing(h,c);this.spin(h,c);this.tally(c);
  this.hot+=(this.hotTarget-this.hot)*ease(Math.max(h,1e-6),HOT_TAU);this.hotTarget=this.threadHand!==null?1:0;
  this.painting=c.scene.skin==='paint';this.exposure=this.painting?this.exposure+Math.abs(this.crank-from):0;
  this.strobeClock+=h;
  if(!this.strobing){this.shown=this.crank;this.strobeClock=0;}
  else if(this.strobeClock>=1/STROBE_HZ){this.strobeClock%=1/STROBE_HZ;this.shown=this.crank;this.flashes++;}
  for(let i=this.unpicked.length-1;i>=0;i--)if((this.unpicked[i].age+=h)>UNPICK_LIFE)this.unpicked.splice(i,1);
  if(!c.scene.hands.some(x=>x.pose==='pinch'))this.grabbedRemovable=false;
 }
 settle(h:number,c:Context){
  const s=c.scene;
  for(const [i,id] of this.removable){
   if(this.removed.includes(id)||s.partGlow[i]<1)continue;
   if(Math.hypot(s.partOffsets[i*3],s.partOffsets[i*3+1],s.partOffsets[i*3+2])>PULL_OUT)this.remove(id,c);
  }
  // A clap's jolt is the one thing time freeze must not show.
  if(this.frozen||this.calm>0){s.partOffsets.fill(0);this.calm-=h;}
  this.explode=s.explode;
 }
 publish(c:Context){
  const s=c.scene,o=s.options,m=s.machine,beat=throwBeat(mod(this.crank,REV))*(1-smooth(Math.abs(this.omega)/(.6*REV)))*(1-this.tilt);
  o.hookTimingOffset=this.timingOffset;o.removed=this.removed;
  Object.assign(m,machinePose(this.shown,o));m.clothTravel=this.travel-this.ox;m.stitches=this.drawing?this.freeStitch():this.stitches;
  const u=this.u,d=smooth(this.tilt);
  // The loop throw is lit, not zoomed: the camera holds still while the thread does its work.
  this.loop=beat*u;s.loopLight=this.loop;s.threadHot=this.hot;
  s.close=u;s.draw=this.tilt;s.cloth[0]=this.ox;s.cloth[1]=this.oz;s.embroidery=this.embroidery;
  s.tension.value=this.tension;s.tension.held=this.held;s.tension.broken=this.broken;
  s.highSpeed=this.highSpeed;s.realMs=this.realMs;s.exposure=this.exposure;s.freeze=this.frozen?1:0;s.unpicked=this.unpicked;
  s.scale=mix(mix(1,CLOSE_SCALE,u*u*(3-2*u)),DRAW_SCALE,d);
  for(let i=0;i<3;i++)s.focus[i]=mix(mix(WHOLE_FOCUS[i],CLOSE_FOCUS[i],u),DRAW_FOCUS[i],d);
  if(this.arming>0&&this.armAt&&!this.drawing)s.aims?.push({kind:'arming',x:this.armAt.x,y:this.armAt.y,z:this.armAt.z,target:null,amount:this.arming});
  const fade=1-smooth((u-.08)/.5);s.hidden.clear();
  for(const id of this.removed)s.hidden.add(id);
  for(const [id,leader] of Object.entries(followers))if(s.hidden.has(leader))s.hidden.add(id);
  for(const id of bodyParts){s.fade[id]=fade;if(fade<=0)s.hidden.add(id);}
  // Drawing, the hooped fabric replaces the cloth strip, the plate and all below it.
  for(const id of UNDER){s.fade[id]=1-d;if(d>.95)s.hidden.add(id);}
  this.caption=this.describeNow(m.loop.stage,m.feed.phase);
  // Holding the thread, the part behind it is not what the hand is on.
  if(this.threadHand!==null)s.label=null;
  c.sound({type:'motor',speed:this.quiet||this.frozen?0:this.highSpeed>.5?FULL/SLOW/REV:this.omega/REV});
 }
 reset(s:MachineScene){
  this.travel=clothTravel(0);this.crank=this.omega=this.driving=this.mark=this.lastCrank=this.count=this.index=this.stirring=this.u=this.timing=this.shown=0;
  this.removed=[];this.stitches=[];this.started=false;this.close=true;this.u=1;this.lastZoom=NaN;s.hidden.clear();
  this.arming=0;this.armAt=this.palm=null;this.palmSpeed=0;this.hot=this.hotTarget=0;
  this.ox=this.oz=this.tilt=this.linger=this.steer=this.highSpeed=this.realMs=this.exposure=this.freezeLeft=this.calm=this.flashes=this.strobeClock=0;
  this.drawing=this.session=this.broken=false;this.anchor=null;this.embroidery=emptyEmbroidery();this.tension=BALANCED;this.held=null;this.threadHand=null;this.pinching.clear();this.unpicked.length=0;
 }
 /** Saved phases are 0..360 and the crank is unbounded, so a scrub takes the shortest arc and the stitch tally stays honest; before the first step it restores silently. */
 seek(n:number){
  if(!Number.isFinite(n))return;
  this.omega=0;
  if(!this.started){this.crank=this.lastCrank=this.shown=n;this.mark=this.markAt(n);this.travel=clothTravel(n);return;}
  this.crank+=mod(n-this.crank+180,REV)-180;
 }
 kick(direction:1|-1){
  if(this.frozen)return;
  const next=this.omega+direction*KICK;
  this.omega=direction>0?Math.max(this.omega,Math.min(next,KICK_CAP)):Math.min(this.omega,Math.max(next,-KICK_CAP));
 }
 remove(id:Removable,c?:Context){
  if(this.removed.includes(id))return;
  this.removed=[...this.removed,id];c?.sound({type:'fault'});
 }
 /** Puts every part back, rethreads and retimes the hook, and lets time run. Stitches already sewn stay in the cloth. */
 restore(){this.removed=[];this.timing=0;this.broken=false;this.tension=BALANCED;if(this.frozen)this.resume();}
 cycleTiming(){this.timing=(this.timing+1)%TIMING_STEPS.length;return TIMING_STEPS[this.timing];}
 setClose(on:boolean){this.close=on;}
 /** Stops everything mid-stitch; the motor's speed is kept for when time runs again. */
 freeze(){this.freezeLeft=FREEZE;this.saved=this.omega;this.omega=0;this.driving=0;this.shown=this.crank;}
 resume(){this.freezeLeft=0;this.omega=this.saved;this.calm=FREEZE_CALM;}

 private get quiet(){return this.idle&&!this.driving&&this.omega>=0&&this.omega<IDLE*1.25&&!this.drawing;}
 /** While drawing, the live thread runs back to the last hole, a stitch length away. */
 private freeStitch():Stitch[]{
  const e=this.embroidery,last=(e.head+EMBROIDERY_CAP-1)%EMBROIDERY_CAP,back=e.count?Math.min(JUMP,Math.hypot(this.travel-this.ox-e.x[last],-this.oz-e.z[last])):0;
  return [{index:-2-e.version,kind:'formed',x:this.travel-this.ox-Math.max(back,1),locked:true}];
 }
 private describeNow(stage:string,feed:string){
  if(this.frozen)return `Time stopped at ${Math.round(mod(this.crank,REV))}°. Clap again, or wait, to let it run`;
  if(this.broken)return 'Snapped: pulled past what the thread can take. Let go to rethread';
  if(this.threadHand!==null)return this.tensionNote();
  if(this.drawing||this.tilt>.5)return 'Free motion: the feed dog drops and your hand steers the cloth. It slides the other way, so the needle draws your path';
  if(this.highSpeed>.5)return 'High-speed camera: full speed filmed at 50 times, so a whole stitch takes 3.8 seconds';
  if(this.painting)return 'Light painting: every working point leaves its path. Needle white, crank pin violet, take-up gold, hook point orange, feed dog green, the loop magenta';
  if(this.strobing)return 'Strobe at 816 flashes a minute, a hair faster than the crank, so the machine seems to creep backwards';
  if(this.omega<-REST&&!this.stirring)return 'Unpicking: run backwards, each lock is pulled back out of the cloth';
  if(this.explode>.3)return 'Apart and still running: the glowing links show which part drives which';
  // Let go, the tension stays where the hand left it.
  if(Math.abs(this.tension-BALANCED)>OFF_BALANCE)return `${this.tensionNote()}. Pinch the thread again to change it`;
  const kind=outcomeOf(this.options);
  if(kind==='skipped'){const o=this.timingOffset;return o>0?`Hook ${o}° late: the loop has drawn shut before the point arrives, so the stitch skips`:`Hook ${-o}° early: the point passes before the loop has opened, so the stitch skips`;}
  if(faults[kind])return faults[kind];
  if(this.u<.5)return '';
  return beats[stage]??(feed==='forward'?'The feed dog walks the cloth one stitch':'');
 }
 private tensionNote(){const t=this.tension;return t<.3?'Slack: the loop balloons and the lock sinks under the cloth, leaving loops below':t>.72?'Tight: the lock is dragged up to the top and the cloth puckers':'Balanced: the lock sits inside the cloth, hidden between the plies';}
 /** Only Scale crossing a threshold, or the corner control, changes the framing; nothing moves the camera by itself. */
 private framing(h:number,c:Context){
  const zoom=c.view.zoom,last=this.lastZoom;this.lastZoom=zoom;
  if(last<CLOSE_AT&&zoom>=CLOSE_AT)this.setClose(true);
  else if(last>WHOLE_AT&&zoom<=WHOLE_AT)this.setClose(false);
  this.u+=(+this.close-this.u)*ease(Math.max(h,1e-6),CLOSE_TAU);
  if(Math.abs(+this.close-this.u)<.002)this.u=+this.close;
  this.tilt+=(+(this.drawing||this.linger>0)-this.tilt)*ease(Math.max(h,1e-6),DRAW_TAU);
  if(Math.abs(+(this.drawing||this.linger>0)-this.tilt)<.002)this.tilt=+(this.drawing||this.linger>0);
 }
 /** A clap stops time; another, or six seconds, starts it again. */
 private clapped(h:number,c:Context){
  if(this.frozen&&(this.freezeLeft-=h)<=0)this.resume();
  if(!c.scene.shocks.some(s=>s.age===0))return;
  if(this.frozen)this.resume();else{this.freeze();this.drawing=false;this.anchor=null;this.linger=0;}
 }
 /** Height of a point on the stage, 0 at the top, or its world height where the world has no stage. */
 private rise(p:WorldPoint){const at=this.world.stageOf?.(p);return at?-at.y*TENSION_STAGE:p.y*TENSION_GAIN;}
 /** A single pinch that lands on the top thread holds it: up pulls it tighter against the discs, down feeds it slack. Let go, it keeps the tension it was left at. */
 private thread(h:number,c:Context){
  const pinches=c.scene.hands.filter(x=>x.pose==='pinch'),one=pinches.length===1?pinches[0]:null;
  // A pinch flickers for a frame or two as fingers move; the thread is only let go once it has been gone a moment.
  if(this.threadHand!==null&&(!one||one.id!==this.threadHand)&&(this.letGo+=h)>LET_GO){
   this.threadHand=null;this.held=null;
   // Snapped thread is rethreaded at the discs' own tension.
   if(this.broken){this.broken=false;this.relaxing=true;}
  }
  if(one&&one.id===this.threadHand)this.letGo=0;
  if(one&&one.joints.length>8){
   const a=one.joints[4],b=one.joints[8],p={x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2};
   // The engine offers the landing first; this catches a pinch whose pose settled a moment after its fingers met the thread.
   if(this.threadHand===null&&(this.pinching.get(one.id)??0)<GRACE_S&&!this.grabbedRemovable&&!this.frozen&&this.reach(p)!==null)this.take(one.id);
   if(this.threadHand===one.id){
    this.held=p;one.active=true;this.relaxing=false;
    if(Number.isNaN(this.threadY))this.threadY=this.rise(p);
    const target=clamp(this.threadFrom+this.rise(p)-this.threadY,0,SNAP+.05);
    if(!this.broken)this.tension+=(target-this.tension)*ease(Math.max(h,1e-6),TENSION_TAU);
    if(!this.broken&&this.tension>=SNAP-.01){this.broken=true;this.tension=SNAP;c.sound({type:'snap'});}
   }
  }
  if(this.relaxing){this.tension+=(BALANCED-this.tension)*ease(Math.max(h,1e-6),RELAX_TAU);if(Math.abs(this.tension-BALANCED)<.002){this.tension=BALANCED;this.relaxing=false;}}
  const was=this.pinching;this.pinching=new Map(pinches.map(x=>[x.id,(was.get(x.id)??0)+h]));
 }
 private relaxing=false;
 /** One open hand steers the cloth while the stitch regulator runs the needle at the pace the hand moves. It starts only from a palm held open and still, away from the thread and the parts that come out, so reaching for something never tips the view. */
 private steering(h:number,c:Context){
  const s=c.scene,open=s.hands.filter(x=>x.pose==='open').length===1;let field=null;
  if(open)for(const f of s.fields)if(!field||f.strength>field.strength)field=f;
  if(field&&h>0){
   const was=this.palm;this.palm={x:field.x,y:field.y};
   if(was)this.palmSpeed+=(Math.hypot(field.x-was.x,field.y-was.y)/h-this.palmSpeed)*ease(h,ARM_SPEED_TAU);
  }else if(!field){this.palm=null;this.palmSpeed=0;}
  if(this.drawing||!field||this.frozen)this.arming=0;
  else{
   // Judged at the fingertip, where a reaching hand arrives first.
   const at={x:field.x,y:field.y,z:field.z},hand=s.hands.find(x=>x.pose==='open'),tip=hand&&hand.joints.length>8?hand.joints[8]:at;
   const clear=this.reach(tip)===null&&!this.removable.has(this.world.partAt(tip));
   this.armAt=at;
   // A second hand in view is doing something else: Scale, Tear or a clap, so the count waits.
   this.arming=clear&&s.hands.length===1&&this.palmSpeed<ARM_STILL?Math.min(1,this.arming+h/ARM_S):0;
  }
  const on=!!field&&field.strength>.5&&!this.frozen&&(this.drawing||this.arming>=1);
  if(on&&field){
   if(!this.drawing){this.anchor={x:field.x,y:field.y,ox:this.ox,oz:this.oz};this.session=true;this.arming=0;if(!this.embroidery.count)this.embroidery.hoop=[this.travel-this.ox,-this.oz];}
   const a=this.anchor!,k=UNIT*DRAW_SCALE,hoop=this.embroidery.hoop;
   let tx=a.ox-(field.x-a.x)/k,tz=a.oz+(field.y-a.y)/(k*Math.sin(DRAW_PITCH));
   const dx=this.travel-tx-hoop[0],dz=-tz-hoop[1],r=Math.hypot(dx,dz);
   if(r>HOOP_R){tx=this.travel-hoop[0]-dx*HOOP_R/r;tz=-hoop[1]-dz*HOOP_R/r;}
   const r0=this.ox,r1=this.oz,rate=ease(Math.max(h,1e-6),STEER_TAU);this.ox+=(tx-this.ox)*rate;this.oz+=(tz-this.oz)*rate;
   if(h>0)this.steer+=(Math.hypot(this.ox-r0,this.oz-r1)/h-this.steer)*ease(h,.1);
   this.drawing=true;this.linger=DRAW_LINGER;
  }else{
   if(this.drawing){this.drawing=false;this.anchor=null;this.steer=0;}
   if(this.linger>0&&!this.frozen)this.linger-=h;
   else if(!this.frozen&&h>0){const r=ease(h,RECENTER_TAU);this.ox-=this.ox*r;this.oz-=this.oz*r;if(Math.hypot(this.ox,this.oz)<.01)this.ox=this.oz=0;}
  }
 }
 private spin(h:number,c:Context){
  this.stirring=Math.max(0,this.stirring-h);
  const film=!this.frozen&&c.scene.slice.amount>.02;
  this.highSpeed+=(+film-this.highSpeed)*ease(Math.max(h,1e-6),HS_TAU);
  if(this.frozen)return;
  if(film){this.crank+=FULL/SLOW*h;this.realMs+=h*1000/SLOW;return;}
  if(this.drawing){this.omega+=(Math.min(DRAW_MAX,this.steer/STITCH_LEN*REV)-this.omega)*ease(Math.max(h,1e-6),REGULATE_TAU);this.crank+=this.omega*h;return;}
  const top=this.driving>0?(this.reduced?GENTLE:FULL):BACK,motor=this.driving*top,still=this.explode>.3?APART:IDLE,idle=this.idle&&!c.frozen&&!this.driving&&!this.stirring;
  if(this.driving&&this.omega*this.driving<top)this.omega+=(motor-this.omega)*ease(h,this.driving>0?FULL_TAU:BACK_TAU);
  else if(idle&&this.omega<still)this.omega+=(still-this.omega)*ease(h,IDLE_TAU);
  else if(h>0)this.omega=idle?still+(this.omega-still)*Math.exp(-h/FRICTION_TAU):this.omega*Math.exp(-h/FRICTION_TAU);
  this.omega=clamp(this.omega,-CAP,CAP);
  if(!this.driving&&!idle&&Math.abs(this.omega)<REST)this.omega=0;
  // The idle motor lingers on the loop throw: it is over in a blink at any steady speed.
  const linger=idle&&this.omega<=still*1.01?1-.72*throwBeat(mod(this.crank,REV)):1;
  this.crank+=this.omega*h*linger;
 }
 private markAt(crank:number){return Math.floor((crank-TIMING.set)/REV)+1;}
 /** One hole per crank turn, at wherever the hand has slid the cloth to. */
 private hole(){
  const e=this.embroidery,i=e.head,x=this.travel-this.ox,z=-this.oz,last=(i+EMBROIDERY_CAP-1)%EMBROIDERY_CAP;
  e.x[i]=x;e.z[i]=z;e.jump[i]=+(this.session||!e.count||Math.hypot(x-e.x[last],z-e.z[last])>JUMP);
  e.head=(i+1)%EMBROIDERY_CAP;e.count=Math.min(EMBROIDERY_CAP,e.count+1);e.version++;this.session=false;
 }
 /** The model recomputes every stitch from today's options, so a record is kept here: a part pulled out changes only the stitches after it. */
 private tally(c:Context){
  const o=this.options,fed=!this.removed.includes('feedDog')&&!this.drawing&&this.tilt<.5;
  if(fed)this.travel+=clothTravel(this.crank)-clothTravel(this.lastCrank);
  this.lastCrank=this.crank;
  const next=this.markAt(this.crank);
  while(this.mark<next){
   this.mark++;
   const kind=this.broken?'skipped':outcomeOf(o),locked=kind!=='skipped'&&kind!=='single-thread';
   if(locked)this.count++;
   if(!this.quiet)c.sound({type:locked?'stitch':'fault'});
   if(this.drawing&&locked){this.hole();continue;}
   // A fast frame lands past the stitch, so the hole is measured back to where the crank crossed it.
   const x=this.travel-this.ox-(fed?clothTravel(this.crank)-clothTravel(TIMING.set+(this.mark-1)*REV):0),off=Math.abs(this.tension-BALANCED)>OFF_BALANCE;
   this.stitches=[...this.stitches.slice(1-STITCH_CAP),{index:this.index++,kind,x,locked,...(off&&locked?{tension:this.tension}:{})}];
  }
  while(this.mark>next){
   this.mark--;
   const gone=this.stitches.at(-1);if(!gone)continue;
   this.stitches=this.stitches.slice(0,-1);this.index--;if(gone.locked){this.count--;this.unpicked.push({x:gone.x,age:0});if(this.unpicked.length>UNPICK_KEEP)this.unpicked.shift();}
  }
 }
}
