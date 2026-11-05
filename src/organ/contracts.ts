import type {HandPose,MirrorEngineOutput,MirrorPoint,MirrorWorld} from '../mirror/contracts';
import type {Match} from './accord';
import type {OrganDoc} from './doc';
import type {Px,Slot} from './layout';
import type {GestureId,StoryView} from './story';

export type {Px};
export type OrganSound={type:'pick'|'drop'|'return'|'puff'|'undo'|'skin'|'chord'|'miss'|'tick'|'swap'|'page'};
/** What the engine needs of the view: stage pixels, the space the viewer sees. */
export interface OrganWorld extends MirrorWorld {stage(p:MirrorPoint):Px;readonly size:{w:number;h:number}}
export interface Ack {id:number;x:number;y:number;text:string;miss:boolean;age:number}
export interface Hold {x:number;y:number;glyph:string;label:string;progress:number}
export interface Reticle {x:number;y:number;
 /** 0 fingers just near to 1 about to close. */
 close:number;
 /** The vial id or 'offer' a pinch here would take. */
 target:string|null}
export interface Held {
 /** -1 is the mouse. */
 hand:number;id:string;x:number;y:number;
 /** Wrist tilt from the pose at pick-up, radians, smoothed. */
 tilt:number;
 /** Drops a second it would pour, and whether it is over the palm. */
 rate:number;inZone:boolean;
 /** Drops this pick-up has poured. */
 poured:number;
 /** Let go, inside the grace window. */
 loose:boolean}
export interface Puff {id:number;words:string[];x:number;y:number;age:number;miss:boolean}
export interface OrganHand {id:number;pose:HandPose;points:Px[]}
export interface Pair {a:string;b:string;share:number;target:number|null;x:number;y:number}
export interface OrganScene {
 doc:OrganDoc;story:StoryView;
 /** Hours after 9:00. */
 clock:number;scrubbing:boolean;
 slots:Slot[];palm:Px;offer:{x:number;y:number;w:number;h:number}|null;offerHot:boolean;
 held:Held[];reticles:Reticle[];holds:Hold[];acks:Ack[];puffs:Puff[];
 hover:{id:string;x:number;y:number}|null;
 match:Match|null;pair:Pair|null;
 /** Ribbon drawing in after the first waft, 0..1; and the waft preview at a hand, 0..1. */
 draw:number;waftPreview:{x:number;y:number;k:number}|null;
 /** Warm skin, eased 0..1. */
 warm:number;
 /** Gestures lit right now. */
 lit:GestureId[];
 hands:OrganHand[];undoable:number;
}
export interface OrganOutput extends MirrorEngineOutput<OrganScene,OrganSound> {drops:number}
export type {MirrorPoint};
