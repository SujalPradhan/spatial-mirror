import './screen.css';
import QRCode from 'qrcode';
import {Vector3} from 'three';
import {workspaceNav} from '../workspace-nav';
import {AtpView} from '../atp/view';
import {AtpEngine} from '../atp/engine';
import {homeView} from '../atp/model';
import type {AtpScene} from '../atp/contracts';
import {PartyGame,GOAL,ROUND_SECONDS,STEP_DEGREES,type GameEvent,type Mode,type PartyPlayer} from './game';
import {PartyAudio} from './party-audio';
import {PartySocket,createParty,joinLink,streamUrl,type PartyInfo,type Wire} from './net';

const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const params=new URLSearchParams(location.search);
const clampInt=(v:string|null,min:number,max:number,fallback:number)=>{const n=Number(v);return v&&Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):fallback;};
const roundSeconds=clampInt(params.get('round'),5,ROUND_SECONDS,ROUND_SECONDS),goalOverride=clampInt(params.get('goal'),3,GOAL,0);
const COUNTDOWN_MS=params.has('round')?1200:3000,HOLD_KEY='proton-party-host-v1';
const FLIGHT=.5,MAX_FLYERS=120,BROADCAST_MS=500;
const clock=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

$('#app').innerHTML=`<main class="pp-screen is-lobby" id="pp-screen">${workspaceNav()}
<section class="pp-stage" id="pp-stage" aria-label="Proton Party big screen">
 <div class="pp-glow" id="pp-glow"></div>
 <div class="pp-viewport" id="pp-viewport" aria-hidden="true"></div>
 <canvas class="pp-fx" id="pp-fx" aria-hidden="true"></canvas>
 <header class="pp-top">
  <h1 class="pp-brand">Proton <b>Party</b></h1>
  <div class="pp-atp" aria-live="off"><output id="pp-atp">0</output><span>of <i id="pp-goal">100</i> ATP</span><div class="pp-bar"><i id="pp-fill"></i></div></div>
  <div class="pp-clock" id="pp-clock" aria-label="Time left">1:00</div>
 </header>
 <aside class="pp-join" id="pp-join"><canvas id="pp-qr" width="260" height="260" aria-label="QR code to join"></canvas><div class="pp-join-text"><span>Scan to play</span><strong id="pp-code">-----</strong><small><b id="pp-count">0</b> players</small></div></aside>
 <div class="pp-tug" id="pp-tug" hidden><div class="pp-meter pp-make"><span>Team Make</span><i id="pp-make"></i></div><div class="pp-meter pp-burn"><span>Team Burn</span><i id="pp-burn"></i></div></div>
 <ul class="pp-dots" id="pp-dots" aria-label="Players"></ul>
 <div class="pp-lobby" id="pp-lobby"><h2 id="pp-lobby-title">Scan the code and join!</h2><p id="pp-lobby-hint">Squeeze your hand, then open it to throw a proton. 8 protons turn the motor once.</p><div class="pp-levels" role="group" aria-label="Level"><button type="button" data-mode="make" aria-pressed="true">Level 1: Power it up</button><button type="button" data-mode="tug" aria-pressed="false">Level 2: Tug of war</button></div><button type="button" class="pp-start" id="pp-start">Start</button></div>
 <div class="pp-countdown" id="pp-countdown" hidden aria-live="assertive"></div>
 <div class="pp-results" id="pp-results" hidden role="dialog" aria-labelledby="pp-result-title"><h2 id="pp-result-title"></h2><div class="pp-result-atp"><output id="pp-result-atp">0</output><span>ATP made</span></div><p class="pp-mvp" id="pp-mvp"></p><button type="button" class="pp-start" id="pp-again">Play again</button></div>
 <p class="pp-status" id="pp-status" role="status"></p>
 <button type="button" class="pp-sound" id="pp-sound" aria-pressed="true">Sound on</button>
</section></main>`;

const root=$('#pp-screen'),stage=$('#pp-stage'),fx=$<HTMLCanvasElement>('#pp-fx'),ctx=fx.getContext('2d')!;
const view=new AtpView($('#pp-viewport')),engine=new AtpEngine(view),audio=new PartyAudio();
const game=new PartyGame({roundSeconds,goal:goalOverride||undefined});
const colours=new Map<string,string>(),dotEls=new Map<string,HTMLLIElement>();
let mode:Mode='make',phase:'lobby'|'countdown'|'play'|'results'='lobby',visualSteps=0,rotor=0,last=performance.now(),lastBroadcast=0,lastSecond=-1,glow=0,flash=0,shake=0,online=false,roster:PartyPlayer[]=[],viewReady=false;
interface Flyer {color:string;x0:number;y0:number;age:number;scored:boolean;curve:number;trail:{x:number;y:number}[]}
interface Pop {x:number;y:number;age:number;color:string;ring:boolean;text?:string;vx?:number;vy?:number;size?:number}
const flyers:Flyer[]=[],pops:Pop[]=[];
let party:PartyInfo|null=null,socket:PartySocket|null=null;

function status(text:string){$('#pp-status').textContent=text;}
function setPhase(next:typeof phase){
 phase=next;root.classList.remove('is-lobby','is-countdown','is-play','is-results');root.classList.add('is-'+next);
 $('#pp-lobby').hidden=next!=='lobby';$('#pp-results').hidden=next!=='results';
 $('#pp-tug').hidden=!(mode==='tug'&&(next==='play'||next==='results'));
 broadcast(true);
}
function snapshot(){
 const f=game.forces();
 return {phase:phase==='countdown'?'lobby':phase,atp:game.atp,goal:game.goal,left:phase==='play'?game.left():roundSeconds,mode,...(mode==='tug'?{make:f.make,burn:f.burn}:{})};
}
function broadcast(force=false){
 const now=performance.now();if(!force&&now-lastBroadcast<BROADCAST_MS)return;lastBroadcast=now;
 socket?.send({type:'state',state:snapshot()});
}

function renderDots(){
 const list=$('#pp-dots');$('#pp-count').textContent=String(roster.filter(p=>p.on).length);
 list.classList.toggle('is-crowd',roster.length>24);
 const keep=new Set(roster.map(p=>p.id));
 for(const [id,el] of dotEls)if(!keep.has(id)){el.remove();dotEls.delete(id);}
 for(const p of roster){
  let el=dotEls.get(p.id);
  if(!el){el=document.createElement('li');const dot=document.createElement('i'),name=document.createElement('span');el.append(dot,name);list.append(el);dotEls.set(p.id,el);}
  (el.firstChild as HTMLElement).style.background=p.color;el.style.setProperty('--c',p.color);(el.lastChild as HTMLElement).textContent=p.name;el.classList.toggle('is-off',!p.on);
  el.classList.toggle('is-burn',phase!=='lobby'&&mode==='tug'&&game.teamOf(p.id)==='burn');
 }
 if(!roster.length)status(online?'Waiting for the first player...':'');
 else if(phase==='lobby')status('');
}
function pulse(id:string){const el=dotEls.get(id);if(!el)return;el.classList.remove('is-pop');void el.offsetWidth;el.classList.add('is-pop');}

const tmp=new Vector3();
function project(x:number,y:number,z=0){tmp.set(x,y,z).project(view.camera);return {x:(tmp.x+1)/2*fx.clientWidth,y:(1-tmp.y)/2*fx.clientHeight};}
const pose=homeView();pose.y=-.7;pose.zoom=.9;
const ringPoint=()=>project(pose.x,pose.y-2);
const headPoint=()=>{const h=view.headPoint();return project(h.x,h.y,h.z);};

function spawnFlyer(id:string,scored:boolean){
 const w=fx.clientWidth,h=fx.clientHeight,n=Number(id)||0,side=n%2?1:-1,g=(n*2.399963)%1;
 flyers.push({color:colours.get(id)??'#fff',x0:side>0?w+30:-30,y0:h*(.18+.7*g),age:0,scored,curve:(g-.5)*h*.5,trail:[]});
 if(flyers.length>MAX_FLYERS)flyers.shift();
}
function handle(events:GameEvent[],from?:string){
 for(const e of events){
  if(e.type==='proton'){spawnFlyer(e.from,true);audio.throwNote();pulse(e.from);}
  else if(e.type==='burn'){pulse(e.from);audio.burn();visualSteps=Math.max(0,visualSteps-1);const p=headPoint();pops.push({x:p.x,y:p.y,age:0,color:'#ff8a3d',ring:true});}
  else if(e.type==='atp'){
   const p=headPoint();
   if(e.delta>0){
    const color=e.to?colours.get(e.to)??'#ffd27a':'#ffd27a',who=roster.find(r=>r.id===e.to);
    pops.push({x:p.x,y:p.y,age:0,color,ring:false,text:who?`+1 ATP · ${who.name}`:'+1 ATP',vx:(Math.random()-.5)*60,vy:-90,size:38});
    if(e.to){socket?.send({type:'catch',to:e.to,n:1});pulse(e.to);}
    audio.ding();flash=1;glow=Math.min(1.4,glow+.35);
   }else pops.push({x:p.x,y:p.y,age:0,color:'#ff8a3d',ring:false,text:'-1 ATP',vx:0,vy:60,size:26});
  }else if(e.type==='end')finishRound(e.won);
 }
 void from;
}
function confetti(n=160){
 const w=fx.clientWidth,h=fx.clientHeight,palette=roster.length?roster.map(p=>p.color):['#ff4d6d','#ffb703','#2ee6a6','#3aa8ff'];
 for(let i=0;i<n;i++)pops.push({x:w*(.15+.7*Math.random()),y:h*.25,age:0,color:palette[i%palette.length],ring:false,vx:(Math.random()-.5)*900,vy:-Math.random()*700-100,size:6+Math.random()*8});
}
function finishRound(won:boolean){
 const r=game.results!;setPhase('results');
 $('#pp-result-title').textContent=won?(r.mode==='tug'?'Team Make wins!':'You did it!'):(r.mode==='tug'?'Team Burn holds on!':"Time's up!");
 $('#pp-result-atp').textContent=String(r.atp);
 const mvp=$('#pp-mvp');mvp.replaceChildren();
 if(r.mvp){const dot=document.createElement('i');dot.style.background=r.mvp.color;const name=document.createElement('b');name.textContent=r.mvp.name;mvp.append('MVP thrower ',dot,name,` · ${r.mvp.threw} protons`);}
 else mvp.textContent=r.atp?'Great teamwork!':'Nobody threw a proton. Try again!';
 if(won){confetti(220);flash=2;audio.fanfare();}else audio.wah();
}
const sendTeam=(id:string)=>socket?.send({type:'state',to:id,state:{phase:'play',team:game.teamOf(id)}});
function startRound(){
 if(phase!=='lobby'&&phase!=='results')return;
 void audio.start();
 mode=$<HTMLButtonElement>('.pp-levels [aria-pressed=true]').dataset.mode as Mode;
 setPhase('countdown');$('#pp-countdown').hidden=false;
 let n=3;const show=()=>{$('#pp-countdown').textContent=n>0?String(n):'GO!';audio.tick(n===0);};
 show();
 const timer=setInterval(()=>{
  n--;show();
  if(n<0){
   clearInterval(timer);$('#pp-countdown').hidden=true;
   game.setRoster(roster);game.start(mode);engine.reset();rotor=0;visualSteps=0;flyers.length=0;
   $('#pp-goal').textContent=String(game.goal);
   setPhase('play');
   if(mode==='tug')for(const p of roster)sendTeam(p.id);
   renderDots();status('');
  }
 },COUNTDOWN_MS/3);
}
function playAgain(){game.reset();engine.reset();rotor=0;visualSteps=0;pops.length=0;setPhase('lobby');$('#pp-lobby-title').textContent='Ready for another go?';renderDots();}

function onMessage(m:Wire){
 if(m.type==='roster'&&Array.isArray(m.players)){
  const wasOn=new Map(roster.map(p=>[p.id,p.on]));
  roster=m.players as PartyPlayer[];for(const p of roster)colours.set(p.id,p.color);game.setRoster(roster);renderDots();
  if(phase==='play'&&mode==='tug')for(const p of roster)if(p.on&&!wasOn.get(p.id))sendTeam(p.id);
  if(phase==='lobby'&&roster.length)$('#pp-lobby-title').textContent=`${roster.filter(p=>p.on).length} ready. Start when you are!`;
 }else if(m.type==='throw'&&typeof m.from==='string'){
  if(phase==='play')handle(game.throw(m.from));
  else if(phase==='lobby'){spawnFlyer(m.from,false);audio.throwNote();pulse(m.from);}
 }else if(m.type==='shake'&&typeof m.from==='string'&&phase==='play')handle(game.shake(m.from));
}
function connect(){
 socket?.close();
 socket=new PartySocket(()=>streamUrl(party!.code,{role:'host',token:party!.token}),onMessage,(on,final)=>{
  online=on;
  if(final){sessionStorage.removeItem(HOLD_KEY);status('This party ended. Reload to start a new one.');}
  else if(!on)status('Reconnecting...');else{status(roster.length?'':'Waiting for the first player...');broadcast(true);}
 });
}
async function boot(){
 let saved:PartyInfo|null=null;try{saved=JSON.parse(sessionStorage.getItem(HOLD_KEY)||'null');}catch{}
 if(saved&&saved.expiresAt>Date.now()&&/^[A-Z2-9]{5}$/.test(saved.code))party=saved;
 else{try{party=await createParty();sessionStorage.setItem(HOLD_KEY,JSON.stringify(party));}catch(e){status(e instanceof Error?e.message:'Could not start a party.');return;}}
 const info=party!;
 $('#pp-code').textContent=info.code;
 void QRCode.toCanvas($<HTMLCanvasElement>('#pp-qr'),joinLink(info.code),{width:260,margin:2,errorCorrectionLevel:'M',color:{dark:'#120a2e',light:'#ffffff'}});
 connect();
}

const rect=()=>{const r=stage.getBoundingClientRect(),d=Math.min(2,window.devicePixelRatio||1);if(fx.width!==Math.round(r.width*d)||fx.height!==Math.round(r.height*d)){fx.width=Math.round(r.width*d);fx.height=Math.round(r.height*d);}ctx.setTransform(fx.width/r.width,0,0,fx.height/r.height,0,0);};
function drawFx(dt:number){
 rect();const w=fx.clientWidth,h=fx.clientHeight;ctx.clearRect(0,0,w,h);ctx.globalCompositeOperation='lighter';
 const ring=ringPoint(),orbitR=Math.min(w,h)*.04;
 for(let i=flyers.length-1;i>=0;i--){
  const f=flyers[i];f.age+=dt;const t=Math.min(1,f.age/FLIGHT),e=t*t*(3-2*t);
  const cx=(f.x0+ring.x)/2,cy=Math.min(f.y0,ring.y)-Math.abs(f.curve)*.4+f.curve*.2;
  const x=(1-e)*(1-e)*f.x0+2*(1-e)*e*cx+e*e*ring.x,y=(1-e)*(1-e)*f.y0+2*(1-e)*e*cy+e*e*ring.y;
  f.trail.push({x,y});if(f.trail.length>14)f.trail.shift();
  f.trail.forEach((p,k)=>{const a=k/f.trail.length;ctx.fillStyle=f.color;ctx.globalAlpha=a*.75;ctx.beginPath();ctx.arc(p.x,p.y,orbitR*.2+a*orbitR*.45,0,7);ctx.fill();});
  const r=orbitR*(1.3-.4*e),g=ctx.createRadialGradient(x,y,0,x,y,r*2.2);g.addColorStop(0,'#fff');g.addColorStop(.25,f.color);g.addColorStop(1,'transparent');
  ctx.globalAlpha=1;ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r*2.2,0,7);ctx.fill();
  if(t>=1){
   flyers.splice(i,1);pops.push({x:ring.x,y:ring.y,age:0,color:f.color,ring:true});
   if(f.scored){visualSteps+=1;audio.plink();shake=1;}
  }
 }
 ctx.globalAlpha=1;
 for(let i=pops.length-1;i>=0;i--){
  const p=pops[i];p.age+=dt;
  if(p.ring){const t=p.age/.5;if(t>=1){pops.splice(i,1);continue;}ctx.globalAlpha=1-t;ctx.strokeStyle=p.color;ctx.lineWidth=6*(1-t)+1;ctx.beginPath();ctx.arc(p.x,p.y,orbitR*(1+t*3),0,7);ctx.stroke();continue;}
  if(p.text){
   const life=1.6;if(p.age>=life){pops.splice(i,1);continue;}
   p.y+=(p.vy??0)*dt;p.x+=(p.vx??0)*dt;ctx.globalCompositeOperation='source-over';ctx.globalAlpha=Math.min(1,(life-p.age)*1.5);
   ctx.font=`900 ${p.size??28}px ui-rounded,system-ui,sans-serif`;ctx.textAlign='center';ctx.lineWidth=6;ctx.strokeStyle='#120a2e';ctx.strokeText(p.text,p.x,p.y);ctx.fillStyle=p.color;ctx.fillText(p.text,p.x,p.y);ctx.globalCompositeOperation='lighter';continue;
  }
  const life=2.4;if(p.age>=life){pops.splice(i,1);continue;}
  p.vy=(p.vy??0)+900*dt;p.x+=(p.vx??0)*dt;p.y+=p.vy*dt;ctx.globalCompositeOperation='source-over';ctx.globalAlpha=Math.min(1,(life-p.age));ctx.fillStyle=p.color;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.age*6+(p.size??6));ctx.fillRect(-(p.size??6)/2,-(p.size??6)/4,p.size??6,(p.size??6)/2);ctx.restore();ctx.globalCompositeOperation='lighter';
 }
 ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
}

const emptyFrame={at:0,hands:[],events:[]};
function frame(now:number){
 const dt=Math.min(.05,(now-last)/1000);last=now;
 if(phase==='play'){
  handle(game.tick());
  const left=game.left();if(left!==lastSecond){lastSecond=left;if(left<=10&&left>0)audio.tick();}
 }
 const flying=flyers.some(f=>f.scored);if(!flying&&phase==='play'&&visualSteps!==game.steps)visualSteps=game.steps;
 const target=(phase==='lobby'?0:visualSteps)*STEP_DEGREES,delta=target-rotor;
 rotor+=Math.max(-120,Math.min(120,delta*(1-Math.exp(-dt*9))));
 if(viewReady){
  engine.seek(rotor);
  const out=engine.step(emptyFrame,dt,pose,false);
  const scene={...out.scene,sparks:out.scene.sparks.filter(s=>s.kind==='atp')} as AtpScene;
  view.setPose(pose);view.draw(scene,now);
 }
 const fill=Math.min(1,game.atp/game.goal);glow+=(fill-glow)*Math.min(1,dt*3);flash=Math.max(0,flash-dt*1.8);shake=Math.max(0,shake-dt*6);
 const glowEl=$('#pp-glow');glowEl.style.setProperty('--fill',glow.toFixed(3));glowEl.style.setProperty('--flash',Math.min(1,flash).toFixed(3));
 $('#pp-viewport').style.transform=shake?`scale(${1+shake*.012})`:'';
 const atp=phase==='results'&&game.results?game.results.atp:game.atp;
 $('#pp-atp').textContent=String(atp);$('#pp-fill').style.width=`${fill*100}%`;
 const clockEl=$('#pp-clock'),left=phase==='play'?game.left():roundSeconds;clockEl.textContent=clock(phase==='results'?0:left);clockEl.classList.toggle('is-low',phase==='play'&&left<=10);
 if(mode==='tug'&&phase==='play'){const f=game.forces();$('#pp-make').style.width=`${f.make}%`;$('#pp-burn').style.width=`${f.burn}%`;}
 if(phase==='play')broadcast();
 drawFx(dt);
 requestAnimationFrame(frame);
}

for(const b of document.querySelectorAll<HTMLButtonElement>('.pp-levels button'))b.onclick=()=>{for(const o of document.querySelectorAll('.pp-levels button'))o.setAttribute('aria-pressed',String(o===b));mode=b.dataset.mode as Mode;};
$('#pp-start').onclick=startRound;$('#pp-again').onclick=()=>{void audio.start();playAgain();};
$('#pp-sound').onclick=e=>{const b=e.currentTarget as HTMLButtonElement,on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(on));b.textContent=on?'Sound on':'Sound off';audio.setMuted(!on);void audio.start();};
document.addEventListener('pointerdown',()=>void audio.start(),{once:true});
window.addEventListener('pagehide',()=>{socket?.close();view.dispose();audio.stop();});
void view.ready.then(()=>{viewReady=true;});
void boot();
requestAnimationFrame(frame);
(window as any).__protonParty={game,get code(){return party?.code??'';},get phase(){return phase;},get rotor(){return rotor;},get steps(){return visualSteps;},get engineAtp(){return engine.atp;},get roster(){return roster;},get ready(){return viewReady&&online;},get roundSeconds(){return roundSeconds;},get online(){return online;}};
