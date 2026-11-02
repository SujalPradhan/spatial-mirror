import {getSession} from '../session';
import {bindDocument} from '../documents';
import '../mirror/stage.css';
import './style.css';
import {workspaceNav} from '../workspace-nav';
import {StandStore,MAX_ANGLE,FIXTURE,readPoses,type SavedPose,type State} from './model';
import {StandView} from './view';
import {StandPhoneInput} from './phone-input';
import {MechanismLink} from '../mechanism/link';
import {HandProbe,type Landmark} from '../hand-probe';
import {FistGate} from '../fist';
import type {Packet} from '../types';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>[...document.querySelectorAll<HTMLElement>(s)];
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
document.title='Folding stand — Mechanism Studio';
$('#app').innerHTML=`<div class="mirror-workspace stand-workspace"><header class="topbar"><a class="brand" href="/"><span class="brand-mark">◫</span>3D<span class="brand-light">STUDIO</span></a><div class="stand-header"><a href="/mechanism/box">Box example</a><button id="phone-connect">Connect phone</button></div></header>${workspaceNav()}
<main class="stand-main"><div class="stand-intro"><div><h1>Folding stand</h1><p>Find your viewing angle. Fold it away.</p></div><button id="camera-toggle">Enable webcam</button></div>
<div id="pairing" class="mirror-drawer" hidden><a id="controller-link" href="#">Open phone controller</a><span>Connect by USB, then run <code>npm run phone:mechanism</code>.</span></div>
<div class="stand-layout"><section class="stand-canvas-panel"><div class="stand-toolbar"><div class="stand-tools" aria-label="Drag tool"><button data-tool="angle" class="active">Stand angle</button><button data-tool="move">Move X/Y</button><button data-tool="rotate">Rotate view</button><button data-tool="zoom">Zoom</button></div><div><button id="undo" disabled>↶ Undo</button><button id="freeze">Ⅱ Freeze</button></div></div>
<div id="stand-view" class="mirror-workspace-stage" tabindex="0" role="application" aria-label="Folding stand. Drag upward to raise the backrest; choose other tools to move, rotate or zoom the view."><div class="stand-hud"><span id="angle-hud">60°</span><span id="input-status">Drag upward to raise</span></div><div id="camera-preview" hidden><video id="hand-video" playsinline muted></video><canvas id="hand-overlay"></canvas></div><div class="stand-view-bottom"><span id="pose-status">Ready</span><div><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="center">Center</button></div></div></div>
<div class="stand-camera-controls" id="camera-controls" hidden><span id="gesture-status">Open your hand, then make a fist.</span><label>Free hand <select id="hand-region"><option value="any">Either side</option><option value="left">Left side</option><option value="right">Right side</option></select></label></div></section>
<aside class="stand-settings mirror-drawer"><h2>Backrest</h2><label for="angle-slider">Viewing angle <output id="angle-value">60°</output></label><input id="angle-slider" type="range" min="0" max="80" step=".1" value="60"><div class="stand-number"><input id="angle-number" type="number" min="0" max="80" step=".1" value="60" aria-label="Exact viewing angle"><button id="set-angle">Set angle</button></div><div class="stand-presets"><button data-angle="0">Fold flat</button><button data-angle="45">Drawing · 45°</button><button data-angle="65">Reading · 65°</button></div><label class="stand-checkbox"><input type="checkbox" id="show-device" checked> Show reference phone</label><p class="stand-hint">Hold the phone pad and tilt, or drag with a closed fist. Release to stop.</p>
<div class="saved-heading"><h2>Saved poses</h2><button id="save-pose">＋ Save pose</button></div><div id="saved-poses"></div><p id="save-status" role="status">Saved on this browser.</p><details class="stand-more"><summary>About this stand</summary><p>A concept with one adjustable hinge, from flat to 80°. The reference phone shows the viewing angle. Load capacity and resistance to tipping are not simulated.</p><p>Mouse and fist use the selected drag tool. Phone tilt always changes the backrest angle.</p><a href="/mechanism/box">Open the earlier box &amp; tray example</a></details></aside></div></main></div>`;
const store=new StandStore(),view=new StandView($('#stand-view')),phone=new StandPhoneInput(store),fist=new FistGate();fist.region='any';
type Tool='angle'|'move'|'rotate'|'zoom';let tool:Tool='angle',owns=false,phoneConnected=false,context=0,lastSend=0,lastKey='',lastRender=performance.now();
let drag:{owner:'mouse'|'hand';x:number;y:number;base:State;tool:Tool}|null=null;
let stream:MediaStream|null=null,probe:HandProbe|null=null,starting=false,lastHand=0,handStats:Record<string,unknown>={status:'off'};
let poses:SavedPose[]=[];const storageKey='mechanism-stand-poses-v1';try{poses=readPoses(JSON.parse(localStorage.getItem(storageKey)??'[]'));}catch{}
const session=await getSession();$('#controller-link').setAttribute('href',`/mechanism/phone?session=${session.token}`);
await bindDocument('stand',()=>({state:store.state,poses}),value=>{
 if(value?.state&&Number.isFinite(value.state.angle)&&value.state.angle>=0&&value.state.angle<=80){store.state=structuredClone(value.state);store.history=[];store.revision++;}
 if(value?.poses){poses=readPoses(value.poses);renderPoses();}
});
const link=new MechanismLink('desktop',session.token,receive);
function changedContext(){context++;link.context=context;lastKey='';}
function endDrag(){if(!drag)return;if(drag.tool==='angle')store.end(drag.owner);else store.endView();drag=null;}
function release(){phone.release();endDrag();store.end('fine');fist.reset();}
function setAngle(angle:number){if(!Number.isFinite(angle)||store.state.frozen)return;release();store.action(angle);changedContext();}
function undo(){release();store.undo();changedContext();}
function freeze(){release();store.freeze();changedContext();}
function savePose(){if(poses.length>=8){$('#save-status').textContent='Eight poses saved. Remove one to save another.';return;}poses.push({name:`Pose ${poses.length+1}`,angle:store.state.angle});persist();renderPoses();}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(poses));$('#save-status').textContent='Saved on this browser.';}catch{$('#save-status').textContent='Browser storage unavailable. These poses last for this session.';}}
function renderPoses(){
 $('#saved-poses').innerHTML=poses.length?poses.map((p,i)=>`<div class="stand-saved"><input data-name="${i}" value="${escape(p.name)}" maxlength="40" aria-label="Pose ${i+1} name"><button data-load="${i}" title="Apply saved angle">${p.angle.toFixed(1)}°</button><button data-remove="${i}" aria-label="Remove ${escape(p.name)}">×</button></div>`).join(''):'<p class="stand-empty">Save an angle to return to it.</p>';
 $$('[data-name]').forEach(el=>el.onchange=()=>{poses[Number(el.dataset.name)].name=(el as HTMLInputElement).value.trim().slice(0,40)||'Untitled pose';persist();});
 $$('[data-load]').forEach(el=>el.onclick=()=>setAngle(poses[Number(el.dataset.load)].angle));
 $$('[data-remove]').forEach(el=>el.onclick=()=>{poses.splice(Number(el.dataset.remove),1);persist();renderPoses();});
}
function receive(p:Packet){
 if(p.type==='status'){const previous=owns;owns=!!p.owner;phoneConnected=!!p.phoneConnected;if(previous&&!owns)release();if(owns&&!previous)changedContext();}
 if(['lost','disconnected'].includes(p.type)){owns=false;release();}
 if(p.type==='phone-lost'){phoneConnected=false;release();changedContext();}
 if(['frame','action'].includes(p.type)&&(!owns||p.epoch!==link.epoch||p.context!==context))return;
 if(p.type==='frame'){phone.enabled=owns&&!store.state.frozen;phone.frame(p,performance.now());}
 if(p.type==='action'){
  if(p.action==='fine'&&!phone.held&&store.begin('fine'))store.set(Number(p.value),'fine');
  if(p.action==='fine-end')store.end('fine');
  if(p.action==='undo')undo();if(p.action==='freeze'||p.action==='resume'){if((p.action==='freeze')!==store.state.frozen)freeze();}
  if(p.action==='save-pose')savePose();
 }
}
$('#phone-connect').onclick=()=>{$('#pairing').hidden=!$('#pairing').hidden;if(!owns)link.send({type:'claim',takeover:true});};
$('#set-angle').onclick=()=>setAngle(Number($<HTMLInputElement>('#angle-number').value));
$('#angle-number').onkeydown=e=>{if(e.key==='Enter')$('#set-angle').click();};
$('#angle-slider').addEventListener('pointerdown',()=>{release();changedContext();});
$('#angle-slider').oninput=()=>{if(store.begin('fine'))store.set(Number($<HTMLInputElement>('#angle-slider').value),'fine');};
for(const event of ['pointerup','pointercancel','change','blur','keyup'])$('#angle-slider').addEventListener(event,()=>store.end('fine'));
$$('[data-angle]').forEach(el=>el.onclick=()=>setAngle(Number(el.dataset.angle)));
$$('[data-tool]').forEach(el=>el.onclick=()=>{release();tool=el.dataset.tool as Tool;changedContext();});
$('#undo').onclick=undo;$('#freeze').onclick=freeze;$('#save-pose').onclick=savePose;
function beginDrag(owner:'mouse'|'hand',x:number,y:number){if(store.state.frozen||drag)return;if(tool==='angle'&&!store.begin(owner))return;if(tool!=='angle')store.beginView();drag={owner,x,y,base:structuredClone(store.state),tool};}
function moveDrag(x:number,y:number){if(!drag||store.state.frozen)return;const dx=x-drag.x,dy=y-drag.y,b=drag.base;if(drag.tool==='angle')store.set(b.angle-dy*140,drag.owner);if(drag.tool==='move')store.setView({x:b.view.x-dx*450,y:b.view.y+dy*350});if(drag.tool==='rotate')store.setView({yaw:b.view.yaw-dx*4,pitch:b.view.pitch+dy*2});if(drag.tool==='zoom')store.setView({zoom:b.view.zoom*Math.exp(-dy*3)});}
const host=$('#stand-view');const point=(e:PointerEvent)=>{const r=host.getBoundingClientRect();return {x:(e.clientX-r.x)/r.width,y:(e.clientY-r.y)/r.height};};
host.onpointerdown=e=>{if((e.target as HTMLElement).closest('button')||e.button!==0)return;const p=point(e);beginDrag('mouse',p.x,p.y);if(drag?.owner==='mouse')host.setPointerCapture(e.pointerId);};
host.onpointermove=e=>{if(drag?.owner==='mouse'){const p=point(e);moveDrag(p.x,p.y);}};
for(const event of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(event,()=>{if(drag?.owner==='mouse')endDrag();});
let wheelEnd:ReturnType<typeof setTimeout>;host.addEventListener('wheel',e=>{e.preventDefault();if(drag)return;store.beginView();store.setView({zoom:store.state.view.zoom*Math.exp(-e.deltaY*.001)});clearTimeout(wheelEnd);wheelEnd=setTimeout(()=>store.endView(),180);},{passive:false});
$('#zoom-in').onclick=()=>store.viewAction({zoom:store.state.view.zoom*1.15});$('#zoom-out').onclick=()=>store.viewAction({zoom:store.state.view.zoom/1.15});$('#center').onclick=()=>store.viewAction({x:0,y:0,zoom:1,yaw:0,pitch:0});
function stopCamera(){probe?.stop();probe=null;stream?.getTracks().forEach(t=>t.stop());stream=null;$('#camera-preview').hidden=true;$('#camera-controls').hidden=true;$('#camera-toggle').textContent='Enable webcam';if(drag?.owner==='hand')endDrag();fist.reset();handStats={status:'off'};}
$('#camera-toggle').onclick=async()=>{
 if(stream){stopCamera();return;}if(starting)return;starting=true;$('#camera-toggle').textContent='Starting camera…';
 try{const camera=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});if(document.hidden){camera.getTracks().forEach(t=>t.stop());return;}stream=camera;const video=$<HTMLVideoElement>('#hand-video');video.srcObject=stream;await video.play();$('#camera-preview').hidden=false;$('#camera-controls').hidden=false;$('#camera-toggle').textContent='Stop webcam';probe=new HandProbe(video,$<HTMLCanvasElement>('#hand-overlay'),(data,message)=>{handStats=data;if(data.status==='error'){stopCamera();$('#camera-controls').hidden=false;$('#gesture-status').textContent=message;}},hands);probe.start();}
 catch(e){stopCamera();$('#camera-controls').hidden=false;$('#gesture-status').textContent=`Camera unavailable: ${String(e)}`;}finally{starting=false;if(!stream)$('#camera-toggle').textContent='Enable webcam';}
};
$('#hand-region').onchange=()=>{if(drag?.owner==='hand')endDrag();fist.reset();fist.region=$<HTMLSelectElement>('#hand-region').value as 'any'|'left'|'right';};
function hands(list:Landmark[][],at:number,world:Landmark[][]){if(!stream||document.hidden||!document.hasFocus()||!link.client.active){if(drag?.owner==='hand')endDrag();fist.reset();return;}lastHand=performance.now();const video=$<HTMLVideoElement>('#hand-video');const f=fist.update(list,at,{minX:0,maxX:1,minY:0,maxY:1},world,video.videoWidth/Math.max(1,video.videoHeight));$('#gesture-status').textContent=f.message;if(f.phase==='start')beginDrag('hand',f.x,f.y);if(f.phase==='move'&&drag?.owner==='hand')moveDrag(f.x,f.y);if(f.phase==='end'&&drag?.owner==='hand')endDrag();}
document.addEventListener('keydown',e=>{if((e.target as HTMLElement).matches('input,select'))return;if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}if(e.key==='Escape'){release();changedContext();}if(e.code==='Space'&&!(e.target as HTMLElement).closest('button')){e.preventDefault();freeze();}});
window.addEventListener('blur',()=>{if(drag?.owner==='mouse')endDrag();store.end('fine');});
document.addEventListener('visibilitychange',()=>{if(document.hidden){release();stopCamera();changedContext();}});
window.addEventListener('pagehide',()=>{release();stopCamera();link.send({type:'release'});link.close();view.dispose();});
function update(now:number){const s=store.state,angle=s.angle.toFixed(1);$('#angle-value').textContent=angle+'°';$('#angle-hud').textContent=angle+'°';$('#pose-status').textContent=s.frozen?'Frozen':s.angle<.1?'Folded flat':s.angle>=MAX_ANGLE-.1?'Maximum angle':'Backrest angle';$('#input-status').textContent=phone.held?'Following phone':drag?.owner==='hand'?'Following fist':tool==='angle'?'Drag upward to raise':tool==='move'?'Drag to move view':tool==='rotate'?'Drag to rotate view':'Drag upward to zoom';
 for(const id of ['angle-slider','angle-number']){const el=$<HTMLInputElement>('#'+id);if(document.activeElement!==el)el.value=angle;el.disabled=s.frozen||phone.held;}
 $$('[data-tool]').forEach(el=>el.classList.toggle('active',el.dataset.tool===tool));
 for(const el of $$('[data-angle], [data-load], #set-angle, #zoom-in, #zoom-out, #center'))(el as HTMLButtonElement).disabled=s.frozen;
 $<HTMLButtonElement>('#undo').disabled=s.frozen||!store.history.length;$('#freeze').textContent=s.frozen?'▶ Resume':'Ⅱ Freeze';$('#phone-connect').textContent=owns&&phoneConnected?'Phone connected':owns?'Connect phone':'Take phone control';
 phone.enabled=owns&&!s.frozen;
 if(owns&&link.connected&&now-lastSend>50){const state={type:'state',fixture:FIXTURE,selected:'backrest',angle:s.angle,limit:MAX_ANGLE,enabled:!s.frozen,frozen:s.frozen,context,revision:store.revision,phase:'idle',duration:0,time:0};const key=JSON.stringify(state);if(key!==lastKey){link.send(state);lastKey=key;lastSend=now;}}
 view.update(s,$<HTMLInputElement>('#show-device').checked);
}
function tick(now:number){const dt=Math.min(.1,(now-lastRender)/1000);lastRender=now;phone.tick(now,dt);if(drag?.owner==='hand'&&now-lastHand>250){endDrag();fist.reset();}update(now);view.render();requestAnimationFrame(tick);}
renderPoses();requestAnimationFrame(tick);
(window as unknown as Record<string,unknown>).__standStudio={get state(){return structuredClone(store.state);},get history(){return store.history.length;},get poses(){return structuredClone(poses);},get hands(){return handStats;},get phone(){return {held:phone.held,connected:phoneConnected,owns};}};

document.addEventListener('studio-before-navigation',()=>release());
