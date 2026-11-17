import './screen.css';
import QRCode from 'qrcode';
import {Euler,Quaternion,Vector3} from 'three';
import {workspaceNav} from '../workspace-nav';
import {AtpView} from '../atp/view';
import {AtpEngine} from '../atp/engine';
import {homeView} from '../atp/model';
import type {AtpScene} from '../atp/contracts';
import type {Quat} from '../types';
import {PartySocket,createParty,streamUrl,type PartyInfo,type Wire} from '../proton-party/net';
import {HOLD_MS,PullGate,applyHand,ghostAlpha,isActive,newTrack,rainRate,rotorSpeed,summarize,type Crowd,type HandKind,type HandTrack} from './crowd';
import {handSprite} from './glyphs';

const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const HOLD_KEY='many-hands-host-v1',PARTY_CHECK=/^[A-Z2-9]{5}$/;
const joinLink=(code:string)=>`${location.origin}/many-hands/join?code=${code}`;
const KINDS:{kind:Exclude<HandKind,'none'>;label:string;color:string}[]=[{kind:'open',label:'Open',color:'#5ad1ff'},{kind:'fist',label:'Grip',color:'#ffc861'},{kind:'pinch',label:'Pull',color:'#ff5fd2'}];

$('#app').innerHTML=`<main class="mh-screen" id="mh-screen">${workspaceNav()}
<section class="mh-stage" id="mh-stage" aria-label="Many Hands shared screen">
 <div class="mh-glow" id="mh-glow"></div>
 <div class="mh-viewport" id="mh-viewport"></div>
 <canvas class="mh-fx" id="mh-fx" aria-hidden="true"></canvas>
 <header class="mh-top"><h1>Many <b>Hands</b></h1><p>Your phone's hand tracking is moving this screen</p></header>
 <aside class="mh-panel" aria-label="Crowd">
  <div class="mh-count"><output id="mh-hands">0</output><span id="mh-hands-label">hands in</span></div>
  <small id="mh-joined">Nobody has joined yet</small>
  <ul class="mh-meters">${KINDS.map(k=>`<li data-kind="${k.kind}" style="--m:${k.color}"><canvas width="64" height="64" aria-hidden="true"></canvas><div><span><b>${k.label}</b><output>0%</output></span><div class="mh-bar"><i></i>${k.kind==='pinch'?'<em aria-hidden="true"></em>':''}</div></div></li>`).join('')}</ul>
  <p class="mh-state" id="mh-state">Together</p>
 </aside>
 <aside class="mh-join" id="mh-join"><canvas id="mh-qr" width="260" height="260" aria-label="QR code to join"></canvas><div class="mh-join-text"><span>Scan and hold up your hand</span><strong id="mh-code">-----</strong><button type="button" id="mh-hide" aria-pressed="false">Hide QR</button></div></aside>
 <ul class="mh-toasts" id="mh-toasts" aria-live="polite"></ul>
 <p class="mh-status" id="mh-status" role="status"></p>
</section></main>`;

const stage=$('#mh-stage'),viewport=$('#mh-viewport'),fx=$<HTMLCanvasElement>('#mh-fx'),ctx=fx.getContext('2d')!;
const view=new AtpView(viewport),engine=new AtpEngine(view),gate=new PullGate();
const pose=homeView();pose.y=-.5;pose.zoom=1.12;
const tracks=new Map<string,HandTrack>();
interface Ghost {sx:number;sy:number;born:number;shown:Exclude<HandKind,'none'>;prev:Exclude<HandKind,'none'>;morphAt:number;phase:number;seen:boolean}
const ghosts=new Map<string,Ghost>();
interface Drop {color:string;x0:number;y0:number;age:number;wob:number;px:number;py:number}
const drops:Drop[]=[];
interface Pop {x:number;y:number;age:number;color:string}
const pops:Pop[]=[];
let party:PartyInfo|null=null,socket:PartySocket|null=null,online=false,viewReady=false,last=performance.now(),rotor=0,speed=0,rainAcc=0,seeded=false,atpSeen=0;
let crowd:Crowd=summarize([],0),meters={open:0,fist:0,pinch:0},grip=0,lastLabels='',shown={n:-1,joined:-1,state:''};
const frames:number[]=[],work:number[]=[];
const known=new Set<string>();let joinedNames:string[]=[],joinTimer:ReturnType<typeof setTimeout>|undefined;

function status(text:string){$('#mh-status').textContent=text;}
function toast(text:string){
 const list=$('#mh-toasts'),li=document.createElement('li');li.textContent=text;list.append(li);
 while(list.children.length>4)list.firstElementChild!.remove();
 setTimeout(()=>li.classList.add('is-out'),2600);setTimeout(()=>li.remove(),3100);
}
function flushJoins(){
 joinTimer=undefined;const names=joinedNames;joinedNames=[];
 if(names.length>3)toast(`+ ${names.length} joined`);else for(const n of names)toast(`+ ${n} joined`);
}
function onRoster(players:{id:string;name:string;color:string;on:boolean}[]){
 const now=performance.now();
 for(const p of players){
  let t=tracks.get(p.id);
  if(!t){t=newTrack(p.id,p.name,p.color);tracks.set(p.id,t);}
  t.name=p.name;t.color=p.color;
  if(!p.on&&t.pose!=='none'){t.pose='none';t.lastActive=Math.min(t.lastActive,now-HOLD_MS);}
  if(!known.has(p.id)){known.add(p.id);if(seeded){joinedNames.push(p.name);joinTimer??=setTimeout(flushJoins,350);}}
 }
 seeded=true;
}
function onMessage(m:Wire){
 if(m.type==='roster'&&Array.isArray(m.players))onRoster(m.players as {id:string;name:string;color:string;on:boolean}[]);
 else if(m.type==='hand'&&typeof m.from==='string'){
  let t=tracks.get(m.from);if(!t){t=newTrack(m.from,'','#ffffff');tracks.set(m.from,t);}
  applyHand(t,{x:Number(m.x),y:Number(m.y),pose:m.pose as HandKind,c:Number(m.c)},performance.now());
 }
}
function connect(){
 socket?.close();seeded=false;
 socket=new PartySocket(()=>streamUrl(party!.code,{role:'host',token:party!.token}),onMessage,(on,final)=>{
  online=on;seeded=false;
  if(final){sessionStorage.removeItem(HOLD_KEY);status('This session ended. Reload to start a new one.');}
  else if(!on)status('Reconnecting...');else status('');
 });
}
async function boot(){
 let saved:PartyInfo|null=null;try{saved=JSON.parse(sessionStorage.getItem(HOLD_KEY)||'null');}catch{}
 if(saved&&saved.expiresAt>Date.now()&&PARTY_CHECK.test(saved.code))party=saved;
 else{try{party=await createParty();sessionStorage.setItem(HOLD_KEY,JSON.stringify(party));}catch(e){status(e instanceof Error?e.message:'Could not start. Try again.');return;}}
 $('#mh-code').textContent=party!.code;
 void QRCode.toCanvas($<HTMLCanvasElement>('#mh-qr'),joinLink(party!.code),{width:260,margin:2,errorCorrectionLevel:'M',color:{dark:'#120a2e',light:'#ffffff'}});
 connect();
}

const tmp=new Vector3(),qtmp=new Quaternion();
function project(x:number,y:number,z=0){tmp.set(x,y,z).project(view.camera);return {x:(tmp.x+1)/2*fx.clientWidth,y:(1-tmp.y)/2*fx.clientHeight};}
function channel(y:number){
 tmp.set(0,y,0).applyQuaternion(qtmp.fromArray(pose.q).normalize()).multiplyScalar(pose.zoom);
 return project(tmp.x+pose.x,tmp.y+pose.y);
}
const headPoint=()=>{const h=view.headPoint();return project(h.x,h.y,h.z);};

const sprites=new Map<string,HTMLCanvasElement>();
function glow(color:string){
 let c=sprites.get(color);if(c)return c;
 c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d')!,r=g.createRadialGradient(32,32,0,32,32,32);
 r.addColorStop(0,'#fff');r.addColorStop(.22,color);r.addColorStop(1,'transparent');g.fillStyle=r;g.fillRect(0,0,64,64);sprites.set(color,c);return c;
}
const LABEL_SCALE=2,labels=new Map<string,HTMLCanvasElement>();
function label(text:string,color:string,fs:number){
 const key=`${fs}|${color}|${text}`,hit=labels.get(key);if(hit)return hit;
 const c=document.createElement('canvas'),g=c.getContext('2d')!,font=`800 ${fs*LABEL_SCALE}px ui-rounded,system-ui,sans-serif`;
 g.font=font;const w=Math.ceil(g.measureText(text).width+16*LABEL_SCALE),h=Math.ceil(fs*LABEL_SCALE*1.5);c.width=w;c.height=h;
 g.font=font;g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';g.lineWidth=5*LABEL_SCALE;g.strokeStyle='rgba(10,5,30,.9)';g.strokeText(text,w/2,h/2);g.fillStyle=color;g.fillText(text,w/2,h/2);
 if(labels.size>400)labels.clear();labels.set(key,c);return c;
}
const ease=(t:number)=>{const c=Math.max(0,Math.min(1,t));return c*c*(3-2*c);};

function resize(){
 const r=stage.getBoundingClientRect(),d=Math.min(2,window.devicePixelRatio||1);
 if(fx.width!==Math.round(r.width*d)||fx.height!==Math.round(r.height*d)){fx.width=Math.round(r.width*d);fx.height=Math.round(r.height*d);}
 ctx.setTransform(fx.width/r.width,0,0,fx.height/r.height,0,0);
}
function handSize(w:number,h:number,n:number){return Math.min(w,h)*.2*Math.max(.5,Math.min(1,Math.sqrt(10/Math.max(10,n))));}

function drawFx(dt:number,now:number){
 resize();const w=fx.clientWidth,h=fx.clientHeight;ctx.clearRect(0,0,w,h);ctx.globalCompositeOperation='lighter';
 const top=channel(-.9),bottom=channel(-3.4),ring=channel(-2.1),head=headPoint(),orbit=Math.min(w,h)*.035;
 const list:{t:HandTrack;g:Ghost;a:number;x:number;y:number}[]=[];
 const size=handSize(w,h,Math.max(crowd.n,ghosts.size)),open:HandTrack[]=[];
 for(const t of tracks.values()){
  if(t.lastActive===-Infinity)continue;
  const a=ghostAlpha(t,now);if(a<=.01){ghosts.delete(t.id);continue;}
  let g=ghosts.get(t.id);
  if(!g){g={sx:t.x,sy:t.y,born:now,shown:t.pose==='none'?'open':t.pose,prev:'open',morphAt:-1e9,phase:Math.random()*7,seen:true};ghosts.set(t.id,g);}
  g.sx+=(t.x-g.sx)*(1-Math.exp(-dt*9));g.sy+=(t.y-g.sy)*(1-Math.exp(-dt*9));
  if(t.pose!=='none'&&t.pose!==g.shown){g.prev=g.shown;g.shown=t.pose;g.morphAt=now;}
  list.push({t,g,a,x:g.sx*w,y:g.sy*h});
  if(isActive(t,now)&&t.pose==='open')open.push(t);
 }
 const crowded=list.length>12,res=size*Math.min(2,window.devicePixelRatio||1)>150?256:128,dim=Math.max(.6,1-list.length/90);
 for(const {t,a,x,y} of crowded?[]:list){
  if(!isActive(t,now))continue;
  const target=t.pose==='fist'?ring:t.pose==='pinch'?head:null;if(!target)continue;
  ctx.globalAlpha=.2*a;ctx.strokeStyle=t.color;ctx.lineWidth=2.5;
  ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo((x+target.x)/2,Math.min(y,target.y)-size*.2,target.x,target.y);ctx.stroke();
 }
 rainAcc+=rainRate(crowd)*dt;
 while(rainAcc>=1){
  rainAcc-=1;const t=open[Math.floor(Math.random()*open.length)];if(!t)break;const g=ghosts.get(t.id)!;
  if(drops.length<520)drops.push({color:t.color,x0:g.sx*w+(Math.random()-.5)*size*.5,y0:g.sy*h-size*.1,age:0,wob:Math.random()*6.28,px:g.sx*w,py:g.sy*h});
 }
 if(!open.length)rainAcc=0;
 const A=.55,B=.85,span=bottom.y-top.y;
 ctx.globalAlpha=1;
 for(let i=drops.length-1;i>=0;i--){
  const d=drops[i];d.age+=dt;const total=A+B;if(d.age>=total){drops.splice(i,1);continue;}
  let x:number,y:number,alpha=1;
  if(d.age<A){const e=ease(d.age/A);x=d.x0+(top.x-d.x0)*e;y=d.y0+(top.y-d.y0)*e-Math.sin(e*Math.PI)*size*.25;}
  else{const e=(d.age-A)/B;x=top.x+Math.sin(e*12+d.wob)*orbit*.9;y=top.y+span*e;alpha=1-Math.max(0,(e-.7)/.3);}
  const r=orbit*.7,s=glow(d.color);
  ctx.globalAlpha=.35*alpha;ctx.drawImage(s,d.px-r*.5,d.py-r*.5,r,r);
  ctx.globalAlpha=alpha;ctx.drawImage(s,x-r,y-r,r*2,r*2);d.px=x;d.py=y;
 }
 for(const {t,g,a,x,y} of list){
  const bob=Math.sin(now/650+g.phase)*size*.025,grow=ease((now-g.born)/350),morph=ease((now-g.morphAt)/260),live=isActive(t,now);
  const s=size*(.6+.4*grow)*(t.pose==='fist'&&live?.94:1),px=x-s/2,py=y-s*.55+bob;
  ctx.globalAlpha=a*dim*grow*(live?1:.7);
  if(morph<1&&!crowded){ctx.globalAlpha=a*dim*(1-morph)*.9;ctx.drawImage(handSprite(t.color,g.prev,res),px,py,s,s);ctx.globalAlpha=a*dim*morph;}
  ctx.drawImage(handSprite(t.color,g.shown,res),px,py,s,s);
 }
 ctx.globalCompositeOperation='source-over';
 const placed:{x:number;y:number;w:number;h:number}[]=[],fs=Math.round(Math.max(12,Math.min(22,size*.13)));
 const order=list.filter(l=>l.t.name).sort((p,q)=>q.g.born-p.g.born);let hidden=0;
 for(const {t,a,x,y} of order){
  const tag=label(t.name,t.color,fs),ly=y+size*.52,tw=tag.width/LABEL_SCALE,th=tag.height/LABEL_SCALE,box={x:x-tw/2,y:ly-th/2,w:tw,h:th};
  if(placed.some(p=>box.x<p.x+p.w&&box.x+box.w>p.x&&box.y<p.y+p.h&&box.y+box.h>p.y)){hidden++;continue;}
  placed.push(box);ctx.globalAlpha=Math.min(1,a*1.2);ctx.drawImage(tag,box.x,box.y,tw,th);
 }
 lastLabels=hidden?`+${hidden}`:'';
 ctx.globalCompositeOperation='lighter';
 if(grip>.02){
  const r=orbit*(5+5*grip),g=ctx.createRadialGradient(head.x,head.y,0,head.x,head.y,r);
  g.addColorStop(0,`rgba(255,226,150,${.5*grip})`);g.addColorStop(.4,`rgba(255,160,90,${.22*grip})`);g.addColorStop(1,'transparent');ctx.globalAlpha=1;ctx.fillStyle=g;ctx.beginPath();ctx.arc(head.x,head.y,r,0,7);ctx.fill();
 }
 for(let i=pops.length-1;i>=0;i--){
  const p=pops[i];p.age+=dt;const t=p.age/.7;if(t>=1){pops.splice(i,1);continue;}
  ctx.globalAlpha=(1-t)*.9;ctx.strokeStyle=p.color;ctx.lineWidth=5*(1-t)+1;ctx.beginPath();ctx.arc(p.x,p.y,orbit*(1+t*4),0,7);ctx.stroke();
 }
 ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
}

const emptyFrame={at:0,hands:[],events:[]};
const meterEls=new Map<string,{li:HTMLElement;bar:HTMLElement;out:HTMLOutputElement}>();
for(const li of document.querySelectorAll<HTMLElement>('.mh-meters li')){
 const kind=li.dataset.kind!,c=li.querySelector('canvas')!.getContext('2d')!;
 c.drawImage(handSprite(KINDS.find(k=>k.kind===kind)!.color,kind as 'open',64),0,0);
 meterEls.set(kind,{li,bar:li.querySelector('.mh-bar i')!,out:li.querySelector('output')!});
}
function frame(now:number){
 const t0=performance.now(),dt=Math.min(.05,(now-last)/1000);
 if(dt>0)frames.push(now-last);last=now;if(frames.length>600)frames.shift();
 crowd=summarize(tracks.values(),now);
 const target=rotorSpeed(crowd);speed+=(target-speed)*(1-Math.exp(-dt*2.2));
 rotor+=speed*dt;
 const torn=gate.update(crowd,now);if(viewReady&&torn!==engine.tornApart)engine.toggleTear();
 grip+=((crowd.n?crowd.gripShare:0)-grip)*(1-Math.exp(-dt*3));
 if(viewReady){
  engine.seek(rotor);
  const out=engine.step(emptyFrame,dt,pose,false);
  const scene={...out.scene,rotorSpeed:speed/360,sparks:out.scene.sparks.filter(s=>s.kind==='atp')} as AtpScene;
  view.setPose(pose);view.draw(scene,now);
  if(engine.atp>atpSeen&&grip>.15){const h=headPoint();pops.push({x:h.x,y:h.y,age:0,color:'#ffd27a'});}
  atpSeen=engine.atp;
 }
 const glowEl=$('#mh-glow');glowEl.style.setProperty('--grip',grip.toFixed(3));
 for(const k of ['open','fist','pinch'] as const){
  const share=k==='open'?crowd.openShare:k==='fist'?crowd.gripShare:crowd.pullShare;
  meters[k]+=(share-meters[k])*(1-Math.exp(-dt*6));
  const el=meterEls.get(k)!;el.bar.style.width=`${(meters[k]*100).toFixed(1)}%`;
  const text=`${Math.round(share*100)}%`;if(el.out.textContent!==text)el.out.textContent=text;
 }
 const joined=[...tracks.values()].filter(t=>t.name).length;
 if(shown.n!==crowd.n){shown.n=crowd.n;$('#mh-hands').textContent=String(crowd.n);$('#mh-hands-label').textContent=crowd.n===1?'hand in':'hands in';}
 if(shown.joined!==joined){shown.joined=joined;$('#mh-joined').textContent=joined?`${joined} joined`:'Nobody has joined yet';}
 const state=torn?'Pulled apart':'Together';if(shown.state!==state){shown.state=state;const el=$('#mh-state');el.textContent=state;el.classList.toggle('is-torn',torn);}
 drawFx(dt,now);
 work.push(performance.now()-t0);if(work.length>600)work.shift();
 requestAnimationFrame(frame);
}

let drag:{id:number;x:number;y:number;q:Quaternion}|null=null;
viewport.onpointerdown=e=>{if(e.button!==0)return;viewport.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,q:new Quaternion().fromArray(pose.q)};};
viewport.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;pose.q=new Quaternion().setFromEuler(new Euler((e.clientY-drag.y)*.006,(e.clientX-drag.x)*.006,0,'YXZ')).multiply(drag.q).normalize().toArray() as Quat;};
const endDrag=(e:PointerEvent)=>{if(drag?.id===e.pointerId){drag=null;if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);}};
viewport.onpointerup=endDrag;viewport.onpointercancel=endDrag;
viewport.addEventListener('wheel',e=>{e.preventDefault();pose.zoom=Math.max(.65,Math.min(2.5,pose.zoom*Math.exp(-e.deltaY*.001)));},{passive:false});
$('#mh-hide').onclick=e=>{const b=e.currentTarget as HTMLButtonElement,hide=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(hide));b.textContent=hide?'Show QR':'Hide QR';$('#mh-join').classList.toggle('is-hidden',hide);};
window.addEventListener('pagehide',()=>{socket?.close();view.dispose();});
void view.ready.then(()=>{viewReady=true;});
void boot();
requestAnimationFrame(frame);
const pct=(a:number[],p:number)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor(s.length*p))]:0;};
(window as any).__manyHands={
 get code(){return party?.code??'';},get ready(){return viewReady&&online;},get online(){return online;},
 get crowd(){return crowd;},get speed(){return speed;},get target(){return rotorSpeed(crowd);},get rotor(){return rotor;},get torn(){return engine.tornApart;},get explode(){return (engine as any).scene.explode as number;},
 get rain(){return rainRate(crowd);},get drops(){return drops.length;},get grip(){return grip;},get meters(){return meters;},get pose(){return pose;},get labelsHidden(){return lastLabels;},
 get hands(){const now=performance.now();return [...tracks.values()].map(t=>({id:t.id,name:t.name,pose:t.pose,x:t.x,y:t.y,alpha:ghostAlpha(t,now),sx:ghosts.get(t.id)?.sx??null,sy:ghosts.get(t.id)?.sy??null}));},
 perf(){const r={frames:frames.length,median:pct(frames,.5),p95:pct(frames,.95),workMedian:pct(work,.5),workP95:pct(work,.95)};frames.length=0;work.length=0;return r;},
};
