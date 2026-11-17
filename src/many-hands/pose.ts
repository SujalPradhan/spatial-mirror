import type {Landmark} from '../fist';
import {classifyPose,fingerStates,pinchRatio} from '../mirror/gestures';
import type {HandKind} from './crowd';

export interface Reading {pose:HandKind;conf:number}
export interface HandOut {pose:HandKind;x:number;y:number;c:number}
const PINCH_ON=.35,PINCH_OFF=.55,SETTLE_MS={open:120,fist:200,pinch:200,none:400},SMOOTH=.5,GAIN=1.5;

/**
 * One hand, three poses. Landmarks are image points scaled by the frame's width over height.
 * Anything that is not clearly a fist or a pinch but has fingers up counts as open; other signs read as none.
 * Confidence is derived from how many fingers agree, not reported by the model.
 */
export function readHand(hand:readonly Landmark[],aspect:number,pinching=false):Reading{
 if(hand.length!==21)return {pose:'none',conf:0};
 const a=aspect>0?aspect:4/3,scaled=hand.map(p=>({x:p.x*a,y:p.y,z:p.z*a})),limit=pinching?PINCH_OFF:PINCH_ON;
 const raw=classifyPose(scaled,limit),f=fingerStates(scaled),extended=f.filter(s=>s.extended).length,curled=f.filter(s=>s.curled).length;
 if(raw==='pinch')return {pose:'pinch',conf:.5+.5*Math.max(0,Math.min(1,1-pinchRatio(scaled)/limit))};
 if(raw==='fist')return {pose:'fist',conf:.5+curled*.125};
 if(raw==='open')return {pose:'open',conf:.5+extended*.125};
 if(raw==='none'&&extended>=2)return {pose:'open',conf:.4+extended*.1};
 return {pose:'none',conf:0};
}
/** Image point to the presenter's screen: mirrored like a selfie, so moving right moves the ghost right. */
export const toScreen=(x:number,y:number)=>({x:clamp(.5-(x-.5)*GAIN),y:clamp(.5+(y-.5)*GAIN)});
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export const palm=(hand:readonly Landmark[])=>{
 const ids=[0,5,9,13,17];return {x:ids.reduce((s,i)=>s+hand[i].x,0)/5,y:ids.reduce((s,i)=>s+hand[i].y,0)/5};
};

/** A pose has to hold for a moment before it counts, so one odd frame never flips it. */
export class PoseFilter {
 pose:HandKind='none';private cand:HandKind='none';private since=0;
 feed(raw:HandKind,t:number){
  if(raw!==this.cand){this.cand=raw;this.since=t;}
  if(raw===this.pose)return this.pose;
  if(t-this.since>=SETTLE_MS[raw])this.pose=raw;
  return this.pose;
 }
 reset(){this.pose=this.cand='none';this.since=0;}
}

/** Camera frames in, a steady pose and screen position out. */
export class HandReader {
 private filter=new PoseFilter();private sx=.5;private sy=.5;private seen=false;private conf=0;
 get pose(){return this.filter.pose;}
 feed(hands:readonly (readonly Landmark[])[],t:number,aspect:number):HandOut{
  const hand=hands[0];let raw:HandKind='none';
  if(hand&&hand.length===21){
   const r=readHand(hand,aspect,this.filter.pose==='pinch');raw=r.pose;
   if(raw!=='none'){
    this.conf=r.conf;const p=toScreen(palm(hand).x,palm(hand).y);
    if(!this.seen){this.sx=p.x;this.sy=p.y;this.seen=true;}else{this.sx+=(p.x-this.sx)*SMOOTH;this.sy+=(p.y-this.sy)*SMOOTH;}
   }
  }
  const pose=this.filter.feed(raw,t);if(pose==='none')this.seen=false;
  return {pose,x:this.sx,y:this.sy,c:pose==='none'?0:this.conf};
 }
 reset(){this.filter.reset();this.seen=false;this.conf=0;}
}
