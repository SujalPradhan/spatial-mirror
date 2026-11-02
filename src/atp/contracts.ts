import type {MirrorEngineOutput,MirrorInputSource,MirrorInputTarget,MirrorState,MirrorTool,MirrorField,MirrorHandView,MirrorLabel,MirrorScene,MirrorShock,MirrorSound,MirrorViewPatch,MirrorViewState,MirrorWorld,WorldPoint} from '../mirror/contracts';
export type * from '../mirror/contracts';
export type AtpComponent='rotor'|'stator'|'head';
export type AtpTool=MirrorTool;
export type AtpViewState=MirrorViewState;
/** Only the pose and rotor phase persist. Everything playful is transient by design. */
export interface AtpState extends MirrorState {schema:2}
export interface AtpStructureChain {id:string;name:string;component:AtpComponent;points:number[]}
export interface AtpStructureAsset {schema:'atp-structure-v1';pdb:'6OQR';units:'angstrom';source:string;sha256:string;representation:string;chains:AtpStructureChain[];anchors:Record<AtpComponent|'membrane',[number,number,number]>}
export type AtpInputSource=MirrorInputSource;
export type AtpInputTarget=MirrorInputTarget<AtpState>;

// ---- Scene: engine.ts owns the simulation; view.ts only draws this snapshot. ----
export type AtpSkin='constellation'|'ribbon'|'solid';
export const atpSkins:AtpSkin[]=['constellation','ribbon','solid'];
/** World space is the three.js scene: the molecule sits near the origin, about 5.8 units tall. */
export type AtpField=MirrorField;
export type AtpShock=MirrorShock;
export interface AtpSpark {x:number;y:number;z:number;life:number;kind:'proton'|'atp'}
export type AtpHandView=MirrorHandView;
export type AtpLabel=MirrorLabel;
export interface AtpSceneExtra {
 /** Unbounded radians about the structure's +Y ring axis. */
 rotorAngle:number;rotorSpeed:number;sparks:AtpSpark[];
 /** The pre-rename names of partOffsets and partGlow, read only by the engine tests. */
}
export type AtpScene=MirrorScene<AtpSkin>&AtpSceneExtra;
export type AtpViewPatch=MirrorViewPatch;
export interface AtpWorld extends MirrorWorld {
 partInfo(index:number):{id:string;name:string;component:AtpComponent;residues:number};
 /** Current head position in world space, where new ATP leaves the motor. */
 headPoint():WorldPoint;
}
/** The pre-rename world shape, still accepted by AtpEngine for the engine tests' fake world. */
export type AtpSound=MirrorSound|{type:'atp'|'pop'}|{type:'motor';speed:number};
export interface AtpEngineOutput extends MirrorEngineOutput<AtpScene,AtpSound> {atp:number}
