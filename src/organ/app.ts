import {runMirror} from '../mirror/shell';
import {organObject} from './object';

const debug=await runMirror(organObject);
const engine=debug.engine,host=document.querySelector<HTMLElement>('#organ-viewport')!;
// The cards' buttons reach every hand action by mouse and keyboard.
host.addEventListener('organ-action',e=>{
 const act=(e as CustomEvent).detail,at=organObject.liveView!.flask();
 if(act==='undo')engine.undo(at);else if(act==='spray')engine.spray(organObject.liveView!.palm());else if(act==='comply')engine.compliant(at);
 else if(act==='bottle')engine.bottle(at);else if(act==='clear')engine.clearFlask();else if(act==='product')engine.setProduct(engine.doc.product==='leave-on'?'rinse-off':'leave-on');
});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='z'&&!(e.target instanceof HTMLInputElement)){e.preventDefault();engine.undo(organObject.liveView!.flask());}});
(window as any).__organ=Object.defineProperties(debug,{
 doc:{enumerable:true,get:()=>engine.doc},scene:{enumerable:true,get:()=>engine.scene},view:{enumerable:true,get:()=>organObject.liveView},
});
