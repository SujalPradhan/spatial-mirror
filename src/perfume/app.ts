import {runMirror} from '../mirror/shell';
import {perfumeObject} from './object';

const debug=await runMirror(perfumeObject);
(window as any).__perfumeStudio=Object.defineProperties(debug,{
 pump:{enumerable:true,get:()=>debug.engine.pump},lastSpray:{enumerable:true,get:()=>debug.engine.lastSpray},
 caption:{enumerable:true,get:()=>debug.engine.caption},view:{enumerable:true,get:()=>perfumeObject.liveView},
});
