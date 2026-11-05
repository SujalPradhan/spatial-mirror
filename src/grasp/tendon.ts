/**
 * The robot's tendons, quasi-statically. Each motor reels in a tendon that splits through a whiffletree to the digits it serves;
 * every joint has a return spring, so in free air a joint bends by its share of the tension (gain S·T) and the hand makes its synergy.
 * The motor is position-controlled through a series spring: while links are free it just takes up slack, and once a phalanx touches the object
 * that joint stops, the tendon goes on pulling, and the pull flows to the joints still free. That is how one motor wraps a mug.
 */
import {DIGITS,FINGERS,JOINT_COUNT,PALM,THUMB,forward,len,palmDistance,row,segmentDistance,sub,tipOf,type Digit,type Link,type V3} from './kinematics';
import {capsuleGap,normal,type GraspObject} from './objects';
import {synthesise,type Coupling} from './synergy';

export const T_MAX=3;
/** Newtons for one unit of tension: a small hobby gearmotor through a 10 mm spool. */
export const NEWTONS=14;
/** Pulley radius at each joint, mm, for the torque readout. The model's gain S is this radius × the branch's share of the tension. */
export const PULLEY_MM=[10,8,6, 9,7,0, 9,7,0, 9,7,0, 8,6,0];
/** Joint torque for one unit of model torque surplus, N·cm: what turns a stopped joint into a contact force. */
const TAU_REF=[22,18,12, 26,15,9, 28,16,9, 24,14,8, 18,11,7];
let SELF=false;export const setSelf=(on:boolean)=>{SELF=on;};
const STEPS=140,DIST_IN=-.02,TOUCH=.14,PALM_TOUCH=.3;
/**
 * Return-spring stiffness while closing: the distal springs start stiffer and relax to 1 by full travel,
 * so phalanges move proximal to distal and a finger meets an object with its base first, then wraps.
 * At full travel every spring is 1, so in free air the hand still lands exactly on its synergy pose.
 */
function stiffness(s:number){const late=(1-s)*(1-s);return [1,1+2*late,1+5*late, 1,1+5*late,1, 1,1+5*late,1, 1,1+5*late,1, 1,1+5*late,1];}
/** Compliance of the motor's series spring, per unit of tendon. */
const SOFT=.3;

export interface Contact {digit:Digit|-1;k:number;point:V3;normal:V3;force:number;kind:'object'|'palm'|'side'}
export interface Branch {digit:Digit;share:number;excursion:number;full:number}
export interface WhiffleNode {children:(WhiffleNode|Branch)[];share:number;excursion:number;tilt:number}
export interface MotorState {tension:number;excursion:number;target:number;stalled:boolean;branches:Branch[];tree:WhiffleNode|Branch}
export interface SimResult {q:number[];free:number[];links:Link[];motors:MotorState[];blocked:boolean[];
 /** What stopped each blocked digit link: the object, the palm, or another finger. */
 stops:('object'|'self'|null)[];contacts:Contact[];
 /** Torque surplus per joint row, model units: how hard a stopped joint presses. */
 surplus:number[]}

/** Rows that make up a digit. */
const rowsOf=(d:number)=>[row(d,0),row(d,1),row(d,2)];
/** Each finger's DIP follows its PIP through the crossed four-bar; in normalised units the ratio is 1. */
function slave(q:number[]){for(let d=1;d<5;d++)q[row(d,2)]=q[row(d,1)];}
/** Solve (S_Uᵀ S_U + soft) T = rhs for the motors, k ≤ 5, by Gaussian elimination. */
function solve(A:number[][],b:number[]){
 const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
 for(let i=0;i<n;i++){let p=i;for(let r=i+1;r<n;r++)if(Math.abs(M[r][i])>Math.abs(M[p][i]))p=r;[M[i],M[p]]=[M[p],M[i]];const d=M[i][i]||1e-12;for(let r=0;r<n;r++){if(r===i)continue;const f=M[r][i]/d;for(let c=i;c<=n;c++)M[r][c]-=f*M[i][c];}}
 return M.map((r,i)=>r[n]/(r[i]||1e-12));
}
/** The links an obstacle check covers: a digit against the object, the palm, and the thumb against the index and middle. */
function penetration(links:Link[],d:number,obj:GraspObject|null):{k:number;kind:'object'|'self'}|null{
 const own=links.slice(d*3,d*3+3);
 for(let k=0;k<3;k++){
  const l=own[k],a=l.origin,b=tipOf(l);
  if(obj&&capsuleGap(obj,a,b,l.radius,6).gap<DIST_IN)return {k,kind:'object'};
  // The palm: only links that can fold back onto it.
  if(k>0){for(let i=1;i<=4;i++){const t=i/4,p:V3=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];if(palmDistance(p)<l.radius*.85)return {k,kind:'self'};}}
  if(d===0&&SELF)for(const o of links.slice(3,9))if(segmentDistance(a,b,o.origin,tipOf(o))<l.radius+o.radius-.05)return {k,kind:'self'};
 }
 return null;
}
/** Whiffletree weights: a balanced binary tree, the thumb on its own side when it shares a motor with fingers. */
function tree(branches:Branch[]):WhiffleNode|Branch{
 if(branches.length===1)return branches[0];
 const thumb=branches.find(b=>b.digit===0),rest=branches.filter(b=>b.digit!==0);
 const split=thumb&&rest.length?[[thumb],rest]:[branches.slice(0,Math.ceil(branches.length/2)),branches.slice(Math.ceil(branches.length/2))];
 return {children:split.map(tree),share:0,excursion:0,tilt:0};
}
function weigh(n:WhiffleNode|Branch,share:number){
 if('digit' in n){n.share=share;return;}
 n.share=share;n.children.forEach(c=>weigh(c,share/n.children.length));
}
function settle(n:WhiffleNode|Branch):number{
 if('digit' in n)return n.full>0?n.excursion/n.full:0;
 const e=n.children.map(settle);n.excursion=e.reduce((a,b)=>a+b,0)/e.length;n.tilt=e.length===2?e[0]-e[1]:0;return n.excursion;
}

/** Closes the robot from open to the motor targets m (0..1 each), stopping links on the object. Deterministic: same input, same grasp. */
export function simulate(c:Coupling,m:ArrayLike<number>,obj:GraspObject|null):SimResult{
 const k=c.motors.length,S=c.motors.map(x=>x.column),free=synthesise(c,m),soft=S.map(s=>SOFT*s.reduce((a,v)=>a+v*v,0));
 const X=S.map((s,j)=>s.reduce((a,v,i)=>a+v*free[i],0)+soft[j]*m[j]);
 let q=[...c.offset];slave(q);
 const blocked=new Array(JOINT_COUNT).fill(false),stops:('object'|'self'|null)[]=new Array(JOINT_COUNT).fill(null);
 let T=new Array(k).fill(0);
 // Tensions that hold the motors at fraction s of their travel, given which joints are stopped or at their limit.
 const dip=(i:number)=>i>=3&&i%3===2;
 const tensions=(s:number)=>{
  const K=stiffness(s),qq=[...q],fixed=Array.from({length:JOINT_COUNT},(_,i)=>blocked[i]||!c.driven[i]);
  for(let i=0;i<JOINT_COUNT;i++)if(dip(i))fixed[i]=fixed[i-1];
  for(let pass=0;pass<4;pass++){
   // A free DIP turns with its PIP, so its tendon travel follows the PIP's gain.
   const A=Array.from({length:k},(_,a)=>Array.from({length:k},(_,b)=>{let v=a===b?soft[a]:0;for(let i=0;i<JOINT_COUNT;i++)if(!fixed[i])v+=S[a][i]*(dip(i)?S[b][i-1]/K[i-1]:S[b][i]/K[i]);return v;}));
   const rhs=X.map((x,j)=>{let v=s*x;for(let i=0;i<JOINT_COUNT;i++)v-=S[j][i]*(fixed[i]?qq[i]:dip(i)?c.offset[i-1]:c.offset[i]);return v;});
   T=solve(A,rhs).map(t=>Math.max(0,Math.min(T_MAX,t)));
   let changed=false;
   for(let i=0;i<JOINT_COUNT;i++){if(fixed[i]||dip(i))continue;let v=c.offset[i];for(let j=0;j<k;j++)v+=S[j][i]*T[j]/K[i];if(v>1){fixed[i]=true;qq[i]=1;if(i>=3&&i%3===1){fixed[i+1]=true;qq[i+1]=1;}changed=true;}}
   if(!changed)break;
  }
  const out=[...qq];
  for(let i=0;i<JOINT_COUNT;i++){if(fixed[i]||dip(i))continue;let v=c.offset[i];for(let j=0;j<k;j++)v+=S[j][i]*T[j]/K[i];out[i]=Math.max(q[i],Math.min(1,v));}
  slave(out);return out;
 };
 for(let step=1;step<=STEPS;step++){
  const s=step/STEPS;
  for(let tries=0;tries<6;tries++){
   const next=tensions(s),links=forward(next,false);let hit=false;
   for(let d=0;d<5;d++){
    const p=penetration(links,d,obj);if(!p)continue;
    // Not into the object: this digit keeps its last pose, and the stopped link's joint and every joint before it lock.
    for(const i of rowsOf(d)){next[i]=q[i];}
    for(let kk=0;kk<=p.k;kk++){const i=row(d,kk);if(!blocked[i]){blocked[i]=true;stops[i]=p.kind;}}
    if(d>0&&p.k>=1){blocked[row(d,2)]=true;stops[row(d,2)]??=p.kind;}
    hit=true;
   }
   q=next;slave(q);if(!hit)break;
  }
 }
 // Final tension at full travel, with every stop in place.
 q=tensions(1);
 const links=forward(q,false),surplus=new Array(JOINT_COUNT).fill(0);
 for(let i=0;i<JOINT_COUNT;i++){if(!c.driven[i])continue;let g=0;for(let j=0;j<k;j++)g+=S[j][i]*T[j];surplus[i]=Math.max(0,g-(q[i]-c.offset[i]));}
 // Contacts: links touching the object. Each stopped joint's torque is shared by the contacts beyond it, as force over its lever.
 const contacts:Contact[]=[];
 if(obj){
  const touching=links.map(l=>({l,g:capsuleGap(obj,l.origin,tipOf(l),l.radius)})).filter(x=>x.g.gap<=TOUCH);
  for(const {l,g} of touching){
   const i=row(l.digit,l.k),pushed=blocked[i]&&stops[i]==='object';let force=0;
   if(pushed)for(let kk=0;kk<=l.k;kk++){
    const r=row(l.digit,kk),beyond=touching.filter(x=>x.l.digit===l.digit&&x.l.k>=kk&&blocked[row(l.digit,x.l.k)]).length||1;
    force+=surplus[r]*TAU_REF[r]/Math.max(1,len(sub(g.centre,links[l.digit*3+kk].origin)))/beyond;
   }
   contacts.push({digit:l.digit,k:l.k,point:g.point,normal:g.normal,force,kind:pushed?'object':'side'});
  }
  // The palm: the nearest point of its face.
  let best=Infinity,at:V3=[0,0,0];
  for(let x=PALM.x0+.4;x<=PALM.x1-.4;x+=.5)for(let y=PALM.y0+.5;y<=PALM.y1-.2;y+=.5){const p:V3=[x,y,0],d=obj.sdf(p);if(d<best){best=d;at=p;}}
  if(best<PALM_TOUCH)contacts.push({digit:-1,k:0,point:at,normal:normal(obj,at),force:0,kind:'palm'});
 }
 // Whiffletree: how far each branch has been reeled in, against what it would travel in free air.
 const motors:MotorState[]=S.map((s,j)=>{
  const branches:Branch[]=[];
  for(let d=0;d<5;d++){const rs=rowsOf(d).filter(i=>s[i]>0);if(!rs.length)continue;branches.push({digit:d as Digit,share:0,excursion:rs.reduce((a,i)=>a+s[i]*(q[i]-c.offset[i]),0),full:rs.reduce((a,i)=>a+s[i],0)});}
  const t=tree(branches);weigh(t,1);settle(t);
  const excursion=s.reduce((a,v,i)=>a+v*(q[i]-c.offset[i]),0);
  return {tension:T[j],excursion,target:X[j],stalled:T[j]>=T_MAX-1e-6||branches.every(b=>rowsOf(b.digit).filter(i=>s[i]>0).every(i=>blocked[i]||q[i]>=1)),branches,tree:t};
 });
 return {q,free,links,motors,blocked,stops,contacts,surplus};
}
/** Torque at a joint from every tendon crossing it: pulley radius × that branch's tension. N·mm, with the parts for the readout. */
export function jointTorque(c:Coupling,sim:SimResult,i:number){
 const parts=c.motors.map((mo,j)=>{
  const s=mo.column[i];if(!s||!PULLEY_MM[i])return null;
  const b=sim.motors[j].branches.find(x=>x.digit===(i<3?0:Math.floor(i/3))),share=b?.share??1,tension=sim.motors[j].tension*NEWTONS*share;
  return {motor:j,radius:PULLEY_MM[i]*s,tension,torque:PULLEY_MM[i]*s*tension,share};
 }).filter(<T,>(x:T|null):x is T=>!!x);
 return {parts,torque:parts.reduce((a,p)=>a+p.torque,0),name:`${DIGITS[i<3?0:Math.floor(i/3)]}`};
}
export {FINGERS,THUMB};
