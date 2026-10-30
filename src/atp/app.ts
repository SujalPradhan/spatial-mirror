import './style.css';
import {Euler,Quaternion} from 'three';
import {workspaceNav} from '../workspace-nav';
import {bindDocument} from '../documents';
import {ControlClient} from '../control';
import {getSession} from '../session';
import {HandProbe} from '../hand-probe';
import type {Packet,Quat} from '../types';
import type {AtpComponent,AtpInputSource,AtpInputTarget,AtpState} from './contracts';
import {chapters,sources,scientificNote,energyQuestion} from './content';
import {initialAtp,validateAtp,selectChapter,componentInfo,phaseSites,siteInfo,clampPhase,checkpoints} from './model';
import {AtpView} from './view';
import {AtpPhoneInput,AtpHandInput} from './input';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(id)!;
const all=(s:string)=>[...document.querySelectorAll<HTMLElement>(s)];
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
document.title='ATP Synthase — Spatial Studio';
$('#app').innerHTML=`<main class="atp-page">${workspaceNav()}<header class="atp-masthead"><div><h1>ATP <span>synthase</span></h1><p>A tiny motor. A living energy system.</p></div><div class="atp-toolbar"><button id="atp-guided">Explore freely</button><button data-representation="structure">Structure</button><button data-representation="mechanism">Mechanism</button><span class="atp-separator"></span><button id="atp-tool-view">Look around</button><button id="atp-tool-rotor">Turn rotor</button><button id="atp-play">Play cycle</button><button id="atp-recenter">Center</button><button id="atp-camera">Enable webcam</button><button id="atp-sources">About</button></div></header><section id="atp-stage" aria-label="ATP synthase exploration"><div id="atp-viewport" tabindex="0" aria-label="3D ATP synthase. Drag to orbit; scroll to zoom."></div><div class="atp-view-tools">${['orbit','pan','zoom'].map(v=>`<button data-view-tool="${v}">${v[0].toUpperCase()+v.slice(1)}</button>`).join('')}<button id="atp-undo">Undo</button><button id="atp-freeze">Freeze</button><label class="atp-zoom-label">Size <input id="atp-zoom" type="range" min=".65" max="2.5" step=".01" value="1" aria-label="View zoom"></label></div><div class="atp-legend" aria-label="Select a component">${Object.entries(componentInfo).map(([key,info])=>`<button data-part="${key}">${info.label}</button>`).join('')}</div><aside id="atp-camera-preview" hidden><video id="atp-video" playsinline muted></video><canvas id="atp-hand-overlay"></canvas><span id="atp-hand-status">Open hand, then make a fist.</span><select id="atp-region" aria-label="Free hand region"><option value="any">Either side</option><option value="left">Left side</option><option value="right">Right side</option></select></aside><article class="atp-story"><div class="atp-story-top"><span id="atp-kicker"></span><span id="atp-count"></span><button id="atp-card-toggle" aria-expanded="true" aria-label="Collapse lesson">−</button></div><h2 id="atp-title"></h2><p id="atp-description"></p><p id="atp-hint"></p><div id="atp-challenge" class="atp-challenge" hidden><p>1. Select the stationary support.</p><button id="atp-check-part">Check selected part</button><p>2. Advance the illustration to 120°.</p><button id="atp-check-phase">Check checkpoint</button><p>${energyQuestion.prompt}</p>${energyQuestion.choices.map((c,i)=>`<button data-answer="${i}">${c}</button>`).join('')}<p id="atp-feedback" role="status"></p></div><footer class="atp-story-bottom"><button id="atp-prev">← Back</button><div id="atp-dots">${chapters.map((c,i)=>`<button data-chapter="${i}" aria-label="Chapter ${i+1}: ${c.title}"></button>`).join('')}</div><button id="atp-next">Next →</button></footer></article><section class="atp-phase" aria-label="Illustrated rotor cycle"><label for="atp-phase">Rotor phase <output id="atp-phase-value">0°</output></label><input id="atp-phase" type="range" min="0" max="360" step="1" value="0"><div class="atp-checkpoints">${checkpoints.map(n=>`<button data-phase="${n}">${n}°</button>`).join('')}</div><div id="atp-sites"></div><p class="atp-illustration-note">Simplified teaching cycle · three 120° steps</p></section><p id="atp-status" role="status">Drag to look around · scroll to zoom</p><div id="atp-loading" role="status">Loading the molecular structure…</div></section><dialog id="atp-about"><h2>A real structure. An illustrated mechanism.</h2><p>${scientificNote}</p><p>Phone: hold the pad and tilt to look around or turn the rotor; release to stop. Webcam: open your hand, make a fist and move, then open to release. Mouse controls work throughout.</p><p>Structure coordinates: PDB 6OQR, Sobti et al. (2020), CC0 archive data. Independently prepared here. Visual reference: Anand’s ATP synthase exploration.</p><ul>${sources.map(s=>`<li><a href="${s.url}" target="_blank" rel="noopener">${s.label}</a></li>`).join('')}<li><a href="https://files.s-anand.net/pages/atp-synthase/" target="_blank" rel="noopener">Anand’s visual reference</a></li></ul><button id="atp-about-close">Back to the motor</button></dialog></main>`;
let state=initialAtp(),client:ControlClient|null=null,owns=false,playing=false,context=0,navTool:'orbit'|'pan'|'zoom'='orbit';
let drag:{id:number;x:number;y:number;view:AtpState['view'];phase:number;moved:boolean}|null=null,lastFine=-Infinity;
let owner:AtpInputSource|'mouse'|null=null,before:AtpState|null=null,history:AtpState[]=[],dirty=true,lastDescriptor='',lastPublish=0,ready=false;
const viewport=$('#atp-viewport'),view=new AtpView(viewport);
function notice(s:string){$('#atp-status').textContent=s;}
function descriptor(){return {enabled:!state.frozen,frozen:state.frozen,context,chapter:state.chapter,guided:state.guided,tool:state.tool,representation:state.representation,phase:state.phase,selected:state.selected,zoom:state.view.zoom,playing};}
function publish(){client?.send({type:'state',...descriptor()});lastDescriptor=JSON.stringify(descriptor());lastPublish=performance.now();}
function finish(source:typeof owner){if(owner!==source)return;if(before&&JSON.stringify(before)!==JSON.stringify(state)){history.push(before);if(history.length>25)history.shift();}before=null;owner=null;dirty=true;}
function begin(source:NonNullable<typeof owner>){if(!owns||state.frozen||document.hidden||!document.hasFocus()||!ready)return false;if(owner&&owner!==source){notice('Release the current control first.');return false;}if(!owner){playing=false;owner=source;before=structuredClone(state);}return true;}
const target:AtpInputTarget={state:()=>state,navigation:()=>navTool,begin,view:q=>{state.view.q=q;dirty=true;},phase:n=>{state.phase=clampPhase(n);dirty=true;},zoom:n=>{state.view.zoom=clamp(n,.65,2.5);dirty=true;},pan:(x,y)=>{state.view.x=clamp(x,-6,6);state.view.y=clamp(y,-6,6);dirty=true;},end:finish,status:s=>{$('#atp-hand-status').textContent=s;}};
const phone=new AtpPhoneInput(target),hand=new AtpHandInput(target);hand.region='any';
function release(){phone.release();hand.release();finish(owner);drag=null;}
function change(fn:()=>void,remember=true,allowFrozen=false){if(!owns||state.frozen&&!allowFrozen)return;release();playing=false;const old=structuredClone(state);fn();if(remember&&JSON.stringify(old)!==JSON.stringify(state)){history.push(old);if(history.length>25)history.shift();}context++;dirty=true;updateUI();publish();}
function chapter(n:number){change(()=>{state=selectChapter(state,clamp(n,0,chapters.length-1));});$('#atp-feedback').textContent='';}
function tool(v:'view'|'rotor'){change(()=>{state.tool=v;if(v==='rotor')state.representation='mechanism';});}
function phase(n:number){change(()=>{state.phase=clampPhase(n);state.representation='mechanism';});}
function play(value:boolean){change(()=>{if(value){state.representation='mechanism';if(state.phase>=360)state.phase=0;}},false);if(owns&&!state.frozen)playing=value;dirty=true;publish();}
function undo(){change(()=>{const old=history.pop();if(old)state=old;},false,true);}
function receive(p:Packet){
 if(p.type==='status'){owns=!!p.owner;phone.enabled=hand.enabled=owns;if(!owns){release();playing=false;}dirty=true;}
 if(['local-release','lost','disconnected'].includes(p.type)){owns=false;release();playing=false;dirty=true;}
 if(p.type==='phone-lost'){phone.release();finish('phone');}
 if(['frame','action'].includes(p.type)&&(!owns||p.context!==context))return;
 if(p.type==='frame'){phone.frame(p,performance.now());return;}
 if(p.type!=='action')return;
 const action=String(p.action),n=Number(p.value);
 if(action==='fine-end'){finish('phone');return;}
 if(action==='freeze'||action==='resume'){change(()=>{state.frozen=action==='freeze';},true,true);return;}
 if(action==='undo'){undo();return;}
 if(state.frozen)return;
 if(action==='atp-view'||action==='atp-rotor')tool(action==='atp-view'?'view':'rotor');
 else if(action==='atp-prev'||action==='atp-next')chapter(state.chapter+(action==='atp-next'?1:-1));
 else if(action==='atp-play'||action==='atp-pause')play(action==='atp-play');
 else if(action==='atp-recenter')change(()=>{state.view=structuredClone(chapters[state.chapter].view);});
 else if(action==='atp-guided'||action==='atp-explore')change(()=>{state.guided=action==='atp-guided';});
 else if(action.startsWith('atp-select-')){const part=action.slice(11) as AtpComponent;if(part in componentInfo)change(()=>{state.selected=part;});}
 else if(action==='atp-checkpoint'&&Number.isFinite(n)&&n>=0&&n<=360)phase(n);
 else if(action==='atp-phase'&&Number.isFinite(n)&&n>=0&&n<=360){if(state.representation==='mechanism'&&begin('phone')){lastFine=performance.now();state.phase=n;dirty=true;}}
 else if(action==='atp-zoom'&&Number.isFinite(n)&&n>=.65&&n<=2.5){if(begin('phone')){lastFine=performance.now();state.view.zoom=n;dirty=true;}}
 else if(action==='atp-zoom-in'||action==='atp-zoom-out')change(()=>{state.view.zoom=clamp(state.view.zoom*(action==='atp-zoom-in'?1.15:1/1.15),.65,2.5);});
}
const binding=await bindDocument('atp:6oqr',()=>state,v=>{release();state=validateAtp(v);playing=false;history=[];dirty=true;context++;publish();});
const session=await getSession();client=new ControlClient('desktop',session.token,receive,descriptor());publish();
view.ready.then(()=>{ready=true;$('#atp-loading').hidden=true;dirty=true;}).catch(error=>{const el=$('#atp-loading');el.classList.add('atp-error');el.textContent='Could not load the structure. '+String(error);const b=document.createElement('button');b.textContent='Try again';b.onclick=()=>location.reload();el.append(b);});
viewport.addEventListener('atp-render-error',e=>{ready=false;release();playing=false;const el=$('#atp-loading');el.hidden=false;el.classList.add('atp-error');el.textContent=String((e as CustomEvent).detail);});
$('#atp-guided').onclick=()=>change(()=>{state.guided=!state.guided;});
$('#atp-tool-view').onclick=()=>tool('view');$('#atp-tool-rotor').onclick=()=>tool('rotor');
$('#atp-prev').onclick=()=>chapter(state.chapter-1);$('#atp-next').onclick=()=>chapter(state.chapter+1);
$('#atp-recenter').onclick=()=>change(()=>{state.view=structuredClone(chapters[state.chapter].view);});
$('#atp-play').onclick=()=>play(!playing);
$('#atp-undo').onclick=undo;$('#atp-freeze').onclick=()=>change(()=>{state.frozen=!state.frozen;},true,true);
const zoomSlider=$<HTMLInputElement>('#atp-zoom');zoomSlider.oninput=()=>{if(begin('mouse')){state.view.zoom=Number(zoomSlider.value);dirty=true;}};zoomSlider.onchange=()=>finish('mouse');zoomSlider.onpointercancel=()=>finish('mouse');zoomSlider.onblur=()=>finish('mouse');
all('[data-chapter]').forEach(b=>b.onclick=()=>chapter(Number(b.dataset.chapter)));
all('[data-part]').forEach(b=>b.onclick=()=>change(()=>{state.selected=b.dataset.part as AtpComponent;}));
all('[data-phase]').forEach(b=>b.onclick=()=>phase(Number(b.dataset.phase)));
all('[data-view-tool]').forEach(b=>b.onclick=()=>{release();navTool=b.dataset.viewTool as typeof navTool;dirty=true;});
all('[data-representation]').forEach(b=>b.onclick=()=>change(()=>{state.representation=b.dataset.representation as AtpState['representation'];if(state.representation==='structure')state.tool='view';}));
const slider=$<HTMLInputElement>('#atp-phase');slider.oninput=()=>{if(begin('mouse')){state.phase=Number(slider.value);dirty=true;}};slider.onchange=()=>finish('mouse');slider.onpointercancel=()=>finish('mouse');slider.onblur=()=>finish('mouse');
$('#atp-card-toggle').onclick=()=>{const card=$('.atp-story'),collapsed=card.classList.toggle('is-collapsed');$('#atp-card-toggle').setAttribute('aria-expanded',String(!collapsed));$('#atp-card-toggle').textContent=collapsed?'+':'−';$('#atp-card-toggle').setAttribute('aria-label',collapsed?'Expand lesson':'Collapse lesson');};
$('#atp-sources').onclick=()=>{$<HTMLDialogElement>('#atp-about').showModal();release();playing=false;dirty=true;};$('#atp-about-close').onclick=()=>$<HTMLDialogElement>('#atp-about').close();
$('#atp-check-part').onclick=()=>{$('#atp-feedback').textContent=state.selected==='stator'?'Yes. The stator supports the head against rotation.':'Select Stator in the model or component list, then try again.';};
$('#atp-check-phase').onclick=()=>{$('#atp-feedback').textContent=Math.abs(state.phase-120)<=1?'Yes. One illustrated 120° step changes the three site roles.':'Use the 120° checkpoint, then compare Site A with its starting state.';};
all('[data-answer]').forEach(b=>b.onclick=()=>{$('#atp-feedback').textContent=Number(b.dataset.answer)===energyQuestion.correct?energyQuestion.explanation:'Try again. Think about the difference between the two sides of the membrane.';});
viewport.onpointerdown=e=>{if((e.target as HTMLElement).closest('button,input,select'))return;if(e.button!==0||!begin('mouse'))return;viewport.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,view:structuredClone(state.view),phase:state.phase,moved:false};};
viewport.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved||=Math.hypot(dx,dy)>4;if(state.tool==='rotor')state.phase=clampPhase(drag.phase-dy);else if(navTool==='zoom')state.view.zoom=clamp(drag.view.zoom*Math.exp(-dy/220),.65,2.5);else if(navTool==='pan'){state.view.x=clamp(drag.view.x+dx/90,-6,6);state.view.y=clamp(drag.view.y-dy/90,-6,6);}else state.view.q=new Quaternion().setFromEuler(new Euler(dy*.006,dx*.006,0,'YXZ')).multiply(new Quaternion().fromArray(drag.view.q)).normalize().toArray() as Quat;dirty=true;};
function endDrag(e:PointerEvent){if(!drag||drag.id!==e.pointerId)return;const click=!drag.moved;drag=null;finish('mouse');if(click&&e.type==='pointerup'){state.selected=view.pick(e.clientX,e.clientY);dirty=true;}if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);}
viewport.onpointerup=endDrag;viewport.onpointercancel=endDrag;viewport.onlostpointercapture=e=>{if(drag?.id===e.pointerId){drag=null;finish('mouse');}};
viewport.addEventListener('wheel',e=>{e.preventDefault();change(()=>{state.view.zoom=clamp(state.view.zoom*Math.exp(-e.deltaY*.001),.65,2.5);});},{passive:false});
viewport.onkeydown=e=>{if(e.key==='Escape'){release();playing=false;dirty=true;}if(e.key==='Home')$('#atp-recenter').click();};
let stream:MediaStream|null=null,probe:HandProbe|null=null,cameraStarting=false,cameraGeneration=0;
const video=$<HTMLVideoElement>('#atp-video');
function stopCamera(){cameraGeneration++;cameraStarting=false;probe?.stop();probe=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;hand.release();$('#atp-camera-preview').hidden=true;$('#atp-camera').textContent='Enable webcam';$('#atp-camera').setAttribute('aria-pressed','false');}
async function startCamera(){if(stream||cameraStarting){stopCamera();return;}const generation=++cameraGeneration;cameraStarting=true;$('#atp-camera').textContent='Cancel webcam';try{const next=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480}},audio:false});if(generation!==cameraGeneration){next.getTracks().forEach(t=>t.stop());return;}stream=next;video.srcObject=next;await video.play();if(generation!==cameraGeneration)return;$('#atp-camera-preview').hidden=false;probe=new HandProbe(video,$<HTMLCanvasElement>('#atp-hand-overlay'),(data,message)=>{$('#atp-hand-status').textContent=message;if(data.status==='error')stopCamera();},(hands,at,world)=>{if(owns&&!document.hidden&&document.hasFocus())hand.update(hands,at,world,video.videoWidth/video.videoHeight);else hand.release();});probe.start();$('#atp-camera').textContent='Disable webcam';$('#atp-camera').setAttribute('aria-pressed','true');}catch(e){if(generation===cameraGeneration){stopCamera();notice('Camera unavailable. '+String(e));}}finally{if(generation===cameraGeneration)cameraStarting=false;}}
$('#atp-camera').onclick=()=>void startCamera();$<HTMLSelectElement>('#atp-region').onchange=e=>{hand.region=(e.target as HTMLSelectElement).value as 'any'|'left'|'right';};
function updateUI(){const c=chapters[state.chapter],info=state.selected?componentInfo[state.selected]:null;
 $('#atp-kicker').textContent=state.guided?c.kicker:'Explore · '+(info?.scientific??'Choose a component');$('#atp-count').textContent=state.guided?`${state.chapter+1} / ${chapters.length}`:'';
 $('#atp-title').textContent=state.guided?c.title:info?.label??'Follow your curiosity';$('#atp-description').textContent=state.guided?c.text:info?.description??'Select a component to learn its role. Compare the measured structure with the simplified mechanism.';
 $('#atp-hint').textContent=state.guided?c.hint:state.tool==='rotor'?'Hold the phone pad and tilt, or move a closed fist up/down. Release to stop.':'Phone tilt or fist movement orbits the view. Use Pan or Zoom for webcam navigation.';
 $('#atp-guided').textContent=state.guided?'Explore freely':'Guided tour';$('#atp-guided').setAttribute('aria-pressed',String(state.guided));
 $('#atp-prev').hidden=!state.guided;$('#atp-next').hidden=!state.guided;$('#atp-dots').hidden=!state.guided;$<HTMLButtonElement>('#atp-prev').disabled=state.chapter===0;$<HTMLButtonElement>('#atp-next').disabled=state.chapter===chapters.length-1;
 $('#atp-tool-view').setAttribute('aria-pressed',String(state.tool==='view'));$('#atp-tool-rotor').setAttribute('aria-pressed',String(state.tool==='rotor'));
 $('#atp-play').textContent=playing?'Pause cycle':'Play cycle';$('#atp-play').setAttribute('aria-pressed',String(playing));
 all('[data-part]').forEach(b=>b.setAttribute('aria-pressed',String(state.selected===b.dataset.part)));all('[data-representation]').forEach(b=>b.setAttribute('aria-pressed',String(state.representation===b.dataset.representation)));all('[data-view-tool]').forEach(b=>b.setAttribute('aria-pressed',String(navTool===b.dataset.viewTool)));all('[data-chapter]').forEach(b=>b.setAttribute('aria-current',String(state.chapter===Number(b.dataset.chapter))));all('[data-phase]').forEach(b=>b.setAttribute('aria-pressed',String(Math.abs(state.phase-Number(b.dataset.phase))<.5)));
 $('#atp-freeze').textContent=state.frozen?'Resume':'Freeze';$('#atp-freeze').setAttribute('aria-pressed',String(state.frozen));zoomSlider.value=String(state.view.zoom);zoomSlider.disabled=state.frozen||!owns;
 $('.atp-phase').hidden=state.representation!=='mechanism';slider.value=String(state.phase);slider.disabled=state.frozen||!owns;$('#atp-phase-value').textContent=Math.round(state.phase)+'°';$('#atp-sites').innerHTML=phaseSites(state.phase).map(s=>`<div><b>${s.label}</b><span title="${siteInfo[s.state].description}">${siteInfo[s.state].label}</span></div>`).join('');
 $('#atp-challenge').hidden=!(state.guided&&state.chapter===5);all('.atp-toolbar button:not(#atp-camera):not(#atp-sources),.atp-legend button,.atp-view-tools button').forEach(b=>(b as HTMLButtonElement).disabled=!owns||(state.frozen&&!['atp-freeze','atp-undo'].includes(b.id)));
 all('[data-phase],[data-chapter],#atp-prev,#atp-next').forEach(b=>(b as HTMLButtonElement).disabled=!owns||state.frozen||b.id==='atp-prev'&&state.chapter===0||b.id==='atp-next'&&state.chapter===chapters.length-1);
 view.update(state);dirty=false;
}
let lastTick=performance.now(),stopped=false;
function tick(now:number){if(stopped)return;const dt=Math.min(.1,(now-lastTick)/1000);lastTick=now;phone.tick(now);hand.tick(now);if(owner==='phone'&&!phone.held&&now-lastFine>500)finish('phone');if(playing&&owns&&!state.frozen&&!document.hidden){state.phase=clampPhase(state.phase+dt*36);if(state.phase>=360)playing=false;dirty=true;}if(dirty)updateUI();if(ready)view.render();if(now-lastPublish>100&&lastDescriptor!==JSON.stringify(descriptor()))publish();requestAnimationFrame(tick);}
requestAnimationFrame(tick);
function interrupt(){release();playing=false;dirty=true;publish();}
window.addEventListener('blur',interrupt);document.addEventListener('visibilitychange',()=>{if(document.hidden){interrupt();stopCamera();}});document.addEventListener('studio-before-navigation',()=>{interrupt();stopCamera();});window.addEventListener('pagehide',()=>{stopped=true;stopCamera();release();client?.close();binding.close();view.dispose();});
(window as any).__atpStudio={get state(){return structuredClone(state);},get playing(){return playing;},get ready(){return ready;},get owns(){return owns;},get phoneHeld(){return phone.held;},get handHeld(){return hand.held;},get owner(){return owner;},get context(){return context;}};
