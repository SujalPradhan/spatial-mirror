import {families,ingredientById,noteClass,organ} from './ingredients';
/** Where each vial sits, in world units: an amphitheatre of tiers behind the flask, opening toward the viewer. */
export const SPAN=136*Math.PI/180;
const R0=3.1,DR=.8,Y0=-1.55,DY=.5;
/** The flask stands in front, low and central, so every reach is down and in. */
export const FLASK={x:0,y:-1.95,z:2.3};
export const PALM={x:2.75,y:-1.55,z:2.7};
export const FOREARM={x:-3.2,y:-1.75,z:2.4};
export interface Slot {tier:number;angle:number}
const byNote=(['top','heart','base'] as const).map(n=>organ.filter(i=>noteClass(i.tau)===n));
/** Tiers by note: top notes in the front row, base notes at the back, families together within a row. */
const tiers:Slot[]=organ.map(i=>{
 const tier=['top','heart','base'].indexOf(noteClass(i.tau)),row=byNote[tier].slice().sort((a,b)=>families.indexOf(a.family)-families.indexOf(b.family)),k=row.indexOf(i),n=row.length;
 return {tier,angle:-SPAN/2+SPAN*(k+.5)/n};
});
/** Fanned: one wedge per family, its members stepping back a tier each. */
const fanned:Slot[]=organ.map(i=>{
 const f=families.indexOf(i.family),members=organ.filter(o=>o.family===i.family),k=members.indexOf(i),w=SPAN/families.length;
 return {tier:k,angle:-SPAN/2+w*(f+.5)+(k-(members.length-1)/2)*w*.16};
});
/** Fanned wedges sit a little tighter, so the outer families stay clear of the cards. */
const FAN_SPAN=.86;
export const familyAngle=(f:number)=>(-SPAN/2+SPAN/families.length*(f+.5))*FAN_SPAN;
/** The ring turns as a loop one slot longer than the arc, so a vial leaving one end comes back at the other. */
const LOOP=SPAN*1.14;
const wrapArc=(a:number)=>a-LOOP*Math.floor((a+LOOP/2)/LOOP);
const smooth=(a:number,b:number,x:number)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
export interface Placed {x:number;y:number;z:number;angle:number;
 /** 0 hidden past the arc's ends to 1 fully on the organ. */
 shown:number}
export function place(i:number,ring:number,fan:number,out:Placed={x:0,y:0,z:0,angle:0,shown:1}):Placed{
 const a=tiers[i],b=fanned[i],tier=a.tier+(b.tier-a.tier)*fan,angle=wrapArc(a.angle+(b.angle*FAN_SPAN-a.angle)*fan+ring),r=R0+DR*tier;
 out.angle=angle;out.x=Math.sin(angle)*r;out.z=-Math.cos(angle)*r*.82+.2;out.y=Y0+DY*tier;
 out.shown=1-smooth(SPAN/2+.02,SPAN/2+(LOOP-SPAN)/2,Math.abs(angle));
 return out;
}
export const vialIndex=(id:string)=>organ.findIndex(i=>i.id===id);
export const vialCount=organ.length;
export const ingredientAt=(i:number)=>ingredientById.get(organ[i]?.id??'')??null;
