import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import {atomSkins} from './contracts';
import {sources,scientificNote} from './content';
import {initialAtom,validateAtom,type AtomState} from './model';
import {AtomView} from './view';
import {AtomEngine} from './engine';
import {AtomAudio} from './audio';

export const atomObject:MirrorObject<AtomState,AtomView,AtomEngine>&{liveView:AtomView|null}={
 liveView:null,
 id:'atom',documentKey:'atom:bohr:mirror',title:'Atom — Spatial Studio',skins:atomSkins,
 motion:{run:'Faster',reverse:'Reverse'},
 gestures:{open:'Take electron','both-pinch':'Tear apart',fist:'Hold','both-fist':'Scale',clap:'Next element'},
 use:['open','both-pinch','fist','thumbUp','thumbDown','both-fist','clap'],
 copy:{mark:['Carbon','atom'],stageLabel:'An atom, held in your hands',viewportLabel:'3D Bohr model of an atom. Drag to turn, scroll to zoom, space to speed up the electrons, N for the next element.',readoutUnit:'electrons',loading:'Loading the atom…',loadError:'Could not load the atom. ',cameraFallback:'Camera unavailable. Mouse still works: drag to turn, press N for the next element. '},
 about:{heading:'A simple model of the atom',note:scientificNote,privacy:'Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.',sources},
 createView(host){return this.liveView=new AtomView(host);},
 createEngine:world=>new AtomEngine(world),
 state:{initial:initialAtom,validate:validateAtom},
 createAudio:()=>new AtomAudio(),
 descriptor:(state)=>({chapter:0,guided:false,tool:state.tool,representation:'structure',phase:0,selected:null,zoom:state.view.zoom}),
 readout:out=>out.electrons,
 // The orbits run by themselves, so the phone's rotor tool has nothing to set.
 idles:()=>true,
 watch:{
  local:true,
  capture:engine=>({element:engine.element}),
  apply(engine,page){const target=page.element;if(typeof target==='number'&&target!==engine.element)engine.next(target-engine.element);},
 },
};
