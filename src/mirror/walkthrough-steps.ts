import type {MirrorGestureId,MirrorScene,MirrorState,MirrorViewState} from './contracts';

/** What a step's check may look at: the object's engine, the shell's saved state and the scene the engine last produced. */
export interface MirrorProbe<Engine=any> {engine:Engine;state:MirrorState;scene:MirrorScene&Record<string,any>}
/** One gesture's walkthrough entry. Holding the pose is the first phase; with check the step then waits for the effect. snapshot is read when that second phase starts and handed back to check as before. */
export interface MirrorWalkthroughStep<Engine=any> {
 gesture:MirrorGestureId;
 /** Plain one-line instruction for the effect, also the cheat sheet description. */
 howTo:string;
 /** Shown when the viewer has been stuck for a while. */
 tip?:string;
 snapshot?(probe:MirrorProbe<Engine>):unknown;
 check?(probe:MirrorProbe<Engine>,before:any):boolean;
}

/** Plain words for every gesture, used where an object gives none of its own. */
export const gestureHelp:Record<MirrorGestureId,{pose:string;what:string}>={
 fist:{pose:'Make a fist.',what:'Close your hand over the object, then move it to turn the object with you.'},
 open:{pose:'Open your palm with the fingers spread.',what:'Hold a flat hand near the object to push or lift it.'},
 pinch:{pose:'Touch your thumb and index fingertips together.',what:'Pinch a part to pick it up, then move your hand to pull it out.'},
 point:{pose:'Point with just your index finger.',what:'Circle a fingertip around the object.'},
 victory:{pose:'Raise your index and middle fingers.',what:'Hold up two fingers to cut through the object.'},
 thumbUp:{pose:'Give a thumbs up.',what:'Thumbs up to start or speed up the motion.'},
 thumbDown:{pose:'Give a thumbs down.',what:'Thumbs down to run the motion backwards.'},
 love:{pose:'Raise your thumb, index and little finger and curl the middle two.',what:'Make the 🤟 sign to change how the object is drawn.'},
 'both-pinch':{pose:'Pinch with both hands.',what:'Pinch with both hands, then pull them apart.'},
 'both-fist':{pose:'Make a fist with both hands.',what:'Make fists with both hands, then move them apart or together.'},
 clap:{pose:'Start with your hands apart, then clap them together fast.',what:'Clap your hands together.'},
};
export const twoHanded:readonly MirrorGestureId[]=['both-pinch','both-fist','clap'];

export const quatAngle=(a:readonly number[],b:readonly number[])=>2*Math.acos(Math.min(1,Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3])));
export const viewSnapshot=(p:MirrorProbe):MirrorViewState=>structuredClone(p.state.view);
/** Turned by at least about 17 degrees or carried a clear way across the screen. */
export const viewMoved=(p:MirrorProbe,before:MirrorViewState)=>quatAngle(p.state.view.q,before.q)>.3||Math.hypot(p.state.view.x-before.x,p.state.view.y-before.y)>.6;
/** Zoomed in or out by about a fifth. */
export const viewZoomed=(p:MirrorProbe,before:MirrorViewState)=>Math.abs(Math.log(p.state.view.zoom/before.zoom))>=.18;
export const torn=(p:MirrorProbe)=>p.scene.explode>=.4;
export const mostPulled=(p:MirrorProbe)=>{let most=0;const o=p.scene.partOffsets;for(let i=0;i<o.length;i+=3)most=Math.max(most,Math.hypot(o[i],o[i+1],o[i+2]));return most;};
