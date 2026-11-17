import test from 'node:test';
import assert from 'node:assert/strict';
import realHands from './real-hands.json' with {type:'json'};
import {imagePose,imageHand,type PoseName} from './hand-fixtures';
import type {Landmark} from '../src/fist';
import {applyHand,ghostAlpha,isActive,newTrack,pullNeeded,PullGate,rainRate,rotorSpeed,summarize,HOLD_MS,FADE_MS,type Crowd,type HandKind,type HandTrack} from '../src/many-hands/crowd';
import {HandReader,PoseFilter,readHand,toScreen} from '../src/many-hands/pose';

const crowdOf=(open=0,fist=0,pinch=0):Crowd=>{const n=open+fist+pinch,s=(k:number)=>n?k/n:0;return {n,open,fist,pinch,openShare:s(open),gripShare:s(fist),pullShare:s(pinch)};};
const track=(id:string,pose:HandKind,at=0):HandTrack=>{const t=newTrack(id,'N'+id,'#fff');applyHand(t,{x:.5,y:.5,pose},at);return t;};

test('pose: the three gestures read from fixture landmarks',()=>{
 for(const [name,want] of [['open','open'],['fist','fist'],['pinch','pinch'],['tightPinch','pinch']] as [PoseName,string][]){
  const r=readHand(imagePose(name),1);assert.equal(r.pose,want,name);assert.ok(r.conf>=.5&&r.conf<=1,name+' '+r.conf);
 }
 assert.equal(readHand(imageHand(0),1).pose,'open');
 assert.equal(readHand(imageHand(4),1).pose,'fist');
});
test('pose: other signs and a missing hand read as none',()=>{
 for(const name of ['point','victory','thumbUp','thumbDown','love'] as PoseName[])assert.equal(readHand(imagePose(name),1).pose,'none',name);
 assert.deepEqual(readHand([],1),{pose:'none',conf:0});
 assert.equal(readHand(imagePose('open').slice(0,20),1).pose,'none');
 assert.equal(readHand(imagePose('open').map(p=>({...p,x:NaN})),1).pose,'none');
});
test('pose: a loosely curled hand with fingers still up prefers open over none',()=>{
 const h=imagePose('open').map(p=>({...p}));
 for(const i of [17,18,19,20])h[i]={...h[i],y:h[i].y+.1,z:h[i].z-.05};
 assert.equal(readHand(h,1).pose,'open');
});
test('pose: real recorded hands, open as open and every other sign as none (no recorded fist or pinch exists)',()=>{
 for(const s of realHands as unknown as {source:string;pose:string;aspect:number;image:Landmark[]}[]){
  const got=readHand(s.image,s.aspect).pose;
  assert.equal(got,s.pose==='open'?'open':'none',`${s.source} (${s.pose}) read as ${got}`);
 }
});
test('pose: a pinch holds through a slightly wider gap, then releases',()=>{
 const h=imagePose('pinch'),wide=h.map(p=>({...p}));wide[4]={...wide[4],x:wide[4].x+.08};
 assert.equal(readHand(wide,1,false).pose,'open',(readHand(wide,1,false).pose));
 assert.equal(readHand(wide,1,true).pose,'pinch');
});
test('pose: the front camera is mirrored, so a hand on the image left lands on the screen right',()=>{
 assert.ok(toScreen(.3,.5).x>.5);assert.ok(toScreen(.7,.5).x<.5);assert.ok(toScreen(.5,.3).y<.5);
 assert.deepEqual(toScreen(.5,.5),{x:.5,y:.5});
 for(const v of [-1,0,1,2]){const p=toScreen(v,v);assert.ok(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);}
});
test('debounce: a pose needs about 200 ms, open 120 ms, losing the hand 400 ms; a flicker changes nothing',()=>{
 const f=new PoseFilter();
 assert.equal(f.feed('fist',0),'none');assert.equal(f.feed('fist',150),'none');assert.equal(f.feed('fist',210),'fist');
 assert.equal(f.feed('none',300),'fist');assert.equal(f.feed('fist',330),'fist');assert.equal(f.feed('none',360),'fist');assert.equal(f.feed('none',700),'fist','under 400 ms of none');
 assert.equal(f.feed('none',800),'none');
 assert.equal(f.feed('open',900),'none');assert.equal(f.feed('open',1030),'open');
 assert.equal(f.feed('pinch',1100),'open');assert.equal(f.feed('open',1150),'open');assert.equal(f.feed('pinch',1200),'open');assert.equal(f.feed('pinch',1420),'pinch');
});
test('reader: steady frames give a stable pose and a smoothed mirrored position; none returns when the hand leaves',()=>{
 const r=new HandReader(),hand=imagePose('open',.3,.4);let out=r.feed([hand],0,1);
 for(let t=33;t<400;t+=33)out=r.feed([hand],t,1);
 assert.equal(out.pose,'open');assert.ok(out.x>.5&&out.y<.5,JSON.stringify(out));assert.ok(out.c>.5);
 for(let t=400;t<1000;t+=33)out=r.feed([],t,1);
 assert.equal(out.pose,'none');assert.equal(out.c,0);
});

test('crowd: counts only active hands; a silent or none hand does not count',()=>{
 const hands=[track('1','open',1000),track('2','fist',1000),track('3','pinch',1000),track('4','none',1000),track('5','open',0)];
 const c=summarize(hands,1000+HOLD_MS);
 assert.deepEqual([c.n,c.open,c.fist,c.pinch],[3,1,1,1]);
 assert.equal(isActive(hands[4],1000+HOLD_MS),false,'stale after the hold');
 assert.ok(Math.abs(c.openShare+c.gripShare+c.pullShare-1)<1e-9);
 assert.deepEqual(summarize([],0),crowdOf());
});
test('crowd: rain and rotor speed rise with open hands, and stay bounded',()=>{
 assert.equal(rainRate(crowdOf()),0);
 const rain=[0,1,2,5,10,20,40,80].map(n=>rainRate(crowdOf(n)));
 for(let i=1;i<rain.length;i++)assert.ok(rain[i]>rain[i-1]);
 assert.ok(rain.at(-1)!<=100);
 const speed=[0,1,3,10,40].map(n=>rotorSpeed(crowdOf(n)));
 for(let i=1;i<speed.length;i++)assert.ok(speed[i]>speed[i-1]);
 assert.ok(rotorSpeed(crowdOf())>0,'the motor idles');
});
test('crowd: the share of fists speeds the rotor beyond open hands, and a lone fist among open hands helps a little',()=>{
 assert.ok(rotorSpeed(crowdOf(0,3))>rotorSpeed(crowdOf(3)));
 assert.ok(rotorSpeed(crowdOf(2,1))>rotorSpeed(crowdOf(3)));
 assert.ok(rotorSpeed(crowdOf(0,40))<=650);assert.ok(rotorSpeed(crowdOf(0,1))>rotorSpeed(crowdOf(1,0))*0.9);
 assert.ok(rotorSpeed(crowdOf(0,0,5))<rotorSpeed(crowdOf(5)),'pinchers pull, they do not push the rotor');
});
test('pull: tears at half of the active hands (at least one) and reassembles when pinches fall under a third',()=>{
 assert.deepEqual([1,2,3,4,10,40].map(n=>pullNeeded(n,.5)),[1,1,2,2,5,20]);
 const g=new PullGate();let t=0;const step=(c:Crowd)=>g.update(c,t+=1000);
 assert.equal(step(crowdOf(1)),false,'an open hand alone does not pull');
 assert.equal(step(crowdOf(1,0,1)),true,'1 of 2 is half');
 assert.equal(step(crowdOf(1,0,0)),false);
 assert.equal(step(crowdOf(1,1,1)),false,'1 of 3 is not half');
 assert.equal(step(crowdOf(1,0,2)),true,'2 of 3 tears');
 assert.equal(step(crowdOf(1,1,1)),true,'hysteresis: 1 of 3 keeps it apart');
 assert.equal(step(crowdOf(2,0,1)),true);
 assert.equal(step(crowdOf(3,0,0)),false,'all released reassembles');
 assert.equal(step(crowdOf(0,0,1)),true,'a lone pinching hand is enough');
 assert.equal(step(crowdOf()),false,'nobody left reassembles');
 const big=new PullGate();
 assert.equal(big.update(crowdOf(21,0,19),0),false);assert.equal(big.update(crowdOf(20,0,20),1000),true);
 assert.equal(big.update(crowdOf(28,0,12),2000),true,'12 of 40 is still over 30 percent');assert.equal(big.update(crowdOf(30,0,10),3000),false);
});
test('pull: toggles at most every 400 ms',()=>{
 const g=new PullGate();assert.equal(g.update(crowdOf(0,0,2),0),true);
 assert.equal(g.update(crowdOf(2),100),true,'too soon');assert.equal(g.update(crowdOf(2),450),false);assert.equal(g.update(crowdOf(0,0,2),500),false);assert.equal(g.update(crowdOf(0,0,2),900),true);
});
test('fade: a ghost is full while active, then gone about two seconds after the last good pose',()=>{
 const t=track('1','open',0);
 assert.equal(ghostAlpha(t,0),1);assert.equal(ghostAlpha(t,HOLD_MS),1);
 const half=ghostAlpha(t,HOLD_MS+FADE_MS/2);assert.ok(half>.45&&half<.55,String(half));
 assert.equal(ghostAlpha(t,HOLD_MS+FADE_MS),0);assert.equal(HOLD_MS+FADE_MS,2000);
 applyHand(t,{x:.9,y:.9,pose:'none'},500);assert.equal(isActive(t,500),false,'none stops counting at once');assert.equal(t.x,.5,'none keeps the last position');
 assert.equal(ghostAlpha(t,500),1,'but the ghost lingers');assert.equal(ghostAlpha(t,2000),0);
 applyHand(t,{x:.2,y:.3,pose:'fist',c:.8},3000);assert.equal(ghostAlpha(t,3000),1);assert.equal(t.x,.2);
 const fresh=newTrack('9','x','#fff');assert.equal(ghostAlpha(fresh,0),0,'a hand never seen is not drawn');
});
