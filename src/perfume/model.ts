import {dims,type PartId} from './parts';
/** Press-cycle simulation with no rendering. Pressures are illustrative, normalised to a plausible order of magnitude rather than measured. */
export const DOSE_ML=.08;
/** Typical fine-mist range, supplier-quoted. */
export const DOSE_RANGE_ML=[.065,.1] as const;
export const CAPACITY_ML=50;
/** Fraction of the stroke taken up before the outlet opens. Dose is what is swept after this. */
export const THRESHOLD_DEPTH=.28;
export const OPEN_BAR=3,MIST_BAR=2;
const ML_PER_MM=Math.PI*dims.innerR**2/1000;
const SNAP_SPEED=7,MAX_SPEED=12,RETURN_SPEED=2.5,REFILL_RATE=1.8,CRACK=.08,THRESHOLD_S=.016;
const FLOW_K=.0625,LEAK=.4,LEAK_OUT=.3,LEAK_REFILL=.3,FALLBACK_RATE=.5,AIR_SIP=.25,SUBSTEP=1/240;
export type PumpPhase='rest'|'compress'|'threshold'|'spray'|'return'|'refill';
export type Spray='none'|'dribble'|'mist'|'jet'|'sputter';
export interface PumpState {
 /** Actual stem position 0..1, which can differ from the finger's. */
 depth:number;phase:PumpPhase;spray:Spray;pressureBar:number;removed:Set<PartId>;precompression:boolean;
 /** Millilitres in the bottle. */
 liquidMl:number;
 /** Share of the dose volume in the chamber: liquid, then air. */
 chamberFill:number;chamberAir:number;
 /** How primed the dip tube and dead volume are, 0 fallen back to 1 full. */
 tubeFill:number;
 /** Ball lift 0..1. */
 valveLift:number;doses:number;dispensedMl:number;
 /** Millilitres leaving the nozzle during the last step. */
 emittedMl:number;
 stuck:boolean;discharging:boolean;snapped:boolean;finger:number;latency:number;stroke:number;counted:boolean;
}
export interface PumpOptions {liquidMl?:number;precompression?:boolean;removed?:Iterable<PartId>}
export function createPump(o:PumpOptions={}):PumpState {
 return {depth:0,phase:'rest',spray:'none',pressureBar:0,removed:new Set(o.removed),precompression:o.precompression??true,liquidMl:o.liquidMl??CAPACITY_ML,chamberFill:1,chamberAir:0,tubeFill:1,valveLift:0,doses:0,dispensedMl:0,emittedMl:0,stuck:false,discharging:false,snapped:false,finger:0,latency:0,stroke:0,counted:false};
}
/** Height of the liquid surface in the straight-walled body. */
export const liquidY=(ml:number)=>dims.baseY+Math.max(0,ml)/ML_PER_MM;
/** Bottle contents at which the surface reaches the dip-tube end. */
export const TUBE_END_ML=(dims.tubeEndY-dims.baseY)*ML_PER_MM;
const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
const drawsAir=(s:PumpState)=>s.removed.has('tube')||s.liquidMl<=TUBE_END_ML;

function tick(s:PumpState,target:number,h:number) {
 const pre=s.precompression,th=pre?THRESHOLD_DEPTH:0,leak=s.removed.has('ball');
 const eff=(d:number)=>clamp((d-th)/(1-th));
 const from=s.depth;
 if(s.phase==='threshold'){s.latency-=h;if(s.latency<=0)s.phase='spray';}
 else {
  // After the snap the finger is still on the button: the stem only rises once the finger lifts.
  if(s.snapped&&target<s.finger-1e-6)s.snapped=false;
  s.finger=target;
  const goal=s.discharging||s.snapped?1:target;
  // Past the threshold the stem snaps through at its own speed, which is why finger speed stops mattering.
  if(goal>s.depth)s.depth=Math.min(goal,s.depth+(s.discharging?SNAP_SPEED:MAX_SPEED)*h);
  else if(!s.removed.has('spring'))s.depth=Math.max(goal,s.depth-RETURN_SPEED*h);
 }
 const moved=s.depth-from,down=moved>1e-9,up=moved<-1e-9,speed=Math.abs(moved)/h;
 if(down&&s.phase!=='spray'&&s.phase!=='threshold')s.phase='compress';
 if(pre&&!leak&&!s.discharging&&down&&s.depth>=th&&s.phase==='compress'){s.phase='threshold';s.discharging=true;s.latency=THRESHOLD_S;s.depth=Math.max(from,th);}
 if(up&&s.phase!=='refill'){if(s.phase!=='return'){s.stroke=0;s.counted=false;}s.phase='return';}
 // Chamber emptying: the swept share leaves, liquid and air in proportion.
 const swept=down&&(s.discharging||!pre||leak)?Math.max(0,eff(s.depth)-eff(from)):0,held=s.chamberFill+s.chamberAir,take=Math.min(swept,held);
 let spray:Spray='none',airy=false;
 if(take>0){
  const share=s.chamberFill/held,wet=take*share;
  airy=share<1;
  s.chamberFill-=wet;s.chamberAir-=take-wet;
  const out=leak?(pre?0:wet*LEAK_OUT):wet;
  s.liquidMl+=(wet-out)*DOSE_ML;s.dispensedMl+=out*DOSE_ML;s.emittedMl+=out*DOSE_ML;s.stroke+=out;
  if(!s.counted&&s.stroke>=.95){s.counted=true;s.doses++;}
 }
 if(!pre&&take>0&&s.phase==='compress')s.phase='spray';
 if(s.discharging&&s.depth>=1){s.discharging=false;s.snapped=true;}
 // Refill follows suction with a lag, and only as far as the piston has made room.
 const space=(leak?LEAK_REFILL:1)*(1-eff(s.depth)),deficit=Math.max(0,space-s.chamberFill-s.chamberAir);
 if(s.phase==='return'&&!leak&&deficit>CRACK)s.phase='refill';
 const flowing=!down&&deficit>0&&(s.phase==='refill'||(leak&&up));
 if(flowing){
  const flow=Math.min(deficit,REFILL_RATE*h),air=drawsAir(s);
  const wet=Math.min(s.liquidMl/DOSE_ML,air?(s.removed.has('tube')?0:flow*AIR_SIP):flow);
  s.chamberFill+=wet;s.liquidMl-=wet*DOSE_ML;
  s.chamberAir+=air?flow-wet:0;
  if(!air)s.tubeFill=clamp(s.tubeFill+h*2.5);
 }
 s.valveLift=flowing&&!leak?clamp(deficit*6,.25,1):0;
 const pulling=!down&&deficit>0&&(flowing||s.phase==='return');
 if(leak&&!flowing&&s.chamberFill>0){const back=Math.min(s.chamberFill,FALLBACK_RATE*h);s.chamberFill-=back;s.liquidMl+=back*DOSE_ML;}
 if(leak&&!flowing||drawsAir(s))s.tubeFill=clamp(s.tubeFill-h*FALLBACK_RATE);
 if(s.phase==='refill'&&deficit<=1e-6&&s.depth<=0)s.phase='rest';
 if(s.phase==='return'&&s.depth<=0&&!deficit)s.phase='rest';
 if(s.phase==='return'&&s.depth<=0&&leak)s.phase='rest';
 if(s.phase==='compress'&&s.depth<=0)s.phase='rest';
 // Pressure.
 const cap=leak?OPEN_BAR*LEAK:Infinity;
 if(pulling)s.pressureBar=-.4*Math.min(1,deficit*2);
 else if(s.discharging)s.pressureBar=OPEN_BAR;
 else if(pre&&(s.depth<th||leak)&&!(s.phase==='spray'))s.pressureBar=Math.min(cap,OPEN_BAR*clamp(s.depth/th));
 else if(!pre&&down)s.pressureBar=Math.min(cap,FLOW_K*speed*speed*Math.min(1,s.depth*2));
 else s.pressureBar*=Math.exp(-h/.03);
 // Output.
 if(take>0)spray=airy?'sputter':leak&&pre?'none':s.pressureBar<MIST_BAR?'dribble':s.removed.has('nozzle')?'jet':'mist';
 s.spray=spray;
 s.stuck=s.removed.has('spring')&&s.depth>0;
}
/** Advance by dt seconds with the finger at `target` 0..1. A spring-less stem cannot rise, whatever the finger does. */
export function stepPump(s:PumpState,target:number,dt:number) {
 const n=Math.max(1,Math.ceil(dt/SUBSTEP)),goal=clamp(target),start=s.depth;
 let last:Spray='none';s.emittedMl=0;
 for(let i=1;i<=n;i++){
  // The finger moves across the frame, so frame-rate does not read as press speed.
  const ramp=goal>start?start+(goal-start)*i/n:goal;
  tick(s,ramp,dt/n);
  if(s.spray!=='none')last=s.spray;
 }
 s.spray=last;
 return s;
}
export function setRemoved(s:PumpState,part:PartId,removed:boolean){if(removed)s.removed.add(part);else s.removed.delete(part);}

export interface FailureRow {id:string;part:PartId|null;when:string;result:string;spray:Spray;
 /** 'mechanism' follows from how the pump works; 'illustrative' is the expected look, not a measured behaviour. */
 basis:'mechanism'|'illustrative';active(s:PumpState):boolean}
export const failures:FailureRow[]=[
 {id:'no-swirl',part:'nozzle',when:'Swirl insert removed',result:'Nothing spins the liquid, so it leaves as a straight jet, not mist.',spray:'jet',basis:'mechanism',active:s=>s.removed.has('nozzle')},
 {id:'no-ball',part:'ball',when:'Ball valve removed',result:'Nothing holds the liquid up: the chamber does not refill properly and liquid falls back down the tube.',spray:'none',basis:'mechanism',active:s=>s.removed.has('ball')},
 {id:'no-spring',part:'spring',when:'Spring removed',result:'The actuator stays down, so there is no return stroke and no refill.',spray:'none',basis:'mechanism',active:s=>s.removed.has('spring')},
 {id:'no-precompression',part:null,when:'Pre-compression off',result:'Output follows the finger: a soft press dribbles and a hard one sprays.',spray:'dribble',basis:'mechanism',active:s=>!s.precompression},
 {id:'low-liquid',part:'liquid',when:'Liquid below the dip-tube end',result:'The pump draws air and sputters.',spray:'sputter',basis:'illustrative',active:s=>s.liquidMl<=TUBE_END_ML},
 {id:'no-tube',part:'tube',when:'Dip tube removed',result:'The pump can only draw air, so it sputters once the primed dose is gone.',spray:'sputter',basis:'illustrative',active:s=>s.removed.has('tube')},
];
export const activeFailures=(s:PumpState)=>failures.filter(f=>f.active(s));
