import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import {machineSkins,type MachineSaved} from './contracts';
import {machineHow,machineNote,sources} from './content';
import {initialMachine,validateMachine} from './state';
import {MachineView} from './view';
import {MachineEngine} from './engine';
import {MachineAudio} from './audio';
import type {Removable} from './contracts';
import type {Stitch} from './model';

export const machineObject:MirrorObject<MachineSaved,MachineView,MachineEngine>={
 id:'machine',documentKey:'machine:lockstitch:mirror',title:'Sewing machine — Spatial Studio',skins:machineSkins,
 motion:{run:'Run',reverse:'Reverse'},
 gestures:{open:'Part',pinch:'Pull out',point:'Turn wheel',victory:'Slice',love:'X-ray'},
 use:['fist','open','pinch','point','victory','thumbUp','thumbDown','love','both-pinch','both-fist','clap'],
 copy:{mark:['Sewing','machine'],stageLabel:'A sewing machine, held in your hands',viewportLabel:'3D sewing machine. Drag a part to pull it, drag elsewhere to turn, scroll to zoom in under the plate, space to run, T to retime the hook.',readoutUnit:'stitches',loading:'Building the machine…',loadError:'Could not build the machine. ',cameraFallback:'Camera unavailable. Mouse still works: drag a part to pull it out. '},
 about:{heading:'One thread from above, one from below',note:machineNote,privacy:`${machineHow} Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.`,sources},
 createView:host=>new MachineView(host),
 createEngine:world=>new MachineEngine(world),
 state:{initial:initialMachine,validate:validateMachine},
 createAudio:()=>new MachineAudio(),
 descriptor:(state,position)=>({chapter:0,guided:false,tool:state.tool,representation:'mechanism',phase:state.tool==='rotor'?Math.round(position):Math.round(position/30)*30%360,selected:null,zoom:state.view.zoom,title:'Sewing machine',motionLabel:'crank',labels:{tool:'Crank',play:'Run',stop:'Stop'}}),
 readout:out=>out.stitches,
 idles:state=>state.tool!=='rotor',
 recentered:engine=>engine.restore(),
 watch:{
  capture:({machine:m})=>({parts:{removed:[...m.removed],timing:m.timing,close:m.close,broken:m.broken},stitches:{count:m.count,list:m.stitches}}),
  apply({machine:m},page){
   const parts=page.parts as {removed:Removable[];timing:number;close:boolean;broken:boolean}|undefined,st=page.stitches as {count:number;list:Stitch[]}|undefined;
   if(parts){if(JSON.stringify(parts.removed)!==JSON.stringify(m.removed))m.removed=[...parts.removed];m.timing=parts.timing;m.close=parts.close;m.broken=parts.broken;}
   if(st){m.count=st.count;if(JSON.stringify(st.list)!==JSON.stringify(m.stitches))m.stitches=st.list.map(x=>({...x}));}
  },
 },
};
