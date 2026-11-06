import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import type {GraspSaved} from './contracts';
import {graspHow,graspNote,sources} from './content';
import {GraspEngine} from './engine';
import {GraspView} from './view';
import {GraspAudio} from './audio';
import type {GraspId} from './objects';
import type {MotorCount} from './synergy';
import {graspDescriptor,initialGrasp,validateGrasp} from './state';

export const graspObject:MirrorObject<GraspSaved,GraspView,GraspEngine>&{liveView:GraspView|null}={
 liveView:null,
 id:'grasp',documentKey:'grasp:synergy:mirror',title:'How many motors does a hand need? — Spatial Studio',skins:['metal'],
 motion:{run:'Thumb alone',reverse:'Hold: reset object'},
 gestures:{fist:'Power grip',open:'Open hand',pinch:'Pinch',point:'Index alone',victory:'Two fingers',love:'Hold: motors','both-pinch':'Two pinches','both-fist':'Scale',clap:'Next object'},
 use:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-fist','clap'],
 copy:{mark:['How many motors','does a hand need?'],stageLabel:'Your hand drives a tendon robot hand with one to five motors',viewportLabel:'A robot hand beside a ghost of yours. Your tracked hand pose drives it; drag to turn the view, scroll to zoom, click a finger for its close-up, hover a joint for its torque.',readoutUnit:'grip score',loading:'Machining the hand…',loadError:'Could not build the hand. ',cameraFallback:'Camera unavailable. Mouse presets below still show the idea, poorly. '},
 about:{heading:'Synergies: why a few motors can grasp most things',note:graspNote,privacy:`${graspHow} Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.`,sources},
 createView(host){return this.liveView=new GraspView(host);},
 createEngine:()=>new GraspEngine(),
 state:{initial:initialGrasp,validate:validateGrasp},
 createAudio:()=>new GraspAudio(),
 descriptor:graspDescriptor,
 readout:out=>out.scene.verdict.score,
 idles:()=>false,
 handShape:true,
 watch:{
  local:true,
  capture:e=>({setup:{motors:e.motors,object:e.objectId,preset:e.preset,inspect:e.inspect},found:{taxonomy:e.taxonomy,best:Object.fromEntries(Object.entries(e.best).map(([k,v])=>[k,Math.round((v??0)*100)/100]))}}),
  apply(e,page){
   const s=page.setup as {motors:MotorCount;object:GraspId;preset:string|null;inspect:number}|undefined,f=page.found as {taxonomy:typeof e.taxonomy;best:typeof e.best}|undefined;
   if(s){if(s.object!==e.objectId)e.setObject(s.object);if(s.motors!==e.motors)e.setMotors(s.motors);if(s.preset!==e.preset)e.setPreset(s.preset);if(s.inspect!==e.inspect)e.setInspect(s.inspect);}
   if(f){e.taxonomy=structuredClone(f.taxonomy);e.best={...f.best};}
  },
 },
};
