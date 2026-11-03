import {runMirror} from '../mirror/shell';
import {TIMING_STEPS} from './behaviour';
import {machineObject} from './object';

const debug=await runMirror(machineObject),{engine}=debug;
const stage=document.querySelector<HTMLElement>('#machine-stage')!,viewport=document.querySelector<HTMLElement>('#machine-viewport')!;
stage.insertAdjacentHTML('beforeend',`<p id="machine-caption" class="machine-caption" aria-live="polite"></p><p class="machine-legend" aria-hidden="true"><span class="top">top thread</span><span class="under">bobbin thread</span></p>`);
stage.insertAdjacentHTML('beforeend',`<div class="machine-controls"><button id="machine-framing">Whole machine</button><button id="machine-timing" title="Press T">Hook on time</button></div>`);
const caption=document.querySelector<HTMLElement>('#machine-caption')!,timing=document.querySelector<HTMLElement>('#machine-timing')!,framing=document.querySelector<HTMLElement>('#machine-framing')!;
const retime=()=>{engine.cycleTiming();};
timing.onclick=retime;framing.onclick=()=>{engine.toggleFraming();};
viewport.addEventListener('keydown',e=>{if(e.key==='t'||e.key==='T')retime();});
let said='';
function hud(){
 const text=engine.caption;if(text!==said){caption.textContent=said=text;caption.classList.toggle('is-fault',engine.machine.options.removed.length>0||engine.machine.timing>0);}
 const label=`Hook ${TIMING_STEPS[engine.machine.timing].label}`;if(timing.textContent!==label){timing.textContent=label;timing.classList.toggle('is-off',engine.machine.timing>0);}
 const next=engine.machine.close?'Whole machine':'Close-up';if(framing.textContent!==next)framing.textContent=next;
 requestAnimationFrame(hud);
}
hud();
(window as any).__machineStudio=Object.defineProperty(debug,'machine',{enumerable:true,get:()=>engine.machine});
