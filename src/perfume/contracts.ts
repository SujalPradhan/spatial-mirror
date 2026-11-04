import type {MirrorEngineOutput,MirrorScene,MirrorSound,MirrorWorld} from '../mirror/contracts';
import type {Silhouette} from './flacon';
import type {PumpState,Spray} from './model';

/** 🤟 morphs between the three flacons instead of changing material. */
export type PerfumeSkin=Silhouette;
export type PerfumeSound=MirrorSound|{type:'click'|'clunk'|'rewind'}|{type:'spray';kind:Spray};
export interface PerfumeSceneExtra {
 pump:PumpState;
 /** partCount values: 0 in place to 1 resting in its slot beside the object. */
 parked:Float32Array;
 /** partCount*3 world offsets a part left from when it was let go. */
 parkFrom:Float32Array;
 /** One line under the object; empty hides it. */
 caption:string;
 /** Bullet time while ✌️ slices: 1 is real time, near 0 is frozen. */
 time:number;
 /** Seconds into a 👎 rewind, or -1. */
 rewind:number;
}
export type PerfumeScene=MirrorScene<PerfumeSkin>&PerfumeSceneExtra;
export interface PerfumeWorld extends MirrorWorld {
 partInfo(index:number):{id:string;title:string;role:string;removable:boolean};
 /** Droplets and wisps still in the air: a rewind holds the actuator down until they are home. */
 inFlight?():number;
}
export interface PerfumeOutput extends MirrorEngineOutput<PerfumeScene,PerfumeSound> {doses:number}
