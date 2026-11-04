import {MirrorEngine} from '../mirror/engine';
import type {GestureFrame,MirrorViewState,TrackedHand,WorldPoint} from '../mirror/contracts';
import {DrivetrainBehaviour,MOTOR} from './behaviour';
import {drivetrainSkins,type DrivetrainOutput,type DrivetrainSceneExtra,type DrivetrainSkin,type DrivetrainSound,type DrivetrainWorld,type HandIn} from './contracts';

const TAU=Math.PI*2;
/**
 * The shared engine keeps the hand skeletons, the clap rings and the view: a fist off the train turns it, two fists off a gear scale it.
 * Every other pose is this page's, so the shared engine sees those hands as resting: an open palm parts nothing, a pinch plucks nothing.
 */
export class DrivetrainEngine extends MirrorEngine<DrivetrainSkin,DrivetrainSceneExtra,DrivetrainSound> {
 readonly train:DrivetrainBehaviour;private seen=NaN;private inputs:HandIn[]=[];
 constructor(private readonly dw:DrivetrainWorld){const train=new DrivetrainBehaviour(dw);super(dw,train,drivetrainSkins);this.train=train;}
 override get position(){return this.train.theta*180/Math.PI;}
 override get speed(){return this.train.omega/TAU;}
 override seek(degrees:number){if(Number.isFinite(degrees)&&!this.train.motor&&this.train.crankHand===null&&!this.train.sol.jammed&&!this.train.sol.broken)this.train.theta+=((degrees-this.position+540)%360-180)*Math.PI/180;}
 override kick(direction:1|-1){const t=this.train;if(this.context.frozen||t.sol.jammed||t.sol.broken||t.mode!=='build')return;t.omega=direction>0?Math.max(t.omega,MOTOR*.75):Math.min(t.omega,-MOTOR*.75);}
 override pointerDown(p:WorldPoint){const b=this.dw.worldToBoard(p);return !!b&&!this.context.frozen&&this.train.pointerDown(b,this.dw.mmPerPx(b));}
 override pointerMove(p:WorldPoint){const b=this.dw.worldToBoard(p);if(b)this.train.pointerMove(b);}
 override pointerUp(){this.train.pointerUp();}
 override hover(p:WorldPoint|null){this.train.mouse=p?this.dw.worldToBoard(p):null;}
 restore(){this.train.restore();}
 /** What the browser test reads. */
 get live(){return this.scene;}
 get hands(){return this.inputs;}
 private input(hand:TrackedHand):HandIn|null{
  const w=this.dw,pinch=w.toBoard(hand.pinch),tip=w.toBoard(hand.indexTip),palm=w.toBoard(hand.palm);
  if(!pinch||!tip||!palm)return null;
  const l=hand.landmarks,a=w.handAspect(),span=(i:number,j:number)=>Math.hypot((l[i].x-l[j].x)*a,l[i].y-l[j].y);
  return {id:hand.id,pose:hand.pose,pinch,tip,palm,ratio:l.length>=21?span(4,8)/Math.max(1e-6,span(0,9)):Infinity,speed:Math.hypot(hand.velocity.x,hand.velocity.y),
   screen:{pinch:w.toScreen(hand.pinch),tip:w.toScreen(hand.indexTip),palm:w.toScreen(hand.palm)},mmPerPx:w.mmPerPx(palm)};
 }
 override step(frame:GestureFrame,dt:number,view:MirrorViewState,frozen:boolean):DrivetrainOutput{
  const h=Number.isFinite(dt)?Math.max(0,Math.min(.05,dt)):0,fresh=frame.at!==this.seen;this.seen=frame.at;
  this.inputs=frame.hands.map(x=>this.input(x)).filter((x):x is HandIn=>!!x);
  const taken=this.train.hands(this.inputs,fresh?frame.events:[],h,frozen);
  const filtered:GestureFrame={at:frame.at,events:frame.events.filter(e=>e.type!=='pose'||e.pose!=='love'),hands:frame.hands.map(x=>x.pose==='fist'&&!taken.has(x.id)?x:{...x,pose:'none'})};
  const out=super.step(filtered,dt,view,frozen);
  // The skeleton shows the real pose, lit when this page is acting on it.
  for(const v of out.scene.hands){const real=frame.hands.find(x=>x.id===v.id);if(real){v.pose=real.pose;v.active||=taken.has(v.id)||this.train.carry?.hand===v.id||this.train.drawing===v.id;}}
  for(const s of this.train.drain())out.sounds.push(s);
  return {...out,rpm:this.train.inputRpm};
 }
}
