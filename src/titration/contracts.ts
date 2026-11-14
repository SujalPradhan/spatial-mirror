import type {MirrorEngineOutput,MirrorView,MirrorSound} from '../mirror/contracts';
export type * from '../mirror/contracts';

export type TitrationSound=MirrorSound|{type:'drip'|'step'|'done'|'alert'};
/** Everything the 3D view draws; the simulation lives in Bench. */
export interface TitrationScene {
 /** Burette reading in cm3 down from zero, and whether the burette holds titrant yet. */
 reading:number;filled:boolean;bubble:boolean;
 /** Stopcock opening, 0 to 1, and whether a continuous stream runs rather than drops. */
 tap:number;streaming:boolean;
 /** Whole drops that have left the tip so far; a rise spawns a falling drop. */
 dropCount:number;
 flask:{present:boolean;volume:number;rgb:[number,number,number];alpha:number;localRgb:[number,number,number];localAlpha:number};
 swirl:number;
 focus:boolean;
}
export interface TitrationOutput extends MirrorEngineOutput<TitrationScene,TitrationSound> {}
export interface TitrationView extends MirrorView<TitrationScene> {setFocus(on:boolean):void}
