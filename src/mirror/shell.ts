import './style.css';
import {Euler,Quaternion} from 'three';
import {bindDocument} from '../documents';
import {ControlClient} from '../control';
import {getSession,hosted} from '../session';
import {HandProbe} from '../hand-probe';
import type {Landmark} from '../fist';
import type {Packet,Quat} from '../types';
import type {TrackingFrame} from '../tracking/model';
// @ts-ignore Shared relay protocol is plain JavaScript.
import {validTrackingFrame} from '../../tracking-protocol.mjs';
import {MIRROR_ZOOM_MAX as ZOOM_MAX,MIRROR_ZOOM_MIN as ZOOM_MIN,clampPhase,type GestureFrame,type MirrorDriver,type MirrorInputSource,type MirrorInputTarget,type MirrorObject,type MirrorState,type MirrorView} from './contracts';
import {mirrorGestures} from './guide';
import {GestureTracker} from './gestures';
import {MirrorPhoneInput} from './input';
import {mountMirrorPage} from './page';
import {Tutorial,markTutorialSeen,tutorialSeen,type TutorialStep,type TutorialView} from './tutorial';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(id)!;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

/** Stages one object: page, camera, phone, relay, document and the frame loop. Returns live debug getters. */
export async function runMirror<State extends MirrorState,View extends MirrorView,Engine extends MirrorDriver>(object:MirrorObject<State,View,Engine>){
const {id}=object,part=<T extends HTMLElement=HTMLElement>(name:string)=>$<T>(`#${id}-${name}`);
document.title=object.title;
const gestures=mirrorGestures({thumbUp:object.motion.run,thumbDown:object.motion.reverse,...object.gestures});
mountMirrorPage($('#app'),{id,copy:object.copy,about:object.about,gestures});
const tutorialBox=part('tutorial'),tutorialText=tutorialBox.querySelector('p')!;
let tutorial:Tutorial|null=null,tutorialClap=false,tutorialDoneAt=0,tutorialView:TutorialView|null=null;
let state:MirrorState=object.state.initial(),client:ControlClient|null=null,owns=false,playing=false,context=0,ready=false,muted=false;
let drag:{id:number;x:number;y:number;view:MirrorState['view'];pluck:boolean}|null=null,lastFine=-Infinity,lastPublish=0,lastDescriptor='',spoken='';
let owner:MirrorInputSource|null=null,before:MirrorState|null=null,history:MirrorState[]=[];
const empty=():GestureFrame=>({at:0,hands:[],events:[]});
const viewport=part('viewport'),view=object.createView(viewport),engine=object.createEngine(view),audio=object.createAudio(),tracker=new GestureTracker();
let frame=empty(),lastHands=-Infinity,shockAt=-Infinity;
// Pose and clap events last one tracker update; one not yet drawn is carried into the next, so a fast camera cannot drop a 🤟 or a clap.
let drawn=true;
function carry(next:GestureFrame){if(!drawn)next.events=[...frame.events,...next.events].slice(-20);drawn=false;return next;}
const trackingSession=crypto.randomUUID();let phoneCapture='',phoneSequence=0,phoneFrames=0,phoneCamera=false;
function notice(s:string){if(s!==spoken)part('status').textContent=spoken=s;}
function angle(){return ((engine.position%360)+360)%360;}
function descriptor(){return {enabled:!state.frozen,frozen:state.frozen,context,...object.descriptor(state as State,angle()),playing,captureEnabled:!state.frozen,trackingSession};}
function publish(){client?.send({type:'state',...descriptor()});lastDescriptor=JSON.stringify(descriptor());lastPublish=performance.now();}
function remember(old:MirrorState){if(JSON.stringify(old)!==JSON.stringify(state)){history.push(old);if(history.length>25)history.shift();}}
function finish(source:MirrorInputSource|null){if(!source||owner!==source)return;if(before)remember(before);before=null;owner=null;}
// The laptop may lose focus while someone reaches for the phone, so phone-camera hands only need a visible tab.
function begin(source:MirrorInputSource){if(!owns||state.frozen||document.hidden||!document.hasFocus()&&!(source==='hand'&&phoneCamera)||!ready)return false;if(owner&&owner!==source)return false;if(!owner){playing=false;owner=source;before=structuredClone(state);}return true;}
const target:MirrorInputTarget={state:()=>state,begin,view:q=>{state.view.q=q;},phase:n=>{state.phase=clampPhase(n);engine.seek(state.phase);},end:finish};
const phone=new MirrorPhoneInput(target);
function release(){phone.release();finish(owner);drag=null;engine.pointerUp();}
function change(fn:()=>void,keep=true,allowFrozen=false){if(!owns||state.frozen&&!allowFrozen)return;release();playing=false;const old=structuredClone(state);fn();if(keep)remember(old);context++;publish();}
// While the motor idles the saved phase is out of date, so undoing an unrelated edit must not jump the rotor.
function undo(){change(()=>{const old=history.pop();if(old)state=old;if(!engine.idle)engine.seek(state.phase);},false,true);}
function freeze(value:boolean){change(()=>{state.frozen=value;},true,true);part('freeze').hidden=!state.frozen;}
function recenter(){change(()=>{state.view=object.state.initial().view;});object.recentered?.(engine);}
function endPhoneCamera(){if(!phoneCamera)return;endTutorial();phoneCamera=false;phoneCapture='';phoneSequence=0;tracker.reset();frame=empty();notice('');}
function phoneHands(f:TrackingFrame){
 const now=client?.serverTime()??null;if(now===null||f.frameAt===null||Math.abs(now-f.frameAt)>400)return;
 if(phoneCapture!==f.captureId){tracker.reset();phoneCapture=f.captureId;phoneSequence=0;}if(f.frameId<=phoneSequence)return;phoneSequence=f.frameId;phoneFrames++;
 // No phone video is shown here, so the whole phone picture maps onto the whole stage.
 if(!phoneCamera){phoneCamera=true;view.setVideoAspect(0);notice('Phone camera is live.');firstTutorial();}
 hands(f.hands,performance.now(),[],[],f.width/f.height);
}
function receive(p:Packet){
 if(p.type==='tracking-stop'){endPhoneCamera();return;}
 // The laptop's own mirror wins if both cameras are running.
 if(p.type==='tracking-frame'){if(owns&&!stream&&!document.hidden&&validTrackingFrame(p))phoneHands(p as unknown as TrackingFrame);return;}
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
 if(action==='atp-view'||action==='atp-rotor')change(()=>{state.tool=action==='atp-view'?'view':'rotor';if(state.tool==='rotor')state.phase=clampPhase(angle());});
 else if(action==='atp-play'||action==='atp-pause'){playing=action==='atp-play';publish();}
 else if(action==='atp-recenter')recenter();
 else if((action==='atp-checkpoint'&&Number.isFinite(n)&&n>=0&&n<=360)||(action==='atp-set-zoom'&&Number.isFinite(n)&&n>=ZOOM_MIN&&n<=ZOOM_MAX)){
  if(owner&&owner!=='phone')return;
  if(!owner&&!begin('phone'))return;
  // Commit the final touch value into the existing scalar operation before release.
  if(action==='atp-checkpoint')target.phase(n);else state.view.zoom=n;
  release();publish();
 }
 else if(action==='atp-phase'&&Number.isFinite(n)&&n>=0&&n<=360){if(begin('phone')){lastFine=performance.now();target.phase(n);}}
 else if(action==='atp-zoom'&&Number.isFinite(n)&&n>=ZOOM_MIN&&n<=ZOOM_MAX){if(begin('phone')){lastFine=performance.now();state.view.zoom=n;}}
 else if(action==='atp-zoom-in'||action==='atp-zoom-out')change(()=>{state.view.zoom=clamp(state.view.zoom*(action==='atp-zoom-in'?1.15:1/1.15),ZOOM_MIN,ZOOM_MAX);});
}
// A new key: the guided schema's saved documents are not worth migrating.
const binding=await bindDocument(object.documentKey,()=>state,v=>{release();state=object.state.validate(v);engine.seek(state.phase);playing=false;history=[];context++;part('freeze').hidden=!state.frozen;publish();});
const session=await getSession();client=new ControlClient('desktop',session.token,receive,descriptor());publish();
view.ready.then(()=>{ready=true;part('loading').hidden=true;}).catch(error=>{const el=part('loading');el.classList.add(`${id}-error`,'mirror-error');el.textContent=object.copy.loadError+String(error);const b=document.createElement('button');b.textContent='Try again';b.onclick=()=>location.reload();el.append(b);});
viewport.addEventListener('mirror-render-error',e=>{ready=false;release();playing=false;const el=part('loading');el.hidden=false;el.classList.add(`${id}-error`,'mirror-error');el.textContent=String((e as CustomEvent).detail);});
// The hosted bar owns pairing and its dialog; this page only needs a quieter way in.
document.querySelector(`#${id}-phone`)?.addEventListener('click',()=>{if(hosted)document.querySelector<HTMLElement>('#pair-phone')?.click();else notice('Plug in your phone by USB and run npm run phone.');});
window.addEventListener('studio-pair-status',e=>{part('phone').textContent=(e as CustomEvent).detail.connected?'Phone connected':'Connect phone';});
part('recenter').onclick=recenter;part('freeze').onclick=()=>freeze(false);
part('sound').onclick=()=>{muted=!muted;audio.setMuted(muted);part('sound').setAttribute('aria-pressed',String(!muted));void audio.start();};
part('sources').onclick=()=>{part<HTMLDialogElement>('about').showModal();release();playing=false;};part('about-close').onclick=()=>part<HTMLDialogElement>('about').close();
viewport.onpointerdown=e=>{if(e.button!==0)return;void audio.start();if(!owns||state.frozen||!ready)return;const pluck=engine.pointerDown(view.pointToWorld(e.clientX,e.clientY));if(!pluck&&!begin('mouse'))return;viewport.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,view:structuredClone(state.view),pluck};};
viewport.onpointermove=e=>{if(!drag){engine.hover(ready?view.pointToWorld(e.clientX,e.clientY):null);return;}if(drag.id!==e.pointerId)return;if(drag.pluck){engine.pointerMove(view.pointToWorld(e.clientX,e.clientY));return;}const dx=e.clientX-drag.x,dy=e.clientY-drag.y;state.view.q=new Quaternion().setFromEuler(new Euler(dy*.006,dx*.006,0,'YXZ')).multiply(new Quaternion().fromArray(drag.view.q)).normalize().toArray() as Quat;};
viewport.onpointerleave=()=>{if(!drag)engine.hover(null);};
function endDrag(e:PointerEvent){if(!drag||drag.id!==e.pointerId)return;if(drag.pluck)engine.pointerUp();else finish('mouse');drag=null;if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);}
viewport.onpointerup=endDrag;viewport.onpointercancel=endDrag;viewport.onlostpointercapture=e=>{if(drag?.id===e.pointerId){if(drag.pluck)engine.pointerUp();else finish('mouse');drag=null;}};
viewport.addEventListener('wheel',e=>{e.preventDefault();change(()=>{state.view.zoom=clamp(state.view.zoom*Math.exp(-e.deltaY*.001),ZOOM_MIN,ZOOM_MAX);});},{passive:false});
viewport.onkeydown=e=>{if(e.key===' '&&!state.frozen){e.preventDefault();void audio.start();engine.kick(e.shiftKey?-1:1);}if(e.key==='Escape')release();if(e.key==='Home')recenter();};
let stream:MediaStream|null=null,probe:HandProbe|null=null,cameraStarting=false,cameraGeneration=0;
const video=part<HTMLVideoElement>('video');
function stopCamera(){endTutorial();cameraGeneration++;cameraStarting=false;probe?.stop();probe=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;tracker.reset();frame=empty();part('stage').classList.remove('is-live');part('camera').textContent='Step into the mirror';part('camera').removeAttribute('aria-pressed');}
function hands(raw:Landmark[][],at:number,world:Landmark[][],handedness:(string|null)[]=[],aspect=video.videoWidth/video.videoHeight||16/9){if(raw.length)lastHands=performance.now();frame=carry(tracker.update(raw,at,world,handedness,aspect));if(frame.events.some(e=>e.type==='clap')){shockAt=performance.now();tutorialClap=true;}}
async function startCamera(){
 if(stream||cameraStarting){stopCamera();return;}
 const generation=++cameraGeneration;cameraStarting=true;void audio.start();part('camera').textContent='Opening camera…';
 try{
  const next=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});
  if(generation!==cameraGeneration){next.getTracks().forEach(t=>t.stop());return;}
  stream=next;video.srcObject=next;await video.play();if(generation!==cameraGeneration)return;
  endPhoneCamera();view.setVideoAspect(video.videoWidth/video.videoHeight);
  // The skeleton is drawn in the object's own mirrored space, so the probe's raw overlay stays hidden.
  probe=new HandProbe(video,part<HTMLCanvasElement>('hand-overlay'),(data,message)=>{if(data.status==='error'){notice(message);stopCamera();}},(raw,at,world,meta)=>{if(owns&&!document.hidden&&document.hasFocus())hands(raw,at,world,meta?.handedness);else{tracker.reset();frame=empty();}},{preferGPU:true});
  probe.start();firstTutorial();part('stage').classList.add('is-live');part('camera').textContent='Leave the mirror';part('camera').setAttribute('aria-pressed','true');
 }catch(e){if(generation===cameraGeneration){stopCamera();notice(object.copy.cameraFallback+String(e));}}
 finally{if(generation===cameraGeneration)cameraStarting=false;}
}
part('camera').onclick=()=>void startCamera();
const seenStore={getItem:(k:string)=>localStorage.getItem(k),setItem:(k:string,v:string)=>localStorage.setItem(k,v)};
const tutorialHint=(step:TutorialStep)=>step.pose==='clap'?'Start with your hands apart, then bring them together.':step.id.startsWith('both')?'Show both hands to the camera.':'Hold your hand still, palm to the camera.';
function startTutorial(){tutorial=new Tutorial(gestures);tutorialDoneAt=0;tutorialBox.hidden=false;}
function firstTutorial(){if(!tutorial&&!tutorialSeen(seenStore))startTutorial();}
function endTutorial(){tutorial=null;tutorialView=null;tutorialBox.hidden=true;}
function drawTutorial(now:number){
 if(!tutorial)return;
 // Two tracker updates can land in one render, so a clap is carried over rather than read from the latest frame.
 const v=tutorialView=tutorial.update(tutorialClap?{...frame,events:[...frame.events,{type:'clap',x:0,y:0}]}:frame,now);tutorialClap=false;
 if(v.done){if(!tutorialDoneAt){tutorialDoneAt=now;markTutorialSeen(seenStore);tutorialBox.querySelector('i')!.textContent='✓';tutorialText.querySelector('b')!.textContent='That is every gesture';tutorialText.querySelector('small')!.textContent='';tutorialBox.querySelector<HTMLElement>('.mirror-tutorial-bar span')!.style.width='100%';}else if(now-tutorialDoneAt>1800)endTutorial();return;}
 tutorialBox.querySelector('i')!.textContent=v.step!.glyph;tutorialText.querySelector('b')!.textContent=v.step!.label;tutorialText.querySelector('small')!.textContent=v.hint?tutorialHint(v.step!):`${v.index+1} of ${v.total}`;
 tutorialBox.querySelector<HTMLElement>('.mirror-tutorial-bar span')!.style.width=`${v.progress*100}%`;
}
part('tutorial-replay').onclick=()=>{void audio.start();startTutorial();};
part('tutorial-skip').onclick=()=>{markTutorialSeen(seenStore);endTutorial();};
function lightGuide(){
 const poses=frame.hands.map(h=>h.pose),two=poses.length===2&&poses[0]===poses[1]?poses[0]:null,active=two==='pinch'?'both-pinch':two==='fist'?'both-fist':poses[0]??'';
 document.querySelectorAll<HTMLElement>('[data-gesture]').forEach(el=>{const id=el.dataset.gesture!;el.classList.toggle('is-on',id===active||poses.includes(id as never)&&two===null||id==='clap'&&performance.now()-shockAt<500);});
 part('stage').classList.toggle('has-hands',frame.hands.length>0);
}
let lastTick=performance.now(),stopped=false,lastReadout:number|string|null=null;
const stillMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
function tick(now:number){
 if(stopped)return;
 const dt=Math.min(.05,(now-lastTick)/1000);lastTick=now;phone.tick(now);
 if(owner==='phone'&&!phone.held&&now-lastFine>500)finish('phone');
 if(playing&&!state.frozen&&!document.hidden)engine.kick(1);
 if(now-lastHands>350&&frame.hands.length){tracker.reset();frame=empty();}
 if(ready){
  // Idle motion stops whenever the object says so or the viewer asked for less.
  engine.idle=!!object.idles?.(state as State)&&!stillMotion.matches;
  const out=engine.step(frame,dt,state.view,state.frozen);drawn=true;
  if(out.holding){if(out.view&&begin('hand'))Object.assign(state.view,out.view);}else finish('hand');
  for(const sound of out.sounds)audio.play(sound);
  if(object.readout&&object.copy.readoutUnit){const value=object.readout(out as ReturnType<Engine['step']>);if(value!==lastReadout)part('count').textContent=String(lastReadout=value);}
  if(!engine.idle&&Math.abs(engine.speed)<.01&&!owner)state.phase=angle();
  view.setPose(state.view);view.draw(out.scene,now);lightGuide();drawTutorial(now);
 }
 if(now-lastPublish>100&&lastDescriptor!==JSON.stringify(descriptor()))publish();
 requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
function interrupt(){release();playing=false;publish();}
window.addEventListener('blur',interrupt);document.addEventListener('visibilitychange',()=>{if(document.hidden){interrupt();stopCamera();}});document.addEventListener('studio-before-navigation',()=>{interrupt();stopCamera();});window.addEventListener('pagehide',()=>{stopped=true;stopCamera();release();client?.close();binding.close();audio.stop();view.dispose();});
return {engine,get tutorial(){return tutorialView;},get state(){return structuredClone(state) as State;},get playing(){return playing;},get ready(){return ready;},get owns(){return owns;},get phoneHeld(){return phone.held;},get owner(){return owner;},get context(){return context;},get frame(){return frame;},get phoneFrames(){return phoneFrames;},get phoneCamera(){return phoneCamera;},hands(raw:Landmark[][],world:Landmark[][]=[],handedness:(string|null)[]=[]){hands(raw,performance.now(),world,handedness);}};
}
