import type {Quat} from '../types';
import type {AtpState,AtpViewState} from './contracts';

const quarterTurn=-.45;
export const homeView=():AtpViewState=>({q:[0,Math.sin(quarterTurn/2),0,Math.cos(quarterTurn/2)],zoom:1,x:0,y:0});
export function initialAtp():AtpState {return {schema:2,tool:'view',phase:0,view:homeView(),frozen:false};}
export function clampPhase(value:number):number {return Number.isFinite(value)?Math.max(0,Math.min(360,value)):0;}

const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const bounded=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;

/** Validate restored numeric state. Camera, spin and held inputs are never restored. */
export function validateAtp(value:unknown):AtpState {
 if(!record(value)||value.schema!==2||!['view','rotor'].includes(value.tool as string)||!bounded(value.phase,0,360)||typeof value.frozen!=='boolean'||!record(value.view))throw Error('Invalid ATP exploration.');
 const view=value.view;
 if(!Array.isArray(view.q)||view.q.length!==4||!view.q.every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(Math.hypot(...view.q)-1)>.1||!bounded(view.zoom,.65,2.5)||!bounded(view.x,-6,6)||!bounded(view.y,-6,6))throw Error('Invalid ATP view.');
 const norm=Math.hypot(...view.q);
 // Build a fresh allow-listed value: unknown fields such as playing/held are dropped.
 return {schema:2,tool:value.tool as AtpState['tool'],phase:value.phase,view:{q:view.q.map(n=>n/norm) as Quat,zoom:view.zoom,x:view.x,y:view.y},frozen:value.frozen};
}
