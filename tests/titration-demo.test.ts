import test from 'node:test';
import assert from 'node:assert/strict';
import {Lab} from '../src/titration/lab';
import {DemoRunner,chipFor,verdict,type DemoHost} from '../src/titration/demo';
import {steps,taskFor,type StepId} from '../src/titration/script';
import {fmt} from '../src/titration/model';

test('the verdict judges a concentration against the label within five percent',()=>{
 assert.equal(verdict(.1).kind,'within');
 assert.equal(verdict(.0951).kind,'within');
 assert.equal(verdict(.1049).kind,'within');
 assert.equal(verdict(.0949).kind,'weak');
 assert.equal(verdict(.1051).kind,'strong');
 assert.match(verdict(.1013).line,/0\.101 mol\/dm3.*within spec/);
 assert.match(verdict(.112).line,/0\.112 mol\/dm3.*too strong/);
 assert.match(verdict(.083).line,/0\.083 mol\/dm3.*too weak/);
 assert.equal(verdict(.112).ok,false);
});

test('the gesture chip names the hand movement for the current moment',()=>{
 assert.equal(chipFor(taskFor('safety','wear')),'With your hand: pinch and lift');
 assert.equal(chipFor(taskFor('rinse','drain')),'With your hand: open hand, turn the tap');
 assert.match(chipFor(taskFor('rough','run')),/open hand, turn the tap · fist, swirl · thumbs up, end point/);
 assert.equal(chipFor(taskFor('initial','read')),'With your hand: thumbs up, confirm');
 assert.equal(chipFor(taskFor('calc','nBase')),'With the keyboard: type the number');
 assert.equal(chipFor(taskFor('safety','wear'),'quiz'),'With the mouse: click an answer');
});

/** The same moves a key press makes, applied straight to the lab so the plan can run with no browser. */
function headless(l:()=>Lab,lines:string[]){
 let choice='phenolphthalein' as const;
 const host:DemoHost={
  lab:l,speed:()=>{},freeze:()=>{},mark:()=>{},
  act(id){
   const lab=l(),b=lab.bench;
   switch(id){
    case 'wear':lab.wear();break;
    case 'rinse':if(lab.id==='rinse'){if(lab.phase==='pour')lab.pour(6,.5);else b.setTap(1);}break;
    case 'pour':if(lab.phase==='pour')lab.pour(6,.15);break;
    case 'tap-up':if(lab.tapAllowed)b.setTap(b.tap+.05);break;
    case 'tap-close':b.setTap(0);break;
    case 'drop':if(lab.phase==='drain')lab.drip();else if(lab.phase==='run')b.dropOne();break;
    case 'swirl':b.swirlPulse();break;
    case 'burst':if(lab.id==='bubble')b.setTap(1);break;
    case 'pipette':if(lab.id==='pipette'){lab.pipetteFill=1;lab.deliver();}break;
    case 'choose-1':break;
    case 'add-drop':if(lab.id==='indicator')lab.dropIndicator(choice);break;
    case 'run':if(lab.quiz){if(lab.quiz.right)lab.closeQuiz();}else if(lab.phase==='run')lab.endPoint();break;
   }
   return true;
  },
  pick:i=>{l().answer(i);},
  read:v=>{l().setEntry(v);l().submitReading();},
  calc:text=>{const lab=l();lab.submitCalc(lab.phase as 'nBase',Number(text));},
 };
 void lines;
 return host;
}

function play(seed:number){
 let lab=new Lab(seed);
 const lines:string[]=[],doings:string[]=[],chips:string[]=[],stepsSeen=new Set<StepId>();
 const host=headless(()=>lab,lines);
 let speed=1;host.speed=n=>{speed=n;};
 const runner=new DemoRunner(host);
 runner.start();
 let ms=0;
 for(let i=0;i<40000&&!runner.finished;i++){
  runner.tick(50);ms+=50;
  const n=runner.narration;
  if(n.line&&lines.at(-1)!==n.line)lines.push(n.line);
  if(n.doing&&doings.at(-1)!==n.doing)doings.push(n.doing);
  if(n.chip&&!chips.includes(n.chip))chips.push(n.chip);
  stepsSeen.add(lab.id);
  for(let k=0;k<speed;k++)lab.tick(.05);
 }
 return {lab,lines,doings,chips,ms,stepsSeen,runner};
}

test('the demo plan runs all ten steps to the report with no browser',()=>{
 for(const seed of [6,10,21,33]){
  const {lab,lines,chips,stepsSeen,runner}=play(seed);
  assert.equal(runner.finished,true,`seed ${seed} finishes`);
  assert.equal(lab.finished,true);
  assert.equal(lab.bench.calcDone,true);
  for(const s of steps)assert.ok(stepsSeen.has(s.id),`${s.id} was visited`);
  assert.equal(Object.keys(lab.quizResult).length,4,'four questions answered');
  assert.ok(Object.values(lab.quizResult).every(r=>r==='right'));
  const found=lab.bench.found!;
  assert.ok(Math.abs(found-lab.bench.acid)/lab.bench.acid<.03,`result ${found} is close to ${lab.bench.acid}`);
  assert.equal(lines.at(-1),verdict(found).line,'the story ends on the verdict');
  assert.ok(lines.at(-1)!.includes(fmt(found,3)));
  assert.ok(chips.length>=5,'the chip names gestures along the way');
 }
});

test('the demo runs 60 to 90 seconds of reading time',()=>{
 const {ms}=play(6);
 assert.ok(ms>=55000&&ms<=90000,`${ms} ms`);
});

test('every demo line is short plain English: one sentence, no dashes',()=>{
 const {lines,doings}=play(6);
 const banned=/[—–]/;
 const verdictLines=['within spec','too strong','too weak'];
 for(const t of [...lines,...doings]){
  assert.doesNotMatch(t,banned,t);
  assert.ok(t.length<=95,`short: ${t}`);
  const sentences=t.split(/[.!?]\s+/).filter(Boolean);
  assert.ok(sentences.length<=(verdictLines.some(v=>t.includes(v))?2:1)||t.length<=60,`one sentence: ${t}`);
 }
 const text=lines.join(' ');
 assert.match(text,/descaler/);assert.match(text,/0\.1 mol\/dm3/);assert.match(text,/unsafe/);
});

test('pause stops the demo clock and resume carries on',()=>{
 let lab=new Lab(6);
 const host=headless(()=>lab,[]);
 let frozen=false;host.freeze=on=>{frozen=on;};
 const r=new DemoRunner(host);r.start();
 for(let i=0;i<100;i++)r.tick(50);
 const before=r.narration.line;
 r.pause();assert.equal(r.paused,true);assert.equal(frozen,true);
 for(let i=0;i<2000;i++)r.tick(50);
 assert.equal(r.narration.line,before,'no progress while paused');
 r.resume();assert.equal(frozen,false);
 for(let i=0;i<200;i++){r.tick(50);lab.tick(.05);}
 assert.notEqual(r.narration.line,before);
 r.stop();assert.equal(r.active,false);
});
