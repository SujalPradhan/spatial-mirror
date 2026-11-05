import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import {OrganAudio} from './audio';
import {honestNote,sources} from './content';
import {OrganEngine} from './engine';
import {initialOrgan,organDescriptor,validateOrgan,type OrganState} from './state';
import {OrganView} from './view';

export const organObject:MirrorObject<OrganState,OrganView,OrganEngine>&{liveView:OrganView|null}={
 liveView:null,
 id:'organ',documentKey:'organ:mirror',title:'The Accord — Spatial Studio',skins:['normal','warm'],
 motion:{run:'Smell',reverse:'Undo'},
 gestures:{pinch:'Pick up',fist:'Day',thumbDown:'Undo'},
 copy:{mark:['The Accord','why perfume changes through the day'],stageLabel:'Build a perfume accord with your hands and watch how it wears from 9:00 to 18:00',viewportLabel:'Vials above your palm and a ribbon of the day. Click a vial to pick it up, scroll to tilt and pour, click again to set it down, press Smell, and drag along the ribbon to move through the day. Space smells, shift and space undoes.',readoutUnit:'drops',loading:'Filling the vials…',loadError:'Could not build the organ. ',cameraFallback:'Camera unavailable. The mouse still works: click a vial, scroll to pour. '},
 about:{heading:'Why a perfume smells different at 5 pm than at 9 am',note:honestNote,privacy:'Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.',sources},
 createView(host){return this.liveView=new OrganView(host);},
 createEngine:world=>new OrganEngine(world),
 state:{initial:initialOrgan,validate:validateOrgan},
 createAudio:()=>new OrganAudio(),
 descriptor:organDescriptor,
 readout:out=>out.drops,
 // Nothing moves by itself.
 idles:()=>false,
};
