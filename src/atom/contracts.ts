import type {MirrorEngineOutput,MirrorScene,MirrorSound,MirrorWorld} from '../mirror/contracts';
export type * from '../mirror/contracts';

export type AtomSkin='bohr';
export const atomSkins:AtomSkin[]=['bohr'];
/** An electron away from its shell, resting above a palm. x, y, z are world space; amount is 0 in its orbit to 1 at the palm. */
export interface AtomTaken {hand:number;electron:number;amount:number;x:number;y:number;z:number}
export interface AtomSceneExtra {
 element:number;
 /** One angle per electron, innermost first, in radians along its orbit. */
 angles:Float32Array;
 /** Orbital direction: 1 forward, negative reversed. */
 rate:number;
 taken:AtomTaken[];
 /** The slow turn of the whole atom and the nucleus's own tumble, in radians. */
 spin:number;tumble:number;
 /** 0 while one element is swapped for the next, back to 1. */
 fade:number;
 caption:string;
}
export type AtomScene=MirrorScene<AtomSkin>&AtomSceneExtra;
export type AtomSound=MirrorSound|{type:'take'|'return'|'next'};
export interface AtomWorld extends MirrorWorld {}
export interface AtomEngineOutput extends MirrorEngineOutput<AtomScene,AtomSound> {electrons:number}
