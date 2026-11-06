import {SLIDE_COUNT} from './protocol';

const INK='#eef2fb',DIM='#9aa6c2',ACCENT='#4da3ff',WARM='#ffb454',PANEL='#1a2138',LINE='#33406a',FONT='system-ui,-apple-system,"Segoe UI",sans-serif';
type Ctx=CanvasRenderingContext2D;
const text=(c:Ctx,s:string,x:number,y:number,size:number,colour=INK,weight=500,align:CanvasTextAlign='left')=>{c.font=`${weight} ${size}px ${FONT}`;c.fillStyle=colour;c.textAlign=align;c.textBaseline='middle';c.fillText(s,x,y);};
function panel(c:Ctx,x:number,y:number,w:number,h:number,title:string,lines:string[],edge=LINE,size=26){
 c.beginPath();c.roundRect(x,y,w,h,16);c.fillStyle=PANEL;c.fill();c.lineWidth=2.5;c.strokeStyle=edge;c.stroke();
 text(c,title,x+w/2,y+(lines.length?h*.3:h/2),size+2,INK,700,'center');
 lines.forEach((l,i)=>text(c,l,x+w/2,y+h*.3+(i+1)*(size+6),size-8,DIM,500,'center'));
}
function arrow(c:Ctx,x1:number,y1:number,x2:number,y2:number,colour=ACCENT,both=false){
 c.strokeStyle=colour;c.fillStyle=colour;c.lineWidth=4;c.lineCap='round';c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();
 const head=(x:number,y:number,a:number)=>{c.beginPath();c.moveTo(x,y);c.lineTo(x-16*Math.cos(a-.45),y-16*Math.sin(a-.45));c.lineTo(x-16*Math.cos(a+.45),y-16*Math.sin(a+.45));c.closePath();c.fill();};
 const a=Math.atan2(y2-y1,x2-x1);head(x2,y2,a);if(both)head(x1,y1,a+Math.PI);
}
const title=(c:Ctx,s:string)=>{text(c,s,64,70,48,INK,700);c.fillStyle=ACCENT;c.fillRect(64,108,96,6);};
function bullets(c:Ctx,x:number,y:number,items:string[],size=32,gap=64){items.forEach((s,i)=>{c.beginPath();c.arc(x,y+i*gap,7,0,Math.PI*2);c.fillStyle=ACCENT;c.fill();text(c,s,x+28,y+i*gap,size);});}
function hand(c:Ctx,cx:number,cy:number,s:number){
 const fingers=[[-.55,.1,-.9,-.5,-1.15,-.9],[-.28,-.2,-.35,-.8,-.4,-1.25],[0,-.28,0,-.9,0,-1.4],[.28,-.2,.32,-.8,.38,-1.25],[.52,.05,.8,-.4,1,-.7]];
 const pts:[number,number][]=[[0,.8]];c.strokeStyle=LINE;c.lineWidth=3;
 for(const f of fingers){const a=[f[0],f[1]],b=[f[2],f[3]],d=[f[4],f[5]],m=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  c.beginPath();c.moveTo(cx,cy+.8*s);c.lineTo(cx+a[0]*s,cy+a[1]*s);c.lineTo(cx+m[0]*s,cy+m[1]*s);c.lineTo(cx+b[0]*s,cy+b[1]*s);c.lineTo(cx+d[0]*s,cy+d[1]*s);c.stroke();pts.push([a[0],a[1]],[m[0],m[1]],[b[0],b[1]],[d[0],d[1]]);}
 pts.slice(0,21).forEach(([x,y],i)=>{c.beginPath();c.arc(cx+x*s,cy+y*s,i===0?9:6,0,Math.PI*2);c.fillStyle=i%4===0?WARM:ACCENT;c.fill();});
}
const slides:((c:Ctx)=>void)[]=[
 c=>{
  text(c,'Air ink for video calls',90,290,84,INK,800);text(c,'How it works',94,390,44,ACCENT,600);
  c.strokeStyle=WARM;c.lineWidth=7;c.lineCap='round';c.beginPath();c.moveTo(94,450);c.bezierCurveTo(240,400,360,500,520,440);c.stroke();
  text(c,'Draw in the air. Everyone on the call sees it.',94,540,30,DIM);
 },
 c=>{
  title(c,'The flow');
  panel(c,60,170,170,120,'Webcam',[],LINE,28);
  panel(c,290,150,360,160,'Camera interceptor',['runs in the call page,','draws camera + ink','on a hidden canvas'],ACCENT,28);
  panel(c,710,170,230,120,'Canvas video',['handed to the call'],LINE,28);
  panel(c,1000,170,220,120,'Everyone',['sees it'],LINE,28);
  arrow(c,232,230,288,230);arrow(c,652,230,708,230);arrow(c,942,230,998,230);
  panel(c,290,390,360,130,'Hidden tracker frame',['extension page','hand + selfie models'],WARM,28);
  arrow(c,470,312,470,388,WARM,true);text(c,'small frames  /  21 hand points',490,350,22,WARM,600,'left');
  panel(c,340,590,220,80,'Popup',[],LINE,26);panel(c,640,590,260,80,'Bridge script',[],LINE,26);panel(c,980,590,240,80,'Settings',[],LINE,26);
  arrow(c,562,630,638,630);arrow(c,902,630,978,630);
 },
 c=>{
  title(c,'Hand tracking');
  bullets(c,80,220,['21 points per hand','Runs locally in your browser','About 14 frames per second on CPU','Lives in a separate extension frame,','because call pages block outside scripts'],34,76);
  hand(c,1000,380,170);
 },
 c=>{
  title(c,'Gestures');
  const rows:[string,string][]=[['🤏','Pinch: draw'],['🤏🤏','Both pinch: zoom and pan the slide'],['✋','Swipe: next or previous slide'],['✌️','Hold: next colour'],['👎','Hold: undo'],['🤟','Hold: next background']];
  rows.forEach(([e,s],i)=>{const y=190+i*82;c.beginPath();c.roundRect(64,y-34,1150,68,12);c.fillStyle=PANEL;c.fill();text(c,e,100,y+2,40,INK,500);text(c,s,250,y,32);});
 },
 c=>{
  title(c,'Why the video is mirrored');
  bullets(c,80,220,['Air writing reads backwards to viewers','So the outgoing video is mirrored','Your own tile is flipped back','You see a normal mirror, they read the text']);
  panel(c,120,470,420,140,'Without',['viewers see reversed text'],LINE,30);panel(c,740,470,420,140,'With mirror',['text reads right'],ACCENT,30);
 },
 c=>{
  title(c,'Privacy and fallback');
  bullets(c,80,220,['Nothing leaves the browser','except the normal call video','Hand points are not stored or sent','Any failure falls back to the plain camera'],34,80);
 },
];
/** Draws slide n as vectors on a 1280 wide design, centred in the frame. */
export function drawSlide(c:Ctx,w:number,h:number,n:number){
 const i=((n%SLIDE_COUNT)+SLIDE_COUNT)%SLIDE_COUNT,s=w/1280,vh=h/s,oy=(vh-720)/2;
 c.save();c.scale(s,s);
 const g=c.createLinearGradient(0,0,1280,vh);g.addColorStop(0,'#0b1020');g.addColorStop(1,'#141c36');c.fillStyle=g;c.fillRect(0,0,1280,vh);
 c.translate(0,oy);slides[i](c);text(c,`${i+1} / ${SLIDE_COUNT}`,1220,690,24,DIM,500,'right');
 c.restore();
}
