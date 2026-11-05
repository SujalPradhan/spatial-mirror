import {runMirror} from '../mirror/shell';
import {graspObject} from './object';
import {GraspHud} from './hud';

const debug=await runMirror(graspObject),{engine}=debug,view=graspObject.liveView!;
const stage=document.querySelector<HTMLElement>('#grasp-stage')!,viewport=document.querySelector<HTMLElement>('#grasp-viewport')!;
const hud=new GraspHud(stage,engine,view);
// The shared gesture tutorial would teach poses this page reads as hand shapes; its corner button calibrates instead.
const replay=document.querySelector<HTMLButtonElement>('#grasp-tutorial-replay');
if(replay){replay.textContent='Calibrate';replay.onclick=()=>engine.startCalibration();}
const corner=document.querySelector<HTMLElement>('.grasp-corner');
corner?.insertAdjacentHTML('afterbegin','<button id="grasp-next" title="Next object (clap)">Next object</button>');
document.querySelector<HTMLElement>('#grasp-next')!.onclick=()=>engine.nextObject();
viewport.addEventListener('keydown',e=>{const k=e.key;if(['1','2','3','5'].includes(k))engine.setMotors(Number(k) as never);else if(k==='n')engine.nextObject();else if(k==='r')engine.reseat();else if(k==='c')engine.startCalibration();});
const loop=()=>{hud.update(stage.classList.contains('is-live')||debug.phoneCamera);requestAnimationFrame(loop);};loop();
(window as any).__grasp=Object.defineProperties(debug,{view:{enumerable:true,get:()=>view},hud:{value:hud},scene:{enumerable:true,get:()=>view.last}});
