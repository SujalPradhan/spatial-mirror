import {Quaternion,Vector3} from 'three';
import type {Quat} from '../types';
import {atpSkins,type AtpEngineOutput,type AtpField,type AtpHandView,type AtpLabel,type AtpScene,type AtpSound,type AtpSpark,type AtpViewPatch,type AtpViewState,type AtpWorld,type GestureFrame,type HandPose,type TrackedHand,type WorldPoint} from './contracts';

const REV=Math.PI*2,MAX_DT=.05,EPS=1e-9;
// c10 ring: 10 protons and 3 ATP per full turn.
const ATP_STEP=REV/3,PROTON_STEP=REV/10;
const MOTOR_SPEED=1.5*REV,MOTOR_TAU=.35,SPEED_CAP=3*REV,FRICTION_TAU=.77,REST_SPEED=.05,KICK=.75*REV,KICK_CAP=1.5*REV;
const STIR_MIN=.5,STIR_TAU=.2,STIR_RADIUS=.4,STILL_SPEED=1.2,HOVER_PERIOD=.1;
const ORBIT=.55,ZOOM_MIN=.65,ZOOM_MAX=2.5;
const FIELD_RADIUS=1.5,FIELD_EASE=.15;
const SPRING_W=REV*3,SPRING_DECAY=3.26,SPRING_H=1/240,PLUCK_TAU=.04,REACH=3,REACH_SOFT=1.5,JOLT=.6,GLOW_TAU=.45;
const TEAR_SPAN=.35,TEAR_TAU=.05,TEAR_FALL=1.5,TEAR_CUE=.3,TEAR_REARM=.15;
const SHOCK_LIFE=1.5,SHOCK_IMPULSE=13,GOLDEN=2.399963;
const SLICE_EASE=.2,SLICE_TAU=.08;
const ATP_LIFE=4,ATP_SPEED=.8,ATP_CAP=60,ATP_CURVE=.35,HYDROLYSIS_LIFE=1.2,HYDROLYSIS_REACH=2.4;
const PROTON_LIFE=1,PROTON_CAP=80,PROTON_LOW=-3.4,PROTON_HIGH=-.9,PROTON_RADIUS=.55,PROTON_TURNS=2,POP_RADIUS=.45;
const POINTER=-1,SOUND_BURST=4;

const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const wrap=(a:number)=>a-REV*Math.ceil((a-Math.PI)/REV);
const ease=(h:number,tau:number)=>1-Math.exp(-h/tau);
const X=new Vector3(1,0,0),Y=new Vector3(0,1,0),Z=new Vector3(0,0,1);
const chainKinds:[RegExp,string,string][]=[
 [/\bbeta\b/i,'β subunit','catalytic head'],[/\balpha\b/i,'α subunit','nucleotide-binding head'],[/\bgamma\b/i,'γ shaft','central rotor shaft'],
 [/\bepsilon\b/i,'ε subunit','rotor regulator'],[/\bdelta\b/i,'δ subunit','stator cap'],[/subunit b$/i,'b stalk','peripheral stalk'],
 [/subunit a$/i,'a subunit','proton channel'],[/subunit c$/i,'c ring blade','proton-carrying ring'],
];

interface Grip {two:boolean;a:number;b:number;base:Quaternion;x:number;y:number;zoom:number;ref:Quaternion|null;px:number;py:number;distance:number;angle:number;roll:number}
interface Pluck {chain:number;sx:number;sy:number;sz:number;ox:number;oy:number;oz:number;x:number;y:number;z:number}
interface Tear {a:number;b:number;start:number;base:number}
interface Stir {angle:number;x:number;y:number}
interface HandCache {view:AtpHandView;palm:WorldPoint;tip:WorldPoint}
interface Spark extends AtpSpark {age:number;span:number;vx:number;vy:number;vz:number;curve:number;phase:number;rising:boolean}

export class AtpEngine {
 private scene:AtpScene={rotorAngle:0,rotorSpeed:0,explode:0,chainOffsets:new Float32Array(0),chainGlow:new Float32Array(0),fields:[],shocks:[],slice:{amount:0,x:0},skin:atpSkins[0],sparks:[],hands:[],label:null};
 private velocity=new Float32Array(0);private held=new Uint8Array(0);private titles:{title:string;detail:string}[]=[];
 private angle=0;private omega=0;private drive=0;private count=0;private atpMark=0;private protonMark=0;private started=false;
 private lastAt=NaN;private sinceFrame=0;private frozen=false;private sounds:AtpSound[]=[];private spawned=0;
 private grip:Grip|null=null;private plucks=new Map<number,Pluck>();private tear:Tear|null=null;private tearTarget=0;private fallFrom=0;private fallT=1;private tearArmed=true;
 private fields=new Map<number,AtpField&{target:number}>();private stirs=new Map<number,Stir>();private pinching=new Set<number>();private cache=new Map<number,HandCache>();private lastPose=new Map<number,HandPose>();
 private fingerHover:WorldPoint|null=null;private mouseHover:WorldPoint|null=null;private hoverChain=-1;private hoverClock=HOVER_PERIOD;
 private sliceTarget:number|null=null;private skinIndex=0;private box:AtpLabel={title:'',detail:'',x:0,y:0,z:0};
 private view:AtpViewState={q:[0,0,0,1],zoom:1,x:0,y:0};
 private q=new Quaternion();private q2=new Quaternion();private v=new Vector3();
 constructor(private world:AtpWorld){this.fit();}

 get atp(){return this.count;}
 get rotorDegrees(){return this.angle*180/Math.PI;}
 /** Phase inputs are 0..360 while the rotor is unbounded, so a scrub takes the shortest arc; before the first step it restores silently. */
 setRotorDegrees(n:number){
  if(!Number.isFinite(n))return;
  this.omega=0;const target=n*Math.PI/180;
  if(!this.started){this.angle=target;this.atpMark=Math.floor(target/ATP_STEP+EPS);this.protonMark=Math.floor(target/PROTON_STEP+EPS);return;}
  this.angle+=wrap(target-this.angle);
 }
 /** Bounded so a caller nudging every frame settles at KICK_CAP; it never brakes a faster spin. */
 kick(direction:1|-1){
  if(this.frozen)return;
  const next=this.omega+direction*KICK;
  this.omega=direction>0?Math.max(this.omega,Math.min(next,KICK_CAP)):Math.min(this.omega,Math.max(next,-KICK_CAP));
 }
 pointerDown(p:WorldPoint){this.fit();return !this.frozen&&this.grab(POINTER,p);}
 pointerMove(p:WorldPoint){const pluck=this.plucks.get(POINTER);if(pluck){pluck.x=p.x;pluck.y=p.y;pluck.z=p.z;}}
 pointerUp(){this.release(POINTER,true);}
 hover(p:WorldPoint|null){this.mouseHover=p;}
 reset(){
  const s=this.scene;this.angle=this.omega=this.drive=this.count=this.atpMark=this.protonMark=0;this.started=false;this.lastAt=NaN;this.sinceFrame=0;this.sounds=[];
  this.grip=this.tear=null;this.plucks.clear();this.tearTarget=0;this.fallFrom=0;this.fallT=1;this.tearArmed=true;this.fields.clear();this.stirs.clear();this.pinching.clear();this.cache.clear();this.lastPose.clear();
  this.fingerHover=this.mouseHover=null;this.hoverChain=-1;this.hoverClock=HOVER_PERIOD;this.sliceTarget=null;this.skinIndex=0;
  s.rotorAngle=s.rotorSpeed=s.explode=s.slice.amount=s.slice.x=0;s.skin=atpSkins[0];s.label=null;s.chainOffsets.fill(0);s.chainGlow.fill(0);this.velocity.fill(0);s.fields.length=s.shocks.length=s.sparks.length=s.hands.length=0;
 }

 step(frame:GestureFrame,dt:number,view:AtpViewState,frozen:boolean):AtpEngineOutput{
  const h=Number.isFinite(dt)?clamp(dt,0,MAX_DT):0,s=this.scene;
  this.fit();this.started=true;this.frozen=frozen;this.view=view;this.sinceFrame+=h;
  let patch:AtpViewPatch|null=null;
  if(frame.at!==this.lastAt){
   this.lastAt=frame.at;this.track(frame);
   if(!frozen)patch=this.gestures(frame,view);
   this.sinceFrame=0;
  }
  if(frozen)this.calm();
  this.spin(h);this.tally();this.springs(h);this.easeFields(h);this.easeExplode(h);this.easeSlice(h);this.sparks(h);
  for(let i=s.shocks.length-1;i>=0;i--)if((s.shocks[i].age+=h)>=SHOCK_LIFE)s.shocks.splice(i,1);
  this.hoverLabel(h);
  s.rotorAngle=this.angle;s.rotorSpeed=this.omega/REV;
  this.sounds.push({type:'motor',speed:s.rotorSpeed});
  const sounds=this.sounds;this.sounds=[];
  return {scene:s,view:patch,sounds,atp:this.count,holding:!!this.grip};
 }

 // Chains arrive with the model, which can finish loading after construction.
 private fit(){
  const n=this.world.chainCount,s=this.scene;if(s.chainGlow.length===n)return;
  s.chainOffsets=new Float32Array(n*3);s.chainGlow=new Float32Array(n);this.velocity=new Float32Array(n*3);this.held=new Uint8Array(n);this.titles=[];this.plucks.clear();
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
    if(e.pose==='love'&&this.lastPose.get(e.handId)!=='love'&&!this.frozen){s.skin=atpSkins[this.skinIndex=(this.skinIndex+1)%atpSkins.length];this.sounds.push({type:'skin'});}
    this.lastPose.set(e.handId,e.pose);
   }else if(!this.frozen)this.clap(this.world.mirrorToWorld({x:e.x,y:e.y,z:0}));
  }
 }
 private gestures(frame:GestureFrame,view:AtpViewState){
  const patch=this.hold(frame,view),elapsed=this.sinceFrame;
  this.drive=Math.sign(frame.hands.reduce((n,h)=>n+(h.pose==='thumbUp'?1:h.pose==='thumbDown'?-1:0),0));
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
 private hold(frame:GestureFrame,view:AtpViewState):AtpViewPatch|null{
  const fists=frame.hands.filter(h=>h.pose==='fist').sort((a,b)=>a.id-b.id);
  if(!fists.length){this.grip=null;return null;}
  return fists.length>1?this.holdTwo(fists[0],fists[1],view):this.holdOne(fists[0],view);
 }
 private rebase(view:AtpViewState,two:boolean,a:number,b:number,px:number,py:number,ref:Quaternion|null,distance:number,angle:number):Grip{
  return {two,a,b,base:new Quaternion().fromArray(view.q).normalize(),x:view.x,y:view.y,zoom:view.zoom,ref,px,py,distance:Math.max(distance,.01),angle,roll:0};
 }
 private holdOne(hand:TrackedHand,view:AtpViewState):AtpViewPatch{
  const palm=this.cache.get(hand.id)!.palm,o=hand.orientation;let g=this.grip;
  // Any change of source rebases on the live view, which is what keeps every transition jump-free.
  if(!g||g.two||g.a!==hand.id||!g.ref!==!o)g=this.grip=this.rebase(view,false,hand.id,-1,palm.x,palm.y,o?new Quaternion().fromArray(o).normalize():null,1,0);
  const dx=palm.x-g.px,dy=palm.y-g.py;
  if(o&&g.ref)this.q.fromArray(o).normalize().multiply(this.q2.copy(g.ref).invert());
  else this.q.setFromAxisAngle(Y,dx*ORBIT).multiply(this.q2.setFromAxisAngle(X,-dy*ORBIT));
  this.q.multiply(g.base).normalize();
  return {q:this.q.toArray() as Quat,x:g.x+dx,y:g.y+dy};
 }
 private holdTwo(a:TrackedHand,b:TrackedHand,view:AtpViewState):AtpViewPatch{
  const pa=this.cache.get(a.id)!.palm,pb=this.cache.get(b.id)!.palm,mx=(pa.x+pb.x)/2,my=(pa.y+pb.y)/2,distance=Math.hypot(pb.x-pa.x,pb.y-pa.y),angle=Math.atan2(pb.y-pa.y,pb.x-pa.x);let g=this.grip;
  if(!g||!g.two||g.a!==a.id||g.b!==b.id)g=this.grip=this.rebase(view,true,a.id,b.id,mx,my,null,distance,angle);
  // Accumulated so hands passing through vertical never flip the roll by a full turn.
  g.roll+=wrap(angle-g.angle);g.angle=angle;
  this.q.setFromAxisAngle(Z,g.roll).multiply(g.base).normalize();
  return {q:this.q.toArray() as Quat,x:g.x+mx-g.px,y:g.y+my-g.py,zoom:clamp(g.zoom*distance/g.distance,ZOOM_MIN,ZOOM_MAX)};
 }
 private stir(id:number,c:HandCache,view:AtpViewState,elapsed:number){
  const rx=c.tip.x-view.x,ry=c.tip.y-view.y,angle=Math.atan2(ry,rx),old=this.stirs.get(id);
  this.stirs.set(id,{angle,x:c.tip.x,y:c.tip.y});
  if(!old||elapsed<=0)return false;
  if(Math.hypot(c.tip.x-old.x,c.tip.y-old.y)/elapsed<STILL_SPEED)this.fingerHover=c.tip;
  // The angle is meaningless near the centre, where tiny tracking noise spans whole quadrants.
  if(Math.hypot(rx,ry)<STIR_RADIUS)return false;
  const speed=wrap(angle-old.angle)/elapsed;if(Math.abs(speed)<STIR_MIN)return false;
  // Fingers drag the flywheel up to their own speed or against it, but cannot hold it back from behind.
  if(speed*this.omega<0||Math.abs(speed)>Math.abs(this.omega))this.omega+=(speed-this.omega)*ease(elapsed,STIR_TAU);
  return true;
 }
 private pinches(frame:GestureFrame){
  const pinches=frame.hands.filter(h=>h.pose==='pinch').sort((a,b)=>a.id-b.id);
  for(const key of this.plucks.keys())if(key!==POINTER&&!pinches.some(h=>h.id===key))this.release(key,true);
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
   if(pinches.length&&!this.pinching.has(pinches[0].id))this.grab(pinches[0].id,this.world.mirrorToWorld(pinches[0].pinch));
   else if(pinches.length){const pluck=this.plucks.get(pinches[0].id);if(pluck){const p=this.world.mirrorToWorld(pinches[0].pinch);pluck.x=p.x;pluck.y=p.y;pluck.z=p.z;}}
   if(pinches.length)this.cache.get(pinches[0].id)!.view.active=this.plucks.has(pinches[0].id);
  }
  this.pinching.clear();for(const hand of pinches)this.pinching.add(hand.id);
 }
 private endTear(){if(this.tear){this.tear=null;this.fallFrom=this.scene.explode;this.fallT=0;}}
 private grab(key:number,p:WorldPoint){
  const chain=this.world.chainAt(p);
  if(chain<0||chain>=this.scene.chainGlow.length)return false;
  for(const pluck of this.plucks.values())if(pluck.chain===chain)return false;
  const o=this.scene.chainOffsets,i=chain*3;
  this.plucks.set(key,{chain,sx:p.x,sy:p.y,sz:p.z,ox:o[i],oy:o[i+1],oz:o[i+2],x:p.x,y:p.y,z:p.z});
  this.sounds.push({type:'pluck'});return true;
 }
 private release(key:number,loud:boolean){
  const pluck=this.plucks.get(key);if(!pluck)return;
  this.plucks.delete(key);if(loud)this.sounds.push({type:'snap'});
  const n=this.scene.chainGlow.length,o=this.scene.chainOffsets,i=pluck.chain*3;
  this.velocity.fill(0,i,i+3);
  for(const neighbour of [(pluck.chain+1)%n,(pluck.chain+n-1)%n]){
   if(neighbour===pluck.chain)continue;
   for(let k=0;k<3;k++)this.velocity[neighbour*3+k]+=o[i+k]*JOLT;
   this.scene.chainGlow[neighbour]=Math.max(this.scene.chainGlow[neighbour],.35);
  }
 }
 private clap(p:WorldPoint){
  const s=this.scene,n=s.chainGlow.length,a=this.v.set(this.view.x-p.x,this.view.y-p.y,-p.z);
  if(a.lengthSq()>EPS)a.normalize();else a.set(0,0,0);
  s.shocks.push({x:p.x,y:p.y,z:p.z,age:0});this.sounds.push({type:'shock'});
  for(let i=0;i<n;i++){
   // Without chain centres, a fixed golden-angle spread keeps the burst radial and repeatable.
   const y=1-2*(i+.5)/n,r=Math.sqrt(Math.max(0,1-y*y)),t=i*GOLDEN;
   let dx=Math.cos(t)*r+a.x,dy=y+a.y,dz=Math.sin(t)*r+a.z;const l=Math.hypot(dx,dy,dz)||1;dx/=l;dy/=l;dz/=l;
   this.velocity[i*3]+=dx*SHOCK_IMPULSE;this.velocity[i*3+1]+=dy*SHOCK_IMPULSE;this.velocity[i*3+2]+=dz*SHOCK_IMPULSE;
   s.chainGlow[i]=Math.max(s.chainGlow[i],.6);
  }
 }
 private calm(){
  this.grip=null;this.drive=0;this.sliceTarget=null;this.fingerHover=this.mouseHover=null;this.stirs.clear();this.endTear();
  for(const field of this.fields.values())field.target=0;
  for(const key of [...this.plucks.keys()])this.release(key,true);
 }
 private spin(h:number){
  const motor=this.drive*MOTOR_SPEED;
  if(this.drive&&this.omega*this.drive<MOTOR_SPEED)this.omega+=(motor-this.omega)*ease(h,MOTOR_TAU);
  else if(h>0)this.omega*=Math.exp(-h/FRICTION_TAU);
  this.omega=clamp(this.omega,-SPEED_CAP,SPEED_CAP);
  if(!this.drive&&Math.abs(this.omega)<REST_SPEED)this.omega=0;
  this.angle+=this.omega*h;
 }
 // One mark per quantity with a full-step dead band: leaving k needs floor to pass k+1 or ceil to pass k-1, so boundary jitter cannot count.
 private tally(){
  const a=this.angle/ATP_STEP,up=Math.floor(a+EPS)-this.atpMark,down=this.atpMark-Math.ceil(a-EPS);
  if(up>0){
   this.atpMark+=up;this.count+=up;
   for(let i=0;i<Math.min(up,ATP_CAP);i++)this.spawnAtp(false);
   for(let i=0;i<Math.min(up,SOUND_BURST);i++)this.sounds.push({type:'atp'});
  }else if(down>0){
   this.atpMark-=down;const burned=Math.min(this.count,down);this.count-=burned;
   for(let i=0;i<Math.min(burned,ATP_CAP);i++)this.spawnAtp(true);
  }
  const p=this.angle/PROTON_STEP,in_=Math.floor(p+EPS)-this.protonMark,out=this.protonMark-Math.ceil(p-EPS);
  if(in_>0){this.protonMark+=in_;for(let i=0;i<Math.min(in_,PROTON_CAP);i++)this.spawnProton(true);}
  else if(out>0){this.protonMark-=out;for(let i=0;i<Math.min(out,PROTON_CAP);i++)this.spawnProton(false);}
 }
 private spawnAtp(inward:boolean){
  const head=this.world.headPoint(),n=this.spawned++,v=this.v.set(head.x-this.view.x,head.y-this.view.y,head.z);
  if(v.lengthSq()<EPS)v.set(0,1,0);
  v.normalize();v.x+=Math.cos(n*GOLDEN)*.6;v.z+=Math.sin(n*GOLDEN)*.6;v.normalize();
  const span=inward?HYDROLYSIS_LIFE:ATP_LIFE,reach=inward?HYDROLYSIS_REACH:0,speed=inward?-HYDROLYSIS_REACH/HYDROLYSIS_LIFE:ATP_SPEED;
  this.add({kind:'atp',x:head.x+v.x*reach,y:head.y+v.y*reach,z:head.z+v.z*reach,life:1,age:0,span,vx:v.x*speed,vy:v.y*speed,vz:v.z*speed,curve:inward?0:n%2?ATP_CURVE:-ATP_CURVE,phase:0,rising:false},ATP_CAP);
 }
 private spawnProton(rising:boolean){
  const phase=this.spawned++*GOLDEN,spark:Spark={kind:'proton',x:0,y:0,z:0,life:1,age:0,span:PROTON_LIFE,vx:0,vy:0,vz:0,curve:0,phase,rising};
  this.placeProton(spark);this.add(spark,PROTON_CAP);
 }
 private add(spark:Spark,cap:number){
  const list=this.scene.sparks as Spark[];let live=0;
  for(const s of list)if(s.kind===spark.kind)live++;
  if(live>=cap)list.splice(list.findIndex(s=>s.kind===spark.kind),1);
  list.push(spark);
 }
 // Protons live in the molecule's frame, so the spiral stays threaded through the ring however it is held.
 private placeProton(s:Spark){
  const t=s.age/s.span,y=PROTON_LOW+(PROTON_HIGH-PROTON_LOW)*(s.rising?t:1-t),a=s.phase+t*REV*PROTON_TURNS*(s.rising?1:-1),view=this.view;
  this.v.set(Math.cos(a)*PROTON_RADIUS,y,Math.sin(a)*PROTON_RADIUS).applyQuaternion(this.q.fromArray(view.q).normalize()).multiplyScalar(view.zoom);
  s.x=this.v.x+view.x;s.y=this.v.y+view.y;s.z=this.v.z;
 }
 private sparks(h:number){
  const list=this.scene.sparks as Spark[];let kept=0;
  for(const s of list){
   s.age+=h;if(s.age>=s.span)continue;
   s.life=1-s.age/s.span;
   if(s.kind==='proton')this.placeProton(s);
   else{
    const c=Math.cos(s.curve*h),n=Math.sin(s.curve*h),vx=s.vx*c-s.vy*n,vy=s.vx*n+s.vy*c;s.vx=vx;s.vy=vy;
    s.x+=vx*h;s.y+=vy*h;s.z+=s.vz*h;
    if(!this.frozen&&this.touched(s)){this.sounds.push({type:'pop'});continue;}
   }
   list[kept++]=s;
  }
  list.length=kept;
 }
 // Screen-plane test: hand depth from a webcam is unreliable, and overlap on screen is what the viewer sees as touching.
 private touched(s:Spark){
  for(const c of this.cache.values())if(Math.hypot(c.palm.x-s.x,c.palm.y-s.y)<POP_RADIUS||Math.hypot(c.tip.x-s.x,c.tip.y-s.y)<POP_RADIUS)return true;
  return false;
 }
 private springs(h:number){
  const s=this.scene,o=s.chainOffsets,v=this.velocity,steps=Math.ceil(h/SPRING_H),dt=steps?h/steps:0,k=SPRING_W*SPRING_W,c=2*SPRING_DECAY;
  // A held chain is skipped: the spring would otherwise drag it short of the pinch.
  const held=this.held.fill(0);for(const p of this.plucks.values())held[p.chain]=1;
  for(let i=0;i<o.length;i++)if(!held[i/3|0])for(let n=0;n<steps;n++){v[i]+=(-k*o[i]-c*v[i])*dt;o[i]+=v[i]*dt;}
  if(h>0){const fade=Math.exp(-h/GLOW_TAU);for(let i=0;i<s.chainGlow.length;i++)s.chainGlow[i]=s.chainGlow[i]<.002?0:s.chainGlow[i]*fade;}
  const rate=ease(Math.max(h,1e-6),PLUCK_TAU);
  for(const p of this.plucks.values()){
   const dx=p.x-p.sx,dy=p.y-p.sy,dz=p.z-p.sz,l=Math.hypot(dx,dy,dz);
   // Free inside the reach, then a rubber band that tightens toward a hard stop.
   const f=l>REACH?(REACH+(1-Math.exp(-(l-REACH)/REACH_SOFT))*REACH_SOFT)/l:1,i=p.chain*3;
   o[i]+=(p.ox+dx*f-o[i])*rate;o[i+1]+=(p.oy+dy*f-o[i+1])*rate;o[i+2]+=(p.oz+dz*f-o[i+2])*rate;
   v[i]=v[i+1]=v[i+2]=0;s.chainGlow[p.chain]=1;
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
 private describe(i:number){
  if(this.titles[i])return this.titles[i];
  const info=this.world.chainInfo(i),kind=chainKinds.find(([re])=>re.test(info.name));
  return this.titles[i]={title:kind?.[1]??info.name,detail:`Chain ${info.id} · ${info.residues} residues${kind?` · ${kind[2]}`:''}`};
 }
 private hoverLabel(h:number){
  const s=this.scene,point=this.fingerHover??(this.frozen?null:this.mouseHover);let chain=-1,at:WorldPoint|null=null;
  this.hoverClock+=h;
  if(!point)this.hoverChain=-1;
  else if(this.hoverClock>=HOVER_PERIOD){this.hoverClock=0;this.hoverChain=this.world.chainAt(point);}
  for(const p of this.plucks.values()){chain=p.chain;at=p;}
  if(chain<0&&this.hoverChain>=0&&this.hoverChain<s.chainGlow.length){chain=this.hoverChain;at=point;}
  if(chain<0||!at){s.label=null;return;}
  const text=this.describe(chain),box=this.box;
  box.title=text.title;box.detail=text.detail;box.x=at.x;box.y=at.y;box.z=at.z;s.label=box;
 }
}
