import {Euler,Quaternion} from 'three';
import type {Quat} from '../types';
import type {MirrorViewState} from '../mirror/contracts';
import type {MachineSaved} from './contracts';

const homeQ=new Quaternion().setFromEuler(new Euler(.17,-.32,0,'YXZ')).toArray() as Quat;
export const homeView=():MirrorViewState=>({q:[...homeQ],zoom:1,x:0,y:0});
export const initialMachine=():MachineSaved=>({schema:1,tool:'view',phase:0,view:homeView(),frozen:false});
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const bounded=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
/** Builds a fresh allow-listed value: held input and anything unknown is dropped. */
export function validateMachine(value:unknown):MachineSaved {
 if(!record(value)||value.schema!==1||!['view','rotor'].includes(value.tool as string)||!bounded(value.phase,0,360)||typeof value.frozen!=='boolean'||!record(value.view))throw Error('Invalid machine state.');
 const view=value.view;
 if(!Array.isArray(view.q)||view.q.length!==4||!view.q.every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(Math.hypot(...view.q)-1)>.1||!bounded(view.zoom,.65,2.5)||!bounded(view.x,-6,6)||!bounded(view.y,-6,6))throw Error('Invalid machine view.');
 const norm=Math.hypot(...view.q);
 return {schema:1,tool:value.tool as MachineSaved['tool'],phase:value.phase,view:{q:view.q.map(n=>n/norm) as Quat,zoom:view.zoom,x:view.x,y:view.y},frozen:value.frozen};
}
