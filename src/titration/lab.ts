import {Bench,calcSteps,type CalcStep} from './bench';
import {BURETTE_MAX,flowRate,fmt,roundReading,type IndicatorId} from './model';
import {questions,type Question} from './content';
import {intro,said,steps,taskFor,type StepId,type Task} from './script';

/** Where the camera sits for a step: x, y and zoom, plus the half width in scene units the step needs in view. */
export interface Station {x:number;y:number;zoom:number;wide:number}
const BENCH:Station={x:0,y:2,zoom:.92,wide:4.9},TAP:Station={x:0,y:-.2,zoom:1.3,wide:4.9},FLASK:Station={x:0,y:.2,zoom:1.2,wide:4.9},NOTEBOOK:Station={x:2.6,y:1.6,zoom:.85,wide:7};
/** Rinse volume that counts as "a little", cm3; the fill zone on the burette scale, readings; the pour and drain speeds, cm3 per second. */
export const RINSE_VOLUME=3.5,FILL_FROM=0,FILL_TO=1,POUR_MAX=10,DRAIN_BOOST=3,EMPTY=BURETTE_MAX;
const OVERFLOW=-2.5,BURST_NEED=.5,SETTLE=1.2,CLOSED_FOR=.3,FULL_TIME=1.4;
const QUIZ_AFTER:Partial<Record<StepId,string>>={indicator:'q1',rough:'q2',accurate:'q3',calc:'q4'};
export interface QuizState {q:Question;wrong:number[];right:boolean;feedback:string}

/** The guided practical: which step and phase the student is in, and what each hands-on action does to the bench. Pure: time moves only when tick() is called. */
export class Lab {
 readonly bench:Bench;
 step=0;phase='wear';finished=false;
 /** Burette reading while the student fills it, before the bench holds titrant: 50 is empty, 0 is the zero mark, below zero is overfull. */
 level=EMPTY;
 lines:string[]=[];quiz:QuizState|null=null;entry=0;entryTries=0;rev=0;
 chosen:IndicatorId|null=null;drops=0;pipetteFill=0;
 done:('done'|'skipped')[]=[];
 quizResult:Record<string,'right'|'skipped'>={};
 /** Titrant that ran to the waste beaker, cm3, so the scene can draw the drops. */
 passed=0;
 private burst=0;private settled=0;private closedFor=0;private tapWasOpen=false;
 constructor(seed:number){this.bench=new Bench(seed);this.enter(0);}

 // ---- Where we are.
 get id():StepId{return steps[this.step].id;}
 get title(){return steps[this.step].title;}
 get task():Task{return taskFor(this.id,this.phase);}
 get line(){return this.lines[0]??'';}
 get more(){return this.lines.length>1;}
 /** Objects the student may touch right now; everything else is inert. */
 live():string[]{
  if(this.quiz||this.finished)return [];
  const p=this.phase;
  switch(this.id){
   case 'safety':return ['goggles'];
   case 'rinse':return p==='pour'?['bottle','funnel']:['tap'];
   case 'fill':return p==='pour'?['bottle','funnel']:['tap'];
   case 'bubble':return ['tap'];
   case 'pipette':return p==='draw'?['pipette','acid']:['pipette','flask'];
   case 'indicator':return ['dropper-phenolphthalein','dropper-methyl-orange','dropper-universal','flask'];
   case 'initial':return ['meniscus'];
   case 'rough':case 'accurate':return p==='run'?['tap','flask']:['meniscus'];
   default:return [];
  }
 }
 /** True when the stopcock does anything in this phase. */
 get tapAllowed(){
  const p=this.phase;
  return !this.quiz&&!this.finished&&(this.id==='rinse'&&p==='drain'||this.id==='fill'&&p==='drain'||this.id==='bubble'||(this.id==='rough'||this.id==='accurate')&&p==='run');
 }
 get station():Station{
  const id=this.id,phase=this.phase;
  if(this.finished||id==='calc')return NOTEBOOK;
  if(phase==='read'||phase==='final'||phase==='initial'){
   const y=this.bench.filled?this.bench.reading:0;
   return {x:0,y:5.9-4.4*Math.max(0,Math.min(50,y))/50-.1,zoom:3.4,wide:.8};
  }
  switch(id){
   case 'safety':case 'rinse':case 'fill':return phase==='drain'?TAP:BENCH;
   case 'bubble':case 'rough':case 'accurate':return TAP;
   default:return FLASK;
  }
 }
 /** The reading drawn in the 3D burette: the bench's own once filled, the student's pour before. */
 get reading(){return this.bench.filled?this.bench.reading:this.level;}
 get liquid(){return this.bench.filled||this.level<EMPTY-.01;}
 private bump(){this.rev++;}
 say(...lines:string[]){this.lines=lines;this.bump();}
 advanceLine(){if(this.lines.length>1){this.lines.shift();this.bump();return true;}return false;}

 // ---- Moving through the steps.
 private enter(i:number){
  this.step=i;this.burst=0;this.settled=0;this.closedFor=0;
  const id=steps[i].id;
  this.phase=({safety:'wear',rinse:'pour',fill:'pour',bubble:'burst',pipette:'draw',indicator:'choose',initial:'read',rough:'run',accurate:'initial',calc:'nBase'} as Record<StepId,string>)[id];
  if(id==='accurate')this.startRun();
  if(id==='initial'||id==='accurate')this.entry=this.guess();
  this.entryTries=0;this.drops=0;
  this.say(...intro[id]);
 }
 private guess(){return Math.round(this.bench.reading);}
 private complete(skipped=false){
  this.done[this.step]=skipped?'skipped':'done';
  const id=this.id,qid=QUIZ_AFTER[id],q=questions.find(x=>x.id===qid);
  if(q&&!this.quizResult[q.id]){this.quiz={q,wrong:[],right:false,feedback:''};this.say(q.text);return;}
  this.next();
 }
 private next(){
  if(this.step>=steps.length-1){this.finished=true;this.say('That is the whole practical. Open the Notebook for your report.');return;}
  this.enter(this.step+1);
 }

 // ---- Step 1: goggles.
 wear(){if(this.id!=='safety')return;this.bench.wearGoggles();this.complete();}

 // ---- Steps 2 and 3: the bottle over the funnel, then the tap.
 /** The bottle is over the funnel and tipped: rate is cm3 per second. Returns whether the bottle should go back to the shelf. */
 pour(rate:number,dt:number){
  if(this.id!=='rinse'&&this.id!=='fill'||this.phase!=='pour'||this.quiz)return false;
  this.level=Math.max(OVERFLOW,this.level-Math.min(POUR_MAX,rate)*dt);
  if(rate>.05)this.settled=0;
  if(this.id==='rinse'&&EMPTY-this.level>=RINSE_VOLUME){this.phase='drain';this.say(said.rinsed);return true;}
  this.bump();return false;
 }
 /** The bottle left the student's hand, so a fill is judged. */
 bottleDown(){if(this.id==='fill'&&this.phase==='pour')this.judgeFill();}
 private judgeFill(){
  const l=this.level;
  if(l>=FILL_FROM&&l<=FILL_TO){this.bench.fill(l);this.complete();return;}
  if(l<FILL_FROM){this.phase='drain';this.say(said.over);return;}
  if(l<EMPTY-.01)this.say(said.short);
 }
 /** One drop of drain from the keyboard. */
 drip(){
  if(!(this.phase==='drain'&&(this.id==='fill'||this.id==='rinse')))return;
  this.level=Math.min(EMPTY,this.level+.1);this.passed+=.1;this.tapWasOpen=true;this.closedFor=0;
  if(this.id==='rinse'&&this.level>=EMPTY){this.level=EMPTY;this.bench.rinse();this.complete();}
 }
 private drain(dt:number){
  const tap=this.bench.tap;if(!(tap>0))return;
  const v=flowRate(tap)*DRAIN_BOOST*dt;this.passed+=v;this.level=Math.min(EMPTY,this.level+v);
  if(this.id==='rinse'&&this.level>=EMPTY){this.level=EMPTY;this.bench.rinse();this.complete();}
 }

 // ---- Step 4: the burst.
 private burstStep(dt:number){
  if(this.id!=='bubble'||!this.bench.filled)return;
  if(this.bench.tap>.25){this.burst+=dt;this.passed+=flowRate(this.bench.tap)*dt;}
  if(this.burst>=BURST_NEED){this.bench.clearBubble();this.say(said.burst);this.complete();}
 }

 // ---- Step 5: the pipette.
 /** The pipette tip is in the acid: it fills to the line. */
 draw(dt:number){
  if(this.id!=='pipette'||this.quiz)return;
  if(this.pipetteFill<1){this.pipetteFill=Math.min(1,this.pipetteFill+dt/FULL_TIME);if(this.pipetteFill>=1){this.phase='deliver';this.bump();}}
 }
 /** Released over the flask. */
 deliver(){
  if(this.id!=='pipette')return false;
  if(this.pipetteFill<1){this.say(said.notFull);return false;}
  this.bench.pipette();this.pipetteFill=0;this.complete();return true;
 }

 // ---- Step 6: droppers.
 holding(id:string|null){
  if(this.id==='indicator'&&this.drops===0&&!this.quiz){const p=id?.startsWith('dropper')?'drop':'choose';if(p!==this.phase){this.phase=p;this.bump();}}
 }
 dropIndicator(id:IndicatorId){
  if(this.id!=='indicator'||this.quiz)return;
  if(!this.bench.flask)return;
  if(this.drops===0){this.chosen=id;this.bench.addIndicator(id);}
  this.drops++;
  if(this.drops>=2)this.complete();else this.say(said.dropped);
 }

 // ---- Steps 7 to 9: readings.
 get readingPhase(){return this.phase==='read'||this.phase==='final'||this.id==='accurate'&&this.phase==='initial';}
 setEntry(v:number){if(Number.isFinite(v)){this.entry=Math.max(0,Math.min(BURETTE_MAX,roundReading(v)));this.bump();}}
 nudge(d:number){this.setEntry(this.entry+d);}
 /** The student's reading is checked against the burette. A wrong one explains and lets them try again at once. */
 submitReading(typed=this.entry):boolean{
  if(!this.readingPhase)return false;
  const truth=this.bench.reading,v=roundReading(typed);
  if(Math.abs(v-truth)>.05+1e-9){
   this.bench.misreads++;this.entryTries++;
   this.say(this.entryTries>=3?said.exact(fmt(roundReading(truth))):v>truth?said.high:said.low);return false;
  }
  this.entryTries=0;
  if(this.phase==='read'||this.phase==='initial'){
   this.ensureFlask();this.bench.recordInitial(v);
   if(this.id==='initial'){this.complete();return true;}
   this.phase='run';this.say(...this.runHint());return true;
  }
  this.bench.recordFinal(v);
  if(this.id==='rough')this.complete();else this.afterAccurate();
  return true;
 }
 private runHint(){
  const rough=this.bench.rough;
  if(this.id==='rough')return ['Turn the tap, swirl, and stop at the first colour that stays.'];
  return [rough?`Your rough titre was ${fmt(rough.titre)}. Go fast to about ${fmt(Math.max(0,rough.titre-2),1)} cm3 on the dial, then drop by drop.`:'Go fast, then drop by drop near the colour change.'];
 }
 /** The end point is reached: the tap shuts and the student reads the burette. */
 endPoint(){
  if(this.phase!=='run'||!(this.id==='rough'||this.id==='accurate'))return;
  const f=this.bench.flask;
  if(!f||this.bench.reading<=(f.initial??0)+.04){this.say('Nothing has run in yet. Turn the tap first.');return;}
  this.bench.setTap(0);this.phase='final';this.entry=this.guess();this.entryTries=0;
  this.say('Tap shut. Read the bottom of the curve.');
 }
 private afterAccurate(){
  const con=this.bench.concordance;
  if(con.mean!==null){this.complete();return;}
  const t=this.bench.accurate.map(r=>fmt(r.titre));
  this.startRun();this.entry=this.guess();this.phase='initial';
  this.say(t.length>1?`Titres ${t.join(', ')} are not within 0.10 cm3 yet. A fresh flask is ready.`:`Titre ${t[0]}. One more run, and the two should agree within 0.10 cm3.`);
 }
 /** A fresh flask with the same indicator, topping up the burette first when it is low. */
 private startRun(){
  const b=this.bench;
  if(b.reading>20&&b.filled)b.fill(.3+((b.runs.length*.17)%.6));
  b.pipette();b.addIndicator(this.chosen??'phenolphthalein');
  this.phase='initial';
 }
 private ensureFlask(){
  const b=this.bench,f=b.flask;
  if(!f||f.done){b.pipette();}
  if(!b.flask!.indicator)b.addIndicator(this.chosen??'phenolphthalein');
 }

 // ---- Step 10: the sums.
 submitCalc(step:CalcStep,value:number){
  const res=this.bench.submitCalc(step,value);this.say(res.message);
  if(res.ok){const next=calcSteps[calcSteps.indexOf(step)+1];if(next)this.phase=next;else{this.phase='done';this.complete();}}
  this.bump();return res;
 }

 // ---- Questions.
 answer(option:number){
  const z=this.quiz;if(!z||z.right||z.wrong.includes(option))return null;
  const points=this.bench.answerQuiz(z.q.id,option===z.q.answer);
  if(option===z.q.answer){
   z.right=true;z.feedback=z.q.why;this.quizResult[z.q.id]='right';this.say(`Right. ${z.q.why}`);
  }else{z.wrong.push(option);z.feedback=`Not quite. ${z.q.why}`;this.say(z.feedback);}
  this.bump();return points;
 }
 /** Close a question once it is answered, or give it up. */
 closeQuiz(){
  const z=this.quiz;if(!z)return;
  if(!z.right)this.quizResult[z.q.id]='skipped';
  this.quiz=null;
  const note=z.q.id==='q1'&&this.chosen==='universal'?said.universalNote:'';
  this.next();if(note)this.lines.push(note);this.bump();
 }

 // ---- Time.
 /** Advance the bench and the step logic by dt seconds with the tap at its current opening. */
 tick(dt:number){
  const b=this.bench;
  if(!this.tapAllowed&&b.tap>0)b.setTap(0);
  if(this.tapAllowed){
   if(this.phase==='drain'&&this.id!=='bubble')this.drain(dt);
   this.burstStep(dt);
  }
  b.step(this.quiz||this.finished?0:dt);
  if(this.id==='fill'&&this.phase==='pour'&&this.level>=FILL_FROM&&this.level<=FILL_TO&&!this.quiz){this.settled+=dt;if(this.settled>=SETTLE)this.judgeFill();}
  else if(this.id==='fill'&&this.phase!=='pour')this.settled=0;
  // A closed tap after a drain says whether the level is right.
  const open=b.tap>.02;
  if(this.phase==='drain'&&(this.id==='fill'||this.id==='rinse')){
   if(open)this.tapWasOpen=true,this.closedFor=0;
   else if(this.tapWasOpen){
    this.closedFor+=dt;
    if(this.closedFor>=CLOSED_FOR)this.afterDrain();
   }
  }else{this.tapWasOpen=false;this.closedFor=0;}
  if((this.id==='rough'||this.id==='accurate')&&this.phase==='run'&&b.reading>=BURETTE_MAX-.5)this.endPoint();
 }
 private afterDrain(){
  this.tapWasOpen=false;this.closedFor=0;
  if(this.id==='rinse'){this.say('Let the rest run out into the waste beaker.');return;}
  const l=this.level;
  if(l>=FILL_FROM&&l<=FILL_TO){this.bench.fill(l);this.complete();}
  else if(l<FILL_FROM)this.say(said.stillOver);
  else{this.phase='pour';this.say(said.tooFar);}
 }

 // ---- Skipping: the bench does the step for the student, and it costs a little.
 skip(){
  if(this.finished)return;
  if(this.quiz){this.closeQuiz();return;}
  const b=this.bench,id=this.id;b.skip(id);
  switch(id){
   case 'safety':break;
   case 'rinse':this.level=EMPTY;break;
   case 'fill':b.fill();this.level=b.reading;break;
   case 'bubble':break;
   case 'pipette':b.pipette();break;
   case 'indicator':if(!b.flask)b.pipette();this.chosen??='phenolphthalein';b.addIndicator(this.chosen);break;
   case 'initial':this.ensureFlask();b.recordInitial(roundReading(b.reading));break;
   case 'rough':this.ensureFlask();if(b.flask!.initial===null)b.recordInitial(roundReading(b.reading));this.autoRun();b.recordFinal(roundReading(b.reading));break;
   case 'accurate':for(let i=0;i<6&&b.concordance.mean===null;i++){if(!b.flask||b.flask.done)this.startRun();if(b.flask!.initial===null)b.recordInitial(roundReading(b.reading));this.autoRun();b.recordFinal(roundReading(b.reading));}break;
   case 'calc':{const want=b.expectedCalc;if(want)for(const s of calcSteps)b.submitCalc(s,want[s]);break;}
  }
  this.complete(true);
 }
 /** A quick, accurate titration for a skipped run: fast, then drop by drop to the end point. */
 private autoRun(){
  const b=this.bench;b.setSwirl(1);b.setTap(1);
  for(let i=0;i<4000&&b.canFlow&&b.excess<-1.2;i++)b.step(.05);
  b.setTap(0);
  for(let i=0;i<400&&b.canFlow&&b.excess<-.02;i++){b.dropOne();for(let k=0;k<20;k++)b.step(.05);}
  b.setSwirl(0);
 }}
