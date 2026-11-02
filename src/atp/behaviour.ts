import {Quaternion,Vector3} from 'three';
import {EPS,GOLDEN,REV,clamp,ease,wrap} from '../mirror/engine';
import type {MirrorBehaviour,MirrorContext} from '../mirror/contracts';
import {type AtpScene,type AtpSceneExtra,type AtpSkin,type AtpSound,type AtpSpark,type AtpWorld} from './contracts';

// c10 ring: 10 protons and 3 ATP per full turn.
const ATP_STEP=REV/3,PROTON_STEP=REV/10;
const IDLE_SPEED=.2*REV,IDLE_TAU=.6,MOTOR_SPEED=1.5*REV,MOTOR_TAU=.35,SPEED_CAP=3*REV,FRICTION_TAU=.77,REST_SPEED=.05,KICK=.75*REV,KICK_CAP=1.5*REV;
const STIR_TAU=.2;
const ATP_LIFE=4,ATP_SPEED=.8,ATP_CAP=60,ATP_CURVE=.35,HYDROLYSIS_LIFE=1.2,HYDROLYSIS_REACH=2.4;
const PROTON_LIFE=1,PROTON_CAP=80,PROTON_LOW=-3.4,PROTON_HIGH=-.9,PROTON_RADIUS=.55,PROTON_TURNS=2,POP_RADIUS=.45;
const SOUND_BURST=4;
const chainKinds:[RegExp,string,string][]=[
 [/\bbeta\b/i,'β subunit','catalytic head'],[/\balpha\b/i,'α subunit','nucleotide-binding head'],[/\bgamma\b/i,'γ shaft','central rotor shaft'],
 [/\bepsilon\b/i,'ε subunit','rotor regulator'],[/\bdelta\b/i,'δ subunit','stator cap'],[/subunit b$/i,'b stalk','peripheral stalk'],
 [/subunit a$/i,'a subunit','proton channel'],[/subunit c$/i,'c ring blade','proton-carrying ring'],
];
type Context=MirrorContext<AtpSkin,AtpSceneExtra,AtpSound>;
interface Spark extends AtpSpark {age:number;span:number;vx:number;vy:number;vz:number;curve:number;phase:number;rising:boolean}

/** The rotor: spin, the ATP and proton tally, sparks and chain names. */
export class AtpBehaviour implements MirrorBehaviour<AtpSkin,AtpSceneExtra,AtpSound> {
 angle=0;omega=0;count=0;
 /** Off by default so the rotor coasts to rest; the page turns it on to keep the motor visibly running. */
 idle=false;
 private driving=0;private atpMark=0;private protonMark=0;private started=false;private spawned=0;
 private betas:number[]=[];private titles:{title:string;detail:string}[]=[];
 private q=new Quaternion();private v=new Vector3();
 constructor(private world:AtpWorld){}

 initialScene():AtpSceneExtra{return {rotorAngle:0,rotorSpeed:0,sparks:[],};}
 fit(n:number){this.titles=[];this.betas=Array.from({length:n},(_,i)=>i).filter(i=>/\bbeta\b/i.test(this.world.partInfo(i).name));}
 describe(i:number){
  if(this.titles[i])return this.titles[i];
  const info=this.world.partInfo(i),kind=chainKinds.find(([re])=>re.test(info.name));
  return this.titles[i]={title:kind?.[1]??info.name,detail:`Chain ${info.id} · ${info.residues} residues${kind?` · ${kind[2]}`:''}`};
 }
 drive(direction:number){this.driving=direction;}
 // Fingers drag the flywheel up to their own speed or against it, but cannot hold it back from behind.
 stir(speed:number,elapsed:number){if(speed*this.omega<0||Math.abs(speed)>Math.abs(this.omega))this.omega+=(speed-this.omega)*ease(elapsed,STIR_TAU);}
 advance(h:number,c:Context){this.started=true;this.spin(h,c);this.tally(c);}
 settle(h:number,c:Context){this.sparks(h,c);}
 publish(c:Context){const s=c.scene;s.rotorAngle=this.angle;s.rotorSpeed=this.omega/REV;c.sound({type:'motor',speed:this.idling?0:s.rotorSpeed});}
 reset(s:AtpScene){this.angle=this.omega=this.driving=this.count=this.atpMark=this.protonMark=0;this.started=false;s.rotorAngle=s.rotorSpeed=0;s.sparks.length=0;}
 /** Phase inputs are 0..360 while the rotor is unbounded, so a scrub takes the shortest arc; before the first step it restores silently. */
 setRotorDegrees(n:number){
  if(!Number.isFinite(n))return;
  this.omega=0;const target=n*Math.PI/180;
  if(!this.started){this.angle=target;this.atpMark=Math.floor(target/ATP_STEP+EPS);this.protonMark=Math.floor(target/PROTON_STEP+EPS);return;}
  this.angle+=wrap(target-this.angle);
 }
 /** Bounded so a caller nudging every frame settles at KICK_CAP; it never brakes a faster spin. */
 kick(direction:1|-1){
  const next=this.omega+direction*KICK;
  this.omega=direction>0?Math.max(this.omega,Math.min(next,KICK_CAP)):Math.min(this.omega,Math.max(next,-KICK_CAP));
 }

 /** The resting motor is silent, so a page left open does not drone. */
 private get idling(){return this.idle&&!this.driving&&this.omega>=0&&this.omega<IDLE_SPEED*1.25;}
 private spin(h:number,c:Context){
  const motor=this.driving*MOTOR_SPEED,idle=this.idle&&!c.frozen&&!this.driving;
  if(this.driving&&this.omega*this.driving<MOTOR_SPEED)this.omega+=(motor-this.omega)*ease(h,MOTOR_TAU);
  else if(idle&&this.omega<IDLE_SPEED)this.omega+=(IDLE_SPEED-this.omega)*ease(h,IDLE_TAU);
  else if(h>0)this.omega=idle?IDLE_SPEED+(this.omega-IDLE_SPEED)*Math.exp(-h/FRICTION_TAU):this.omega*Math.exp(-h/FRICTION_TAU);
  this.omega=clamp(this.omega,-SPEED_CAP,SPEED_CAP);
  if(!this.driving&&!idle&&Math.abs(this.omega)<REST_SPEED)this.omega=0;
  this.angle+=this.omega*h;
 }
 /** The three β chains take turns, one for each 120° of the rotor. */
 private flashSite(c:Context){if(this.betas.length){const n=this.betas.length;c.glow(this.betas[(this.atpMark%n+n)%n],.9);}}
 // One mark per quantity with a full-step dead band: leaving k needs floor to pass k+1 or ceil to pass k-1, so boundary jitter cannot count.
 private tally(c:Context){
  const a=this.angle/ATP_STEP,up=Math.floor(a+EPS)-this.atpMark,down=this.atpMark-Math.ceil(a-EPS);
  if(up>0){
   this.atpMark+=up;this.count+=up;
   for(let i=0;i<Math.min(up,ATP_CAP);i++)this.spawnAtp(false,c);
   if(!this.idling)for(let i=0;i<Math.min(up,SOUND_BURST);i++)c.sound({type:'atp'});
   this.flashSite(c);
  }else if(down>0){
   this.atpMark-=down;const burned=Math.min(this.count,down);this.count-=burned;if(burned)this.flashSite(c);
   for(let i=0;i<Math.min(burned,ATP_CAP);i++)this.spawnAtp(true,c);
  }
  const p=this.angle/PROTON_STEP,in_=Math.floor(p+EPS)-this.protonMark,out=this.protonMark-Math.ceil(p-EPS);
  if(in_>0){this.protonMark+=in_;for(let i=0;i<Math.min(in_,PROTON_CAP);i++)this.spawnProton(true,c);}
  else if(out>0){this.protonMark-=out;for(let i=0;i<Math.min(out,PROTON_CAP);i++)this.spawnProton(false,c);}
 }
 private spawnAtp(inward:boolean,c:Context){
  const head=this.world.headPoint(),n=this.spawned++,v=this.v.set(head.x-c.view.x,head.y-c.view.y,head.z);
  if(v.lengthSq()<EPS)v.set(0,1,0);
  v.normalize();v.x+=Math.cos(n*GOLDEN)*.6;v.z+=Math.sin(n*GOLDEN)*.6;v.normalize();
  const span=inward?HYDROLYSIS_LIFE:ATP_LIFE,reach=inward?HYDROLYSIS_REACH:0,speed=inward?-HYDROLYSIS_REACH/HYDROLYSIS_LIFE:ATP_SPEED;
  this.add({kind:'atp',x:head.x+v.x*reach,y:head.y+v.y*reach,z:head.z+v.z*reach,life:1,age:0,span,vx:v.x*speed,vy:v.y*speed,vz:v.z*speed,curve:inward?0:n%2?ATP_CURVE:-ATP_CURVE,phase:0,rising:false},ATP_CAP,c);
 }
 private spawnProton(rising:boolean,c:Context){
  const phase=this.spawned++*GOLDEN,spark:Spark={kind:'proton',x:0,y:0,z:0,life:1,age:0,span:PROTON_LIFE,vx:0,vy:0,vz:0,curve:0,phase,rising};
  this.placeProton(spark,c);this.add(spark,PROTON_CAP,c);
 }
 private add(spark:Spark,cap:number,c:Context){
  const list=c.scene.sparks as Spark[];let live=0;
  for(const s of list)if(s.kind===spark.kind)live++;
  if(live>=cap)list.splice(list.findIndex(s=>s.kind===spark.kind),1);
  list.push(spark);
 }
 // Protons live in the molecule's frame, so the spiral stays threaded through the ring however it is held.
 private placeProton(s:Spark,c:Context){
  const t=s.age/s.span,y=PROTON_LOW+(PROTON_HIGH-PROTON_LOW)*(s.rising?t:1-t),a=s.phase+t*REV*PROTON_TURNS*(s.rising?1:-1),view=c.view;
  this.v.set(Math.cos(a)*PROTON_RADIUS,y,Math.sin(a)*PROTON_RADIUS).applyQuaternion(this.q.fromArray(view.q).normalize()).multiplyScalar(view.zoom);
  s.x=this.v.x+view.x;s.y=this.v.y+view.y;s.z=this.v.z;
 }
 private sparks(h:number,c:Context){
  const list=c.scene.sparks as Spark[];let kept=0;
  for(const s of list){
   s.age+=h;if(s.age>=s.span)continue;
   s.life=1-s.age/s.span;
   if(s.kind==='proton')this.placeProton(s,c);
   else{
    const cos=Math.cos(s.curve*h),n=Math.sin(s.curve*h),vx=s.vx*cos-s.vy*n,vy=s.vx*n+s.vy*cos;s.vx=vx;s.vy=vy;
    s.x+=vx*h;s.y+=vy*h;s.z+=s.vz*h;
    if(!c.frozen&&c.touching(s.x,s.y,POP_RADIUS)){c.sound({type:'pop'});continue;}
   }
   list[kept++]=s;
  }
  list.length=kept;
 }
}
