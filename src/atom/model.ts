import type {Quat} from '../types';
import {clampPhase,type MirrorState,type MirrorViewState} from '../mirror/contracts';

export interface Element {z:number;symbol:string;name:string;neutrons:number}
/** Most common isotope of each element; the order is the order a clap steps through. */
export const elements:Element[]=[
 {z:1,symbol:'H',name:'Hydrogen',neutrons:0},{z:2,symbol:'He',name:'Helium',neutrons:2},{z:3,symbol:'Li',name:'Lithium',neutrons:4},{z:6,symbol:'C',name:'Carbon',neutrons:6},
 {z:7,symbol:'N',name:'Nitrogen',neutrons:7},{z:8,symbol:'O',name:'Oxygen',neutrons:8},{z:10,symbol:'Ne',name:'Neon',neutrons:10},{z:11,symbol:'Na',name:'Sodium',neutrons:12},
];
export const DEFAULT_ELEMENT=elements.findIndex(e=>e.symbol==='C');
const CAPACITY=[2,8,18];
/** Electrons per shell, filling inner shells first. */
export function shellsOf(electrons:number):number[]{
 const shells:number[]=[];
 for(let left=electrons,i=0;left>0;i++){const n=Math.min(left,CAPACITY[i]??18);shells.push(n);left-=n;}
 return shells;
}
export const stepElement=(index:number,step=1)=>((index+step)%elements.length+elements.length)%elements.length;
export const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
const SUP='⁰¹²³⁴⁵⁶⁷⁸⁹';
/** '⁺', '²⁺', '⁻': the charge as it is written beside a symbol. */
export function chargeMark(charge:number){
 const n=Math.abs(Math.round(charge));
 return charge===0?'':`${n>1?String(n).replace(/\d/g,d=>SUP[+d]):''}${charge>0?'⁺':'⁻'}`;
}
export const ionSymbol=(symbol:string,charge:number)=>symbol+chargeMark(charge);
/** The plain status line: the whole atom when neutral, the ion once an electron is taken. */
export function describeAtom(element:Element,electrons:number){
 const charge=element.z-electrons;
 if(!charge)return `${element.name}-${element.z+element.neutrons}: ${plural(element.z,'proton')}, ${plural(element.neutrons,'neutron')}, ${plural(electrons,'electron')}`;
 return `${ionSymbol(element.symbol,charge)} ion: ${plural(element.z,'proton')}, ${plural(electrons,'electron')}`;
}
/** Electron i is in this shell; electrons are numbered from the innermost out, so the last is the outermost. */
export function shellOfElectron(shells:number[],electron:number){
 let left=electron;
 for(let s=0;s<shells.length;s++){if(left<shells[s])return {shell:s,slot:left,count:shells[s]};left-=shells[s];}
 return {shell:shells.length-1,slot:0,count:shells[shells.length-1]??1};
}
/** The outermost electron not already taken, or -1. */
export function outermostFree(total:number,taken:ReadonlySet<number>){
 for(let i=total-1;i>=0;i--)if(!taken.has(i))return i;
 return -1;
}

const GOLDEN=2.399963;
const RADIUS_PER_ROOT=.27;
/** k nucleons packed as a ball around the origin; one sits at the centre. */
export function ball(k:number):[number,number,number][]{
 const radius=RADIUS_PER_ROOT*Math.cbrt(k),out:[number,number,number][]=[];
 for(let i=0;i<k;i++){
  const t=(i+.5)/k,y=1-2*t,r=Math.sqrt(Math.max(0,1-y*y)),d=k===1?0:radius*Math.cbrt(t);
  out.push([Math.cos(i*GOLDEN)*r*d,y*d,Math.sin(i*GOLDEN)*r*d]);
 }
 return out;
}
export interface Nucleon {kind:'proton'|'neutron';packed:[number,number,number];grouped:[number,number,number]}
/** Protons and neutrons evenly mixed in one ball; grouped is the same particle in a ball of its own kind. */
export function nucleons(protons:number,neutrons:number):Nucleon[]{
 const total=protons+neutrons,mixed=ball(total),p=ball(protons),n=ball(neutrons),out:Nucleon[]=[];
 let pi=0,ni=0;
 for(let i=0;i<total;i++){
  const proton=Math.floor((i+1)*protons/total)>Math.floor(i*protons/total);
  out.push(proton?{kind:'proton',packed:mixed[i],grouped:p[pi++]}:{kind:'neutron',packed:mixed[i],grouped:n[ni++]});
 }
 return out;
}
const ramp=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export interface Tear {
 /** Nucleons loosen out of the packed ball, then gather by kind. */
 loosen:number;group:number;
 /** Where the proton and neutron clusters sit, in atom units. */
 protons:[number,number,number];neutrons:[number,number,number];
 /** Rings turn to face the viewer and line up in a row. */
 flat:number;row:number;ringY:number;ringScale:number;gap:number;
 /** Labels fade in once the parts are clear of each other. */
 labels:number;
}
export const TEAR_SPREAD=2.3,TEAR_RISE=1.7,TEAR_ROW=-1.3,TEAR_GAP=2.7;
/** How far apart the pieces are for a tear amount from 0 (whole) to 1 (fully apart). */
export function tearLayout(explode:number):Tear{
 const e=Math.max(0,Math.min(1,explode)),split=ramp(.2,.8,e),flat=ramp(.15,.7,e);
 return {loosen:ramp(0,.35,e),group:ramp(.25,.7,e),protons:[-TEAR_SPREAD*split,TEAR_RISE*split,0],neutrons:[TEAR_SPREAD*split,TEAR_RISE*split,0],flat,row:flat,ringY:TEAR_ROW*flat,ringScale:1-.5*flat,gap:TEAR_GAP*flat,labels:ramp(.45,.8,e)};
}
export const SHELL_RADIUS=[1.25,2.1,2.95];
/** Orbital angular speed in radians per second: inner shells are quicker. */
export const shellSpeed=(shell:number)=>2.6/(1+shell*.5);

/** Only the pose persists. Which element is showing is play, not a saved document. */
export interface AtomState extends MirrorState {schema:1}
export const homeView=():MirrorViewState=>({q:[0,0,0,1],zoom:1,x:0,y:0});
export const initialAtom=():AtomState=>({schema:1,tool:'view',phase:0,view:homeView(),frozen:false});
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const bounded=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export function validateAtom(value:unknown):AtomState{
 if(!record(value)||value.schema!==1||!['view','rotor'].includes(value.tool as string)||!bounded(value.phase,0,360)||typeof value.frozen!=='boolean'||!record(value.view))throw Error('Invalid atom exploration.');
 const view=value.view;
 if(!Array.isArray(view.q)||view.q.length!==4||!view.q.every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(Math.hypot(...view.q)-1)>.1||!bounded(view.zoom,.65,2.5)||!bounded(view.x,-6,6)||!bounded(view.y,-6,6))throw Error('Invalid atom view.');
 const norm=Math.hypot(...view.q);
 return {schema:1,tool:value.tool as AtomState['tool'],phase:clampPhase(value.phase),view:{q:view.q.map(n=>n/norm) as Quat,zoom:view.zoom,x:view.x,y:view.y},frozen:value.frozen};
}
