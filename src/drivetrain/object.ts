import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import {drivetrainSkins,type DrivetrainSaved} from './contracts';
import {drivetrainHow,drivetrainNote,sources} from './content';
import {DrivetrainEngine} from './engine';
import {DrivetrainView} from './view';
import {DrivetrainAudio} from './audio';
import {cloneBuild} from './gears';
import {drivetrainDescriptor,initialDrivetrain,validateDrivetrain} from './state';

export const drivetrainObject:MirrorObject<DrivetrainSaved,DrivetrainView,DrivetrainEngine>&{liveView:DrivetrainView|null}={
 liveView:null,
 id:'drivetrain',documentKey:'drivetrain:pegboard:mirror',title:'Drivetrain — Spatial Studio',skins:drivetrainSkins,
 motion:{run:'Motor',reverse:'Back · undo'},
 gestures:{fist:'Turn crank',open:'Explode',pinch:'Pick, place',point:'Inspect, draw',victory:'Free gear',thumbUp:'Motor, find',love:'Schematic','both-pinch':'Pull apart','both-fist':'Stretch teeth',clap:'Overload, leg'},
 use:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-pinch','both-fist','clap'],
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
 watch:{
  capture:({train:t})=>({brief:{brief:t.brief,mode:t.mode,schematic:t.schematic,exploded:t.exploded},build:round(t.build),draw:{stroke:thin(t.stroke),closed:t.closed,found:t.matches.length>0,index:t.matchIndex}}),
  apply({train:t},page){
   const b=page.brief as {brief:number;mode:'build'|'draw';schematic:boolean;exploded:boolean}|undefined,build=page.build as typeof t.build|undefined,d=page.draw as {stroke:[number,number][];closed:boolean;found:boolean;index:number}|undefined;
   const live=t as unknown as {changed():void;synthesise():boolean};
   if(b){if(b.brief!==t.brief)t.setBrief(b.brief);if(b.mode!==t.mode)t.setMode(b.mode);t.schematic=b.schematic;t.exploded=b.exploded;}
   if(build&&JSON.stringify(build)!==JSON.stringify(round(t.build))){t.build=cloneBuild(build);live.changed();}
   if(d&&JSON.stringify(d.stroke)!==JSON.stringify(thin(t.stroke))){t.stroke=d.stroke;t.closed=d.closed;t.matches=[];}
   if(d&&d.found&&!t.matches.length&&t.closed)live.synthesise();
   if(d&&t.matches.length)t.matchIndex=Math.min(d.index,t.matches.length-1);
  },
 },
};
const round=<T,>(v:T):T=>JSON.parse(JSON.stringify(v),(_,x)=>typeof x==='number'?Math.round(x*1000)/1000:x);
const thin=(s:readonly (readonly number[])[]):[number,number][]=>{const step=Math.max(1,Math.ceil(s.length/250));return s.filter((_,i)=>i%step===0||i===s.length-1).map(p=>[Math.round(p[0]),Math.round(p[1])]);};
