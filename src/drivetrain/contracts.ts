import type {HandPose,MirrorEngineOutput,MirrorPoint,MirrorScene,MirrorSound,MirrorState,MirrorWorld,WorldPoint} from '../mirror/contracts';
import type {V} from './gears';
import type {DrivetrainBehaviour} from './behaviour';

/** Machined metal, or the schematic: pitch circles with the ratio arithmetic on each mesh. */
export type DrivetrainSkin='metal'|'schematic';
export const drivetrainSkins:DrivetrainSkin[]=['metal','schematic'];
export type DrivetrainSound=MirrorSound|{type:'clink'|'pick'|'miss'|'break'|'held'|'met'|'tooth'|'free'|'match'|'draw'|'undo'|'mode'}|{type:'motor';speed:number;load:number};
/** Only the pose persists. The build is play, and a reload starts on the first brief with a bare board. */
export interface DrivetrainSaved extends MirrorState {schema:1}
/** A hand in board millimetres, with where it is on the stage in pixels for the overlay. */
export interface HandIn {id:number;pose:HandPose;pinch:V;tip:V;palm:V;
 /** Thumb to index over palm length: under about .8 the fingers are closing. */
 ratio:number;speed:number;
 screen:{pinch:{x:number;y:number};tip:{x:number;y:number};palm:{x:number;y:number}};
 /** Board millimetres per screen pixel where the hand is. */
 mmPerPx:number}
export interface DrivetrainWorld extends MirrorWorld {
 /** Where a mirror point falls on the board, mm; null if the ray misses it. */
 toBoard(p:MirrorPoint):V|null;
 worldToBoard(p:WorldPoint):V|null;
 /** A mirror point on the stage, pixels. */
 toScreen(p:MirrorPoint):{x:number;y:number};
 boardToScreen(x:number,y:number,z?:number):{x:number;y:number};
 boardWorld(at:V,z?:number):WorldPoint;
 mmPerPx(at:V):number;
 /** Width over height of the camera picture the landmarks came from. */
 handAspect():number;
}
export interface DrivetrainSceneExtra {train:DrivetrainBehaviour}
export type DrivetrainScene=MirrorScene<DrivetrainSkin>&DrivetrainSceneExtra;
export interface DrivetrainOutput extends MirrorEngineOutput<DrivetrainScene,DrivetrainSound> {rpm:number}
