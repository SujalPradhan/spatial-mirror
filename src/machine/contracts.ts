import type {MirrorEngineOutput,MirrorScene,MirrorSound,MirrorState,MirrorWorld,WorldPoint} from '../mirror/contracts';
import type {MeshSkin} from '../mirror/parts-view';
import type {MirrorAim} from '../mirror/parts-overlay';
import type {MachineOptions,MachineState,Removable} from './model';

/** Solid, x-ray, then light painting: the last draws as x-ray with every moving part's path exposed over it. */
export type MachineSkin=Extract<MeshSkin,'glass'|'xray'>|'paint';
export const machineSkins:MachineSkin[]=['glass','xray','paint'];
/** Only the pose and crank persist. Removals and timing are play, so a reload starts with a working machine. */
export interface MachineSaved extends MirrorState {schema:1}
export type MachineSound=MirrorSound|{type:'stitch'|'fault'}|{type:'motor';speed:number};
/** Free-motion holes in cloth coordinates, oldest first once full. */
export interface Embroidery {x:Float32Array;z:Float32Array;jump:Uint8Array;count:number;head:number;version:number;hoop:[number,number]}
export interface MachineSceneExtra {
 machine:MachineState;options:Required<MachineOptions>;
 /** 0 whole machine, 1 close-up under the plate. */
 close:number;
 /** Model scale on the pose, and the model point held at the origin. */
 scale:number;focus:[number,number,number];
 /** 0 to 1: the close-up turned to look down on the cloth for drawing. */
 draw:number;
 /** Cloth slid by the hand, model x and z. */
 cloth:[number,number];
 embroidery:Embroidery;
 /** Top thread: 0 slack, .5 balanced, 1 at the snap. held is the pinch point in world space. */
 tension:{value:number;held:WorldPoint|null;broken:boolean};
 /** 0 to 1 slow-motion playback, and real milliseconds filmed. */
 highSpeed:number;realMs:number;
 /** Crank degrees exposed since light painting began. */
 exposure:number;
 /** 0 to 1 time freeze. */
 freeze:number;
 /** Recently unpicked locks, cloth x and seconds since. */
 unpicked:{x:number;age:number}[];
 hidden:Set<string>;fade:Record<string,number>;
 /** Reticles, missed pinches and the free-motion count-in, drawn by the overlay. */
 aims?:MirrorAim[];
 /** 0 to 1: the top thread lit as a pinch closes on it or holds it. */
 threadHot:number;
 /** 0 to 1: light on the loop as it is thrown, in place of any camera move. */
 loopLight:number;
}
export type MachineScene=MirrorScene<MachineSkin>&MachineSceneExtra;
export interface MachineEngineOutput extends MirrorEngineOutput<MachineScene,MachineSound> {stitches:number}
export interface MachineWorld extends MirrorWorld {partInfo(index:number):{id:string;title:string;role:string;removable:boolean};
 /** Where a part stands on the stage, 0..1 from the top left. */
 screenOf(id:string):{x:number;y:number};
 /** Whether a world point lies on the top thread, as seen on screen. */
 onThread?(point:WorldPoint):boolean;
 /** Screen pixels from a world point to the nearest drawn sample of the top thread, above or below the cloth. */
 threadDistance?(point:WorldPoint):number;
 /** That nearest thread point, in world space, for a reticle to snap to. */
 threadNear?(point:WorldPoint):WorldPoint|null;
 /** Where a world point falls on the stage, 0..1 from the top left. */
 stageOf?(point:WorldPoint):{x:number;y:number}}
export type {Removable};
