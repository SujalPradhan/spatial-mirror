import type {HandPose,MirrorEngineOutput,MirrorPoint,MirrorWorld} from '../mirror/contracts';
import type {OrganDoc} from './doc';

export type OrganSound={type:'pick'|'drop'|'return'|'spray'|'undo'|'skin'|'fan'|'shock'|'slice'|'bottle'|'miss'|'tick'|'split'};
export interface Px {x:number;y:number}
/** What the engine needs of the view. Hit tests run in stage pixels, the space the viewer sees. */
export interface OrganWorld extends MirrorWorld {
 stage(p:MirrorPoint):Px;
 /** Screen centre of a vial and whether it is on the organ now. */
 vial(i:number):Px&{on:boolean};
 flask():Px;palm():Px;
}
export interface Ack {id:number;x:number;y:number;text:string;miss:boolean;age:number}
export interface Hold {x:number;y:number;glyph:string;label:string;progress:number}
export interface Reticle {x:number;y:number;
 /** 0 fingers just near to 1 about to close. */
 close:number;vial:number}
export interface Grab {vial:number;x:number;y:number;drops:number;
 /** Let go but inside the grace window: a re-pinch nearby picks it up again. */
 loose:boolean;
 /** Where it came from and where it pours, stage pixels. */
 from:Px;to:Px}
export interface OrganHand {id:number;pose:HandPose;points:Px[]}
export interface OrganScene {
 doc:OrganDoc;
 /** Radians the organ has been turned, and how far fanned by family. */
 ring:number;fan:number;
 /** Hours into the dry-down, and whether it runs by itself. */
 clock:number;playing:boolean;
 /** Counts up once per 👍 spray, so the view can send the mist. */
 sprays:number;
 hover:{vial:number;x:number;y:number}|null;
 reticles:Reticle[];grab:Grab|null;holds:Hold[];acks:Ack[];
 /** ✌️ cut through the dry-down cloud, eased 0..1. */
 slice:number;
 /** 🤏🤏 pulling the flask into top, heart and base, eased 0..1. */
 split:number;
 /** Live concentration while ✊✊ holds it, otherwise null. */
 conc:number|null;
 shock:{x:number;y:number;age:number}|null;
 hands:OrganHand[];
 /** Undo depth, for the formula card. */
 undoable:number;
}
export interface OrganOutput extends MirrorEngineOutput<OrganScene,OrganSound> {drops:number}
