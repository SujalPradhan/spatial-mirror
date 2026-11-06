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

/** A small rounded label that fades over its last third: a colour dot, or text. */
export function renderChip(ctx:CanvasRenderingContext2D,w:number,h:number,at:{x:number;y:number},age:number,label:{colour?:string;text?:string},life=1200){
 if(age<0||age>=life)return;
 const alpha=Math.min(1,(life-age)/(life/3)),size=Math.max(14,w*.028);
 ctx.save();ctx.globalAlpha=alpha;ctx.font=`600 ${size}px system-ui,sans-serif`;
 const text=label.text??'',pad=size*.6,textW=text?ctx.measureText(text).width:0,dot=size*.55,boxW=pad*2+(label.colour?dot*2+(text?pad*.6:0):0)+textW,boxH=size*1.7;
 const x=Math.max(8,Math.min(w-boxW-8,at.x*w+size)),y=Math.max(8,Math.min(h-boxH-8,at.y*h-boxH-size));
 ctx.beginPath();ctx.roundRect(x,y,boxW,boxH,boxH/2);ctx.fillStyle='rgba(20,22,28,.78)';ctx.fill();
 let cx=x+pad;
 if(label.colour){ctx.beginPath();ctx.arc(cx+dot,y+boxH/2,dot,0,Math.PI*2);ctx.fillStyle=label.colour;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();cx+=dot*2+(text?pad*.6:0);}
 if(text){ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.fillText(text,cx,y+boxH/2+size*.04);}
 ctx.restore();
}

export const GUIDE_LINES:[string,string][]=[['🤏','Draw'],['🤏🤏','Zoom slide'],['✋','Swipe slides'],['✌️','Colour'],['👎','Undo'],['🤟','Background']];
/** A compact translucent legend in the bottom-left corner, at most about a fifth of the frame wide. */
export function renderGuide(ctx:CanvasRenderingContext2D,w:number,h:number){
 const size=Math.max(10,w*.0165),pad=size*.7,row=size*1.45,boxW=Math.min(w*.2,size*11),boxH=pad*2+row*GUIDE_LINES.length;
 ctx.save();ctx.globalAlpha=.82;ctx.beginPath();ctx.roundRect(w*.015,h-boxH-h*.02,boxW,boxH,size*.7);ctx.fillStyle='rgba(16,18,26,.72)';ctx.fill();
 ctx.globalAlpha=1;ctx.font=`500 ${size}px system-ui,sans-serif`;ctx.textBaseline='middle';ctx.fillStyle='#fff';
 GUIDE_LINES.forEach(([e,t],i)=>{const y=h-boxH-h*.02+pad+row*(i+.5);ctx.textAlign='left';ctx.fillText(e,w*.015+pad,y);ctx.fillText(t,w*.015+pad+size*3.2,y);});
 ctx.restore();
}
