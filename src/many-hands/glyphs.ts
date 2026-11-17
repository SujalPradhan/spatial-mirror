import type {HandKind} from './crowd';

type Pt=[number,number];
interface Shape {strokes:Pt[][];width:number;palm:Pt[];tips:Pt[]}
const finger=(x:number,top:number,lean:number):Pt[]=>[[x,-.05],[x+lean*top,-.05-top]];
const shapes:Record<Exclude<HandKind,'none'>,Shape>={
 open:{
  width:.21,palm:[[-.4,-.05],[.4,-.05],[.46,.5],[.2,.82],[-.2,.82],[-.46,.5]],
  strokes:[finger(-.33,.72,-.1),finger(-.11,.92,-.03),finger(.11,.86,.03),finger(.33,.66,.1),[[-.4,.38],[-.72,.12],[-.9,-.18]]],
  tips:[[-.43,-.77],[-.14,-.97],[.14,-.91],[.4,-.71],[-.9,-.18]],
 },
 fist:{
  width:.23,palm:[[-.42,-.02],[.42,-.02],[.48,.48],[.24,.82],[-.24,.82],[-.48,.48]],
  strokes:[[[-.33,-.02],[-.33,-.2]],[[-.11,-.02],[-.11,-.27]],[[.11,-.02],[.11,-.25]],[[.33,-.02],[.33,-.17]],[[-.5,.42],[-.16,.2],[.2,.16]]],
  tips:[[-.33,-.2],[-.11,-.27],[.11,-.25],[.33,-.17],[.2,.16]],
 },
 pinch:{
  width:.2,palm:[[-.4,-.05],[.4,-.05],[.46,.5],[.2,.82],[-.2,.82],[-.46,.5]],
  strokes:[[[-.33,-.05],[-.45,-.42],[-.58,-.62]],finger(-.11,.92,-.03),finger(.11,.86,.03),finger(.33,.66,.1),[[-.4,.38],[-.72,.2],[-.76,-.2],[-.6,-.6]]],
  tips:[[-.58,-.62],[-.14,-.97],[.14,-.91],[.4,-.71]],
 },
};
const mix=(hex:string,k:number)=>{
 const c=document.createElement('canvas').getContext('2d')!;c.fillStyle=hex;const v=String(c.fillStyle);
 const n=v.startsWith('#')?[1,3,5].map(i=>parseInt(v.slice(i,i+2),16)):(v.match(/\d+(\.\d+)?/g)||[255,255,255]).slice(0,3).map(Number);
 return `rgb(${n.map(x=>Math.round(x+(255-x)*k)).join(',')})`;
};
function path(ctx:CanvasRenderingContext2D,s:Shape,scale:number,cx:number,cy:number){
 const at=(p:Pt)=>[cx+p[0]*scale,cy+p[1]*scale] as Pt;
 ctx.beginPath();
 s.palm.forEach((p,i)=>{const [x,y]=at(p);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.closePath();
 for(const line of s.strokes)line.forEach((p,i)=>{const [x,y]=at(p);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});
}
const cache=new Map<string,HTMLCanvasElement>();
/** A glowing hand silhouette for one pose in one colour, square and centred, drawn once and reused. */
export function handSprite(color:string,pose:Exclude<HandKind,'none'>,size=256):HTMLCanvasElement{
 const key=`${color}|${pose}|${size}`,hit=cache.get(key);if(hit)return hit;
 const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d')!,s=shapes[pose],scale=size*.34,cx=size/2,cy=size*.52,w=s.width*scale;
 const stroke=(width:number)=>{path(ctx,s,scale,cx,cy);ctx.lineWidth=width;ctx.lineJoin=ctx.lineCap='round';ctx.stroke();ctx.fill();};
 ctx.fillStyle=ctx.strokeStyle=mix(color,.45);ctx.shadowColor=color;ctx.shadowBlur=size*.07;stroke(w+size*.035);
 ctx.shadowBlur=0;ctx.globalCompositeOperation='destination-out';ctx.globalAlpha=.82;ctx.fillStyle=ctx.strokeStyle='#000';stroke(w-size*.01);
 ctx.globalCompositeOperation='source-over';ctx.globalAlpha=.3;ctx.fillStyle=ctx.strokeStyle=color;stroke(w-size*.01);
 ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.shadowColor=color;ctx.shadowBlur=size*.05;
 for(const [x,y] of s.tips){ctx.beginPath();ctx.arc(cx+x*scale,cy+y*scale,size*.022,0,7);ctx.fill();}
 cache.set(key,c);return c;
}
