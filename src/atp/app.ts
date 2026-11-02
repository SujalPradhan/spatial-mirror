import {runMirror} from '../mirror/shell';
import {atpObject} from './object';

const debug=await runMirror(atpObject);
(window as any).__atpStudio=Object.defineProperty(debug,'atp',{enumerable:true,get:()=>debug.engine.atp});
