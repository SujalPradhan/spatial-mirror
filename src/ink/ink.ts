import type {HandPose,MirrorPoint} from '../mirror/contracts';

export interface InkPoint {x:number;y:number}
/** Points are normalized 0..1 over the frame; width is a fraction of frame width. */
export interface Stroke {points:InkPoint[];colour:string;width:number;createdAt:number;finishedAt:number|null}
export const FADE_MS=8000,DEFAULT_WIDTH=.008;

export class InkBoard {
 strokes:Stroke[]=[];keep=false;private active:Stroke|null=null;
 constructor(readonly fadeMs=FADE_MS,private readonly follow=.6,private readonly minStep=.0015){}
 get drawing(){return this.active!==null;}
 begin(x:number,y:number,now:number,colour:string,width=DEFAULT_WIDTH){this.end(now);const stroke:Stroke={points:[{x,y}],colour,width,createdAt:now,finishedAt:null};this.strokes.push(stroke);this.active=stroke;return stroke;}
 /** Eases toward the new point so hand jitter does not show in the line. */
 add(x:number,y:number){
  const stroke=this.active;if(!stroke)return;const last=stroke.points[stroke.points.length-1];
  if(Math.hypot(x-last.x,y-last.y)<this.minStep)return;
  stroke.points.push({x:last.x+(x-last.x)*this.follow,y:last.y+(y-last.y)*this.follow});
 }
 end(now:number){if(this.active)this.active.finishedAt=now;this.active=null;}
 alpha(stroke:Stroke,now:number){return stroke.finishedAt===null||this.keep?1:Math.max(0,Math.min(1,1-(now-stroke.finishedAt)/this.fadeMs));}
 prune(now:number){if(!this.keep)this.strokes=this.strokes.filter(s=>this.alpha(s,now)>0);}
 /** Turning keep off starts the fade from now, so held ink does not vanish at once. */
 setKeep(on:boolean,now:number){if(this.keep&&!on)for(const s of this.strokes)if(s.finishedAt!==null)s.finishedAt=now;this.keep=on;}
 undo(now:number){
  for(let i=this.strokes.length-1;i>=0;i--)if(this.alpha(this.strokes[i],now)>0){if(this.strokes[i]===this.active)this.active=null;this.strokes.splice(i,1);return true;}
  return false;
 }
 clear(){this.strokes=[];this.active=null;}
}

/** The slice of a TrackedHand the ink needs, so a GestureFrame passes straight in. */
export interface InkHand {id:number;pose:HandPose;indexTip:MirrorPoint;pinch:MirrorPoint;landmarks:MirrorPoint[]}
export interface InkFrame {at:number;hands:InkHand[]}
export interface InkOptions {colour:string;width:number;
 /** Store x mirrored, for a surface that shows the unmirrored camera while gestures are in mirror space. */
 flipX:boolean;
 /** Palm length (wrist to middle knuckle) below which a pinch is ignored as a far or tiny hand. */
 minPalm:number;graceMs:number;undoHoldMs:number}
export const INK_DEFAULTS:InkOptions={colour:'#ff3b30',width:DEFAULT_WIDTH,flipX:false,minPalm:.05,graceMs:150,undoHoldMs:500};
export interface InkCursor {x:number;y:number;drawing:boolean}

export class InkController {
 options:InkOptions;cursor:InkCursor|null=null;
 private handId:number|null=null;private lostAt:number|null=null;private downSince:number|null=null;private undone=false;
 constructor(readonly board=new InkBoard(),options:Partial<InkOptions>={}){this.options={...INK_DEFAULTS,...options};}
 private map(p:MirrorPoint):InkPoint{return {x:this.options.flipX?1-p.x:p.x,y:p.y};}
 private pinching(hand:InkHand){const a=hand.landmarks[0],b=hand.landmarks[9];return hand.pose==='pinch'&&!!a&&!!b&&Math.hypot(a.x-b.x,a.y-b.y)>=this.options.minPalm;}
 update(frame:InkFrame){
  const {at}=frame,o=this.options,hands=frame.hands;
  if(this.handId!==null){
   const hand=hands.find(h=>h.id===this.handId);
   if(hand&&this.pinching(hand)){this.lostAt=null;const p=this.map(hand.pinch);this.board.add(p.x,p.y);}
   else if(hand)this.finish(at);
   else{this.lostAt??=at;if(at-this.lostAt>=o.graceMs)this.finish(at);}
  }
  if(this.handId===null){
   const hand=hands.find(h=>this.pinching(h));
   if(hand){this.handId=hand.id;this.lostAt=null;const p=this.map(hand.pinch);this.board.begin(p.x,p.y,at,o.colour,o.width);}
  }
  if(!hands.some(h=>h.pose==='thumbDown')){this.downSince=null;this.undone=false;}
  else{this.downSince??=at;if(!this.undone&&at-this.downSince>=o.undoHoldMs){this.undone=true;this.board.undo(at);}}
  const shown=hands.find(h=>h.id===this.handId)??hands[0];
  this.cursor=shown?{...this.map(shown.indexTip),drawing:this.handId!==null}:null;
 }
 /** Ends any stroke and hides the cursor, for when ink is switched off. */
 reset(now:number){this.finish(now);this.cursor=null;this.downSince=null;this.undone=false;}
 private finish(now:number){this.board.end(now);this.handId=null;this.lostAt=null;}
}
