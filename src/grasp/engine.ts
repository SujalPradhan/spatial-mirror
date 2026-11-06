/**
 * The grasp loop: your hand's 15 joint angles → the k-motor projection → tendons closing on the object → is it held.
 * The shared engine is not extended: a closing fist is the core input here, so it must never turn the view.
 * Only ✊✊ scales, 👎 held re-seats the object, 🤟 held changes the motor count, and a clap brings the next object.
 */
import {MIRROR_ZOOM_MAX,MIRROR_ZOOM_MIN,type GestureFrame,type MirrorDriver,type MirrorViewPatch,type MirrorViewState,type TrackedHand,type WorldPoint} from '../mirror/contracts';
import type {CalibrationPhase,GraspOutput,GraspScene,GraspSound,TaxonomyEntry} from './contracts';
import {JOINT_COUNT,row} from './kinematics';
import {JointReader,calibrate,defaultCalibration,normalise,validCalibration,type Calibration} from './joints';
import {OBJECTS,objectById,type GraspId,type GraspKind} from './objects';
import {evaluate,type Verdict} from './score';
import {COUPLINGS,MOTOR_COUNTS,explained,pose,project,type MotorCount} from './synergy';
import {simulate,type SimResult} from './tendon';

export const CALIBRATION_KEY='grasp-calibration-v1';
const STEP_S=1.5,MOTOR_SPEED=2.2,HELD_S=.45,FOUND_S=.6,LOVE_S=.6,THUMB_S=.9,SAMPLE_S=.25,WINDOW=120;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
/** Mouse presets: a few named shapes, clearly second best to fifteen live angles. */
export const PRESETS:Record<string,{label:string;q:number[]}>={
 open:{label:'Open',q:pose({})},
 power:{label:'Power',q:pose({opp:.45,thumb:.75,fingers:.9})},
 pinch:{label:'Pinch',q:pose({opp:.9,thumb:[.05,.3],fingers:[.7,.15,.1,.1]})},
 tripod:{label:'Tripod',q:pose({opp:.85,thumb:[.15,.25],fingers:[.65,.65,.2,.2]})},
 key:{label:'Key grip',q:pose({opp:.05,thumb:.5,fingers:.75})},
 sphere:{label:'Sphere',q:pose({opp:.8,thumb:.3,fingers:[.55,.55,.55,.5]})},
};
interface Store {getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void}
const memory=():Store=>{const m=new Map<string,string>();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>{m.set(k,v);},removeItem:k=>{m.delete(k);}};};

export class GraspEngine implements MirrorDriver<GraspOutput> {
 idle=false;readonly position=0;readonly speed=0;
 motors:MotorCount=1;objectId:GraspId='mug';inspect=1;
 private reader=new JointReader();private calibration:Calibration;private calibrated:boolean;
 private calib:{phase:CalibrationPhase;progress:number;flat:number[][];fist:number[][];doneAt:number}={phase:null,progress:0,flat:[],fist:[],doneAt:-Infinity};
 private user=new Array(JOINT_COUNT).fill(0);private spread:[number,number,number,number]=[0,0,0,0];
 private command=[0];private sim:SimResult;private verdict:Verdict;private simKey='';
 private heldFor=0;private lift=0;private wasHeld=false;private contactKey='';
 private clock=0;private lastFrame=NaN;private handId:number|null=null;private lastHandAt=-Infinity;private source:GraspScene['source']='rest';
 preset:string|null=null;
 taxonomy:Partial<Record<GraspKind,TaxonomyEntry>>={};best:Partial<Record<GraspId,number>>={};private foundFor=0;
 private window:number[][]=[];private sampleAt=0;private explainedCache:Record<MotorCount,number>={1:1,2:1,3:1,5:1};
 private charge:{hand:number;gesture:'thumbDown'|'love';since:number;fired:boolean}|null=null;
 private zoomGrip:{distance:number;zoom:number}|null=null;
 private sounds:GraspSound[]=[];private note:{text:string;at:number}|null=null;private thumbUncertain=false;
 constructor(private store:Store=typeof localStorage==='undefined'?memory():localStorage){
  let saved:Calibration|null=null;try{saved=validCalibration(JSON.parse(store.getItem(CALIBRATION_KEY)??'null'));}catch{saved=null;}
  this.calibration=saved??defaultCalibration();this.calibrated=!!saved;this.reader.setThumbLength(this.calibration.thumbLength);
  this.sim=simulate(COUPLINGS[1],[0],objectById(this.objectId));this.verdict=evaluate(this.sim,objectById(this.objectId));
 }
 get coupling(){return COUPLINGS[this.motors];}
 get object(){return objectById(this.objectId);}
 get isCalibrated(){return this.calibrated;}
 get calibrationPhase(){return this.calib.phase;}
 // The shell's pointer and motion hooks: here the mouse only turns the view, so nothing is plucked.
 seek(){}kick(){}
 pointerDown(_:WorldPoint){return false;}pointerMove(){}pointerUp(){}hover(){}
 reset(){this.reseat();}
 setMotors(k:MotorCount){if(k===this.motors)return;this.motors=k;this.command=new Array(COUPLINGS[k].motors.length).fill(0).map((_,j)=>project(COUPLINGS[k],this.user).m[j]);this.simKey='';this.heldFor=0;this.sounds.push({type:'motors'});this.say(`${COUPLINGS[k].title}: ${COUPLINGS[k].blurb}`);}
 cycleMotors(step=1){const i=MOTOR_COUNTS.indexOf(this.motors);this.setMotors(MOTOR_COUNTS[(i+step+MOTOR_COUNTS.length)%MOTOR_COUNTS.length]);}
 setObject(id:GraspId){if(id===this.objectId)return;this.objectId=id;this.reseat();this.sounds.push({type:'object'});this.say(`${this.object.name}: ${this.object.goalText}`);}
 nextObject(step=1){const i=OBJECTS.findIndex(o=>o.id===this.objectId);this.setObject(OBJECTS[(i+step+OBJECTS.length)%OBJECTS.length].id);}
 reseat(){this.lift=0;this.heldFor=0;this.wasHeld=false;this.simKey='';this.say(`${this.object.name} back on its stand`);}
 setPreset(id:string|null){this.preset=id&&PRESETS[id]?id:null;}
 setInspect(d:number){this.inspect=clamp(Math.round(d),0,4);}
 startCalibration(){this.calib={phase:'flat',progress:0,flat:[],fist:[],doneAt:-Infinity};this.reader.reset();}
 skipCalibration(){if(!this.calib.phase||this.calib.phase==='done')return;this.calib.phase=null;this.calibrated=true;this.say('Using typical hand ranges. Calibrate any time from the corner.');}
 private say(text:string){this.note={text,at:this.clock};}
 /** The hand that drives the robot: the one seen longest, so a second hand passing by does not take over. */
 private driver(frame:GestureFrame):TrackedHand|null{
  const hands=frame.hands.filter(h=>h.shape&&h.landmarks.length===21);if(!hands.length)return null;
  return hands.find(h=>h.id===this.handId)??hands.sort((a,b)=>a.id-b.id)[0];
 }
 private gestures(frame:GestureFrame,view:MirrorViewState,frozen:boolean):MirrorViewPatch|null{
  for(const e of frame.events)if(e.type==='clap'&&!frozen)this.nextObject();
  const fists=frame.hands.filter(h=>h.pose==='fist');
  // ✊✊: the gap between the fists scales; one fist is just a closed hand driving the robot.
  if(fists.length>=2&&!frozen){
   const [a,b]=fists,d=Math.hypot(a.palm.x-b.palm.x,a.palm.y-b.palm.y);
   if(!this.zoomGrip)this.zoomGrip={distance:Math.max(.02,d),zoom:view.zoom};
   return {zoom:clamp(this.zoomGrip.zoom*d/this.zoomGrip.distance,MIRROR_ZOOM_MIN,MIRROR_ZOOM_MAX)};
  }
  this.zoomGrip=null;
  const hand=this.driver(frame);
  const g=hand?.pose==='thumbDown'?'thumbDown':hand?.pose==='love'?'love':null;
  if(!hand||!g||frozen){this.charge=null;return null;}
  if(!this.charge||this.charge.hand!==hand.id||this.charge.gesture!==g)this.charge={hand:hand.id,gesture:g,since:this.clock,fired:false};
  if(!this.charge.fired&&this.clock-this.charge.since>=(g==='love'?LOVE_S:THUMB_S)){this.charge.fired=true;if(g==='love')this.cycleMotors();else this.reseat();}
  return null;
 }
 private calibrate(raw:Float64Array,thumb:number|null,h:number){
  const c=this.calib;if(c.phase!=='flat'&&c.phase!=='fist')return;
  const fingers=[3,4,6,7,9,10,12,13].reduce((a,i)=>a+raw[i],0)/8*180/Math.PI;
  const ok=c.phase==='flat'?fingers<38:fingers>48;
  c.progress=clamp(c.progress+(ok?h:-h*.5)/STEP_S,0,1);
  if(ok&&c.progress>.3)(c.phase==='flat'?c.flat:c.fist).push([...raw]);
  if(c.progress<1)return;
  if(c.phase==='flat'){c.phase='fist';c.progress=0;this.sounds.push({type:'step'});return;}
  this.calibration=calibrate(c.flat,c.fist,thumb);this.calibrated=true;c.phase='done';c.doneAt=this.clock;
  try{this.store.setItem(CALIBRATION_KEY,JSON.stringify(this.calibration));}catch{/* Private modes refuse storage; calibration lasts the visit. */}
  this.sounds.push({type:'calibrated'});
 }
 private readHand(frame:GestureFrame,h:number){
  const hand=this.driver(frame);
  if(!hand||!hand.shape){if(this.clock-this.lastHandAt>1)this.source=this.preset?'preset':'rest';return;}
  if(this.handId!==hand.id){this.reader.reset();this.handId=hand.id;}
  const read=this.reader.read(hand.shape.points,frame.at);if(!read)return;
  this.lastHandAt=this.clock;this.source=hand.shape.metric?'hand':'phone';this.thumbUncertain=this.reader.thumbUncertain;
  if(!this.calibrated&&!this.calib.phase)this.startCalibration();
  this.calibrate(read.raw,null,h);
  // Two fists are scaling the view; the robot holds the last pose meanwhile.
  if(frame.hands.filter(x=>x.pose==='fist').length>=2)return;
  this.user=normalise(read.smooth,this.calibration);this.spread=read.abd;
 }
 step(frame:GestureFrame,dt:number,view:MirrorViewState,frozen:boolean):GraspOutput{
  const h=Number.isFinite(dt)?clamp(dt,0,.05):0;this.clock+=h;
  let patch:MirrorViewPatch|null=null;
  if(frame.at!==this.lastFrame){this.lastFrame=frame.at;if(!frozen)this.readHand(frame,h);patch=this.gestures(frame,view,frozen);}
  if(this.source==='preset'||this.source==='rest'){
   // Without a hand the pose eases to the chosen preset, or opens.
   const target=PRESETS[this.preset??'open'].q;this.source=this.preset?'preset':'rest';
   for(let i=0;i<JOINT_COUNT;i++)this.user[i]+=(target[i]-this.user[i])*(1-Math.exp(-h*5));
   this.spread=this.spread.map(x=>x*(1-h*4)) as typeof this.spread;
  }
  const c=this.coupling,proj=project(c,this.user);
  // Motors are real: they slew, so the robot lags your hand a little and its tendons visibly reel in.
  if(this.command.length!==c.motors.length)this.command=[...proj.m];
  let moving=0;
  if(!frozen)this.command=this.command.map((x,j)=>{const d=clamp(proj.m[j]-x,-MOTOR_SPEED*h,MOTOR_SPEED*h);moving=Math.max(moving,Math.abs(d)/(h||1));return x+d;});
  const key=`${this.motors}|${this.objectId}|${this.command.map(x=>x.toFixed(3)).join(',')}`;
  if(key!==this.simKey){this.simKey=key;this.sim=simulate(c,this.command,this.object);this.verdict=evaluate(this.sim,this.object);}
  const v=this.verdict,touch=this.sim.contacts.filter(x=>x.kind==='object').map(x=>`${x.digit}${x.k}`).join();
  if(touch!==this.contactKey){if(touch.length>this.contactKey.length)this.sounds.push({type:'touch'});this.contactKey=touch;}
  // A stable grasp held a moment lifts the object off its stand; losing it drops it back.
  this.heldFor=v.stable?this.heldFor+h:0;
  const held=this.heldFor>=HELD_S;this.lift=clamp(this.lift+(held?h/.6:-h/.35),0,1);
  if(held&&!this.wasHeld){this.sounds.push({type:'held'});this.best[this.objectId]=Math.max(this.best[this.objectId]??0,v.score);}
  if(!held&&this.wasHeld&&this.lift>.2)this.sounds.push({type:'drop'});
  this.wasHeld=held;if(held)this.best[this.objectId]=Math.max(this.best[this.objectId]??0,v.score);
  // The checklist fills from what the grasp is, whatever object it is on, remembering the fewest motors that managed it.
  this.foundFor=v.stable&&v.kind?this.foundFor+h:0;
  if(v.kind&&this.foundFor>=FOUND_S){const old=this.taxonomy[v.kind];if(!old||old.motors>this.motors){if(!old)this.sounds.push({type:'found'});this.taxonomy[v.kind]={motors:this.motors,object:this.objectId,at:this.clock};}}
  // A rolling window of your own poses: how much of what your hand did could each robot have followed?
  if(this.source==='hand'||this.source==='phone'){this.sampleAt-=h;if(this.sampleAt<=0){this.sampleAt=SAMPLE_S;this.window.push([...this.user]);if(this.window.length>WINDOW)this.window.shift();for(const k of MOTOR_COUNTS)this.explainedCache[k]=explained(COUPLINGS[k],this.window);}}
  const tension=this.sim.motors.reduce((a,m)=>a+m.tension,0)/Math.max(1,this.sim.motors.length);
  this.sounds.push({type:'motor',speed:clamp(moving/MOTOR_SPEED,0,1),load:tension/3});
  const sounds=this.sounds;this.sounds=[];
  const calib=this.calib,charging=this.charge&&!this.charge.fired?{gesture:this.charge.gesture,amount:clamp((this.clock-this.charge.since)/(this.charge.gesture==='love'?LOVE_S:THUMB_S),0,1)}:null;
  const scene:GraspScene={coupling:c,object:this.objectId,user:[...this.user],spread:[...this.spread] as GraspScene['spread'],command:[...this.command],free:proj.q,residual:proj.residual,sim:this.sim,verdict:v,lift:this.lift,
   source:this.source,preset:this.preset,thumbUncertain:this.thumbUncertain&&(this.source==='hand'||this.source==='phone'),
   calibration:{phase:calib.phase,progress:calib.progress,doneFor:calib.phase==='done'?this.clock-calib.doneAt:Infinity},
   explained:{...this.explainedCache},samples:this.window.length,taxonomy:{...this.taxonomy},best:{...this.best},inspect:this.inspect,charging,
   note:this.note&&this.clock-this.note.at<4.5?{text:this.note.text,age:this.clock-this.note.at}:null};
  return {scene,view:patch,sounds,holding:!!patch};
 }
 /** For tests and the phone: the projection of an arbitrary pose under the current coupling. */
 projectPose(q:number[]){return project(this.coupling,q);}
 /** Joint rows for a digit, for the zoom. */
 static rowsOf(d:number){return [row(d,0),row(d,1),row(d,2)];}
}
