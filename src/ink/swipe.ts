import type {InkFrame} from './ink';

export interface SwipeOptions {travel:number;windowMs:number;cooldownMs:number;slope:number}
export const SWIPE_DEFAULTS:SwipeOptions={travel:.25,windowMs:400,cooldownMs:600,slope:.6};
/** An open palm that travels far and fast, mostly sideways, in mirror space: toward the viewer's left is next. */
export class SwipeDetector {
 private history=new Map<number,{t:number;x:number;y:number}[]>();private until=-Infinity;private readonly o:SwipeOptions;
 constructor(options:Partial<SwipeOptions>={}){this.o={...SWIPE_DEFAULTS,...options};}
 update(frame:InkFrame):'next'|'prev'|null{
  const at=frame.at;let result:'next'|'prev'|null=null;
  for(const id of [...this.history.keys()])if(!frame.hands.some(h=>h.id===id&&h.pose==='open'))this.history.delete(id);
  for(const hand of frame.hands){
   const p=hand.landmarks[9];if(hand.pose!=='open'||!p)continue;
   const list=this.history.get(hand.id)??[];list.push({t:at,x:p.x,y:p.y});while(list.length&&at-list[0].t>this.o.windowMs)list.shift();this.history.set(hand.id,list);
   if(result||at<this.until||list.length<3)continue;
   const dx=p.x-list[0].x,dy=p.y-list[0].y;
   if(Math.abs(dx)>=this.o.travel&&Math.abs(dy)<=this.o.slope*Math.abs(dx)){result=dx<0?'next':'prev';this.until=at+this.o.cooldownMs;}
  }
  if(result)this.history.clear();
  return result;
 }
}
