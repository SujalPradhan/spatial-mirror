/**
 * Landmarks → the 15 grasp joints, plus finger spread for the ghost.
 * Angles are between consecutive bone vectors, so they do not depend on where the hand is or how it is turned,
 * and the same code reads metric world landmarks (camera) or image landmarks (phone, flatter and noisier).
 */
import {JOINT_COUNT,cross,dot,len,norm,sub,type V3} from './kinematics';

export interface P {x:number;y:number;z:number}
const v=(a:P,b:P):V3=>[b.x-a.x,b.y-a.y,b.z-a.z];
const angle=(a:V3,b:V3)=>{const l=len(a)*len(b);return l>1e-12?Math.acos(Math.max(-1,Math.min(1,dot(a,b)/l))):0;};
const valid=(h:P[]|undefined|null):h is P[]=>!!h&&h.length===21&&h.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z));

/** Palm frame from the wrist (0), index knuckle (5) and little knuckle (17): y toward the fingers, x across, z the palm normal. */
export function palmFrame(h:P[]){
 const o:V3=[h[0].x,h[0].y,h[0].z],mid=[(h[5].x+h[17].x)/2,(h[5].y+h[17].y)/2,(h[5].z+h[17].z)/2] as V3;
 const y=norm(sub(mid,o));let x=v(h[5],h[17]);x=norm(sub(x,[y[0]*dot(x,y),y[1]*dot(x,y),y[2]*dot(x,y)]));
 return {o,x,y,z:cross(x,y),width:len(v(h[5],h[17]))};
}
/** Raw joint angles in radians, in the 15-joint order, and spread (radians) of the four fingers. */
export interface RawJoints {angles:Float64Array;abd:[number,number,number,number];thumbLength:number;palm:number}
export function rawJoints(h:P[]):RawJoints|null{
 if(!valid(h))return null;
 const f=palmFrame(h);if(f.width<1e-6)return null;
 const a=new Float64Array(JOINT_COUNT),abd:[number,number,number,number]=[0,0,0,0];
 // Thumb: opposition is how far the thumb (CMC→IP) stands out of the palm plane; then MCP and IP bends.
 const t=v(h[1],h[3]);a[0]=Math.asin(Math.min(1,Math.abs(dot(norm(t),f.z))));
 a[1]=angle(v(h[1],h[2]),v(h[2],h[3]));a[2]=angle(v(h[2],h[3]),v(h[3],h[4]));
 [5,9,13,17].forEach((m,i)=>{
  const meta=v(h[0],h[m]),b1=v(h[m],h[m+1]),b2=v(h[m+1],h[m+2]),b3=v(h[m+2],h[m+3]),r=3+3*i;
  a[r]=angle(meta,b1);a[r+1]=angle(b1,b2);a[r+2]=angle(b2,b3);
  // Spread: the proximal bone against its metacarpal, both flattened onto the palm plane, signed away from the middle finger.
  const flat=(u:V3):V3=>{const k=dot(u,f.z);return [u[0]-f.z[0]*k,u[1]-f.z[1]*k,u[2]-f.z[2]*k];};
  const p=flat(b1),q=flat(meta);if(len(p)>1e-9&&len(q)>1e-9){const s=Math.sign(dot(cross(q,p),f.z))||1,away=i<2?-1:1;abd[i]=angle(p,q)*s*away*-1;}
 });
 const thumbLength=(len(v(h[1],h[2]))+len(v(h[2],h[3]))+len(v(h[3],h[4])))/f.width;
 return {angles:a,abd,thumbLength,palm:len(v(h[0],h[9]))};
}

// ---- Calibration: flat hand = 0, fist = 1, per joint. ----
const D=Math.PI/180;
/** Typical raw angles for a flat hand and a fist; used until the viewer calibrates, and wherever their two poses barely differ. */
export const DEFAULT_FLAT=Float64Array.from([12,8,8, 10,8,8, 10,8,8, 10,8,8, 12,8,8].map(x=>x*D));
export const DEFAULT_FIST=Float64Array.from([48,45,60, 80,100,62, 82,102,64, 82,100,62, 80,96,60].map(x=>x*D));
/** A joint whose fist and flat readings differ by less than this keeps the default span. */
const MIN_SPAN=[25,20,25, 30,35,25, 30,35,25, 30,35,25, 30,35,25].map(x=>x*D);
export interface Calibration {flat:number[];fist:number[];thumbLength:number|null;at:number}
export const defaultCalibration=():Calibration=>({flat:[...DEFAULT_FLAT],fist:[...DEFAULT_FIST],thumbLength:null,at:0});
/** Median per joint over a set of samples. */
export function median(samples:ArrayLike<number>[]):number[]{
 const n=samples[0]?.length??0;return Array.from({length:n},(_,i)=>{const s=samples.map(x=>x[i]).sort((a,b)=>a-b);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;});
}
/** Builds a calibration from flat and fist samples; a joint that did not move enough keeps the default span from its flat reading. */
export function calibrate(flat:ArrayLike<number>[],fist:ArrayLike<number>[],thumbLength:number|null=null,at=Date.now()):Calibration{
 const a=median(flat),b=median(fist);
 return {flat:a,fist:b.map((x,i)=>x-a[i]>=MIN_SPAN[i]?x:a[i]+(DEFAULT_FIST[i]-DEFAULT_FLAT[i])),thumbLength,at};
}
/** Normalised 0..1 (a little past 1 is allowed for a hard fist, then clamped by the caller's use). */
export function normalise(raw:ArrayLike<number>,c:Calibration,out:number[]=new Array(JOINT_COUNT).fill(0)){
 for(let i=0;i<JOINT_COUNT;i++){const span=c.fist[i]-c.flat[i];out[i]=Math.max(0,Math.min(1,(raw[i]-c.flat[i])/(Math.abs(span)>1e-6?span:1)));}
 return out;
}
export function validCalibration(x:unknown):Calibration|null{
 const r=x as Calibration;if(!r||typeof r!=='object'||!Array.isArray(r.flat)||!Array.isArray(r.fist)||r.flat.length!==JOINT_COUNT||r.fist.length!==JOINT_COUNT)return null;
 if(![...r.flat,...r.fist].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=-.5&&n<=Math.PI))return null;
 return {flat:[...r.flat],fist:[...r.fist],thumbLength:typeof r.thumbLength==='number'&&Number.isFinite(r.thumbLength)?r.thumbLength:null,at:Number(r.at)||0};
}

// ---- One-Euro filter (Casiez, Roussel & Vogel 2012): steady at rest, little lag once the joint really moves. ----
export class OneEuro {
 private x:number|null=null;private dx=0;private t=0;
 constructor(private minCutoff=1.2,private beta=.35,private dCutoff=1){}
 private static alpha(cutoff:number,dt:number){const tau=1/(2*Math.PI*cutoff);return 1/(1+tau/dt);}
 reset(){this.x=null;this.dx=0;}
 filter(value:number,t:number){
  if(this.x===null||t<=this.t){this.x=value;this.t=t;this.dx=0;return value;}
  const dt=Math.min(.25,(t-this.t)/1000);this.t=t;
  const d=(value-this.x)/dt,ad=OneEuro.alpha(this.dCutoff,dt);this.dx+=ad*(d-this.dx);
  const a=OneEuro.alpha(this.minCutoff+this.beta*Math.abs(this.dx),dt);this.x+=a*(value-this.x);return this.x;
 }
}

/**
 * Per-frame reading of one hand: raw angles, smoothed, the thumb held through self-occlusion.
 * The thumb is the joint a webcam loses most, hidden behind the palm; its bones then seem to shrink or jump.
 */
export class JointReader {
 private filters=Array.from({length:JOINT_COUNT},()=>new OneEuro());private spread=Array.from({length:4},()=>new OneEuro(1,.2));
 private lastThumb:number[]|null=null;private lastThumbAt=-Infinity;private lengthRef:number|null=null;private prev:Float64Array|null=null;
 /** The thumb was not trusted on the last frame, and its last confident value is shown instead. */
 thumbUncertain=false;
 reset(){this.filters.forEach(f=>f.reset());this.spread.forEach(f=>f.reset());this.lastThumb=null;this.lastThumbAt=-Infinity;this.prev=null;this.thumbUncertain=false;}
 setThumbLength(ref:number|null){this.lengthRef=ref;}
 read(h:P[],t:number):{raw:Float64Array;smooth:Float64Array;abd:[number,number,number,number];palm:number}|null{
  const r=rawJoints(h);if(!r)return null;
  const raw=r.angles,prev=this.prev;
  // A thumb whose bones suddenly read much shorter than usual, or that jumps more than 60° in a frame, is probably hidden.
  this.lengthRef??=r.thumbLength;
  const shrunk=r.thumbLength<this.lengthRef*.62||r.thumbLength>this.lengthRef*1.6,jump=!!prev&&[0,1,2].some(i=>Math.abs(raw[i]-prev[i])>60*D);
  const uncertain=shrunk||jump;
  // A thumb that reads 'hidden' for over a second and a half is more likely a different hand or camera: take its length as the new normal.
  if(shrunk&&!jump&&t-this.lastThumbAt>1500){this.lengthRef=r.thumbLength;}
  if(!uncertain){this.lengthRef+=(r.thumbLength-this.lengthRef)*.02;this.lastThumb=[raw[0],raw[1],raw[2]];this.lastThumbAt=t;}
  else if(this.lastThumb&&t-this.lastThumbAt<2500){raw[0]=this.lastThumb[0];raw[1]=this.lastThumb[1];raw[2]=this.lastThumb[2];}
  this.thumbUncertain=uncertain;this.prev=Float64Array.from(r.angles);
  const smooth=new Float64Array(JOINT_COUNT);for(let i=0;i<JOINT_COUNT;i++)smooth[i]=this.filters[i].filter(raw[i],t);
  const abd=r.abd.map((x,i)=>this.spread[i].filter(x,t)) as [number,number,number,number];
  return {raw,smooth,abd,palm:r.palm};
 }
}
