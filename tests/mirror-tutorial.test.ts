import test from 'node:test';
import assert from 'node:assert/strict';
import {gestureGuide} from '../src/atp/content';
import type {GestureEvent,GestureFrame,HandPose,TrackedHand} from '../src/atp/contracts';
import {readFileSync} from 'node:fs';
import {mirrorGestures} from '../src/mirror/guide';
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
  if(i===2){assert.deepEqual([v.checkpoint,v.step],[true,null]);t.more();at+=100;t.update(frame(at),at);at+=100;}
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

const objects=['atp','perfume','machine','organ','drivetrain','grasp'] as const;
const declared=(id:string)=>{const source=readFileSync(new URL(`../src/${id}/object.ts`,import.meta.url),'utf8');return [...source.match(/^ use:\[(.*?)\],$/m)![1].matchAll(/'([^']+)'/g)].map(m=>m[1]);};
const expected:Record<string,string[]>={
 atp:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-pinch','both-fist','clap'],
 perfume:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-pinch','both-fist','clap'],
 machine:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-pinch','both-fist','clap'],
 drivetrain:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-pinch','both-fist','clap'],
 organ:['pinch','open','fist','thumbDown','both-pinch','point'],
 grasp:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-fist','clap'],
};
test('every page declares the gestures it uses, and the guide and tutorial show exactly those in that order',()=>{
 const all=mirrorGestures().map(g=>g.id);assert.equal(all.length,11);
 for(const id of objects){
  const use=declared(id);assert.deepEqual(use,expected[id],id);assert.equal(new Set(use).size,use.length,`${id} lists a gesture once`);
  for(const g of use)assert.ok(all.includes(g as never),`${id}: ${g}`);
  const guide=mirrorGestures({},use as never);assert.deepEqual(guide.map(g=>g.id),use);
  const t=new Tutorial(guide);assert.equal(t.current.total,use.length,id);assert.equal(t.current.step?.id,use[0]);
 }
 assert.deepEqual(mirrorGestures().map(g=>g.id),expected.atp,'the unfiltered guide is ATP\'s eleven');
 assert.ok(declared('organ').length>0&&declared('grasp').length>0,'organ and grasp now have tutorial steps');
});
test('labels apply to the declared gestures only',()=>{
 const guide=mirrorGestures({pinch:'Pick up',victory:'Unused'},['pinch','fist']);
 assert.deepEqual(guide.map(g=>[g.id,g.label]),[['pinch','Pick up'],['fist','Hold']]);
});
const teach=(t:Tutorial,pose:TutorialPose,at:number)=>pose==='clap'?t.update(frame(at,[],[clap]),at):run(t,poseFor(pose),at,at+700);
test('the basics are the first three steps, then a Basics done checkpoint before the rest',()=>{
 const t=new Tutorial(steps('pinch','open','fist','thumbDown','point'));let at=0;
 for(const [i,pose] of (['pinch','open','fist'] as const).entries()){
  const before=t.update(frame(at),at);assert.deepEqual([before.index,before.step?.pose,before.checkpoint,before.total],[i,pose,false,5]);
  const v=teach(t,pose,at+50);assert.equal(v.justCompleted,true);at+=1000;t.update(frame(at),at);
 }
 const gate=t.update(frame(at+100),at+100);
 assert.deepEqual([gate.checkpoint,gate.step,gate.index,gate.done,gate.hint,gate.needsRelease],[true,null,3,false,false,false]);
 assert.deepEqual([t.update(frame(at+60000,['thumbDown']),at+60000).checkpoint,t.update(frame(at+61000,['thumbDown']),at+61000).index],[true,3],'the checkpoint waits, poses do nothing, no hint');
 const more=t.more();assert.deepEqual([more.checkpoint,more.index,more.step?.pose,more.needsRelease],[false,3,'thumbDown',true]);
 assert.equal(t.more().step?.pose,'thumbDown','more outside the checkpoint changes nothing');
});
test('Finish at the checkpoint ends the tutorial; More gestures carries on to the end',()=>{
 const make=()=>{const t=new Tutorial(steps('fist','open','pinch','point'));t.next();t.next();assert.equal(t.next().checkpoint,true);return t;};
 const done=make().finish();assert.deepEqual([done.done,done.checkpoint,done.step,done.index],[true,false,null,4]);
 const t=make();assert.equal(t.more().step?.pose,'point');
 assert.equal(run(t,['pinch'],0,3000).index,3,'only the right pose passes');
 const end=run(t,['point'],3100,3800);assert.deepEqual([end.done,end.checkpoint],[true,false]);
 const same=new Tutorial(steps('fist','open','pinch'));same.next();same.next();assert.deepEqual([same.next().done,same.current.checkpoint],[true,false],'three steps or fewer have no checkpoint');
});
test('previous and next cross the checkpoint in both directions',()=>{
 const t=new Tutorial(steps('fist','open','pinch','point','victory'));
 t.next();t.next();
 assert.deepEqual([t.next().checkpoint,t.current.index],[true,3]);
 assert.deepEqual([t.next().step?.pose,t.current.checkpoint],['point',false]);
 const back=t.previous();assert.deepEqual([back.checkpoint,back.index,back.step],[true,3,null]);
 const step3=t.previous();assert.deepEqual([step3.checkpoint,step3.index,step3.step?.pose],[false,2,'pinch']);
 assert.equal(t.next().checkpoint,true);t.next();t.next();
 assert.deepEqual([t.current.step?.pose,t.next().done],['victory',true]);
 const last=t.previous();assert.deepEqual([last.index,last.done,last.step?.pose],[4,false,'victory']);
 t.previous();assert.equal(t.previous().checkpoint,true);assert.equal(t.previous().index,2);
 t.previous();t.previous();assert.equal(t.previous().index,0);
});
test('a completed basics step raises the checkpoint, and restart goes back to step one',()=>{
 const t=new Tutorial(steps('fist','open','pinch','point'));run(t,['fist'],0,700);run(t,['open'],800,1500);
 assert.equal(run(t,['pinch'],1600,2300).checkpoint,true);
 t.restart();const v=t.update(frame(5000),5000);assert.deepEqual([v.index,v.checkpoint,v.step?.pose,v.done],[0,false,'fist',false]);
 t.skip();t.restart();assert.equal(t.current.checkpoint,false);
});
test('a held basics pose cannot pass the first extra step, and a clap carries across the checkpoint',()=>{
 const t=new Tutorial(steps('fist','open','fist','fist'));run(t,['fist'],0,700);run(t,['open'],800,1500);run(t,['fist'],1600,2300);
 t.more();assert.equal(run(t,['fist'],2400,6000).index,3,'still held from the third basic');
 const c=new Tutorial(steps('fist','open','pinch','clap'));c.next();c.next();c.next();c.more();
 assert.equal(c.update(frame(0,[],[clap]),0).done,false);assert.equal(c.update(frame(100,[],[clap]),100).done,false);
 c.update(frame(200),200);assert.equal(c.update(frame(300,[],[clap]),300).done,true);
});
test('manual navigation covers every step without tracking, with bounded previous and next',()=>{
 const t=new Tutorial(steps('fist','open','pinch'));
 assert.equal(t.previous().index,0);
 assert.deepEqual([t.next().index,t.next().index,t.next().done],[1,2,true]);
 assert.deepEqual([t.next().index,t.next().done],[3,true]);
 const back=t.previous();assert.deepEqual([back.index,back.done,back.step?.pose,back.justCompleted],[2,false,'pinch',false]);
 assert.equal(t.previous().index,1);assert.equal(t.previous().index,0);assert.equal(t.previous().index,0);
 const empty=new Tutorial([]);assert.equal(empty.previous().done,true);assert.equal(empty.next().done,true);
 t.skip();assert.equal(t.previous().index,2);
});
test('going backwards discards a partial hold and requires release of the destination pose',()=>{
 const t=new Tutorial(steps('fist','open'));
 run(t,['fist'],0,600);t.update(frame(700,['open']),700);assert.equal(t.update(frame(1000,['open']),1000).progress,.5);
 const v=t.previous();assert.deepEqual([v.index,v.progress,v.hint,v.justCompleted,v.needsRelease],[0,0,false,false,true]);
 assert.equal(run(t,['fist'],1100,4000).index,0,'a held destination pose cannot skip the revisited lesson');
 t.update(frame(4100,['pinch']),4100);
 assert.equal(t.update(frame(4200,['fist']),4200).progress,0);
 assert.equal(t.update(frame(4799,['fist']),4799).index,0);
 assert.equal(t.update(frame(4800,['fist']),4800).index,1);
});
test('going forwards gates a pose already held on the new step, including a second hand',()=>{
 const t=new Tutorial(steps('fist','open','pinch'));
 t.update(frame(0,['fist','open']),0);assert.equal(t.next().index,1);
 assert.equal(run(t,['fist','open'],100,3000).progress,0);
 t.update(frame(3100,['fist']),3100);
 assert.equal(run(t,['open'],3200,3800).index,2);
 assert.equal(run(t,['open'],3900,5000).done,false);
});
test('repeated previous and next reset old release gates and stalled clocks',()=>{
 const t=new Tutorial(steps('fist','fist','open'));
 run(t,['fist'],0,600);assert.equal(t.update(frame(8600,['fist']),8600).hint,true);
 t.next();t.previous();
 assert.deepEqual([t.update(frame(20000,['fist']),20000).progress,t.update(frame(20000,['fist']),20000).hint],[0,false]);
 assert.equal(t.update(frame(28000,['fist']),28000).hint,true);
 t.update(frame(28100),28100);assert.equal(run(t,['fist'],28200,28800).index,2);
});
test('tracking loss clears holds and manual release gates without completing lessons',()=>{
 const t=new Tutorial(steps('fist','open'));t.next();
 assert.equal(run(t,['open'],0,1000).progress,0);
 const lost=t.update(frame(1100,[],[{type:'lost',handId:0}]),1100);assert.equal(lost.index,1);assert.equal(lost.progress,0);
 run(t,['open'],1200,1700);assert.equal(t.update(frame(1750),1750).progress,0);
 assert.equal(run(t,['pinch'],1800,3000).index,1,'wrong poses cannot stand in for the lesson');
 assert.equal(run(t,['open'],3100,3700).done,true);
});
test('a clap carried across manual navigation is ignored until its event clears',()=>{
 const t=new Tutorial(steps('fist','clap'));t.next();
 assert.equal(t.update(frame(0,[],[clap]),0).done,false);assert.equal(t.update(frame(100,[],[clap]),100).done,false);
 t.update(frame(200),200);assert.equal(t.update(frame(300,[],[clap]),300).done,true);
});
