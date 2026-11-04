import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import {drivetrainSkins,type DrivetrainSaved} from './contracts';
import {drivetrainHow,drivetrainNote,sources} from './content';
import {DrivetrainEngine} from './engine';
import {DrivetrainView} from './view';
import {DrivetrainAudio} from './audio';
import {drivetrainDescriptor,initialDrivetrain,validateDrivetrain} from './state';

export const drivetrainObject:MirrorObject<DrivetrainSaved,DrivetrainView,DrivetrainEngine>&{liveView:DrivetrainView|null}={
 liveView:null,
 id:'drivetrain',documentKey:'drivetrain:pegboard:mirror',title:'Drivetrain — Spatial Studio',skins:drivetrainSkins,
 motion:{run:'Motor',reverse:'Back · undo'},
 gestures:{fist:'Turn crank',open:'Explode',pinch:'Pick, place',point:'Inspect, draw',victory:'Free gear',thumbUp:'Motor, find',love:'Schematic','both-pinch':'Pull apart','both-fist':'Stretch teeth',clap:'Overload, leg'},
 copy:{mark:['Drivetrain','pegboard'],stageLabel:'A pegboard of gears and linkages, built with your hands',viewportLabel:'3D pegboard. Drag a part from the tray onto the board, drag a placed part to move it or back to the tray to remove it, drag elsewhere to turn the view, scroll to zoom, space to turn the crank, D to draw a motion.',readoutUnit:'rpm out',loading:'Cutting the gears…',loadError:'Could not build the pegboard. ',cameraFallback:'Camera unavailable. Mouse still works: drag parts from the tray. '},
 about:{heading:'Snap gears into mesh, meet the brief, then draw a motion',note:drivetrainNote,privacy:`${drivetrainHow} Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.`,sources},
 createView(host){return this.liveView=new DrivetrainView(host);},
 createEngine:world=>new DrivetrainEngine(world),
 state:{initial:initialDrivetrain,validate:validateDrivetrain},
 createAudio:()=>new DrivetrainAudio(),
 descriptor:drivetrainDescriptor,
 readout:out=>{const t=out.scene.train,h=t.build.parts.find(p=>p.kind==='hand');return h?String(Math.abs(Math.round(t.sol.ratio(h.id)*t.inputRpm*10)/10)):'–';},
 idles:()=>false,
 recentered:engine=>engine.restore(),
};
