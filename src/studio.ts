import {getSession,webcamOnly,hosted} from './session';
import {bindDocument} from './documents';
import './mirror/stage.css';
import './studio.css';
import {workspaceNav,shapeFromPath,shapeRoutes} from './workspace-nav';
import {Euler,Quaternion} from 'three';
import {SceneView,sectionSvg} from './scene-view';
import {SceneStore,cloneState,planeAngles,planeNormal,type SceneState} from './scene-state';
import {section,objectPlane,type Section,type Solid} from './geometry';
import {PhoneInput} from './phone-input';
import {Transport} from './transport';
import {HandProbe} from './hand-probe';
import {FistGate} from './fist';
import {challenges,examples,TaskSession} from './challenges';
import {percentile} from './stats';
import type {Packet,Quat,SensorReading} from './types';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const all=<T extends HTMLElement=HTMLElement>(s:string)=>[...document.querySelectorAll<T>(s)];
const escape=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const store=new SceneStore(),phone=new PhoneInput(store),tasks=new TaskSession(),fist=new FistGate();
const initialShape=shapeFromPath(location.pathname);if(initialShape)store.state.solid=initialShape;
let mode='mouse',phoneConnected=false,phoneActive=false,phoneRate=0,rtt:number|null=null,dirty=true,lastRevision=-1;
let cut:Section=section('cone',planeNormal(store.state),0),explanation=false;
let stream:MediaStream|null=null,probe:HandProbe|null=null,lastHands=0,handBase:SceneState|null=null,handStart={x:0,y:0};
type Tool='move'|'rotate'|'zoom'|'height';
let tool:Tool='move';let handCursor={x:0,y:0},lastHandMove=0;
const toolNames:Record<Tool,string>={move:'Move view (X/Y)',rotate:'Rotate solid',zoom:'Zoom',height:'Cut height'};
let handStats:Record<string,unknown>={status:'off'};let cameraStarting=false,handRegionChosen=false;
const saved:{id:number;state:SceneState;label:string;area:number}[]=[];const renderIntervals:number[]=[];let lastRender=performance.now(),receiveAt:number|null=null;const receiveToRender:number[]=[];
document.title='Section Studio — 3D workspace';
$('#app').innerHTML=`<div class="studio-shell mirror-workspace">${workspaceNav(true)}
 <main class="studio-main"><div id="solid-view" class="mirror-workspace-stage" tabindex="0" role="application" aria-label="Interactive 3D studio. Choose Move X/Y, Rotate, Zoom or Cut height, then drag. Scroll to zoom."><div class="viewport-zoom" role="group" aria-label="View zoom"><button id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button><output id="zoom-readout">100%</output><button id="zoom-out" title="Zoom out" aria-label="Zoom out">−</button><button id="reset-view" title="Center view and reset zoom" aria-label="Center view and reset zoom">⌖</button></div><div class="viewport-note"><span class="live-dot"></span><span id="viewport-state">Ready to explore</span></div><div class="viewport-bottom"><span><i class="section-dot"></i>Cut surface</span><span id="plane-equation">y = 0.00</span></div></div>
 <header class="topbar"><a class="brand" href="/"><span class="brand-mark">◫</span><span>SECTION<span class="brand-light">STUDIO</span></span></a><div class="studio-header-right"><details class="workspace-menu"><summary>More</summary><nav><a href="/lab">Hardware lab</a></nav></details><button id="connect-help" class="phone-badge"><i></i><span id="phone-label">Connect your phone</span></button></div></header>
 <section class="studio-intro"><h1>3D workspace</h1><p>Choose a shape. Move, rotate or slice.</p><div class="mode-picker" role="group" aria-label="Input mode"><button data-mode="mouse" class="active">Mouse</button><button data-mode="phone">Phone + mouse</button><button data-mode="webcam">Phone + webcam</button></div></section>
 <div class="workspace-toolbar"><div class="workspace-actions"><button id="camera-shortcut" class="studio-button" aria-pressed="false">Enable webcam</button><button id="undo" class="studio-button" disabled title="Undo the last manipulation (Ctrl/Cmd+Z)">↶ <span>Undo</span></button><button id="reset" class="studio-button">↺ <span>Reset</span></button><button id="freeze-scene" class="studio-button freeze-button" aria-pressed="false">Ⅱ <span>Freeze</span></button></div></div>
 <div class="manipulation-tools" role="group" aria-label="Mouse and fist drag tool"><span>DRAG TOOL</span><button data-tool="move" class="active" aria-pressed="true">↔ Move X/Y</button><button data-tool="rotate" aria-pressed="false">↻ Rotate</button><button data-tool="zoom" aria-pressed="false">⊕ Zoom</button><button data-tool="height" aria-pressed="false">↕ Cut height</button></div>
 <span class="view-note" id="view-hint">Drag to move view · scroll to zoom</span>
 <div class="examples-row"><span>Presets</span><button data-example="circle">○ Circle</button><button data-example="ellipse">⬭ Ellipse</button><button data-example="triangle">△ Triangle</button></div>
 <section id="task-banner" class="task-banner" hidden aria-live="polite"><div><span class="eyebrow">GUIDED CHALLENGE</span><h3 id="task-title"></h3><p id="task-instruction"></p><span id="task-score"></span></div><div><strong id="task-time">0.0s</strong><button id="cancel-task" class="studio-button">End challenge</button></div></section>
 <aside id="studio-drawer" class="studio-drawer mirror-drawer" aria-label="Section tools"><div class="drawer-head"><span>Section tools</span><button id="drawer-toggle" type="button" aria-expanded="true" aria-controls="drawer-body">Hide</button></div><div id="drawer-body" class="drawer-body">
 <section id="camera-card" class="camera-card" hidden><div class="camera-copy"><h2>Hand control</h2><p>Close a fist to move. Open your hand to release.</p><label for="hand-region">Hand region <select id="hand-region"><option value="">choose a side…</option><option value="right">right half</option><option value="left">left half</option><option value="any">Both sides</option></select></label><p class="gesture-tool-note" id="gesture-tool-note">Selected: Move view (X/Y). Move your fist left/right or up/down.</p><p id="gesture-state" class="gesture-state" role="status">Camera is off.</p><button id="camera-toggle" class="studio-button dark">Enable webcam</button><p class="camera-privacy">Camera frames stay on this computer.</p></div><div class="camera-preview-wrap"><video id="gesture-video" playsinline muted hidden></video><canvas id="gesture-overlay"></canvas><div id="camera-placeholder"><span>◎</span><p>Camera preview</p></div><span class="camera-mirror-label">MIRRORED PREVIEW</span></div></section>
 <section class="section-panel"><div class="panel-heading"><span>THE SECTION</span><span class="face-on-tag">FACE-ON VIEW</span></div><div id="section-view">${sectionSvg(cut)}</div><div class="section-description"><div class="section-title-row"><h2 id="section-name">Circle</h2><span id="section-type">CLOSED CURVE</span></div><div class="section-metrics"><div><span>AREA <small id="approx-label">≈</small></span><strong id="area">0.785 <small>u²</small></strong></div><div><span>PERIMETER</span><strong id="perimeter">3.141 <small>u</small></strong></div><button id="save-cut" class="save-cut" title="Save a snapshot of this cut">＋<span>Save cut</span></button></div><button id="explain" class="explain-button" aria-expanded="false">Why this shape? <span>↗</span></button><p id="explanation" hidden></p><p class="section-footnote">Same cut, without perspective distortion.<br>1 u = the solid’s radius or half the cube’s side.</p></div></section>
 <section class="control-strip"><div class="control-strip-title"><strong>Cutting plane</strong><p id="input-hint">Use the sliders, or connect your phone.</p></div><div class="plane-sliders"><label for="pitch">Tilt <output id="pitch-value">0°</output><input id="pitch" type="range" min="-180" max="180" value="0" step="1"></label><label for="roll">Roll <output id="roll-value">0°</output><input id="roll" type="range" min="-90" max="90" value="0" step="1"></label><label for="cut-depth">Cut height / depth <output id="cut-depth-value">0.00 u</output><input id="cut-depth" type="range" min="-1.8" max="1.8" value="0" step=".01"></label></div></section>
 <section class="view-control-strip"><div><strong>View</strong></div><div class="view-sliders"><label for="view-x">View X <output id="view-x-value">0.00</output><input id="view-x" type="range" min="-3" max="3" step=".01" value="0"></label><label for="view-y">View Y <output id="view-y-value">0.00</output><input id="view-y" type="range" min="-3" max="3" step=".01" value="0"></label><label for="view-zoom">Zoom <output id="view-zoom-value">100%</output><input id="view-zoom" type="range" min=".5" max="3" step=".01" value="1"></label></div></section>
 <section id="saved-section" class="saved-section" hidden><div class="section-heading"><div><span class="section-number">↳</span><h2>Saved cuts</h2></div><span>Click a cut to restore its frozen snapshot</span></div><div id="saved-cuts" class="saved-cuts"></div></section>
 <details id="extra-tools" class="extra-tools"><summary>Extra tools</summary><section class="challenge-section"><div class="section-heading"><div><span class="section-number">↳</span><h2>Shape challenges</h2></div><button id="export-session" class="studio-button">Export session ↗</button></div><p class="challenge-intro">Try the same task with different controls. Match the amber target and hold for a moment.</p><div class="challenge-cards">${challenges.map((c,i)=>`<button class="challenge-tile" data-challenge="${c.id}"><span class="challenge-number">0${i+1}<span>↗</span></span><span class="challenge-illustration">${['○','⬭','△','◇'][i]}</span><strong>${c.title}</strong><span>${['Make a level cut through the cone.','Discover a complete ellipse.','Cut a corner of the cube.','Compare mouse and hand rotation.'][i]}</span><small>${i===3?'OBJECT ROTATION':'PLANE CONTROL'}</small></button>`).join('')}</div><div id="task-result" class="task-result" role="status"></div><label id="comfort-label" class="comfort-label" hidden>How comfortable were these controls? <select id="comfort"><option value="">Choose a rating</option><option value="1">1 · Very comfortable</option><option value="2">2 · Comfortable</option><option value="3">3 · Neutral</option><option value="4">4 · Uncomfortable</option><option value="5">5 · Very uncomfortable</option></select></label></section>
 <details class="studio-diagnostics"><summary>Diagnostics</summary><div id="session-diagnostics"></div><p>Arrival timing and inference timing do not measure physical motion-to-photon latency. Curves use a 256-segment mesh; displayed curved areas and perimeters are approximate.</p></details></details>
 <footer><span>Section Studio</span></footer></div></aside></main>
 <dialog id="connection-guide"><button id="close-guide" class="dialog-close" aria-label="Close connection guide">×</button><h2>Connect phone</h2><ol><li>Connect your unlocked Android phone with USB debugging authorized.</li><li>In the project’s terminal, run <code>npm run phone</code>.</li><li>On your phone, tap <strong>Start sensors</strong>. Select <strong>Phone + mouse</strong> here, then hold the phone’s pad and tilt.</li></ol><p>Each hold sets a fresh neutral pose. Release to keep the plane still; use the depth slider to move the cut inward. <a href="/lab">Open the hardware lab ↗</a></p></dialog></div>`;
// Keep a small live preview alongside the object instead of sending the user down the page.
const cameraPreview=$('.camera-preview-wrap');cameraPreview.hidden=true;$('#solid-view').append(cameraPreview);
let view:SceneView;
try{view=new SceneView($('#solid-view'));}catch(e){$('#solid-view').innerHTML=`<p class="render-error">3D rendering could not start: ${escape(e)}</p>`;throw e;}
const session=await getSession();
let restoredMode='mouse',uiReady=false;
await bindDocument('shapes',()=>({state:cloneState(store.state),saved,mode}),value=>{
 if(value?.state&&['cone','cylinder','cube'].includes(value.state.solid)){store.state=cloneState(value.state);store.history=[];store.revision++;}
 if(Array.isArray(value?.saved)){saved.splice(0,saved.length,...value.saved.slice(0,6));renderSavedCuts();}
 restoredMode=['phone','webcam'].includes(value?.mode)?value.mode:'mouse';if(uiReady)setMode(restoredMode);dirty=true;
});
if(initialShape)store.state.solid=initialShape;
const transport=new Transport('desktop',session.token,receive,connected=>{if(!connected){phoneConnected=false;phoneActive=false;phone.release();updateConnection();}});
store.onChange=()=>{dirty=true;};
function updateConnection(){
 $('#phone-label').textContent=phoneConnected?(phoneActive?'Phone ready':'Phone connected · start sensors'):'Connect your phone';$('#connect-help').classList.toggle('connected',phoneConnected&&phoneActive);
 $('#input-hint').textContent=mode==='mouse'?'Choose a drag tool. Cut height moves the plane through the solid.':webcamOnly?'Open your hand, close a fist, then move. Use the sliders to tilt the plane.':phoneConnected&&phoneActive?'The phone tilts the plane. Cut height moves it through the solid.':'Drag tools are ready. Connect the phone to add plane tilt.';
}
function receive(p:Packet){
 if(p.type==='workspace-paused'){releaseInputs();phoneActive=false;$('#phone-label').textContent='Phone follows the active workspace';}
 if(p.type==='workspace-available'){phone.release();lastFeedback='';updateConnection();}
 if(p.type==='connection'){const previous=phoneConnected;phoneConnected=Boolean(p.connected);if(hosted&&phoneConnected&&!previous&&mode==='mouse')setMode('phone');if(!phoneConnected){phoneActive=false;phone.release();tasks.event('phoneDisconnect');}updateConnection();}
 if(p.type==='frame'){receiveAt=performance.now();phoneActive=Boolean(p.active&&p.visible);if(document.hidden){phone.release();return;}const wasHeld=phone.held,history=store.history.length;phone.frame(p,performance.now());if(wasHeld!==phone.held||history!==store.history.length)dirty=true;updateConnection();}
 if(p.type==='telemetry'){const readings=p.readings as SensorReading[];phoneRate=readings.find(r=>r.id==='relative')?.rate??0;rtt=typeof p.rtt==='number'?p.rtt:null;}
 if(p.type==='action'&&phone.enabled){
  if(p.action==='freeze'||p.action==='resume'){freeze(p.action==='freeze');}
  if(p.action==='reset'){releaseInputs();store.action({plane:planeAngles(0,0),depth:0});tasks.event('recenter');}
  if(p.action==='undo'){releaseInputs();store.undo();tasks.event('undo');}
 }
}
function releaseInputs(){phone.release();const end=fist.reset();handStats={...handStats,phase:'idle'};if(end.phase==='end')tasks.event('handRelease');store.end('hand');handBase=null;store.end('mouse');drag=null;}
function freeze(value:boolean){releaseInputs();store.freeze(value);tasks.event(value?'freeze':'resume');}
function setMode(next:string){if(next===mode)return;releaseInputs();if(tasks.current){tasks.cancel(performance.now());$('#task-banner').hidden=true;view.target(null);}mode=next;phone.enabled=mode!=='mouse';all('[data-mode]').forEach(el=>el.classList.toggle('active',el.dataset.mode===mode));$('#camera-card').hidden=mode!=='webcam';if(mode!=='webcam')stopCamera();updateConnection();dirty=true;}
function toolAllowed(candidate=tool){return !(tasks.challenge&&!tasks.challenge.objectOnly&&candidate==='rotate');}
function setTool(next:Tool){
 releaseInputs();tool=next;dirty=true;
 all('[data-tool]').forEach(el=>{el.classList.toggle('active',el.dataset.tool===tool);el.setAttribute('aria-pressed',String(el.dataset.tool===tool));});
 $('#view-hint').textContent=`Drag to ${toolNames[tool].toLowerCase()} · scroll to zoom`;
 $('#gesture-tool-note').textContent={move:'Move X/Y: fist left/right or up/down moves the whole view.',rotate:'Rotate: close your fist over the solid, then move to turn it.',zoom:'Zoom: fist up zooms in; fist down zooms out.',height:'Cut height: fist up raises the cut along the plane normal; fist down lowers it.'}[tool];
 viewport.dataset.tool=tool;
}
function applyDrag(base:SceneState,from:{x:number;y:number},to:{x:number;y:number}){
 if(store.state.frozen||!toolAllowed())return;
 if(tool==='move')store.update({view:view.pan(from,to,base.view)});
 if(tool==='rotate')store.update({object:view.drag(from,to,base.object)});
 if(tool==='zoom')store.update({view:{...base.view,zoom:Math.max(.5,Math.min(3,base.view.zoom*Math.exp((from.y-to.y)*3)))}});
 if(tool==='height')store.update({depth:Math.max(-1.8,Math.min(1.8,base.depth+(from.y-to.y)*3.6))});
}
for(const el of all('[data-tool]'))el.onclick=()=>setTool(el.dataset.tool as Tool);
function zoomBy(multiplier:number){if(store.state.frozen)return;releaseInputs();store.action({view:{...store.state.view,zoom:Math.max(.5,Math.min(3,store.state.view.zoom*multiplier))}});}
$('#zoom-in').onclick=()=>zoomBy(1.2);$('#zoom-out').onclick=()=>zoomBy(1/1.2);
$('#reset-view').onclick=()=>{releaseInputs();store.action({view:{x:0,y:0,zoom:1}});};
for(const input of all<HTMLInputElement>('.view-sliders input')){
 input.addEventListener('pointerdown',()=>{releaseHand();store.begin('view-slider');});
 input.addEventListener('input',()=>{if(store.state.frozen)return;store.begin('view-slider');const key=input.id==='view-x'?'x':input.id==='view-y'?'y':'zoom';store.update({view:{...store.state.view,[key]:Number(input.value)}});});
 for(const event of ['change','pointerup','pointercancel','blur'])input.addEventListener(event,()=>{store.end('view-slider');dirty=true;});
}
for(const el of all('[data-mode]'))el.onclick=()=>setMode(el.dataset.mode!);
$('#drawer-toggle').onclick=()=>{const collapsed=$('#studio-drawer').classList.toggle('is-collapsed');$('#drawer-toggle').textContent=collapsed?'Show':'Hide';$('#drawer-toggle').setAttribute('aria-expanded',String(!collapsed));};
$('#connect-help').onclick=()=>$<HTMLDialogElement>('#connection-guide').showModal();
$('#close-guide').onclick=()=>$<HTMLDialogElement>('#connection-guide').close();
function selectShape(solid:Solid,push=true){
 if(store.state.frozen||tasks.current)return;
 releaseInputs();store.action({solid,object:[0,0,0,1]});
 if(push)history.pushState(null,'',shapeRoutes[solid]+location.search);
}
for(const el of all('[data-solid]'))el.onclick=()=>selectShape(el.dataset.solid as Solid);
window.addEventListener('popstate',()=>{
 const solid=shapeFromPath(location.pathname)??'cone';
 if(store.state.frozen||tasks.current){history.replaceState(null,'',shapeRoutes[store.state.solid]+location.search);return;}
 selectShape(solid,false);
});
for(const el of all('[data-example]'))el.onclick=()=>{if(tasks.current||store.state.frozen)return;releaseInputs();store.action(cloneState(examples[el.dataset.example!]));};
$('#reset').onclick=()=>{releaseInputs();store.reset();tasks.event('reset');};
$('#undo').onclick=()=>{releaseInputs();store.undo();tasks.event('undo');dirty=true;};
$('#freeze-scene').onclick=()=>freeze(!store.state.frozen);
$('#explain').onclick=()=>{if(tasks.current)return;explanation=!explanation;$('#explanation').hidden=!explanation;$('#explain').setAttribute('aria-expanded',String(explanation));};
for(const input of all<HTMLInputElement>('.plane-sliders input')){
 input.addEventListener('pointerdown',()=>{phone.release();store.begin('slider');});
 input.addEventListener('input',()=>{if(store.state.frozen)return;store.begin('slider');if(input.id==='cut-depth')store.update({depth:Number(input.value)});else store.update({plane:planeAngles(Number($<HTMLInputElement>('#pitch').value),Number($<HTMLInputElement>('#roll').value))});});
 for(const event of ['change','pointerup','pointercancel','blur'])input.addEventListener(event,()=>{store.end('slider');dirty=true;});
}
let drag:{start:{x:number;y:number};base:SceneState;id:number}|null=null;
const viewport=$('#solid-view');const at=(e:PointerEvent)=>{const r=viewport.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};
viewport.addEventListener('pointerdown',e=>{if((e.target as Element).closest('.viewport-zoom')||store.state.frozen||e.button!==0||!toolAllowed())return;e.preventDefault();viewport.setPointerCapture(e.pointerId);store.begin('mouse');drag={start:at(e),base:cloneState(store.state),id:e.pointerId};tasks.event('mouseGrab');});
viewport.addEventListener('pointermove',e=>{if(drag&&drag.id===e.pointerId)applyDrag(drag.base,drag.start,at(e));});
for(const event of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(event,()=>{drag=null;store.end('mouse');dirty=true;});
let wheelEnd:ReturnType<typeof setTimeout>|undefined;
viewport.addEventListener('wheel',e=>{e.preventDefault();if(store.state.frozen)return;store.begin('wheel');store.update({view:{...store.state.view,zoom:Math.max(.5,Math.min(3,store.state.view.zoom*Math.exp(-e.deltaY*.0015)))}});clearTimeout(wheelEnd);wheelEnd=setTimeout(()=>{store.end('wheel');dirty=true;},180);},{passive:false});
document.addEventListener('keydown',e=>{
 if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement)return;
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('#undo').click();}
 if(e.code==='Space'&&!(e.target instanceof HTMLButtonElement)){e.preventDefault();$('#freeze-scene').click();}
 if(e.key==='Escape')releaseInputs();
 if(!e.ctrlKey&&!e.metaKey&&(e.key==='+'||e.key==='='||e.key==='-')){e.preventDefault();zoomBy(e.key==='-'?1/1.2:1.2);}
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&!store.state.frozen){e.preventDefault();store.begin('keys');const n=planeNormal(store.state),pitch=Math.atan2(n.z,n.y)*180/Math.PI,roll=Math.atan2(-n.x,Math.hypot(n.y,n.z))*180/Math.PI;store.update({plane:planeAngles(pitch+(e.key==='ArrowUp'?2:e.key==='ArrowDown'?-2:0),roll+(e.key==='ArrowRight'?2:e.key==='ArrowLeft'?-2:0))});}
});
document.addEventListener('keyup',()=>{store.end('keys');dirty=true;});
$('#save-cut').onclick=()=>{
 const item={id:Date.now(),state:cloneState(store.state),label:cut.label,area:cut.area};saved.unshift(item);if(saved.length>6)saved.pop();$('#saved-section').hidden=false;
 renderSavedCuts();
};
function renderSavedCuts(){ $('#saved-section').hidden=!saved.length; $('#saved-cuts').innerHTML=saved.map(s=>`<button class="saved-cut" data-saved="${s.id}"><span>${s.state.solid}</span><strong>${escape(s.label)}</strong><small>${s.area.toFixed(3)} u² <b>↗</b></small></button>`).join('');
 for(const el of all('[data-saved]'))el.onclick=()=>{if(tasks.current)return;releaseInputs();const snapshot=saved.find(s=>s.id===Number(el.dataset.saved))!;store.freeze(false);store.action(snapshot.state);store.freeze(true);};
}
for(const el of all('[data-challenge]'))el.onclick=()=>{
 const challenge=challenges.find(c=>c.id===el.dataset.challenge)!;releaseInputs();store.freeze(false);store.action(tasks.start(challenge,mode,performance.now()));explanation=false;$('#explanation').hidden=true;$('#task-banner').hidden=false;$('#task-title').textContent=challenge.title;$('#task-instruction').textContent=challenge.description;$('#task-result').textContent='';$('#comfort-label').hidden=true;view.target(challenge.target,challenge.objectOnly);setTool(challenge.objectOnly?'rotate':'height');tasks.event('start');dirty=true;$('#task-banner').scrollIntoView({behavior:'smooth',block:'nearest'});
};
$('#cancel-task').onclick=()=>{tasks.cancel(performance.now());view.target(null);$('#task-banner').hidden=true;$('#task-result').textContent='Challenge ended. The partial run is retained in your session export.';dirty=true;};
$('#comfort').onchange=()=>{const last=tasks.runs.at(-1);if(last)last.comfort=Number($<HTMLSelectElement>('#comfort').value)||null;};
function cameraButtons(active:boolean,starting=false){for(const id of ['camera-toggle','camera-shortcut']){const b=$<HTMLButtonElement>(`#${id}`);b.textContent=starting?'Opening camera…':active?'Stop webcam':'Enable webcam';b.disabled=starting;b.setAttribute('aria-pressed',String(active));}}
function stopCamera(){probe?.stop();probe=null;stream?.getTracks().forEach(t=>t.stop());stream=null;releaseHand();cameraPreview.hidden=true;$<HTMLVideoElement>('#gesture-video').hidden=true;$('#camera-placeholder').hidden=false;cameraButtons(false);$('#gesture-state').textContent='Camera is off.';handStats={...handStats,status:'off'};}
function releaseHand(){const previous=fist.reset();handStats={...handStats,phase:'idle'};if(previous.phase==='end')tasks.event('trackingRelease');if(handBase)dirty=true;handBase=null;store.end('hand');}
$('#hand-region').onchange=()=>{releaseHand();handRegionChosen=!!$<HTMLSelectElement>('#hand-region').value;fist.region=$<HTMLSelectElement>('#hand-region').value as 'any'|'left'|'right';};
$('#camera-toggle').onclick=async()=>{
 if(stream||cameraStarting){if(!cameraStarting)stopCamera();return;}
 setMode('webcam');$('#camera-card').hidden=false;
 if(!handRegionChosen){$<HTMLSelectElement>('#hand-region').value='any';handRegionChosen=true;fist.region='any';}
 cameraStarting=true;cameraButtons(false,true);$('#gesture-state').textContent='Opening your webcam…';
 try{
  const cameraStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});if(mode!=='webcam'||document.hidden){cameraStream.getTracks().forEach(t=>t.stop());stopCamera();return;}stream=cameraStream;
  const video=$<HTMLVideoElement>('#gesture-video');video.srcObject=stream;video.hidden=false;cameraPreview.hidden=false;$('#camera-placeholder').hidden=true;await video.play();cameraButtons(true);
  probe=new HandProbe(video,$<HTMLCanvasElement>('#gesture-overlay'),(data,message)=>{handStats={...handStats,...data};if(data.status==='error'){stopCamera();handStats={...data};$('#gesture-state').textContent=message;}},(hands,capturedAt,worldHands)=>{if(!transport.client.active||document.hidden||!document.hasFocus()){releaseHand();return;}
   const now=performance.now();lastHands=now;if(now-capturedAt>250||store.state.frozen||mode!=='webcam'||!toolAllowed()){releaseHand();if(!toolAllowed())$('#gesture-state').textContent='This is a plane challenge. Choose Move X/Y, Zoom or Cut height.';return;}
   if(!handRegionChosen){releaseHand();$('#gesture-state').textContent='Choose the preview side containing your free hand. Keep the phone-holding hand on the other side.';return;}
   const result=fist.update(hands,now,tool==='rotate'?view.bounds():{minX:0,maxX:1,minY:0,maxY:1},worldHands,video.videoWidth/video.videoHeight);handStats={...handStats,gesture:'fist',phase:result.phase,curled:result.pose.curled,extended:result.pose.extended};$('#gesture-state').textContent=result.message;$('#viewport-state').textContent=result.phase==='move'||result.phase==='start'?`Fist grabbed · ${toolNames[tool]}`:store.state.frozen?'Frozen · take a closer look':`Drag to ${toolNames[tool].toLowerCase()}`;
   if(result.phase==='start'){store.begin('hand');handBase=cloneState(store.state);handStart={x:result.x,y:result.y};handCursor={...handStart};lastHandMove=now;dirty=true;tasks.event('handGrab');}
   if(result.phase==='move'&&handBase){const smoothing=1-Math.exp(-Math.min(250,now-lastHandMove)/45);handCursor={x:handCursor.x+(result.x-handCursor.x)*smoothing,y:handCursor.y+(result.y-handCursor.y)*smoothing};lastHandMove=now;applyDrag(handBase,handStart,handCursor);}
   if(result.phase==='end'){handBase=null;store.end('hand');dirty=true;}
  });probe.start();
 }catch(e){stopCamera();$('#gesture-state').textContent=`Camera could not open: ${String(e)}`;}finally{cameraStarting=false;cameraButtons(!!stream);}
};
$('#camera-shortcut').onclick=()=>$('#camera-toggle').click();
document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseInputs();stopCamera();}});
window.addEventListener('blur',()=>{drag=null;store.end('mouse');store.end('slider');store.end('keys');});
function renderState(){
 const state=store.state;
 // Undo, presets and saved cuts can also change the selected shape.
 const routeShape=shapeFromPath(location.pathname);
 if((routeShape&&routeShape!==state.solid)||(!routeShape&&state.solid!=='cone'))history.replaceState(null,'',shapeRoutes[state.solid]+location.search);
 document.title=`${state.solid[0].toUpperCase()+state.solid.slice(1)} — 3D Studio`;
 cut=view.update(state);$('#section-view').innerHTML=sectionSvg(cut);$('#section-name').textContent=cut.label;$('#section-type').textContent=cut.degenerate?'BOUNDARY CONTACT':cut.clipped?'FINITE SECTION':cut.kind==='polygon'||cut.kind==='rectangle'?'POLYGON':'CLOSED CURVE';
 $('#area').innerHTML=`${cut.area.toFixed(3)} <small>u²</small>`;$('#perimeter').innerHTML=`${cut.perimeter.toFixed(3)} <small>u</small>`;$('#approx-label').textContent=cut.approximate?'≈':'';$('#explanation').textContent=cut.reason;
 const n=planeNormal(state),pitch=Math.atan2(n.z,n.y)*180/Math.PI,roll=Math.atan2(-n.x,Math.hypot(n.y,n.z))*180/Math.PI;
 for(const [id,value] of [['pitch',pitch],['roll',roll],['cut-depth',state.depth]] as const){const input=$<HTMLInputElement>(`#${id}`);if(document.activeElement!==input)input.value=String(value);input.disabled=state.frozen;$(`#${id}-value`).textContent=id==='cut-depth'?`${value.toFixed(2)} u`:`${Math.round(value)}°`;}
 $('#plane-equation').textContent=`${n.x.toFixed(2)}x + ${n.y.toFixed(2)}y + ${n.z.toFixed(2)}z = ${state.depth.toFixed(2)}`;
 all<HTMLButtonElement>('[data-solid]').forEach(el=>{el.classList.toggle('active',el.dataset.solid===state.solid);el.setAttribute('aria-pressed',String(el.dataset.solid===state.solid));el.disabled=state.frozen||!!tasks.current;});
 all<HTMLButtonElement>('[data-example]').forEach(el=>el.disabled=state.frozen||!!tasks.current);
 all<HTMLButtonElement>('[data-tool]').forEach(el=>el.disabled=state.frozen||!toolAllowed(el.dataset.tool as Tool));
 $('#freeze-scene').innerHTML=state.frozen?'▶ <span>Resume</span>':'Ⅱ <span>Freeze</span>';$('#freeze-scene').setAttribute('aria-pressed',String(state.frozen));$('#freeze-scene').classList.toggle('is-frozen',state.frozen);$<HTMLButtonElement>('#undo').disabled=!store.history.length;
 $<HTMLButtonElement>('#explain').disabled=!!tasks.current;$('#explanation').hidden=!explanation||!!tasks.current;
 $('#viewport-state').textContent=state.frozen?'Frozen · take a closer look':handBase?`Fist grabbed · ${toolNames[tool]}`:phone.held?'Phone tilts the plane':`Drag to ${toolNames[tool].toLowerCase()}`;
 for(const [id,value] of [['view-x',state.view.x],['view-y',state.view.y],['view-zoom',state.view.zoom]] as const){const el=$<HTMLInputElement>(`#${id}`);if(document.activeElement!==el)el.value=String(value);el.disabled=state.frozen;$(`#${id}-value`).textContent=id==='view-zoom'?`${Math.round(value*100)}%`:value.toFixed(2);}
 $('#zoom-readout').textContent=`${Math.round(state.view.zoom*100)}%`;for(const id of ['zoom-in','zoom-out','reset-view'])$<HTMLButtonElement>(`#${id}`).disabled=state.frozen;
 dirty=false;lastRevision=store.revision;
}
function animate(now:number){
 const dt=Math.min(.1,(now-lastRender)/1000);if(!document.hidden&&dt>0){renderIntervals.push((now-lastRender));if(renderIntervals.length>600)renderIntervals.shift();}lastRender=now;
 const wasHeld=phone.held;phone.tick(now,dt);if(wasHeld!==phone.held)dirty=true;if(handBase&&now-lastHands>250){releaseHand();$('#gesture-state').textContent='Tracking paused. Open your hand to grab again.';}
 if(dirty||lastRevision!==store.revision)renderState();
 const result=tasks.tick(store.state,cut,now);
 if(result){$('#task-time').textContent=`${tasks.current?.elapsedSeconds.toFixed(1)??result.done?.elapsedSeconds.toFixed(1)}s`;$('#task-score').textContent=`Angle ${result.score.angle.toFixed(1)}° / ${tasks.challenge?.objectOnly?'8':'5'}° · depth ${result.score.depth.toFixed(2)} / 0.10 u`;
  if(result.done){$('#task-banner').hidden=true;view.target(null);$('#task-result').textContent=`Matched in ${result.done.elapsedSeconds.toFixed(1)} seconds using ${({mouse:'mouse',phone:'phone + mouse',webcam:'phone + webcam'}[result.done.mode]??result.done.mode)}. Try another control mode to compare.`;$('#comfort-label').hidden=false;$<HTMLSelectElement>('#comfort').value='';dirty=true;}}
 if(receiveAt!==null){receiveToRender.push(now-receiveAt);if(receiveToRender.length>300)receiveToRender.shift();receiveAt=null;}
 view.render();requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
let lastFeedback='';setInterval(()=>{const message={type:'controller-state',frozen:store.state.frozen,depth:store.state.depth,solid:store.state.solid,enabled:phone.enabled};const serialized=JSON.stringify(message);if(serialized!==lastFeedback&&transport.connected){transport.send(message);lastFeedback=serialized;}},100);
setInterval(()=>{transport.ping();const median=percentile(renderIntervals,.5);$('#session-diagnostics').textContent=`Phone: ${phoneConnected?'connected':'disconnected'} · ${phoneRate.toFixed(1)} Hz orientation · RTT ${rtt?.toFixed(1)??'—'} ms. Render median: ${median?(1000/median).toFixed(1):'—'} fps. Receive-to-next-frame p95: ${percentile(receiveToRender,.95)?.toFixed(1)??'—'} ms. Hand inference p95: ${typeof handStats.inferenceP95Ms==='number'?handStats.inferenceP95Ms.toFixed(1):'—'} ms. Hand processed rate: ${typeof handStats.processedHz==='number'?handStats.processedHz.toFixed(1):'—'} Hz.`;},1000);
$('#export-session').onclick=()=>{
 const data={schema:2,created:new Date().toISOString(),state:store.state,cut:{label:cut.label,area:cut.area,perimeter:cut.perimeter,clipped:cut.clipped,reason:cut.reason,points:cut.points.map(p=>p.toArray())},mode,snapshots:saved,tasks:tasks.runs,currentTask:tasks.current,tool,diagnostics:{phoneRate,rtt,renderIntervalsMs:renderIntervals,receiveToRenderMs:receiveToRender,hands:handStats},notes:'Local prototype observations. Curved geometry uses 256 radial segments. No camera frames or microphone recordings. Task results are not a controlled user study.'};
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='section-studio-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
(window as unknown as Record<string,unknown>).__sectionStudio={get state(){return cloneState(store.state);},get section(){return cut;},get projectedBounds(){return view.bounds();},get history(){return store.history.length;},get mode(){return mode;},get tool(){return tool;},get phone(){return {held:phone.held,connected:phoneConnected,rate:phoneRate};},get hands(){return handStats;},get tasks(){return tasks.runs;},get activeTask(){return tasks.current;},get diagnostics(){return {renderMedianFps:1000/(percentile(renderIntervals,.5)??Infinity),renderP95IntervalMs:percentile(renderIntervals,.95),receiveToRenderP95Ms:percentile(receiveToRender,.95),rtt};}};

const requestedMode=new URLSearchParams(location.search).get('mode');if(requestedMode&&['mouse','phone','webcam'].includes(requestedMode))setMode(requestedMode);

uiReady=true;if(!requestedMode)setMode(restoredMode);

document.addEventListener('studio-before-navigation',()=>releaseInputs());
