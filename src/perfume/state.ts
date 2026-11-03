import {clampPhase,type MirrorDescriptor,type MirrorState,type MirrorViewState} from '../mirror/contracts';
import type {Quat} from '../types';

/** Only the pose and the phone's pump setting persist. Removed parts and liquid are play, and come back on reload. */
export interface PerfumeState extends MirrorState {schema:1}
const yaw=.3;
export const homeView=():MirrorViewState=>({q:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],zoom:1.25,x:-.7,y:0});
export const initialPerfume=():PerfumeState=>({schema:1,tool:'view',phase:0,view:homeView(),frozen:false});
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const bounded=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export function validatePerfume(value:unknown):PerfumeState {
 if(!record(value)||value.schema!==1||!['view','rotor'].includes(value.tool as string)||!bounded(value.phase,0,360)||typeof value.frozen!=='boolean'||!record(value.view))throw Error('Invalid perfume spray state.');
 const view=value.view;
 if(!Array.isArray(view.q)||view.q.length!==4||!view.q.every(n=>typeof n==='number'&&Number.isFinite(n))||Math.abs(Math.hypot(...view.q)-1)>.1||!bounded(view.zoom,.65,2.5)||!bounded(view.x,-6,6)||!bounded(view.y,-6,6))throw Error('Invalid perfume spray view.');
 const norm=Math.hypot(...view.q),tool=value.tool as PerfumeState['tool'];
 // A pump left pressed only makes sense while the phone is holding it.
 return {schema:1,tool,phase:tool==='rotor'?clampPhase(value.phase):0,view:{q:view.q.map(n=>n/norm) as Quat,zoom:view.zoom,x:view.x,y:view.y},frozen:value.frozen};
}
/** The relay requires the retired lesson fields, so they stay as constants. */
export const perfumeDescriptor=(state:PerfumeState,position:number):MirrorDescriptor=>({chapter:0,guided:false,tool:state.tool,representation:'structure',phase:Math.round(position),selected:null,zoom:state.view.zoom,title:'Perfume spray',motionLabel:'pump',labels:{tool:'Pump',play:'Press',stop:'Release',percent:true}});
