import type {MirrorEngineOutput,MirrorScene,MirrorSound,MirrorState,MirrorWorld} from '../mirror/contracts';
import type {MeshSkin} from '../mirror/parts-view';
import type {MachineOptions,MachineState,Removable} from './model';

export type MachineSkin=Extract<MeshSkin,'glass'|'xray'>;
/** Solid first. The name is the view's; opaque parts stay opaque under it. */
export const machineSkins:MachineSkin[]=['glass','xray'];
/** Only the pose and crank persist. Removals and timing are play, so a reload starts with a working machine. */
export interface MachineSaved extends MirrorState {schema:1}
export type MachineSound=MirrorSound|{type:'stitch'|'fault'}|{type:'motor';speed:number};
export interface MachineSceneExtra {
 machine:MachineState;options:Required<MachineOptions>;
 /** 0 whole machine, 1 close-up under the plate. */
 close:number;
 /** Model scale on the pose, and the model point held at the origin. */
 scale:number;focus:[number,number,number];
 /** Open-hand explode, kept apart from the engine's tear. */
 parted:number;
 hidden:Set<string>;fade:Record<string,number>;
}
export type MachineScene=MirrorScene<MachineSkin>&MachineSceneExtra;
export interface MachineEngineOutput extends MirrorEngineOutput<MachineScene,MachineSound> {stitches:number}
export interface MachineWorld extends MirrorWorld {partInfo(index:number):{id:string;title:string;role:string;removable:boolean};
 /** Where a part stands on the stage, 0..1 from the top left. */
 screenOf(id:string):{x:number;y:number}}
export type {Removable};
