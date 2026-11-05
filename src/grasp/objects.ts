/** The things to grasp, as signed distance fields in the hand frame (cm). Each waits on a stand where its grasp happens. */
import {len,norm,sub,type V3} from './kinematics';

export type GraspId='mug'|'pen'|'egg'|'coin'|'die';
export type GraspKind='power-wrap'|'power-sphere'|'pinch'|'tripod'|'lateral'|'precision-sphere';
export interface GraspObject {id:GraspId;name:string;mass:number;goal:GraspKind;goalText:string;centre:V3;sdf(p:V3):number;
 /** For the view: the shape and its size. */
 shape:{kind:'mug'|'capsule'|'ellipsoid'|'disc'|'box';size:V3}}

const cylX=(p:V3,c:V3,r:number,h:number)=>{const dy=p[1]-c[1],dz=p[2]-c[2],d0=Math.hypot(dy,dz)-r,d1=Math.abs(p[0]-c[0])-h;return Math.min(Math.max(d0,d1),0)+Math.hypot(Math.max(d0,0),Math.max(d1,0));};
const capX=(p:V3,c:V3,x0:number,x1:number,r:number)=>{const x=Math.max(c[0]+x0,Math.min(c[0]+x1,p[0]));return Math.hypot(p[0]-x,p[1]-c[1],p[2]-c[2])-r;};
const box=(p:V3,c:V3,h:V3,round:number)=>{const q:V3=[Math.abs(p[0]-c[0])-h[0]+round,Math.abs(p[1]-c[1])-h[1]+round,Math.abs(p[2]-c[2])-h[2]+round];return len([Math.max(q[0],0),Math.max(q[1],0),Math.max(q[2],0)])+Math.min(Math.max(q[0],q[1],q[2]),0)-round;};
const ellipsoid=(p:V3,c:V3,r:V3)=>{const k0=len([(p[0]-c[0])/r[0],(p[1]-c[1])/r[1],(p[2]-c[2])/r[2]]),k1=len([(p[0]-c[0])/(r[0]*r[0]),(p[1]-c[1])/(r[1]*r[1]),(p[2]-c[2])/(r[2]*r[2])]);return k1>1e-9?k0*(k0-1)/k1:-Math.min(...r);};

const MUG:V3=[.3,8.8,2.65];
export const MUG_SIZE={r:2.5,h:4.5};
export const OBJECTS:GraspObject[]=[
 {id:'mug',name:'Mug',mass:.32,goal:'power-wrap',goalText:'Wrap it: fingers round, palm behind',centre:MUG,
  sdf:p=>cylX(p,MUG,MUG_SIZE.r,MUG_SIZE.h),shape:{kind:'mug',size:[MUG_SIZE.h,MUG_SIZE.r,MUG_SIZE.r]}},
 {id:'pen',name:'Pen',mass:.015,goal:'pinch',goalText:'Pinch it: thumb pad against index pad',centre:[-2.88,9.55,3.85],
  sdf:p=>capX(p,[-2.88,9.55,3.85],-.9,7.5,.55),shape:{kind:'capsule',size:[4.2,.55,.55]}},
 {id:'egg',name:'Egg',mass:.06,goal:'precision-sphere',goalText:'Fingertips round it, palm clear (or wrap it whole)',centre:[-1.2,10.5,3.5],
  sdf:p=>ellipsoid(p,[-1.2,10.5,3.5],[1.8,2.25,1.8]),shape:{kind:'ellipsoid',size:[1.8,2.25,1.8]}},
 {id:'coin',name:'Coin',mass:.008,goal:'lateral',goalText:'Key grip: thumb pad against the side of the index',centre:[-3.93,10.3,1.5],
  sdf:p=>cylX(p,[-3.93,10.3,1.5],1.15,.15),shape:{kind:'disc',size:[.15,1.15,1.15]}},
 {id:'die',name:'Die',mass:.02,goal:'tripod',goalText:'Tripod: thumb, index and middle tips',centre:[-2,12.5,4.5],
  sdf:p=>box(p,[-2,12.5,4.5],[.8,.8,.8],.16),shape:{kind:'box',size:[.8,.8,.8]}},
];
export const objectById=(id:string)=>OBJECTS.find(o=>o.id===id)??OBJECTS[0];
/** Outward surface normal by central differences. */
export function normal(o:GraspObject,p:V3):V3{
 const e=.01,f=(dx:number,dy:number,dz:number)=>o.sdf([p[0]+dx,p[1]+dy,p[2]+dz]);
 return norm([f(e,0,0)-f(-e,0,0),f(0,e,0)-f(0,-e,0),f(0,0,e)-f(0,0,-e)]);
}
/** Where a capsule comes closest to the object: the gap (negative inside) and the surface point. */
export function capsuleGap(o:GraspObject,a:V3,b:V3,r:number,samples=8){
 let best=Infinity,at:V3=a;
 for(let i=0;i<=samples;i++){const t=i/samples,p:V3=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t],d=o.sdf(p)-r;if(d<best){best=d;at=p;}}
 const n=normal(o,at),s=o.sdf(at);return {gap:best,point:sub(at,[n[0]*s,n[1]*s,n[2]*s]) as V3,normal:n,centre:at};
}
