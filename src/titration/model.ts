/** Strong acid against strong base: the numbers behind the bench. Volumes are cm3, concentrations mol/dm3. */
export const ACID_VOLUME=25,BASE_CONC=.1,DROP=.05,BURETTE_MAX=50,KW=1e-14;
/** Air in the tip fills with titrant first, so the first run reads this much more than reaches the flask. */
export const BUBBLE_VOLUME=.3;
/** Residual rinse water in an unrinsed burette thins the titrant by this factor. */
export const UNRINSED_FACTOR=.98;
export const CONCORDANT=.1,READING_STEP=.05,TITRE_UNCERTAINTY=.1;
export const ACID_MIN=.08,ACID_MAX=.12;

export function mulberry32(seed:number){
 let a=seed>>>0;
 return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
/** The unknown acid for a session: between 0.08 and 0.12 mol/dm3 to four decimals. */
export function randomAcidConc(seed:number){return Math.round((ACID_MIN+mulberry32(seed)()*(ACID_MAX-ACID_MIN))*1e4)/1e4;}

/** pH of a solution whose net strong-acid excess is `net` mol/dm3 (negative: base excess), from charge balance with water's own ions. */
export function pHFromNet(net:number){
 const root=Math.sqrt(net*net+4*KW),h=net>=0?(net+root)/2:KW/((-net+root)/2);
 return -Math.log10(h);
}
/** pH after adding vBase of base to vAcid of acid. */
export function pHAt(cAcid:number,vAcid:number,cBase:number,vBase:number){
 const litres=(vAcid+vBase)/1000;
 return pHFromNet((cAcid*vAcid-cBase*vBase)/1000/litres);
}
/** Volume of base at which the acid is exactly neutralised (1:1). */
export const equivalenceVolume=(cAcid:number,vAcid=ACID_VOLUME,cBase=BASE_CONC)=>vAcid*cAcid/cBase;

export type IndicatorId='phenolphthalein'|'methyl-orange'|'universal';
export const indicatorIds:IndicatorId[]=['phenolphthalein','methyl-orange','universal'];
export const indicatorNames:Record<IndicatorId,string>={phenolphthalein:'Phenolphthalein','methyl-orange':'Methyl orange',universal:'Universal indicator'};
export type RGB=[number,number,number];
export interface Tint {rgb:RGB;alpha:number;name:string}
const mix=(a:RGB,b:RGB,t:number):RGB=>[0,1,2].map(i=>Math.round(a[i]+(b[i]-a[i])*t)) as RGB;
const clamp01=(n:number)=>Math.max(0,Math.min(1,n));
const logistic=(pH:number,pKa:number)=>1/(1+Math.pow(10,pKa-pH));
const PINK:RGB=[226,40,132],RED:RGB=[224,52,38],YELLOW:RGB=[246,200,32];
const UNIVERSAL:[number,RGB][]=[[1,[214,34,34]],[3,[238,98,34]],[5,[246,196,40]],[7,[96,176,70]],[9,[44,128,196]],[11,[110,72,170]],[13,[84,40,140]]];
function universalAt(pH:number):RGB{
 const p=Math.max(1,Math.min(13,pH));
 for(let i=1;i<UNIVERSAL.length;i++)if(p<=UNIVERSAL[i][0])return mix(UNIVERSAL[i-1][1],UNIVERSAL[i][1],(p-UNIVERSAL[i-1][0])/(UNIVERSAL[i][0]-UNIVERSAL[i-1][0]));
 return UNIVERSAL[UNIVERSAL.length-1][1];
}
/** What a flask of this pH looks like with a few drops of indicator in it. alpha is how strongly the liquid is tinted. */
export function indicatorTint(id:IndicatorId,pH:number):Tint{
 if(id==='phenolphthalein'){
  const f=logistic(pH,9.3);
  return {rgb:PINK,alpha:pH<8.2?0:clamp01(f)*.9,name:pH<8.2?'colourless':pH<9.6?'faint pink':pH<11?'pink':'deep pink'};
 }
 if(id==='methyl-orange'){
  const f=logistic(pH,3.75);
  return {rgb:mix(RED,YELLOW,f),alpha:.85,name:pH<3.1?'red':pH>4.4?'yellow':'orange'};
 }
 const names:[number,string][]=[[2,'red'],[4,'orange'],[6,'yellow'],[7.5,'green'],[10,'blue'],[14,'violet']];
 return {rgb:universalAt(pH),alpha:.8,name:names.find(n=>pH<n[0])![1]};
}
export const noTint:Tint={rgb:[255,255,255],alpha:0,name:'colourless'};
/** The wording that tells a student they have reached the end point, per indicator. */
export const endpointCue:Record<IndicatorId,string>={phenolphthalein:'the first faint pink that lasts after swirling','methyl-orange':'the first change from orange to yellow',universal:'green, but the colour changes gradually so the end point is vague'};

// ---- Stopcock and drops.
/** Wrist turn under this is level; the tap stays shut. Radians. */
export const TURN_DEAD=.2,TURN_FULL=1.1;
const smooth=(a:number,b:number,x:number)=>{const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
export const tapFromTurn=(turn:number)=>Number.isFinite(turn)?smooth(TURN_DEAD,TURN_FULL,Math.abs(turn)):0;
/** Below this opening the tap drips; above it a stream runs. */
export const DRIP_LIMIT=.2,MAX_DRIPS=4,MAX_STREAM=2;
/** Drops per second when dripping, zero once streaming. */
export const dripRate=(tap:number)=>tap<=0?0:tap<DRIP_LIMIT?MAX_DRIPS*tap/DRIP_LIMIT:0;
/** Titrant leaving the tip in cm3 per second. Continuous at the drip limit. */
export function flowRate(tap:number){
 if(!(tap>0))return 0;
 const t=Math.min(1,tap);
 return t<DRIP_LIMIT?dripRate(t)*DROP:MAX_DRIPS*DROP+(t-DRIP_LIMIT)/(1-DRIP_LIMIT)*(MAX_STREAM-MAX_DRIPS*DROP);
}

// ---- Swirling: the flask is turned in a circle, whichever way.
/** Revolutions a second of a hand going round, read from a trail of screen positions. */
export class SwirlDetector {
 private trail:{x:number;y:number;t:number}[]=[];
 constructor(private readonly windowMs=800,private readonly minRadius=.02){}
 reset(){this.trail=[];}
 push(x:number,y:number,t:number){
  this.trail.push({x,y,t});
  while(this.trail.length&&t-this.trail[0].t>this.windowMs)this.trail.shift();
 }
 /** Absolute turning over the trail divided by its duration, zero unless the path really circles. */
 rate():number{
  const p=this.trail;if(p.length<6)return 0;
  const cx=p.reduce((s,q)=>s+q.x,0)/p.length,cy=p.reduce((s,q)=>s+q.y,0)/p.length;
  const radius=p.reduce((s,q)=>s+Math.hypot(q.x-cx,q.y-cy),0)/p.length;
  if(radius<this.minRadius)return 0;
  // Heading changes along the path: a circle turns steadily, a line or a shake does not add up.
  let turn=0,last:number|null=null;
  for(let i=1;i<p.length;i++){
   const dx=p[i].x-p[i-1].x,dy=p[i].y-p[i-1].y;if(Math.hypot(dx,dy)<radius*.05)continue;
   const heading=Math.atan2(dy,dx);
   if(last!==null){let d=heading-last;d-=Math.PI*2*Math.round(d/(Math.PI*2));turn+=d;}
   last=heading;
  }
  const seconds=(p[p.length-1].t-p[0].t)/1000;
  return seconds>.2?Math.abs(turn)/(Math.PI*2)/seconds:0;
 }
}

// ---- Reading and results.
/** The nearest 0.05, which is as fine as a burette is read by eye. */
export const roundReading=(v:number)=>Math.round(v/READING_STEP)*READING_STEP;
/** A reading is wrong when it is more than one half division (0.05) from the truth. */
export const readingWrong=(typed:number,truth:number)=>Math.abs(typed-truth)>READING_STEP+1e-9;
export const fmt=(v:number,digits=2)=>v.toFixed(digits);
export interface Concordance {indices:number[];mean:number|null;spread:number|null}
/** The largest set of accurate titres lying within 0.10 cm3 of each other, preferring the tightest, and their mean. The rough titre is never passed in. */
export function concordance(titres:number[],tolerance=CONCORDANT):Concordance{
 const order=titres.map((t,i)=>({t,i})).sort((a,b)=>a.t-b.t);
 let best:{t:number;i:number}[]=[];
 for(let lo=0;lo<order.length;lo++)for(let hi=lo+1;hi<order.length;hi++){
  if(order[hi].t-order[lo].t>tolerance+1e-9)break;
  const set=order.slice(lo,hi+1);
  if(set.length>best.length||set.length===best.length&&set[set.length-1].t-set[0].t<best[best.length-1].t-best[0].t)best=set;
 }
 if(best.length<2)return {indices:[],mean:null,spread:null};
 return {indices:best.map(b=>b.i).sort((a,b)=>a-b),mean:best.reduce((s,b)=>s+b.t,0)/best.length,spread:best[best.length-1].t-best[0].t};
}
export interface CalcSteps {nBase:number;nAcid:number;conc:number}
/** The worked answer from a mean titre; follow-through, so a student's own titre is marked against itself. */
export function calcFromTitre(titre:number,cBase=BASE_CONC,vAcid=ACID_VOLUME):CalcSteps{
 const nBase=titre/1000*cBase;return {nBase,nAcid:nBase,conc:nBase/(vAcid/1000)};
}
/** Within 1% of the expected value counts as right, which allows ordinary rounding to three figures. */
export const closeTo=(value:number,expected:number,tol=.01)=>Number.isFinite(value)&&expected!==0&&Math.abs(value-expected)/Math.abs(expected)<=tol;
export const percentError=(value:number,truth:number)=>(value-truth)/truth*100;
/** Points for a question by how many tries it took: 10, 8, 6, 4, then 2. */
export const quizPoints=(attempt:number)=>Math.max(2,12-2*attempt);
