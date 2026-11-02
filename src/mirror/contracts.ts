import type {Quat} from '../types';

export interface MirrorViewState {q:Quat;zoom:number;x:number;y:number}
export interface MirrorViewPatch {q?:Quat;x?:number;y?:number;zoom?:number}
export type MirrorTool='view'|'rotor';
/** The persisted shape the shell relies on; an object may add fields. */
export interface MirrorState {tool:MirrorTool;phase:number;view:MirrorViewState;frozen:boolean}
export type MirrorInputSource='phone'|'hand'|'mouse';
export interface MirrorInputTarget<State extends MirrorState=MirrorState> {state():State;begin(source:MirrorInputSource):boolean;view(q:Quat):void;phase(value:number):void;end(source:MirrorInputSource):void}
export const MIRROR_ZOOM_MIN=.65,MIRROR_ZOOM_MAX=2.5;
export const clampPhase=(value:number):number=>Number.isFinite(value)?Math.max(0,Math.min(360,value)):0;

// ---- Gestures: gestures.ts turns tracker landmarks into these. ----
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

// ---- Scene: engine.ts owns the simulation; the view only draws this snapshot. ----
/** World space is the three.js scene: the object sits near the origin. */
export interface WorldPoint {x:number;y:number;z:number}
export interface MirrorField {x:number;y:number;z:number;radius:number;strength:number}
export interface MirrorShock {x:number;y:number;z:number;age:number}
export interface MirrorHandView {id:number;side:HandSide;pose:HandPose;joints:WorldPoint[];active:boolean}
export interface MirrorLabel {title:string;detail:string;x:number;y:number;z:number}
export type MirrorSound={type:'pluck'|'snap'|'shock'|'skin'|'slice'|'tear'};
export interface MirrorScene<Skin extends string=string> {
 /** 0 assembled to 1 fully torn apart along each part's outward direction. */
 explode:number;
 /** partCount*3 world-space displacements added on top of explode, for plucks and shocks. */
 partOffsets:Float32Array;
 /** partCount values in 0..1: how brightly a part glows. */
 partGlow:Float32Array;
 fields:MirrorField[];shocks:MirrorShock[];
 /** Vertical plane through world x=`x` at z=0, yawed toward the viewer. amount 0 is off. */
 slice:{amount:number;x:number};
 skin:Skin;hands:MirrorHandView[];label:MirrorLabel|null;
}
/** What the simulation asks of the 3D view. Mirror points must land under the real hand on screen. */
export interface MirrorWorld {
 partCount:number;
 mirrorToWorld(point:MirrorPoint):WorldPoint;
 /** The part under a world point, nearest along the camera ray, or -1. */
 partAt(point:WorldPoint):number;
}
export interface MirrorEngineOutput<Scene,Sound> {scene:Scene;view:MirrorViewPatch|null;sounds:Sound[];holding:boolean}
/** What a behaviour may touch mid-step. */
export interface MirrorContext<Skin extends string=string,Extra=object,Sound=MirrorSound> {
 scene:MirrorScene<Skin>&Extra;view:MirrorViewState;frozen:boolean;
 sound(sound:Sound|MirrorSound):void;
 /** Raises a part's glow to at least amount. */
 glow(part:number,amount:number):void;
 /** Whether any hand's palm or fingertip is within radius of a point on the screen plane. */
 touching(x:number,y:number,radius:number):boolean;
}
/** The object-specific half of a step, called in this order: drive and stir during gestures, advance, springs and easing, settle, shocks and hover, publish. */
export interface MirrorBehaviour<Skin extends string=string,Extra=object,Sound=MirrorSound> {
 initialScene():Extra;
 fit(partCount:number):void;
 describe(part:number):{title:string;detail:string};
 drive(direction:number):void;
 stir(speed:number,elapsed:number):void;
 advance(h:number,c:MirrorContext<Skin,Extra,Sound>):void;
 settle(h:number,c:MirrorContext<Skin,Extra,Sound>):void;
 publish(c:MirrorContext<Skin,Extra,Sound>):void;
 reset(scene:MirrorScene<Skin>&Extra):void;
 /** A pluck starts on this part, before its offset is read. */
 grabbed?(part:number,c:MirrorContext<Skin,Extra,Sound>):void;
 /** Each step of a pluck, with the hand's raw travel in world units. Return true to take the drag over, so the part stays put. */
 dragged?(part:number,dx:number,dy:number,dz:number,c:MirrorContext<Skin,Extra,Sound>):boolean;
 released?(part:number,c:MirrorContext<Skin,Extra,Sound>):void;
 /** The parts a released pluck jolts. Without it, the two next to it in part order. */
 neighbours?(part:number):number[];
}
/** What the shell drives. position is degrees through the object's motion, speed its turns per second. */
export interface MirrorDriver<Out extends MirrorEngineOutput<any,any>=MirrorEngineOutput<any,any>> {
 idle:boolean;readonly position:number;readonly speed:number;
 seek(degrees:number):void;kick(direction:1|-1):void;
 pointerDown(point:WorldPoint):boolean;pointerMove(point:WorldPoint):void;pointerUp():void;hover(point:WorldPoint|null):void;reset():void;
 step(frame:GestureFrame,dt:number,view:MirrorViewState,frozen:boolean):Out;
}

// ---- Object: everything runMirror needs to stage one thing in the mirror. ----
export interface MirrorView<Scene=any> extends MirrorWorld {
 ready:Promise<void>;
 setPose(view:MirrorViewState):void;setVideoAspect(aspect:number):void;pointToWorld(clientX:number,clientY:number):WorldPoint;
 draw(scene:Scene,now:number):void;dispose():void;
}
export interface MirrorAudio<Sound=any> {start():Promise<void>;setMuted(muted:boolean):void;play(sound:Sound):void;stop():void}
export interface MirrorCopy {
 /** The heading's strong and quiet words. */
 mark:[string,string];
 stageLabel:string;viewportLabel:string;
 /** Unit after the readout; leave out with readout for an object that counts nothing. */
 readoutUnit?:string;
 loading:string;loadError:string;cameraFallback:string;
}
export interface MirrorAbout {heading:string;note:string;privacy:string;sources:{label:string;url:string}[]}
/** The relay drops a state without every required field, silently. title and motionLabel only reach the phone's copy. */
export interface MirrorDescriptor {chapter:number;guided:boolean;tool:MirrorTool;representation:string;phase:number;selected:null;zoom:number;title?:string;motionLabel?:string}
export interface MirrorObject<State extends MirrorState=MirrorState,View extends MirrorView=MirrorView,Engine extends MirrorDriver=MirrorDriver> {
 /** Prefix of every element id and of the page class. */
 id:string;documentKey:string;title:string;skins:readonly string[];
 /** Guide labels for thumbs up and down. */
 motion:{run:string;reverse:string};
 /** Guide labels by gesture id. */
 gestures?:Partial<Record<string,string>>;
 copy:MirrorCopy;about:MirrorAbout;
 createView(host:HTMLElement):View;createEngine(world:View):Engine;
 state:{initial():State;validate(value:unknown):State};
 createAudio():MirrorAudio<ReturnType<Engine['step']>['sounds'][number]>;
 /** The object's fields of the relay descriptor; position is degrees through its motion. */
 descriptor(state:State,position:number):MirrorDescriptor;
 readout?(out:ReturnType<Engine['step']>):number|string;
 /** Whether the motion runs by itself in this state. While it does, the saved phase is left alone. */
 idles?(state:State):boolean;
 /** Called when the viewer recenters, for an object with more to put back than the pose. */
 recentered?(engine:Engine):void;
}
