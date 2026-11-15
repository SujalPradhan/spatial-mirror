import {runMirror} from '../mirror/shell';
import {titrationObject} from './object';
import {mountGuide} from './ui';

const debug=await runMirror(titrationObject);
const keyed=(titrationObject.actions??[]).map(a=>({id:a.id,key:a.key}));
const guide=mountGuide(document.querySelector<HTMLElement>('#app')!,debug.engine,()=>titrationObject.liveView,debug.runAction,keyed,()=>debug.ready);
(window as any).__titration=Object.defineProperties(debug,{
 bench:{enumerable:true,get:()=>debug.engine.bench},lab:{enumerable:true,get:()=>debug.engine.lab},view:{enumerable:true,get:()=>titrationObject.liveView},
 guide:{enumerable:true,value:guide},live:{enumerable:true,get:()=>guide.live},
});
