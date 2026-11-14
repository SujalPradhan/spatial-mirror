import test from 'node:test';
import assert from 'node:assert/strict';
import {ACID_MAX,ACID_MIN,DROP,SwirlDetector,calcFromTitre,closeTo,concordance,dripRate,equivalenceVolume,flowRate,indicatorTint,pHAt,quizPoints,randomAcidConc,readingWrong,tapFromTurn} from '../src/titration/model';
import {Bench,accuracyPoints} from '../src/titration/bench';

type PH=(cAcid:number,vAcid:number,cBase:number,vBase:number)=>number;
/** Every property a strong acid and strong base titration must show; run against the real model and a wrong one. */
function titrationCurveHolds(pH:PH){
 const ca=.1,veq=equivalenceVolume(ca);
 assert.ok(Math.abs(pH(ca,25,.1,0)-1)<1e-9,'start is pH 1');
 assert.ok(Math.abs(pH(ca,25,.1,veq/2)-(-Math.log10(.1*12.5/37.5)))<1e-6,'half way from the excess acid');
 assert.ok(Math.abs(pH(ca,25,.1,veq)-7)<.01,'equivalence is neutral');
 assert.ok(pH(ca,25,.1,veq+DROP)>9.5&&pH(ca,25,.1,veq+DROP)<10.5,'one drop past is about pH 10');
 assert.ok(pH(ca,25,.1,veq+10)>12.1,'excess base is strongly alkaline');
 assert.ok(pH(ca,25,.1,veq-DROP)<4.5&&pH(ca,25,.1,veq-DROP)>3.5,'one drop short is about pH 4');
}
test('pH follows the strong acid, strong base curve through equivalence',()=>{titrationCurveHolds(pHAt);});
test('a model that ignores water fails the same checks',()=>{
 const naive:PH=(ca,va,cb,vb)=>{const net=(ca*va-cb*vb)/(va+vb);return net>0?-Math.log10(net):14+Math.log10(-net);};
 assert.throws(()=>titrationCurveHolds(naive),'the naive model has no value at equivalence');
 const flipped:PH=(ca,va,cb,vb)=>pHAt(ca,va,cb,vb)>7?14-pHAt(ca,va,cb,vb):pHAt(ca,va,cb,vb);
 assert.throws(()=>titrationCurveHolds(flipped),'a curve that never goes alkaline is caught');
});
test('the end point volume is 25 times the acid concentration over 0.100 within one drop, across the whole range',()=>{
 for(let seed=1;seed<=200;seed++){
  const c=randomAcidConc(seed);assert.ok(c>=ACID_MIN&&c<=ACID_MAX,`${c} in range`);
  const veq=equivalenceVolume(c);assert.ok(Math.abs(veq-25*c/.1)<1e-9);
  let v=0;while(pHAt(c,25,.1,v)<7)v+=.001;
  assert.ok(Math.abs(v-veq)<DROP,`seed ${seed}: pH 7 at ${v.toFixed(3)} against ${veq.toFixed(3)}`);
 }
 assert.notEqual(randomAcidConc(1),randomAcidConc(2));assert.equal(randomAcidConc(7),randomAcidConc(7));
});
test('indicator colours change in their own ranges only',()=>{
 assert.equal(indicatorTint('phenolphthalein',2).alpha,0);assert.equal(indicatorTint('phenolphthalein',8).alpha,0);
 const faint=indicatorTint('phenolphthalein',9.3),deep=indicatorTint('phenolphthalein',12);
 assert.equal(faint.name,'faint pink');assert.ok(faint.alpha>.15&&faint.alpha<.6);assert.equal(indicatorTint('phenolphthalein',10).name,'faint pink','one drop past the end point is still faint');assert.equal(indicatorTint('phenolphthalein',10.5).name,'pink');assert.ok(deep.alpha>faint.alpha);
 assert.equal(indicatorTint('methyl-orange',2).name,'red');assert.equal(indicatorTint('methyl-orange',3.7).name,'orange');assert.equal(indicatorTint('methyl-orange',7).name,'yellow');
 assert.ok(indicatorTint('methyl-orange',2).rgb[0]>indicatorTint('methyl-orange',7).rgb[0]-30&&indicatorTint('methyl-orange',2).rgb[1]<indicatorTint('methyl-orange',7).rgb[1]);
 const steps=[1,3,5,7,9,11].map(p=>indicatorTint('universal',p).rgb.join());assert.equal(new Set(steps).size,6,'universal differs at every two pH units');
 assert.equal(indicatorTint('universal',7).name,'green');
 const near=indicatorTint('universal',6.5).rgb,far=indicatorTint('universal',7.5).rgb;
 assert.ok(Math.hypot(near[0]-far[0],near[1]-far[1],near[2]-far[2])<110,'neighbouring pH look alike: gradual');
});
test('the stopcock: a level wrist is shut, small turns drip, big turns stream',()=>{
 assert.equal(tapFromTurn(0),0);assert.equal(tapFromTurn(.1),0);assert.equal(tapFromTurn(-.1),0);
 assert.ok(tapFromTurn(.4)>0&&tapFromTurn(.4)<.2,'a small turn drips');assert.ok(dripRate(tapFromTurn(.4))>0);
 assert.ok(tapFromTurn(1.2)>.95&&dripRate(tapFromTurn(1.2))===0);assert.equal(tapFromTurn(.9),tapFromTurn(-.9));
 assert.equal(tapFromTurn(NaN),0);
 let last=0;for(let t=0;t<=1;t+=.01){const f=flowRate(t);assert.ok(f>=last-1e-12,'flow never falls as the tap opens');last=f;}
 assert.ok(Math.abs(flowRate(.2-1e-9)-flowRate(.2))<1e-3,'continuous at the drip limit');
});
test('swirling is read from circles, not from straight or still hands',()=>{
 const circle=new SwirlDetector(),line=new SwirlDetector(),still=new SwirlDetector();
 for(let i=0;i<30;i++){const t=i*33;circle.push(.5+.08*Math.cos(t/1000*2*Math.PI*2),.5+.08*Math.sin(t/1000*2*Math.PI*2),t);line.push(.3+i*.01,.5,t);still.push(.5,.5,t);}
 assert.ok(circle.rate()>1.5&&circle.rate()<2.5,`about two turns a second, got ${circle.rate()}`);
 assert.equal(still.rate(),0);assert.ok(line.rate()<.3,'a straight sweep is not a swirl');
});
test('concordance: two within 0.10, rough excluded, mean of the agreeing set',()=>{
 assert.deepEqual(concordance([]),{indices:[],mean:null,spread:null});assert.equal(concordance([24.5]).mean,null);
 assert.equal(concordance([24.5,24.7]).mean,null,'0.20 apart does not agree');
 const ok=concordance([24.50,24.40]);assert.deepEqual(ok.indices,[0,1]);assert.ok(Math.abs(ok.mean!-24.45)<1e-9);
 assert.ok(concordance([24.5,24.6]).mean!==null,'exactly 0.10 apart agrees');assert.equal(concordance([24.5,24.65]).mean,null);
 const three=concordance([24.9,24.45,24.5,24.55]);assert.deepEqual(three.indices,[1,2,3]);assert.ok(Math.abs(three.mean!-24.5)<1e-9);
 const tie=concordance([24.0,24.1,25.0,25.05]);assert.deepEqual(tie.indices,[2,3],'the tighter pair wins');
});
test('closeTo, readings, quiz points and the worked calculation',()=>{
 assert.ok(closeTo(.002445,.00245)&&!closeTo(.0026,.00245));
 assert.ok(!readingWrong(23.45,23.47)&&!readingWrong(23.5,23.47)&&readingWrong(23.6,23.47)&&readingWrong(23.3,23.47));
 assert.deepEqual([1,2,3,4,5,6].map(quizPoints),[10,8,6,4,2,2]);
 const w=calcFromTitre(24.5);assert.ok(Math.abs(w.nBase-.00245)<1e-12&&w.nAcid===w.nBase&&Math.abs(w.conc-.098)<1e-9);
 assert.deepEqual([.5,1.5,2.5,4,8,20].map(accuracyPoints),[40,32,24,16,8,0]);
});

// ---- The bench: a scripted student.
/** Runs a flask, swirling, to within a drop or two of the end point, then drips to the colour change. Returns when faint pink shows. */
function titrate(b:Bench,{swirl=true}={}){
 const shortOfEnd=()=>b.excess<-1.2;
 while(shortOfEnd()&&b.canFlow){b.setTap(1);b.setSwirl(swirl?1:0);b.step(.05);}
 b.setTap(0);
 let guard=0;while(b.tint.alpha<.15&&b.canFlow&&guard++<400){b.dropOne();for(let k=0;k<60;k++){b.setSwirl(swirl?1:0);b.step(.05);}}
}
function flask(b:Bench,id:'phenolphthalein'|'methyl-orange'|'universal'='phenolphthalein'){
 b.pipette();b.addIndicator(id);b.recordInitial(Math.round(b.reading*20)/20);
}
function wellRun(seed:number,opts:{rinse?:boolean;bubble?:boolean;indicator?:'phenolphthalein'|'methyl-orange'|'universal'}={}){
 const b=new Bench(seed);if(opts.rinse!==false)b.rinse();b.fill();if(opts.bubble!==false)b.clearBubble();
 for(let i=0;i<3;i++){
  if(b.reading>20)b.fill();
  flask(b,opts.indicator);titrate(b);
  b.recordFinal(Math.round(b.reading*20)/20);
 }
 return b;
}
test('a careful student: faint pink at the end point, titres agree, concentration near the truth',()=>{
 for(const seed of [3,11,42,77]){
  const b=wellRun(seed);
  assert.equal(b.runs.length,3);const [rough,...acc]=b.runs;assert.equal(rough.kind,'rough');
  for(const r of b.runs){assert.ok(r.excess>=0&&r.excess<=.12,`seed ${seed}: overshoot ${r.excess}`);assert.ok(r.titre>20&&r.titre<31);}
  assert.ok(b.mean!==null,`seed ${seed}: two accurate titres agree`);
  const calc=b.expectedCalc!;assert.ok(Math.abs(calc.conc-b.acid)/b.acid<.01,`seed ${seed}: ${calc.conc} against ${b.acid}`);
  const rep=b.report();assert.equal(rep.issues.length,0,rep.issues.map(i=>i.id).join());
 }
});
test('skipping the rinse shifts every titre about 2% high and the answer with it',()=>{
 const good=wellRun(5),bad=wellRun(5,{rinse:false});
 const ratio=bad.runs[1].titre/good.runs[1].titre;assert.ok(ratio>1.01&&ratio<1.03,`titre ratio ${ratio}`);
 assert.ok(bad.titrantConc<good.titrantConc);
 const high=bad.expectedCalc!.conc/bad.acid;assert.ok(high>1.005&&high<1.035,`concentration ${high} times the truth`);
 assert.ok(bad.report().issues.some(i=>i.id==='rinse'&&/2%/.test(i.text)));assert.ok(!good.report().issues.some(i=>i.id==='rinse'));
});
test('an air bubble adds 0.3 cm3 to the first titre only',()=>{
 const good=wellRun(8),bad=wellRun(8,{bubble:false});
 assert.ok(Math.abs(bad.runs[0].bubbleError-.3)<1e-9&&bad.runs[1].bubbleError===0);
 const diff=bad.runs[0].titre-good.runs[0].titre;assert.ok(Math.abs(diff-.3)<.06,`first titre ${diff} higher`);
 assert.ok(Math.abs(bad.runs[1].titre-good.runs[1].titre)<.06,'later titres unaffected');
 assert.ok(bad.report().issues.some(i=>i.id==='bubble'));
});
test('swirling mixes a drop in; left still, the local pink stays for seconds',()=>{
 const b=new Bench(9);b.rinse();b.fill();b.clearBubble();flask(b);
 while(b.excess<-.02&&b.canFlow){b.setTap(1);b.step(.05);} b.setTap(0);
 for(let k=0;k<400;k++)b.step(.05);
 const bulk=b.bulkPH;
 b.dropOne();b.dropOne();
 assert.ok(b.localTint.alpha>.3,'a patch of pink where the drops fall');
 for(let k=0;k<20;k++)b.step(.05);const afterOne=b.localTint.alpha;assert.ok(afterOne>.1,'still pink after a second without swirling');
 b.setSwirl(1);for(let k=0;k<60;k++)b.step(.05);
 assert.ok(b.localTint.alpha<=b.tint.alpha+.2,'swirling blends the patch into the flask');assert.ok(b.bulkPH>bulk);
});
test('overshoot is detected and reported',()=>{
 const b=new Bench(4);b.rinse();b.fill();b.clearBubble();flask(b);
 while(b.excess<.6&&b.canFlow){b.setTap(1);b.setSwirl(1);b.step(.05);}b.setTap(0);for(let k=0;k<80;k++)b.step(.05);
 assert.equal(b.tint.name,'deep pink');b.recordFinal(Math.round(b.reading*20)/20);
 assert.ok(b.runs[0].excess>.5);assert.ok(b.report().issues.some(i=>i.id==='overshoot'));
});
test('universal indicator is flagged as a vague end point; reading errors are counted',()=>{
 const b=wellRun(6,{indicator:'universal'});assert.ok(b.report().issues.some(i=>i.id==='indicator'));
 const c=new Bench(6);c.rinse();c.fill();c.clearBubble();c.pipette();c.addIndicator('phenolphthalein');
 c.recordInitial(c.reading+.2);titrate(c);c.recordFinal(c.reading);
 assert.ok(c.runs[0].initialWrong&&!c.runs[0].finalWrong);assert.equal(c.report().wrongReadings,1);assert.ok(c.report().readings<=8);
});
test('the tap will not run until the flask and initial reading are in place',()=>{
 const b=new Bench(2);assert.equal(b.blocked,'Fill the burette first.');b.fill();assert.match(b.blocked!,/flask/);
 b.pipette();assert.match(b.blocked!,/indicator/);b.addIndicator('methyl-orange');assert.match(b.blocked!,/initial/);
 const before=b.reading;b.setTap(1);b.step(1);assert.equal(b.reading,before,'nothing runs while blocked');
 b.recordInitial(before);assert.equal(b.blocked,null);b.step(1);assert.ok(b.reading>before);
 assert.equal(b.dropOne(),true);
});
test('calculation steps are marked in order with useful feedback',()=>{
 const b=wellRun(12),mean=b.mean!,want=calcFromTitre(mean);
 assert.equal(b.submitCalc('conc',.1).ok,false,'cannot skip ahead');
 assert.match(b.submitCalc('nBase',want.nBase*1000).message,/1000 times too big/);
 assert.equal(b.submitCalc('nBase',want.nBase).ok,true);
 assert.equal(b.submitCalc('nAcid',want.nBase*2).ok,false);assert.equal(b.submitCalc('nAcid',want.nAcid).ok,true);
 assert.equal(b.submitCalc('conc',want.conc*1.1).ok,false);const done=b.submitCalc('conc',want.conc);assert.equal(done.ok,true);
 const rep=b.report();assert.ok(Math.abs(rep.error!)<1,`error ${rep.error}`);assert.ok(rep.accuracy===40);
 assert.equal(b.calc.nAcid.tries,2);assert.equal(b.procedure().find(s=>s.id==='calculate')!.state,'done');
 assert.equal(b.answerQuiz('q1',false),0);assert.equal(b.answerQuiz('q1',true),8);assert.equal(b.answerQuiz('q2',true),10);assert.equal(b.quizScore,18);
 b.useHint();assert.equal(b.report().hints,2);
});
test('the step list marks skipped steps without announcing them',()=>{
 const b=new Bench(1);assert.equal(b.procedure()[0].state,'current');b.fill();
 assert.equal(b.procedure()[0].state,'skipped');assert.equal(b.procedure()[1].state,'done');assert.equal(b.procedure()[2].state,'current');
 flask(b);assert.equal(b.procedure()[2].state,'skipped');assert.equal(b.procedure()[5].state,'current');
});
