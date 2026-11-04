import {runMirror} from '../mirror/shell';
import {TIMING_STEPS} from './behaviour';
import {machineObject} from './object';
import {MachineHud} from './hud';

const debug=await runMirror(machineObject),{engine}=debug;
const stage=document.querySelector<HTMLElement>('#machine-stage')!,viewport=document.querySelector<HTMLElement>('#machine-viewport')!;
stage.insertAdjacentHTML('beforeend',`<p id="machine-caption" class="machine-caption" aria-live="polite"></p><p class="machine-legend" aria-hidden="true"><span class="top">top thread</span><span class="under">bobbin thread</span></p>`);
stage.insertAdjacentHTML('beforeend',`<div class="machine-controls"><button id="machine-framing">Whole machine</button><button id="machine-timing" title="Press T">Hook on time</button></div>`);
const panel=new MachineHud(stage,engine),still=window.matchMedia('(prefers-reduced-motion: reduce)');
const caption=document.querySelector<HTMLElement>('#machine-caption')!,timing=document.querySelector<HTMLElement>('#machine-timing')!,framing=document.querySelector<HTMLElement>('#machine-framing')!;
const retime=()=>{engine.cycleTiming();};
timing.onclick=retime;framing.onclick=()=>{engine.toggleFraming();};
viewport.addEventListener('keydown',e=>{if(e.key==='t'||e.key==='T')retime();});
let said='';
function hud(){
 engine.machine.reduced=still.matches;panel.update();
 const text=engine.caption,m=engine.machine;if(text!==said)caption.textContent=said=text;
 caption.classList.toggle('is-fault',m.options.removed.length>0||m.timing>0||m.broken);caption.classList.toggle('is-frozen',m.frozen);
 const label=`Hook ${TIMING_STEPS[engine.machine.timing].label}`;if(timing.textContent!==label){timing.textContent=label;timing.classList.toggle('is-off',engine.machine.timing>0);}
 const next=engine.machine.close?'Whole machine':'Close-up';if(framing.textContent!==next)framing.textContent=next;
 requestAnimationFrame(hud);
}
hud();
(window as any).__machineStudio=Object.defineProperty(debug,'machine',{enumerable:true,get:()=>engine.machine});
