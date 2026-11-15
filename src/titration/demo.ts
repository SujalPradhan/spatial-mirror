import {FILL_TO,type Lab} from './lab';
import {fmt,roundReading} from './model';
import {taskFor,type Task} from './script';

/** The demo bench uses this seed unless the page address names one, so the story always has a batch that can be judged. */
export const DEMO_SEED=6;
/** The label value, and how far a batch may be from it and still ship, as a fraction. */
export const LABEL=0.1,SPEC=0.05;
const TIMEOUT=45000;

export interface Verdict {ok:boolean;kind:'within'|'strong'|'weak';line:string}
/** Judges a measured concentration, mol/dm3, against the label. */
export function verdict(conc:number):Verdict{
 const c=fmt(conc,3),low=LABEL*(1-SPEC),high=LABEL*(1+SPEC);
 if(conc>high)return {ok:false,kind:'strong',line:`The batch is ${c} mol/dm3, which is too strong. Hold it back.`};
 if(conc<low)return {ok:false,kind:'weak',line:`The batch is ${c} mol/dm3, which is too weak. Hold it back.`};
 return {ok:true,kind:'within',line:`The batch is ${c} mol/dm3, which is within spec. It can ship.`};
}

const handName={pinch:'',open:'open hand, ',fist:'fist, ',thumbUp:'thumbs up, '} as Record<string,string>;
/** The gesture a person would use at this moment, as a short phrase for the chip. */
export function chipFor(task:Task,mode:'quiz'|'typing'|'task'='task'):string{
 if(mode==='quiz')return 'With the mouse: click an answer';
 if(mode==='typing'||!task.bar.length)return 'With the keyboard: type the number';
 const bits=task.bar.map(g=>{const label=(g.label??g.id).toLowerCase(),lead=handName[g.id]??'';return lead&&label.startsWith(lead.split(' ')[0])?label:`${lead}${label}`;});
 return `With your hand: ${bits.join(' · ')}`;
}

export interface Beat {
 /** One sentence for the guide bubble. */
 line:string;
 /** A short line for the task card about what is being done and why. */
 doing:string;
 /** Show the gesture chip for the lab's current moment. */
 gesture?:boolean;
 /** Runs when the beat starts, and again every `retry` ms until `done` is true. */
 act?:()=>void;done?:()=>boolean;retry?:number;
 /** Runs once, the moment `done` turns true, even if the beat must stay up longer to be read. */
 settle?:()=>void;
 /** Shortest time on screen, ms, so every line can be read. */
 min:number;
 /** How many times faster the bench runs during the beat. */
 speed?:number;
}

/** Everything the demo does to the lab goes through these, the same keys and buttons a person uses. */
export interface DemoHost {
 lab():Lab;
 /** Runs a keyed action by id, as the key would. */
 act(id:string):boolean;
 speed(n:number):void;
 freeze(on:boolean):void;
 /** Rings the answer to a question, then clicks it. */
 mark(option:number):void;pick(option:number):void;
 /** Types a burette reading or a sum into the card and presses its button. */
 read(value:number):void;calc(text:string):void;
}

const FAST=-.8;
/** The story, one beat at a time. Each beat reads the live lab, so it adapts to whatever the bench is doing. */
export function* plan(h:DemoHost):Generator<Beat,void,void>{
 const L=()=>h.lab(),B=()=>L().bench;
 const at=(id:string)=>L().id===id&&!L().quiz;
 const gone=(id:string)=>()=>L().id!==id||L().finished;
 const pink=()=>B().tint.alpha>.12;
 const tapFull=()=>{for(let i=0;i<20;i++)h.act('tap-up');};
 const quiz=function*():Generator<Beat>{
  const q=L().quiz;if(!q)return;
  const right=q.q.answer;
  yield {line:'A quick check, and the demo picks the answer.',doing:'A checkpoint question. The chosen answer is ringed first.',gesture:true,act:()=>h.mark(right),min:1000};
  yield {line:'That is the one, and the card says why.',doing:'The card explains the answer.',gesture:true,act:()=>h.pick(right),done:()=>!!L().quiz?.right,retry:500,min:1800};
  yield {line:'On to the next step.',doing:'Continue.',act:()=>{h.act('run');},done:()=>!L().quiz,retry:400,min:200};
 };
 const read=function*(line:string,done:()=>boolean,min=1500):Generator<Beat>{
  yield {line,doing:`Reading ${fmt(roundReading(B().reading))} cm3 at the bottom of the curve.`,gesture:true,act:()=>h.read(roundReading(B().reading)),done:()=>!!L().quiz||done(),retry:500,min};
 };
 const shut=()=>{h.act('tap-close');};
 const dropAct=()=>{h.act('tap-close');const f=B().flask;if(!f||f.local<.06)h.act('drop');h.act('swirl');};
 const drops=(line:string,doing:string):Beat=>({line,doing,gesture:true,speed:2,act:dropAct,done:pink,settle:shut,retry:160,min:1600});

 // The story.
 yield {line:'A small factory makes a descaler, a cleaning acid.',doing:'A quality technician checks one batch before it ships.',min:2200};
 yield {line:'The label says about 0.1 mol/dm3.',doing:'That is the strength the batch should have.',min:2000};
 yield {line:'Too strong is unsafe and too weak will not work.',doing:'So the batch must be close to the label.',min:2400};
 yield {line:'So a sample goes on the bench before the batch ships.',doing:'Ten steps, about a minute.',min:1800};

 yield {line:'Goggles on first, because this is acid.',doing:'The technician puts on goggles.',gesture:true,act:()=>h.act('wear'),done:()=>L().step>0,retry:800,min:2200};

 yield {line:'Rinse the burette with a little sodium hydroxide.',doing:'The rinse stops stray water from thinning it.',gesture:true,act:()=>{h.act('rinse');},done:()=>L().id!=='rinse'||L().phase==='drain',retry:700,min:2200};
 yield {line:'Let the rinse run out into the waste beaker.',doing:'The rinse goes to waste.',gesture:true,act:()=>{h.act('rinse');},done:gone('rinse'),retry:1100,min:2000};

 yield {line:'Fill it to just below zero.',doing:'The sodium hydroxide is a known 0.100 mol/dm3.',gesture:true,speed:3,act:()=>{if(L().level>FILL_TO)h.act('pour');},done:gone('fill'),retry:60,min:2800};

 yield {line:'Push the air out of the tip.',doing:'Trapped air would count as liquid.',gesture:true,act:()=>{h.act('burst');},done:gone('bubble'),retry:900,min:2400};

 yield {line:'Measure exactly 25.0 cm3 of the batch into the flask.',doing:'A pipette takes a fixed volume of the descaler.',gesture:true,act:()=>{h.act('pipette');},done:gone('pipette'),retry:900,min:2800};

 yield {line:'An indicator will show when the acid is used up.',doing:'The phenolphthalein dropper is chosen.',gesture:true,act:()=>{h.act('choose-1');},min:2200};
 yield {line:'Two drops go in, and pink will mean the acid is used up.',doing:'One drop for each release over the flask.',gesture:true,act:()=>{h.act('add-drop');},done:()=>!!L().quiz||L().id!=='indicator',retry:900,min:2200};
 yield* quiz();

 yield {line:'Read the burette at the bottom of the curve.',doing:'The scale is magnified so it can be read.',gesture:true,min:2200};
 yield* read('That is the start reading.',gone('initial'),1500);

 yield {line:'A rough run first, to find about where it turns pink.',doing:'The tap is opened and the flask swirled.',gesture:true,speed:6,act:()=>{tapFull();h.act('swirl');},done:()=>B().excess>FAST||L().phase!=='run',settle:shut,retry:300,min:2400};
 yield drops('Now single drops, swirling after each.','Drop by drop to the first pink that stays.');
 yield {line:'The first pink that stays is the end point.',doing:'The tap is shut. The end point is reached.',gesture:true,act:()=>{h.act('tap-close');h.act('run');},done:()=>L().phase==='final'||L().id!=='rough',retry:500,min:2200};
 yield* read('The difference between the readings is the titre.',()=>!!L().quiz||L().id!=='rough',1500);
 yield* quiz();

 while(at('accurate')){
  const l=L(),second=B().accurate.length>0;
  if(l.phase==='initial'){
   yield* read(second?'A second run must agree within 0.10 cm3.':'Now careful runs, each with a fresh flask.',()=>L().phase!=='initial'||L().id!=='accurate',2200);
  }else if(l.phase==='run'){
   yield {line:second?'Fast to just short, then single drops again.':'Fast to just short of the end point.',doing:'The titre should be close to the rough one.',gesture:true,speed:6,act:()=>{tapFull();h.act('swirl');},done:()=>B().excess>FAST||L().phase!=='run',settle:shut,retry:300,min:2200};
   yield drops('Single drops now, swirling after each.','Stopping at the first pink that stays.');
   yield {line:'Pink that stays means stop.',doing:'The tap is shut. The end point is reached.',gesture:true,act:()=>{h.act('tap-close');h.act('run');},done:()=>L().phase==='final'||L().id!=='accurate',retry:500,min:1800};
  }else if(l.phase==='final'){
   yield* read('Note the reading again.',()=>L().phase!=='final'||L().id!=='accurate',1600);
  }else yield {line:'Next flask.',doing:'A fresh flask is ready.',min:300};
 }
 yield* quiz();

 const want=B().expectedCalc;
 const sum=function*(phase:string,line:string,doing:string,value:()=>string):Generator<Beat>{
  yield {line,doing,gesture:true,act:()=>{if(L().phase===phase)h.calc(value());},done:()=>L().phase!==phase||L().finished,retry:700,min:2500};
 };
 yield* sum('nBase','Now the sums, starting with the moles of base.','Mean titre in dm3, times 0.100.',()=>String(want!.nBase.toPrecision(3)));
 yield* sum('nAcid','One to one, so the acid has the same moles.','Moles of acid equal moles of base.',()=>String(want!.nAcid.toPrecision(3)));
 yield* sum('conc','Divide by 0.0250 dm3 for the concentration.','Moles divided by the flask volume.',()=>fmt(want!.conc,4));
 yield* quiz();

 // Wait for the report to open, then give the verdict.
 yield {line:'The report is ready.',doing:'The Notebook holds the readings and the report.',min:1200,done:()=>L().finished};
 const found=B().found??want?.conc??0,v=verdict(found);
 yield {line:v.line,doing:`${v.ok?'Within spec':v.kind==='strong'?'Too strong':'Too weak'}: ${fmt(found,4)} mol/dm3 against a label of about ${LABEL}.`,min:0};
}

export interface Narration {line:string;doing:string;chip:string}
export type DemoState='idle'|'running'|'paused'|'done';

/** Plays the plan against the host, one beat at a time. Time moves only while running. */
export class DemoRunner {
 state:DemoState='idle';
 /** Bumped whenever what the card should show changes. */
 rev=0;
 private gen:Generator<Beat,void,void>|null=null;
 private beat:Beat|null=null;
 private elapsed=0;private since=0;private settled=false;private chip='';
 constructor(private readonly host:DemoHost){}
 get active(){return this.state!=='idle';}
 get paused(){return this.state==='paused';}
 get finished(){return this.state==='done';}
 get narration():Narration{
  const b=this.beat;
  return b?{line:b.line,doing:b.doing,chip:this.chip}:{line:'',doing:'',chip:''};
 }
 start(){
  this.gen=plan(this.host);this.state='running';this.beat=null;this.next();
 }
 stop(){
  this.state='idle';this.gen=null;this.beat=null;this.host.speed(1);this.host.freeze(false);this.rev++;
 }
 pause(){if(this.state!=='running')return;this.state='paused';this.host.freeze(true);this.rev++;}
 resume(){if(this.state!=='paused')return;this.state='running';this.host.freeze(false);this.rev++;}
 /** Moves the demo on by dt milliseconds. */
 tick(dt:number){
  if(this.state!=='running'||!this.beat)return;
  const b=this.beat;this.elapsed+=dt;this.since+=dt;
  const ok=!b.done||b.done();
  if(ok&&!this.settled){this.settled=true;b.settle?.();}
  if(ok&&this.elapsed>=b.min){this.next();return;}
  if(!ok&&b.act&&b.retry&&this.since>=b.retry){this.since=0;b.act();}
  if(!ok&&this.elapsed>TIMEOUT){this.host.lab().skip();this.elapsed=0;}
 }

 /** The gesture for the moment a beat starts, read before its action moves the lab on. */
 private chipNow(b:Beat){
  const l=this.host.lab();
  if(!b.gesture||l.finished)return '';
  const mode=l.quiz?'quiz':l.phase==='nBase'||l.phase==='nAcid'||l.phase==='conc'?'typing':'task';
  return chipFor(taskFor(l.id,l.phase),mode);
 }
 private next(){
  const r=this.gen!.next();
  if(r.done){this.state='done';this.host.speed(1);this.rev++;return;}
  this.beat=r.value;this.elapsed=0;this.since=0;this.settled=false;this.chip=this.chipNow(r.value);
  this.host.speed(r.value.speed??1);r.value.act?.();this.rev++;
 }
}
