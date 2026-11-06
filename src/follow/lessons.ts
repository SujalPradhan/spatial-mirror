import type {Lesson,Step,Wrist} from './model';

type Finger=number|[number,number,number];
const f3=(v:Finger):[number,number,number]=>typeof v==='number'?[v,v,v]:v;
/** A pose from thumb [opposition, MCP, IP] and the four fingers, each one amount or [MCP, PIP, DIP]. */
const hand=(thumb:[number,number,number],...fingers:Finger[]):number[]=>[...thumb,...fingers.flatMap(f3)];
const step=(name:string,q:number[],wrist?:Wrist,move=1,touch?:Step['touch']):Step=>({name,q,wrist,move,touch});
const R=.05;
/** Thumb tip to a fingertip, the closest this thumb model gets: it reaches the index and middle, and stops 2 cm short of the ring and 4 cm short of the little finger. */
const toIndex=hand([.85,.28,.62],[.58,.6,.63],R,R,R),toMiddle=hand([.42,.85,.74],R,[.67,.83,.91],R,R),toRing=hand([.42,1,.66],R,R,[.71,.79,.79],R),toLittle=hand([.42,1,.66],R,R,R,[.74,.56,.86]);

const pinch=hand([.85,.28,.62],[.58,.6,.63],.3,.3,.3);
const grip=(index:Finger)=>hand([.45,.7,.7],index,.88,.88,.88);
const upright:Wrist={tilt:0,roll:0};

export const LESSONS:Lesson[]=[
 {id:'thumb',title:'Thumb to each fingertip',builtin:true,blurb:'Bring the thumb tip to each fingertip in turn, and back. A classic dexterity drill.',steps:[
  step('Thumb to index',toIndex,undefined,1,1),step('Thumb to middle',toMiddle,undefined,1,2),step('Thumb to ring',toRing,undefined,1,3),step('Thumb to little',toLittle,undefined,1,4),
  step('Back to ring',toRing,undefined,1,3),step('Back to middle',toMiddle,undefined,1,2),step('Back to index',toIndex,undefined,1,1),step('Open hand',hand([0,0,0],0,0,0,0),undefined,1.2),
 ]},
 {id:'pump',title:'Assemble a spray pump',builtin:true,blurb:'Pinch the dip tube, tilt to insert it, grip the bottle, twist the collar, press the actuator twice.',steps:[
  step('Pinch the dip tube',pinch,undefined,1,1),step('Tilt the wrist to insert it',pinch,{tilt:.7,roll:0},1.2,1),step('Power grip the bottle',grip(.88),upright,1.2),
  step('Twist the collar',grip(.88),{tilt:0,roll:1},1.4),step('Press the actuator',grip([.55,.4,.3]),upright,1.2),step('Let it rise',grip([.15,.1,.1])),step('Press again',grip([.55,.4,.3]),undefined,.8),
 ]},
];
