import {getSession} from '../session';
import '../stand/style.css';
import './style.css';
import {Euler,Quaternion,Vector3} from 'three';
import {workspaceNav} from '../workspace-nav';
import {bindDocument} from '../documents';
import {ControlClient} from '../control';
import {HandProbe,type Landmark} from '../hand-probe';
import {FistGate} from '../fist';
import {validFrame,validQ,type InkFrame} from '../art/model';
import type {Packet,Quat} from '../types';
import {averageError,basis,centre,dataset,initialLesson,pca,pose,project,prompts,stages,titles,validateLesson,type Annotation,type LessonState,type Stage} from './model';
import {MathsView} from './view';
import {chapterStart,demoDuration,projectionChapters,projectionDemo} from './demo';

const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
document.title='Spatial Maths — Projection & PCA';
$('#app').innerHTML=`<header class="topbar"><a class="brand" href="/">◫ 3D STUDIO</a><span id="phone-status" class="connection-pill">Connect phone</span></header>${workspaceNav()}
<main class="stand-main maths-main"><div class="stand-intro"><div><h1>Spatial Maths</h1><p>From a point on a plane to principal component analysis.</p></div><div class="maths-intro-actions"><button id="demo-launch">Play projection demo</button><button id="camera-toggle">Enable webcam</button></div></div>
<div class="maths-steps" aria-label="Lesson examples">${stages.map((s,i)=>`<button data-stage="${s}">${i+1}. ${['Projection','Find a plane','New cloud'][i]}</button>`).join('')}</div>
<div class="lesson-question"><h2 id="lesson-title"></h2><p id="question"></p></div>
<section id="demo-panel" hidden aria-label="Projection demonstration"><div class="demo-controls"><button id="demo-previous" aria-label="Previous demo chapter">← Back</button><button id="demo-play">Pause</button><button id="demo-next" aria-label="Next demo chapter">Next →</button><span id="demo-counter"></span><label class="demo-voice"><input id="demo-voice" type="checkbox" checked> Voiceover</label><label class="demo-speed">Speed <select id="demo-speed" aria-label="Demo speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button id="demo-replay">Replay</button><button id="demo-close">Return to studio</button></div><input id="demo-timeline" type="range" min="0" max="76" step=".1" value="0" aria-label="Demo time"><p id="demo-equation"></p><span id="demo-audio-status" role="status" hidden></span><audio id="demo-audio" preload="auto" src="/audio/projection-narration.wav"></audio></section>
<div class="maths-layout"><section class="maths-card"><div class="stand-toolbar"><div><button data-tool="plane">Tilt plane</button><button data-tool="annotate">Annotate</button><button data-tool="orbit">Orbit view</button><button data-tool="pan">Move view</button></div><div><button id="undo">Undo</button><button id="reset-view">Center view</button></div></div>
<div id="maths-view" tabindex="0" role="application" aria-label="3D orthogonal projection"><div class="maths-key"><span class="original">● Original</span><span class="projected">● Projected</span><span id="pca-key" hidden>▱ PCA plane</span></div><div id="camera-preview" hidden><video id="hand-video" playsinline muted></video><canvas id="hand-overlay"></canvas></div><div class="stand-view-bottom"><span id="status" role="status">Drag to tilt the plane, or hold the phone pad.</span></div></div>
<div class="maths-plane-controls"><label>Plane tilt X <input id="tilt-x" type="range" min="-85" max="85" step="1" value="0"></label><label>Plane tilt Y <input id="tilt-y" type="range" min="-85" max="85" step="1" value="0"></label><label><input id="residuals" type="checkbox"> Show all lost components</label><button id="reveal">Reveal PCA plane</button></div>
<div id="camera-controls" class="stand-camera-controls" hidden><span id="gesture-status">Open your free hand, then make a fist to orbit.</span><label>Free hand <select id="hand-side"><option value="right">Right</option><option value="left">Left</option><option value="any">Either</option></select></label></div></section>
<aside class="maths-card maths-flat"><div class="flat-title"><h2>Two retained coordinates</h2><span>Same points, flattened</span></div><canvas id="flat-view" aria-label="Two-dimensional projection; select a point"></canvas><div id="point-details"></div><div class="maths-error"><span>Average squared reconstruction error</span><strong id="error-value"></strong><small>Lower means less squared distance lost · units²</small><p id="pca-details" hidden></p></div></aside></div>
<div class="maths-footer"><div class="maths-snapshots">${['A','B'].map((s,i)=>`<div><button data-save="${i}">Save view ${s}</button><button data-load="${i}" disabled>Show ${s}</button></div>`).join('')}<button id="export-image">Save image</button></div><details id="maths-equations"><summary>Show the maths</summary><p>For a plane through μ, let U contain its two perpendicular unit basis vectors.</p><p><code>z = Uᵀ(x − μ)</code> · keep two coordinates<br><code>x̂ = μ + Uz</code> · reconstruct in 3D<br><code>error = average ‖x − x̂‖²</code></p><p>PCA chooses the two-dimensional plane with the smallest squared reconstruction error. For the data clouds we subtract the mean first; all features use the same declared scale. Retained variance is not prediction accuracy.</p></details></div><p class="maths-footnote" id="lesson-note"></p></main>`;

let demoActive=false,demoPlaying=false,demoTime=0,demoLastNow=0,lastDemoRefresh=-1;
let demoRate=1,demoVoice=true,narrationUnavailable=false,demoPlayTicket=0;
const narration=$<HTMLAudioElement>('#demo-audio');narration.preservesPitch=true;narration.onerror=voiceUnavailable;
let state=initialLesson(),context=0,frozen=false,tool:'plane'|'annotate'|'orbit'|'pan'='plane';
let history:LessonState[]=[],before:LessonState|null=null,activeNote:string|null=null,mouseNote:string|null=null,inkChain=Promise.resolve();
let noteSource:'phone'|'mouse'|null=null,phoneInputAt=0,phoneVisible=true;
let phoneRef:Quaternion|null=null,phoneBase=new Quaternion(),phoneAt=0,source='',screenAngle=0,needsRelease=false;
let drag:{x:number;y:number;moved:boolean;view:LessonState['view'];q:Quat;tool:string}|null=null;
let stream:MediaStream|null=null,probe:HandProbe|null=null,cameraStarting=false,lastHand=0,handDrag:{x:number;y:number;view:LessonState['view']}|null=null;
const fist=new FistGate(),view=new MathsView($('#maths-view'),$<HTMLCanvasElement>('#flat-view'));
const binding=await bindDocument('maths:projection-pca',()=>state,v=>{state=validateLesson(v);state.annotations.forEach(n=>{n.finished=true;});tool=state.mode==='annotate'?'annotate':'plane';history=[];before=null;phoneRef=null;activeNote=null;noteSource=null;mouseNote=null;drag=null;handDrag=null;needsRelease=true;refresh();});
const session=await getSession();
const client=new ControlClient('desktop',session.token,receive,descriptor());
function frame():InkFrame{return {origin:centre(state.stage),q:[...state.q],aspect:1,color:'#2a60b0',width:.03,kind:'stable'};}
function descriptor(){const shown=demoActive?projectionDemo(demoTime).state:state;return {enabled:!demoActive,demoRunning:demoActive,frozen,context,stage:shown.stage,mode:shown.mode,canDraw:!demoActive&&state.mode==='annotate'&&state.annotations.length<40,kind:'stable',color:'#2a60b0',width:.03,pinned:state.mode==='annotate',frame:frame(),reveal:state.reveal,residuals:state.residuals};}
function publish(){client.send({type:'state',...descriptor()});}
function notify(message:string){$('#status').textContent=message;}
function remember(){before??=structuredClone(state);}
function commit(){if(before){if(JSON.stringify(before)!==JSON.stringify(state)){history.push(before);if(history.length>24)history.shift();}before=null;}}
function end(interrupted=false){if(activeNote){const n=state.annotations.find(n=>n.id===activeNote);if(n){n.finished=true;n.interrupted||=interrupted;}}activeNote=null;noteSource=null;mouseNote=null;phoneRef=null;drag=null;handDrag=null;fist.reset();commit();}
function change(fn:()=>void){if(demoActive)return;end(true);remember();fn();commit();needsRelease=true;context++;publish();refresh();}
function setStage(stage:Stage){change(()=>{state.stage=stage;state.q=new Quaternion().setFromEuler(new Euler(.4,-.25,0)).toArray() as Quat;if(stage==='point')state.q=[0,0,0,1];state.selected=0;state.annotations=[];state.reveal=false;state.residuals=false;state.mode='rotate';tool='plane';});}
function perform(action:string,value?:number){
  if(demoActive)return;
  if(action==='freeze'||action==='resume'){end();frozen=action==='freeze';needsRelease=true;context++;publish();refresh();return;}
  if(frozen)return;
  if(action==='undo'){end();const old=history.pop();if(old){state=old;tool=state.mode==='annotate'?'annotate':'plane';}needsRelease=true;context++;publish();refresh();return;}
  if(action==='math-annotate'||action==='math-rotate')change(()=>{state.mode=action==='math-annotate'?'annotate':'rotate';tool=state.mode==='annotate'?'annotate':'plane';});
  if(action==='math-next')setStage(stages[(stages.indexOf(state.stage)+1)%stages.length]);
  if(action==='math-reveal'&&state.stage!=='point')change(()=>{state.reveal=!state.reveal;});
  if(action==='math-residuals')change(()=>{state.residuals=!state.residuals;});
  if(action==='math-clear')change(()=>{state.annotations=[];});
  if(action==='math-save'&&value!==undefined&&Number.isInteger(value)&&value>=0&&value<2)change(()=>{state.saved[value]=pose(state);});
  if(action==='math-load'&&value!==undefined&&Number.isInteger(value)&&value>=0&&value<2&&state.saved[value])change(()=>{Object.assign(state,structuredClone(state.saved[value]));state.mode='rotate';tool='plane';});
}
function corrected(q:Quat,angle:number){return new Quaternion().fromArray(q).normalize().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-angle*Math.PI/180));}
function receive(p:Packet){
  if(p.type==='status')$('#phone-status').textContent=p.phoneConnected?'Phone connected':'Connect phone';
  if(demoActive&&['lost','local-release','disconnected'].includes(p.type))pauseDemo();
  if(demoActive&&['frame','action','ink'].includes(p.type))return;
  if(['lost','local-release','phone-lost','disconnected'].includes(p.type)){end(true);phoneVisible=false;needsRelease=true;void binding.flush().catch(()=>{});}
  if(['frame','action','ink'].includes(p.type)&&p.context!==context)return;
  if(p.type==='action')perform(String(p.action),typeof p.value==='number'?p.value:undefined);
  if(p.type==='frame'){
    phoneInputAt=performance.now();phoneVisible=!!p.visible||p.stale===true&&p.visibleAtCapture===true;
    if(!phoneVisible){if(phoneRef||noteSource==='phone')end(true);needsRelease=true;refresh();return;}
    if(p.stale){if(phoneRef)end();needsRelease=true;return;}
    if(!p.hold){if(phoneRef)end();needsRelease=false;return;}
    if(!p.active||!p.visible||!validQ(p.q)||frozen||state.mode!=='rotate'||activeNote||drag||needsRelease){if(phoneRef)end();return;}
    const angle=Number(p.screenAngle);if(!Number.isFinite(angle))return;
    if(phoneRef&&(source!==p.source||screenAngle!==angle)){end();needsRelease=true;return;}
    const q=corrected(p.q as Quat,angle);phoneAt=performance.now();
    if(!phoneRef){remember();phoneRef=q;phoneBase.fromArray(state.q);source=String(p.source);screenAngle=angle;}
    state.q=phoneBase.clone().multiply(phoneRef.clone().invert().multiply(q)).normalize().toArray() as Quat;refresh();
  }
  if(p.type==='ink'){inkChain=inkChain.then(()=>ink(p)).catch(e=>notify('Could not save annotation: '+String(e)));}
}
async function ink(p:Packet){
  if(demoActive||p.context!==context||p.documentId!==binding.id)return;
  const id=String(p.strokeId),samples=p.points as number[][],start=Number(p.start);
  const reject=(reason:string)=>client.send({type:'ink-rejected',documentId:binding.id,strokeId:id,index:-1,reason});
  if(!phoneVisible){reject('Phone paused. Return to the controller and begin a new stroke.');return;}
  if(!validFrame(p.frame)||!Array.isArray(samples)||!Number.isSafeInteger(start)||start<0||samples.some(p=>!Array.isArray(p)||p.length!==7||!p.every(Number.isFinite)||Math.abs(p[0])>.5||Math.abs(p[1])>.5))return;
  let note=state.annotations.find(n=>n.id===id);
  if(!note){
    if(start!==0||state.mode!=='annotate'||frozen||phoneRef||drag||activeNote&&activeNote!==id||state.annotations.length>=40){reject('Choose Annotate and begin a fresh stroke.');return;}
    const f=p.frame as InkFrame;
    if(Math.abs(new Quaternion().fromArray(f.q).dot(new Quaternion().fromArray(state.q)))<.99999||new Vector3(...f.origin).distanceTo(new Vector3(...centre(state.stage)))>1e-6||f.aspect!==1){reject('The plane changed. Begin a fresh annotation.');return;}
    remember();note={id,frame:frame(),points:[],finished:false,interrupted:false};state.annotations.push(note);activeNote=id;noteSource='phone';phoneInputAt=performance.now();handDrag=null;fist.reset();
  }
  if(start>note.points.length)return;
  if(note.finished&&start+samples.length>note.points.length){reject('Control paused. The saved part of the annotation was kept; draw the rest as a new stroke.');return;}
  if(!note.finished){
    const fresh=samples.slice(Math.max(0,note.points.length-start));
    if(note.points.length+fresh.length>512){end();reject('Annotation full. Begin another stroke.');return;}
    note.points.push(...fresh.map(p=>[p[0],p[1]] as [number,number]));
    if(p.finished){note.interrupted=!!p.interrupted;note.finished=true;if(activeNote===id)end();}
  }
  const count=note.points.length,finished=note.finished;refresh();await binding.flush();
  if(p.context===context)client.send({type:'checkpoint',documentId:binding.id,strokeId:id,index:count-1,finished});
}

function refresh(lesson:LessonState=state){
  const state=lesson;
  const points=dataset(state.stage),origin=centre(state.stage),best=pca(points),error=averageError(points,origin,state.q),selected=project(points[state.selected],origin,state.q);
  $('#lesson-title').textContent=titles[state.stage];$('#question').textContent=prompts[state.stage];$('#error-value').textContent=demoActive?Math.abs(selected.distance).toFixed(2):error.toFixed(3);
  $('.maths-error>span').textContent=demoActive?'Perpendicular distance discarded':'Average squared reconstruction error';
  $('.maths-error>small').textContent=demoActive?'Length of the pink segment · units':'Lower means less squared distance lost · units²';
  const fmt=(p:number[])=>p.map(n=>(Math.abs(n)<.0005?0:n).toFixed(2)).join(', ');
  $('#point-details').innerHTML=`<span>Selected point ${state.selected+1} of ${points.length}</span><p><b>x</b> (${fmt(points[state.selected])})</p><p><b>z</b> (${fmt(selected.z)}) <small>two retained coordinates</small></p><p><b>x̂</b> (${fmt(selected.reconstructed)})</p><p>Lost distance: ${Math.abs(selected.distance).toFixed(2)}</p>`;
  $('#pca-details').hidden=!state.reveal||state.stage==='point';$('#pca-key').hidden=!state.reveal||state.stage==='point';
  $('#pca-details').textContent=`PCA minimum: ${best.error.toFixed(3)} units² · retained variance: ${(100*best.retained/best.total).toFixed(1)}%. Your plane retains ${(100*Math.max(0,1-error/best.total)).toFixed(1)}%.`;
  $('#reveal').hidden=state.stage==='point';$('#reveal').textContent=state.reveal?'Hide PCA plane':'Reveal PCA plane';$<HTMLInputElement>('#residuals').checked=state.residuals;
  $('#lesson-note').textContent=state.stage==='point'?'First example: plane through the origin. The highlighted segment is perpendicular to the plane.':'Synthetic features share one scale. The plane passes through the data mean. Orbiting the camera does not change the projection or error.';
  document.querySelectorAll<HTMLElement>('[data-stage]').forEach(el=>el.classList.toggle('active',el.dataset.stage===state.stage));
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(el=>el.classList.toggle('active',el.dataset.tool===tool));
  document.querySelectorAll<HTMLButtonElement>('[data-load]').forEach(el=>el.disabled=!state.saved[Number(el.dataset.load)]);
  $<HTMLButtonElement>('#undo').disabled=!history.length;
  for(const axis of ['x','y'] as const){const input=$<HTMLInputElement>('#tilt-'+axis);input.disabled=demoActive||!!phoneRef||!!activeNote||frozen||state.mode==='annotate';if(document.activeElement!==input){const e=new Euler().setFromQuaternion(new Quaternion().fromArray(state.q));input.value=String(e[axis]*180/Math.PI);}}
}
document.querySelectorAll<HTMLElement>('[data-stage]').forEach(el=>el.onclick=()=>{if(client.active)setStage(el.dataset.stage as Stage);});
document.querySelectorAll<HTMLElement>('[data-tool]').forEach(el=>el.onclick=()=>{if(demoActive||!client.active||frozen)return;change(()=>{tool=el.dataset.tool as typeof tool;state.mode=tool==='annotate'?'annotate':'rotate';});notify(tool==='annotate'?'Plane pinned. Draw on the phone pad or on the plane.':tool==='plane'?'Drag to tilt the plane, or hold the phone pad.':'Drag to move the view. Scroll to zoom.');});
$('#undo').onclick=()=>perform('undo');$('#residuals').onchange=()=>perform('math-residuals');$('#reveal').onclick=()=>perform('math-reveal');
$('#reset-view').onclick=()=>change(()=>{state.view=initialLesson().view;});
document.querySelectorAll<HTMLElement>('[data-save]').forEach(el=>el.onclick=()=>perform('math-save',Number(el.dataset.save)));
document.querySelectorAll<HTMLElement>('[data-load]').forEach(el=>el.onclick=()=>perform('math-load',Number(el.dataset.load)));
for(const axis of ['x','y']){
  const input=$<HTMLInputElement>('#tilt-'+axis);input.oninput=()=>{if(demoActive||frozen||phoneRef||activeNote)return;remember();state.q=new Quaternion().setFromEuler(new Euler(Number($<HTMLInputElement>('#tilt-x').value)*Math.PI/180,Number($<HTMLInputElement>('#tilt-y').value)*Math.PI/180,0)).toArray() as Quat;refresh();};
  for(const event of ['change','pointerup','blur'])input.addEventListener(event,()=>{commit();publish();});
}
const host=$('#maths-view');
host.onpointerdown=e=>{if(demoActive||e.button!==0||!client.active||frozen||phoneRef||activeNote||(e.target as HTMLElement).closest('button'))return;host.setPointerCapture(e.pointerId);handDrag=null;fist.reset();
  if(tool==='annotate'){const uv=view.onPlane(e.clientX,e.clientY);if(!uv||state.annotations.length>=40)return;remember();const note:Annotation={id:crypto.randomUUID(),frame:frame(),points:[uv],finished:false,interrupted:false};state.annotations.push(note);mouseNote=activeNote=note.id;noteSource='mouse';}
  else{remember();drag={x:e.clientX,y:e.clientY,moved:false,view:{...state.view},q:[...state.q],tool};}
};
host.onpointermove=e=>{if(mouseNote){const uv=view.onPlane(e.clientX,e.clientY),note=state.annotations.find(n=>n.id===mouseNote);if(uv&&note&&note.points.length<512){note.points.push(uv);refresh();}return;}
  if(!drag)return;const dx=(e.clientX-drag.x)/host.clientWidth,dy=(e.clientY-drag.y)/host.clientHeight;drag.moved||=Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>4;
  if(drag.tool==='plane')state.q=new Quaternion().setFromEuler(new Euler(dy*3,dx*3,0)).multiply(new Quaternion().fromArray(drag.q)).normalize().toArray() as Quat;
  if(drag.tool==='orbit'){state.view.yaw=wrap(drag.view.yaw-dx*4);state.view.pitch=Math.max(-1.3,Math.min(1.3,drag.view.pitch+dy*3));}
  if(drag.tool==='pan'){state.view.x=Math.max(-8,Math.min(8,drag.view.x-dx*10));state.view.y=Math.max(-8,Math.min(8,drag.view.y+dy*10));}refresh();
};
for(const event of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(event,e=>{if(event==='pointerup'&&drag&&!drag.moved){const i=view.pick((e as PointerEvent).clientX,(e as PointerEvent).clientY);if(i!==null)state.selected=i;}if(drag||mouseNote){end(event!=='pointerup');refresh();publish();}});
host.addEventListener('wheel',e=>{e.preventDefault();if(demoActive||!client.active||frozen||activeNote)return;state.view.zoom=Math.max(.5,Math.min(2.5,state.view.zoom*Math.exp(-e.deltaY*.001)));},{passive:false});
$('#flat-view').onclick=e=>{if(demoActive)return;const i=view.pickFlat(e.clientX,e.clientY);if(i!==null){state.selected=i;refresh();}};
$('#export-image').onclick=()=>{if(demoActive)return;view.update(state);const flat=$<HTMLCanvasElement>('#flat-view'),image=document.createElement('canvas');image.width=1600;image.height=850;const c=image.getContext('2d')!;c.fillStyle='#f5f7ef';c.fillRect(0,0,1600,850);c.fillStyle='#173b30';c.font='30px sans-serif';c.fillText('Spatial Maths · '+titles[state.stage],40,55);c.font='18px sans-serif';c.fillText(prompts[state.stage],40,90);c.drawImage(view.renderer.domElement,25,120,1050,640);c.drawImage(flat,1100,170,460,460);c.font='18px sans-serif';c.fillText('Original (green) · projected (amber) · selected (pink)',40,795);c.fillText('Average squared reconstruction error: '+$('#error-value').textContent+' units²',40,825);const link=document.createElement('a');link.href=image.toDataURL('image/png');link.download='spatial-maths-'+state.stage+'.png';link.click();};

function stopCamera(){probe?.stop();probe=null;stream?.getTracks().forEach(t=>t.stop());stream=null;$('#camera-preview').hidden=true;$('#camera-controls').hidden=true;$('#camera-toggle').textContent='Enable webcam';handDrag=null;fist.reset();}
function wrap(angle:number){return Math.atan2(Math.sin(angle),Math.cos(angle));}
$('#camera-toggle').onclick=async()=>{if(stream){stopCamera();return;}if(cameraStarting)return;cameraStarting=true;try{stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});const video=$<HTMLVideoElement>('#hand-video');video.srcObject=stream;await video.play();$('#camera-preview').hidden=false;$('#camera-controls').hidden=false;$('#camera-toggle').textContent='Stop webcam';probe=new HandProbe(video,$<HTMLCanvasElement>('#hand-overlay'),(_,message)=>{if(message.startsWith('Hand tracking:')){stopCamera();notify(message);}},hands);probe.start();}catch(e){stopCamera();notify(String(e));}finally{cameraStarting=false;}};
$('#hand-side').onchange=()=>{fist.region=$<HTMLSelectElement>('#hand-side').value as typeof fist.region;fist.reset();handDrag=null;};
function hands(list:Landmark[][],at:number,world:Landmark[][]){
  if(demoActive||!client.active||document.hidden||!document.hasFocus()||frozen||activeNote||drag){handDrag=null;fist.reset();return;}lastHand=performance.now();const video=$<HTMLVideoElement>('#hand-video'),f=fist.update(list,at,{minX:0,maxX:1,minY:0,maxY:1},world,video.videoWidth/Math.max(1,video.videoHeight));$('#gesture-status').textContent=f.message;
  if(f.phase==='start')handDrag={x:f.x,y:f.y,view:{...state.view}};
  if(f.phase==='move'&&handDrag){state.view.yaw=wrap(handDrag.view.yaw-(f.x-handDrag.x)*4);state.view.pitch=Math.max(-1.3,Math.min(1.3,handDrag.view.pitch+(f.y-handDrag.y)*3));}
  if(f.phase==='end')handDrag=null;
}
document.addEventListener('studio-before-navigation',()=>{pauseDemo();end(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseDemo();end(true);stopCamera();needsRelease=true;}});
window.addEventListener('pagehide',()=>{pauseDemo();end(true);stopCamera();client.close();binding.close();view.dispose();});
let lastPublish=0;
function tick(now:number){if(demoActive){tickDemo(now);if(now-lastPublish>120){publish();lastPublish=now;}requestAnimationFrame(tick);return;}if(phoneRef&&now-phoneAt>400||noteSource==='phone'&&now-phoneInputAt>400){end(true);needsRelease=true;notify('Phone paused. Release the pad before continuing.');refresh();}if(handDrag&&now-lastHand>250){handDrag=null;fist.reset();}view.update(state);if(now-lastPublish>120){publish();lastPublish=now;}requestAnimationFrame(tick);}
function pauseDemo(){
  if(demoPlaying&&!narrationUnavailable)demoTime=Math.max(0,Math.min(demoDuration,narration.currentTime));
  narration.pause();demoPlayTicket++;demoPlaying=false;demoLastNow=0;if(demoActive)refreshDemo();
}
function voiceUnavailable(){
  narration.pause();narrationUnavailable=true;demoLastNow=0;
  $('#demo-audio-status').hidden=false;$('#demo-audio-status').textContent='Voiceover unavailable. Captions and playback still work.';
  $<HTMLInputElement>('#demo-voice').disabled=true;
}
function playDemo(){
  if(!demoActive||!client.active)return;demoPlaying=true;demoLastNow=0;
  if(!narrationUnavailable){
    const ticket=++demoPlayTicket;
    try{narration.currentTime=demoTime;narration.playbackRate=demoRate;narration.muted=!demoVoice;
      void narration.play().catch(()=>{if(ticket===demoPlayTicket&&demoPlaying&&demoActive)voiceUnavailable();});
    }catch{voiceUnavailable();}
  }
  refreshDemo();
}
narration.onended=()=>{if(demoActive&&demoPlaying){demoTime=demoDuration;demoPlaying=false;demoLastNow=0;refreshDemo();}};
function refreshDemo(){
  const current=projectionDemo(demoTime);refresh(current.state);
  $('#lesson-title').textContent=current.title;$('#question').textContent=current.caption;
  $('#demo-equation').textContent=current.equation;$('#demo-counter').textContent=`${current.chapter+1} / ${projectionChapters.length} · ${Math.floor(demoTime)}s / ${demoDuration}s`;
  $('#demo-play').textContent=demoPlaying?'Pause':current.finished?'Play again':'Play';
  $<HTMLInputElement>('#demo-timeline').value=String(demoTime);$<HTMLButtonElement>('#demo-previous').disabled=current.chapter===0;$<HTMLButtonElement>('#demo-next').disabled=current.chapter===projectionChapters.length-1;
  $('#status').textContent='Green: original vector · amber: projection · pink: discarded component';
  $('#lesson-note').textContent='This demonstration is separate from your saved work. Return to studio restores your lesson and drawings.';
}
function startDemo(play=true){
  if(!client.active)return;end(true);demoActive=true;demoPlaying=false;demoTime=0;demoLastNow=0;lastDemoRefresh=-1;needsRelease=true;context++;
  document.body.classList.add('projection-demo');$('#demo-panel').hidden=false;$('#demo-launch').hidden=true;
  for(const el of document.querySelectorAll<HTMLButtonElement|HTMLInputElement>('.maths-steps button,.stand-toolbar button,.maths-plane-controls button,.maths-plane-controls input,.maths-snapshots button'))el.disabled=true;
  $<HTMLInputElement>('#demo-timeline').max=String(demoDuration);refreshDemo();publish();if(play)playDemo();
}
function closeDemo(){
  pauseDemo();demoActive=false;demoPlaying=false;demoLastNow=0;needsRelease=true;context++;
  document.body.classList.remove('projection-demo');$('#demo-panel').hidden=true;$('#demo-launch').hidden=false;
  for(const el of document.querySelectorAll<HTMLButtonElement|HTMLInputElement>('.maths-steps button,.stand-toolbar button,.maths-plane-controls button,.maths-plane-controls input,.maths-snapshots button'))el.disabled=false;
  refresh();publish();
}
function tickDemo(now:number){
  if(demoPlaying&&(!client.active||document.hidden||!document.hasFocus()))pauseDemo();
  if(demoPlaying){if(!narrationUnavailable)demoTime=Math.min(demoDuration,narration.currentTime);else if(demoLastNow)demoTime=Math.min(demoDuration,demoTime+(now-demoLastNow)/1000*demoRate);demoLastNow=now;if(demoTime>=demoDuration){narration.pause();demoPlaying=false;demoLastNow=0;}}
  view.update(projectionDemo(demoTime).state,true);
  if(Math.abs(demoTime-lastDemoRefresh)>.075||!demoPlaying){refreshDemo();lastDemoRefresh=demoTime;}
}
$('#demo-launch').onclick=()=>startDemo();$('#demo-close').onclick=closeDemo;
$('#demo-play').onclick=()=>{if(!client.active)return;if(demoPlaying){pauseDemo();return;}if(demoTime>=demoDuration)demoTime=0;playDemo();};
$('#demo-replay').onclick=()=>{if(!client.active)return;pauseDemo();demoTime=0;playDemo();};
$('#demo-speed').onchange=()=>{const rate=Number($<HTMLSelectElement>('#demo-speed').value);if(![.75,1,1.25,1.5,2].includes(rate))return;demoRate=rate;narration.playbackRate=rate;demoLastNow=0;};
$('#demo-voice').onchange=()=>{demoVoice=$<HTMLInputElement>('#demo-voice').checked;narration.muted=!demoVoice;};
for(const [id,delta] of [['demo-previous',-1],['demo-next',1]] as const)$('#'+id).onclick=()=>{if(!client.active)return;pauseDemo();const chapter=Math.max(0,Math.min(projectionChapters.length-1,projectionDemo(demoTime).chapter+delta));demoTime=chapterStart(chapter);refreshDemo();};
$('#demo-timeline').oninput=()=>{const time=Number($<HTMLInputElement>('#demo-timeline').value);pauseDemo();demoTime=Math.max(0,Math.min(demoDuration,time));refreshDemo();};
refresh();requestAnimationFrame(tick);
if(new URLSearchParams(location.search).get('demo')==='projection'){
  const launch=setInterval(()=>{if(client.active){clearInterval(launch);startDemo(false);}},100);window.addEventListener('pagehide',()=>clearInterval(launch),{once:true});
}
(window as unknown as Record<string,unknown>).__mathsStudio={get state(){return structuredClone(state);},get error(){return averageError(dataset(state.stage),centre(state.stage),state.q);},get pca(){return pca(dataset(state.stage));},get active(){return client.active;},get holding(){return !!phoneRef;},get context(){return context;},get demo(){return {active:demoActive,playing:demoPlaying,time:demoTime,rate:demoRate,voiceover:demoVoice,audioTime:narration.currentTime,audioPaused:narration.paused,audioUnavailable:narrationUnavailable,chapter:projectionDemo(demoTime).chapter,duration:demoDuration,state:demoActive?projectionDemo(demoTime).state:null};}};
