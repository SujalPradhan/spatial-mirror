import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {GestureTracker,classifyPose,palmOrientation,sideFromLabel} from '../src/atp/gestures';
import realHands from './real-hands.json' with {type:'json'};
import type {Landmark} from '../src/fist';
import {imageHand,imagePose,metricHand,posedHand,type PoseName} from './hand-fixtures';
const events=(f:{events:{type:string}[]},type:string)=>f.events.filter(e=>e.type===type).length;
test('every pose is classified from metric and image landmarks',()=>{
 const cases:[PoseName,string][]=[['open','open'],['fist','fist'],['pinch','pinch'],['tightPinch','pinch'],['point','point'],['victory','victory'],['thumbUp','thumbUp'],['thumbDown','thumbDown'],['love','love']];
 for(const [name,pose] of cases){assert.equal(classifyPose(posedHand(name)),pose,name);assert.equal(classifyPose(imagePose(name).map(p=>({...p,y:p.y*.14/.16}))),pose,name+' image');}
 assert.equal(classifyPose(metricHand(4)),'fist');assert.equal(classifyPose(metricHand(0)),'open');
});
test('bad landmarks are none, and a bad hand is dropped from a frame',()=>{
 assert.equal(classifyPose([]),'none');assert.equal(classifyPose(posedHand('open').map(p=>({...p,x:NaN}))),'none');
 const f=new GestureTracker().update([[],imageHand(0).map(p=>({...p,y:Infinity})),imageHand(0)],0,[],[]);assert.equal(f.hands.length,1);
});
test('a hand on the raw left of the camera is on the viewer mirror right',()=>{
 const f=new GestureTracker().update([imagePose('open',.2)],0);assert.ok(f.hands[0].palm.x>.7);assert.ok(f.hands[0].indexTip.x>.7);
});
test('MediaPipe labels are swapped because the feed is raw',()=>{
 assert.equal(sideFromLabel('Left'),'right');assert.equal(sideFromLabel('Right'),'left');assert.equal(sideFromLabel(null),'unknown');
 assert.equal(new GestureTracker().update([imagePose('open')],0,[],['Left']).hands[0].side,'right');
});
test('pose confirms after its hold and a one-frame flicker never does',()=>{
 const t=new GestureTracker(),hand=(p:PoseName)=>[imagePose(p)],world=(p:PoseName)=>[posedHand(p)];
 t.update(hand('open'),0,world('open'));const f=t.update(hand('open'),100,world('open'));assert.equal(f.hands[0].pose,'open');assert.equal(events(f,'pose'),1);assert.equal(f.hands[0].poseAge,0);
 assert.equal(t.update(hand('fist'),130,world('fist')).hands[0].pose,'open');
 assert.equal(t.update(hand('open'),160,world('open')).hands[0].pose,'open');
 assert.equal(t.update(hand('fist'),190,world('fist')).hands[0].pose,'open');
 assert.equal(t.update(hand('fist'),290,world('fist')).hands[0].pose,'fist');
});
test('pinch engages fast and releases only past a wider threshold',()=>{
 const t=new GestureTracker(),between=posedHand('pinch').map((p,i)=>i===4?{...p,y:p.y+.45}:p),wide=posedHand('open');
 t.update([imagePose('pinch')],0,[posedHand('pinch')]);assert.equal(t.update([imagePose('pinch')],60,[posedHand('pinch')]).hands[0].pose,'pinch');
 assert.equal(classifyPose(between),'open','outside the engage threshold');
 for(let at=90;at<400;at+=30)assert.equal(t.update([imagePose('pinch')],at,[between]).hands[0].pose,'pinch');
 t.update([imagePose('open')],400,[wide]);assert.equal(t.update([imagePose('open')],530,[wide]).hands[0].pose,'open');
});
test('ids stay with the hand when MediaPipe swaps order, and loss waits out a dropout',()=>{
 const t=new GestureTracker(),a=imagePose('open',.2),b=imagePose('open',.8),first=t.update([a,b],0),swapped=t.update([b,a],30);
 assert.deepEqual(first.hands.map(h=>h.id),swapped.hands.map(h=>h.id));
 assert.ok(Math.abs(first.hands[0].palm.x-swapped.hands[0].palm.x)<.02);
 const brief=t.update([a],100);assert.equal(brief.hands.length,2);assert.equal(events(brief,'lost'),0);
 const gone=t.update([a],260);assert.equal(gone.hands.length,1);assert.equal(events(gone,'lost'),1);
});
test('smoothing steadies jitter at rest and follows real motion',()=>{
 const t=new GestureTracker(),start=t.update([imagePose('open',.5)],0).hands[0].palm.x,rest=t.update([imagePose('open',.51)],30).hands[0].palm.x;
 assert.ok(Math.abs(rest-start)<.01*.5,'a small jitter is damped');
 let hand;for(let i=1;i<=12;i++)hand=t.update([imagePose('open',.51-i*.03)],30+i*30).hands[0];
 assert.ok(hand!.velocity.x>.5,'moving right on the mirror');assert.ok(Math.abs(hand!.palm.x-(start+.35))<.06,'little lag at speed');
});
function rotateZ(hand:ReturnType<typeof posedHand>,angle:number){
 // Rotate in scene axes (x right, y up, z toward viewer), then return to raw camera axes.
 const q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),angle);
 return hand.map(p=>{const v=new Vector3(-p.x,-p.y,-p.z).applyQuaternion(q);return {x:-v.x,y:-v.y,z:-v.z};});
}
test('orientation delta matches the mirrored wrist turn for either hand shape',()=>{
 for(const hand of [posedHand('fist'),posedHand('fist').map(p=>({...p,x:-p.x}))]){
  const a=new Quaternion().fromArray(palmOrientation(hand)!),b=new Quaternion().fromArray(palmOrientation(rotateZ(hand,.6))!);
  assert.ok(Math.abs(a.lengthSq()-1)<1e-9);
  const delta=b.multiply(a.clone().invert()),turned=new Vector3(1,0,0).applyQuaternion(delta);
  assert.ok(Math.abs(turned.x-Math.cos(.6))<1e-6&&Math.abs(turned.y-Math.sin(.6))<1e-6);
 }
});
function approach(t:GestureTracker,start=0){
 let f;for(let i=0;i<8;i++){const gap=.35-i*.05;f=t.update([imagePose('open',.5-gap),imagePose('open',.5+gap)],start+i*30,[posedHand('open'),posedHand('open')]);if(f.events.some(e=>e.type==='clap'))return f;}return f!;
}
test('Shock fires once as hands close at any speed, and needs them apart again to re-arm',()=>{
 const t=new GestureTracker(),f=approach(t);assert.equal(events(f,'clap'),1);
 assert.equal(events(t.update([imagePose('open',.48),imagePose('open',.52)],260,[posedHand('open'),posedHand('open')]),'clap'),0);
 const slow=new GestureTracker();let count=0;for(let i=0;i<60;i++){const gap=.35-i*.005;count+=events(slow.update([imagePose('open',.5-gap),imagePose('open',.5+gap)],i*30,[posedHand('open'),posedHand('open')]),'clap');}assert.equal(count,1);
});
test('hands edge-on to the camera still trigger Shock, while fists and pinches do not',()=>{
 const side=new GestureTracker(),blur=posedHand('open').map(p=>({...p,x:p.x*.2}));let count=0;
 for(let i=0;i<30;i++){const gap=.4-i*.012,hand=(x:number)=>imagePose('point',x);count+=events(side.update([hand(.5-gap),hand(.5+gap)],i*30,[blur,blur]),'clap');}assert.equal(count,1);
 for(const pose of ['fist','pinch'] as PoseName[]){const t=new GestureTracker();let fired=0;for(let i=0;i<30;i++){const gap=.4-i*.012;fired+=events(t.update([imagePose(pose,.5-gap),imagePose(pose,.5+gap)],i*30,[posedHand(pose),posedHand(pose)]),'clap');}assert.equal(fired,0,pose);}
});
test('hands far apart never trigger Shock on their own',()=>{
 const t=new GestureTracker();let fired=0;for(let i=0;i<40;i++)fired+=events(t.update([imagePose('open',.2),imagePose('open',.8)],i*30,[posedHand('open'),posedHand('open')]),'clap');assert.equal(fired,0);
});
test('a clap that merges the hands and loses tracking still counts',()=>{
 const t=new GestureTracker();t.update([imagePose('open',.2),imagePose('open',.8)],0,[posedHand('open'),posedHand('open')]);
 t.update([imagePose('open',.3),imagePose('open',.7)],30,[posedHand('open'),posedHand('open')]);
 t.update([imagePose('open',.38),imagePose('open',.62)],60,[posedHand('open'),posedHand('open')]);
 assert.equal(events(t.update([],90),'clap'),1);
});

// Coordinates MediaPipe produced from real photos: Google samples and Wikimedia Commons. No images are stored.
for(const hand of realHands)test(`real ${hand.source} reads as ${hand.pose} on laptop and phone paths`,()=>{
 const run=(world:Landmark[][])=>{const t=new GestureTracker();let f;for(let i=0;i<6;i++)f=t.update([hand.image],i*30,world,[],hand.aspect);return f!.hands[0].pose;};
 assert.equal(run([hand.world]),hand.pose,'laptop');assert.equal(run([]),hand.pose,'phone');
});
test('a single unclear frame does not drop a held gesture',()=>{
 const t=new GestureTracker(),fist=imagePose('fist'),world=posedHand('fist');let f;for(let i=0;i<6;i++)f=t.update([fist],i*30,[world]);assert.equal(f!.hands[0].pose,'fist');
 const unclear=posedHand('open').map((p,i)=>i%4===0?{...p,y:p.y*.4}:{...p,x:p.x*.5});for(let i=6;i<9;i++)f=t.update([imagePose('open')],i*30,[unclear]);assert.equal(f!.hands[0].pose,'fist');
});
