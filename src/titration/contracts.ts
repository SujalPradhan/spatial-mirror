import type {MirrorEngineOutput,MirrorView,MirrorSound} from '../mirror/contracts';
export type * from '../mirror/contracts';

export type TitrationSound=MirrorSound|{type:'drip'|'step'|'done'|'alert'};
/** Everything the 3D view draws; the simulation lives in Bench. */
export interface PropView {id:string;x:number;y:number;tilt:number;glow:number;fill:number;label:string}
export interface ZoneView {id:string;x:number;y:number;r:number}
export interface AckView {id:number;text:string;miss:boolean;x:number;y:number;age:number}
export interface TitrationScene {
 /** Burette reading in cm3 down from zero, and whether the burette holds titrant yet. */
 reading:number;filled:boolean;bubble:boolean;
 /** Stopcock opening, 0 to 1, and whether a continuous stream runs rather than drops. */
 tap:number;streaming:boolean;
 /** Whole drops that have left the tip so far; a rise spawns a falling drop. */
 dropCount:number;
 flask:{present:boolean;volume:number;rgb:[number,number,number];alpha:number;localRgb:[number,number,number];localAlpha:number};
 swirl:number;
 /** Everything on the bench by id, with a glow only on what the step wants touched, and the rings that mark where to take it. */
 props:PropView[];zones:ZoneView[];
 /** Where the camera sits: x, y, zoom, and the half width in scene units that must stay in view. */
 station:{x:number;y:number;zoom:number;wide:number};
 /** The mouth of a bottle that is pouring, or null. */
 pour:{x:number;y:number}|null;
 /** Liquid in the waste beaker, 0 to 1, and in the acid beaker. */
 waste:number;acid:number;
 /** Where each hand's pinch is, and whether it is closed. */
 cursors:{x:number;y:number;pinch:boolean}[];
 acks:AckView[];
}
export interface TitrationOutput extends MirrorEngineOutput<TitrationScene,TitrationSound> {}
export interface TitrationView extends MirrorView<TitrationScene> {screenOf(p:{x:number;y:number;z:number}):{x:number;y:number}}
