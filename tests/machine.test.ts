import test from 'node:test';
import assert from 'node:assert/strict';
import {PITCH,TIMING,catches,catchWindow,clothTravel,feedPose,hookAngle,loopPose,machineState,needleRise,needleTip,outcomeOf,stitchesUpTo,takeUp,takeUpSpeed} from '../src/machine/model';
import type {FeedPhase,LoopStage,Removable} from '../src/machine/model';

const degrees=(step=1)=>Array.from({length:Math.round(360/step)},(_,i)=>i*step);

test('needle follows a slider crank with a longer dwell at the bottom',()=>{
 assert.ok(needleTip(0)>needleTip(90));assert.ok(needleTip(90)>needleTip(180));
 assert.ok(Math.abs(needleTip(0)-needleTip(360))<1e-9);
 assert.ok(Math.min(...degrees().map(needleTip))>=needleTip(180)-1e-9);
 // Same crank travel from each dead centre: the rod makes the needle move less near the bottom.
 assert.ok(needleRise(210)<needleTip(0)-needleTip(30));
});

test('one formed stitch per cycle, each one pitch along',()=>{
 for(const n of [1,2,5,12]){
  const list=stitchesUpTo(n*360,{});
  assert.equal(list.length,n);
  list.forEach((s,i)=>{assert.equal(s.kind,'formed');assert.equal(s.locked,true);assert.equal(s.x,i*PITCH);});
 }
 assert.equal(stitchesUpTo(TIMING.set-.01).length,0);assert.equal(stitchesUpTo(TIMING.set).length,1);
});

test('the sequence runs in the stated order',()=>{
 const seen:LoopStage[]=[];
 for(const d of degrees(.5)){const s=loopPose(d).stage;if(s!==seen.at(-1))seen.push(s);}
 assert.deepEqual(seen,['idle','thrown','carried','casting','pulling','idle']);
 assert.ok(needleRise(TIMING.catch)>0);
 assert.ok(TIMING.catch>180&&TIMING.catch<TIMING.takeUpLow&&TIMING.cast<TIMING.takeUpTop&&TIMING.takeUpTop<=TIMING.set&&TIMING.set<=TIMING.feedForward);
});

test('the loop apex tracks the hook while carried, then runs ahead as it is pulled off',()=>{
 for(const d of [212,240,280,311])assert.ok(Math.abs(loopPose(d).apexDeg-hookAngle(d))<1e-9);
 assert.ok(loopPose(330).apexDeg>hookAngle(330));
});

test('hook point turns twice for one crank turn',()=>{
 const m=(a:number,b:number)=>((a-b)%360+360)%360;
 for(const d of degrees(7))assert.ok(Math.abs(m(hookAngle(d+1),hookAngle(d))-2)<1e-9);
 assert.equal(hookAngle(TIMING.catch),0);assert.equal(hookAngle(TIMING.catch+180),0);
 let turned=0;for(const d of degrees())turned+=m(hookAngle(d+1),hookAngle(d));
 assert.ok(Math.abs(turned-720)<1e-6);
 assert.equal(hookAngle(TIMING.catch+5,5),0);
});

test('hook timing has a window and misses outside it both ways',()=>{
 const {early,late}=catchWindow();
 assert.ok(early<-5&&late>5,`window ${early}..${late}`);
 for(const offset of [0,early,late,early/2,late/2])assert.equal(outcomeOf({hookTimingOffset:offset}),'formed',String(offset));
 for(const offset of [early-1,late+1,-40,40,-100,100]){
  assert.equal(catches(offset),false);
  const list=stitchesUpTo(5*360,{hookTimingOffset:offset});
  assert.equal(list.length,5);assert.ok(list.every(s=>s.kind==='skipped'&&!s.locked),String(offset));
  assert.notEqual(loopPose(TIMING.catch+Math.max(0,offset)+20,{hookTimingOffset:offset}).stage,'carried');
 }
});

test('each removal gives its own fault',()=>{
 const expected:[Removable,string][]=[['takeUp','loose'],['feedDog','stationary'],['bobbin','single-thread']];
 for(const [part,kind] of expected){
  const list=stitchesUpTo(4*360,{removed:[part]});
  assert.equal(list.length,4);assert.ok(list.every(s=>s.kind===kind),part);
 }
 assert.ok(stitchesUpTo(4*360,{removed:['feedDog']}).every(s=>s.x===0));
 assert.equal(clothTravel(4*360,{removed:['feedDog']}),0);
 assert.ok(clothTravel(4*360+90)>0);
 assert.equal(stitchesUpTo(4*360,{removed:['bobbin']}).some(s=>s.locked),false);
 // A loop that was never caught cannot be left loose, unfed or single-thread.
 assert.equal(outcomeOf({hookTimingOffset:60,removed:['takeUp','bobbin']}),'skipped');
});

test('take-up releases slowly on descent and pulls fast on ascent',()=>{
 const samples=degrees(.5).map(takeUpSpeed),up=Math.max(...samples),down=-Math.min(...samples);
 assert.ok(up>2.5*down,`${up} vs ${down}`);
 assert.equal(takeUp(TIMING.takeUpTop).lift,1);assert.ok(takeUp(TIMING.takeUpLow).lift<1e-9);
 const ascent=degrees().filter(d=>takeUpSpeed(d)>0).length;
 assert.ok(ascent<120,`rises for ${ascent} of 360 degrees`);
 // The pull happens as the loop leaves the case, and the release spans the needle descent.
 assert.ok(takeUpSpeed(TIMING.cast)>0);assert.ok(takeUpSpeed(90)<0);
 const heights=degrees(5).map(d=>takeUp(d));
 assert.ok(new Set(heights.map(p=>p.x.toFixed(2)+p.y.toFixed(2))).size>40);
});

test('feed dog runs rise, forward, drop, return and moves the cloth only with the needle clear',()=>{
 const seen:FeedPhase[]=[];
 for(const d of degrees(.5).map(d=>d+TIMING.feedRise)){const p=feedPose(d).phase;if(p!==seen.at(-1))seen.push(p);}
 assert.deepEqual(seen.slice(0,4),['rise','forward','drop','return']);
 assert.equal(feedPose(TIMING.feedForward+10).y,1);assert.equal(feedPose(180).y,0);
 for(let d=TIMING.feedForward;d<=360+TIMING.feedDrop;d+=4)assert.ok(needleTip(d)>1.6,`needle in cloth at ${d}`);
 assert.equal(clothTravel(TIMING.feedForward),0);
 assert.equal(clothTravel(360+TIMING.feedDrop),PITCH);assert.equal(clothTravel(360+TIMING.catch),PITCH);
 for(const d of degrees(3).map(d=>d+720)){const c=clothTravel(d)-clothTravel(d-3);assert.ok(c>=0);}
});

test('state is pure and matches the parts',()=>{
 const o={hookTimingOffset:3,removed:['takeUp'] as Removable[]},a=machineState(1000,o),b=machineState(1000,o);
 assert.deepEqual(a,b);assert.equal(a.deg,280);assert.equal(a.cycle,2);assert.equal(a.outcome,'loose');
 assert.equal(a.eye-a.needleTip,2.5);assert.equal(a.stitches.length,2);
});
