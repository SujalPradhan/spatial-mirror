import {InkBoard,InkController,type InkHand} from '../ink/ink';
import {renderInk} from '../ink/render';
import type {GestureFrame} from './contracts';
import {mirrorToStage} from './projection';

/** What the engine sees while ink is on: skeletons stay, but no pose, event or hand shape, so nothing reacts. */
export function inkSuppressed(frame:GestureFrame):GestureFrame{
 return {...frame,events:[],hands:frame.hands.map(({shape:_,...hand})=>({...hand,pose:'none',poseAge:0}))};
}

/** A 2D overlay above the viewport: pinch, thumbs-down undo and mouse or touch drags all draw on one board in stage coordinates. */
export class InkMode {
 on=false;readonly board=new InkBoard();readonly canvas=document.createElement('canvas');
 private readonly controller=new InkController(this.board);private readonly ctx=this.canvas.getContext('2d')!;private pointer:number|null=null;
 constructor(private readonly stage:HTMLElement,before?:Element|null){
  this.canvas.className='mirror-ink';this.canvas.hidden=true;this.canvas.setAttribute('aria-hidden','true');
  stage.insertBefore(this.canvas,before??null);
 }
 set(on:boolean,now:number){
  if(on===this.on)return;this.on=on;this.canvas.hidden=!on;this.pointer=null;
  if(!on){this.controller.reset(now);this.board.clear();this.board.keep=false;this.controller.cursor=null;this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);}
 }
 setKeep(keep:boolean,now:number){this.board.setKeep(keep,now);}
 /** Pinch positions are mapped onto the stage exactly as the hand skeleton is. */
 update(frame:GestureFrame,videoAspect:number,now:number){
  if(!this.on)return;
  const aspect=this.stage.clientWidth/(this.stage.clientHeight||1),stage=(p:{x:number;y:number}) => ({...mirrorToStage(p.x,p.y,videoAspect,aspect),z:0});
  const hands:InkHand[]=frame.hands.map(h=>({id:h.id,pose:h.pose,landmarks:h.landmarks,indexTip:stage(h.indexTip),pinch:stage(h.pinch)}));
  this.controller.update({at:now,hands});
 }
 private point(e:PointerEvent){const r=this.canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/(r.width||1),y:(e.clientY-r.top)/(r.height||1)};}
 pointerDown(e:PointerEvent,host:HTMLElement,now:number){
  if(!this.on||e.button!==0)return false;const p=this.point(e);
  this.controller.reset(now);this.board.begin(p.x,p.y,now,this.controller.options.colour,this.controller.options.width);this.pointer=e.pointerId;host.setPointerCapture(e.pointerId);return true;
 }
 pointerMove(e:PointerEvent){if(this.pointer!==e.pointerId)return false;const p=this.point(e);this.board.add(p.x,p.y);return true;}
 pointerUp(e:PointerEvent,now:number){if(this.pointer!==e.pointerId)return false;this.pointer=null;this.board.end(now);return true;}
 render(now:number){
  if(!this.on)return;
  const dpr=Math.min(2,devicePixelRatio||1),w=Math.round(this.canvas.clientWidth*dpr),h=Math.round(this.canvas.clientHeight*dpr);
  if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
  this.board.prune(now);this.ctx.clearRect(0,0,w,h);renderInk(this.ctx,w,h,this.board,now,this.controller.cursor);
 }
}
