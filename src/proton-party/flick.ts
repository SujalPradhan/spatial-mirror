export interface MotionSample {
 t:number;
 /** Gyro rotation rate in degrees per second on any axes the browser reports. */
 rot?:readonly [number,number,number]|null;
 /** Acceleration without gravity, then with gravity, in m/s². Used only when there is no gyro. */
 lin?:readonly [number,number,number]|null;
 grav?:readonly [number,number,number]|null;
}
export interface FlickOptions {rotation?:number;accel?:number;refractoryMs?:number;rearm?:number}
export const FLICK:Required<FlickOptions>={rotation:240,accel:16,refractoryMs:250,rearm:.4};
export const SHAKE:Required<FlickOptions>={rotation:150,accel:10,refractoryMs:160,rearm:.5};
const GRAVITY=9.81;
const finite3=(v:unknown):v is [number,number,number]=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
const size=(v:readonly [number,number,number])=>Math.hypot(v[0],v[1],v[2]);

/** Reads the fields of a devicemotion event; the gyro (rotationRate) is preferred, acceleration is the fallback. */
export function motionSample(e:{timeStamp?:number;rotationRate?:{alpha:number|null;beta:number|null;gamma:number|null}|null;acceleration?:{x:number|null;y:number|null;z:number|null}|null;accelerationIncludingGravity?:{x:number|null;y:number|null;z:number|null}|null},t:number):MotionSample {
 const r=e.rotationRate,a=e.acceleration,g=e.accelerationIncludingGravity;
 const rot=r?[r.alpha,r.beta,r.gamma]:null,lin=a?[a.x,a.y,a.z]:null,grav=g?[g.x,g.y,g.z]:null;
 return {t,rot:finite3(rot)?rot:null,lin:finite3(lin)?lin:null,grav:finite3(grav)?grav:null};
}

/** A quick wrist flick: one burst of rotation that must settle before the next one counts. */
export class FlickDetector {
 private armed=true;private last=-Infinity;private o:Required<FlickOptions>;
 /** Which sensor the last sample was read from, so a page can tell the player when no motion is available. */
 source:'gyro'|'accel'|null=null;
 constructor(options:FlickOptions={}){this.o={...FLICK,...options};}
 /** Strength of a sample as a multiple of the trigger level, or null when it carries no motion data. */
 strength(s:MotionSample):number|null{
  if(finite3(s.rot)){this.source='gyro';return size(s.rot)/this.o.rotation;}
  if(finite3(s.lin)){this.source='accel';return size(s.lin)/this.o.accel;}
  if(finite3(s.grav)){this.source='accel';return Math.abs(size(s.grav)-GRAVITY)/this.o.accel;}
  return null;
 }
 /** True when this sample is the start of a new flick. */
 feed(s:MotionSample):boolean{
  const k=this.strength(s);if(k===null||!Number.isFinite(s.t))return false;
  if(k<this.o.rearm){this.armed=true;return false;}
  if(k<1||!this.armed||s.t-this.last<this.o.refractoryMs)return false;
  this.armed=false;this.last=s.t;return true;
 }
 reset(){this.armed=true;this.last=-Infinity;this.source=null;}
}
