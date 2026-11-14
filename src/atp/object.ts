import './style.css';
import type {MirrorAction,MirrorObject} from '../mirror/contracts';
import {atpSkins,type AtpState} from './contracts';
import {sources,scientificNote} from './content';
import {initialAtp,validateAtp} from './model';
import {AtpView} from './view';
import {AtpEngine} from './engine';
import {AtpAudio} from './audio';
import {atpWalkthrough} from './walkthrough';

const actions:MirrorAction<AtpEngine>[]=[
 {id:'stir',label:'Stir',hint:'Spin the rotor faster, like circling a finger around it',key:'s',gesture:'point',run:e=>e.stirBy(1)},
 {id:'slice',label:'Slice',hint:'Cut a plane through the molecule',key:'c',gesture:'victory',run:e=>e.toggleSlice(),pressed:e=>e.slicing},
 {id:'part',label:'Part',hint:'Push the chains apart from the centre',key:'o',gesture:'open',run:e=>e.toggleParting(),pressed:e=>e.parting},
 {id:'skin',label:'Skin',hint:'Change how the chains are drawn',key:'k',gesture:'love',run:e=>e.cycleSkin()},
 {id:'tear',label:'Tear apart',hint:'Pull the molecule into its chains, or put it back together',key:'t',gesture:'both-pinch',run:e=>e.toggleTear(),pressed:e=>e.tornApart},
 {id:'shock',label:'Shock',hint:'Send a shock wave through every chain',key:'b',gesture:'clap',run:e=>e.shock()},
 {id:'pluck',label:'Pluck',hint:'Pluck the next chain and let it spring back',key:'g',gesture:'pinch',run:e=>e.pluckNext()},
];
export const atpObject:MirrorObject<AtpState,AtpView,AtpEngine>={
 id:'atp',documentKey:'atp:6oqr:mirror',title:'ATP Synthase — Spatial Studio',skins:atpSkins,
 motion:{run:'Make',reverse:'Burn'},
 use:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-pinch','both-fist','clap'],
 walkthrough:atpWalkthrough,
 copy:{mark:['ATP','synthase'],stageLabel:'ATP synthase, held in your hands',viewportLabel:'3D ATP synthase. Drag a chain to pluck it, drag elsewhere to turn, scroll to zoom. Arrow keys turn it, plus and minus zoom, space spins, question mark lists every key.',readoutUnit:'ATP',loading:'Loading the molecule…',loadError:'Could not load the molecule. ',cameraFallback:'Camera unavailable. Mouse still works: drag a chain to pluck it. '},
 about:{heading:'A real molecule, in your hands',note:scientificNote,privacy:'Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.',sources},
 createView:host=>new AtpView(host),
 createEngine:world=>new AtpEngine(world),
 state:{initial:initialAtp,validate:validateAtp},
 createAudio:()=>new AtpAudio(),
 // The relay validates a shared descriptor shape, so retired lesson fields stay as constants.
 descriptor:(state,position)=>({chapter:0,guided:false,tool:state.tool,representation:'structure',phase:state.tool==='rotor'?Math.round(position):Math.round(position/30)*30%360,selected:null,zoom:state.view.zoom}),
 actions,
 readout:out=>out.atp,
 summary:(engine,state)=>{const scene=engine.liveScene,parts=[`ATP synthase, rotor ${Math.abs(engine.speed)>.05?'spinning':'still'}`,`${engine.atp} ATP made`,`skin: ${scene.skin}`];if(scene.explode>.5)parts.push('torn apart');if(scene.slice.amount>.5)parts.push('sliced');if(state.frozen)parts.push('frozen');return parts.join(', ');},
 // Motion is what this object is about, so it runs unless the phone's rotor tool is setting the angle by hand.
 idles:state=>state.tool!=='rotor',
};
