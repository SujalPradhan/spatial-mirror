import {runMirror} from '../mirror/shell';
import {atomObject} from './object';

const debug=await runMirror(atomObject);
(window as any).__atomStudio=Object.defineProperties(debug,{
 electrons:{enumerable:true,get:()=>debug.engine.electrons},element:{enumerable:true,get:()=>debug.engine.element},
 scene:{enumerable:true,get:()=>debug.engine.atomScene},view:{enumerable:true,get:()=>atomObject.liveView},
});
