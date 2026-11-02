import {getSession} from '../session';
import {bindDocument} from '../documents';
import '../mirror/stage.css';
import './style.css';
import {workspaceNav} from '../workspace-nav';
import {MechanismStore,clone,type State} from './store';
import {AssemblyView} from './view';
import {Recorder,poseAt,exportTakes,importTakes,validateTake,type Take} from './takes';
import {clamp,move,type Part,type Fixture} from './model';
import {MechanismLink} from './link';
import {JointPhoneInput} from './phone-input';
import {HandProbe,type Landmark} from '../hand-probe';
import {FistGate} from '../fist';
import {Dwell,isPointing} from '../pointing';
import {percentile} from '../stats';
import type {Packet} from '../types';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>[...document.querySelectorAll<HTMLElement>(s)];
const app=$('#app');document.title='Mechanism Studio — show how it moves';app.classList.add('mirror-workspace','mechanism-workspace');
app.innerHTML=`${workspaceNav()}
<main class="mechanism-main"><header class="topbar"><a class="brand" href="/mechanism/box"><span class="brand-mark">◫</span>MECHANISM<span class="brand-light">STUDIO</span></a><nav><a href="/lab">Hardware lab</a><span id="connection" class="connection-pill">Local studio</span></nav></header>
<div class="assembly-panel"><div id="assembly-view" class="mirror-workspace-stage" tabindex="0" role="application" aria-label="3D box. Select lid or tray, then drag to move. Scroll to zoom."><span id="pointer" hidden></span><div class="view-top"><span id="pose-label">Lid · 0°</span><span id="view-owner">Released</span></div></div><div class="assembly-hud"><div class="assembly-toolbar"><div class="segments" aria-label="Drag mode"><button data-tool="part">Move part</button><button data-tool="pan">Move X/Y</button><button data-tool="orbit">Rotate view</button><button data-tool="zoom">Zoom</button></div><div><button id="undo">↶ Undo</button><button id="freeze">Ⅱ Freeze</button></div></div>
<div class="view-bottom"><span>VIRTUAL MODEL · mm / degrees</span><div><button id="zoom-out" aria-label="Zoom out">−</button><output id="zoom-value">100%</output><button id="zoom-in" aria-label="Zoom in">+</button><button id="center">Center</button></div></div><p id="contact" role="status">Select the lid, then drag upward to open it.</p>
<section class="timeline-panel mirror-drawer"><div class="timeline-heading"><div><h2>Recording</h2></div><span id="phase-label" role="status">Ready to record</span></div><div class="record-controls"><button id="record" class="primary">● Record</button><button id="stop">■ Stop</button><button id="play">▶ Play</button><button id="marker">＋ Step marker</button><select id="speed" aria-label="Playback speed"><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><output id="time">0.0 / 0.0 s</output></div><input id="timeline" type="range" min="0" max="1" value="0" step="1" aria-label="Recording timeline"><div id="takes" class="take-list"></div><div class="export-row"><button id="use-pose">Use this pose</button><button id="export">Export demonstrations</button><button id="export-text">Export instructions</button><label class="file-button">Import demonstrations<input id="import" type="file" accept="application/json,.json" hidden></label></div><p class="small">3 takes · 30 seconds each. Export to save.</p><div id="steps" class="step-list"></div></section></div></div>
<div class="mechanism-rail"><div class="mechanism-session mirror-drawer"><section class="mechanism-intro"><div><h1>Box &amp; tray</h1></div><div><p>Open the lid. Move the tray.</p><div class="segments" aria-label="Input mode"><button data-mode="mouse">Mouse</button><button data-mode="phone">Phone + mouse</button><button data-mode="webcam">Phone + webcam</button></div></div></section>
<section class="session-strip"><span id="session-status" role="status">Select a part to move it.</span><button id="claim">Take phone control</button><button id="pair">Phone connection</button><button id="release-phone">Release phone</button></section>
<div id="pair-help" class="notice" hidden>Connect your unlocked Android by USB. In the project folder run <code>npm run phone -- --box</code>, then tap Start sensors. <a id="phone-url" href="#">Phone controller ↗</a></div></div>
<section class="camera-panel mirror-drawer"><div><h2>Hand control</h2><p>Point to select. Close a fist to move. Open to release.</p><label for="hand-region">Free hand in mirrored preview</label><select id="hand-region"><option value="">Choose a side…</option><option value="left">Left half</option><option value="right">Right half</option><option value="any">Either half · phone parked</option></select><label for="reach">Hand reach</label><select id="reach"><option value="1.5">Seated · small movements</option><option value="1">Full camera frame</option></select><button id="camera-toggle">Enable webcam</button><p id="gesture-status" role="status">Camera off.</p><p class="small">Camera frames stay on this computer.</p></div><div class="mechanism-camera"><video id="hand-video" playsinline muted hidden></video><canvas id="hand-overlay"></canvas><span id="camera-placeholder">Camera preview</span></div></section>
<details class="extra-tools mechanism-extras mirror-drawer"><summary>Extra tools</summary><section class="comparison-panel"><div><div class="eyebrow">04 · TRY THE SAME TASK</div><h2>Does the control help?</h2><p>After practice: select lid, open to 95°, lift the tray to 120 mm, then finish. Repeat with mouse, phone + mouse and phone + webcam.</p></div><div><button id="trial-start">Start trial</button><button id="trial-end">Finish trial</button><label for="comfort">Comfort, 1–5 <input id="comfort" type="number" min="1" max="5" value="3"></label><p id="trial-status">No trial running.</p><button id="export-diagnostics">Export test observations</button></div></section><footer><span id="diagnostics">Preparing renderer…</span></footer></details></div>
<aside class="mechanism-controls mirror-drawer"><h2>Parts</h2><div class="part-picker"><button data-part="lid"><b>01</b><span>Lid<small>One hinge · 0–120°</small></span></button><button data-part="tray"><b>02</b><span>Tray<small>Vertical removal · 0–160 mm</small></span></button></div>
<label for="joint-value"><span id="joint-label">Lid angle</span><output id="joint-output">0°</output></label><input id="joint-value" type="range" min="0" max="120" step=".1" value="0"><div class="number-row"><input id="joint-number" type="number" min="0" max="120" step=".1" value="0" aria-label="Exact joint value"><button id="apply-value">Set value</button></div>
<div class="limit-card"><label for="limit-value">Lid opening limit <output id="limit-output">120°</output></label><div class="number-row"><input id="limit-value" type="number" min="0" max="120" step=".1" value="120"><button id="apply-limit">Set limit</button></div><button id="limit-here">Set limit at current angle</button><p id="limit-preview" role="status"></p><button id="confirm-limit" hidden>Apply limit and adjusted pose</button></div>
<label for="fixture">Workspace</label><select id="fixture"><option value="clear">Clear workspace</option><option value="shelf">Overhead shelf · blocked access</option></select><p class="small">Changing workspace returns the assembly to its starting pose as one undoable action.</p><button id="reset">Reset assembly</button>
<details><summary>Controls</summary><ol><li>Select Lid and open past 90°.</li><li>Set an opening limit, such as 100°.</li><li>Select Tray and lift 120 mm.</li><li>Reset, press Record and repeat the sequence.</li><li>Stop, replay and export your take.</li></ol><p>Point to select, open your hand to prepare, close your fist to move, then open to release. Use the part buttons for a direct alternative.</p></details></aside>
</main>`;
const store=new MechanismStore(),view=new AssemblyView($('#assembly-view')),recorder=new Recorder(),fist=new FistGate(),dwell=new Dwell();
let mode='mouse',tool='part',owns=false,phoneConnected=false,context=0,hover:Part|null=null,dirty=true;
let countdown=0,takes:Take[]=[],review:Take|null=null,reviewTime=0,playing=false,playAt=0,lastSend=0,lastSendKey='',pendingLimit:number|null=null;
let stream:MediaStream|null=null,probe:HandProbe|null=null,lastHand=0,handStats:Record<string,unknown>={},cameraStarting=false;
let drag:{owner:string;x:number;y:number;base:State}|null=null;
let trial:{start:number;mode:string;undo:number;selections:number;contacts:number}|null=null;
const trials:Record<string,unknown>[]=[],hardware:Record<string,unknown>={},renderIntervals:number[]=[];let lastRender=performance.now(),cueId=0,captionPose={...store.state.pose},contactAnchor:{angle:number;lift:number}|null=null;
const phone=new JointPhoneInput(store,()=>movementStep());
const session=await getSession();$('#phone-url').setAttribute('href',`/mechanism/box/phone?session=${session.token}`);
await bindDocument('box',()=>{
 const draft=recorder.take&&recorder.take.duration>=100?{...structuredClone(recorder.take),interrupted:true}:null;
 return {state:store.state,takes:draft?[...takes,draft].slice(-3):takes,mode};
},value=>{
 if(value?.state?.pose){store.state=clone(value.state);store.history=[];store.revision++;}
 if(Array.isArray(value?.takes)){takes=value.takes.map(validateTake);recorder.take=null;review=null;playing=false;renderTakes();renderSteps();}
 if(['mouse','phone','webcam'].includes(value?.mode))mode=value.mode;dirty=true;
});
const link=new MechanismLink('desktop',session.token,receive);
function phase(){return countdown?'countdown':recorder.take?(recorder.paused?'paused':'recording'):review?(playing?'playing':'review'):'idle';}
function message(text:string){$('#session-status').textContent=text;}
function changedContext(){context++;link.context=context;lastSendKey='';dirty=true;}
function working(){return !review&&!countdown&&!store.state.frozen;}
function canMove(){return working()&&(!recorder.take||!recorder.paused);}
function release(reason?:string){phone.release();if(drag){const owner=drag.owner;drag=null;if(tool==='part'){store.end(owner);movementStep();}else store.endView();}store.end('fine');fist.reset();dwell.reset();hover=null;$('#pointer').hidden=true;if(reason&&recorder.take)recorder.pause(store.state,performance.now(),reason);dirty=true;}
function movementStep(){if(!recorder.take)return;recorder.sample(store.state,performance.now(),true);const p=store.state.pose;if(Math.abs(p.angle-captionPose.angle)+Math.abs(p.lift-captionPose.lift)<1e-6)return;recorder.step(store.state.selected==='lid'?`${p.angle>captionPose.angle?'Open':'Close'} lid to ${p.angle.toFixed(1)}°.`:`${p.lift>captionPose.lift?'Lift':'Lower'} tray to ${p.lift.toFixed(1)} mm.`,'move',performance.now());captionPose={...p};}
function select(part:Part){if(!working()||store.owner){message('Release the current control before changing parts.');return;}release();if(store.select(part)){if(trial)trial.selections++;changedContext();}}
function applyValue(value:number,owner='fine'){
 if(!canMove()||!Number.isFinite(value))return;if(!store.begin(owner)){message('Release the current control first.');return;}
 store.setPose({...store.state.pose,[store.state.selected==='lid'?'angle':'lift']:value},owner);
}
function finishFine(){if(store.owner==='fine'){store.end('fine');movementStep();}}
function setLimit(limit:number,confirm=false){
 if(!working()||recorder.take||store.owner||!Number.isFinite(limit)||limit<0||limit>120){message('Release controls and finish the take before setting a limit from 0–120°.');return;}
 if(limit<store.state.pose.angle&&!confirm){pendingLimit=limit;$('#limit-preview').textContent=`Applying ${limit.toFixed(1)}° also closes the lid from ${store.state.pose.angle.toFixed(1)}°. Movement will stop if another part blocks it.`;$('#confirm-limit').hidden=false;return;}
 store.begin('limit');if(store.state.pose.angle>limit)store.setPose({...store.state.pose,angle:limit},'limit');
 if(store.state.pose.angle>limit+1e-6){store.end('limit');message('The tray blocks closing to that limit. Lower the tray first.');return;}
 store.setConfig({...store.state.config,limit},'limit');store.end('limit');message(`Lid opening limit set to ${limit.toFixed(1)}°.`);
 pendingLimit=null;$('#confirm-limit').hidden=true;$('#limit-preview').textContent='';changedContext();
}
store.onChange=()=>{if(contactAnchor&&!store.contact&&(Math.abs(contactAnchor.angle-store.state.pose.angle)>1||Math.abs(contactAnchor.lift-store.state.pose.lift)>1))contactAnchor=null;dirty=true;};store.onContact=c=>{if(trial)trial.contacts++;recorder.step(c.message,'contact',performance.now());if(!contactAnchor){contactAnchor={...store.state.pose};link.send({type:'cue',cue:'contact',id:++cueId});}};
function record(){
 if(store.state.frozen){message('Resume the assembly first.');return;}if(recorder.take?.samples&&recorder.paused){recorder.resume(performance.now());changedContext();return;}if(recorder.take||countdown)return;
 release();review=null;playing=false;if(takes.length>=3){message('Three takes are saved. Delete a take after exporting to record another.');return;}
 countdown=performance.now()+3000;changedContext();
}
function stop(){release();if(countdown){countdown=0;message('Recording countdown cancelled.');}if(recorder.take){const take=recorder.finish(store.state,performance.now());if(take){try{takes.push(validateTake(take));review=take;reviewTime=0;renderTakes();renderSteps();}catch(e){message(String(e));}}link.send({type:'cue',cue:'stop',id:++cueId});}else if(review){review=null;playing=false;renderTakes();renderSteps();}changedContext();}
function reviewTake(take:Take){if(recorder.take||countdown)return;release();review=take;reviewTime=0;playing=false;renderTakes();renderSteps();changedContext();}
function play(){if(store.state.frozen||recorder.take||countdown||store.owner)return;if(!review&&takes.length)reviewTake(takes.at(-1)!);if(!review)return;release();if(reviewTime>=review.duration)reviewTime=0;playing=!playing;playAt=performance.now();changedContext();}
function scrub(value:number){if(!review||store.state.frozen)return;playing=false;reviewTime=clamp(value,0,review.duration);changedContext();}
function toggleFreeze(){release('Recording paused because the assembly was frozen.');playing=false;store.freeze();changedContext();}
function undo(){if(!working()||recorder.take)return;release();store.undo();if(trial)trial.undo++;changedContext();}
function receive(p:Packet){
 if(['frame','action'].includes(p.type)&&(p.context!==context||p.epoch!==link.epoch))return;
 if(p.type==='status'){const was=owns;owns=Boolean(p.owner);phoneConnected=Boolean(p.phoneConnected);if(was&&!owns)release('Phone ownership changed.');if(owns&&!was)changedContext();dirty=true;}
 if(p.type==='disconnected'||p.type==='lost'){owns=false;release('Phone control disconnected.');message(String(p.message??'Studio connection lost; reconnecting.'));}
 if(p.type==='phone-lost'){phoneConnected=false;release('Phone disconnected during recording.');message('Phone disconnected. The mechanism has stopped.');}
 if(p.type==='error')message(String(p.message));
 if(p.type==='frame'&&owns){phone.enabled=mode!=='mouse'&&canMove();const wasHeld=phone.held;phone.frame(p,performance.now());if((!p.active||!p.visible)&&wasHeld&&recorder.take){recorder.pause(store.state,performance.now(),'Phone became inactive.');changedContext();}}
 if(p.type==='action'&&owns&&mode!=='mouse'){
  if(p.action==='select-lid'||p.action==='select-tray')select(p.action==='select-lid'?'lid':'tray');
  if(p.action==='fine'){if(!phone.held)applyValue(Number(p.value));}if(p.action==='fine-end')finishFine();
  if(p.action==='limit')setLimit(Number(p.value));if(p.action==='scrub')scrub(Number(p.value));
  if(p.action==='record')record();if(p.action==='stop')stop();if(p.action==='play')play();if(p.action==='marker')recorder.step('Step marker.','marker',performance.now());if(p.action==='undo')undo();if(p.action==='freeze'||p.action==='resume'){if((p.action==='freeze')!==store.state.frozen)toggleFreeze();}
 }
 if(p.type==='capability'){hardware[String(p.name)]=p.value;dirty=true;}
}
$$('[data-mode]').forEach(b=>b.onclick=()=>{release('Input mode changed during recording.');mode=b.dataset.mode!;if(mode!=='webcam')stopCamera();changedContext();});
$$('[data-tool]').forEach(b=>b.onclick=()=>{release();tool=b.dataset.tool!;changedContext();});
$$('[data-part]').forEach(b=>b.onclick=()=>select(b.dataset.part as Part));
$('#claim').onclick=()=>link.send({type:'claim',takeover:true});$('#release-phone').onclick=()=>{release('Phone control released.');link.send({type:'release'});};$('#pair').onclick=()=>{$('#pair-help').hidden=!$('#pair-help').hidden;};
$('#undo').onclick=undo;$('#freeze').onclick=toggleFreeze;$('#reset').onclick=()=>{if(!working()||recorder.take)return;release();store.reset();changedContext();};
$('#fixture').onchange=()=>{if(!working()||recorder.take)return;release();store.reset($<HTMLSelectElement>('#fixture').value as Fixture);changedContext();};
$('#joint-value').oninput=()=>applyValue(Number($<HTMLInputElement>('#joint-value').value));for(const e of ['change','pointerup','pointercancel','blur','keyup'])$('#joint-value').addEventListener(e,finishFine);
$('#apply-value').onclick=()=>{applyValue(Number($<HTMLInputElement>('#joint-number').value));finishFine();};
$('#apply-limit').onclick=()=>setLimit(Number($<HTMLInputElement>('#limit-value').value));$('#limit-here').onclick=()=>setLimit(store.state.pose.angle);$('#confirm-limit').onclick=()=>{if(pendingLimit!==null)setLimit(pendingLimit,true);};
$('#record').onclick=record;$('#stop').onclick=stop;$('#play').onclick=play;$('#marker').onclick=()=>{recorder.step('Step marker.','marker',performance.now());dirty=true;};$('#timeline').oninput=()=>scrub(Number($<HTMLInputElement>('#timeline').value));
$('#use-pose').onclick=()=>{if(!review||store.state.frozen)return;const p=poseAt(review,reviewTime),accepted=move(store.state.pose,p,store.state.config);if(Math.abs(accepted.pose.angle-p.angle)>1e-6||Math.abs(accepted.pose.lift-p.lift)>1e-6){message('That pose cannot be reached from the current assembly configuration. Stop review and reposition the parts first.');return;}review=null;playing=false;store.action({angle:p.angle,lift:p.lift});renderTakes();renderSteps();changedContext();};
function download(name:string,data:string,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export').onclick=()=>download('mechanism-demonstrations.json',JSON.stringify(exportTakes(takes),null,2));
$('#export-text').onclick=()=>{const selected=review?[review]:takes;download('mechanism-instructions.md',selected.map(t=>`# ${t.name}\n\n${t.steps.map((s,i)=>`${i+1}. [${(s.t/1000).toFixed(1)}s] ${s.text}`).join('\n')}`).join('\n\n'),'text/markdown');};
$('#import').onchange=async()=>{const input=$<HTMLInputElement>('#import'),file=input.files?.[0];if(!file)return;try{if(recorder.take||countdown)throw new Error('Finish recording before importing.');if(file.size>2*1024*1024)throw new Error('Use a file smaller than 2 MB.');const imported=importTakes(await file.text());if(imported.length+takes.length>3)throw new Error('Export and delete a take first; three takes maximum.');if(imported.some(t=>takes.some(old=>old.id===t.id)))throw new Error('This take is already loaded.');takes.push(...imported);reviewTake(imported[0]);message('Demonstrations imported and validated.');}catch(e){message(String(e));}finally{input.value='';}};
function renderTakes(){const host=$('#takes');host.replaceChildren();takes.forEach((take,i)=>{const row=document.createElement('div'),button=document.createElement('button'),del=document.createElement('button'),name=document.createElement('input');row.className='take-row';name.value=take.name;name.maxLength=100;name.setAttribute('aria-label',`Take ${i+1} name`);name.onchange=()=>{take.name=name.value;};button.textContent=`${review?.id===take.id?'● ':''}Take ${i+1} · ${(take.duration/1000).toFixed(1)}s${take.interrupted?' · interrupted':''}`;button.onclick=()=>reviewTake(take);del.textContent='Delete';del.onclick=()=>{if(recorder.take||countdown)return;if(review===take){review=null;playing=false;}takes=takes.filter(t=>t!==take);renderTakes();renderSteps();changedContext();};row.append(button,name,del);host.append(row);});}
function renderSteps(){const host=$('#steps');host.replaceChildren();if(!review)return;const hint=document.createElement('p');hint.textContent='Recorded steps · edit the captions before exporting.';host.append(hint);review.steps.forEach((step,i)=>{const label=document.createElement('label'),time=document.createElement('button'),input=document.createElement('input');time.textContent=`${(step.t/1000).toFixed(1)}s`;time.onclick=()=>scrub(step.t);input.value=step.text;input.maxLength=240;input.setAttribute('aria-label',`Step ${i+1} caption`);input.onchange=()=>{step.text=input.value;};label.append(time,input);host.append(label);});}
function beginDrag(owner:string,x:number,y:number){if(!canMove()||tool==='part'&&!store.begin(owner)){message('Release the current control first.');return false;}if(tool!=='part')store.beginView();drag={owner,x,y,base:clone(store.state)};return true;}
function moveDrag(x:number,y:number){if(!drag)return;const dx=x-drag.x,dy=y-drag.y,b=drag.base;if(tool==='part'){const delta=b.selected==='lid'?-dy*180:view.axisDrag(dx,dy);if(delta===null){message('Rotate the view to see the vertical guide, or use the slider.');return;}store.setPose({...b.pose,[b.selected==='lid'?'angle':'lift']:b.pose[b.selected==='lid'?'angle':'lift']+delta},drag.owner);}else if(tool==='pan')store.view({x:b.view.x-dx*450/b.view.zoom,y:b.view.y+dy*380/b.view.zoom});else if(tool==='orbit')store.view({yaw:b.view.yaw-dx*4,pitch:b.view.pitch+dy*3});else store.view({zoom:b.view.zoom*Math.exp(-dy*3)});}
function endDrag(){if(!drag)return;const owner=drag.owner;drag=null;if(tool==='part'){store.end(owner);movementStep();}else store.endView();}
const host=$('#assembly-view'),position=(e:PointerEvent)=>{const r=host.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};
host.addEventListener('pointerdown',e=>{if(e.target instanceof HTMLElement&&e.target.closest('button'))return;if(e.button!==0)return;const p=position(e);if(tool==='part'){const hit=view.pick(p.x,p.y);if(hit&&hit!==store.state.selected)select(hit);}if(beginDrag('mouse',p.x,p.y)){host.setPointerCapture(e.pointerId);e.preventDefault();}});
host.addEventListener('pointermove',e=>{if(drag?.owner==='mouse'){const p=position(e);moveDrag(p.x,p.y);}});for(const e of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(e,()=>{if(drag?.owner==='mouse')endDrag();});
let wheelEnd:ReturnType<typeof setTimeout>|undefined;
host.addEventListener('wheel',e=>{e.preventDefault();store.beginView();store.view({zoom:store.state.view.zoom*Math.exp(-e.deltaY*.001)});clearTimeout(wheelEnd);wheelEnd=setTimeout(()=>store.endView(),180);},{passive:false});$('#zoom-in').onclick=()=>store.viewAction({zoom:store.state.view.zoom*1.15});$('#zoom-out').onclick=()=>store.viewAction({zoom:store.state.view.zoom/1.15});$('#center').onclick=()=>store.viewAction({x:0,y:0,zoom:1,yaw:0,pitch:0});
document.addEventListener('keydown',e=>{if((e.target as HTMLElement).matches('input,textarea,select'))return;if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();undo();}if(e.code==='Space'&&!(e.target as HTMLElement).closest('button')){e.preventDefault();toggleFreeze();}if(e.key==='Escape'){release('Recording paused with Escape.');playing=false;changedContext();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){release('Studio hidden during recording.');playing=false;countdown=0;changedContext();}});
function stopCamera(){probe?.stop();probe=null;stream?.getTracks().forEach(t=>t.stop());stream=null;$<HTMLVideoElement>('#hand-video').hidden=true;$('#camera-placeholder').hidden=false;$('#camera-toggle').textContent='Enable webcam';release();handStats={status:'off'};}
$('#camera-toggle').onclick=async()=>{if(stream){stopCamera();return;}if(cameraStarting)return;if(mode!=='webcam'){release();mode='webcam';changedContext();}if(!$<HTMLSelectElement>('#hand-region').value)$<HTMLSelectElement>('#hand-region').value='any';cameraStarting=true;try{stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});const video=$<HTMLVideoElement>('#hand-video');video.srcObject=stream;video.hidden=false;await video.play();$('#camera-placeholder').hidden=true;$('#camera-toggle').textContent='Stop webcam';probe=new HandProbe(video,$<HTMLCanvasElement>('#hand-overlay'),(data,text)=>{if(data.status==='error'){stopCamera();$('#gesture-status').textContent=text;}handStats=data;},hands);probe.start();}catch(e){$('#gesture-status').textContent=String(e);stopCamera();}finally{cameraStarting=false;}};
$('#hand-region').onchange=()=>release();$('#reach').onchange=()=>release();
function hands(list:Landmark[][],at:number,world:Landmark[][]){
 if(mode!=='webcam'||!stream||document.hidden||!document.hasFocus()||!link.client.active){if(drag?.owner==='hand')endDrag();fist.reset();dwell.reset();return;}lastHand=performance.now();const region=$<HTMLSelectElement>('#hand-region').value;if(!region){$('#gesture-status').textContent='Choose the half containing your free hand.';return;}fist.region=region as 'left'|'right'|'any';
 const choices=list.map((h,index)=>({h,index})).filter(({h})=>region==='any'||(region==='left'?1-h[0].x<.5:1-h[0].x>=.5));
 if(choices.length>1){release('More than one hand entered the control region.');$('#gesture-status').textContent='Show one free hand in the selected region.';return;}
 const candidate=choices[0],reach=Number($<HTMLSelectElement>('#reach').value),remap=(x:number,y:number)=>{const localX=region==='left'?x*2:region==='right'?(x-.5)*2:x;return {x:clamp(.5+(localX-.5)*reach,0,1),y:clamp(.5+(y-.5)*reach,0,1)};};
 if(candidate&&isPointing(world[candidate.index]?.length===21?world[candidate.index]:candidate.h)&&!drag&&!store.owner&&working()){
  const pos=remap(1-candidate.h[8].x,candidate.h[8].y);hover=view.pick(pos.x,pos.y);const d=dwell.update(hover,at);const pointer=$('#pointer');pointer.hidden=false;pointer.style.left=`${pos.x*100}%`;pointer.style.top=`${pos.y*100}%`;pointer.style.setProperty('--progress',`${d.progress*360}deg`);if(d.select&&d.select!==store.state.selected)select(d.select as Part);$('#gesture-status').textContent=hover?`Pointing at ${hover} · hold to select.`:'Point at the lid or a visible tray surface.';fist.update(list,at,{minX:0,maxX:1,minY:0,maxY:1},world);dirty=true;return;
 }
 dwell.reset();hover=null;$('#pointer').hidden=true;const f=fist.update(list,at,{minX:0,maxX:1,minY:0,maxY:1},world,$<HTMLVideoElement>('#hand-video').videoWidth/Math.max(1,$<HTMLVideoElement>('#hand-video').videoHeight));const p=remap(f.x,f.y);$('#gesture-status').textContent=f.message;
 if(f.phase==='start')beginDrag('hand',p.x,p.y);if(f.phase==='move'&&drag?.owner==='hand')moveDrag(p.x,p.y);if(f.phase==='end'&&drag?.owner==='hand'){endDrag();if(!candidate&&recorder.take)recorder.pause(store.state,performance.now(),'Hand tracking lost.');}dirty=true;
}
$('#trial-start').onclick=()=>{if(!working()||recorder.take)return;release();store.reset('clear');trial={start:performance.now(),mode,undo:0,selections:0,contacts:0};message('Trial started: open to 95°, then lift the tray to 120 mm.');};
$('#trial-end').onclick=()=>{if(!trial)return;const result={...trial,durationMs:performance.now()-trial.start,completed:Math.abs(store.state.pose.angle-95)<=3&&Math.abs(store.state.pose.lift-120)<=3,pose:{...store.state.pose},comfort:clamp(Number($<HTMLInputElement>('#comfort').value)||3,1,5)};trials.push(result);trial=null;message(result.completed?'Trial complete.':'Trial saved as incomplete; target was 95° and 120 mm.');dirty=true;};
$('#export-diagnostics').onclick=()=>download('mechanism-observations.json',JSON.stringify({at:new Date().toISOString(),trials,hardware,hands:handStats,renderMedianFps:1000/(percentile(renderIntervals,.5)??Infinity),notes:'Numeric software observations. Synthetic checks and classifier outputs do not establish physical accuracy.'},null,2));
function update(){
 const state=review?{...store.state,config:review.config,pose:poseAt(review,reviewTime),selected:poseAt(review,reviewTime).selected}:store.state;
 view.update(state,review?[]:store.contact?.parts??[],hover);const p=state.pose,selected=state.selected,value=selected==='lid'?p.angle:p.lift;
 $$('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$$('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));$$('[data-part]').forEach(b=>{b.classList.toggle('active',b.dataset.part===selected);(b as HTMLButtonElement).disabled=!working()||!!store.owner;});
 $('#connection').textContent=owns?(phoneConnected?'Phone connected':'Waiting for phone'):'Mouse studio';$('#connection').classList.toggle('live',owns&&phoneConnected);$('#claim').textContent=owns?'Phone control active':'Take phone control';$<HTMLButtonElement>('#claim').disabled=owns;$('#pose-label').textContent=`Lid ${p.angle.toFixed(1)}° · Tray ${p.lift.toFixed(1)} mm`;$('#view-owner').textContent=review?(playing?'Playing take':'Reviewing take'):store.state.frozen?'Frozen':store.owner?`Following ${store.owner}`:'Released';
 $('#contact').textContent=review?'Reviewing the saved fixture and joint limits. Stop returns to editing.':store.contact?.message??(selected==='lid'?'Drag upward or hold the phone pad and tilt to open the lid.':'Drag along the guide or use the slider to lift the tray.');$('#contact').classList.toggle('blocked',!!store.contact&&!review);
 $('#joint-label').textContent=selected==='lid'?'Lid angle':'Tray lift';$('#joint-output').textContent=`${value.toFixed(1)}${selected==='lid'?'°':' mm'}`;
 for(const id of ['joint-value','joint-number']){const el=$<HTMLInputElement>(`#${id}`);el.max=String(selected==='lid'?state.config.limit:160);if(document.activeElement!==el||id==='joint-value'&&store.owner!=='fine')el.value=String(value);el.disabled=!canMove();}
 $('#limit-output').textContent=`${state.config.limit.toFixed(1)}°`;if(document.activeElement!==$('#limit-value'))$<HTMLInputElement>('#limit-value').value=String(state.config.limit);
 for(const id of ['limit-value','apply-limit','limit-here','fixture','reset'])($(`#${id}`) as HTMLInputElement).disabled=!working()||!!recorder.take||!!store.owner;
 $<HTMLSelectElement>('#fixture').value=state.config.fixture;$('#freeze').textContent=store.state.frozen?'▶ Resume':'Ⅱ Freeze';$<HTMLButtonElement>('#undo').disabled=!working()||!!recorder.take||!store.history.length;
 const ph=phase(),duration=review?.duration??recorder.take?.duration??0,t=review?reviewTime:recorder.take?recorder.time(performance.now()):0;
 $('#phase-label').textContent=countdown?`Recording in ${Math.ceil((countdown-performance.now())/1000)}…`:recorder.paused?'Paused · recording interrupted':ph==='recording'?'Recording joint motion':ph==='playing'?'Playing demonstration':review?`${review.name}${review.interrupted?' · interrupted':''}`:'Ready to record';$('#record').textContent=recorder.paused?'● Resume take':'● Record';
 $<HTMLButtonElement>('#record').disabled=!!countdown||!!recorder.take&&!recorder.paused||store.state.frozen;$<HTMLButtonElement>('#play').disabled=!!recorder.take||!!countdown||!takes.length||store.state.frozen;$('#play').textContent=playing?'Ⅱ Pause':'▶ Play';$<HTMLButtonElement>('#stop').disabled=!recorder.take&&!review&&!countdown;$<HTMLButtonElement>('#marker').disabled=!recorder.take||recorder.paused;
 const timeline=$<HTMLInputElement>('#timeline');timeline.max=String(Math.max(1,Math.ceil(duration)));timeline.value=String(t);timeline.disabled=!review||store.state.frozen;$('#time').textContent=`${(t/1000).toFixed(1)} / ${(duration/1000).toFixed(1)} s`;
 for(const id of ['export','export-text'])$<HTMLButtonElement>(`#${id}`).disabled=!takes.length;$<HTMLButtonElement>('#use-pose').disabled=!review||store.state.frozen;
 $('#zoom-value').textContent=`${Math.round(state.view.zoom*100)}%`;$('#trial-status').textContent=trial?`${trial.mode} · ${((performance.now()-trial.start)/1000).toFixed(1)} s · ${trial.contacts} blocked attempts`:`${trials.length} trials saved in this tab.`;
 phone.enabled=owns&&mode!=='mouse'&&canMove();dirty=false;
}
function sendState(now:number){if(!owns||!link.connected)return;const sample=review?poseAt(review,reviewTime):null;const state=review?{...store.state,pose:sample!,selected:sample!.selected,config:review.config}:store.state;const p={type:'state',selected:state.selected,angle:state.pose.angle,lift:state.pose.lift,limit:state.config.limit,enabled:mode!=='mouse'&&canMove(),frozen:store.state.frozen,context,revision:store.revision,phase:phase(),duration:review?.duration??recorder.take?.duration??0,time:review?reviewTime:recorder.take?recorder.time(now):0};const key=JSON.stringify(p);if(key!==lastSendKey&&now-lastSend>50){link.send(p);lastSend=now;lastSendKey=key;}}
function tick(now:number){
 const dt=Math.min(.1,(now-lastRender)/1000);renderIntervals.push(now-lastRender);if(renderIntervals.length>600)renderIntervals.shift();lastRender=now;
 if(countdown&&now>=countdown){countdown=0;captionPose={...store.state.pose};recorder.start(store.state,now,mode);link.send({type:'cue',cue:'record',id:++cueId});changedContext();}
 if(recorder.take&&!recorder.paused){recorder.sample(store.state,now);if(recorder.time(now)>=30000)stop();dirty=true;}
 if(phone.tick(now,dt)&&recorder.take){recorder.pause(store.state,now,'Phone frames stopped.');changedContext();}
 if(drag?.owner==='hand'&&now-lastHand>250){release('Hand frames stopped.');changedContext();}
 if(playing&&review){reviewTime=Math.min(review.duration,reviewTime+(now-playAt)*Number($<HTMLSelectElement>('#speed').value));playAt=now;if(reviewTime>=review.duration)playing=false;dirty=true;}
 if(dirty||countdown||trial)update();view.render();sendState(now);requestAnimationFrame(tick);
}
setInterval(()=>{$('#diagnostics').textContent=`Render median ${(1000/(percentile(renderIntervals,.5)??Infinity)).toFixed(1)} fps · Inference p95 ${Number(handStats.inferenceP95Ms??0).toFixed(1)} ms`;},1000);
window.addEventListener('pagehide',()=>{stopCamera();link.send({type:'release'});link.close();view.dispose();});
(window as unknown as {__mechanismStudio:unknown}).__mechanismStudio={get state(){return clone(store.state);},get phase(){return phase();},get history(){return store.history.length;},get owner(){return store.owner;},get contact(){return store.contact;},get takes(){return structuredClone(takes);},get reviewTime(){return reviewTime;},get ownsPhone(){return owns;},get hands(){return handStats;},get hardware(){return hardware;},get trials(){return trials;},project:(part:Part)=>view.project(part)};
update();requestAnimationFrame(tick);

document.addEventListener('studio-before-navigation',()=>release('Workspace changed during recording.'));
