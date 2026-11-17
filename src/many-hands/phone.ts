import './phone.css';
import {TrackingCamera} from '../tracking/camera';
import {PartySocket,streamUrl,type Wire} from '../proton-party/net';
import {handSprite} from './glyphs';
import {HandReader,type HandOut} from './pose';
import type {HandKind} from './crowd';

const app=document.querySelector<HTMLElement>('#app')!;
const code=(new URLSearchParams(location.search).get('code')||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const RESUME=`many-hands-resume:${code}`,SEND_GAP_MS=100,BEAT_MS=400,MOVE_EPS=.012;
const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
const poses:{kind:Exclude<HandKind,'none'>;label:string;note:string}[]=[
 {kind:'open',label:'Open',note:'Rain protons'},
 {kind:'fist',label:'Fist',note:'Grip the rotor'},
 {kind:'pinch',label:'Pinch',note:'Pull it apart'},
];
const say:Record<HandKind,string>={none:'Hold up one hand',open:'Protons are raining',fist:'You are gripping the rotor',pinch:'You are pulling it apart'};

app.innerHTML=`<main class="mh" id="mh">
 <section class="mh-start" id="mh-start" hidden><button type="button" id="mh-go">Tap to join</button></section>
 <header class="mh-top"><span class="mh-me"><i id="mh-dot"></i><b id="mh-name">Joining...</b></span><span class="mh-link" id="mh-link">Connecting</span></header>
 <div class="mh-cam" id="mh-cam"><video id="mh-video" playsinline muted autoplay></video><canvas id="mh-overlay"></canvas><canvas class="mh-guide" id="mh-guide" width="256" height="256" aria-hidden="true"></canvas><p class="mh-off" id="mh-off" hidden>Allow the camera to join in.</p></div>
 <p class="mh-say" id="mh-say" aria-live="polite">Hold up one hand</p>
 <ul class="mh-poses" id="mh-poses">${poses.map(p=>`<li data-pose="${p.kind}"><canvas width="128" height="128" aria-hidden="true"></canvas><b>${p.label}</b><span>${p.note}</span></li>`).join('')}</ul>
 <div class="mh-over" id="mh-over" hidden><b>This session has ended.</b><span>Scan the shared screen again to join the next one.</span></div>
</main>`;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const main=$('mh'),sayEl=$('mh-say'),video=$<HTMLVideoElement>('mh-video'),overlay=$<HTMLCanvasElement>('mh-overlay');
let online=false,hostOn=false,started=false,color='#ffc861',shown:HandKind='none',sent=0;
let last:{pose:HandKind;x:number;y:number;at:number}|null=null;
const reader=new HandReader();
let camera:TrackingCamera|null=null,socket:PartySocket|null=null,wake:{release():Promise<void>}|null=null;

function paintIcons(){
 for(const li of document.querySelectorAll<HTMLLIElement>('#mh-poses li')){
  const kind=li.dataset.pose as Exclude<HandKind,'none'>,c=li.querySelector('canvas')!.getContext('2d')!;
  c.clearRect(0,0,128,128);c.drawImage(handSprite(shown===kind?color:'#ffffff',kind,128),0,0);li.classList.toggle('is-on',shown===kind);
 }
 $<HTMLCanvasElement>('mh-guide').getContext('2d')!.drawImage(handSprite('#ffffff','open'),0,0);
}
function setColor(value:string){color=value;main.style.setProperty('--c',value);$('mh-dot').style.background=value;paintIcons();}
function status(){
 $('mh-link').textContent=!online?'Reconnecting':hostOn?'Live':'Waiting for the big screen';
 main.classList.toggle('is-live',online&&hostOn);
 sayEl.textContent=online&&hostOn?say[shown]:online?'Waiting for the big screen...':'Reconnecting...';
}
function onMessage(m:Wire){
 if(m.type==='welcome'){
  setColor(String(m.color));$('mh-name').textContent=String(m.name);hostOn=m.host===true;last=null;
  try{sessionStorage.setItem(RESUME,String(m.resume));}catch{}
  status();
 }else if(m.type==='host'){hostOn=m.on===true;last=null;status();}
}
function connect(){
 socket=new PartySocket(()=>{let key='';try{key=sessionStorage.getItem(RESUME)||'';}catch{}return streamUrl(code,{role:'player',...(key?{resume:key}:{})});},onMessage,(on,final)=>{
  online=on;last=null;
  if(final){$('mh-over').hidden=false;socket?.close();return;}
  status();
 });
}
// A change goes out at once (at most ten a second); a held hand repeats about every 400 ms so its ghost stays.
function emit(out:HandOut,now:number){
 if(out.pose==='none'&&(!last||last.pose==='none'))return;
 const moved=!last||Math.hypot(out.x-last.x,out.y-last.y)>MOVE_EPS,changed=!last||out.pose!==last.pose;
 if(now-(last?.at??-Infinity)<SEND_GAP_MS)return;
 if(!changed&&!(moved&&out.pose!=='none')&&now-last!.at<BEAT_MS)return;
 const r=(n:number,d:number)=>Math.round(n*10**d)/10**d;
 if(socket?.send({type:'hand',x:r(out.x,3),y:r(out.y,3),pose:out.pose,c:r(out.c,2)})){last={pose:out.pose,x:out.x,y:out.y,at:now};sent++;}
}
function onHands(hands:readonly (readonly {x:number;y:number;z:number}[])[],meta:{sourceTimeMs:number;width:number;height:number}){
 const out=reader.feed(hands,meta.sourceTimeMs,meta.width/meta.height);
 if(out.pose!==shown){shown=out.pose;paintIcons();status();main.classList.toggle('has-hand',shown!=='none');}
 emit(out,performance.now());
}
async function startCamera(){
 try{
  camera=new TrackingCamera(video,overlay,true,(hands,meta)=>onHands(hands,meta),()=>{});
  camera.interactive=true;await camera.start();
  if(!camera.stream){camera=null;$('mh-off').hidden=false;}
 }catch{camera=null;$('mh-off').hidden=false;}
}
function begin(){
 if(started)return;started=true;$('mh-start').hidden=true;
 void startCamera();
 try{(navigator as unknown as {wakeLock?:{request(t:string):Promise<{release():Promise<void>}>}}).wakeLock?.request('screen').then(w=>{wake=w;}).catch(()=>{});}catch{}
}

if(!/^[A-HJ-NP-Z2-9]{5}$/.test(code)){
 sayEl.textContent='Scan the QR code on the shared screen.';$('mh-cam').hidden=true;$('mh-poses').hidden=true;
 main.insertAdjacentHTML('beforeend','<form class="mh-form" id="mh-form"><label for="mh-code">Or type the code from the shared screen</label><input id="mh-code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="submit">Join</button></form>');
 $('mh-form').addEventListener('submit',e=>{e.preventDefault();const value=$<HTMLInputElement>('mh-code').value.toUpperCase().replace(/[^A-Z0-9]/g,'');if(value)location.search='?code='+value;});
}else{
 paintIcons();connect();
 if(ios){$('mh-start').hidden=false;$('mh-go').addEventListener('click',begin);}else begin();
 window.addEventListener('pagehide',()=>{socket?.close();camera?.stop();void wake?.release();});
 (window as unknown as Record<string,unknown>).__manyHandsPhone={get pose(){return shown;},get online(){return online&&hostOn;},get camera(){return !!camera?.stream;},get sent(){return sent;},drop(){socket?.drop();}};
}
