/** The magnified burette scale: marks every 0.1 cm3, the curved liquid surface, and no number for the reading itself. */
const WINDOW=3.6,TUBE_LEFT=78,TUBE_RIGHT=232;
export function drawLens(c:CanvasRenderingContext2D,w:number,h:number,reading:number|null,aids:boolean){
 c.clearRect(0,0,w,h);
 c.fillStyle='#f6f8fb';c.fillRect(0,0,w,h);
 const centre=reading===null?25:Math.max(WINDOW/2,Math.min(50-WINDOW/2,Math.round(reading))),top=centre-WINDOW/2,scale=h/WINDOW;
 const y=(v:number)=>(v-top)*scale;
 // Liquid sits below its surface, which curves up at the glass: the reading is the lowest point of the curve.
 if(reading!==null){
  const yl=y(reading),rise=.16*scale;
  c.beginPath();c.moveTo(TUBE_LEFT,h);c.lineTo(TUBE_LEFT,yl-rise);
  c.quadraticCurveTo((TUBE_LEFT+TUBE_RIGHT)/2,yl+rise,TUBE_RIGHT,yl-rise);c.lineTo(TUBE_RIGHT,h);c.closePath();
  c.fillStyle='#bfdcf3';c.fill();
  c.beginPath();c.moveTo(TUBE_LEFT,yl-rise);c.quadraticCurveTo((TUBE_LEFT+TUBE_RIGHT)/2,yl+rise,TUBE_RIGHT,yl-rise);
  c.strokeStyle='#17324f';c.lineWidth=2.5;c.stroke();
  if(aids){
   c.setLineDash([5,4]);c.strokeStyle='#b4232a';c.lineWidth=1.4;c.beginPath();c.moveTo(0,yl);c.lineTo(w,yl);c.stroke();c.setLineDash([]);
  }
 }
 c.strokeStyle='#6c7c8c';c.lineWidth=2;c.beginPath();c.moveTo(TUBE_LEFT,0);c.lineTo(TUBE_LEFT,h);c.moveTo(TUBE_RIGHT,0);c.lineTo(TUBE_RIGHT,h);c.stroke();
 c.fillStyle='#0d2238';c.strokeStyle='#0d2238';c.textAlign='right';c.textBaseline='middle';
 for(let k=Math.ceil(top*10);k<=Math.floor((top+WINDOW)*10);k++){
  const v=k/10,whole=k%10===0,half=k%5===0,yy=y(v);
  c.lineWidth=whole?2:1;c.beginPath();c.moveTo(TUBE_LEFT,yy);c.lineTo(TUBE_LEFT+(whole?54:half?38:22),yy);c.stroke();
  if(whole){c.font='700 18px system-ui,sans-serif';c.fillText(String(Math.round(v)),TUBE_LEFT-10,yy);}
  else if(aids&&half){c.font='600 12px system-ui,sans-serif';c.fillText(v.toFixed(1),TUBE_LEFT-10,yy);}
 }
 if(reading===null){c.fillStyle='#41536a';c.font='600 14px system-ui,sans-serif';c.textAlign='center';c.fillText('Burette empty',(TUBE_LEFT+TUBE_RIGHT)/2,h/2);}
}
