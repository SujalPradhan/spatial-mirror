import type {Quat} from '../types';
import type {AtpComponent, AtpState, AtpViewState} from './contracts';
import {chapters} from './content';

export const checkpoints = [0,120,240,360] as const;
export const componentInfo:Record<AtpComponent,{label:string;scientific:string;description:string;color:string}> = {
  rotor:{label:'Rotor',scientific:'c ring + gamma/epsilon central shaft',description:'The ring and central shaft turn together during the illustrated synthesis cycle. Epsilon also has a regulatory role.',color:'#c64c37'},
  stator:{label:'Stator',scientific:'a, b and delta subunits',description:'The membrane a subunit provides proton access pathways; b and delta support the head against rotation.',color:'#287d84'},
  head:{label:'Catalytic head',scientific:'alpha₃ beta₃ · F₁',description:'Three beta catalytic sites change conformation as the shaft turns. The head stays against rotation; its shape is not rigid.',color:'#756b99'},
  membrane:{label:'Cell membrane',scientific:'E. coli inner membrane · schematic',description:'An electrochemical proton gradient across this membrane can drive ATP synthesis. The gray slab is context, not deposited lipid coordinates.',color:'#aabbb1'},
};

export function initialAtp():AtpState {
  return {schema:1,chapter:0,guided:true,tool:'view',representation:'structure',phase:0,selected:null,
    view:structuredClone(chapters[0].view),frozen:false};
}

/** A single bounded teaching cycle. Backward input rewinds, rather than counts reactions. */
export function clampPhase(value:number):number {
  return Number.isFinite(value)?Math.max(0,Math.min(360,value)):0;
}

export type SiteState='open'|'loose'|'tight';
export const siteInfo:Record<SiteState,{label:string;description:string}> = {
  open:{label:'Open · exchange/release',description:'Low affinity allows product release and exchange.'},
  loose:{label:'Loose · bind',description:'ADP and inorganic phosphate bind in this simplified synthesis sequence.'},
  tight:{label:'Tight · form/hold',description:'The site favors ATP formation and holds ATP tightly until its next change.'},
};

/** Discrete binding-change teaching steps; not time-resolved conformational inference. */
export function phaseSites(phase:number):{label:string;state:SiteState}[] {
  const step=Math.floor(clampPhase(phase)/120)%3;
  const states:SiteState[]=['open','loose','tight'];
  return ['Site A','Site B','Site C'].map((label,index)=>({label,state:states[(index+step)%3]}));
}

/** A chapter chooses a useful view. Rotor phase is deliberately independent. */
export function selectChapter(state:AtpState,index:number):AtpState {
  if(!Number.isInteger(index)||index<0||index>=chapters.length)throw Error('Choose an ATP chapter from 1 to 6.');
  const chapter=chapters[index];
  return {...structuredClone(state),chapter:index,guided:true,tool:chapter.tool,representation:chapter.representation,
    selected:null,view:structuredClone(chapter.view)};
}

const components:AtpComponent[]=['rotor','stator','head','membrane'];
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const bounded=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;

/** Validate imported/restored numeric state. Camera, playback and held inputs are never restored. */
export function validateAtp(value:unknown):AtpState {
  if(!record(value)||value.schema!==1||!Number.isInteger(value.chapter)||!bounded(value.chapter,0,chapters.length-1)||
    typeof value.guided!=='boolean'||!['view','rotor'].includes(value.tool as string)||
    !['structure','mechanism'].includes(value.representation as string)||!bounded(value.phase,0,360)||
    !(value.selected===null||components.includes(value.selected as AtpComponent))||typeof value.frozen!=='boolean'||!record(value.view)) {
    throw Error('Invalid ATP exploration.');
  }
  const view=value.view;
  if(!Array.isArray(view.q)||view.q.length!==4||!view.q.every(v=>typeof v==='number'&&Number.isFinite(v))||
    Math.abs(Math.hypot(...view.q)-1)>.1||!bounded(view.zoom,.65,2.5)||!bounded(view.x,-6,6)||!bounded(view.y,-6,6)) {
    throw Error('Invalid ATP view.');
  }
  const norm=Math.hypot(...view.q);
  const cleanView:AtpViewState={q:view.q.map(n=>n/norm) as Quat,zoom:view.zoom,x:view.x,y:view.y};
  // Build a fresh allow-listed value: unknown fields such as playing/held are dropped.
  return {schema:1,chapter:value.chapter,guided:value.guided,tool:value.tool as AtpState['tool'],
    representation:value.representation as AtpState['representation'],phase:value.phase,
    selected:value.selected as AtpComponent|null,view:cleanView,frozen:value.frozen};
}
