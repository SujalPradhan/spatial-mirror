import test from 'node:test';
import assert from 'node:assert/strict';
import {gestureGuide} from '../src/atp/content';
import type {GestureEvent,GestureFrame,HandPose,TrackedHand} from '../src/atp/contracts';
import {Tutorial,markTutorialSeen,tutorialSeen,type TutorialPose,type TutorialStep,type TutorialView} from '../src/mirror/tutorial';

const frame=(at:number,poses:HandPose[]=[],events:GestureEvent[]=[]):GestureFrame=>({at,events,hands:poses.map((pose,id)=>({id,pose}) as TrackedHand)});
const clap:GestureEvent={type:'clap',x:.5,y:.5};
const steps=(...poses:TutorialPose[]):TutorialStep[]=>poses.map(pose=>({id:pose,glyph:'',label:pose,pose}));
const poseFor=(pose:TutorialPose):HandPose[]=>pose==='both-pinch'?['pinch','pinch']:pose==='both-fist'?['fist','fist']:pose==='clap'?[]:[pose];
const run=(t:Tutorial,poses:HandPose[],from:number,to:number,by=100)=>{let v=t.update(frame(from,poses),from);for(let at=from+by;at<=to&&!v.justCompleted;at+=by)v=t.update(frame(at,poses),at);return v;};

test('the full guide runs in order, one step at a time',()=>{
 const t=new Tutorial(gestureGuide);let at=0;
 for(const [i,step] of gestureGuide.entries()){
  const before=t.update(frame(at),at);assert.equal(before.index,i);assert.equal(before.step?.id,step.id);assert.equal(before.total,11);assert.equal(before.done,false);
  const v:TutorialView=step.pose==='clap'?t.update(frame(at+50,[],[clap]),at+50):run(t,poseFor(step.pose),at+50,at+650);
  assert.equal(v.justCompleted,true,step.id);at+=700;
  if(i<10)assert.equal(v.index,i+1);
 }
 const end=t.update(frame(at),at);assert.deepEqual([end.done,end.index,end.step,end.progress,end.justCompleted],[true,11,null,1,false]);
});
test('a step completes at 600ms, with progress on the way and justCompleted for one update only',()=>{
 const t=new Tutorial(steps('fist','open'));
 assert.equal(t.update(frame(0,['fist']),0).progress,0);assert.equal(t.update(frame(300,['fist']),300).progress,.5);
 assert.equal(t.update(frame(599,['fist']),599).justCompleted,false);
 const v=t.update(frame(600,['fist']),600);assert.deepEqual([v.justCompleted,v.index,v.progress,v.step?.id],[true,1,0,'open']);
 assert.equal(t.update(frame(630,['fist']),630).justCompleted,false);
});
test('losing the pose resets the hold',()=>{
 const t=new Tutorial(steps('fist'));run(t,['fist'],0,500);
 assert.equal(t.update(frame(530,['open']),530).progress,0);
 assert.equal(t.update(frame(560,['fist']),560).progress,0);
 assert.equal(t.update(frame(1100,['fist']),1100).done,false);
 assert.equal(t.update(frame(1160,['fist']),1160).done,true);
});
test('two-handed steps need both hands in the pose',()=>{
 for(const [pose,hand] of [['both-pinch','pinch'],['both-fist','fist']] as const){
  const t=new Tutorial(steps(pose));
  assert.equal(run(t,[hand],0,2000).progress,0);assert.equal(run(t,[hand,'open'],2100,4000).progress,0);
  assert.equal(run(t,[hand,hand],4100,4700).done,true);
 }
});
test('one hand dropping out of a two-handed hold resets it',()=>{
 const t=new Tutorial(steps('both-fist'));run(t,['fist','fist'],0,500);
 assert.equal(t.update(frame(530,['fist']),530).progress,0);assert.equal(t.update(frame(560,['fist','fist']),560).progress,0);
});
test('clap completes on its event with no hold, and no pose stands in for it',()=>{
 const t=new Tutorial(steps('clap'));
 assert.equal(run(t,['open','open'],0,2000).done,false);
 assert.equal(t.update(frame(2100,[],[{type:'pose',handId:1,pose:'open'}]),2100).done,false);
 const v=t.update(frame(2200,[],[clap]),2200);assert.equal(v.done,true);assert.equal(v.justCompleted,true);
});
test('hint appears after 8000ms stalled, and holding clears it',()=>{
 const t=new Tutorial(steps('fist','open'));
 t.update(frame(1000),1000);assert.equal(t.update(frame(8999),8999).hint,false);assert.equal(t.update(frame(9000),9000).hint,true);
 t.update(frame(9100,['fist']),9100);assert.equal(t.update(frame(9200,['fist']),9200).hint,false);
 assert.equal(t.update(frame(9700,['fist']),9700).justCompleted,true);
 assert.equal(t.update(frame(17699),17699).hint,false,'each step gets its own clock');assert.equal(t.update(frame(17700),17700).hint,true);
});
test('flickering the pose makes no progress, so the hint still comes',()=>{
 const t=new Tutorial(steps('fist'));run(t,['fist'],0,300);let v;
 for(let at=400;at<=8400;at+=400)v=t.update(frame(at,at%800?['open']:['fist']),at);
 assert.equal(v?.hint,true);
});
test('skip jumps to done and stays there',()=>{
 const t=new Tutorial(steps('fist','open'));t.update(frame(0),0);t.skip();
 const v=t.update(frame(10,['fist']),10);assert.deepEqual([v.done,v.index,v.step,v.progress,v.hint,v.justCompleted],[true,2,null,1,false,false]);
});
test('restart returns to step 0 with clean clocks, from any point',()=>{
 const t=new Tutorial(steps('fist','open'));run(t,['fist'],0,600);run(t,['open'],700,1300);assert.equal(t.update(frame(1400),1400).done,true);
 t.restart();
 const v=t.update(frame(20000),20000);assert.deepEqual([v.index,v.done,v.progress,v.hint],[0,false,0,false]);
 assert.equal(run(t,['fist'],20100,20700).justCompleted,true);
 t.skip();t.restart();assert.equal(t.update(frame(30000),30000).index,0);
 const held=new Tutorial(steps('fist','fist'));run(held,['fist'],0,600);held.restart();assert.equal(run(held,['fist'],700,1300).justCompleted,true,'restart clears the release gate');
});
test('a held pose cannot pass a following step',()=>{
 const other=new Tutorial(steps('fist','open'));run(other,['fist'],0,600);
 assert.deepEqual([run(other,['fist'],700,5000).index,run(other,['fist'],5100,9000).progress],[1,0]);
 for(const [poses,held] of [[['fist','fist'],['fist']],[['both-fist','fist'],['fist','fist']],[['both-pinch','pinch'],['pinch','pinch']],[['clap','clap'],[]]] as [TutorialPose[],HandPose[]][]){
  const t=new Tutorial(steps(...poses));
  if(poses[0]==='clap')t.update(frame(0,[],[clap]),0);else run(t,held,0,600);
  const v=run(t,held,700,4000);assert.deepEqual([v.index,v.progress,v.done],[1,0,false],poses.join());
 }
});
test('releasing frees the next step, and its hold starts only after the release',()=>{
 const t=new Tutorial(steps('fist','fist'));run(t,['fist'],0,600);run(t,['fist'],700,1500);
 t.update(frame(1600),1600);
 assert.equal(t.update(frame(1700,['fist']),1700).progress,0);assert.equal(t.update(frame(2200,['fist']),2200).done,false);assert.equal(t.update(frame(2300,['fist']),2300).done,true);
});
test('a genuinely new pose needs no release, even with the old one still held',()=>{
 const t=new Tutorial(steps('fist','open'));run(t,['fist'],0,600);
 assert.equal(run(t,['fist','open'],700,1300).done,true,'the other hand shows the new pose');
 const pair=new Tutorial(steps('pinch','both-pinch'));run(pair,['pinch'],0,600);
 assert.equal(run(pair,['pinch','pinch'],700,1300).done,true,'a second hand joins the first');
});
test('a blocked step still reaches its hint',()=>{
 const t=new Tutorial(steps('fist','fist'));run(t,['fist'],0,600);assert.equal(t.update(frame(8600,['fist']),8600).hint,true);
});
test('options override the timing, and no steps means done',()=>{
 const t=new Tutorial(steps('fist'),{holdMs:100,hintMs:50});t.update(frame(0),0);assert.equal(t.update(frame(50),50).hint,true);
 t.update(frame(60,['fist']),60);assert.equal(t.update(frame(160,['fist']),160).done,true);
 assert.deepEqual([new Tutorial([]).update(frame(0),0).done],[true]);
});
test('seen flag round-trips under mirror-tutorial-v1',()=>{
 const m=new Map<string,string>(),storage={getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);}};
 assert.equal(tutorialSeen(storage),false);markTutorialSeen(storage);assert.equal(tutorialSeen(storage),true);assert.deepEqual([...m.keys()],['mirror-tutorial-v1']);
});
test('storage that throws reads as unseen and never escapes',()=>{
 const storage={getItem():string|null{throw new Error('denied');},setItem(){throw new Error('quota');}};
 assert.equal(tutorialSeen(storage),false);assert.doesNotThrow(()=>markTutorialSeen(storage));
});
