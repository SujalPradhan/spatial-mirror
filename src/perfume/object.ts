import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import {PerfumeAudio} from './audio';
import {honestNote,sources} from './content';
import {PerfumeEngine} from './engine';
import {silhouettes} from './flacon';
import {initialPerfume,perfumeDescriptor,validatePerfume,type PerfumeState} from './state';
import {PerfumeView} from './view';

export const perfumeObject:MirrorObject<PerfumeState,PerfumeView,PerfumeEngine>&{liveView:PerfumeView|null}={
 liveView:null,
 id:'perfume',documentKey:'perfume:spray:mirror',title:'Perfume Spray — Spatial Studio',skins:silhouettes,
 motion:{run:'Press',reverse:'Release'},
 gestures:{pinch:'Pull out',point:'Name','both-fist':'Scale, Dive'},
 copy:{mark:['Perfume','spray'],stageLabel:'A perfume spray, held in your hands',viewportLabel:'3D perfume spray in a crystal flacon. Drag a part out to remove it, drag the actuator down to press, drag elsewhere to turn, scroll to zoom, space to press, shift and space to rewind.',readoutUnit:'sprays',loading:'Cutting the crystal…',loadError:'Could not build the spray. ',cameraFallback:'Camera unavailable. Mouse still works: drag a part out, or drag the actuator down. '},
 about:{heading:'Take a part out, see why it was there, then smell it',note:honestNote,privacy:'Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.',sources},
 createView(host){return this.liveView=new PerfumeView(host);},
 createEngine:world=>new PerfumeEngine(world),
 state:{initial:initialPerfume,validate:validatePerfume},
 createAudio:()=>new PerfumeAudio(),
 descriptor:perfumeDescriptor,
 readout:out=>out.doses,
 // Nothing moves by itself: idle only says the phone's pump tool is not in hand.
 idles:state=>state.tool!=='rotor',
 recentered:engine=>engine.restore(),
};
