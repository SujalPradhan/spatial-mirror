import {allergenById,allergens,families,ingredientById,noteClass,type Family,type Ingredient,type NoteClass} from './ingredients';
/** Blending, evaporation, labels and the compliance pass, with no rendering. Illustrative throughout: not regulatory or formulation advice. */
export type Skin='normal'|'warm'|'dry'|'oily';
export const skins:Skin[]=['normal','warm','dry','oily'];
/** How fast each skin lets a material go, against normal. Warm skin lifts volatiles, dry skin holds less, oily skin holds more. */
export const skinRate:Record<Skin,number>={normal:1,warm:1.35,dry:1.25,oily:.72};
export type Product='leave-on'|'rinse-off';
/** Declaration thresholds in the finished product, %: 0.001% leave-on, 0.01% rinse-off. */
export const THRESHOLD:Record<Product,number>={'leave-on':.001,'rinse-off':.01};
export const HOURS=8,MAX_DROPS=10,FULL_DROPS=60;
/** Share of fragrance oil in the finished product, from 3% to 30%. */
export const CONC_MIN=.03,CONC_MAX=.3;
export interface Addition {id:string;drops:number}
export interface Blend {items:Addition[];conc:number}
export const ingredient=(id:string):Ingredient=>{const i=ingredientById.get(id);if(!i)throw Error(`Unknown ingredient ${id}`);return i;};
export const concName=(c:number)=>c<.05?'Eau fraîche':c<.12?'Eau de toilette':c<.2?'Eau de parfum':'Extrait';
export const clampConc=(c:number)=>Math.max(CONC_MIN,Math.min(CONC_MAX,Number.isFinite(c)?c:.15));

/** Drops per material, merged in first-added order. */
export function totals(b:Blend){const m=new Map<string,number>();for(const a of b.items)if(a.drops>0)m.set(a.id,(m.get(a.id)??0)+a.drops);return m;}
/** Rebalanced doses are fractional, so the sum is rounded to a tenth for display. */
export const dropCount=(b:Blend)=>Math.round([...totals(b).values()].reduce((s,n)=>s+n,0)*10)/10;
/** Mass share of each material in the oil, summing to 1. */
export function shares(b:Blend){const t=totals(b),n=dropCount(b),out=new Map<string,number>();if(n>0)for(const [id,d] of t)out.set(id,d/n);return out;}
/** Longer-lasting at higher concentration: more oil on skin is a thicker film. */
export const longevity=(conc:number)=>Math.pow(.15/clampConc(conc),.3);
export const rate=(i:Ingredient,skin:Skin,conc:number,fix=0)=>skinRate[skin]*longevity(conc)*(i.tau>5?1:1-fix)/i.tau;
/** Share of a material still on skin after `hours`. */
export const remaining=(i:Ingredient,hours:number,skin:Skin,conc:number,fix=0)=>Math.exp(-Math.max(0,hours)*rate(i,skin,conc,fix));

/** Liquid colour: the drops' own colours mixed in linear light, weighted by drops. */
export function mixColor(b:Blend):[number,number,number]{
 const s=shares(b);if(!s.size)return [1,1,1];
 const lin=(c:number)=>Math.pow(c/255,2.2);let r=0,g=0,bl=0;
 for(const [id,w] of s){const h=ingredient(id).color,n=parseInt(h.slice(1),16);r+=lin(n>>16&255)*w;g+=lin(n>>8&255)*w;bl+=lin(n&255)*w;}
 const out=(c:number)=>Math.pow(c,1/2.2);return [out(r),out(g),out(bl)];
}

export interface Part {id:string;share:number}
/** What is left on skin at `hours`, as shares of what is left. */
export function composition(b:Blend,hours:number,skin:Skin,fix=0):{parts:Part[];left:number}{
 const s=shares(b);let sum=0;const raw:Part[]=[];
 for(const [id,w] of s){const a=w*remaining(ingredient(id),hours,skin,b.conc,fix);raw.push({id,share:a});sum+=a;}
 return {parts:raw.map(p=>({id:p.id,share:sum>0?p.share/sum:0})).sort((a,b)=>b.share-a.share),left:sum};
}
/** The order a blend's materials are gone in: the hour each falls below a tenth of its dose. */
export function evaporationOrder(b:Blend,skin:Skin){
 return [...shares(b).keys()].map(id=>{const i=ingredient(id);return {id,gone:Math.log(10)/rate(i,skin,b.conc)};}).sort((a,b)=>a.gone-b.gone);
}
export interface Layer {note:NoteClass;parts:Part[];share:number}
/** Top, heart and base by each material's volatility. */
export function layers(b:Blend):Layer[]{
 const s=shares(b);
 return (['top','heart','base'] as const).map(note=>{
  const parts=[...s].filter(([id])=>noteClass(ingredient(id).tau)===note).map(([id,share])=>({id,share})).sort((a,b)=>b.share-a.share);
  return {note,parts,share:parts.reduce((t,p)=>t+p.share,0)};
 });
}

export interface LabelLine {id:string;name:string;since:2003|2023;
 /** % of the finished product in the bottle, and on skin at the hour asked. */
 product:number;onSkin:number;
 declared:boolean;
 /** Over the illustrative ceiling. */
 flagged:boolean;cap?:number;
 /** 1 at application, falling as it evaporates. */
 strength:number}
/** Every declarable allergen present, in the bottle and on skin at `hours`. Declared lines are at or over the threshold in the bottle. */
export function label(b:Blend,product:Product='leave-on',hours=0,skin:Skin='normal',fix=0):LabelLine[]{
 const s=shares(b),bottle=new Map<string,number>(),skinNow=new Map<string,number>();
 for(const [id,w] of s){
  const i=ingredient(id),r=remaining(i,hours,skin,b.conc,fix);
  for(const [a,f] of Object.entries(i.allergens)){const p=w*f*b.conc*100;bottle.set(a,(bottle.get(a)??0)+p);skinNow.set(a,(skinNow.get(a)??0)+p*r);}
 }
 return [...bottle].map(([id,p])=>{
  const a=allergenById.get(id)!,on=skinNow.get(id)??0;
  return {id,name:a.name,since:a.since,product:p,onSkin:on,declared:p>=THRESHOLD[product],flagged:a.cap!==undefined&&p>a.cap,cap:a.cap,strength:p>0?on/p:0};
 }).sort((x,y)=>y.product-x.product);
}
/** The words that would follow "Contains:". */
export const declared=(b:Blend,product:Product='leave-on')=>label(b,product).filter(l=>l.declared).map(l=>l.name);

/** Perceived family profile over the whole dry-down: each material's strength times how long it is there. */
export function character(b:Blend,skin:Skin='normal'):Record<Family,number>{
 const out=Object.fromEntries(families.map(f=>[f,0])) as Record<Family,number>;
 for(const [id,w] of shares(b)){const i=ingredient(id),k=rate(i,skin,b.conc);out[i.family]+=w*i.strength*(1-Math.exp(-HOURS*k))/k/HOURS*(i.hidden?.85:1);}
 return out;
}
const cosine=(a:Record<Family,number>,b:Record<Family,number>)=>{let d=0,x=0,y=0;for(const f of families){d+=a[f]*b[f];x+=a[f]**2;y+=b[f]**2;}return x&&y?d/Math.sqrt(x*y):1;};

export interface Change {id:string;from:number;to:number;kind:'reduced'|'substituted';by?:string;because:string[]}
export interface Compliance {before:Blend;after:Blend;changes:Change[];flaggedBefore:string[];flaggedAfter:string[];
 /** 0..1: how much of the blend's character survives, by family profile and the stand-ins' fidelity. */
 kept:number;
 /** Families that lost most, as shares of their old weight. */
 losses:{family:Family;change:number}[]}
const round=(n:number)=>Math.round(n*10)/10;
const flaggedIds=(b:Blend)=>label(b).filter(l=>l.flagged).map(l=>l.id);
/** Brings each flagged allergen under its ceiling: a material that carries most of it and must lose more than half goes to its stand-in; otherwise every contributor is scaled down. */
export function makeCompliant(before:Blend):Compliance {
 const after:Blend={conc:before.conc,items:[...totals(before)].map(([id,drops])=>({id,drops}))},changes=new Map<string,Change>();
 const fidelity:number[]=[];
 for(let pass=0;pass<8;pass++){
  const over=label(after).filter(l=>l.flagged);if(!over.length)break;
  for(const line of over){
   const s=shares(after),cap=line.cap!,ratio=cap/line.product*.92;
   const from=[...s].map(([id,w])=>({id,part:w*(ingredient(id).allergens[line.id]??0)})).filter(c=>c.part>0).sort((a,b)=>b.part-a.part),total=from.reduce((t,c)=>t+c.part,0);
   const lead=from[0];if(!lead)continue;
   const item=(id:string)=>after.items.find(a=>a.id===id)!;
   const note=(id:string,kind:Change['kind'],by?:string)=>{const was=changes.get(id),start=was?.from??totals(before).get(id)??0;const c:Change={id,from:start,to:round(item(by??id)?.drops??0),kind:was?.kind==='substituted'?'substituted':kind,by:by??was?.by,because:[...new Set([...(was?.because??[]),line.name])]};changes.set(id,c);};
   const sub=ingredient(lead.id).substitute;
   if(sub&&lead.part/total>.7&&ratio<.5){
    const it=item(lead.id);it.id=sub;fidelity.push(ingredient(lead.id).fidelity??.6);note(lead.id,'substituted',sub);
   }else for(const c of from){const it=item(c.id);it.drops=Math.max(.1,round(it.drops*Math.max(.05,ratio)));note(c.id,'reduced');}
  }
 }
 for(const c of changes.values())c.to=round(after.items.find(a=>a.id===(c.by??c.id))?.drops??0);
 const a=character(before),b=character(after),kept=Math.max(0,cosine(a,b)*fidelity.reduce((k,f)=>k*(.5+.5*f),1));
 const losses=families.filter(f=>a[f]>0).map(family=>({family,change:(b[family]-a[family])/a[family]})).filter(l=>l.change<-.05).sort((x,y)=>x.change-y.change);
 return {before,after,changes:[...changes.values()],flaggedBefore:flaggedIds(before),flaggedAfter:flaggedIds(after),kept,losses};
}

export interface Worn {blend:Blend;name:string}
/** Several finished blends on one forearm. Base materials in any layer fix the lighter ones a little, and the label is the sum. */
export function layering(stack:Blend[],hours:number,skin:Skin){
 const amount=(b:Blend,fix:number)=>{let t=0;for(const [id,w] of shares(b))t+=w*b.conc*remaining(ingredient(id),hours,skin,b.conc,fix);return t;};
 const base=stack.reduce((t,b)=>{for(const [id,w] of shares(b))if(ingredient(id).tau>5)t+=w*b.conc;return t;},0),all=stack.reduce((t,b)=>t+b.conc,0);
 /** Up to 30% slower top and heart notes when the stack is base-heavy. */
 const fix=all>0?.3*Math.min(1,base/all*1.6):0;
 const each=stack.map(b=>amount(b,fix)),alone=stack.map(b=>amount(b,0)),sum=each.reduce((a,b)=>a+b,0);
 return {fix,share:each.map(e=>sum>0?e/sum:0),left:each,alone,dominant:sum>0?each.indexOf(Math.max(...each)):-1};
}
/** Label for a stack worn together: every layer's allergens on skin added up. */
export function stackLabel(stack:Blend[],hours:number,skin:Skin,product:Product='leave-on'){
 const fix=layering(stack,hours,skin).fix,m=new Map<string,LabelLine>();
 for(const b of stack)for(const l of label(b,product,hours,skin,fix)){const was=m.get(l.id);m.set(l.id,was?{...was,product:was.product+l.product,onSkin:was.onSkin+l.onSkin}:{...l});}
 return [...m.values()].map(l=>({...l,declared:l.product>=THRESHOLD[product],strength:l.product>0?l.onSkin/l.product:0,flagged:l.cap!==undefined&&l.product>l.cap})).sort((a,b)=>b.product-a.product);
}
export {allergens};
