import {runMirror} from '../mirror/shell';
import type {Chapter} from './story';
import {organObject} from './object';

const debug=await runMirror(organObject);
const engine=debug.engine,host=document.querySelector<HTMLElement>('#organ-viewport')!,stage=document.querySelector<HTMLElement>('#organ-stage')!;
// The HUD's buttons and ribbon reach every hand action by mouse and keyboard.
host.addEventListener('organ-action',e=>{
 const {act,value}=(e as CustomEvent).detail as {act:string;value:number},palm=engine.scene.palm;
 if(act==='undo')engine.undo(palm);else if(act==='waft')engine.waft(palm);else if(act==='next')engine.next();else if(act==='clock')engine.setClock(value);
 else if(act==='chapter'&&value>=1&&value<=4)engine.goto(value as Chapter);else if(act==='warm')engine.toggleWarm(palm);
});
// While the mouse holds a vial the wheel tilts it; otherwise it zooms as on every page. Capture runs before the shell's own wheel handler.
stage.addEventListener('wheel',e=>{if(engine.wheel(e.deltaY)){e.preventDefault();e.stopPropagation();}},{capture:true,passive:false});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='z'&&!(e.target instanceof HTMLInputElement)){e.preventDefault();engine.undo(engine.scene.palm);}});
(window as any).__organ=Object.defineProperties(debug,{
 doc:{enumerable:true,get:()=>engine.doc},scene:{enumerable:true,get:()=>engine.scene},view:{enumerable:true,get:()=>organObject.liveView},story:{enumerable:true,get:()=>engine.scene.story},
});
