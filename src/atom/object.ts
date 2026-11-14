import './style.css';
import type {MirrorAction,MirrorObject} from '../mirror/contracts';
import {atomSkins} from './contracts';
import {sources,scientificNote} from './content';
import {initialAtom,validateAtom,type AtomState} from './model';
import {AtomView} from './view';
import {AtomEngine} from './engine';
import {AtomAudio} from './audio';
import {atomWalkthrough} from './walkthrough';

const actions:MirrorAction<AtomEngine>[]=[
 {id:'take',label:'Take electron',hint:'Lift the outermost electron out of its shell, or send it home',key:'e',gesture:'open',run:e=>e.toggleTake(),pressed:e=>e.taking},
 {id:'next',label:'Next element',hint:'Swap to the next element in the table',key:'n',gesture:'clap',run:e=>e.next(1)},
 {id:'previous',label:'Previous element',hint:'Swap to the previous element in the table',key:'shift+n',run:e=>e.next(-1)},
 {id:'tear',label:'Tear apart',hint:'Pull the atom into nucleus, shells and electrons, or put it back together',key:'t',gesture:'both-pinch',run:e=>e.toggleTear(),pressed:e=>e.tornApart},
];
export const atomObject:MirrorObject<AtomState,AtomView,AtomEngine>&{liveView:AtomView|null}={
 liveView:null,
 id:'atom',documentKey:'atom:bohr:mirror',title:'Atom — Spatial Studio',skins:atomSkins,
 motion:{run:'Faster',reverse:'Reverse'},
 gestures:{open:'Take electron','both-pinch':'Tear apart',fist:'Hold','both-fist':'Scale',clap:'Next element'},
 use:['open','both-pinch','fist','thumbUp','thumbDown','both-fist','clap'],
 walkthrough:atomWalkthrough,
 copy:{mark:['Carbon','atom'],stageLabel:'An atom, held in your hands',viewportLabel:'3D Bohr model of an atom. Drag to turn, scroll to zoom. Arrow keys turn it, plus and minus zoom, space speeds up the electrons, N is the next element, question mark lists every key.',readoutUnit:'electrons',loading:'Loading the atom…',loadError:'Could not load the atom. ',cameraFallback:'Camera unavailable. Mouse still works: drag to turn, press N for the next element. '},
 about:{heading:'A simple model of the atom',note:scientificNote,privacy:'Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.',sources},
 createView(host){return this.liveView=new AtomView(host);},
 createEngine:world=>new AtomEngine(world),
 state:{initial:initialAtom,validate:validateAtom},
 createAudio:()=>new AtomAudio(),
 descriptor:(state)=>({chapter:0,guided:false,tool:state.tool,representation:'structure',phase:0,selected:null,zoom:state.view.zoom,title:'Atom',motionLabel:'electrons',labels:{tool:false,play:'Speed up',stop:'Stop'}}),
 actions,
 readout:out=>out.electrons,
 summary:(engine,state)=>{const scene=engine.atomScene,parts=[scene.caption,`electrons ${Math.abs(scene.rate)>.2?'orbiting':'still'}`];if(scene.explode>.5)parts.push('torn apart');if(state.frozen)parts.push('frozen');return parts.join(', ');},
 // The orbits run by themselves, so the phone's rotor tool has nothing to set.
 idles:()=>true,
 watch:{
  local:true,
  capture:engine=>({element:engine.element}),
  apply(engine,page){const target=page.element;if(typeof target==='number'&&target!==engine.element)engine.next(target-engine.element);},
 },
};
