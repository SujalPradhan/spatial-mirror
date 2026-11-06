import type {GraspScene} from '../grasp/contracts';
import type {MirrorEngineOutput,MirrorViewPatch,HandSide} from '../mirror/contracts';
import type {Wrist} from './model';

export type FollowMode='demo'|'follow'|'countdown'|'record'|'done';
export interface StepResult {score:number;seconds:number;skipped:boolean}
export type FollowSound={type:'step'|'done'|'tick'|'go'|'miss'};
export interface FollowInfo {
 mode:FollowMode;lessons:{id:string;title:string;blurb:string}[];lessonId:string;
 steps:string[];index:number;name:string;
 /** The finger the thumb tip meets at this step, 1 index to 4 little. */
 touch:number|null;
 /** The teacher has reached the step and waits. */
 waiting:boolean;
 /** The teacher has finished moving to the step, in demo too. */
 arrived:boolean;
 /** 0..1 of the hold. */
 hold:number;matched:boolean;hint:string|null;
 /** Per joint, 0 on target, 1 at the edge of the tolerance. */
 ratio:number[];wristRatio:{tilt:number;roll:number}|null;
 results:StepResult[];matchedSteps:number;
 hand:boolean;side:HandSide;mirrored:boolean;
 teacherWrist:Wrist;youWrist:Wrist;
 countdown:number|null;recordSeconds:number|null;canUndo:boolean;hasMine:boolean;
 note:string|null;
}
export interface FollowScene extends GraspScene {follow:FollowInfo}
export interface FollowOutput extends MirrorEngineOutput<FollowScene,FollowSound> {view:MirrorViewPatch|null}
