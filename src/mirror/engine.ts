import {Quaternion,Vector3} from 'three';
import type {Quat} from '../types';
import type {MirrorAim} from './parts-overlay';
import {MIRROR_ZOOM_MAX as ZOOM_MAX,MIRROR_ZOOM_MIN as ZOOM_MIN,type GestureFrame,type HandPose,type MirrorBehaviour,type MirrorContext,type MirrorDriver,type MirrorEngineOutput,type MirrorField,type MirrorHandView,type MirrorLabel,type MirrorScene,type MirrorSound,type MirrorViewPatch,type MirrorViewState,type MirrorWorld,type TrackedHand,type WorldPoint} from './contracts';

export const REV=Math.PI*2,EPS=1e-9,GOLDEN=2.399963;
const MAX_DT=.05;
const STIR_MIN=.5,STIR_RADIUS=.4,STILL_SPEED=1.2,HOVER_PERIOD=.1;
const ORBIT=.55;
const FIELD_RADIUS=1.5,FIELD_EASE=.15;
const SPRING_W=REV*3,SPRING_DECAY=3.26,SPRING_H=1/240,PLUCK_TAU=.04,REACH=3,REACH_SOFT=1.5,JOLT=.6,GLOW_TAU=.45;
const TEAR_SPAN=.35,TEAR_TAU=.05,TEAR_FALL=1.5,TEAR_CUE=.3,TEAR_REARM=.15;
const SHOCK_LIFE=1.5,SHOCK_IMPULSE=13;
const SLICE_EASE=.2,SLICE_TAU=.08;
const POINTER=-1;

export const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
export const wrap=(a:number)=>a-REV*Math.ceil((a-Math.PI)/REV);
export const ease=(h:number,tau:number)=>1-Math.exp(-h/tau);
const X=new Vector3(1,0,0),Y=new Vector3(0,1,0),Z=new Vector3(0,0,1);

interface Grip {two:boolean;a:number;b:number;base:Quaternion;x:number;y:number;zoom:number;ref:Quaternion|null;px:number;py:number;distance:number;angle:number;roll:number}
interface Pluck {part:number;sx:number;sy:number;sz:number;ox:number;oy:number;oz:number;x:number;y:number;z:number;
 /** Assisted only: engine clock when the pinch holding it dropped, while it waits to be taken back. */
 lost?:number}
/** Opt-in help for catching small things by hand. ATP does not ask for it, so nothing below changes there. */
export interface MirrorAssist {
 /** Seconds a pluck outlives a dropped pinch, and world units within which a fresh pinch takes it back. */
 grace:number;regrab:number;
 /** Seconds a target hovered by a closing pinch is still the one taken when the pinch lands. */
 lock:number;
}
/** What an assisted behaviour may add: the config, and a target of its own that is not a part (a thread, say). */
export interface MirrorAssisted {
 assist?:MirrorAssist;
 /** Where a pinch closing at p would take hold of the behaviour's own target, or null. Called as fingers close, so it may also light the candidate. */
 aim?(p:WorldPoint):WorldPoint|null;
 /** A pinch has landed at p: return true to take it, so no part is plucked. */
 claim?(hand:number,p:WorldPoint):boolean;
}
/** A closing pinch: the fingers part by less than this many palm lengths, measured on screen. */
const AIM_RATIO=.8,AIM_SHUT=.35,MISS_LIFE=.6;
interface Hover {at:number;point:WorldPoint;target:WorldPoint|null;part:number;closeness:number}
interface Tear {a:number;b:number;start:number;base:number}
interface Stir {angle:number;x:number;y:number}
interface HandCache {view:MirrorHandView;palm:WorldPoint;tip:WorldPoint}

/** Everything hands can do to any object: the motion, labels and extra scene come from the behaviour. */
export class MirrorEngine<Skin extends string,Extra extends object,Sound=MirrorSound> implements MirrorDriver<MirrorEngineOutput<MirrorScene<Skin>&Extra,Sound|MirrorSound>> {
 protected scene:MirrorScene<Skin>&Extra;protected context:MirrorContext<Skin,Extra,Sound>;
 private velocity=new Float32Array(0);private held=new Uint8Array(0);
 private lastAt=NaN;private sinceFrame=0;private sounds:(Sound|MirrorSound)[]=[];
 private grip:Grip|null=null;private plucks=new Map<number,Pluck>();private tear:Tear|null=null;private tearTarget=0;private fallFrom=0;private fallT=1;private tearArmed=true;
 private fields=new Map<number,MirrorField&{target:number}>();private stirs=new Map<number,Stir>();private pinching=new Set<number>();private cache=new Map<number,HandCache>();private lastPose=new Map<number,HandPose>();
 private fingerHover:WorldPoint|null=null;private mouseHover:WorldPoint|null=null;private hoverPart=-1;private hoverClock=HOVER_PERIOD;
 private sliceTarget:number|null=null;private skinIndex=0;private box:MirrorLabel={title:'',detail:'',x:0,y:0,z:0};
 private q=new Quaternion();private q2=new Quaternion();private v=new Vector3();
 constructor(protected world:MirrorWorld,protected behaviour:MirrorBehaviour<Skin,Extra,Sound>,protected skins:readonly Skin[]){
  // The behaviour's object is the target so any accessors it defines survive.
  const s=this.scene=Object.assign(behaviour.initialScene(),{explode:0,partOffsets:new Float32Array(0),partGlow:new Float32Array(0),fields:[],shocks:[],slice:{amount:0,x:0},skin:skins[0],hands:[],label:null} satisfies MirrorScene<Skin>);
  this.context={scene:s,view:{q:[0,0,0,1],zoom:1,x:0,y:0},frozen:false,sound:sound=>{this.sounds.push(sound);},glow:(part,amount)=>{s.partGlow[part]=Math.max(s.partGlow[part],amount);},touching:(x,y,radius)=>this.touching(x,y,radius)};
  this.fit();
  const assisted=behaviour as MirrorAssisted;this.assist=assisted.assist??null;
  // The behaviour opts in by carrying an aims list in its scene.
  const aims=(s as {aims?:MirrorAim[]}).aims;this.aims=this.assist&&Array.isArray(aims)?aims:null;
 }
 private assist:MirrorAssist|null=null;private aims:MirrorAim[]|null=null;private clock=0;
 private hovers=new Map<number,Hover>();private misses:{x:number;y:number;z:number;age:number}[]=[];

 // An object without motion keeps these; one with a motor overrides them.
 get idle(){return false;}
 set idle(_:boolean){}
 get position(){return 0;}
 get speed(){return 0;}
 seek(_:number){}
 kick(_:1|-1){}
 pointerDown(p:WorldPoint){this.fit();return !this.context.frozen&&this.grab(POINTER,p);}
 pointerMove(p:WorldPoint){const pluck=this.plucks.get(POINTER);if(pluck){pluck.x=p.x;pluck.y=p.y;pluck.z=p.z;}}
 pointerUp(){this.release(POINTER,true);}
 hover(p:WorldPoint|null){this.mouseHover=p;}
 reset(){
  const s=this.scene;this.lastAt=NaN;this.sinceFrame=0;this.sounds=[];
  this.grip=this.tear=null;this.plucks.clear();this.tearTarget=0;this.fallFrom=0;this.fallT=1;this.tearArmed=true;this.fields.clear();this.stirs.clear();this.pinching.clear();this.cache.clear();this.lastPose.clear();
  this.fingerHover=this.mouseHover=null;this.hoverPart=-1;this.hoverClock=HOVER_PERIOD;this.sliceTarget=null;this.skinIndex=0;
  this.hovers.clear();this.misses.length=0;if(this.aims)this.aims.length=0;
  s.explode=s.slice.amount=s.slice.x=0;s.skin=this.skins[0];s.label=null;s.partOffsets.fill(0);s.partGlow.fill(0);this.velocity.fill(0);s.fields.length=s.shocks.length=s.hands.length=0;
  this.behaviour.reset(s);
 }

 step(frame:GestureFrame,dt:number,view:MirrorViewState,frozen:boolean):MirrorEngineOutput<MirrorScene<Skin>&Extra,Sound|MirrorSound>{
  const h=Number.isFinite(dt)?clamp(dt,0,MAX_DT):0,s=this.scene,c=this.context,b=this.behaviour;
  this.fit();c.frozen=frozen;c.view=view;this.sinceFrame+=h;this.clock+=h;
  let patch:MirrorViewPatch|null=null;
  if(frame.at!==this.lastAt){
   this.lastAt=frame.at;this.track(frame);
   if(!frozen)patch=this.gestures(frame,view);
   this.sinceFrame=0;
  }
  if(frozen)this.calm();
  b.advance(h,c);this.springs(h);this.easeFields(h);this.easeExplode(h);this.easeSlice(h);b.settle(h,c);
  for(let i=s.shocks.length-1;i>=0;i--)if((s.shocks[i].age+=h)>=SHOCK_LIFE)s.shocks.splice(i,1);
  this.hoverLabel(h);
  if(this.aims)this.drawAims(h,frozen);
  b.publish(c);
  const sounds=this.sounds;this.sounds=[];
  return {scene:s,view:patch,sounds,holding:!!this.grip};
 }

 // Parts arrive with the model, which can finish loading after construction.
 private fit(){
  const n=this.world.partCount,s=this.scene;if(s.partGlow.length===n)return;
  s.partOffsets=new Float32Array(n*3);s.partGlow=new Float32Array(n);this.velocity=new Float32Array(n*3);this.held=new Uint8Array(n);this.plucks.clear();
  this.behaviour.fit(n);
 }
 private track(frame:GestureFrame){
  const s=this.scene;s.hands.length=0;
  for(const id of this.cache.keys())if(!frame.hands.some(h=>h.id===id))this.cache.delete(id);
  for(const hand of frame.hands){
   let c=this.cache.get(hand.id);
   if(!c){c={view:{id:hand.id,side:hand.side,pose:hand.pose,joints:[],active:false},palm:{x:0,y:0,z:0},tip:{x:0,y:0,z:0}};this.cache.set(hand.id,c);}
   c.view.side=hand.side;c.view.pose=hand.pose;c.view.active=false;c.view.joints.length=hand.landmarks.length;
   for(let i=0;i<hand.landmarks.length;i++)c.view.joints[i]=this.world.mirrorToWorld(hand.landmarks[i]);
   c.palm=this.world.mirrorToWorld(hand.palm);c.tip=this.world.mirrorToWorld(hand.indexTip);s.hands.push(c.view);
  }
  // Maintained while frozen so a pinch held through a freeze is not read as a new pinch.
  for(const e of frame.events){
   if(e.type==='lost')this.lastPose.delete(e.handId);
   else if(e.type==='pose'){
    if(e.pose==='love'&&this.lastPose.get(e.handId)!=='love'&&!this.context.frozen){s.skin=this.skins[this.skinIndex=(this.skinIndex+1)%this.skins.length];this.sounds.push({type:'skin'});}
    this.lastPose.set(e.handId,e.pose);
   }else if(!this.context.frozen)this.clap(this.world.mirrorToWorld({x:e.x,y:e.y,z:0}));
  }
 }
 private gestures(frame:GestureFrame,view:MirrorViewState){
  const patch=this.hold(frame,view),elapsed=this.sinceFrame;
  this.behaviour.drive(Math.sign(frame.hands.reduce((n,h)=>n+(h.pose==='thumbUp'?1:h.pose==='thumbDown'?-1:0),0)));
  for(const field of this.fields.values())field.target=0;
  this.fingerHover=null;
  let slice:number|null=null;
  for(const hand of frame.hands){
   const c=this.cache.get(hand.id)!;
   if(hand.pose==='open'){
    let field=this.fields.get(hand.id);
    if(!field){field={x:0,y:0,z:0,radius:FIELD_RADIUS,strength:0,target:1};this.fields.set(hand.id,field);}
    field.x=c.palm.x;field.y=c.palm.y;field.z=c.palm.z;field.target=1;c.view.active=true;
   }else if(hand.pose==='fist')c.view.active=!!this.grip;
   else if(hand.pose==='victory'){slice??=c.palm.x;c.view.active=true;}
   else if(hand.pose==='thumbUp'||hand.pose==='thumbDown')c.view.active=true;
   if(hand.pose==='point')c.view.active=this.stir(hand.id,c,view,elapsed);else this.stirs.delete(hand.id);
  }
  if(slice!==null&&this.sliceTarget===null)this.sounds.push({type:'slice'});
  this.sliceTarget=slice;
  this.pinches(frame);
  return patch;
 }
 private hold(frame:GestureFrame,view:MirrorViewState):MirrorViewPatch|null{
  const fists=frame.hands.filter(h=>h.pose==='fist').sort((a,b)=>a.id-b.id);
  if(!fists.length){this.grip=null;return null;}
  return fists.length>1?this.holdTwo(fists[0],fists[1],view):this.holdOne(fists[0],view);
 }
 private rebase(view:MirrorViewState,two:boolean,a:number,b:number,px:number,py:number,ref:Quaternion|null,distance:number,angle:number):Grip{
  return {two,a,b,base:new Quaternion().fromArray(view.q).normalize(),x:view.x,y:view.y,zoom:view.zoom,ref,px,py,distance:Math.max(distance,.01),angle,roll:0};
 }
 private holdOne(hand:TrackedHand,view:MirrorViewState):MirrorViewPatch{
  const palm=this.cache.get(hand.id)!.palm,o=hand.orientation;let g=this.grip;
  // Any change of source rebases on the live view, which is what keeps every transition jump-free.
  if(!g||g.two||g.a!==hand.id||!g.ref!==!o)g=this.grip=this.rebase(view,false,hand.id,-1,palm.x,palm.y,o?new Quaternion().fromArray(o).normalize():null,1,0);
  const dx=palm.x-g.px,dy=palm.y-g.py;
  if(o&&g.ref)this.q.fromArray(o).normalize().multiply(this.q2.copy(g.ref).invert());
  else this.q.setFromAxisAngle(Y,dx*ORBIT).multiply(this.q2.setFromAxisAngle(X,-dy*ORBIT));
  this.q.multiply(g.base).normalize();
  return {q:this.q.toArray() as Quat,x:g.x+dx,y:g.y+dy};
 }
 private holdTwo(a:TrackedHand,b:TrackedHand,view:MirrorViewState):MirrorViewPatch{
  const pa=this.cache.get(a.id)!.palm,pb=this.cache.get(b.id)!.palm,mx=(pa.x+pb.x)/2,my=(pa.y+pb.y)/2,distance=Math.hypot(pb.x-pa.x,pb.y-pa.y),angle=Math.atan2(pb.y-pa.y,pb.x-pa.x);let g=this.grip;
  if(!g||!g.two||g.a!==a.id||g.b!==b.id)g=this.grip=this.rebase(view,true,a.id,b.id,mx,my,null,distance,angle);
  // Accumulated so hands passing through vertical never flip the roll by a full turn.
  g.roll+=wrap(angle-g.angle);g.angle=angle;
  this.q.setFromAxisAngle(Z,g.roll).multiply(g.base).normalize();
  return {q:this.q.toArray() as Quat,x:g.x+mx-g.px,y:g.y+my-g.py,zoom:clamp(g.zoom*distance/g.distance,ZOOM_MIN,ZOOM_MAX)};
 }
 private stir(id:number,c:HandCache,view:MirrorViewState,elapsed:number){
  const rx=c.tip.x-view.x,ry=c.tip.y-view.y,angle=Math.atan2(ry,rx),old=this.stirs.get(id);
  this.stirs.set(id,{angle,x:c.tip.x,y:c.tip.y});
  if(!old||elapsed<=0)return false;
  if(Math.hypot(c.tip.x-old.x,c.tip.y-old.y)/elapsed<STILL_SPEED)this.fingerHover=c.tip;
  // The angle is meaningless near the centre, where tiny tracking noise spans whole quadrants.
  if(Math.hypot(rx,ry)<STIR_RADIUS)return false;
  const speed=wrap(angle-old.angle)/elapsed;if(Math.abs(speed)<STIR_MIN)return false;
  this.behaviour.stir(speed,elapsed);return true;
 }
 private pinches(frame:GestureFrame){
  const pinches=frame.hands.filter(h=>h.pose==='pinch').sort((a,b)=>a.id-b.id);
  for(const [key,pluck] of this.plucks){
   if(key===POINTER)continue;
   const on=pinches.some(h=>h.id===key);
   // Assisted, a pose that flickers out keeps hold a moment, so a tired or tracked-badly hand does not drop the part.
   if(on||!this.assist){if(on)pluck.lost=undefined;else this.release(key,true);continue;}
   pluck.lost??=this.clock;
   if(this.clock-pluck.lost>this.assist.grace)this.release(key,true);
  }
  if(this.assist)this.approach(frame);
  if(pinches.length>1){
   const [a,b]=pinches,distance=Math.hypot(a.pinch.x-b.pinch.x,a.pinch.y-b.pinch.y);
   if(!this.tear||this.tear.a!==a.id||this.tear.b!==b.id){
    this.tear={a:a.id,b:b.id,start:distance,base:this.scene.explode};this.fallT=1;
    for(const key of this.plucks.keys())if(key!==POINTER)this.release(key,false);
   }
   this.tearTarget=clamp(this.tear.base+(distance-this.tear.start)/TEAR_SPAN,0,1);
   this.cache.get(a.id)!.view.active=this.cache.get(b.id)!.view.active=true;
  }else{
   this.endTear();
   if(pinches.length&&!this.pinching.has(pinches[0].id))this.grab(pinches[0].id,this.landing(pinches[0].id,this.world.mirrorToWorld(pinches[0].pinch)));
   else if(pinches.length){const pluck=this.plucks.get(pinches[0].id);if(pluck){const p=this.world.mirrorToWorld(pinches[0].pinch);pluck.x=p.x;pluck.y=p.y;pluck.z=p.z;}}
   if(pinches.length)this.cache.get(pinches[0].id)!.view.active=this.plucks.has(pinches[0].id);
  }
  this.pinching.clear();for(const hand of pinches)this.pinching.add(hand.id);
 }
 private endTear(){if(this.tear){this.tear=null;this.fallFrom=this.scene.explode;this.fallT=0;}}
 private grab(key:number,p:WorldPoint){
  if(this.assist&&key!==POINTER){
   // A pluck still waiting after its pinch dropped is taken back by the same hand, or by any pinch landing next to it.
   for(const [k,pluck] of this.plucks){
    if(pluck.lost===undefined||(k!==key&&Math.hypot(pluck.x-p.x,pluck.y-p.y)>this.assist.regrab))continue;
    this.plucks.delete(k);pluck.lost=undefined;pluck.x=p.x;pluck.y=p.y;pluck.z=p.z;this.plucks.set(key,pluck);return true;
   }
   if((this.behaviour as MirrorAssisted).claim?.(key,p))return true;
  }
  const part=this.world.partAt(p);
  if(part<0||part>=this.scene.partGlow.length){if(this.assist&&key!==POINTER)this.misses.push({...p,age:0});return false;}
  for(const pluck of this.plucks.values())if(pluck.part===part)return false;
  this.behaviour.grabbed?.(part,this.context);
  const o=this.scene.partOffsets,i=part*3;
  this.plucks.set(key,{part,sx:p.x,sy:p.y,sz:p.z,ox:o[i],oy:o[i+1],oz:o[i+2],x:p.x,y:p.y,z:p.z});
  this.sounds.push({type:'pluck'});return true;
 }
 /** Where a pinch lands: the target its fingers were closing on a moment ago, since closing them drags the midpoint off it. */
 private landing(key:number,p:WorldPoint):WorldPoint{
  const hover=this.assist?this.hovers.get(key):undefined;
  return hover&&(hover.target||hover.part>=0)&&this.clock-hover.at<=this.assist!.lock?hover.point:p;
 }
 /** Each hand closing toward a pinch: what it would take, remembered for the landing and drawn as a reticle. */
 private approach(frame:GestureFrame){
  const seen=new Set<number>();
  for(const hand of frame.hands){
   const c=this.cache.get(hand.id),j=c?.view.joints;
   if(!j||j.length<21||hand.pose==='pinch'||hand.pose==='fist'||this.plucks.has(hand.id))continue;
   const palm=Math.hypot(j[9].x-j[0].x,j[9].y-j[0].y),ratio=palm>1e-6?Math.hypot(j[8].x-j[4].x,j[8].y-j[4].y)/palm:Infinity;
   if(!(ratio<AIM_RATIO))continue;
   const point={x:(j[4].x+j[8].x)/2,y:(j[4].y+j[8].y)/2,z:(j[4].z+j[8].z)/2},target=(this.behaviour as MirrorAssisted).aim?.(point)??null,part=target?-1:this.world.partAt(point);
   this.hovers.set(hand.id,{at:this.clock,point,target:target??(part>=0&&part<this.scene.partGlow.length?point:null),part,closeness:clamp((AIM_RATIO-ratio)/(AIM_RATIO-AIM_SHUT),0,1)});seen.add(hand.id);
  }
  // Kept a moment past the last closing frame, for the landing; drawn only while still closing.
  for(const [id,hover] of this.hovers)if(!seen.has(id)&&this.clock-hover.at>this.assist!.lock)this.hovers.delete(id);
  this.approaching=seen;
 }
 private approaching=new Set<number>();
 private drawAims(h:number,frozen:boolean){
  const aims=this.aims!;aims.length=0;
  for(let i=this.misses.length-1;i>=0;i--)if((this.misses[i].age+=h/MISS_LIFE)>=1)this.misses.splice(i,1);
  if(frozen)return;
  for(const [id,hover] of this.hovers){
   if(!this.approaching.has(id))continue;
   if(hover.part>=0&&hover.part<this.scene.partGlow.length)this.context.glow(hover.part,.25+.35*hover.closeness);
   aims.push({kind:'reticle',x:hover.point.x,y:hover.point.y,z:hover.point.z,target:hover.target,amount:hover.closeness});
  }
  for(const m of this.misses)aims.push({kind:'miss',x:m.x,y:m.y,z:m.z,target:null,amount:m.age});
 }
 /** Drops every pluck at once, grace or not: for an object putting itself back together, so nothing still held drags a part out again. */
 letGo(){for(const key of [...this.plucks.keys()])this.release(key,false);this.hovers.clear();}
 private release(key:number,loud:boolean){
  const pluck=this.plucks.get(key);if(!pluck)return;
  this.plucks.delete(key);if(loud)this.sounds.push({type:'snap'});
  const n=this.scene.partGlow.length,o=this.scene.partOffsets,i=pluck.part*3;
  this.velocity.fill(0,i,i+3);
  for(const neighbour of this.behaviour.neighbours?.(pluck.part)??[(pluck.part+1)%n,(pluck.part+n-1)%n]){
   if(neighbour===pluck.part)continue;
   for(let k=0;k<3;k++)this.velocity[neighbour*3+k]+=o[i+k]*JOLT;
   this.scene.partGlow[neighbour]=Math.max(this.scene.partGlow[neighbour],.35);
  }
  this.behaviour.released?.(pluck.part,this.context);
 }
 private clap(p:WorldPoint){
  const s=this.scene,n=s.partGlow.length,view=this.context.view,a=this.v.set(view.x-p.x,view.y-p.y,-p.z);
  if(a.lengthSq()>EPS)a.normalize();else a.set(0,0,0);
  s.shocks.push({x:p.x,y:p.y,z:p.z,age:0});this.sounds.push({type:'shock'});
  for(let i=0;i<n;i++){
   // Without part centres, a fixed golden-angle spread keeps the burst radial and repeatable.
   const y=1-2*(i+.5)/n,r=Math.sqrt(Math.max(0,1-y*y)),t=i*GOLDEN;
   let dx=Math.cos(t)*r+a.x,dy=y+a.y,dz=Math.sin(t)*r+a.z;const l=Math.hypot(dx,dy,dz)||1;dx/=l;dy/=l;dz/=l;
   this.velocity[i*3]+=dx*SHOCK_IMPULSE;this.velocity[i*3+1]+=dy*SHOCK_IMPULSE;this.velocity[i*3+2]+=dz*SHOCK_IMPULSE;
   s.partGlow[i]=Math.max(s.partGlow[i],.6);
  }
 }
 private calm(){
  this.grip=null;this.behaviour.drive(0);this.sliceTarget=null;this.fingerHover=this.mouseHover=null;this.stirs.clear();this.endTear();
  for(const field of this.fields.values())field.target=0;
  for(const key of [...this.plucks.keys()])this.release(key,true);
 }
 // Screen-plane test: hand depth from a webcam is unreliable, and overlap on screen is what the viewer sees as touching.
 private touching(x:number,y:number,radius:number){
  for(const c of this.cache.values())if(Math.hypot(c.palm.x-x,c.palm.y-y)<radius||Math.hypot(c.tip.x-x,c.tip.y-y)<radius)return true;
  return false;
 }
 private springs(h:number){
  const s=this.scene,o=s.partOffsets,v=this.velocity,steps=Math.ceil(h/SPRING_H),dt=steps?h/steps:0,k=SPRING_W*SPRING_W,c=2*SPRING_DECAY;
  // A held part is skipped: the spring would otherwise drag it short of the pinch.
  const held=this.held.fill(0);for(const p of this.plucks.values())held[p.part]=1;
  for(let i=0;i<o.length;i++)if(!held[i/3|0])for(let n=0;n<steps;n++){v[i]+=(-k*o[i]-c*v[i])*dt;o[i]+=v[i]*dt;}
  if(h>0){const fade=Math.exp(-h/GLOW_TAU);for(let i=0;i<s.partGlow.length;i++)s.partGlow[i]=s.partGlow[i]<.002?0:s.partGlow[i]*fade;}
  const rate=ease(Math.max(h,1e-6),PLUCK_TAU);
  for(const p of this.plucks.values()){
   const dx=p.x-p.sx,dy=p.y-p.sy,dz=p.z-p.sz,l=Math.hypot(dx,dy,dz);
   s.partGlow[p.part]=1;
   if(this.behaviour.dragged?.(p.part,dx,dy,dz,this.context))continue;
   // Free inside the reach, then a rubber band that tightens toward a hard stop.
   const f=l>REACH?(REACH+(1-Math.exp(-(l-REACH)/REACH_SOFT))*REACH_SOFT)/l:1,i=p.part*3;
   o[i]+=(p.ox+dx*f-o[i])*rate;o[i+1]+=(p.oy+dy*f-o[i+1])*rate;o[i+2]+=(p.oz+dz*f-o[i+2])*rate;
   v[i]=v[i+1]=v[i+2]=0;s.partGlow[p.part]=1;
  }
 }
 private easeFields(h:number){
  const list=this.scene.fields;list.length=0;
  for(const [id,field] of this.fields){
   const rate=h/FIELD_EASE;field.strength=field.target?Math.min(1,field.strength+rate):Math.max(0,field.strength-rate);
   if(!field.target&&field.strength<=0)this.fields.delete(id);else list.push(field);
  }
 }
 private easeExplode(h:number){
  const s=this.scene;
  if(this.tear)s.explode+=(this.tearTarget-s.explode)*ease(Math.max(h,1e-6),TEAR_TAU);
  else if(this.fallT<1){this.fallT=Math.min(1,this.fallT+h/TEAR_FALL);const t=this.fallT;s.explode=this.fallFrom*(1-t*t*(3-2*t));}
  if(s.explode>TEAR_CUE&&this.tearArmed){this.tearArmed=false;this.sounds.push({type:'tear'});}
  else if(s.explode<TEAR_REARM)this.tearArmed=true;
 }
 private easeSlice(h:number){
  const slice=this.scene.slice,target=this.sliceTarget;
  if(target===null){slice.amount=Math.max(0,slice.amount-h/SLICE_EASE);return;}
  slice.x=slice.amount>0?slice.x+(target-slice.x)*ease(Math.max(h,1e-6),SLICE_TAU):target;
  slice.amount=Math.min(1,slice.amount+h/SLICE_EASE);
 }
 private hoverLabel(h:number){
  const s=this.scene,point=this.fingerHover??(this.context.frozen?null:this.mouseHover);let part=-1,at:WorldPoint|null=null;
  this.hoverClock+=h;
  if(!point)this.hoverPart=-1;
  else if(this.hoverClock>=HOVER_PERIOD){this.hoverClock=0;this.hoverPart=this.world.partAt(point);}
  for(const p of this.plucks.values()){part=p.part;at=p;}
  if(part<0&&this.hoverPart>=0&&this.hoverPart<s.partGlow.length){part=this.hoverPart;at=point;}
  if(part<0||!at){s.label=null;return;}
  const text=this.behaviour.describe(part),box=this.box;
  box.title=text.title;box.detail=text.detail;box.x=at.x;box.y=at.y;box.z=at.z;s.label=box;
 }
}
