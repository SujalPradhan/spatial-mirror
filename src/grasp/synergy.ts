/**
 * How a few motors span a hand. Each motor drives a fixed column of joint motion, a postural synergy:
 * the robot can only make poses q = q0 + S·m with 0 ≤ m ≤ 1, a k-dimensional slice of the 15-joint space.
 * Your pose is projected onto that slice by weighted, bounded least squares, and what is left over is the residual.
 */
import {JOINT_COUNT,row} from './kinematics';

export type MotorCount=1|2|3|5;
export const MOTOR_COUNTS:MotorCount[]=[1,2,3,5];
export interface Motor {name:string;short:string;color:string;column:number[]}
export interface Coupling {k:MotorCount;motors:Motor[];
 /** Joint values that no motor moves: with one motor the thumb's rotation is a fixed setting. */
 offset:number[];
 /** Which joints some motor can move. */
 driven:boolean[];title:string;blurb:string}
/** One colour per motor, the same motor slot keeping its colour as the count changes. */
export const MOTOR_COLORS=['#ffae3d','#3fd3ff','#9dff6a','#c49bff','#ff79c9'];
/** With one motor the thumb's rotation is set once, at a power-grip angle, and only bends. */
export const FIXED_OPPOSITION=0;
const col=(entries:[number,number][])=>{const c=new Array(JOINT_COUNT).fill(0);for(const [i,v] of entries)c[i]=v;return c;};
const finger=(d:number,v=1):[number,number][]=>[[row(d,0),v],[row(d,1),v],[row(d,2),v]];
const thumbBend:[number,number][]=[[1,1],[2,1]];
function make(k:MotorCount,specs:[string,string,[number,number][]][],title:string,blurb:string):Coupling{
 const motors=specs.map(([name,short,entries],i)=>({name,short,color:MOTOR_COLORS[i],column:col(entries)}));
 const offset=new Array(JOINT_COUNT).fill(0);if(k===1)offset[0]=FIXED_OPPOSITION;
 return {k,motors,offset,driven:Array.from({length:JOINT_COUNT},(_,i)=>motors.some(m=>m.column[i]>0)),title,blurb};
}
export const COUPLINGS:Record<MotorCount,Coupling>={
 1:make(1,[['Close','close',[...thumbBend,...finger(1),...finger(2),...finger(3),...finger(4)]]],'One motor','Every finger and the thumb close together; the thumb’s rotation is fixed.'),
 2:make(2,[['Close','close',[...thumbBend,...finger(1),...finger(2),...finger(3),...finger(4)]],['Pinch','pinch',[[0,1.15],[2,.23],...finger(1,.8)]]],'Two motors','Close, plus a pinch tendon that swings the thumb round to meet the index.'),
 3:make(3,[['Close','close',[...thumbBend,...finger(2),...finger(3),...finger(4)]],['Oppose','oppose',[[0,1]]],['Index','index',finger(1)]],'Three motors','Close, thumb rotation, and an index finger of its own.'),
 5:make(5,[['Thumb','thumb',thumbBend],['Oppose','oppose',[[0,1]]],['Index','index',finger(1)],['Middle','middle',finger(2)],['Ring + little','ring·little',[...finger(3),...finger(4)]]],'Five motors','Thumb bend and rotation, index, middle, and ring with little.'),
};
/** How much each joint counts when fitting. Thumb and index carry most of grasp shape; the DIP is noisy and coupled anyway. */
export const WEIGHTS=[1.5,1.1,1.1, 1.3,1.3,.5, 1,1,.4, .8,.8,.35, .7,.7,.3];

export interface Projection {m:number[];q:number[];residual:number[]}
/** The robot pose for motor settings, free of contact. */
export function synthesise(c:Coupling,m:ArrayLike<number>,out=new Array(JOINT_COUNT)){
 for(let i=0;i<JOINT_COUNT;i++){let s=c.offset[i];for(let j=0;j<c.motors.length;j++)s+=c.motors[j].column[i]*m[j];out[i]=Math.max(0,Math.min(1,s));}
 return out;
}
/** Weighted least squares with 0 ≤ m ≤ 1, by exact coordinate descent (convex, so it converges to the optimum). */
export function project(c:Coupling,q:ArrayLike<number>,w:ArrayLike<number>=WEIGHTS,iterations=60):Projection{
 const k=c.motors.length,m=new Array(k).fill(0),cols=c.motors.map(x=>x.column);
 const r=Array.from({length:JOINT_COUNT},(_,i)=>q[i]-c.offset[i]);
 for(let it=0;it<iterations;it++){
  let moved=0;
  for(let j=0;j<k;j++){
   let num=0,den=0;for(let i=0;i<JOINT_COUNT;i++){const s=cols[j][i];if(!s)continue;num+=w[i]*s*(r[i]+s*m[j]);den+=w[i]*s*s;}
   const next=Math.max(0,Math.min(1,den>0?num/den:0)),d=next-m[j];
   if(d){for(let i=0;i<JOINT_COUNT;i++)r[i]-=cols[j][i]*d;m[j]=next;moved+=Math.abs(d);}
  }
  if(moved<1e-9)break;
 }
 const out=synthesise(c,m);
 return {m,q:out,residual:Array.from({length:JOINT_COUNT},(_,i)=>q[i]-out[i])};
}
/** Residual glow: nothing under ~15° of a joint's range, so tracking noise does not light the hand red. */
export const residualGlow=(r:number)=>{const x=Math.max(0,Math.min(1,(Math.abs(r)-.17)/.28));return x*x*(3-2*x);};
/** Share of a set of poses (measured from the flat hand) that a coupling reproduces: 1 − Σ|W·r|² / Σ|W·q|². */
export function explained(c:Coupling,poses:ArrayLike<number>[],w:ArrayLike<number>=WEIGHTS){
 let total=0,left=0;
 for(const q of poses){const p=project(c,q,w);for(let i=0;i<JOINT_COUNT;i++){total+=w[i]*q[i]*q[i];left+=w[i]*p.residual[i]*p.residual[i];}}
 return total>1e-9?Math.max(0,1-left/total):1;
}
/** The joint vector for a whole-hand amount, handy for presets and tests. */
export function pose(parts:{opp?:number;thumb?:number|[number,number];fingers?:number|[number,number,number,number]}){
 const q=new Array(JOINT_COUNT).fill(0),t=parts.thumb??0,f=parts.fingers??0;
 q[0]=parts.opp??0;[q[1],q[2]]=Array.isArray(t)?t:[t,t];
 for(let d=1;d<5;d++){const v=Array.isArray(f)?f[d-1]:f;q[row(d,0)]=q[row(d,1)]=q[row(d,2)]=v;}
 return q;
}
