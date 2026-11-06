import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import {atpSkins,type AtpState} from './contracts';
import {sources,scientificNote} from './content';
import {initialAtp,validateAtp} from './model';
import {AtpView} from './view';
import {AtpEngine} from './engine';
import {AtpAudio} from './audio';

export const atpObject:MirrorObject<AtpState,AtpView,AtpEngine>={
 id:'atp',documentKey:'atp:6oqr:mirror',title:'ATP Synthase — Spatial Studio',skins:atpSkins,
 motion:{run:'Make',reverse:'Burn'},
 use:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-pinch','both-fist','clap'],
 copy:{mark:['ATP','synthase'],stageLabel:'ATP synthase, held in your hands',viewportLabel:'3D ATP synthase. Drag a chain to pluck it, drag elsewhere to turn, scroll to zoom, space to spin.',readoutUnit:'ATP',loading:'Loading the molecule…',loadError:'Could not load the molecule. ',cameraFallback:'Camera unavailable. Mouse still works: drag a chain to pluck it. '},
 about:{heading:'A real molecule, in your hands',note:scientificNote,privacy:'Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.',sources},
 createView:host=>new AtpView(host),
 createEngine:world=>new AtpEngine(world),
 state:{initial:initialAtp,validate:validateAtp},
 createAudio:()=>new AtpAudio(),
 // The relay validates a shared descriptor shape, so retired lesson fields stay as constants.
 descriptor:(state,position)=>({chapter:0,guided:false,tool:state.tool,representation:'structure',phase:state.tool==='rotor'?Math.round(position):Math.round(position/30)*30%360,selected:null,zoom:state.view.zoom}),
 readout:out=>out.atp,
 // Motion is what this object is about, so it runs unless the phone's rotor tool is setting the angle by hand.
 idles:state=>state.tool!=='rotor',
};
