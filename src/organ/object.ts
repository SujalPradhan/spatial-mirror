import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import {OrganAudio} from './audio';
import {honestNote,sources} from './content';
import {OrganEngine} from './engine';
import {skins} from './model';
import {initialOrgan,organDescriptor,validateOrgan,type OrganState} from './state';
import {OrganView} from './view';

export const organObject:MirrorObject<OrganState,OrganView,OrganEngine>&{liveView:OrganView|null}={
 liveView:null,
 id:'organ',documentKey:'organ:mirror',title:'The Organ — Spatial Studio',skins,
 motion:{run:'Spray',reverse:'Undo'},
 gestures:{fist:'Spin, Scrub',open:'Fan',pinch:'Dose',point:'Read',victory:'Slice',love:'Skin','both-pinch':'Split, Bottle','both-fist':'Strength',clap:'Comply'},
 copy:{mark:['The Organ','perfumer’s hands'],stageLabel:'A perfumer’s organ of vials and a crystal flask, composed with your hands',viewportLabel:'A tiered organ of perfume materials around a crystal flask. Drag a vial to the flask to dose it, hover to read it, drag elsewhere to turn the view, scroll to zoom, space to spray, shift and space to undo.',readoutUnit:'drops',loading:'Filling the vials…',loadError:'Could not build the organ. ',cameraFallback:'Camera unavailable. Mouse still works: drag a vial to the flask. '},
 about:{heading:'Compose with your hands, then watch it leave the skin',note:honestNote,privacy:'Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.',sources},
 createView(host){return this.liveView=new OrganView(host);},
 createEngine:world=>new OrganEngine(world),
 state:{initial:initialOrgan,validate:validateOrgan},
 createAudio:()=>new OrganAudio(),
 descriptor:organDescriptor,
 readout:out=>out.drops,
 // Nothing moves by itself.
 idles:()=>false,
 recentered:engine=>{engine.scene.ring=0;},
};
