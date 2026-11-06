import type {InkFrame} from './ink';

export const ZOOM_MIN=1,ZOOM_MAX=4,EASE_MS=300;
export interface ViewState {zoom:number;x:number;y:number}
/** Two pinching hands scale by their spread and pan with their midpoint; the content point under the midpoint at the start stays under it. Pan is in frame fractions, screen = .5 + (c - .5) * zoom + pan. */
export class SlideView {
 zoom=1;x=0;y=0;private grab:{d0:number;z0:number;cx:number;cy:number}|null=null;private ease:{from:ViewState;at:number}|null=null;
 constructor(private readonly minPalm=.05){}
 get active(){return this.grab!==null;}
 update(frame:InkFrame,enabled:boolean,flipX:boolean){
  const pts=enabled?frame.hands.filter(h=>{const a=h.landmarks[0],b=h.landmarks[9];return h.pose==='pinch'&&!!a&&!!b&&Math.hypot(a.x-b.x,a.y-b.y)>=this.minPalm;}).map(h=>({x:flipX?1-h.pinch.x:h.pinch.x,y:h.pinch.y})):[];
  if(pts.length<2){this.grab=null;return;}
  const [a,b]=pts,mx=(a.x+b.x)/2,my=(a.y+b.y)/2,d=Math.hypot(a.x-b.x,a.y-b.y);
  if(!this.grab){this.ease=null;this.grab={d0:Math.max(d,.03),z0:this.zoom,cx:.5+(mx-.5-this.x)/this.zoom,cy:.5+(my-.5-this.y)/this.zoom};}
  const g=this.grab;this.zoom=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,g.z0*d/g.d0));
  const limit=(this.zoom-1)/2;
  this.x=Math.max(-limit,Math.min(limit,mx-.5-(g.cx-.5)*this.zoom));this.y=Math.max(-limit,Math.min(limit,my-.5-(g.cy-.5)*this.zoom));
 }
 /** Eases back to the whole slide, as after a slide change. */
 reset(now:number){this.grab=null;this.ease={from:{zoom:this.zoom,x:this.x,y:this.y},at:now};}
 current(now:number):ViewState{
  if(this.ease){
   const t=(now-this.ease.at)/EASE_MS;
   if(t>=1){this.zoom=1;this.x=0;this.y=0;this.ease=null;}
   else{const k=1-Math.pow(1-t,3),f=this.ease.from;this.zoom=f.zoom+(1-f.zoom)*k;this.x=f.x*(1-k);this.y=f.y*(1-k);}
  }
  return {zoom:this.zoom,x:this.x,y:this.y};
 }
}
