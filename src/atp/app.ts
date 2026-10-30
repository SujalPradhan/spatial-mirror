import './style.css';
import {Euler,Quaternion} from 'three';
import {workspaceNav} from '../workspace-nav';
import {bindDocument} from '../documents';
import {ControlClient} from '../control';
import {getSession,hosted,webcamOnly} from '../session';
import {HandProbe} from '../hand-probe';
import type {Landmark} from '../fist';
import type {Packet,Quat} from '../types';
import type {AtpInputSource,AtpInputTarget,AtpState,GestureFrame} from './contracts';
import {gestureGuide,sources,scientificNote} from './content';
import {initialAtp,validateAtp,clampPhase,homeView} from './model';
import {AtpView} from './view';
import {AtpPhoneInput} from './input';
import {GestureTracker} from './gestures';
import {AtpEngine} from './engine';
import {AtpAudio} from './audio';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(id)!;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
document.title='ATP Synthase — Spatial Studio';
$('#app').innerHTML=`<main class="atp-page">${workspaceNav()}<section id="atp-stage" aria-label="ATP synthase, held in your hands"><video id="atp-video" playsinline muted></video><div id="atp-viewport" tabindex="0" aria-label="3D ATP synthase. Drag a chain to pluck it, drag elsewhere to turn, scroll to zoom, space to spin."></div><canvas id="atp-hand-overlay" hidden></canvas><h1 class="atp-mark">ATP <span>synthase</span></h1><p class="atp-count" aria-live="off"><output id="atp-count">0</output> ATP</p><button id="atp-camera" class="atp-enter">Step into the mirror</button><ul id="atp-gestures" aria-label="Gestures">${gestureGuide.map(g=>`<li data-gesture="${g.id}"><i aria-hidden="true">${g.glyph}</i>${g.label}</li>`).join('')}</ul><p id="atp-status" role="status"></p><div class="atp-corner"><button id="atp-freeze" hidden>Resume</button>${webcamOnly?'':'<button id="atp-phone">Connect phone</button>'}<button id="atp-sound" aria-pressed="true">Sound</button><button id="atp-recenter">Recenter</button><button id="atp-sources">About</button></div><div id="atp-loading" role="status">Loading the molecule…</div></section><dialog id="atp-about"><h2>A real molecule, in your hands</h2><p>${scientificNote}</p><p>Everything stays on this laptop: hand tracking runs in the browser and no video leaves it.</p><ul>${sources.map(s=>`<li><a href="${s.url}" target="_blank" rel="noopener">${s.label}</a></li>`).join('')}</ul><button id="atp-about-close">Back</button></dialog></main>`;
let state=initialAtp(),client:ControlClient|null=null,owns=false,playing=false,context=0,ready=false,muted=false;
let drag:{id:number;x:number;y:number;view:AtpState['view'];pluck:boolean}|null=null,lastFine=-Infinity,lastPublish=0,lastDescriptor='',spoken='';
let owner:AtpInputSource|null=null,before:AtpState|null=null,history:AtpState[]=[];
const empty=():GestureFrame=>({at:0,hands:[],events:[]});
const viewport=$('#atp-viewport'),view=new AtpView(viewport),engine=new AtpEngine(view),audio=new AtpAudio(),tracker=new GestureTracker();
let frame=empty(),lastHands=-Infinity;
function notice(s:string){if(s!==spoken)$('#atp-status').textContent=spoken=s;}
function angle(){return ((engine.rotorDegrees%360)+360)%360;}
// The relay validates a shared descriptor shape, so retired lesson fields stay as constants.
function descriptor(){return {enabled:!state.frozen,frozen:state.frozen,context,chapter:0,guided:false,tool:state.tool,representation:'structure',phase:Math.round(angle()),selected:null,zoom:state.view.zoom,playing};}
function publish(){client?.send({type:'state',...descriptor()});lastDescriptor=JSON.stringify(descriptor());lastPublish=performance.now();}
function remember(old:AtpState){if(JSON.stringify(old)!==JSON.stringify(state)){history.push(old);if(history.length>25)history.shift();}}
function finish(source:AtpInputSource|null){if(!source||owner!==source)return;if(before)remember(before);before=null;owner=null;}
function begin(source:AtpInputSource){if(!owns||state.frozen||document.hidden||!document.hasFocus()||!ready)return false;if(owner&&owner!==source)return false;if(!owner){playing=false;owner=source;before=structuredClone(state);}return true;}
const target:AtpInputTarget={state:()=>state,begin,view:q=>{state.view.q=q;},phase:n=>{state.phase=clampPhase(n);engine.setRotorDegrees(state.phase);},end:finish};
const phone=new AtpPhoneInput(target);
function release(){phone.release();finish(owner);drag=null;engine.pointerUp();}
function change(fn:()=>void,keep=true,allowFrozen=false){if(!owns||state.frozen&&!allowFrozen)return;release();playing=false;const old=structuredClone(state);fn();if(keep)remember(old);context++;publish();}
function undo(){change(()=>{const old=history.pop();if(old)state=old;engine.setRotorDegrees(state.phase);},false,true);}
function freeze(value:boolean){change(()=>{state.frozen=value;},true,true);$('#atp-freeze').hidden=!state.frozen;}
function recenter(){change(()=>{state.view=homeView();});}
function receive(p:Packet){
 if(p.type==='status'){owns=!!p.owner;phone.enabled=owns;if(!owns){release();playing=false;}}
 if(['local-release','lost','disconnected'].includes(p.type)){owns=false;release();playing=false;}
 if(p.type==='phone-lost'){phone.release();finish('phone');}
 if(['frame','action'].includes(p.type)&&(!owns||p.context!==context))return;
 if(p.type==='frame'){phone.frame(p,performance.now());return;}
 if(p.type!=='action')return;
 const action=String(p.action),n=Number(p.value);
 if(action==='fine-end'){finish('phone');return;}
 if(action==='freeze'||action==='resume'){freeze(action==='freeze');return;}
 if(action==='undo'){undo();return;}
 if(state.frozen)return;
 if(action==='atp-view'||action==='atp-rotor')change(()=>{state.tool=action==='atp-view'?'view':'rotor';});
 else if(action==='atp-play'||action==='atp-pause'){playing=action==='atp-play';publish();}
 else if(action==='atp-recenter')recenter();
 else if((action==='atp-checkpoint'&&Number.isFinite(n)&&n>=0&&n<=360)||(action==='atp-set-zoom'&&Number.isFinite(n)&&n>=.65&&n<=2.5)){
  if(owner&&owner!=='phone')return;
  if(!owner&&!begin('phone'))return;
  // Commit the final touch value into the existing scalar operation before release.
  if(action==='atp-checkpoint')target.phase(n);else state.view.zoom=n;
  release();publish();
 }
 else if(action==='atp-phase'&&Number.isFinite(n)&&n>=0&&n<=360){if(begin('phone')){lastFine=performance.now();target.phase(n);}}
 else if(action==='atp-zoom'&&Number.isFinite(n)&&n>=.65&&n<=2.5){if(begin('phone')){lastFine=performance.now();state.view.zoom=n;}}
 else if(action==='atp-zoom-in'||action==='atp-zoom-out')change(()=>{state.view.zoom=clamp(state.view.zoom*(action==='atp-zoom-in'?1.15:1/1.15),.65,2.5);});
}
// A new key: the guided schema's saved documents are not worth migrating.
const binding=await bindDocument('atp:6oqr:mirror',()=>state,v=>{release();state=validateAtp(v);engine.setRotorDegrees(state.phase);playing=false;history=[];context++;$('#atp-freeze').hidden=!state.frozen;publish();});
const session=await getSession();client=new ControlClient('desktop',session.token,receive,descriptor());publish();
view.ready.then(()=>{ready=true;$('#atp-loading').hidden=true;}).catch(error=>{const el=$('#atp-loading');el.classList.add('atp-error');el.textContent='Could not load the molecule. '+String(error);const b=document.createElement('button');b.textContent='Try again';b.onclick=()=>location.reload();el.append(b);});
viewport.addEventListener('atp-render-error',e=>{ready=false;release();playing=false;const el=$('#atp-loading');el.hidden=false;el.classList.add('atp-error');el.textContent=String((e as CustomEvent).detail);});
// The hosted bar owns pairing and its dialog; this page only needs a quieter way in.
$('#atp-phone')?.addEventListener('click',()=>{if(hosted)document.querySelector<HTMLElement>('#pair-phone')?.click();else notice('Plug in your phone by USB and run npm run phone.');});
window.addEventListener('studio-pair-status',e=>{$('#atp-phone').textContent=(e as CustomEvent).detail.connected?'Phone connected':'Connect phone';});
$('#atp-recenter').onclick=recenter;$('#atp-freeze').onclick=()=>freeze(false);
$('#atp-sound').onclick=()=>{muted=!muted;audio.setMuted(muted);$('#atp-sound').setAttribute('aria-pressed',String(!muted));void audio.start();};
$('#atp-sources').onclick=()=>{$<HTMLDialogElement>('#atp-about').showModal();release();playing=false;};$('#atp-about-close').onclick=()=>$<HTMLDialogElement>('#atp-about').close();
viewport.onpointerdown=e=>{if(e.button!==0)return;void audio.start();if(!owns||state.frozen||!ready)return;const pluck=engine.pointerDown(view.pointToWorld(e.clientX,e.clientY));if(!pluck&&!begin('mouse'))return;viewport.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,view:structuredClone(state.view),pluck};};
viewport.onpointermove=e=>{if(!drag){engine.hover(ready?view.pointToWorld(e.clientX,e.clientY):null);return;}if(drag.id!==e.pointerId)return;if(drag.pluck){engine.pointerMove(view.pointToWorld(e.clientX,e.clientY));return;}const dx=e.clientX-drag.x,dy=e.clientY-drag.y;state.view.q=new Quaternion().setFromEuler(new Euler(dy*.006,dx*.006,0,'YXZ')).multiply(new Quaternion().fromArray(drag.view.q)).normalize().toArray() as Quat;};
viewport.onpointerleave=()=>{if(!drag)engine.hover(null);};
function endDrag(e:PointerEvent){if(!drag||drag.id!==e.pointerId)return;if(drag.pluck)engine.pointerUp();else finish('mouse');drag=null;if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);}
viewport.onpointerup=endDrag;viewport.onpointercancel=endDrag;viewport.onlostpointercapture=e=>{if(drag?.id===e.pointerId){if(drag.pluck)engine.pointerUp();else finish('mouse');drag=null;}};
viewport.addEventListener('wheel',e=>{e.preventDefault();change(()=>{state.view.zoom=clamp(state.view.zoom*Math.exp(-e.deltaY*.001),.65,2.5);});},{passive:false});
viewport.onkeydown=e=>{if(e.key===' '&&!state.frozen){e.preventDefault();void audio.start();engine.kick(e.shiftKey?-1:1);}if(e.key==='Escape')release();if(e.key==='Home')recenter();};
let stream:MediaStream|null=null,probe:HandProbe|null=null,cameraStarting=false,cameraGeneration=0;
const video=$<HTMLVideoElement>('#atp-video');
function stopCamera(){cameraGeneration++;cameraStarting=false;probe?.stop();probe=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;tracker.reset();frame=empty();$('#atp-stage').classList.remove('is-live');$('#atp-camera').textContent='Step into the mirror';$('#atp-camera').removeAttribute('aria-pressed');}
function hands(raw:Landmark[][],at:number,world:Landmark[][],handedness:(string|null)[]=[]){if(raw.length)lastHands=performance.now();frame=tracker.update(raw,at,world,handedness,video.videoWidth/video.videoHeight||16/9);}
async function startCamera(){
 if(stream||cameraStarting){stopCamera();return;}
 const generation=++cameraGeneration;cameraStarting=true;void audio.start();$('#atp-camera').textContent='Opening camera…';
 try{
  const next=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});
  if(generation!==cameraGeneration){next.getTracks().forEach(t=>t.stop());return;}
  stream=next;video.srcObject=next;await video.play();if(generation!==cameraGeneration)return;
  view.setVideoAspect(video.videoWidth/video.videoHeight);
  // The skeleton is drawn in the molecule's own mirrored space, so the probe's raw overlay stays hidden.
  probe=new HandProbe(video,$<HTMLCanvasElement>('#atp-hand-overlay'),(data,message)=>{if(data.status==='error'){notice(message);stopCamera();}},(raw,at,world,meta)=>{if(owns&&!document.hidden&&document.hasFocus())hands(raw,at,world,meta?.handedness);else{tracker.reset();frame=empty();}},{preferGPU:true});
  probe.start();$('#atp-stage').classList.add('is-live');$('#atp-camera').textContent='Leave the mirror';$('#atp-camera').setAttribute('aria-pressed','true');
 }catch(e){if(generation===cameraGeneration){stopCamera();notice('Camera unavailable. Mouse still works: drag a chain to pluck it. '+String(e));}}
 finally{if(generation===cameraGeneration)cameraStarting=false;}
}
$('#atp-camera').onclick=()=>void startCamera();
function lightGuide(){
 const poses=frame.hands.map(h=>h.pose),two=poses.length===2&&poses[0]===poses[1]?poses[0]:null,active=two==='pinch'?'both-pinch':two==='fist'?'both-fist':poses[0]??'';
 document.querySelectorAll<HTMLElement>('[data-gesture]').forEach(el=>{const id=el.dataset.gesture!;el.classList.toggle('is-on',id===active||poses.includes(id as never)&&two===null);});
 $('#atp-stage').classList.toggle('has-hands',frame.hands.length>0);
}
let lastTick=performance.now(),stopped=false,lastCount=-1;
function tick(now:number){
 if(stopped)return;
 const dt=Math.min(.05,(now-lastTick)/1000);lastTick=now;phone.tick(now);
 if(owner==='phone'&&!phone.held&&now-lastFine>500)finish('phone');
 if(playing&&!state.frozen&&!document.hidden)engine.kick(1);
 if(now-lastHands>350&&frame.hands.length){tracker.reset();frame=empty();}
 if(ready){
  const out=engine.step(frame,dt,state.view,state.frozen);
  if(out.holding){if(out.view&&begin('hand'))Object.assign(state.view,out.view);}else finish('hand');
  for(const sound of out.sounds)audio.play(sound);
  if(out.atp!==lastCount)$('#atp-count').textContent=String(lastCount=out.atp);
  if(Math.abs(out.scene.rotorSpeed)<.01&&!owner)state.phase=angle();
  view.setPose(state.view);view.draw(out.scene,now);lightGuide();
 }
 if(now-lastPublish>100&&lastDescriptor!==JSON.stringify(descriptor()))publish();
 requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
function interrupt(){release();playing=false;publish();}
window.addEventListener('blur',interrupt);document.addEventListener('visibilitychange',()=>{if(document.hidden){interrupt();stopCamera();}});document.addEventListener('studio-before-navigation',()=>{interrupt();stopCamera();});window.addEventListener('pagehide',()=>{stopped=true;stopCamera();release();client?.close();binding.close();audio.stop();view.dispose();});
(window as any).__atpStudio={get state(){return structuredClone(state);},get playing(){return playing;},get ready(){return ready;},get owns(){return owns;},get phoneHeld(){return phone.held;},get owner(){return owner;},get context(){return context;},get atp(){return engine.atp;},get frame(){return frame;},hands(raw:Landmark[][],world:Landmark[][]=[],handedness:(string|null)[]=[]){hands(raw,performance.now(),world,handedness);}};
