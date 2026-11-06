import {Quaternion,Vector3} from 'three';
import {clamp,ease,type MirrorAssisted} from '../mirror/engine';
import type {MirrorBehaviour,MirrorContext,MirrorViewState} from '../mirror/contracts';
import type {PerfumeScene,PerfumeSceneExtra,PerfumeSkin,PerfumeSound,PerfumeWorld} from './contracts';
import {activeFailures,createPump,failures,setRemoved,stepPump,type PumpState,type Spray} from './model';
import type {PartId} from './parts';

type Context=MirrorContext<PerfumeSkin,PerfumeSceneExtra,PerfumeSound>;
/** World units a part must be drawn away before it counts as taken out. The object is about 5 units tall. */
export const REMOVE_AT=1.1;
/** World units of downward hand travel that make one full stroke: the real 5.7mm is far too small to do by hand. */
export const PRESS_TRAVEL=.7;
const PRESS_DOWN=.09,PRESS_HOLD=.3,CYCLE=1.5,PARK_TAU=.18,CAMERA_LIMIT=1.2;
/** Bullet time: how slow a full slice makes the world, and the longest a rewind may hold the actuator down. */
export const BULLET=.03,REWIND_MAX=2.5;
/** Real contact in the assembly, not list order. Glass and liquid are one body, see settle. */
const touching:Partial<Record<string,string[]>>={cap:['collar'],tube:['body','ball'],body:['tube','ball','spring'],ball:['body','spring'],spring:['ball','piston'],piston:['spring','stem'],stem:['piston','actuator'],collar:['body'],actuator:['stem','nozzle'],nozzle:['actuator'],bottle:[],liquid:[]};
/** Beside the object, at each part's own height so it reads as drawn straight out. World units. The nozzle sits above the spray's path. */
const slots:Partial<Record<string,[out:number,up:number]>>={nozzle:[1.5,.55],spring:[1.9,0],ball:[1.5,0],tube:[2.3,.3],cap:[1.9,.3]};
const q=new Quaternion(),n=new Vector3();
/** Radians for the slice normal: through the axis, square to the nozzle, but never edge-on to the camera however the object is held. */
export function cutYaw(view:{q:readonly number[]}) {
 n.set(0,0,1).applyQuaternion(q.fromArray(view.q as number[]).normalize());
 if(n.z<0)n.negate();
 return Math.PI/2-clamp(Math.atan2(n.x,n.z),-CAMERA_LIMIT,CAMERA_LIMIT);
}
/** A slot lies in the cut plane, so a slice never swallows what was taken out. */
export function slotOffset(id:string,view:{q:readonly number[]},out:Float32Array,at:number) {
 const [reach,up]=slots[id]??[1.9,0],yaw=cutYaw(view);
 out[at]=Math.sin(yaw)*reach;out[at+1]=up;out[at+2]=-Math.cos(yaw)*reach;
}

/** The pump, what has been taken out of it, and what that did. */
export class PerfumeBehaviour implements MirrorBehaviour<PerfumeSkin,PerfumeSceneExtra,PerfumeSound>,MirrorAssisted {
 /** Reticles as fingers close, a moment's grace for a pinch that flickers, and the target locked as it lands. */
 readonly assist={grace:.5,regrab:.6,lock:.3};
 /** A part drawn past REMOVE_AT and still held: it comes out only when let go there, so it can be brought back first. */
 pending=-1;
 pump=createPump();idle=false;seekDegrees=0;lastSpray:Spray='none';time=1;rewindT=-1;
 private holdDepth=0;private rewound=false;
 private driving=0;private pressT=-1;private dragDepth=0;private dragBase=0;
 private held=-1;private returning=-1;private actuator=-1;private bottle=-1;private liquid=-1;
 order:PartId[]=[];private seen=false;private wasStuck=false;private wasPhase='rest';private view:MirrorViewState={q:[0,0,0,1],zoom:1,x:0,y:0};
 private ids:string[]=[];private scene:PerfumeScene|null=null;private slot=new Float32Array(3);
 constructor(private world:PerfumeWorld){}

 initialScene():PerfumeSceneExtra{const n=this.world.partCount;return {pump:this.pump,parked:new Float32Array(n),parkFrom:new Float32Array(n*3),caption:'',time:1,rewind:-1,aims:[]};}
 fit(count:number){
  this.ids=Array.from({length:count},(_,i)=>this.world.partInfo(i).id);
  this.actuator=this.ids.indexOf('actuator');this.bottle=this.ids.indexOf('bottle');this.liquid=this.ids.indexOf('liquid');
 }
 describe(i:number){const info=this.world.partInfo(i);return {title:info.title,detail:this.pump.removed.has(info.id as PartId)?'Out. Pinch it to send it back.':info.role};}
 neighbours(part:number){return (touching[this.ids[part]]??[]).map(id=>this.ids.indexOf(id)).filter(i=>i>=0);}
 drive(direction:number){
  if(direction<0&&this.driving>=0)this.rewind();
  this.driving=direction;
 }
 // Stirring the air is drawn by the view from the fingertip; pointing still names parts through the engine's chip.
 stir(){}
 kick(direction:1|-1){if(direction<0)this.rewind();else if(this.pressT<0)this.pressT=0;}
 /** 👎 runs time backwards: what is in the air streams home first, and only then does the actuator rise. */
 private rewind(){this.pressT=-1;this.seekDegrees=0;this.rewindT=0;this.holdDepth=this.pump.depth;this.rewound=true;}
 seek(degrees:number){if(Number.isFinite(degrees))this.seekDegrees=clamp(degrees,0,360);}
 grabbed(part:number,c:Context){
  this.held=part;this.dragBase=this.pump.depth;this.dragDepth=part===this.actuator?this.dragBase:0;
  if(!this.pump.removed.has(this.ids[part]as PartId))return;
  // Hands the parked part to the springs where it is, so letting go flies it home.
  const s=c.scene,i=part*3,a=s.parked[part];
  slotOffset(this.ids[part],this.view,this.slot,0);
  for(let k=0;k<3;k++)s.partOffsets[i+k]=s.parkFrom[i+k]*(1-a)+this.slot[k]*a;
  s.parked[part]=0;s.parkFrom.fill(0,i,i+3);this.returning=part;
 }
 dragged(part:number,dx:number,dy:number,_dz:number,c:Context){
  if(part===this.actuator){this.dragDepth=clamp(this.dragBase-dy/PRESS_TRAVEL,0,1);return true;}
  const id=this.ids[part] as PartId;
  if(this.world.partInfo(part).removable&&part!==this.returning&&!this.pump.removed.has(id)){
   const out=Math.hypot(dx,dy)>REMOVE_AT;
   if(out&&this.pending!==part){this.pending=part;c.sound({type:'click'});}
   else if(!out&&this.pending===part)this.pending=-1;
  }
  return false;
 }
 released(part:number,c:Context){
  this.held=-1;this.dragDepth=0;
  const s=c.scene,id=this.ids[part] as PartId,i=part*3;
  if(this.pending===part){this.pending=-1;setRemoved(this.pump,id,true);this.order.push(id);this.seen=false;c.sound({type:'tear'});}
  if(part===this.returning){this.returning=-1;setRemoved(this.pump,id,false);this.order=this.order.filter(p=>p!==id);this.seen=false;return;}
  if(!this.pump.removed.has(id))return;
  // The part stays where the hand left it and drifts to its slot, instead of the springs dragging it back through the object.
  for(let k=0;k<3;k++){s.parkFrom[i+k]=s.partOffsets[i+k];s.partOffsets[i+k]=0;}
 }
 advance(h:number,c:Context){
  this.scene=c.scene as PerfumeScene;this.view=c.view;
  const s=this.pump,a=clamp(c.scene.slice.amount,0,1);
  // Slicing slows the world, not the hand: grabs, springs and parking keep real time.
  this.time=1-(1-BULLET)*a*a*(3-2*a);
  if(c.frozen||h<=0)return;
  if(this.rewound){this.rewound=false;c.sound({type:'rewind'});}
  if(this.rewindT>=0){this.rewindT+=h;if(!(this.world.inFlight?.()??0)||this.rewindT>REWIND_MAX)this.rewindT=-1;}
  const ht=h*this.time;
  if(this.pressT>=0){this.pressT+=ht;if(this.pressT>=CYCLE)this.pressT=-1;}
  if(this.driving>0&&this.pressT<0&&this.rewindT<0)this.pressT=0;
  const t=this.pressT,pressing=t<0?0:t<PRESS_DOWN?t/PRESS_DOWN:t<PRESS_DOWN+PRESS_HOLD?1:0,finger=this.rewindT>=0?this.holdDepth:Math.max(pressing,this.held===this.actuator?this.dragDepth:0,this.seekDegrees/360);
  stepPump(s,finger,ht);
  if(s.spray!=='none'&&this.lastSpray!==s.spray)this.lastSpray=s.spray;
  if(s.phase!==this.wasPhase){
   if(s.phase==='threshold'){c.sound({type:'click'});}
   if(s.phase==='spray'||this.wasPhase==='threshold')c.sound({type:'spray',kind:s.spray==='none'?'mist':s.spray});
   this.wasPhase=s.phase;
  }
  if(s.stuck&&!this.wasStuck&&s.depth>=.99)c.sound({type:'clunk'});
  this.wasStuck=s.stuck&&s.depth>=.99;
  if(s.depth>.1)this.seen=true;
 }
 settle(h:number,c:Context){
  const s=c.scene,o=s.partOffsets,rate=ease(Math.max(h,1e-6),PARK_TAU);
  if(this.pending>=0&&this.held!==this.pending)this.pending=-1;
  // One body: left alone, a jolt or shock would slide the liquid through the glass.
  if(this.bottle>=0&&this.liquid>=0){const [from,to]=this.held===this.liquid?[this.liquid,this.bottle]:[this.bottle,this.liquid];for(let k=0;k<3;k++)o[to*3+k]=o[from*3+k];}
  for(let i=0;i<s.parked.length;i++){
   const out=this.pump.removed.has(this.ids[i] as PartId)&&i!==this.held;
   s.parked[i]=out?s.parked[i]+(1-s.parked[i])*rate:0;
   if(out)c.glow(i,.3);
  }
 }
 publish(c:Context){const s=c.scene;s.pump=this.pump;s.slice.x=c.view.x;s.caption=this.caption();s.time=this.time;s.rewind=this.rewindT;this.scene=s as PerfumeScene;}
 reset(s:PerfumeScene){this.restore(s);}
 /** Every part back, full bottle. */
 restore(s=this.scene){
  this.pump=createPump();this.order=[];this.seen=false;this.pending=-1;this.pressT=-1;this.rewindT=-1;this.time=1;this.driving=0;this.seekDegrees=0;this.lastSpray='none';this.wasStuck=false;this.wasPhase='rest';this.returning=this.held=-1;
  if(s){s.pump=this.pump;s.parked.fill(0);s.parkFrom.fill(0);s.caption='';s.time=1;s.rewind=-1;}
 }
 private caption(){
  if(this.pending>=0)return `Let go to take the ${this.world.partInfo(this.pending).title.toLowerCase()} out, or bring it back to keep it in.`;
  const s:PumpState=this.pump,last=this.order[this.order.length-1];
  if(last&&!this.seen)return `${this.partTitle(last)} is out. Press to see why it was there.`;
  const row=last?failures.find(f=>f.part===last):activeFailures(s).find(f=>f.part==='liquid');
  if(row&&(this.seen||!last))return `${row.when}. ${row.result}`;
  return last?`${this.partTitle(last)} is out. It protects the pump but takes no part in a press.`:'';
 }
 private partTitle(id:PartId){return this.world.partInfo(this.ids.indexOf(id)).title;}
}
