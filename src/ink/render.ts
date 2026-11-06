import type {InkBoard,InkCursor,Stroke} from './ink';

function trace(ctx:CanvasRenderingContext2D,stroke:Stroke,w:number,h:number){
 const pts=stroke.points;ctx.beginPath();
 if(pts.length===1){ctx.arc(pts[0].x*w,pts[0].y*h,stroke.width*w/2,0,Math.PI*2);return;}
 ctx.moveTo(pts[0].x*w,pts[0].y*h);
 for(let i=1;i<pts.length-1;i++)ctx.quadraticCurveTo(pts[i].x*w,pts[i].y*h,(pts[i].x+pts[i+1].x)/2*w,(pts[i].y+pts[i+1].y)/2*h);
 const last=pts[pts.length-1];ctx.lineTo(last.x*w,last.y*h);
}
/** Draws every visible stroke, then a dot at the fingertip when a cursor is given. */
export function renderInk(ctx:CanvasRenderingContext2D,w:number,h:number,board:InkBoard,now:number,cursor:InkCursor|null=null,colour='#ffffff'){
 ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
 for(const stroke of board.strokes){
  const alpha=board.alpha(stroke,now);if(alpha<=0)continue;
  ctx.globalAlpha=alpha;trace(ctx,stroke,w,h);
  if(stroke.points.length===1){ctx.fillStyle=stroke.colour;ctx.fill();}
  else{ctx.strokeStyle=stroke.colour;ctx.lineWidth=stroke.width*w;ctx.stroke();}
 }
 if(cursor){
  ctx.globalAlpha=1;ctx.beginPath();ctx.arc(cursor.x*w,cursor.y*h,w*(cursor.drawing?.007:.009),0,Math.PI*2);
  ctx.fillStyle=colour;ctx.fill();ctx.lineWidth=Math.max(1.5,w*.0025);ctx.strokeStyle='#ffffff';ctx.stroke();
 }
 ctx.restore();
}
