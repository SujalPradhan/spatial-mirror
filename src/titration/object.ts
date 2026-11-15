import './style.css';
import type {MirrorAction,MirrorObject,MirrorState} from '../mirror/contracts';
import {clampPhase} from '../mirror/contracts';
import type {Quat} from '../types';
import {sources,scientificNote} from './content';
import {steps} from './script';
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

const act=(id:string,label:string,hint:string,key:string,run:(e:TitrationEngine)=>void):MirrorAction<TitrationEngine>=>({id,label,hint,key,run});
const actions:MirrorAction<TitrationEngine>[]=[
 act('wear','Put on goggles','Step 1: put the goggles on','g',e=>e.wear()),
 act('rinse','Rinse burette','Step 2: pour a little, then drain it. Press again for the second part','r',e=>e.rinseKey()),
 act('pour','Pour','Steps 2 and 3: pour from the bottle. Hold the key to keep pouring','f',e=>e.pourKey()),
 act('tap-up','Open tap more','Turn the stopcock further open',']',e=>e.tapBy(.05)),
 act('tap-down','Close tap a little','Turn the stopcock back','[',e=>e.tapBy(-.05)),
 act('tap-close','Close tap','Shut the stopcock','x',e=>e.closeTap()),
 act('drop','One drop','Let one drop run','d',e=>e.drop()),
 act('swirl','Swirl','Swirl the flask for a moment','s',e=>e.swirlPulse()),
 act('burst','Clear the tip','Step 4: a short burst of the tap','b',e=>e.burstKey()),
 act('pipette','Pipette the acid','Step 5: draw 25.0 cm3 and run it into the flask','p',e=>e.pipetteKey()),
 act('choose-1','Choose phenolphthalein','Step 6: take the phenolphthalein dropper','1',e=>e.choose('phenolphthalein')),
 act('choose-2','Choose methyl orange','Step 6: take the methyl orange dropper','2',e=>e.choose('methyl-orange')),
 act('choose-3','Choose universal indicator','Step 6: take the universal indicator dropper','3',e=>e.choose('universal')),
 act('add-drop','Add a drop','Step 6: one drop of the chosen indicator','a',e=>e.addDrop()),
 act('read-up','Reading up 0.05','Raise the reading you are setting','arrowup',e=>e.lab.nudge(.05)),
 act('read-down','Reading down 0.05','Lower the reading you are setting','arrowdown',e=>e.lab.nudge(-.05)),
 act('read-up-1','Reading up 1','Raise the reading by one whole cm3','shift+arrowup',e=>e.lab.nudge(1)),
 act('read-down-1','Reading down 1','Lower the reading by one whole cm3','shift+arrowdown',e=>e.lab.nudge(-1)),
 act('hint','Hint','Show a hint for this step. It costs 2 points','h',e=>e.ui('hint')),
 act('notebook','Notebook','Open or close the notebook','n',e=>e.ui('notebook')),
 act('skip','Skip this step','Let the bench do this step. It costs a little technique','k',e=>e.lab.skip()),
];
export const titrationObject:MirrorObject<TitrationState,BenchView,TitrationEngine>&{liveView:BenchView|null;liveAudio:TitrationAudio|null}={
 liveView:null,liveAudio:null,
 id:'titration',documentKey:'titration:bench:mirror',title:'Titration bench - Spatial Studio',skins:['bench'],
 motion:{run:'Next',reverse:'Back'},
 gestures:{pinch:'Pick up',open:'Turn the tap',fist:'Swirl',thumbUp:'Next'},
 use:['pinch','open','fist','thumbUp'],
 omit:['turn-left','turn-right','turn-up','turn-down','pause','freeze','reverse'],
 actions,
 bar:engine=>{
  const l=engine.lab;
  if(l.quiz)return l.quiz.right?[{id:'thumbUp',label:'Continue'}]:[];
  if(l.finished)return [];
  const bar=[...l.task.bar];
  if(l.more&&!bar.some(g=>g.id==='thumbUp'))bar.push({id:'thumbUp',label:'Next'});
  return bar;
 },
 summary:engine=>{const l=engine.lab;return l.finished?'All steps done.':`Step ${l.step+1} of ${steps.length}: ${l.title}. ${l.line}`;},
 copy:{mark:['Titration','bench'],stageLabel:'A titration bench with a burette over a conical flask',viewportLabel:'3D titration bench. Drag objects to use them, scroll to zoom. Enter goes on, Space shuts the tap.',loading:'Setting up the bench…',loadError:'Could not set up the bench. ',cameraFallback:'Camera unavailable. The mouse and keyboard run every step: use the task card, the Actions list and the keys. '},
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
