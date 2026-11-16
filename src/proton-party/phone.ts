import './phone.css';
import {TrackingCamera} from '../tracking/camera';
import {FlickDetector,SHAKE,motionSample} from './flick';
import {HandThrow} from './hand-throw';
import {PartySocket,streamUrl,type Wire} from './net';

const app=document.querySelector<HTMLElement>('#app')!;
const code=(new URLSearchParams(location.search).get('code')||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const RESUME=`proton-party-resume:${code}`,NO_HAND_MS=5000,MOTION_WAIT_MS=2500,THROW_GAP_MS=140;
type Motion={requestPermission?:()=>Promise<string>};
const asksPermission=typeof (window as unknown as {DeviceMotionEvent?:Motion}).DeviceMotionEvent?.requestPermission==='function';
const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
const needsTap=asksPermission&&ios;

app.innerHTML=`<main class="pj" id="pj" data-team="">
 <section class="pj-start" id="pj-start" hidden><button type="button" id="pj-go">Tap to play</button></section>
 <header class="pj-top"><span class="pj-me"><i id="pj-dot"></i><b id="pj-name">...</b></span><span class="pj-clock" id="pj-clock"></span></header>
 <h1 class="pj-say" id="pj-say">Getting ready...</h1>
 <button type="button" class="pj-proton" id="pj-proton" aria-label="Throw a proton"><span></span></button>
 <p class="pj-sub" id="pj-sub"></p>
 <div class="pj-cam" id="pj-cam" hidden><video id="pj-video" playsinline muted autoplay></video><canvas id="pj-hand"></canvas></div>
 <p class="pj-score" id="pj-score" aria-live="off">You threw <b id="pj-threw">0</b>, caught <b id="pj-caught">0</b></p>
 <div class="pj-catch" id="pj-catch" aria-hidden="true"><b>ATP!</b><span id="pj-catch-n">+1</span></div>
 <div class="pj-over" id="pj-over" hidden><b>This party is over.</b><span>Scan the big screen again to join the next one.</span></div>
</main>`;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const main=$('pj'),proton=$<HTMLButtonElement>('pj-proton'),say=$('pj-say'),sub=$('pj-sub');
let threw=0,caught=0,team:'make'|'burn'='make',phase:'lobby'|'play'|'results'='lobby',hostOn=false,online=false,started=false,gyroOn=false,motionSeen=false,camStart=0,lastHand=-Infinity,lastThrow=-Infinity,lastPhase='';
const flick=new FlickDetector(),shaker=new FlickDetector(SHAKE),handThrow=new HandThrow(),video=$<HTMLVideoElement>('pj-video'),overlay=$<HTMLCanvasElement>('pj-hand');
let camera:TrackingCamera|null=null,socket:PartySocket|null=null,wake:{release():Promise<void>}|null=null;

function setColor(color:string){main.style.setProperty('--c',color);$('pj-dot').style.background=color;}
function buzz(pattern:number|number[]){try{navigator.vibrate?.(pattern);}catch{}}
function cameraOn(){return !!camera?.stream;}
const handRecent=()=>cameraOn()&&performance.now()-Math.max(camStart,lastHand)<NO_HAND_MS;
function instruction(){
 if(!hostOn||!online)return;
 if(phase==='results'){say.textContent='Round over!';sub.textContent='Look at the big screen.';return;}
 const burn=team==='burn'&&phase==='play';
 const verb=burn?'BURN':'THROW';
 if(handRecent())say.textContent=burn?'Squeeze your hand, then open it to BURN!':'Squeeze your hand, then open it to THROW!';
 else if(gyroOn&&motionSeen)say.textContent=burn?'Shake your phone to BURN!':'Flick your phone to THROW!';
 else say.textContent=`Tap the proton to ${verb}!`;
 sub.textContent=phase==='lobby'?'Practice now. The game starts soon.':burn?'Team Burn: spend ATP to turn the motor back!':team==='make'&&started&&cameraOn()&&!handRecent()?'Hold a hand up to the camera, or flick your phone.':'';
}
function throwIt(){
 const now=performance.now();if(now-lastThrow<THROW_GAP_MS)return;lastThrow=now;
 const sent=socket?.send({type:team==='burn'&&phase==='play'?'shake':'throw'});
 if(!sent)return;
 if(phase==='play')threw++;
 $('pj-threw').textContent=String(threw);buzz(25);
 proton.classList.remove('is-throw');void proton.offsetWidth;proton.classList.add('is-throw');
}
function showCatch(n:number){
 caught+=n;$('pj-caught').textContent=String(caught);$('pj-catch-n').textContent=n>1?`+${n}`:'+1';
 const el=$('pj-catch');el.classList.remove('is-on');void el.offsetWidth;el.classList.add('is-on');buzz([70,40,90]);
}
function onMessage(m:Wire){
 if(m.type==='welcome'){
  setColor(String(m.color));$('pj-name').textContent=String(m.name);hostOn=m.host===true;
  try{sessionStorage.setItem(RESUME,String(m.resume));}catch{}
  instruction();paint();
 }else if(m.type==='host'){hostOn=m.on===true;paint();}
 else if(m.type==='state'&&m.state&&typeof m.state==='object'){
  const s=m.state as {phase?:string;left?:number;team?:'make'|'burn'};
  if(s.team)team=s.team;
  if(s.phase==='play'||s.phase==='lobby'||s.phase==='results')phase=s.phase;
  if(phase!==lastPhase){if(phase==='play'&&lastPhase!=='play'){threw=0;caught=0;$('pj-threw').textContent='0';$('pj-caught').textContent='0';}if(phase==='lobby')team='make';lastPhase=phase;}
  main.dataset.team=phase==='play'&&s.team?s.team:main.dataset.team||'';
  $('pj-clock').textContent=phase==='play'&&typeof s.left==='number'?`${s.left}s`:'';
  main.classList.toggle('is-play',phase==='play');main.classList.toggle('is-results',phase==='results');
  instruction();
 }else if(m.type==='catch')showCatch(Number(m.n)||1);
}
function paint(){
 main.classList.toggle('is-waiting',!hostOn||!online);
 if(!online){say.textContent='Reconnecting...';sub.textContent='';}
 else if(!hostOn){say.textContent='Waiting for the big screen...';sub.textContent='Stay on this page.';}
 else instruction();
}
function connect(){
 let resume='';try{resume=sessionStorage.getItem(RESUME)||'';}catch{}
 socket=new PartySocket(()=>{let key=resume;try{key=sessionStorage.getItem(RESUME)||key;}catch{}return streamUrl(code,{role:'player',...(key?{resume:key}:{})});},onMessage,(on,final)=>{
  online=on;
  if(final){$('pj-over').hidden=false;socket?.close();return;}
  paint();
 });
}

function onMotion(e:DeviceMotionEvent){
 const s=motionSample(e,performance.now());
 if(s.rot||s.lin||s.grav)motionSeen=true;
 if(!gyroOn||handRecent())return;
 if(team==='burn'&&phase==='play'?shaker.feed(s):flick.feed(s))throwIt();
}
async function startMotion(permission:Promise<string>|null){
 try{if(permission&&await permission!=='granted')return;}catch{return;}
 gyroOn=true;window.addEventListener('devicemotion',onMotion);
 setTimeout(()=>{if(!motionSeen){gyroOn=false;instruction();}},MOTION_WAIT_MS);
}
async function startCamera(){
 try{
  camera=new TrackingCamera(video,overlay,true,(hands,meta)=>{
   const t=meta.sourceTimeMs;
   if(hands.length)lastHand=performance.now();
   if(handThrow.feed(hands,t))throwIt();
  },()=>{});
  camera.interactive=true;camStart=performance.now();$('pj-cam').hidden=false;
  await camera.start();
  if(!camera.stream){$('pj-cam').hidden=true;camera=null;}
 }catch{$('pj-cam').hidden=true;camera=null;}
 instruction();
}
async function begin(){
 if(started)return;started=true;
 const Motion=(window as unknown as {DeviceMotionEvent?:Motion}).DeviceMotionEvent;
 // Both permission prompts start inside the tap, before anything is awaited.
 const permission=needsTap&&Motion?.requestPermission?Motion.requestPermission():null;
 const cam=startCamera(),motion=startMotion(permission);
 $('pj-start').hidden=true;
 try{(navigator as unknown as {wakeLock?:{request(t:string):Promise<{release():Promise<void>}>}}).wakeLock?.request('screen').then(w=>{wake=w;}).catch(()=>{});}catch{}
 await Promise.allSettled([cam,motion]);
 instruction();
}

if(!/^[A-HJ-NP-Z2-9]{5}$/.test(code)){
 say.textContent='Scan the QR code on the big screen.';$('pj-proton').hidden=true;$('pj-score').hidden=true;
}else{
 proton.addEventListener('pointerdown',e=>{e.preventDefault();throwIt();});
 proton.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();throwIt();}});
 connect();
 if(needsTap){$('pj-start').hidden=false;$('pj-go').addEventListener('click',()=>void begin());}
 else void begin();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&wake===null&&started)try{(navigator as unknown as {wakeLock?:{request(t:string):Promise<{release():Promise<void>}>}}).wakeLock?.request('screen').then(w=>{wake=w;}).catch(()=>{});}catch{}});
 window.addEventListener('pagehide',()=>{socket?.close();camera?.stop();void wake?.release();});
 (window as unknown as Record<string,unknown>).__protonPhone={get threw(){return threw;},get caught(){return caught;},get phase(){return phase;},get online(){return online&&hostOn;},get camera(){return cameraOn();},get gyro(){return gyroOn;},get say(){return say.textContent;},get team(){return team;},drop(){socket?.drop();}};
}
