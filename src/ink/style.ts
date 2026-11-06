import type {InkFrame} from './ink';

export interface StyleOptions {colourHoldMs:number;backgroundHoldMs:number;graceMs:number}
export const STYLE_DEFAULTS:StyleOptions={colourHoldMs:500,backgroundHoldMs:1000,graceMs:150};
export type StyleEvent='colour'|'background';
export const nextIn=<T>(list:readonly T[],current:T):T=>list[(list.indexOf(current)+1)%list.length];

/** Fires once per hold; it re-arms only after the pose has been gone longer than the grace. */
class Hold {
 private since:number|null=null;private seen=0;private fired=false;
 constructor(private readonly ms:number,private readonly grace:number){}
 update(active:boolean,at:number){
  if(active){this.since??=at;this.seen=at;if(!this.fired&&at-this.since>=this.ms){this.fired=true;return true;}return false;}
  if(this.since!==null&&at-this.seen>=this.grace){this.since=null;this.fired=false;}
  return false;
 }
 reset(){this.since=null;this.fired=false;}
}

/** ✌️ held cycles the ink colour, 🤟 held cycles the background. Both are ignored while a pinch is down. */
export class StyleGestures {
 private readonly colour:Hold;private readonly background:Hold;
 constructor(options:Partial<StyleOptions>={}){const o={...STYLE_DEFAULTS,...options};this.colour=new Hold(o.colourHoldMs,o.graceMs);this.background=new Hold(o.backgroundHoldMs,o.graceMs);}
 update(frame:InkFrame,drawing:boolean):StyleEvent[]{
  const busy=drawing||frame.hands.some(h=>h.pose==='pinch'),events:StyleEvent[]=[];
  if(busy){this.colour.reset();this.background.reset();return events;}
  if(this.colour.update(frame.hands.some(h=>h.pose==='victory'),frame.at))events.push('colour');
  if(this.background.update(frame.hands.some(h=>h.pose==='love'),frame.at))events.push('background');
  return events;
 }
}
