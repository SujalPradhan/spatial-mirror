import {CHYPRE,FOUGERE,LOCK,hourName,type Items} from './accord';
import {organ} from './ingredients';
/** The guided chapters as a plain state machine: facts in, one line of text and what is on stage out. */
export type Chapter=1|2|3|4;
export type Beat='intro'|'lavender'|'waft'|'top'|'carry'|'scrub'|'adjust'|'reveal'|'rule'|'insight'|'chypre'|'chypreReveal'|'free';
export type GestureId='pinch'|'tilt'|'both'|'waft'|'fist'|'undo'|'button'|'rub';
export const chapterOf:Record<Beat,Chapter>={intro:1,lavender:1,waft:1,top:1,carry:1,scrub:1,adjust:1,reveal:1,rule:2,insight:2,chypre:3,chypreReveal:3,free:4};
export const chapterNames:Record<Chapter,string>={1:'The accord',2:'Restricted',3:'Chypre',4:'Full organ'};
export interface HeldFact {id:string;inZone:boolean;rate:number}
export interface Facts {
 items:Items;held:HeldFact[];
 /** Wafts and day span scrubbed so far, in hours. */
 wafts:number;scrubbed:number;
 /** Match with the outline, and what to change. */
 score:number;diagnosis:string;
 swapped:boolean;kept:number;
 /** Tonka's share of tonka plus oakmoss. */
 pair:number;
 /** The clock now, and the smell at it. */
 clock:number;words:string[];
 /** Any pinch or click: lets the opening line be skipped. */
 poked:boolean;
}
export interface StoryView {chapter:Chapter;beat:Beat;text:string;sub:string;
 vials:string[];
 /** Vials a pinch may take now; the rest are visible but asleep. */
 active:string[];
 ghost:Items|null;ribbonLive:boolean;labelOn:boolean;scoreOn:boolean;
 offer:string|null;gestures:GestureId[];
 /** Seconds since the outline locked in this chapter, or -1. */
 locked:number}
const FREE=[...organ.map(i=>i.id),'moss-accord'];
const has=(f:Facts,id:string,n:number)=>(f.items[id]??0)>=n;
export class Story {
 beat:Beat='intro';
 private since=0;private quiet=0;private waftsAt=0;private live=false;private lockedAt=-1;private t=0;
 /** The chapter-1 accord, the outline of chapter 2. */
 original:Items|null=null;
 get chapter():Chapter{return chapterOf[this.beat];}
 /** The outline the palm is matched against in this chapter. */
 get ghost():Items|null{const c=this.chapter;return c===1?FOUGERE.items:c===2?this.original:c===3?CHYPRE.items:null;}
 /** Jumps to the start of a chapter. The engine sets up the palm to match. */
 goto(c:Chapter){this.set(({1:'intro',2:'rule',3:'chypre',4:'free'} as const)[c]);this.live=c>1;this.lockedAt=-1;}
 /** The offer button: on to the next chapter. */
 next(){const c=this.chapter;if(c<4)this.goto((c+1) as Chapter);}
 private set(b:Beat){if(b!==this.beat){this.beat=b;this.since=0;}}
 /** Advances on the facts; returns 'locked' on the update the outline locks. */
 update(f:Facts,dt:number):'locked'|null{
  const h=Number.isFinite(dt)?Math.max(0,dt):0;this.t+=h;this.since+=h;
  const pouring=f.held.some(x=>x.rate>0&&x.inZone),holding=f.held.length>0;this.quiet=pouring?0:this.quiet+h;
  const settled=(s:number)=>this.quiet>=s&&!holding;
  let locked:'locked'|null=null;const lock=(b:Beat)=>{this.set(b);this.lockedAt=this.t;locked='locked';};
  switch(this.beat){
   case 'intro':if(this.since>=3.5||f.poked)this.set('lavender');break;
   case 'lavender':if(has(f,'lavender',5)&&this.quiet>=.6)this.set('waft');break;
   case 'waft':if(f.wafts>this.waftsAt){this.live=true;this.set('top');}break;
   case 'top':if(this.since>=4.5)this.set('carry');break;
   case 'carry':if(has(f,'tonka',1.5)&&has(f,'oakmoss',.8)&&settled(.8))this.set('scrub');break;
   case 'scrub':if(f.scrubbed>=5&&!pouring){if(f.score>=LOCK)lock('reveal');else this.set('adjust');}break;
   case 'adjust':if(f.score>=LOCK&&settled(.6))lock('reveal');break;
   case 'rule':if(f.swapped&&settled(1))this.set('insight');break;
   case 'chypre':if(f.score>=LOCK&&settled(.6))lock('chypreReveal');break;
  }
  if(this.beat==='waft'&&this.since===0)this.waftsAt=f.wafts;
  return locked;
 }
 view(f:Facts):StoryView{
  const b=this.beat,c=this.chapter,hold=f.held[0],ghost=this.ghost;
  const vials=c===1?['tonka','lavender','oakmoss']:c===2?['tonka','lavender','oakmoss','moss-accord']:c===3?['bergamot','rose','oakmoss']:FREE;
  const active=b==='intro'?[]:['lavender','waft','top'].includes(b)?['lavender']:c===2?vials.filter(v=>v!=='oakmoss'):vials;
  let text='',sub='',gestures:GestureId[]=[],offer:string|null=null;
  const now=`${hourName(f.clock)}: ${f.words.join(', ')}`;
  switch(b){
   case 'intro':text='Perfumes change through the day. Let’s build one that lasts.';sub='The lit circle is your palm. The band along the bottom is your day, 9:00 to 18:00.';break;
   case 'lavender':text='Pick up the lavender and pour it into your palm.';gestures=['pinch','tilt'];
    sub=!hold?'Pinch the middle vial, the lavender.':!hold.inZone?'Bring it over your palm.':hold.rate>0?'Pouring… level your wrist to stop.':has(f,'lavender',5)?'That’s enough. Let go to put it down.':'Now tilt your wrist to pour. Level it to stop.';break;
   case 'waft':text='Now smell it: wave your open hand up toward your face.';gestures=['waft'];sub=holding(f)?'Let go of the vial first.':'A quick upward wave, fingers open.';break;
   case 'top':text='Lavender is a top note: it’s gone by lunch.';sub='Bright at 9:00, thin by 11:00, empty by noon.';gestures=['waft'];break;
   case 'carry':text='Something has to carry it. Hold tonka in one hand and oakmoss in the other.';gestures=['both','tilt','undo'];
    sub=(f.items.oakmoss??0)>.5&&f.pair<.6?'Too much oakmoss: the morning turns damp and heavy. Hold 👎 to take it back, or add tonka.':!f.held.length&&!f.items.tonka&&!f.items.oakmoss?'Pinch one vial with each hand, then tilt both wrists to pour together.':(f.items.tonka??0)+(f.items.oakmoss??0)<(f.items.lavender??0)*.5?'The evening is still empty. Keep pouring.':'The bar shows the mix of the two. Aim for the notch.';break;
   case 'scrub':text='Make a fist and turn it like a dial to move through the day.';gestures=['fist','waft','undo'];sub=f.scrubbed>.5?`${now}. Tonka and oakmoss are base notes: they carry the evening.`:'Turn right for later, left for earlier.';break;
   case 'adjust':text=f.diagnosis;sub='Fill the dotted outline. Hold 👎 to take a pour back.';gestures=['pinch','tilt','fist','waft','undo'];break;
   case 'reveal':text='You made a fougère — the 1882 accord behind the ‘barbershop’ smell.';sub='Lavender opens it, coumarin (tonka) bridges it, oakmoss holds it.';offer='Why did old perfumes change? →';gestures=['button','fist','waft'];break;
   case 'rule':text='Oakmoss can cause skin allergies: today it must be named, and its use is limited.';gestures=['pinch','tilt','undo'];
    sub=f.swapped?'Swapped. Smell it, or scrub to the evening.':hold?.id==='moss-accord'?(hold.inZone?'Tilt to pour the stand-in.':'Bring it over your palm.'):'Swap in the moss stand-in: pick it up and pour it into your palm.';break;
   case 'insight':text=`The evening faded: the stand-in is lighter than oakmoss. ${Math.round(f.kept*100)}% of the character is left.`;sub='This is why your favourite perfume was reformulated. Pour more stand-in or tonka to win some evening back.';offer='Next: a second family →';gestures=['pinch','tilt','fist','undo'];break;
   case 'chypre':text='A second family, the chypre: bright bergamot, a rose heart, a mossy base.';sub=f.score>0?`${f.diagnosis} Rose is a heart note: it holds the middle of the day.`:'Fill the dotted outline: it has three layers this time.';gestures=['pinch','tilt','fist','waft','undo'];break;
   case 'chypreReveal':text='You made a chypre: citrus on top, flowers in the middle, moss underneath.';sub='Both old families lean on oakmoss, so both were reformulated.';offer='Open the full organ →';gestures=['button','fist','waft'];break;
   case 'free':text='The full organ. Build anything; the band shows how it wears through the day.';sub='Colours are families. Rub your palms together to warm the skin.';gestures=['pinch','tilt','waft','fist','rub','undo'];break;
  }
  return {chapter:c,beat:b,text,sub,vials,active,ghost,ribbonLive:this.live||c>1,labelOn:c>=2,scoreOn:c===3||c===1&&['carry','scrub','adjust','reveal'].includes(b),offer,gestures,locked:this.lockedAt>=0&&chapterOf[b]===c&&(b==='reveal'||b==='chypreReveal')?this.t-this.lockedAt:-1};
 }
}
const holding=(f:Facts)=>f.held.length>0;
