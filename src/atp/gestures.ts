import {Matrix4,Quaternion,Vector3} from 'three';
import type {Landmark} from '../fist';
import type {Quat} from '../types';
import type {GestureEvent,GestureFrame,HandPose,HandSide,MirrorPoint,TrackedHand} from './contracts';

const PINCH_ON=.35,PINCH_OFF=.55,CONFIRM_MS=90,PINCH_MS=50,UNPINCH_MS=120,LOST_MS=200,MATCH=.25;
const CLAP_SPEED=1.2,CLAP_NEAR=.18,CLAP_OPEN_MS=150,CLAP_DROP_MS=180,CLAP_COOLDOWN_MS=600;
const distance=(a:Landmark,b:Landmark)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const planar=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
const valid=(hand:Landmark[]|undefined):hand is Landmark[]=>hand?.length===21&&hand.every(p=>[p.x,p.y,p.z].every(Number.isFinite));
function cosine(a:Landmark,b:Landmark,c:Landmark){
 const u={x:a.x-b.x,y:a.y-b.y,z:a.z-b.z},v={x:c.x-b.x,y:c.y-b.y,z:c.z-b.z},length=Math.hypot(u.x,u.y,u.z)*Math.hypot(v.x,v.y,v.z);
 return length>1e-9?(u.x*v.x+u.y*v.y+u.z*v.z)/length:0;
}
/** Same joint rules as fistPose, kept per finger because point/victory/love care which finger. */
export function fingerStates(hand:Landmark[]){
 return [5,9,13,17].map(mcp=>{
  const pip=hand[mcp+1],dip=hand[mcp+2],tip=hand[mcp+3],bend=cosine(hand[mcp],pip,dip),end=cosine(pip,dip,tip);
  const reach=distance(tip,hand[0]),base=distance(pip,hand[0]),near=reach<base*1.08;
  return {extended:bend<-.72&&reach>base*1.12,curled:(bend>-.4&&(end>-.75||near))||(near&&bend>-.65)};
 });
}
/** A loose fist often leaves the thumb out sideways, so only a clear reach away from the palm counts. */
function thumbOut(hand:Landmark[],palm:number){return distance(hand[4],hand[5])>palm*.75;}
function thumbDirection(hand:Landmark[]):'up'|'down'|null{
 const dy=hand[4].y-hand[2].y,across=Math.hypot(hand[4].x-hand[2].x,hand[4].z-hand[2].z);
 return Math.abs(dy)>across*1.2?dy<0?'up':'down':null;
}
export function pinchRatio(hand:Landmark[]){const palm=distance(hand[0],hand[9]);return palm>1e-5?distance(hand[4],hand[8])/palm:Infinity;}
/** Landmarks are y-down, in image or metric units. A wider pinchLimit is the release threshold. */
export function classifyPose(hand:Landmark[],pinchLimit=PINCH_ON):HandPose {
 if(!valid(hand))return 'none';
 const palm=distance(hand[0],hand[9]);if(palm<1e-5)return 'none';
 const f=fingerStates(hand),[index,middle,ring,pinky]=f,curled=f.filter(x=>x.curled).length,extended=f.filter(x=>x.extended).length;
 // A thumb folded over a true fist can touch the index; a pinch keeps the fingertip out from the palm.
 const closed=curled===4&&distance(hand[8],hand[0])<palm*1.15;
 if(pinchRatio(hand)<pinchLimit&&!closed)return 'pinch';
 if(curled===4&&thumbOut(hand,palm)){const way=thumbDirection(hand);if(way)return way==='up'?'thumbUp':'thumbDown';}
 if(index.extended&&pinky.extended&&middle.curled&&ring.curled)return thumbOut(hand,palm)?'love':'none';
 if(curled===4)return 'fist';
 if(index.extended&&!middle.extended&&!ring.extended&&!pinky.extended&&curled>=2)return 'point';
 if(index.extended&&middle.extended&&!ring.extended&&!pinky.extended&&curled>=1)return 'victory';
 return extended>=3?'open':'none';
}
/** The raw feed is unmirrored while MediaPipe assumes a selfie mirror, so its label is the opposite hand. */
export function sideFromLabel(label:string|null|undefined):HandSide {return label==='Left'?'right':label==='Right'?'left':'unknown';}
/** The one place raw camera x becomes what the viewer sees on screen. */
const toMirror=(p:Landmark):MirrorPoint=>({x:1-p.x,y:p.y,z:p.z});
/** Built from mirrored points with cross products, so the reflection still yields a proper rotation. */
export function palmOrientation(hand:Landmark[]):Quat|null {
 if(!valid(hand))return null;
 const scene=(p:Landmark)=>new Vector3(-p.x,-p.y,-p.z);
 const up=scene(hand[9]).sub(scene(hand[0])),across=scene(hand[17]).sub(scene(hand[5]));
 if(up.lengthSq()<1e-10)return null;
 up.normalize();const normal=across.clone().cross(up);if(normal.lengthSq()<1e-10)return null;
 normal.normalize();const side=up.clone().cross(normal).normalize();
 return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(side,up,normal)).toArray() as Quat;
}
const average=(points:MirrorPoint[],ids:number[])=>{const sum=ids.reduce((p,i)=>({x:p.x+points[i].x,y:p.y+points[i].y,z:p.z+points[i].z}),{x:0,y:0,z:0});return {x:sum.x/ids.length,y:sum.y/ids.length,z:sum.z/ids.length};};
interface Track {id:number;side:HandSide;pose:HandPose;candidate:HandPose;since:number;seen:number;at:number;openAt:number;poseAge:number;points:MirrorPoint[];palm:MirrorPoint;velocity:{x:number;y:number};orientation:Quat|null;fresh:boolean}

export class GestureTracker {
 private tracks:Track[]=[];private nextId=1;private previous:{a:number;b:number;gap:number;at:number}|null=null;private armed:{at:number;x:number;y:number}|null=null;private lastClap=-Infinity;
 reset(){this.tracks=[];this.previous=null;this.armed=null;}
 update(hands:Landmark[][],at:number,world:Landmark[][]=[],handedness:(string|null)[]=[],aspect=1):GestureFrame {
  const events:GestureEvent[]=[],scale=Math.max(.1,aspect),inputs=hands.map((raw,index)=>({raw,index})).filter(({raw})=>valid(raw)).map(({raw,index})=>({points:raw.map(toMirror),metric:valid(world[index])?world[index]:raw.map(p=>({...p,y:p.y/scale})),side:sideFromLabel(handedness[index])}));
  // Nearest wrist first: MediaPipe reorders hands between frames.
  const pairs=this.tracks.flatMap(track=>inputs.map((input,i)=>({track,i,gap:planar(track.points[0],input.points[0])}))).filter(p=>p.gap<MATCH).sort((a,b)=>a.gap-b.gap);
  const used=new Set<number>(),matched=new Set<Track>();this.tracks.forEach(t=>{t.fresh=false;});
  for(const {track,i} of pairs){if(used.has(i)||matched.has(track))continue;used.add(i);matched.add(track);this.advance(track,inputs[i],at,events);}
  inputs.forEach((input,i)=>{if(used.has(i))return;const track:Track={id:this.nextId++,side:input.side,pose:'none',candidate:'none',since:at,seen:at,at,openAt:-Infinity,poseAge:0,points:input.points,palm:average(input.points,[0,5,9,13,17]),velocity:{x:0,y:0},orientation:null,fresh:true};this.tracks.push(track);this.advance(track,input,at,events);});
  this.tracks=this.tracks.filter(track=>{if(at-track.seen<=LOST_MS)return true;events.push({type:'lost',handId:track.id});return false;});
  for(const track of this.tracks)if(!track.fresh)track.velocity={x:0,y:0};
  this.clap(at,aspect,events);
  return {at,events,hands:this.tracks.map(t=>({id:t.id,side:t.side,pose:t.pose,landmarks:t.points.map(p=>({...p})),palm:{...t.palm},indexTip:{...t.points[8]},pinch:average(t.points,[4,8]),orientation:t.orientation,velocity:{...t.velocity},poseAge:t.poseAge}) satisfies TrackedHand)};
 }
 private advance(track:Track,input:{points:MirrorPoint[];metric:Landmark[];side:HandSide},at:number,events:GestureEvent[]){
  const dt=Math.max(.001,(at-track.at)/1000),speed=Math.hypot(track.velocity.x,track.velocity.y);
  // Velocity-adaptive low pass: steady at rest, almost no lag once the hand really moves.
  const alpha=track.at===at?1:1-Math.exp(-dt*2*Math.PI*(1.5+12*speed));
  const points=input.points.map((p,i)=>{const o=track.points[i];return {x:o.x+(p.x-o.x)*alpha,y:o.y+(p.y-o.y)*alpha,z:o.z+(p.z-o.z)*alpha};});
  const palm=average(points,[0,5,9,13,17]);
  if(track.at!==at)track.velocity={x:track.velocity.x*.5+(palm.x-track.palm.x)/dt*.5,y:track.velocity.y*.5+(palm.y-track.palm.y)/dt*.5};
  track.points=points;track.palm=palm;track.at=track.seen=at;track.fresh=true;if(input.side!=='unknown')track.side=input.side;
  const next=palmOrientation(input.metric);
  track.orientation=next&&track.orientation?new Quaternion().fromArray(track.orientation).slerp(new Quaternion().fromArray(next),.6).toArray() as Quat:next;
  const raw=classifyPose(input.metric,track.pose==='pinch'?PINCH_OFF:PINCH_ON);
  if(raw==='open')track.openAt=at;
  if(raw!==track.candidate){track.candidate=raw;track.since=at;}
  const wait=track.pose==='pinch'?UNPINCH_MS:raw==='pinch'?PINCH_MS:CONFIRM_MS;
  if(raw!==track.pose&&at-track.since>=wait){track.pose=raw;track.poseAge=0;events.push({type:'pose',handId:track.id,pose:raw});}
  else track.poseAge++;
 }
 /** Real claps often merge the hands and lose tracking, so a fast approach that vanishes also counts. */
 private clap(at:number,aspect:number,events:GestureEvent[]){
  if(this.armed&&at-this.armed.at>CLAP_DROP_MS)this.armed=null;
  const live=this.tracks.filter(t=>t.fresh);
  const fire=(x:number,y:number)=>{this.armed=null;this.previous=null;if(at-this.lastClap<CLAP_COOLDOWN_MS)return;this.lastClap=at;events.push({type:'clap',x,y});};
  if(live.length<2){this.previous=null;if(this.armed)fire(this.armed.x,this.armed.y);return;}
  const [a,b]=live,ratio=Math.max(.1,aspect),gap=Math.hypot(a.palm.x-b.palm.x,(a.palm.y-b.palm.y)/ratio),x=(a.palm.x+b.palm.x)/2,y=(a.palm.y+b.palm.y)/2,last=this.previous;
  const same=last&&last.a===a.id&&last.b===b.id&&at>last.at;
  this.previous={a:a.id,b:b.id,gap,at};
  const opened=at-a.openAt<CLAP_OPEN_MS&&at-b.openAt<CLAP_OPEN_MS;
  if(same&&opened&&(last.gap-gap)/((at-last.at)/1000)>CLAP_SPEED)this.armed={at,x,y};
  if(this.armed&&gap<CLAP_NEAR)fire(x,y);
 }
}
