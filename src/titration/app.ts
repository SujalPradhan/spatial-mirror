import {runMirror} from '../mirror/shell';
import {titrationObject} from './object';
import {mountPanel} from './panel';

const debug=await runMirror(titrationObject);
const panel=mountPanel(document.querySelector<HTMLElement>('#app')!,debug.engine,()=>titrationObject.liveView,()=>titrationObject.liveAudio);
(window as any).__titration=Object.defineProperties(debug,{
 bench:{enumerable:true,get:()=>debug.engine.bench},view:{enumerable:true,get:()=>titrationObject.liveView},
 panel:{enumerable:true,value:panel},live:{enumerable:true,get:()=>panel.live},
});
