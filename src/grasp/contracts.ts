import type {MirrorEngineOutput,MirrorState,MirrorViewPatch} from '../mirror/contracts';
import type {GraspId,GraspKind} from './objects';
import type {Verdict} from './score';
import type {Coupling,MotorCount} from './synergy';
import type {SimResult} from './tendon';

/** Only the view persists. Every visit starts where the story does: one motor, the mug. */
export interface GraspSaved extends MirrorState {schema:1}
export type GraspSound={type:'touch'|'held'|'drop'|'motors'|'object'|'calibrated'|'step'|'found'}|{type:'motor';speed:number;load:number};
export type CalibrationPhase='flat'|'fist'|'done'|null;
export interface GraspCalibrationView {phase:CalibrationPhase;progress:number;
 /** Seconds since calibration finished, for the thank-you. */
 doneFor:number}
export interface TaxonomyEntry {motors:MotorCount;object:GraspId;at:number}
/** One snapshot per step; the view only draws it. */
export interface GraspScene {
 coupling:Coupling;object:GraspId;
 /** Your pose, normalised 0 flat to 1 fist, the 15 joints. */
 user:number[];spread:[number,number,number,number];
 /** Where the motors are, 0..1 each, eased toward the projection. */
 command:number[];
 /** What the motors can make of your pose, in free air, and per joint what is left over. */
 free:number[];residual:number[];
 sim:SimResult;verdict:Verdict;
 /** 0 resting on the stand to 1 lifted clear. */
 lift:number;
 /** Where the pose comes from right now. */
 source:'hand'|'phone'|'preset'|'rest';preset:string|null;
 thumbUncertain:boolean;calibration:GraspCalibrationView;
 /** Share of your recent poses each motor count can follow, by count. */
 explained:Record<MotorCount,number>;samples:number;
 taxonomy:Partial<Record<GraspKind,TaxonomyEntry>>;best:Partial<Record<GraspId,number>>;
 /** Finger being inspected in the zoom, 0 thumb to 4 little. */
 inspect:number;
 /** A pose gesture being held toward firing, 0..1, and which. */
 charging:{gesture:'thumbDown'|'love';amount:number}|null;
 note:{text:string;age:number}|null;
}
export interface GraspOutput extends MirrorEngineOutput<GraspScene,GraspSound> {view:MirrorViewPatch|null}
