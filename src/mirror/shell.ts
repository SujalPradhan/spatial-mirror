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
import {MIRROR_ZOOM_MAX as ZOOM_MAX,MIRROR_ZOOM_MIN as ZOOM_MIN,clampPhase,type GestureFrame,type MirrorGestureId,type MirrorDriver,type MirrorInputSource,type MirrorInputTarget,type MirrorObject,type MirrorState,type MirrorView} from './contracts';
import {mirrorGestures} from './guide';
import {GestureTracker} from './gestures';
import {InkMode,inkSuppressed} from './ink-mode';
import {mirrorToStage} from './projection';
import {WatchPresenter,type Stage} from './watch';
import {forgetRoom,presenterUrl} from './watch-link';
import {runWatchView} from './watch-view';
import {HOLD_SCALE,keyLabel,loadSettings,matchKey,motionReduced,saveSettings,textGate,type HoldTime} from './a11y';
import {MirrorPhoneInput} from './input';
import {mountMirrorPage} from './page';
import {createWalkthrough} from './walkthrough';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(id)!;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const TWO_HAND:readonly MirrorGestureId[]=['both-pinch','both-fist','clap'];
const TURN=Math.PI/12,ZOOM_STEP=1.15,TUTORIAL_HOLD_MS=600;
const esc=(text:string)=>text.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
interface Entry {id:string;label:string;hint:string;key?:string;gesture?:MirrorGestureId;group:'object'|'view'|'motion';repeat?:boolean;frozenOk?:boolean;quiet?:boolean;run():void;pressed?():boolean;announce?():string}
function safeStorage(){try{return localStorage;}catch{return null;}}

/** Stages one object: page, camera, phone, relay, document and the frame loop. Returns live debug getters. */
export async function runMirror<State extends MirrorState,View extends MirrorView,Engine extends MirrorDriver>(object:MirrorObject<State,View,Engine>){
const {id}=object,part=<T extends HTMLElement=HTMLElement>(name:string)=>$<T>(`#${id}-${name}`);
document.title=object.title;
const allGestures=mirrorGestures({thumbUp:object.motion.run,thumbDown:object.motion.reverse,...object.gestures},object.use);
mountMirrorPage($('#app'),{id,copy:object.copy,about:object.about,gestures:allGestures});
const gestures=()=>settings.oneHanded?allGestures.filter(g=>!TWO_HAND.includes(g.id)):allGestures;
const walk=createWalkthrough({id,part,gestures:allGestures,steps:object.walkthrough,frame:()=>frame,aspect:()=>videoAspect,cameraOn:()=>!!stream||phoneCamera,inkOn:()=>inkOn,storage:{getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v)},skipTwoHanded:()=>settings.oneHanded,holdMs:()=>TUTORIAL_HOLD_MS*HOLD_SCALE[settings.hold],tryAction:gesture=>{const entry=entries.find(e=>e.gesture===gesture);if(entry)runAction(entry.id);}});
let state:MirrorState=object.state.initial(),client:ControlClient|null=null,owns=false,playing=false,context=0,ready=false,muted=false;
let drag:{id:number;x:number;y:number;view:MirrorState['view'];pluck:boolean}|null=null,lastFine=-Infinity,lastPublish=0,lastDescriptor='',spoken='';
let owner:MirrorInputSource|null=null,before:MirrorState|null=null,history:MirrorState[]=[];
const empty=():GestureFrame=>({at:0,hands:[],events:[]});
const settings=loadSettings(safeStorage()),stillMotion=window.matchMedia('(prefers-reduced-motion: reduce)'),reduced=()=>motionReduced(settings,stillMotion.matches);
let paused=false;
const viewport=part('viewport'),view=object.createView(viewport),engine=object.createEngine(view),audio=object.createAudio(),tracker=new GestureTracker({shape:!!object.handShape,hold:()=>HOLD_SCALE[settings.hold]});
if(new URLSearchParams(location.search).has('watch'))return runWatchView(object,{code:new URLSearchParams(location.search).get('watch')!,part,view,engine,audio}) as never;
let frame=empty(),lastHands=-Infinity,shockAt=-Infinity,inkOn=false,videoAspect=0;
const inkMode=new InkMode(part('stage'));
const stageOf:Stage=p=>mirrorToStage(p.x,p.y,videoAspect,part('stage').clientWidth/(part('stage').clientHeight||1));
function setAspect(aspect:number){videoAspect=aspect;view.setVideoAspect(aspect);}
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
function begin(source:MirrorInputSource){if(inkOn&&source!=='phone'||!owns||state.frozen||document.hidden||!document.hasFocus()&&!(source==='hand'&&phoneCamera)||!ready)return false;if(owner&&owner!==source)return false;if(!owner){playing=false;owner=source;before=structuredClone(state);}return true;}
const target:MirrorInputTarget={state:()=>state,begin,view:q=>{state.view.q=q;},phase:n=>{state.phase=clampPhase(n);engine.seek(state.phase);},end:finish};
const phone=new MirrorPhoneInput(target);
function release(){phone.release();finish(owner);drag=null;engine.pointerUp();}
function change(fn:()=>void,keep=true,allowFrozen=false){if(!owns||state.frozen&&!allowFrozen)return;release();playing=false;const old=structuredClone(state);fn();if(keep)remember(old);context++;publish();}
// While the motor idles the saved phase is out of date, so undoing an unrelated edit must not jump the rotor.
function undo(){change(()=>{const old=history.pop();if(old)state=old;if(!engine.idle)engine.seek(state.phase);},false,true);}
function freeze(value:boolean){change(()=>{state.frozen=value;},true,true);part('freeze').hidden=!state.frozen;}
function recenter(){change(()=>{state.view=object.state.initial().view;});object.recentered?.(engine);}
function zoomBy(factor:number){change(()=>{state.view.zoom=clamp(state.view.zoom*factor,ZOOM_MIN,ZOOM_MAX);});}
function turnBy(yaw:number,pitch:number){change(()=>{state.view.q=new Quaternion().setFromEuler(new Euler(pitch,yaw,0,'YXZ')).multiply(new Quaternion().fromArray(state.view.q)).normalize().toArray() as Quat;});}
function endPhoneCamera(){if(!phoneCamera)return;walk.end();phoneCamera=false;phoneCapture='';phoneSequence=0;tracker.reset();frame=empty();notice('');}
function phoneHands(f:TrackingFrame){
 if(!settings.tracking)return;
 const now=client?.serverTime()??null;if(now===null||f.frameAt===null||Math.abs(now-f.frameAt)>400)return;
 if(phoneCapture!==f.captureId){tracker.reset();phoneCapture=f.captureId;phoneSequence=0;}if(f.frameId<=phoneSequence)return;phoneSequence=f.frameId;phoneFrames++;
 // No phone video is shown here, so the whole phone picture maps onto the whole stage.
 if(!phoneCamera){phoneCamera=true;setAspect(0);notice('Phone camera is live.');walk.first();}
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
 else if(action==='atp-zoom-in'||action==='atp-zoom-out')zoomBy(action==='atp-zoom-in'?ZOOM_STEP:1/ZOOM_STEP);
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
viewport.onpointerdown=e=>{if(e.button!==0)return;void audio.start();if(inkOn){inkMode.pointerDown(e,viewport,performance.now());return;}if(!owns||state.frozen||!ready)return;const pluck=engine.pointerDown(view.pointToWorld(e.clientX,e.clientY));if(!pluck&&!begin('mouse'))return;viewport.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,view:structuredClone(state.view),pluck};};
viewport.onpointermove=e=>{if(inkOn){inkMode.pointerMove(e);return;}if(!drag){engine.hover(ready?view.pointToWorld(e.clientX,e.clientY):null);return;}if(drag.id!==e.pointerId)return;if(drag.pluck){engine.pointerMove(view.pointToWorld(e.clientX,e.clientY));return;}const dx=e.clientX-drag.x,dy=e.clientY-drag.y;state.view.q=new Quaternion().setFromEuler(new Euler(dy*.006,dx*.006,0,'YXZ')).multiply(new Quaternion().fromArray(drag.view.q)).normalize().toArray() as Quat;};
viewport.onpointerleave=()=>{if(!drag)engine.hover(null);};
function endDrag(e:PointerEvent){if(inkMode.pointerUp(e,performance.now())){if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);return;}if(!drag||drag.id!==e.pointerId)return;if(drag.pluck)engine.pointerUp();else finish('mouse');drag=null;if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);}
viewport.onpointerup=endDrag;viewport.onpointercancel=endDrag;viewport.onlostpointercapture=e=>{inkMode.pointerUp(e,performance.now());if(drag?.id===e.pointerId){if(drag.pluck)engine.pointerUp();else finish('mouse');drag=null;}};
viewport.addEventListener('wheel',e=>{e.preventDefault();zoomBy(Math.exp(-e.deltaY*.001));},{passive:false});
const inkButton=part<HTMLButtonElement>('ink'),keepButton=part<HTMLButtonElement>('ink-keep'),gestureBar=part('gestures');
const barHtml=(list:ReturnType<typeof mirrorGestures>)=>list.map(g=>`<li data-gesture="${g.id}"><i aria-hidden="true">${g.glyph}</i>${g.label}</li>`).join('');
const renderBar=()=>{if(!inkOn)gestureBar.innerHTML=barHtml(gestures());};
function setInk(on:boolean){
 if(on===inkOn)return;release();playing=false;inkOn=on;const now=performance.now();
 inkMode.set(on,now);part('stage').classList.toggle('is-inking',on);inkButton.setAttribute('aria-pressed',String(on));keepButton.hidden=!on;keepButton.setAttribute('aria-pressed','false');
 if(on)gestureBar.innerHTML=barHtml(mirrorGestures({pinch:'Draw',thumbDown:'Undo'},['pinch','thumbDown']));
 else renderBar();
}
inkButton.onclick=()=>setInk(!inkOn);
keepButton.onclick=()=>{const keep=!inkMode.board.keep;inkMode.setKeep(keep,performance.now());keepButton.setAttribute('aria-pressed',String(keep));};
// Every gesture effect has a button and a key. All three reach the same engine methods, so none is a second implementation.
const hasMotion=object.use.includes('thumbUp')||object.use.includes('thumbDown');
const entries:Entry[]=[
 ...(object.actions??[]).map((a):Entry=>({id:a.id,label:a.label,hint:a.hint,key:a.key,gesture:a.gesture,group:'object',run:()=>a.run(engine),pressed:a.pressed?()=>a.pressed!(engine):undefined})),
 {id:'turn-left',label:'Turn left',hint:'Rotate the view to the left',key:'arrowleft',group:'view',repeat:true,run:()=>turnBy(-TURN,0)},
 {id:'turn-right',label:'Turn right',hint:'Rotate the view to the right',key:'arrowright',gesture:'fist',group:'view',repeat:true,run:()=>turnBy(TURN,0)},
 {id:'turn-up',label:'Turn up',hint:'Tilt the view upward',key:'arrowup',group:'view',repeat:true,run:()=>turnBy(0,-TURN)},
 {id:'turn-down',label:'Turn down',hint:'Tilt the view downward',key:'arrowdown',group:'view',repeat:true,run:()=>turnBy(0,TURN)},
 {id:'zoom-in',label:'Zoom in',hint:'Make the object larger',key:'+|=',gesture:'both-fist',group:'view',repeat:true,run:()=>zoomBy(ZOOM_STEP),announce:()=>`Zoom ${state.view.zoom.toFixed(2)} times`},
 {id:'zoom-out',label:'Zoom out',hint:'Make the object smaller',key:'-',group:'view',repeat:true,run:()=>zoomBy(1/ZOOM_STEP),announce:()=>`Zoom ${state.view.zoom.toFixed(2)} times`},
 {id:'reset-view',label:'Reset view',hint:'Put the view back where it started',key:'home',group:'view',run:recenter},
 {id:'run',label:object.motion.run,hint:'Nudge the motion forward. Hold Space to keep it going',key:'space',gesture:'thumbUp',group:'motion',repeat:true,quiet:!hasMotion,run:()=>engine.kick(1)},
 {id:'reverse',label:object.motion.reverse,hint:'Nudge the motion backward. Hold Shift and Space to keep it going',key:'shift+space',gesture:'thumbDown',group:'motion',repeat:true,quiet:!hasMotion,run:()=>engine.kick(-1)},
 {id:'pause',label:'Pause motion',hint:'Stop the object moving by itself, or let it move again',key:'p',group:'motion',frozenOk:true,run:()=>{paused=!paused;if(paused)playing=false;},pressed:()=>paused},
 {id:'freeze',label:'Freeze',hint:'Lock the view and every effect, or release it',key:'f',group:'motion',frozenOk:true,run:()=>freeze(!state.frozen),pressed:()=>state.frozen},
 {id:'undo',label:'Undo',hint:'Step back the last change to the view',key:'u',group:'motion',frozenOk:true,run:undo},
];
const panel=part('actions'),panelToggle=part<HTMLButtonElement>('actions-toggle'),summaryEl=part('summary'),stageEl=part('stage'),cornerEl=stageEl.querySelector<HTMLElement>('.mirror-corner')!;
const groupNames:[Entry['group'],string][]=[['object','Gesture actions'],['view','View'],['motion','Motion']];
panel.innerHTML=groupNames.map(([group,name])=>{
 const list=entries.filter(e=>e.group===group&&!e.quiet);
 return list.length?`<div class="mirror-action-group" role="group" aria-label="${name}"><span aria-hidden="true">${name}</span>${list.map(e=>`<button data-action="${e.id}" title="${esc(e.hint+(e.key?` (${keyLabel(e.key)})`:''))}"${e.pressed?' aria-pressed="false"':''}>${esc(e.label)}</button>`).join('')}</div>`:'';
}).join('');
const summarise=()=>object.summary?.(engine,state as State)??`${object.copy.stageLabel}${object.copy.readoutUnit&&lastReadout!==null?`, ${lastReadout} ${object.copy.readoutUnit}`:''}${state.frozen?', frozen':''}`;
const extraKeys:[string|undefined,string,string][]=[['i','Ink','Draw on top of the view with the mouse or a pinch'],['?','Keys','Show this list'],['escape','Let go','Drop whatever you are holding']];
part('keys-list').innerHTML=[...entries.filter(e=>!e.quiet).map((e):[string|undefined,string,string]=>[e.key,e.label,e.hint]),...extraKeys].map(([key,label,hint])=>`<tr><td>${key?`<kbd>${esc(keyLabel(key))}</kbd>`:'Button only'}</td><th scope="row">${esc(label)}</th><td>${esc(hint)}</td></tr>`).join('');
const buttons=new Map<string,HTMLButtonElement>();
panel.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(b=>buttons.set(b.dataset.action!,b));
function syncPressed(){for(const e of entries){const b=e.pressed&&buttons.get(e.id);if(!b)continue;const on=String(e.pressed!());if(b.getAttribute('aria-pressed')!==on)b.setAttribute('aria-pressed',on);}}
let statusTimer=0;
function runAction(actionId:string){
 const entry=entries.find(e=>e.id===actionId);
 if(!entry||entry.group==='object'&&!ready||state.frozen&&!entry.frozenOk)return false;
 void audio.start();entry.run();syncPressed();
 const text=entry.announce?.()??(entry.pressed?`${entry.label} ${entry.pressed()?'on':'off'}`:entry.group==='object'?entry.label:'');
 if(text){spoken='';notice(text);clearTimeout(statusTimer);statusTimer=window.setTimeout(()=>{if(spoken===text)notice('');},2500);}
 return true;
}
document.addEventListener('mirror-run-action',e=>{runAction(String((e as CustomEvent).detail?.id));});
panel.onclick=e=>{const b=(e.target as Element).closest<HTMLButtonElement>('button[data-action]');if(b)runAction(b.dataset.action!);};
const narrow=window.matchMedia('(max-width:900px)');
// The tutorial, status line and caption sit clear of the corner tools and the gesture bar however tall those grow.
function layout(){
 const s=stageEl.getBoundingClientRect(),c=cornerEl.getBoundingClientRect(),b=gestureBar.getBoundingClientRect();
 stageEl.style.setProperty('--mirror-corner-end',`${Math.round(c.bottom-s.top)}px`);
 stageEl.style.setProperty('--mirror-bar',`${Math.round(s.bottom-b.top)}px`);
 panel.style.maxHeight='';
 if(panel.hidden)return;
 const lows=[b,...(stageEl.classList.contains('is-live')?[]:[cameraButton.getBoundingClientRect()]),...[...stageEl.querySelectorAll('.mirror-status:not(:empty),[class$="-caption"]:not(:empty)')].map(e=>e.getBoundingClientRect())];
 const p=panel.getBoundingClientRect(),floor=Math.min(...lows.map(r=>r.top)),room=narrow.matches?floor-p.top-8:p.bottom-s.top-56;
 panel.style.maxHeight=`${Math.max(64,Math.floor(room))}px`;
}
new ResizeObserver(layout).observe(stageEl);new ResizeObserver(layout).observe(cornerEl);new ResizeObserver(layout).observe(gestureBar);
panelToggle.onclick=()=>{panel.hidden=!panel.hidden;panelToggle.setAttribute('aria-expanded',String(!panel.hidden));layout();};
panel.onkeydown=e=>{if(e.key==='Escape'&&!panel.hidden){e.stopPropagation();panel.hidden=true;panelToggle.setAttribute('aria-expanded','false');panelToggle.focus();layout();}};
const openDialog=(name:string)=>{release();playing=false;const dialog=part<HTMLDialogElement>(name),heading=dialog.querySelector<HTMLElement>('h2')!;dialog.showModal();heading.tabIndex=-1;heading.focus();dialog.scrollTop=0;};
const keysDialog=part<HTMLDialogElement>('keys'),settingsDialog=part<HTMLDialogElement>('settings');
part('keys-open').onclick=()=>openDialog('keys');part('keys-close').onclick=()=>keysDialog.close();
const trackingBox=part<HTMLInputElement>('set-tracking'),motionBox=part<HTMLInputElement>('set-motion'),holdSelect=part<HTMLSelectElement>('set-hold'),oneHandBox=part<HTMLInputElement>('set-onehand');
const cameraButton=part<HTMLButtonElement>('camera');
function syncTracking(){cameraButton.disabled=!settings.tracking;cameraButton.title=settings.tracking?'':'Hand tracking is off in Settings';}
const persist=()=>saveSettings(safeStorage(),settings);
part('settings-open').onclick=()=>{trackingBox.checked=settings.tracking;motionBox.checked=reduced();holdSelect.value=settings.hold;oneHandBox.checked=settings.oneHanded;openDialog('settings');};
part('settings-close').onclick=()=>settingsDialog.close();
trackingBox.onchange=()=>{settings.tracking=trackingBox.checked;persist();if(!settings.tracking){stopCamera();endPhoneCamera();}syncTracking();};
motionBox.onchange=()=>{settings.reducedMotion=motionBox.checked;persist();};
holdSelect.onchange=()=>{settings.hold=holdSelect.value as HoldTime;persist();};
oneHandBox.onchange=()=>{settings.oneHanded=oneHandBox.checked;persist();renderBar();walk.end();};
viewport.onkeydown=e=>{
 if(e.target!==viewport)return;
 if(e.key==='Escape'){release();return;}
 if(matchKey(e,'?')){e.preventDefault();if(!e.repeat)openDialog('keys');return;}
 if(matchKey(e,'i')){e.preventDefault();if(!e.repeat)setInk(!inkOn);return;}
 const entry=entries.find(x=>x.key&&matchKey(e,x.key));
 if(!entry)return;
 e.preventDefault();
 if(!e.repeat||entry.repeat)runAction(entry.id);
};
let presenter:WatchPresenter|null=null;
const shareButton=document.querySelector<HTMLButtonElement>(`#${id}-share`);
if(shareButton){
 const dialog=document.createElement('dialog');dialog.id=`${id}-share-dialog`;dialog.className='mirror-about mirror-share';
 dialog.setAttribute('aria-labelledby',`${id}-share-title`);dialog.innerHTML=`<h2 id="${id}-share-title">Share view</h2><p>Anyone with this link can watch this page live. They see what you see and cannot change anything.</p><input id="${id}-share-link" readonly aria-label="Watch link" value="Creating link…"><div class="mirror-share-row"><button id="${id}-share-copy" disabled>Copy</button><output id="${id}-share-count" aria-live="polite">0 watching</output></div><p id="${id}-share-error" class="mirror-share-error" role="alert" hidden></p><div class="mirror-share-row"><button id="${id}-share-stop">Stop sharing</button><button id="${id}-share-close">Back</button></div>`;
 $('#app main').append(dialog);
 const link=part<HTMLInputElement>('share-link'),copy=part<HTMLButtonElement>('share-copy'),count=part('share-count'),problem=part('share-error');
 const watchUrl=(code:string)=>`${location.origin}${location.pathname}?watch=${code}`;
 const refresh=()=>{
  const p=presenter;link.value=p?.code?watchUrl(p.code):p?.error?'':'Creating link…';copy.disabled=!p?.code;
  count.textContent=`${p?.viewers??0} watching`;problem.hidden=!p?.error;problem.textContent=p?.error??'';
  shareButton.textContent=p?.open?'Sharing':'Share view';shareButton.setAttribute('aria-pressed',String(!!p?.open));
 };
 const sample=()=>({state,pos:((engine.position%360)+360)%360,speed:engine.speed,playing,hands:frame.hands,stage:stageOf,inkOn,keep:inkMode.board.keep,strokes:inkMode.board.strokes,page:object.watch?.capture(engine)??{}});
 shareButton.onclick=()=>{void audio.start();if(!presenter){presenter=new WatchPresenter(()=>presenterUrl(session.token),sample,refresh,forgetRoom);void presenter.start();}else if(presenter.error&&!presenter.open)void presenter.start();refresh();dialog.showModal();};
 copy.onclick=async()=>{try{await navigator.clipboard.writeText(link.value);}catch{link.select();document.execCommand('copy');}copy.textContent='Copied';setTimeout(()=>{copy.textContent='Copy';},1500);};
 part('share-stop').onclick=()=>{presenter?.stop();presenter=null;refresh();dialog.close();};part('share-close').onclick=()=>dialog.close();
 window.addEventListener('pagehide',()=>presenter?.stop());
}
let stream:MediaStream|null=null,probe:HandProbe|null=null,cameraStarting=false,cameraGeneration=0;
const video=part<HTMLVideoElement>('video');
function stopCamera(){walk.end();cameraGeneration++;cameraStarting=false;probe?.stop();probe=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;tracker.reset();frame=empty();part('stage').classList.remove('is-live');part('camera').textContent='Step into the mirror';part('camera').removeAttribute('aria-pressed');}
function hands(raw:Landmark[][],at:number,world:Landmark[][],handedness:(string|null)[]=[],aspect=video.videoWidth/video.videoHeight||16/9){if(raw.length)lastHands=performance.now();const next=tracker.update(raw,at,world,handedness,aspect);presenter?.queue(next.events,stageOf);frame=carry(next);if(frame.events.some(e=>e.type==='clap')){shockAt=performance.now();walk.clap();}}
async function startCamera(){
 if(stream||cameraStarting){stopCamera();return;}
 if(!settings.tracking)return;
 const generation=++cameraGeneration;cameraStarting=true;void audio.start();part('camera').textContent='Opening camera…';
 try{
  const next=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});
  if(generation!==cameraGeneration){next.getTracks().forEach(t=>t.stop());return;}
  stream=next;video.srcObject=next;await video.play();if(generation!==cameraGeneration)return;
  endPhoneCamera();setAspect(video.videoWidth/video.videoHeight);
  // The skeleton is drawn in the object's own mirrored space, so the probe's raw overlay stays hidden.
  probe=new HandProbe(video,part<HTMLCanvasElement>('hand-overlay'),(data,message)=>{if(data.status==='error'){notice(message);stopCamera();}},(raw,at,world,meta)=>{if(owns&&!document.hidden&&document.hasFocus())hands(raw,at,world,meta?.handedness);else{tracker.reset();frame=empty();}},{preferGPU:true});
  probe.start();walk.first();part('stage').classList.add('is-live');part('camera').textContent='Leave the mirror';part('camera').setAttribute('aria-pressed','true');
 }catch(e){if(generation===cameraGeneration){stopCamera();notice(object.copy.cameraFallback+String(e));}}
 finally{if(generation===cameraGeneration)cameraStarting=false;}
}
part('camera').onclick=()=>void startCamera();
function lightGuide(){
 const poses=frame.hands.map(h=>h.pose),two=poses.length===2&&poses[0]===poses[1]?poses[0]:null,active=two==='pinch'?'both-pinch':two==='fist'?'both-fist':poses[0]??'';
 document.querySelectorAll<HTMLElement>('[data-gesture]').forEach(el=>{const id=el.dataset.gesture!;el.classList.toggle('is-on',id===active||poses.includes(id as never)&&two===null||id==='clap'&&performance.now()-shockAt<500);});
 part('stage').classList.toggle('has-hands',frame.hands.length>0);
}
let lastTick=performance.now(),stopped=false,lastReadout:number|string|null=null;
let lastSummary=-Infinity;
const summaryGate=textGate(1500);
function tick(now:number){
 if(stopped)return;
 const dt=Math.min(.05,(now-lastTick)/1000);lastTick=now;phone.tick(now);
 if(owner==='phone'&&!phone.held&&now-lastFine>500)finish('phone');
 if(playing&&!state.frozen&&!document.hidden)engine.kick(1);
 if(now-lastHands>350&&frame.hands.length){tracker.reset();frame=empty();}
 if(ready){
  // Idle motion stops whenever the object says so or the viewer asked for less.
  engine.idle=!!object.idles?.(state as State)&&!reduced()&&!paused;
  const out=engine.step(inkOn?inkSuppressed(frame):frame,dt,state.view,state.frozen);drawn=true;inkMode.update(frame,videoAspect,now);inkMode.render(now);
  if(out.holding){if(out.view&&begin('hand'))Object.assign(state.view,out.view);}else finish('hand');
  for(const sound of out.sounds)audio.play(sound);
  if(object.readout&&object.copy.readoutUnit){const value=object.readout(out as ReturnType<Engine['step']>);if(value!==lastReadout)part('count').textContent=String(lastReadout=value);}
  if(now-lastSummary>400){lastSummary=now;const text=summaryGate(summarise(),now);if(text!==null)summaryEl.textContent=text;syncPressed();}
  if(!engine.idle&&Math.abs(engine.speed)<.01&&!owner)state.phase=angle();
  view.setPose(state.view);view.draw(out.scene,now);lightGuide();if(!inkOn)walk.draw(now,{engine,state,scene:out.scene});
 }
 if(now-lastPublish>100&&lastDescriptor!==JSON.stringify(descriptor()))publish();
 requestAnimationFrame(tick);
}
syncTracking();renderBar();layout();
requestAnimationFrame(tick);
function interrupt(){release();playing=false;publish();}
window.addEventListener('blur',interrupt);document.addEventListener('visibilitychange',()=>{if(document.hidden){interrupt();stopCamera();}});document.addEventListener('studio-before-navigation',()=>{interrupt();stopCamera();});window.addEventListener('pagehide',()=>{stopped=true;stopCamera();release();client?.close();binding.close();audio.stop();view.dispose();});
return {engine,runAction,get actions(){return entries.map(({id,label,key,group})=>({id,label,key,group}));},get settings(){return {...settings,reducedMotion:reduced()};},get paused(){return paused;},get summary(){return summaryEl.textContent;},get tutorial(){return walk.view;},get state(){return structuredClone(state) as State;},get playing(){return playing;},get ready(){return ready;},get owns(){return owns;},get phoneHeld(){return phone.held;},get owner(){return owner;},get context(){return context;},get frame(){return frame;},get ink(){return inkMode;},get sharing(){return presenter;},get phoneFrames(){return phoneFrames;},get phoneCamera(){return phoneCamera;},hands(raw:Landmark[][],world:Landmark[][]=[],handedness:(string|null)[]=[]){hands(raw,performance.now(),world,handedness);}};
}
