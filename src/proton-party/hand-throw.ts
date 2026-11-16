import {fistPose,type Landmark} from '../fist';

export interface HandThrowOptions {holdMs?:number;refractoryMs?:number;lostMs?:number;aspect?:number}
export const HAND_THROW={holdMs:110,refractoryMs:380,lostMs:450};

/**
 * Squeeze your hand into a fist, then open it: the open is the throw.
 * Landmarks are normalised image points; x and z are scaled by the frame's width over height so poses read the same as on the laptop.
 */
export class HandThrow {
 private closedAt:number|null=null;private lastSeen=-Infinity;private lastThrow=-Infinity;
 /** The newest pose, for showing the player what the camera sees. */
 pose:string='none';
 private o:Required<HandThrowOptions>;
 constructor(options:HandThrowOptions={}){this.o={...HAND_THROW,aspect:4/3,...options};}
 /** Milliseconds timestamp of the last frame with a hand in it. */
 get seenAt(){return this.lastSeen;}
 feed(hands:readonly (readonly Landmark[])[],t:number):boolean{
  const hand=hands[0];
  if(!hand||hand.length!==21){
   this.pose='none';
   if(t-this.lastSeen>this.o.lostMs)this.closedAt=null;
   return false;
  }
  if(t-this.lastSeen>this.o.lostMs)this.closedAt=null;
  this.lastSeen=t;
  const a=this.o.aspect,p=fistPose(hand.map(q=>({x:q.x*a,y:q.y,z:q.z*a})));
  // Once squeezed, the fist holds until two fingers straighten, so a wobbling finger is not a release.
  const fist=p.closed||this.closedAt!==null&&p.curled>=3&&p.extended<2;
  this.pose=fist?'fist':p.open?'open':'other';
  if(fist){if(this.closedAt===null)this.closedAt=t;return false;}
  const held=this.closedAt!==null&&t-this.closedAt>=this.o.holdMs;
  this.closedAt=null;
  if(!held||t-this.lastThrow<this.o.refractoryMs)return false;
  this.lastThrow=t;return true;
 }
 reset(){this.closedAt=null;this.lastSeen=-Infinity;this.lastThrow=-Infinity;this.pose='none';}
}
