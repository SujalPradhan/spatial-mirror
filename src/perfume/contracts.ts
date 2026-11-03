import type {MirrorEngineOutput,MirrorScene,MirrorSound,MirrorWorld} from '../mirror/contracts';
import type {MeshSkin} from '../mirror/parts-view';
import type {PumpState,Spray} from './model';

export type PerfumeSound=MirrorSound|{type:'click'|'clunk'}|{type:'spray';kind:Spray};
export interface PerfumeSceneExtra {
 pump:PumpState;
 /** partCount values: 0 in place to 1 resting in its slot beside the object. */
 parked:Float32Array;
 /** partCount*3 world offsets a part left from when it was let go. */
 parkFrom:Float32Array;
 /** One line under the object; empty hides it. */
 caption:string;
}
export type PerfumeScene=MirrorScene<MeshSkin>&PerfumeSceneExtra;
export interface PerfumeWorld extends MirrorWorld {partInfo(index:number):{id:string;title:string;role:string;removable:boolean}}
export interface PerfumeOutput extends MirrorEngineOutput<PerfumeScene,PerfumeSound> {doses:number}
