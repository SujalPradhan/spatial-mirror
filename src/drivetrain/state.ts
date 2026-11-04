import {Euler,Quaternion} from 'three';
import type {Quat} from '../types';
import type {MirrorDescriptor,MirrorViewState} from '../mirror/contracts';
import type {DrivetrainSaved} from './contracts';

/** Tipped back a little like a drafting table, so the tray at the bottom is nearest the hands. */
const homeQ=new Quaternion().setFromEuler(new Euler(-.3,0,0,'YXZ')).toArray() as Quat;
export const homeView=():MirrorViewState=>({q:[...homeQ],zoom:1,x:0,y:0});
export const initialDrivetrain=():DrivetrainSaved=>({schema:1,tool:'view',phase:0,view:homeView(),frozen:false});
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const bounded=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
/** A fresh allow-listed value: anything unknown is dropped. */
export function validateDrivetrain(value:unknown):DrivetrainSaved {
 if(!record(value)||value.schema!==1||!['view','rotor'].includes(value.tool as string)||!bounded(value.phase,0,360)||typeof value.frozen!=='boolean'||!record(value.view))throw Error('Invalid drivetrain state.');
 const view=value.view;
 if(!Array.isArray(view.q)||view.q.length!==4||!view.q.every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(Math.hypot(...view.q)-1)>.1||!bounded(view.zoom,.65,2.5)||!bounded(view.x,-6,6)||!bounded(view.y,-6,6))throw Error('Invalid drivetrain view.');
 const norm=Math.hypot(...view.q);
 return {schema:1,tool:value.tool as DrivetrainSaved['tool'],phase:value.phase,view:{q:view.q.map(n=>n/norm) as Quat,zoom:view.zoom,x:view.x,y:view.y},frozen:value.frozen};
}
export const drivetrainDescriptor=(state:DrivetrainSaved,position:number):MirrorDescriptor=>({chapter:0,guided:false,tool:state.tool,representation:'mechanism',phase:state.tool==='rotor'?Math.round(((position%360)+360)%360):0,selected:null,zoom:state.view.zoom,title:'Drivetrain',motionLabel:'crank',labels:{tool:'Crank',play:'Run',stop:'Stop'}});
