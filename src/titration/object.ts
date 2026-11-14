import './style.css';
import type {MirrorObject,MirrorState} from '../mirror/contracts';
import {clampPhase} from '../mirror/contracts';
import type {Quat} from '../types';
import {sources,scientificNote} from './content';
import {TitrationEngine} from './engine';
import {BenchView} from './view';
import {TitrationAudio} from './audio';

/** Only the camera pose persists. The session at the bench is play, not a saved document. */
export interface TitrationState extends MirrorState {schema:1}
const home=()=>({q:[0,0,0,1] as Quat,zoom:1,x:0,y:0});
const initial=():TitrationState=>({schema:1,tool:'view',phase:0,view:home(),frozen:false});
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const bounded=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
function validate(value:unknown):TitrationState{
 if(!record(value)||value.schema!==1||!['view','rotor'].includes(value.tool as string)||!bounded(value.phase,0,360)||typeof value.frozen!=='boolean'||!record(value.view))throw Error('Invalid titration view.');
 const view=value.view;
 if(!Array.isArray(view.q)||view.q.length!==4||!view.q.every(n=>typeof n==='number'&&Number.isFinite(n))||Math.abs(Math.hypot(...view.q)-1)>.1||!bounded(view.zoom,.65,2.5)||!bounded(view.x,-6,6)||!bounded(view.y,-6,6))throw Error('Invalid titration view.');
 const norm=Math.hypot(...view.q);
 return {schema:1,tool:value.tool as TitrationState['tool'],phase:clampPhase(value.phase),view:{q:view.q.map(n=>n/norm) as Quat,zoom:view.zoom,x:view.x,y:view.y},frozen:value.frozen};
}

export const titrationObject:MirrorObject<TitrationState,BenchView,TitrationEngine>&{liveView:BenchView|null;liveAudio:TitrationAudio|null}={
 liveView:null,liveAudio:null,
 id:'titration',documentKey:'titration:bench:mirror',title:'Titration bench - Spatial Studio',skins:['bench'],
 motion:{run:'Run',reverse:'Reverse'},
 gestures:{open:'Turn the tap',fist:'Swirl'},
 use:['open','fist'],
 copy:{mark:['Titration','bench'],stageLabel:'A titration bench with a burette over a conical flask',viewportLabel:'3D titration bench. Drag to turn the view, scroll to zoom. Space closes the tap.',loading:'Setting up the bench…',loadError:'Could not set up the bench. ',cameraFallback:'Camera unavailable. The mouse and keyboard run every step: use the buttons and the stopcock slider. '},
 about:{heading:'A titration, step by step',note:scientificNote,privacy:'Hand tracking runs in your browser and no video leaves the device. A paired phone sends only hand positions.',sources},
 createView(host){return this.liveView=new BenchView(host);},
 createEngine:world=>new TitrationEngine(world,seedFromUrl()),
 state:{initial,validate},
 createAudio(){return this.liveAudio=new TitrationAudio();},
 descriptor:state=>({chapter:0,guided:false,tool:state.tool,representation:'structure',phase:0,selected:null,zoom:state.view.zoom,title:'Titration',motionLabel:'tap',labels:{tool:false,play:false,stop:'Close tap'}}),
 idles:()=>false,
};
/** A fixed `?seed=` makes the unknown acid repeatable; otherwise it is random each visit. */
export function seedFromUrl(){
 const s=Number(new URLSearchParams(location.search).get('seed'));
 return Number.isInteger(s)&&s>0?s:Math.floor(Math.random()*1e9)+1;
}
