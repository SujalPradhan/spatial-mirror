import {runMirror} from '../mirror/shell';
import {drivetrainObject} from './object';
import {DrivetrainHud} from './hud';

const debug=await runMirror(drivetrainObject),{engine}=debug;
const stage=document.querySelector<HTMLElement>('#drivetrain-stage')!,viewport=document.querySelector<HTMLElement>('#drivetrain-viewport')!;
const hud=new DrivetrainHud(stage,engine);
viewport.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(k==='d')hud.act('mode');else if(k==='n')hud.act('next');else if(k==='s')hud.act('schematic');else if(k==='z'&&(e.metaKey||e.ctrlKey))hud.act('undo');});
const loop=()=>{hud.update();requestAnimationFrame(loop);};loop();
(window as any).__drivetrain=Object.defineProperties(debug,{train:{enumerable:true,get:()=>engine.train},view:{enumerable:true,get:()=>drivetrainObject.liveView},hud:{value:hud}});
