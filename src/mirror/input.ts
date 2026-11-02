import {Quaternion,Vector3} from 'three';
import type {Packet,Quat} from '../types';
import type {MirrorInputTarget,MirrorTool} from './contracts';

const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const validQ=(q:unknown):q is Quat=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.abs(Math.hypot(...q)-1)<.1;
const wrap=(angle:number)=>((angle+180)%360+360)%360-180;
const screenPose=(q:Quat,angle:number)=>new Quaternion().fromArray(q).normalize().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-angle*Math.PI/180));

/** Motion uses the acknowledged fresh grab already supplied by ControlClient. */
export class MirrorPhoneInput {
 enabled=true;held=false;private lastFrame=-Infinity;private mustRelease=true;private reference:Quaternion|null=null;private base=new Quaternion();private phaseBase=0;private previousAngle=0;private accumulated=0;private tool:MirrorTool|null=null;private source='';private screen=0;private invert=false;
 constructor(private target:MirrorInputTarget){}
 release(){this.finish();this.mustRelease=true;}
 private finish(){if(this.held)this.target.end('phone');this.held=false;this.reference=null;}
 frame(p:Packet,now:number){
  this.lastFrame=now;const state=this.target.state();
  if(!this.enabled||state.frozen||!p.active||!p.visible||!Number.isFinite(p.screenAngle)){this.release();return;}
  const screen=Number(p.screenAngle),source=String(p.source??''),invert=!!p.invert;
  if(this.tool!==state.tool||this.screen!==screen||this.source!==source||this.invert!==invert){this.release();this.tool=state.tool;this.screen=screen;this.source=source;this.invert=invert;}
  if(!p.hold){this.finish();this.mustRelease=false;return;}
  if(!validQ(p.q)){this.release();return;}
  if(this.mustRelease)return;
  const current=screenPose(p.q,screen);
  if(!this.reference){if(!this.target.begin('phone')){this.mustRelease=true;return;}this.reference=current.clone();this.base.fromArray(state.view.q);this.phaseBase=state.phase;this.previousAngle=0;this.accumulated=0;this.held=true;}
  const delta=this.reference.clone().invert().multiply(current).normalize();
  if(state.tool==='view'){
   const map=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2);
   this.target.view(this.base.clone().multiply(map.clone().multiply(delta).multiply(map.invert())).normalize().toArray() as Quat);
  }else{
   // Unwrap signed relative x rotation so crossing +/-180 never jumps phase.
   const angle=wrap(2*Math.atan2(delta.x,delta.w)*180/Math.PI);
   this.accumulated+=wrap(angle-this.previousAngle);this.previousAngle=angle;
   this.target.phase(clamp(this.phaseBase+this.accumulated*(invert?-2:2),0,360));
  }
 }
 tick(now:number){if(!this.enabled||this.target.state().frozen||this.target.state().tool!==this.tool||now-this.lastFrame>400)this.release();}
}
