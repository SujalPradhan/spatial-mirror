import {catchWindow,feedPose,hookAngle,needleTip,takeUp,TIMING} from './model';
import {SLOW,STROBE_HZ} from './behaviour';
import {machineParts} from './parts';
import type {MachineEngine} from './engine';

const W=330,H=210,LEFT=58,ROWS=4,ROW=(H-34)/ROWS,STEP=2;
const PER_SIDE=9,GOLD='#ffc861';
/** Played back at 60 frames a second, 50 times slower than life. */
const FILM_FPS=60*SLOW;
type Tag={id:string;title:string;role:string;x:number;y:number};
const curves=[
 {label:'needle',color:'#e8f6ff',at:(c:number)=>(needleTip(c)-needleTip(180))/(needleTip(0)-needleTip(180))},
 {label:'take-up',color:'#ffc861',at:(c:number)=>takeUp(c).lift},
 {label:'hook',color:'#ff9a3c',at:(c:number,o:number)=>hookAngle(c,o)/360},
 {label:'feed',color:'#7dffb0',at:(c:number)=>feedPose(c).y},
];
const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);

/** What the 3D view cannot say by itself: the speed, a timing diagram under the high-speed camera, a tension gauge, and the time-freeze labels. */
export class MachineHud {
 private readonly speed:HTMLElement;private readonly film:HTMLElement;private readonly filmText:HTMLElement;private readonly canvas:HTMLCanvasElement;private readonly ctx:CanvasRenderingContext2D;
 private readonly gauge:HTMLElement;private readonly marker:HTMLElement;private readonly frozen:HTMLElement;private readonly leaders:SVGSVGElement;private readonly labels:HTMLElement;private readonly clock:HTMLElement;private readonly lamp:HTMLElement;
 private said='';private labelled='';private window=catchWindow();
 constructor(stage:HTMLElement,private readonly engine:MachineEngine){
  stage.insertAdjacentHTML('beforeend',`<p class="machine-speed" hidden><b>0</b> stitches a minute<small></small></p>
<div class="machine-film" hidden><p></p><canvas width="${W}" height="${H}"></canvas></div>
<div class="machine-gauge" hidden><small>Top thread tension</small><i><b></b></i><span><em>slack</em><em>balanced</em><em>tight</em></span></div>
<div class="machine-lamp" aria-hidden="true"></div>
<div class="machine-freeze" hidden aria-hidden="true"><svg></svg><div></div><p class="machine-clock"></p></div>`);
  const $=<T extends Element>(s:string)=>stage.querySelector<T & HTMLElement>(s)!;
  this.speed=$('.machine-speed');this.film=$('.machine-film');this.filmText=$('.machine-film p');this.canvas=$('.machine-film canvas') as unknown as HTMLCanvasElement;
  const dpr=Math.min(2,window.devicePixelRatio||1);this.canvas.width=W*dpr;this.canvas.height=H*dpr;this.canvas.style.width=`${W}px`;this.canvas.style.height=`${H}px`;
  this.ctx=this.canvas.getContext('2d')!;this.ctx.scale(dpr,dpr);
  this.gauge=$('.machine-gauge');this.marker=$('.machine-gauge b');this.frozen=$('.machine-freeze');this.leaders=stage.querySelector('.machine-freeze svg')!;this.labels=$('.machine-freeze div');this.clock=$('.machine-clock');this.lamp=$('.machine-lamp');
 }
 update(){
  const m=this.engine.machine,s=this.engine.live;
  const spm=m.spm,show=Math.abs(spm)>=60||m.highSpeed>.5;this.speed.hidden=!show;
  if(show){const line=`${Math.abs(spm)}|${m.strobing}|${m.highSpeed>.5}|${spm<0}`;if(line!==this.said){this.said=line;this.speed.querySelector('b')!.textContent=String(Math.abs(spm));this.speed.querySelector('small')!.textContent=m.highSpeed>.5?`filmed at ${FILM_FPS} frames a second`:m.strobing?`strobe ${Math.round(STROBE_HZ*60)} flashes a minute`:spm<0?'backwards: unpicking':m.drawing?'stitch regulator: needle paced to your hand':'';}}
  // The strobe is shown as a steady lamp glow, never as flashes on screen.
  this.lamp.classList.toggle('is-on',m.strobing);
  this.film.hidden=m.highSpeed<.5;if(!this.film.hidden)this.diagram(s.machine.crank,s.options.hookTimingOffset,m.realMs);
  const t=s.tension;this.gauge.hidden=!t.held&&Math.abs(t.value-.5)<.03&&!t.broken;
  if(!this.gauge.hidden){this.marker.style.left=`${Math.min(100,t.value*100)}%`;this.gauge.classList.toggle('is-broken',t.broken);}
  this.frozen.hidden=!m.frozen;if(m.frozen)this.freeze(m.freezeLeft);else this.labelled='';
 }
 /** Crank angle across, one row per part, and a cursor where the crank stands now. */
 private diagram(crank:number,offset:number,ms:number){
  const g=this.ctx,deg=((crank%360)+360)%360,x=(d:number)=>LEFT+(d/360)*(W-LEFT-10);
  this.filmText.textContent=`×1/${SLOW} · ${(ms).toFixed(1)} ms real · crank ${Math.round(deg)}°`;
  g.clearRect(0,0,W,H);g.font='10px system-ui,sans-serif';g.textBaseline='middle';
  // The window in which the hook point can still find an open loop.
  const a=x(TIMING.catch+this.window.early),b=x(TIMING.catch+this.window.late);
  g.fillStyle='rgba(255,154,60,.16)';g.fillRect(a,4,Math.max(2,b-a),ROWS*ROW);
  g.strokeStyle='rgba(255,255,255,.12)';g.lineWidth=1;
  for(const d of [0,90,180,270,360]){g.beginPath();g.moveTo(x(d),4);g.lineTo(x(d),ROWS*ROW+4);g.stroke();g.fillStyle='rgba(238,243,242,.5)';g.textAlign='center';g.fillText(`${d}°`,x(d),ROWS*ROW+14);}
  curves.forEach((c,i)=>{
   const top=4+i*ROW,y=(v:number)=>top+ROW-4-v*(ROW-10);
   g.fillStyle=c.color;g.textAlign='right';g.fillText(c.label,LEFT-8,top+ROW/2);
   g.strokeStyle=c.color;g.lineWidth=1.6;g.beginPath();
   // The hook turns twice a stitch, so its sawtooth breaks where it wraps.
   let last=NaN;for(let d=0;d<=360;d+=STEP){const v=c.at(d,offset);if(i===2&&v<last-.5)g.moveTo(x(d),y(v));else if(d)g.lineTo(x(d),y(v));else g.moveTo(x(d),y(v));last=v;}
   g.stroke();
   const v=c.at(deg,offset);g.fillStyle=c.color;g.beginPath();g.arc(x(deg),y(v),3.5,0,Math.PI*2);g.fill();
  });
  g.strokeStyle='#fff';g.lineWidth=1.2;g.beginPath();g.moveTo(x(deg),2);g.lineTo(x(deg),ROWS*ROW+6);g.stroke();
  g.fillStyle='rgba(255,154,60,.9)';g.textAlign='left';g.fillText('catch',a+2,4+2*ROW+7);
 }
 /** Every part on screen gets a gold leader to a label with its job, stacked in two columns. */
 private freeze(left:number){
  this.clock.textContent=`Time stopped · ${Math.ceil(left)} s`;
  const s=this.engine.live,w=this.labels.clientWidth||1,h=this.labels.clientHeight||1,sides:Tag[][]=[[],[]];
  for(const p of machineParts){
   if(s.hidden.has(p.id)||(s.fade[p.id]??1)<.3)continue;
   const at=this.engine.screenOf(p.id);if(at.x<.04||at.x>.96||at.y<.08||at.y>.86)continue;
   sides[at.x<.5?0:1].push({id:p.id,title:p.title,role:p.role,...at});
  }
  const key=sides.map(l=>l.map(p=>`${p.id}${Math.round(p.x*200)},${Math.round(p.y*200)}`).join()).join('|');if(key===this.labelled)return;this.labelled=key;
  let html='',lines='';
  sides.forEach((list,side)=>{
   list.sort((a,b)=>a.y-b.y);/* The right column ends above the corner controls, the left above the camera button. */const shown=list.slice(0,PER_SIDE),from=side?.2:.32,gap=((side?.72:.8)-from)/Math.max(1,shown.length-1);
   shown.forEach((p,i)=>{
    const ly=shown.length===1?Math.min(side?.72:.8,Math.max(from,p.y)):from+i*gap,edge=side?w*.985-230:w*.015+230;
    html+=`<p class="${side?'is-right':''}" style="top:${(ly*100).toFixed(2)}%"><b>${esc(p.title)}</b><small>${esc(p.role)}</small></p>`;
    lines+=`<path d="M${edge.toFixed(1)} ${(ly*h).toFixed(1)} L${(p.x*w).toFixed(1)} ${(p.y*h).toFixed(1)}"/><circle cx="${(p.x*w).toFixed(1)}" cy="${(p.y*h).toFixed(1)}" r="3.5"/>`;
   });
  });
  this.labels.innerHTML=html;this.leaders.setAttribute('viewBox',`0 0 ${w} ${h}`);this.leaders.innerHTML=lines;this.leaders.style.color=GOLD;
 }
}
