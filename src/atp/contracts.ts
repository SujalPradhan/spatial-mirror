import type {Quat} from '../types';
export type AtpComponent='rotor'|'stator'|'head';
export type AtpTool='view'|'rotor';
export interface AtpViewState {q:Quat;zoom:number;x:number;y:number}
/** Only the pose and rotor phase persist. Everything playful is transient by design. */
export interface AtpState {schema:2;tool:AtpTool;phase:number;view:AtpViewState;frozen:boolean}
export interface AtpStructureChain {id:string;name:string;component:AtpComponent;points:number[]}
export interface AtpStructureAsset {schema:'atp-structure-v1';pdb:'6OQR';units:'angstrom';source:string;sha256:string;representation:string;chains:AtpStructureChain[];anchors:Record<AtpComponent|'membrane',[number,number,number]>}
export type AtpInputSource='phone'|'hand'|'mouse';
export interface AtpInputTarget {state():AtpState;begin(source:AtpInputSource):boolean;view(q:Quat):void;phase(value:number):void;end(source:AtpInputSource):void}

// ---- Gestures: gestures.ts turns MediaPipe landmarks into these. ----
export type HandPose='none'|'open'|'fist'|'pinch'|'point'|'victory'|'thumbUp'|'thumbDown'|'love';
export type HandSide='left'|'right'|'unknown';
export interface MirrorPoint {x:number;y:number;z:number}
/** All points are in mirror space: x is 0 at the viewer's left, as they see themselves on screen. */
export interface TrackedHand {
 id:number;side:HandSide;pose:HandPose;
 landmarks:MirrorPoint[];palm:MirrorPoint;indexTip:MirrorPoint;pinch:MirrorPoint;
 /** Palm orientation from metric landmarks, for 1:1 wrist rotation; null when unavailable. */
 orientation:Quat|null;
 /** Palm velocity in mirror units per second. */
 velocity:{x:number;y:number};
 /** Frames since this pose was confirmed; 0 on the frame it became stable. */
 poseAge:number;
}
export type GestureEvent={type:'clap';x:number;y:number}|{type:'pose';handId:number;pose:HandPose}|{type:'lost';handId:number};
export interface GestureFrame {at:number;hands:TrackedHand[];events:GestureEvent[]}

// ---- Scene: engine.ts owns the simulation; view.ts only draws this snapshot. ----
export type AtpSkin='constellation'|'ribbon'|'solid';
export const atpSkins:AtpSkin[]=['constellation','ribbon','solid'];
export interface WorldPoint {x:number;y:number;z:number}
/** World space is the three.js scene: the molecule sits near the origin, about 5.8 units tall. */
export interface AtpField {x:number;y:number;z:number;radius:number;strength:number}
export interface AtpShock {x:number;y:number;z:number;age:number}
export interface AtpSpark {x:number;y:number;z:number;life:number;kind:'proton'|'atp'}
export interface AtpHandView {id:number;side:HandSide;pose:HandPose;joints:WorldPoint[];active:boolean}
export interface AtpLabel {title:string;detail:string;x:number;y:number;z:number}
export interface AtpScene {
 /** Unbounded radians about the structure's +Y ring axis. */
 rotorAngle:number;rotorSpeed:number;
 /** 0 assembled to 1 fully torn apart along each chain's outward direction. */
 explode:number;
 /** chainCount*3 world-space displacements added on top of explode, for plucks and shocks. */
 chainOffsets:Float32Array;
 /** chainCount values in 0..1: how brightly a chain glows. */
 chainGlow:Float32Array;
 fields:AtpField[];shocks:AtpShock[];
 /** Vertical plane through world x=`x` at z=0, yawed toward the viewer so the hollow head shows. amount 0 is off. */
 slice:{amount:number;x:number};
 skin:AtpSkin;sparks:AtpSpark[];hands:AtpHandView[];label:AtpLabel|null;
}
export interface AtpViewPatch {q?:Quat;x?:number;y?:number;zoom?:number}
/** What the simulation asks of the 3D view. Mirror points must land under the real hand on screen. */
export interface AtpWorld {
 chainCount:number;
 mirrorToWorld(point:MirrorPoint):WorldPoint;
 /** The chain under a world point, nearest along the camera ray, or -1. */
 chainAt(point:WorldPoint):number;
 chainInfo(index:number):{id:string;name:string;component:AtpComponent;residues:number};
 /** Current head position in world space, where new ATP leaves the motor. */
 headPoint():WorldPoint;
}
export type AtpSound={type:'pluck'|'snap'|'atp'|'pop'|'shock'|'skin'|'slice'|'tear'}|{type:'motor';speed:number};
export interface AtpEngineOutput {scene:AtpScene;view:AtpViewPatch|null;sounds:AtpSound[];atp:number;holding:boolean}
