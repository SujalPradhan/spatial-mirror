import test from 'node:test';
import assert from 'node:assert/strict';
import {Lab} from '../src/titration/lab';
import {steps} from '../src/titration/script';

const settle=(l:Lab,seconds:number,dt=.05)=>{for(let t=0;t<seconds;t+=dt)l.tick(dt);};
function drainFor(l:Lab,seconds:number){l.bench.setTap(1);settle(l,seconds);l.bench.setTap(0);settle(l,.5);}
function prepare(l:Lab){
 l.wear();
 l.pour(10,.4);drainFor(l,1.2);
 assert.equal(l.id,'fill');
 l.pour(10,4.95);assert.ok(l.level<1);l.bottleDown();
 assert.equal(l.id,'bubble');drainFor(l,.8);
 assert.equal(l.id,'pipette');
}
const answerAll=(l:Lab)=>{while(l.quiz){l.answer(l.quiz.q.answer);l.closeQuiz();}};

test('the practical has ten steps and a mouse-free path through them',()=>{
 assert.equal(steps.length,10);
 const l=new Lab(21);prepare(l);
 assert.ok(l.bench.goggles&&l.bench.rinsed&&l.bench.filled&&!l.bench.bubble);
 l.pipetteFill=1;assert.equal(l.deliver(),true);assert.equal(l.id,'indicator');
 l.dropIndicator('phenolphthalein');l.dropIndicator('phenolphthalein');
 assert.ok(l.quiz,'the first question comes right after the indicator');
 l.answer(l.quiz!.q.answer);l.closeQuiz();assert.equal(l.id,'initial');
 l.submitReading(Math.round(l.bench.reading*20)/20);assert.equal(l.id,'rough');
 const b=l.bench;b.setSwirl(1);b.setTap(1);while(b.excess<-1.2)b.step(.05);b.setTap(0);
 while(b.excess<-.02){b.dropOne();for(let k=0;k<20;k++)b.step(.05);}
 l.endPoint();assert.equal(l.phase,'final');
 l.submitReading(Math.round(b.reading*20)/20);assert.ok(l.quiz,'a question follows the rough run');answerAll(l);
 assert.equal(l.id,'accurate');
 for(let i=0;i<4&&l.id==='accurate';i++){
  l.submitReading(Math.round(b.reading*20)/20);b.setSwirl(1);b.setTap(1);
  while(b.excess<-1.2)b.step(.05);b.setTap(0);
  while(b.excess<-.02){b.dropOne();for(let k=0;k<20;k++)b.step(.05);}
  l.endPoint();l.submitReading(Math.round(b.reading*20)/20);
 }
 assert.ok(b.mean!==null&&l.quiz);answerAll(l);assert.equal(l.id,'calc');
 const want=b.expectedCalc!;
 assert.equal(l.submitCalc('nBase',want.nBase*1000).ok,false);
 assert.equal(l.submitCalc('nBase',want.nBase).ok,true);
 l.submitCalc('nAcid',want.nAcid);l.submitCalc('conc',want.conc);
 assert.ok(l.quiz);answerAll(l);assert.ok(l.finished);
 const r=b.report();assert.equal(r.issues.length,0,r.issues.map(i=>i.id).join());assert.equal(r.quiz,20);assert.ok(r.total>=95);
});

test('only the object needed now is live, and the tap works only when the step uses it',()=>{
 const l=new Lab(3);
 assert.deepEqual(l.live(),['goggles']);assert.equal(l.tapAllowed,false);
 l.wear();assert.deepEqual(l.live(),['bottle','funnel']);
 l.pour(10,.4);assert.deepEqual(l.live(),['tap']);assert.equal(l.tapAllowed,true);
 l.bench.setTap(1);l.tick(.05);assert.ok(l.bench.tap>0);
 l.drip();
});

test('mistakes explain why and let the student retry at once',()=>{
 const l=new Lab(4);l.wear();l.pour(10,.4);drainFor(l,1.2);
 l.pour(10,5.5);assert.ok(l.level<0,'overfilled');l.bottleDown();
 assert.equal(l.phase,'drain');assert.match(l.line,/zero mark/);
 l.bench.setTap(.3);settle(l,2.5);l.bench.setTap(0);settle(l,.6);
 assert.equal(l.id,'bubble','draining to the line carries on');
 assert.ok(l.bench.reading>=0&&l.bench.reading<=1);
 const l2=new Lab(5);l2.wear();l2.pour(10,.4);drainFor(l2,1.2);l2.pour(10,2);l2.bottleDown();
 assert.equal(l2.id,'fill');assert.match(l2.line,/little more/);
 l.pipetteFill=0;assert.equal(l.deliver(),false);
});

test('readings: a wrong one is explained, counted and can be retried; skipping costs a little',()=>{
 const l=new Lab(6);l.skip();l.skip();l.skip();l.skip();l.skip();l.skip();
 assert.ok(l.quiz,'skipping the indicator still raises the question');l.skip();
 assert.equal(l.id,'initial');
 const truth=Math.round(l.bench.reading*20)/20;
 assert.equal(l.submitReading(truth+.3),false);assert.match(l.line,/high/);
 assert.equal(l.bench.misreads,1);
 assert.equal(l.submitReading(truth),true);
 const r=l.bench.report();assert.equal(r.readings,8);
 assert.ok(r.issues.some(i=>i.id==='goggles')&&r.issues.some(i=>i.id==='skipped'));
});

test('skipping every step still reaches a finished report',()=>{
 const l=new Lab(7);let guard=0;
 while(!l.finished&&guard++<60)l.skip();
 assert.ok(l.finished&&l.bench.calcDone);
 assert.ok(l.bench.report().total<100);
});
