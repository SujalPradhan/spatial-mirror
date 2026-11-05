/**
 * Is it held? A force-closure heuristic, not a full wrench-space test: forces must oppose within friction cones,
 * nearly cancel, and carry the object's weight through friction. Then the grasp is named on the Feix et al. taxonomy.
 */
import {dot,len,scale,type V3} from './kinematics';
import type {GraspKind,GraspObject} from './objects';
import type {Contact,SimResult} from './tendon';

/** Silicone fingertip pads on aluminium links. */
export const MU=.8;
/** Two forces close a grasp if they lie inside each other's friction cones: at least 180° − 2·atan(μ) apart. */
export const OPPOSE_ANGLE=Math.PI-2*Math.atan(MU);
export const KINDS:{id:GraspKind;name:string;feix:string;how:string}[]=[
 {id:'power-wrap',name:'Power wrap',feix:'Large diameter',how:'Fingers round it, palm behind'},
 {id:'power-sphere',name:'Power sphere',feix:'Power sphere',how:'Whole hand round a ball'},
 {id:'pinch',name:'Precision pinch',feix:'Palmar pinch',how:'Thumb pad to one fingertip'},
 {id:'tripod',name:'Tripod',feix:'Tripod',how:'Thumb, index and middle tips'},
 {id:'lateral',name:'Lateral pinch',feix:'Lateral',how:'Thumb pad to the side of the index'},
 {id:'precision-sphere',name:'Precision sphere',feix:'Precision sphere',how:'Four or five fingertips round a ball'},
];
/** Share of the contact force that must squeeze rather than shove: the rest the stand takes while the fingers close. */
export const BALANCE=.3;
export interface Force {contact:Contact;dir:V3;magnitude:number}
export interface Verdict {score:number;stable:boolean;held:boolean;contacts:number;oppose:number;balance:number;support:number;
 kind:GraspKind|null;forces:Force[];weight:number;capacity:number;reason:string}

export function evaluate(sim:SimResult,obj:GraspObject):Verdict{
 const active=sim.contacts.filter(c=>c.kind==='object'&&c.force>1e-3),passive=sim.contacts.filter(c=>c.kind!=='object'||c.force<=1e-3);
 const forces:Force[]=active.map(c=>({contact:c,dir:scale(c.normal,-1),magnitude:c.force}));
 // Palm and finger sides only push back: each takes its share of the net push toward it.
 const net=forces.reduce((a,f)=>[a[0]+f.dir[0]*f.magnitude,a[1]+f.dir[1]*f.magnitude,a[2]+f.dir[2]*f.magnitude] as V3,[0,0,0] as V3);
 const toward=passive.map(c=>Math.max(0,dot(net,c.normal))),sum=toward.reduce((a,b)=>a+b,0);
 passive.forEach((c,i)=>{if(toward[i]>1e-6)forces.push({contact:c,dir:scale(c.normal,-1),magnitude:toward[i]*toward[i]/sum});});
 const real=forces.filter(f=>f.magnitude>.05),total=real.reduce((a,f)=>a+f.magnitude,0);
 const resultant=real.reduce((a,f)=>[a[0]+f.dir[0]*f.magnitude,a[1]+f.dir[1]*f.magnitude,a[2]+f.dir[2]*f.magnitude] as V3,[0,0,0] as V3);
 let best=0;
 for(let i=0;i<real.length;i++)for(let j=i+1;j<real.length;j++){
  if(real[i].contact.digit===real[j].contact.digit&&real[i].contact.digit!==-1&&Math.abs(real[i].contact.k-real[j].contact.k)<2)continue;
  best=Math.max(best,Math.acos(Math.max(-1,Math.min(1,dot(real[i].dir,real[j].dir)))));
 }
 const oppose=Math.max(0,Math.min(1,(best-Math.PI/2)/(OPPOSE_ANGLE-Math.PI/2)));
 const balance=total>0?Math.max(0,1-len(resultant)/total):0,weight=obj.mass*9.81,capacity=MU*total,support=Math.max(0,Math.min(1,capacity/(1.5*weight)));
 const links=new Set(sim.contacts.map(c=>`${c.digit}:${c.k}`)).size;
 const stable=real.length>=2&&oppose>=1&&balance>=BALANCE&&capacity>=weight;
 let score=Math.round(100*(.2*Math.min(1,links/4)+.35*oppose+.25*balance+.2*support));if(!stable)score=Math.min(score,55);
 const reason=!sim.contacts.length?'Not touching it yet':real.length<2?'Only one side is pushing':oppose<1?'Nothing pushes back from the other side':balance<BALANCE?'Pushed more than squeezed: it would squirt out':capacity<weight?'Too light a grip to carry its weight':'Held';
 return {score,stable,held:stable,contacts:links,oppose,balance,support,kind:stable?classify(sim,obj):null,forces:real,weight,capacity,reason};
}
/** Names a stable grasp by where it touches: palm or proximal phalanges make it power; fingertips only, precision. */
export function classify(sim:SimResult,obj:GraspObject):GraspKind|null{
 const on=sim.contacts.filter(c=>c.kind!=='palm'),palm=sim.contacts.some(c=>c.kind==='palm');
 const digits=new Set(on.map(c=>c.digit)),fingers=[1,2,3,4].filter(d=>digits.has(d as never)),thumb=digits.has(0);
 const proximal=on.filter(c=>c.digit>0&&c.k===0).length;
 const round=obj.shape.kind==='ellipsoid'||obj.shape.kind==='box';
 if(palm||(proximal>=2&&fingers.length>=3))return round?'power-sphere':'power-wrap';
 if(!thumb)return null;
 const side=on.some(c=>c.digit===1&&Math.abs(c.normal[0])>.7);
 if(side&&fingers.length<=2)return 'lateral';
 if(fingers.length===1)return 'pinch';
 if(fingers.length===2&&fingers.includes(1))return 'tripod';
 if(fingers.length>=3)return 'precision-sphere';
 return 'pinch';
}
