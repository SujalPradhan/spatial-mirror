import {ingredientById,type Family} from './ingredients';
import {ingredient,remaining,type Blend,type Skin} from './model';
/** The Accord: pouring, the day ribbon, the outline it is matched against, and plain smell words. Pure and illustrative. */

/** The day runs 9:00 to 18:00; the clock is hours after 9:00. */
export const DAY=9,START_HOUR=9;
/** Every blend here is worn at one plausible strength, about an eau de toilette; it is never shown. */
export const CONC=.08;
export const SAMPLES=37;
export type Items=Record<string,number>;
export const hourName=(t:number)=>{const m=Math.round((START_HOUR+Math.max(0,Math.min(DAY,t)))*60);return `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`;};

// ---- Pouring.
/** Wrist tilt under this is level: nothing pours, so holding a vial is inert. Radians. */
export const TILT_DEAD=.2,TILT_FULL=1;
/** Drops a second at full tilt. */
export const MAX_RATE=5;
const smooth=(a:number,b:number,x:number)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Drops per second for a wrist tilt in radians, either way: zero when level, continuous, and full past about 57°. */
export function pourRate(tilt:number){return Number.isFinite(tilt)?MAX_RATE*smooth(TILT_DEAD,TILT_FULL,Math.abs(tilt)):0;}
export const wrapAngle=(a:number)=>a-Math.PI*2*Math.floor((a+Math.PI)/(Math.PI*2));
/** How the hand is rolled on screen: the circular mean of the wrist→middle-knuckle axis and the index→pinky knuckle axis turned a quarter. Stage pixels, y down. */
export function handRoll(p:{x:number;y:number}[]):number|null{
 if(p.length<21)return null;
 const a=Math.atan2(p[9].y-p[0].y,p[9].x-p[0].x),b=Math.atan2(p[17].y-p[5].y,p[17].x-p[5].x)-Math.PI/2;
 const len=Math.hypot(p[9].x-p[0].x,p[9].y-p[0].y)+Math.hypot(p[17].x-p[5].x,p[17].y-p[5].y);if(len<4)return null;
 // The knuckle line flips with which hand it is, so it only counts when it agrees with the wrist axis.
 const bb=Math.abs(wrapAngle(b-a))<Math.PI/2?b:b+Math.PI;
 return Math.atan2(Math.sin(a)+Math.sin(bb),Math.cos(a)+Math.cos(bb));
}

// ---- The ribbon: what is on skin and how strongly, hour by hour.
export interface Band {id:string;v:number[]}
export interface Ribbon {t:number[];bands:Band[];total:number[]}
export const total=(items:Items)=>Object.values(items).reduce((s,n)=>s+Math.max(0,n),0);
export const toBlend=(items:Items):Blend=>({items:Object.entries(items).filter(([,d])=>d>1e-6).map(([id,drops])=>({id,drops})),conc:CONC});
/** How strongly one material smells at hour t: drops times odour strength times what is left. */
export const intensity=(id:string,drops:number,t:number,skin:Skin='normal')=>{const i=ingredient(id);return Math.max(0,drops)*i.strength*remaining(i,t,skin,CONC);};
/** Stacked bands, longest-lasting at the bottom. With `scaleTo`, the blend is resized to that many drops so only its proportions matter. */
export function ribbon(items:Items,skin:Skin='normal',scaleTo:number|null=null,n=SAMPLES):Ribbon{
 const sum=total(items),k=scaleTo&&sum>0?scaleTo/sum:1,t=Array.from({length:n},(_,i)=>i/(n-1)*DAY);
 const ids=Object.keys(items).filter(id=>items[id]>1e-6).sort((a,b)=>ingredient(b).tau-ingredient(a).tau);
 const bands=ids.map(id=>({id,v:t.map(h=>intensity(id,items[id]*k,h,skin))}));
 return {t,bands,total:t.map((_,j)=>bands.reduce((s,b)=>s+b.v[j],0))};
}
const area=(v:number[])=>v.reduce((s,x,i)=>s+(i===0||i===v.length-1?x/2:x),0);
export interface Fit {id:string;
 /** Your share of this material against the outline's: 1 is just right. */
 ratio:number;
 /** 0..1: the band filled, less half of any overshoot. */
 score:number}
export interface Match {score:number;per:Fit[];
 /** Area of materials the outline does not have, as a share of the outline. */
 extra:number}
/** How well a blend's ribbon fills an outline: each outline material counts equally, overshoot costs half, and strangers cost half their area. */
export function matchScore(items:Items,ghost:Items,skin:Skin='normal'):Match{
 const g=ribbon(ghost,skin),gt=total(ghost),u=ribbon(items,skin,gt),all=area(g.total);
 if(!total(items)||!all)return {score:0,per:Object.keys(ghost).map(id=>({id,ratio:0,score:0})),extra:0};
 const per=g.bands.map(gb=>{
  const ub=u.bands.find(b=>b.id===gb.id)?.v??gb.v.map(()=>0),G=area(gb.v);
  const under=area(gb.v.map((x,j)=>Math.min(x,ub[j]))),over=area(gb.v.map((x,j)=>Math.max(0,ub[j]-x)));
  return {id:gb.id,ratio:area(ub)/G,score:Math.max(0,Math.min(1,(under-.5*over)/G))};
 });
 const extra=u.bands.filter(b=>!(b.id in ghost)).reduce((s,b)=>s+area(b.v),0)/all;
 return {score:Math.max(0,Math.min(1,per.reduce((s,p)=>s+p.score,0)/per.length-.5*extra)),per,extra};
}
/** Share of `a` in a pair, for the balance bar: the classic exercise of trying two materials against each other. */
export function balance(items:Items,a:string,b:string){const x=Math.max(0,items[a]??0),y=Math.max(0,items[b]??0);return x+y>0?x/(x+y):.5;}

// ---- References. The ratios are illustrative teaching proportions, not anyone's formula.
export interface Reference {id:'fougere'|'chypre';name:string;items:Items}
export const FOUGERE:Reference={id:'fougere',name:'fougère',items:{lavender:8,tonka:6,oakmoss:2}};
export const CHYPRE:Reference={id:'chypre',name:'chypre',items:{bergamot:6,rose:5,oakmoss:3}};
/** Lock at this share of the outline. */
export const LOCK=.8;

// ---- Plain words, smell before chemistry.
export const plain:Record<string,[string,string]>={
 bergamot:['bright','tea-like'],lemon:['zesty','clean'],mandarin:['juicy','sweet'],'pink-pepper':['peppery','fizzy'],galbanum:['green','bitter'],petitgrain:['leafy','bright'],
 lavender:['fresh','herbal'],rose:['rosy','velvet'],jasmine:['heady','creamy'],ylang:['sweet','creamy'],clove:['hot','spicy'],cinnamon:['sweet','spicy'],
 cedar:['dry','pencil'],sandalwood:['milky','soft wood'],vetiver:['earthy','smoky'],oakmoss:['dark','forest'],tonka:['sweet','hay'],vanilla:['sweet','creamy'],
 musk:['clean skin','soft'],ambrette:['powdery','warm'],'moss-accord':['green','lighter moss'],'tonka-accord':['soft','hay'],'clove-accord':['soft','spice'],'cinnamon-accord':['round','spice'],
};
export const wordsOf=(id:string)=>plain[id]??(ingredientById.get(id)?.words.slice(0,2) as [string,string])??['',''];
/** How long a material lasts, in words. */
export const lasts=(id:string)=>{const t=ingredient(id).tau;return t<1?'gone within an hour or two':t<5?'lasts the morning':'lasts all day';};
const MOSS=new Set(['oakmoss','moss-accord']);
/** What you would smell at hour t, in two or three plain words. `peak` is what counts as full strength. */
export function smellAt(items:Items,t:number,skin:Skin='normal',peak=0):string[]{
 const parts=Object.keys(items).filter(id=>items[id]>1e-6).map(id=>({id,v:intensity(id,items[id],t,skin)})).sort((a,b)=>b.v-a.v),sum=parts.reduce((s,p)=>s+p.v,0);
 if(!sum||sum<(peak||0)*.06)return ['almost nothing'];
 const moss=parts.filter(p=>MOSS.has(p.id)).reduce((s,p)=>s+p.v,0)/sum;
 if(moss>=.3&&t<3)return ['damp','heavy'];
 const [a,b]=parts;
 if(!b||b.v/sum<.22)return [...wordsOf(a.id)];
 const out=[wordsOf(a.id)[0],wordsOf(b.id)[0]];if(parts[2]&&parts[2].v/sum>.18)out.push(wordsOf(parts[2].id)[0]);
 return [...new Set(out)];
}
/** What to change to fill the outline, in a plain sentence. */
export function diagnose(items:Items,ghost:Items,skin:Skin='normal'):{kind:'ok'|'more'|'less';id:string|null;text:string}{
 const m=matchScore(items,ghost,skin);if(m.score>=LOCK)return {kind:'ok',id:null,text:'That fills the outline.'};
 const worst=[...m.per].sort((a,b)=>a.score-b.score)[0],name=ingredient(worst.id).name.toLowerCase();
 const note=ingredient(worst.id).tau,when=note<1?'morning':note<5?'middle of the day':'evening';
 if(worst.ratio<1)return {kind:'more',id:worst.id,text:MOSS.has(worst.id)?`Nothing holds the evening: a touch more ${name}.`:`The ${when} is thin: pour a little more ${name}.`};
 return {kind:'less',id:worst.id,text:MOSS.has(worst.id)?`Too much ${name}: the morning smells damp and heavy.`:`Too much ${name}: it drowns the rest. Add the others, or take some back.`};
}
export type {Family};
