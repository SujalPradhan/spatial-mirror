/**
 * One hand model, in centimetres, for both the robot and the ghost of your hand, so a joint means the same thing on each.
 * Hand frame: x across the palm from the index side (−) to the little finger (+), y from the wrist toward the fingers, z out of the palm.
 * Pure: no three.js, so the tests and the simulation share it.
 */
export type V3=[number,number,number];
export const add=(a:V3,b:V3):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub=(a:V3,b:V3):V3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const scale=(a:V3,s:number):V3=>[a[0]*s,a[1]*s,a[2]*s];
export const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const len=(a:V3)=>Math.hypot(a[0],a[1],a[2]);
export const norm=(a:V3):V3=>{const l=len(a)||1;return [a[0]/l,a[1]/l,a[2]/l];};
export const lerp3=(a:V3,b:V3,t:number):V3=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
/** Rodrigues: v turned by angle about a unit axis. */
export function rot(v:V3,axis:V3,angle:number):V3{
 const c=Math.cos(angle),s=Math.sin(angle),k=dot(axis,v),x=cross(axis,v);
 return [v[0]*c+x[0]*s+axis[0]*k*(1-c),v[1]*c+x[1]*s+axis[1]*k*(1-c),v[2]*c+x[2]*s+axis[2]*k*(1-c)];
}

// ---- The 15 grasp joints, normalised 0 (flat hand) to 1 (fist). ----
export const DIGITS=['thumb','index','middle','ring','little'] as const;
export type Digit=0|1|2|3|4;
export const JOINT_COUNT=15;
/** Row of a digit's k-th joint: thumb opposition, MCP, IP; each finger MCP, PIP, DIP. */
export const row=(digit:number,k:number)=>digit===0?k:3*digit+k;
export const jointNames=['CMC opposition','MCP','IP','MCP','PIP','DIP'];
export const jointName=(i:number)=>`${DIGITS[i<3?0:Math.floor(i/3)]} ${jointNames[i<3?i:3+i%3]}`;
export const digitOf=(i:number):Digit=>(i<3?0:Math.floor(i/3)) as Digit;
const D=Math.PI/180;
/** Full range of each joint at 1, radians. The robot's DIP has no motor: a crossed four-bar slaves it to the PIP. */
export const RANGE={mcp:88*D,pip:100*D,dip:70*D,tMcp:60*D,tIp:80*D};
export const DIP_RATIO=RANGE.dip/RANGE.pip;

export interface FingerSpec {x:number;y:number;lengths:[number,number,number];radius:[number,number,number]}
export const FINGERS:FingerSpec[]=[
 {x:-2.85,y:9.4,lengths:[4.3,2.5,2.0],radius:[.88,.82,.76]},
 {x:-.95,y:9.7,lengths:[4.7,2.9,2.1],radius:[.9,.84,.78]},
 {x:.95,y:9.5,lengths:[4.4,2.7,2.0],radius:[.86,.8,.74]},
 {x:2.8,y:8.9,lengths:[3.6,2.1,1.8],radius:[.78,.72,.68]},
];
export const THUMB={base:[-3.6,2.0,.5] as V3,lengths:[4.2,3.1,2.7] as [number,number,number],radius:[1.0,.9,.84] as [number,number,number]};
/** The palm block: its face is z=0. */
export const PALM={x0:-4.1,x1:4.1,y0:0,y1:9.5,z0:-2.4,z1:0};
export const MCP_Z=-1;

/** A joint frame: the link starts at origin and runs along `along`; it bends about `axis`, toward `pad` (its gripping side). */
export interface Link {digit:Digit;k:0|1|2;origin:V3;along:V3;axis:V3;pad:V3;length:number;radius:number}
export const tipOf=(l:Link):V3=>add(l.origin,scale(l.along,l.length));

/** Thumb frames: A lies in the palm plane, pointing out to the side; B stands out of the palm, facing the fingertips. */
const thumbA={u:norm([-.6,.78,.16]),n:[0,0,-1] as V3},thumbM={u:norm([-.45,.5,.75]),n:[.7,0,-.7] as V3},thumbB={u:norm([.08,.95,.31]),n:[1,-.09,0] as V3};
type Q=[number,number,number,number];
function basisQuat(u:V3,n:V3):Q{
 n=norm(sub(n,scale(u,dot(n,u))));const w=cross(u,n);
 // Columns u, n, w as a rotation matrix → quaternion.
 const m00=u[0],m10=u[1],m20=u[2],m01=n[0],m11=n[1],m21=n[2],m02=w[0],m12=w[1],m22=w[2],tr=m00+m11+m22;
 if(tr>0){const s=Math.sqrt(tr+1)*2;return [(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,s/4];}
 if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;return [s/4,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s];}
 if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;return [(m01+m10)/s,s/4,(m12+m21)/s,(m02-m20)/s];}
 const s=Math.sqrt(1+m22-m00-m11)*2;return [(m02+m20)/s,(m12+m21)/s,s/4,(m10-m01)/s];
}
function slerp(a:Q,b:Q,t:number):Q{
 let c=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];if(c<0){b=b.map(x=>-x) as Q;c=-c;}
 if(c>.9995){const r=a.map((x,i)=>x+(b[i]-x)*t);const l=Math.hypot(...r);return r.map(x=>x/l) as Q;}
 const th=Math.acos(c),s=Math.sin(th),wa=Math.sin((1-t)*th)/s,wb=Math.sin(t*th)/s;return a.map((x,i)=>x*wa+b[i]*wb) as Q;
}
function quatApply(q:Q,v:V3):V3{const [x,y,z,w]=q,u:V3=[x,y,z],t=scale(cross(u,v),2);return add(add(v,scale(t,w)),cross(u,t));}
const qA=basisQuat(thumbA.u,thumbA.n),qM=basisQuat(thumbM.u,thumbM.n),qB=basisQuat(thumbB.u,thumbB.n);
/** Opposition 0..1 turns the thumb's whole flexion plane from beside the index to facing the fingertips. */
/** Through a middle frame standing out of the palm, so the swinging thumb clears the index instead of sweeping through it. */
export function thumbFrame(opp:number){const t=Math.max(0,Math.min(1,opp)),q=slerp(qA,qB,t);void qM;return {u:quatApply(q,[1,0,0]),n:quatApply(q,[0,1,0])};}

/** Extra ghost-only freedom: finger spread in the palm plane, radians, positive away from the middle finger. */
export interface Spread {abd:[number,number,number,number]}
/**
 * Every link for a normalised joint vector. `dipFree` false makes each DIP follow its PIP, as the robot's four-bar does.
 * Returns 15 links in digit order, three per digit.
 */
export function forward(q:ArrayLike<number>,dipFree=true,spread?:Spread):Link[]{
 const links:Link[]=[];
 // Thumb.
 const f=thumbFrame(q[0]);let o=THUMB.base,u=f.u;const n=f.n;
 const angles=[0,q[1]*RANGE.tMcp,q[2]*RANGE.tIp];
 for(let k=0;k<3;k++){
  u=rot(u,n,angles[k]);
  links.push({digit:0,k:k as 0|1|2,origin:o,along:u,axis:n,pad:cross(n,u),length:THUMB.lengths[k],radius:THUMB.radius[k]});
  o=add(o,scale(u,THUMB.lengths[k]));
 }
 FINGERS.forEach((spec,i)=>{
  const d=(i+1) as Digit,base=3*d,abd=spread?.abd[i]??0,side=i<2?-1:1;
  // Spread turns the finger's plane about the palm normal at the knuckle.
  const axis=rot([1,0,0],[0,0,1],side*abd);
  let along=rot([0,1,0],[0,0,1],side*abd),origin:V3=[spec.x,spec.y,MCP_Z];
  const pip=q[base+1]*RANGE.pip,ang=[q[base]*RANGE.mcp,pip,dipFree?q[base+2]*RANGE.dip:pip*DIP_RATIO];
  for(let k=0;k<3;k++){
   along=rot(along,axis,ang[k]);
   links.push({digit:d,k:k as 0|1|2,origin,along,axis,pad:cross(axis,along),length:spec.lengths[k],radius:spec.radius[k]});
   origin=add(origin,scale(along,spec.lengths[k]));
  }
 });
 return links;
}
/** Closest point on a segment, and its parameter. */
export function closestOnSegment(a:V3,b:V3,p:V3){const ab=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),ab)/(dot(ab,ab)||1)));return {t,p:add(a,scale(ab,t))};}
/** Distance between two segments, by sampling one against the other: plenty for capsules a few centimetres long. */
export function segmentDistance(a0:V3,a1:V3,b0:V3,b1:V3){let best=Infinity;for(let i=0;i<=8;i++){const p=lerp3(a0,a1,i/8),c=closestOnSegment(b0,b1,p).p;best=Math.min(best,len(sub(p,c)));}return best;}
/** Signed distance to the palm block. */
export function palmDistance(p:V3){
 const cx=(PALM.x0+PALM.x1)/2,cy=(PALM.y0+PALM.y1)/2,cz=(PALM.z0+PALM.z1)/2,hx=(PALM.x1-PALM.x0)/2,hy=(PALM.y1-PALM.y0)/2,hz=(PALM.z1-PALM.z0)/2;
 const q:V3=[Math.abs(p[0]-cx)-hx,Math.abs(p[1]-cy)-hy,Math.abs(p[2]-cz)-hz];
 return len([Math.max(q[0],0),Math.max(q[1],0),Math.max(q[2],0)])+Math.min(Math.max(q[0],q[1],q[2]),0);
}
