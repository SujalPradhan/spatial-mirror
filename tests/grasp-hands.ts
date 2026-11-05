// Synthetic landmark hands with known joint angles, for the grasp tests. Not recorded camera data.
import type {Landmark} from '../src/fist';
import {cross,dot,norm,rot,scale,add,type V3} from '../src/grasp/kinematics';

const D=Math.PI/180;
const KNUCKLES:V3[]=[[-2.5,8.5,0],[-.8,8.8,0],[.9,8.5,0],[2.5,7.8,0]];
const BONES=[[4.4,2.6,2],[4.8,3,2.1],[4.5,2.8,2],[3.6,2.1,1.8]];
const THUMB_BONES=[3.4,3,2.6];
/** Raw angles in degrees, in the 15-joint order: thumb opposition (out-of-palm elevation), MCP, IP; then MCP, PIP, DIP per finger. */
export function handFromAngles(deg:number[]):V3[]{
 const a=deg.map(x=>x*D),p:V3[]=new Array(21);p[0]=[0,0,0];
 KNUCKLES.forEach((k,i)=>{
  const m=5+4*i,meta=norm(k),axis=norm(cross([0,0,1],meta));let dir=meta,at=k;p[m]=k;
  for(let b=0;b<3;b++){dir=rot(dir,axis,-a[3+3*i+b]);at=add(at,scale(dir,BONES[i][b]));p[m+1+b]=at;}
 });
 // Thumb: find the base elevation that makes CMC→IP stand out of the palm by the requested angle.
 const base:V3=[-2.2,1.6,0],flat=norm([-.75,.66,0]);
 const chain=(e:number)=>{const u=norm(add(scale(flat,Math.cos(e)),[0,0,Math.sin(e)])),axis=norm(cross(u,[0,0,1]));const pts:V3[]=[base];let d=u,at=base;
  for(let b=0;b<3;b++){if(b>0)d=rot(d,axis,-a[b]);at=add(at,scale(d,THUMB_BONES[b]));pts.push(at);}return pts;};
 const target=a[0];let lo=-1.4,hi=1.5;
 const elev=(pts:V3[])=>{const t=norm([pts[2][0]-pts[0][0],pts[2][1]-pts[0][1],pts[2][2]-pts[0][2]]);return Math.asin(Math.abs(dot(t,[0,0,1])))*Math.sign(t[2]||1);};
 for(let i=0;i<50;i++){const mid=(lo+hi)/2;if(elev(chain(mid))<target)lo=mid;else hi=mid;}
 const th=chain((lo+hi)/2);p[1]=th[0];p[2]=th[1];p[3]=th[2];p[4]=th[3];
 return p;
}
/** Metres, as world landmarks are. */
export const metricLandmarks=(deg:number[]):Landmark[]=>handFromAngles(deg).map(([x,y,z])=>({x:x/100,y:-y/100,z:-z/100}));
/** Raw image landmarks for the tracker: palm to the camera, fingers up, centred at (cx, cy), y pre-multiplied by the camera aspect as the tracker divides it back. */
export function imageLandmarks(deg:number[],cx=.5,cy=.62,aspect=16/9,size=.022):Landmark[]{
 return handFromAngles(deg).map(([x,y,z])=>({x:cx+x*size,y:cy-y*size*aspect,z:-z*size}));
}
/** Named shapes, raw degrees, roughly what a webcam reads for each. */
export const SHAPES:Record<string,number[]>={
 flat:[12,8,8, 10,8,8, 10,8,8, 10,8,8, 12,8,8],
 fist:[48,45,60, 80,100,62, 82,102,64, 82,100,62, 80,96,60],
 power:[35,35,45, 70,85,50, 72,88,52, 72,86,50, 70,82,50],
 pinch:[44,12,22, 58,66,42, 12,10,8, 12,10,8, 14,10,8],
 key:[14,30,40, 66,82,52, 68,84,52, 68,82,50, 66,80,50],
};
export const mix=(a:number[],b:number[],t:number)=>a.map((x,i)=>x+(b[i]-x)*t);
