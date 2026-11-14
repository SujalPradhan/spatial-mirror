import {ACID_VOLUME,BASE_CONC,BUBBLE_VOLUME,BURETTE_MAX,DROP,UNRINSED_FACTOR,calcFromTitre,closeTo,concordance,equivalenceVolume,flowRate,fmt,indicatorTint,mulberry32,noTint,pHAt,pHFromNet,percentError,quizPoints,randomAcidConc,readingWrong,type CalcSteps,type Concordance,type IndicatorId,type Tint} from './model';

/** Acid held in the patch of liquid around where each drop lands, in cm3. */
const ZONE=3;
/** Per second: how fast an unswirled drop spreads, and how much faster a swirl makes it. */
const MIX_STILL=.12,MIX_SWIRL=5;
const SWIRL_TIMER=1.5;

export interface Run {
 kind:'rough'|'accurate';indicator:IndicatorId;
 initial:number;final:number;titre:number;initialTrue:number;finalTrue:number;
 initialWrong:boolean;finalWrong:boolean;
 /** cm3 past the true equivalence volume; negative when stopped early. */
 excess:number;bubbleError:number;swirled:boolean;
}
interface Flask {bulk:number;local:number;delivered:number;indicator:IndicatorId|null;initial:number|null;initialTrue:number;swirlSeconds:number;bubbleTaken:number;done:boolean}
export type CalcStep='nBase'|'nAcid'|'conc';
export const calcSteps:CalcStep[]=['nBase','nAcid','conc'];
export interface CalcEntry {value:number|null;ok:boolean;tries:number}
/** affects: whether the error moved the mean titre, as opposed to only a rough run. */
export interface Issue {id:string;text:string;cost:number;affects:boolean}
export interface ProcedureStep {id:string;label:string;state:'done'|'current'|'todo'|'skipped'}
export interface Report {
 issues:Issue[];technique:number;readings:number;accuracy:number;quiz:number;hints:number;total:number;
 acid:number;found:number|null;error:number|null;mean:number|null;runs:Run[];wrongReadings:number;elapsed:number;
}
export const QUESTION_COUNT=4,TECHNIQUE_MAX=30,READINGS_MAX=10,ACCURACY_MAX=40,QUIZ_MAX=20,HINT_COST=2;
export const accuracyPoints=(error:number)=>{const e=Math.abs(error);return e<=1?40:e<=2?32:e<=3?24:e<=5?16:e<=10?8:0;};

/** One session at the bench. Pure: time only moves when step() is called, and all randomness comes from the seed. */
export class Bench {
 readonly acid:number;
 private readonly random:()=>number;
 rinsed=false;filled=false;bubbleCleared=false;bubbleLeft=0;titrantConc=BASE_CONC;reading=0;
 /** Stopcock opening, 0 shut to 1 fully open. */
 tap=0;swirlInput=0;swirlTimer=0;
 flask:Flask|null=null;indicator:IndicatorId|null=null;
 runs:Run[]=[];
 calc:Record<CalcStep,CalcEntry>={nBase:{value:null,ok:false,tries:0},nAcid:{value:null,ok:false,tries:0},conc:{value:null,ok:false,tries:0}};
 quiz:Record<string,{attempts:number;correct:boolean}>={};
 hints=0;elapsed=0;drops=0;
 constructor(readonly seed:number){this.random=mulberry32(seed^0x5bd1e995);this.acid=randomAcidConc(seed);}

 // ---- Preparation.
 rinse():string{
  if(this.filled)return 'The burette is already filled. Rinse it before filling next time.';
  if(this.rinsed)return 'The burette is already rinsed with sodium hydroxide.';
  this.rinsed=true;return 'Burette rinsed with a little sodium hydroxide.';
 }
 fill():string{
  if(!this.filled){
   this.filled=true;this.titrantConc=this.rinsed?BASE_CONC:BASE_CONC*UNRINSED_FACTOR;
   this.bubbleLeft=BUBBLE_VOLUME;this.reading=this.nextStart();
   return 'Burette filled with 0.100 mol/dm3 sodium hydroxide. Look at the tip.';
  }
  if(this.flask&&!this.flask.done)return 'Finish this titration before topping up the burette.';
  this.reading=this.nextStart();return 'Burette topped up. Read it again.';
 }
 private nextStart(){return Math.round((.05+this.random()*.9)*100)/100;}
 get bubble(){return this.bubbleLeft>0;}
 clearBubble():string{
  if(!this.filled)return 'Fill the burette first.';
  if(!this.bubble)return 'The tip is already full of titrant.';
  this.bubbleLeft=0;this.bubbleCleared=true;this.reading=Math.round((this.reading+.35)*100)/100;
  return 'Air run out of the tip. Read the burette again.';
 }
 pipette():string{
  if(this.flask&&!this.flask.done)return 'Finish this titration first: record its final reading.';
  this.flask={bulk:0,local:0,delivered:0,indicator:null,initial:null,initialTrue:0,swirlSeconds:0,bubbleTaken:0,done:false};
  this.tap=0;return 'Acid in the flask. Add an indicator.';
 }
 addIndicator(id:IndicatorId):string{
  if(!this.flask||this.flask.done)return 'Pipette 25.0 cm3 of acid into a conical flask first.';
  if(this.flask.indicator)return 'This flask already has an indicator.';
  this.flask.indicator=this.indicator=id;return 'Indicator added. Read the burette and record the initial reading.';
 }
 get flaskReady(){return !!this.flask&&!this.flask.done&&!!this.flask.indicator;}
 recordInitial(typed:number):string{
  const f=this.flask;
  if(!f||!f.indicator||f.done)return 'Prepare the flask first.';
  if(f.initial!==null)return 'Initial reading already recorded.';
  if(!Number.isFinite(typed)||typed<0||typed>BURETTE_MAX)return 'Enter a reading between 0 and 50 cm3.';
  f.initial=typed;f.initialTrue=this.reading;return 'Initial reading recorded. The tap is free to turn.';
 }
 get canFlow(){return this.filled&&!!this.flask&&!this.flask.done&&this.flask.initial!==null&&this.reading<BURETTE_MAX-1e-9;}
 /** Why the tap will not run, or null when it can. */
 get blocked():string|null{
  if(!this.filled)return 'Fill the burette first.';
  if(!this.flask||this.flask.done)return 'Pipette acid into a flask and add indicator first.';
  if(!this.flask.indicator)return 'Add an indicator to the flask first.';
  if(this.flask.initial===null)return 'Record the initial reading first.';
  if(this.reading>=BURETTE_MAX-1e-9)return 'The burette is empty. Top it up.';
  return null;
 }

 // ---- Delivering titrant.
 setTap(value:number){this.tap=Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}
 setSwirl(level:number){this.swirlInput=Math.max(0,Math.min(1,level));}
 swirlPulse(){this.swirlTimer=SWIRL_TIMER;}
 private deliver(volume:number){
  const f=this.flask;if(!f||!this.canFlow)return;
  const v=Math.min(volume,BURETTE_MAX-this.reading);if(v<=0)return;
  this.reading+=v;
  const air=Math.min(v,this.bubbleLeft);this.bubbleLeft-=air;f.bubbleTaken+=air;
  f.local+=v-air;f.delivered+=v-air;
 }
 dropOne():boolean{if(!this.canFlow)return false;this.deliver(DROP);this.drops++;return true;}
 step(dt:number){
  this.elapsed+=Math.max(0,dt);
  this.swirlTimer=Math.max(0,this.swirlTimer-dt);
  const f=this.flask,swirl=Math.max(this.swirlInput,this.swirlTimer>0?1:0);
  if(this.canFlow&&this.tap>0){const before=this.reading;this.deliver(flowRate(this.tap)*dt);this.drops+=(this.reading-before)/DROP;}
  if(f&&!f.done){
   const k=MIX_STILL+MIX_SWIRL*swirl,moved=f.local*(1-Math.exp(-k*dt));f.local-=moved;f.bulk+=moved;
   if(swirl>.3&&f.initial!==null)f.swirlSeconds+=dt;
  }
 }

 // ---- What the flask looks like.
 get delivered(){return this.flask?.delivered??0;}
 get bulkPH(){const f=this.flask;return f?pHAt(this.acid,ACID_VOLUME,this.titrantConc,f.bulk):NaN;}
 /** pH of the patch around the falling drops, which is richer in base until it is swirled in. */
 get localPH(){
  const f=this.flask;if(!f)return NaN;
  const acidMol=(this.acid*ACID_VOLUME-this.titrantConc*f.bulk)/1000,share=ZONE/(ACID_VOLUME+f.bulk);
  return pHFromNet((acidMol*share-this.titrantConc*f.local/1000)/((ZONE+f.local)/1000));
 }
 get tint():Tint{const f=this.flask;return f?.indicator?indicatorTint(f.indicator,this.bulkPH):noTint;}
 get localTint():Tint{const f=this.flask;return f?.indicator?indicatorTint(f.indicator,this.localPH):noTint;}
 /** cm3 delivered beyond the exact equivalence volume; negative while still short of it. */
 get excess(){return (this.flask?.delivered??0)-equivalenceVolume(this.acid,ACID_VOLUME,this.titrantConc);}
 /** The title the scene and live region use: no numbers a reader should have judged by eye. */
 get flaskColour(){return this.flask?this.tint.name:'no flask';}

 recordFinal(typed:number):string{
  const f=this.flask;
  if(!f||f.initial===null||f.done)return 'Record the initial reading and run a titration first.';
  if(!Number.isFinite(typed)||typed<=f.initial||typed>BURETTE_MAX)return 'The final reading must be above the initial reading and no more than 50 cm3.';
  this.tap=0;f.done=true;
  const run:Run={kind:this.runs.length?'accurate':'rough',indicator:f.indicator!,initial:f.initial,final:typed,titre:typed-f.initial,initialTrue:f.initialTrue,finalTrue:this.reading,initialWrong:readingWrong(f.initial,f.initialTrue),finalWrong:readingWrong(typed,this.reading),excess:this.excess,bubbleError:f.bubbleTaken,swirled:f.swirlSeconds>=1};
  this.runs.push(run);
  return `${run.kind==='rough'?'Rough':'Accurate'} titre recorded: ${fmt(run.titre)} cm3.`;
 }

 // ---- Results and calculation.
 get rough(){return this.runs.find(r=>r.kind==='rough')??null;}
 get accurate(){return this.runs.filter(r=>r.kind==='accurate');}
 get concordance():Concordance{return concordance(this.accurate.map(r=>r.titre));}
 get mean(){return this.concordance.mean;}
 submitCalc(step:CalcStep,value:number):{ok:boolean;message:string}{
  const mean=this.mean;if(mean===null)return {ok:false,message:'Two accurate titres must agree within 0.10 cm3 first.'};
  const want=calcFromTitre(mean),expected=want[step],entry=this.calc[step],index=calcSteps.indexOf(step);
  if(index>0&&!this.calc[calcSteps[index-1]].ok)return {ok:false,message:'Do the steps in order.'};
  entry.tries++;entry.value=value;
  if(closeTo(value,expected)){entry.ok=true;return {ok:true,message:step==='nBase'?'Right: titre in dm3 times 0.100.':step==='nAcid'?'Right: the reaction is 1:1, so moles of acid equal moles of base.':`Right: moles of acid divided by 0.0250 dm3. The unknown acid is ${fmt(value,4)} mol/dm3 by your results.`};}
  entry.ok=false;
  if(closeTo(value,expected*1000,.05))return {ok:false,message:'That is 1000 times too big. Convert cm3 to dm3 by dividing by 1000.'};
  if(closeTo(value,expected/1000,.05))return {ok:false,message:'That is 1000 times too small. Check the unit conversion.'};
  if(step==='conc'&&closeTo(value,expected*25/1000,.05))return {ok:false,message:'Divide by the volume of acid in dm3 (0.0250), not multiply.'};
  if(step==='nAcid'&&!closeTo(value,want.nBase,.01)&&closeTo(value,want.nBase*2,.01))return {ok:false,message:'The ratio is 1:1, so do not double it.'};
  return {ok:false,message:step==='nBase'?'Moles = concentration times volume in dm3. Use your mean titre.':step==='nAcid'?'NaOH + HCl gives NaCl + H2O: one mole of base per mole of acid.':'Concentration = moles divided by volume in dm3.'};
 }
 get calcDone(){return this.calc.conc.ok;}
 get found(){return this.calcDone?this.calc.conc.value:null;}
 get expectedCalc():CalcSteps|null{return this.mean===null?null:calcFromTitre(this.mean);}

 // ---- Questions, hints, steps.
 answerQuiz(id:string,right:boolean):number{
  const q=this.quiz[id]??={attempts:0,correct:false};
  if(q.correct)return 0;
  q.attempts++;q.correct=right;return right?quizPoints(q.attempts):0;
 }
 get quizScore(){return Object.values(this.quiz).reduce((s,q)=>s+(q.correct?quizPoints(q.attempts):0),0);}
 useHint(){this.hints++;}

 procedure():ProcedureStep[]{
  const f=this.flask,prepared=this.runs.length>0||(!!f&&!!f.indicator),titrated=this.runs.length>0;
  const done:Record<string,boolean>={rinse:this.rinsed,fill:this.filled,bubble:this.bubbleCleared,pipette:!!f||titrated,indicator:prepared,rough:!!this.rough,accurate:this.concordance.mean!==null,calculate:this.calcDone};
  const labels:[string,string][]=[['rinse','Rinse the burette with sodium hydroxide'],['fill','Fill the burette'],['bubble','Clear the air bubble from the tip'],['pipette','Pipette 25.0 cm3 of acid into a flask'],['indicator','Add the indicator'],['rough','Run a rough titration'],['accurate','Run accurate titrations until two agree within 0.10 cm3'],['calculate','Calculate the concentration']];
  const began=titrated||(!!f&&f.initial!==null);
  let current=false;
  return labels.map(([id,label])=>{
   if(done[id])return {id,label,state:'done' as const};
   if((id==='rinse'&&this.filled)||(id==='bubble'&&this.filled&&began))return {id,label,state:'skipped' as const};
   if(!current){current=true;return {id,label,state:'current' as const};}
   return {id,label,state:'todo' as const};
  });
 }

 report():Report{
  const issues:Issue[]=[],runs=this.runs;
  if(!this.rinsed)issues.push({id:'rinse',cost:8,affects:true,text:'You did not rinse the burette with sodium hydroxide. Water left in it thinned the titrant by about 2%, so each titre came out about 2% too large and the acid looked about 2% stronger than it is.'});
  const bubbleRun=runs.find(r=>r.bubbleError>0);
  if(bubbleRun)issues.push({id:'bubble',cost:6,affects:bubbleRun.kind==='accurate',text:`The air bubble was still in the tip, so your ${bubbleRun.kind} titre read ${fmt(bubbleRun.bubbleError,1)} cm3 too high. Run titrant through the tip before you start.`});
  if(runs.some(r=>r.indicator==='universal'))issues.push({id:'indicator',cost:4,affects:true,text:'Universal indicator changes colour gradually over the whole range, so the end point is vague to within several drops. Phenolphthalein or methyl orange change sharply.'});
  const over=runs.filter(r=>r.excess>.1);
  if(over.length)issues.push({id:'overshoot',cost:4,affects:over.some(r=>r.kind==='accurate'),text:`You overshot the end point by more than two drops in ${over.length===1?'run '+(runs.indexOf(over[0])+1):over.length+' runs'} (up to ${fmt(Math.max(...over.map(r=>r.excess)))} cm3). Slow to drop by drop near the colour change.`});
  const still=runs.filter(r=>!r.swirled);
  if(still.length)issues.push({id:'swirl',cost:4,affects:still.some(r=>r.kind==='accurate'),text:`You hardly swirled the flask in ${still.length===1?'run '+(runs.indexOf(still[0])+1):still.length+' runs'}. Unmixed base makes a local pink patch that hides how close you are.`});
  if(this.mean===null)issues.push({id:'concordance',cost:4,affects:true,text:'No two accurate titres agreed within 0.10 cm3, so there is no reliable mean.'});
  const wrongReadings=runs.reduce((s,r)=>s+(r.initialWrong?1:0)+(r.finalWrong?1:0),0);
  const technique=Math.max(0,TECHNIQUE_MAX-issues.reduce((s,i)=>s+i.cost,0)),readings=Math.max(0,READINGS_MAX-2*wrongReadings);
  const found=this.found,error=found===null?null:percentError(found,this.acid),accuracy=error===null?0:accuracyPoints(error);
  const quiz=Math.round(Math.min(1,this.quizScore/(QUESTION_COUNT*10))*QUIZ_MAX);
  const hints=this.hints*HINT_COST,total=Math.max(0,Math.min(100,technique+readings+accuracy+quiz-hints));
  return {issues,technique,readings,accuracy,quiz,hints,total,acid:this.acid,found,error,mean:this.mean,runs:[...runs],wrongReadings,elapsed:this.elapsed};
 }
}
