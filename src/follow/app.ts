import {runMirror} from '../mirror/shell';
import {followObject} from './object';
import {FollowHud} from './hud';

const debug=await runMirror(followObject),{engine}=debug,view=followObject.liveView!;
const stage=document.querySelector<HTMLElement>('#follow-stage')!;
const hud=new FollowHud(stage,engine,view);
// The shared gesture tutorial teaches command poses; here the hands are the content, so it stays out of the way.
document.querySelector<HTMLElement>('#follow-tutorial-replay')?.setAttribute('hidden','');
const loop=()=>{hud.update(stage.classList.contains('is-live')||debug.phoneCamera);requestAnimationFrame(loop);};loop();
(window as any).__follow=Object.defineProperties(debug,{view:{enumerable:true,get:()=>view},hud:{value:hud},scene:{enumerable:true,get:()=>view.last}});
