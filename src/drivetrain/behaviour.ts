import type {GestureEvent,HandPose,MirrorBehaviour,MirrorContext} from '../mirror/contracts';
import {BOARD,HAND_CRANK,INPUT_AT,LAYERS,PEG,ROD_LENGTH,SHOCK,THROW_MAX,THROW_MIN,Z_MAX,Z_MIN,anyClash,bodyKey,centre,centreDistance,cloneBuild,crankPin,dist,emptyBuild,fraction,gearsOn,itemOf,partOf,pitchR,place,remove,respace,rodEnd,sliderAt,snapGear,snapLink,solve,subtreeShafts,tipR,toothStrength,type Build,type Crank,type Gear,type Item,type Part,type Rod,type Slider,type Snap,type Solution,type V} from './gears';
import {Atlas,chainLeg,legPose,length as pathLength,place as placeFit,pose,type Leg,type Match} from './fourbar';
import {briefs,judge,type Verdict} from './briefs';
import type {DrivetrainSceneExtra,DrivetrainSkin,DrivetrainSound,DrivetrainWorld,HandIn} from './contracts';

type Context=MirrorContext<DrivetrainSkin,DrivetrainSceneExtra,DrivetrainSound>;
const TAU=Math.PI*2,wrap=(a:number)=>a-TAU*Math.round(a/TAU),clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n)),ease=(h:number,tau:number)=>1-Math.exp(-h/tau);
/** 60 rpm on the motor. */
export const MOTOR=TAU;
/** Held gestures, seconds; a hand moving faster than STILL (mirror widths a second) restarts the count. */
export const HOLD={open:.7,love:.55,victory:.45,thumb:.5,point:.2,pick:.15},STILL=.9;
/** A released pinch keeps its part this long, and takes it back if the same hand pinches again nearby. */
export const GRACE=.3,REGRAB=40;
/** Smallest hit radius on screen, pixels: every target has at least this much invisible reach. */
export const HIT_PX=34;
const UNDO_WINDOW=8,PULL_APART=18,ACK_LIFE=1.4;
/** Where a linkage may stand: the board above the tray. */
/** A linkage may reach a little past the board edge, as long as it stays on the stage. */
const STAGE={x0:BOARD.x0-60,x1:BOARD.x1+60,y0:BOARD.y0-40,y1:BOARD.y1+30};
const WORK={x0:BOARD.x0+8,x1:BOARD.x1-8,y0:BOARD.y0+6,y1:BOARD.y1-8};
export type Mode='build'|'draw';
export interface Tile {id:string;item?:Item;label:string;sub:string;x:number;y:number;w:number;h:number}
const TILE_W=42,TRAY_Y=(BOARD.y0+BOARD.tray)/2,TRAY_H=BOARD.tray-BOARD.y0-8;
const partTiles:{item:Item;label:string;sub:string}[]=[
 {item:{kind:'gear',z:12},label:'12T',sub:'pinion'},{item:{kind:'gear',z:16,steel:true},label:'16T',sub:'idler'},{item:{kind:'gear',z:18},label:'18T',sub:'gear'},{item:{kind:'gear',z:24},label:'24T',sub:'gear'},
 {item:{kind:'gear',z:36},label:'36T',sub:'gear'},{item:{kind:'gear',z:48},label:'48T',sub:'wheel'},{item:{kind:'crank',throw:15},label:'Crank',sub:'15 mm throw'},{item:{kind:'rod'},label:'Rod',sub:`${ROD_LENGTH} mm`},
 {item:{kind:'slider'},label:'Slider',sub:'on a guide'},{item:{kind:'hand'},label:'Hand',sub:'output'},
];
export interface Carry {hand:number;item:Item;at:V;snap:Snap|null;from:Build|null;origin:Part|null;lost:number}
interface Pending {hand:number;part:number;t:number;p0:V}
interface Track {pose:HandPose;t:number;edge:boolean;done:boolean;target:unknown;
 /** The pose before this one: an open hand that was just pinching is letting go, not asking for anything. */
 prev:HandPose}
export interface Ring {x:number;y:number;p:number;glyph:string;label:string}
export interface Reticle {x:number;y:number;closing:number;hit:boolean}
export interface Ack {text:string;x:number;y:number;age:number;tone:'ok'|'miss'|'warn'}
interface Stretch {a:number;b:number;target:number;d0:number;z0:number;base:Build;sol:Solution;valid:boolean}
interface Pull {a:number;b:number;moving:number;fixed:number;d0:number;base:Build;sol:Solution;sep:number;shafts:Set<number>;dir:V}
export interface Spike {age:number;gear:number;use:number;broke:boolean;at:V}
interface History {build:Build;label:string;at:number;destructive:boolean;kind:'build'|'draw';draw?:DrawState}
interface DrawState {stroke:V[];closed:boolean;matches:Match[];index:number;leg:Leg|null}

/** The build, the train, every hand gesture and the drawing studio. The engine hands it board-space hands; the view reads it as the scene. */
export class DrivetrainBehaviour implements MirrorBehaviour<DrivetrainSkin,DrivetrainSceneExtra,DrivetrainSound> {
 build:Build=emptyBuild();sol:Solution=solve(this.build);version=0;
 /** What to draw: a live preview while stretching or pulling apart, else the build. */
 shown:Build=this.build;shownSol:Solution=this.sol;
 brief=0;verdict:Verdict;metAt=-Infinity;survived=-1;
 mode:Mode='build';theta=0;omega=0;motor=0;inputRpm=0;crankHand:number|null=null;
 schematic=false;schematicU=0;exploded=false;explodeU=0;
 carry:Carry|null=null;pending:Pending|null=null;hover:number|null=null;candidate:string|null=null;pathOn=false;
 stretch:Stretch|null=null;pull:Pull|null=null;spike:Spike|null=null;
 rings:Ring[]=[];reticles:Reticle[]=[];acks:Ack[]=[];caption='';mouse:V|null=null;
 history:History[]=[];clock=0;
 // Drawing the motion.
 stroke:V[]=[];closed=false;drawing:number|null=null;drawLost=0;matches:Match[]=[];matchIndex=0;linkTheta=0;linkDir=1;trace:V[]=[];leg:Leg|null=null;legU=0;linkHand:number|null=null;
 private atlas:Atlas|null=null;private tracks=new Map<number,Track>();private crankRef=0;private crankLast=0;private crankAcc=0;private crankFrom=0;private linkRef=0;private linkFrom=0;private jamNag=-Infinity;private lastMet=false;
 private loads={hand:briefs[0].load,slider:briefs[0].push};
 constructor(private world:DrivetrainWorld){this.verdict=judge(briefs[0],this.build,this.sol,false);}
 get current(){return briefs[this.brief];}
 get match():Match|null{return this.matches[this.matchIndex]??null;}
 get tiles():Tile[]{
  const x0=BOARD.x0+8+TILE_W/2,out:Tile[]=[];
  if(this.mode==='build')partTiles.forEach((t,i)=>out.push({id:`part${i}`,item:t.item,label:t.label,sub:t.sub,x:x0+i*TILE_W,y:TRAY_Y,w:TILE_W-4,h:TRAY_H}));
  const ax=BOARD.x1-8-50;
  if(this.mode==='draw')out.push({id:'build',label:'Back to build',sub:'gears',x:ax,y:TRAY_Y,w:96,h:TRAY_H});
  else if(this.verdict.met&&this.brief<briefs.length-1)out.push({id:'next',label:'Next brief',sub:briefs[this.brief+1].title,x:ax,y:TRAY_Y,w:96,h:TRAY_H});
  else out.push({id:'draw',label:'Draw the motion',sub:'linkages',x:ax,y:TRAY_Y,w:96,h:TRAY_H});
  return out;
 }
 // ---- MirrorBehaviour ----
 initialScene():DrivetrainSceneExtra{return {train:this};}
 fit(){}
 describe(){return {title:'',detail:''};}
 drive(){}
 stir(){}
 advance(h:number,c:Context){
  for(let i=this.acks.length-1;i>=0;i--)if((this.acks[i].age+=h)>ACK_LIFE)this.acks.splice(i,1);
  if(this.spike&&(this.spike.age+=h)>2.4)this.spike=null;
  this.schematicU+=(+this.schematic-this.schematicU)*ease(Math.max(h,1e-6),.18);
  this.explodeU+=(+this.exploded-this.explodeU)*ease(Math.max(h,1e-6),.3);
  this.legU+=(+!!this.leg-this.legU)*ease(Math.max(h,1e-6),.4);
  c.scene.skin=this.schematic?'schematic':'metal';
  if(this.mode==='draw'){this.advanceDraw(h);c.sound({type:'motor',speed:0,load:0});return;}
  const stuck=this.sol.jammed||this.sol.broken;
  if(this.crankHand===null){
   const target=stuck?0:this.motor*MOTOR;
   this.omega+=(target-this.omega)*ease(Math.max(h,1e-6),this.motor?.45:.6);if(!this.motor&&Math.abs(this.omega)<.02)this.omega=0;
   this.theta+=this.omega*h;
  }
  this.inputRpm=this.omega*60/TAU;
  if(stuck&&this.motor&&this.clock-this.jamNag>2.5){this.jamNag=this.clock;this.say(this.sol.broken?'A broken tooth jams the train. 👎 or Recenter repairs it':'Jammed: a ring of meshes that disagree on direction',.5,.45,'warn');}
  this.judgeNow();
  c.sound({type:'motor',speed:Math.abs(this.inputRpm)/60,load:Math.min(1,this.sol.inputTorque)});
 }
 settle(){}
 publish(c:Context){
  const s=c.scene;s.label=null;
  if(this.mode!=='build'||this.hover===null)return;
  const p=partOf(this.shown,this.hover);if(!p)return;
  const info=this.inspect(p),at=this.anchor(p);
  s.label={title:info.title,detail:info.detail,...this.toWorld(at)};
 }
 reset(){this.restart();}

 // ---- Hands ----
 /** One step of hand input, in board millimetres. Returns the fists this page took, which the shell must not read as holding the view. */
 hands(list:HandIn[],events:GestureEvent[],h:number,frozen:boolean):Set<number>{
  this.clock+=h;this.h=h;this.rings=[];this.reticles=[];this.candidate=null;this.pathOn=false;this.hover=null;
  const taken=new Set<number>();
  for(const id of [...this.tracks.keys()])if(id!==-1&&!list.some(x=>x.id===id)){this.tracks.delete(id);this.lostHand(id);}
  if(frozen){this.calm();return taken;}
  for(const hand of list){
   let t=this.tracks.get(hand.id);
   if(!t){t={pose:hand.pose,t:0,edge:true,done:false,target:null,prev:'none'};this.tracks.set(hand.id,t);}
   else if(t.pose!==hand.pose){t.prev=t.pose;t.pose=hand.pose;t.t=0;t.edge=true;t.done=false;t.target=null;}
   else{t.edge=false;t.t+=h;}
  }
  if(events.some(e=>e.type==='clap'))this.clap(list);
  this.twoFists(list,taken);this.twoPinches(list);
  for(const hand of list)this.one(hand,this.tracks.get(hand.id)!,h,taken);
  this.endCarries();
  if(this.hover===null&&this.mouse&&this.mode==='build'&&!this.carry)this.hover=this.partAt(this.mouse,this.world.mmPerPx(this.mouse));
  return taken;
 }
 private one(hand:HandIn,t:Track,h:number,taken:Set<number>){
  const pairing=(this.stretch&&(this.stretch.a===hand.id||this.stretch.b===hand.id))||(this.pull&&(this.pull.a===hand.id||this.pull.b===hand.id));
  if(pairing){if(hand.pose==='fist')taken.add(hand.id);return;}
  if(hand.pose!=='pinch')this.reticle(hand);
  if(this.crankHand===hand.id&&hand.pose!=='fist')this.crankHand=null;
  if(this.linkHand===hand.id&&hand.pose!=='fist')this.linkHand=null;
  if(this.pending?.hand===hand.id&&hand.pose!=='pinch'){this.pending=null;this.say('Pinch and hold a moment to lift a part',hand.screen.pinch.x,hand.screen.pinch.y,'miss');this.sound({type:'miss'});}
  if(this.drawing===hand.id&&hand.pose!=='point'){if(!this.drawLost)this.drawLost=this.clock;if(this.clock-this.drawLost>GRACE)this.endStroke();}
  switch(hand.pose){
   case 'fist':if(this.fist(hand,t))taken.add(hand.id);break;
   case 'pinch':this.pinch(hand,t);break;
   case 'point':if(this.mode==='draw')this.drawPoint(hand,t);else this.inspectAt(hand);break;
   case 'victory':this.victory(hand,t);break;
   case 'open':if((hand.ratio<.8&&this.mode==='build')||t.prev==='pinch'){t.t=0;break;}this.held(hand,t,HOLD.open,'🖐',this.mode==='draw'?'Next match':this.exploded?'Assemble':'Explode',()=>this.mode==='draw'?this.cycle():this.explode());break;
   case 'love':this.held(hand,t,HOLD.love,'🤟',this.schematic?'Metal':'Schematic',()=>{this.schematic=!this.schematic;this.say(this.schematic?'Schematic: pitch circles and the ratio on every mesh':'Back to the metal',hand.screen.palm.x,hand.screen.palm.y);});break;
   case 'thumbUp':if(this.mode==='draw')this.held(hand,t,HOLD.thumb,'👍','Find a linkage',()=>this.search(hand));else if(t.edge)this.motorOn(1,hand);break;
   case 'thumbDown':if(t.edge){if(this.undoable())this.undo(hand);else if(this.mode==='draw'){this.linkDir*=-1;this.say('Linkage reversed',hand.screen.palm.x,hand.screen.palm.y);}else this.motorOn(-1,hand);}break;
  }
  void h;
 }
 private h=1/60;
 /** A deliberate hold: a ring fills at the palm; moving restarts it; it fires once. */
 private held(hand:HandIn,t:Track,need:number,glyph:string,label:string,fire:()=>void){
  if(t.done)return;
  if(hand.speed>STILL){t.t=0;}
  const p=Math.min(1,t.t/need);this.rings.push({x:hand.screen.palm.x,y:hand.screen.palm.y,p,glyph,label});
  if(p>=1){t.done=true;fire();}
 }
 private reticle(hand:HandIn){
  if(hand.ratio>=.8||hand.pose==='fist'||this.carry?.hand===hand.id)return;
  const hit=this.pickAt(hand.pinch,hand.mmPerPx);
  this.reticles.push({x:hand.screen.pinch.x,y:hand.screen.pinch.y,closing:clamp((.8-hand.ratio)/.45,0,1),hit:!!hit});
  if(hit)this.candidate=hit;
 }
 private say(text:string,x:number,y:number,tone:Ack['tone']='ok'){this.acks.push({text,x,y,age:0,tone});if(this.acks.length>4)this.acks.shift();}
 private sounds:DrivetrainSound[]=[];
 /** Sounds raised outside a step's context; the engine drains them. */
 drain(){const s=this.sounds;this.sounds=[];return s;}
 private sound(s:DrivetrainSound){this.sounds.push(s);}

 // ---- Fist: the hand crank, or the linkage's crank ----
 private fist(hand:HandIn,t:Track):boolean{
  if(this.mode==='draw'){
   const m=this.match;if(!m)return false;
   const o=placeFit(m.fit,[0,0]),reach=m.linkage.a*Math.hypot(...m.fit.z);
   if(this.linkHand===null&&t.edge&&dist(hand.palm,o)<Math.max(reach+30,HIT_PX*hand.mmPerPx)){this.linkHand=hand.id;this.linkRef=Math.atan2(hand.palm[1]-o[1],hand.palm[0]-o[0]);this.linkFrom=this.linkTheta;this.crankAcc=0;this.crankLast=this.linkRef;this.sound({type:'pick'});}
   if(this.linkHand!==hand.id)return false;
   const a=Math.atan2(hand.palm[1]-o[1],hand.palm[0]-o[0]);this.crankAcc+=wrap(a-this.crankLast);this.crankLast=a;
   // The fit may have turned the linkage over; the hand still turns the crank the way it moves.
   this.linkTheta=this.linkFrom+this.crankAcc*(m.fit.mirror?-1:1)*this.linkDir;return true;
  }
  const reach=Math.max(HAND_CRANK+28,HIT_PX*hand.mmPerPx);
  if(this.crankHand===null&&t.edge&&dist(hand.palm,INPUT_AT)<reach){
   this.crankHand=hand.id;this.motor=0;this.crankRef=this.crankLast=Math.atan2(hand.palm[1]-INPUT_AT[1],hand.palm[0]-INPUT_AT[0]);this.crankAcc=0;this.crankFrom=this.theta;this.sound({type:'pick'});
   this.say('Turning the crank',hand.screen.palm.x,hand.screen.palm.y);
  }
  if(this.crankHand!==hand.id)return false;
  const a=Math.atan2(hand.palm[1]-INPUT_AT[1],hand.palm[0]-INPUT_AT[0]);this.crankAcc+=wrap(a-this.crankLast);this.crankLast=a;
  const next=this.crankFrom+this.crankAcc;
  if(this.sol.jammed||this.sol.broken){if(this.clock-this.jamNag>1.5){this.jamNag=this.clock;this.say(this.sol.broken?'It will not turn: a tooth is broken':'It will not turn: jammed',hand.screen.palm.x,hand.screen.palm.y,'warn');this.sound({type:'miss'});}this.crankFrom=this.theta;this.crankAcc=0;this.omega=0;return true;}
  const h=Math.max(1e-3,this.h);this.omega+=((next-this.theta)/h-this.omega)*.3;this.theta=next;return true;
 }
 private motorOn(dir:1|-1,hand:HandIn){
  const was=this.motor;this.motor=was===dir?0:dir;this.crankHand=null;
  this.say(this.motor===0?'Motor off':dir>0?'Motor on: 60 rpm':'Running backwards',hand.screen.palm.x,hand.screen.palm.y);this.sound({type:'mode'});
 }

 // ---- Pinch: pick, carry, snap ----
 /** What a pinch here would take: a tray tile or a part on the board. */
 private pickAt(p:V,mmPerPx:number):string|null{
  const pad=HIT_PX*mmPerPx;
  for(const t of this.tiles)if(Math.abs(p[0]-t.x)<Math.max(t.w/2,pad*.7)&&Math.abs(p[1]-t.y)<Math.max(t.h/2,pad*.7))return `tile:${t.id}`;
  if(this.mode!=='build')return null;
  const part=this.partAt(p,mmPerPx);return part===null?null:`part:${part}`;
 }
 /** The part whose hit shape is under a point; small linkage parts win over the gears they ride on. */
 partAt(p:V,mmPerPx:number,gearsOnly=false):number|null{
  const b=this.shown,pad=HIT_PX*mmPerPx;let best:number|null=null,score=Infinity;
  const consider=(id:number,d:number,r:number,bias:number)=>{const reach=Math.max(r,pad);if(d<reach){const s=d/reach+bias;if(s<score){score=s;best=id;}}};
  for(const q of b.parts){
   if(gearsOnly&&q.kind!=='gear')continue;
   if(q.kind==='gear')consider(q.id,dist(p,centre(b,q.shaft)),tipR(q.z)+4,-.15*q.layer);
   else if(q.kind==='hand')consider(q.id,dist(p,centre(b,q.shaft)),26,-1);
   else if(q.kind==='crank')consider(q.id,dist(p,centre(b,q.shaft)),q.throw+12,-.7);
   else if(q.kind==='slider')consider(q.id,dist(p,sliderAt(b,q,this.shownSol,this.theta).at),20,-.9);
   else if(q.kind==='rod'){const c=partOf(b,q.crank) as Crank,a=crankPin(b,c,this.shownSol.angle(c.id,this.theta)),e=rodEnd(b,q,this.shownSol,this.theta),d=segment(p,a,e);consider(q.id,d,10,-.8);}
  }
  return best;
 }
 private pinch(hand:HandIn,t:Track){
  const c=this.carry;
  if(c&&c.hand===hand.id){c.lost=0;c.at=hand.pinch;this.snapCarry();return;}
  if(t.edge){
   // A flicker: the same hand pinching again near what it just let go takes it back.
   if(c&&c.lost&&this.clock-c.lost<GRACE&&dist(c.at,hand.pinch)<REGRAB){c.hand=hand.id;c.lost=0;c.at=hand.pinch;this.snapCarry();return;}
   if(this.pull||this.stretch)return;
   if(c){this.say('One part at a time',hand.screen.pinch.x,hand.screen.pinch.y,'miss');this.sound({type:'miss'});return;}
   const hit=this.pickAt(hand.pinch,hand.mmPerPx);
   if(!hit){this.say(this.mode==='build'?'Nothing to pick here. Pinch a part in the tray':'Pinch is for building. Back to build is in the tray',hand.screen.pinch.x,hand.screen.pinch.y,'miss');this.sound({type:'miss'});return;}
   if(this.mode==='build'&&this.explodeU>.5&&hit.startsWith('part:')){this.say('Hold 🖐 to put it back together first',hand.screen.pinch.x,hand.screen.pinch.y,'miss');this.sound({type:'miss'});return;}
   if(hit.startsWith('tile:'))this.tile(hit.slice(5),hand);
   else this.pending={hand:hand.id,part:Number(hit.slice(5)),t:this.clock,p0:hand.pinch};
   return;
  }
  const p=this.pending;
  // A board part waits a moment, so a second pinch can make it a pull-apart instead of a move.
  if(p&&p.hand===hand.id&&(this.clock-p.t>HOLD.pick||dist(p.p0,hand.pinch)>6)){this.pending=null;this.lift(p.part,hand);}
 }
 private tile(id:string,hand:HandIn){
  const t=this.tiles.find(x=>x.id===id);if(!t)return;
  if(t.item){this.carry={hand:hand.id,item:{...t.item},at:hand.pinch,snap:null,from:null,origin:null,lost:0};this.snapCarry();this.sound({type:'pick'});return;}
  if(id==='next')this.setBrief(this.brief+1);
  else if(id==='draw'||id==='build')this.setMode(id==='draw'?'draw':'build');
  this.say(t.label,hand.screen.pinch.x,hand.screen.pinch.y);this.sound({type:'mode'});
 }
 private lift(id:number,hand:HandIn){
  const part=partOf(this.build,id);if(!part)return;
  const from=cloneBuild(this.build),gone=remove(this.build,id);this.changed();
  this.carry={hand:hand.id,item:itemOf(part),at:hand.pinch,snap:null,from,origin:part,lost:0};this.snapCarry();this.sound({type:'pick'});
  if(gone.length>1)this.say(`Lifted, with ${gone.length-1} part${gone.length>2?'s':''} riding on it`,hand.screen.pinch.x,hand.screen.pinch.y);
 }
 private snapCarry(){
  const c=this.carry!,cap=Math.max(16,HIT_PX*this.world.mmPerPx(c.at)*.8);
  c.snap=c.item.kind==='gear'?snapGear(this.build,c.item.z!,c.at[0],c.at[1],cap):snapLink(this.build,c.item,c.at[0],c.at[1],cap,this.sol,this.theta);
 }
 private lostHand(id:number){
  if(this.carry?.hand===id&&!this.carry.lost)this.carry.lost=this.clock||1e-6;
  if(this.pending?.hand===id)this.pending=null;
  if(this.crankHand===id)this.crankHand=null;if(this.linkHand===id)this.linkHand=null;
  if(this.drawing===id)this.endStroke();
  if(this.stretch&&(this.stretch.a===id||this.stretch.b===id))this.endStretch();
  if(this.pull&&(this.pull.a===id||this.pull.b===id))this.endPull();
 }
 /** A carry whose hand stopped pinching lets go after the grace. */
 private endCarries(){
  const c=this.carry;if(!c)return;
  const t=this.tracks.get(c.hand);
  if(t&&t.pose==='pinch'){c.lost=0;return;}
  if(!c.lost)c.lost=this.clock||1e-6;
  if(this.clock-c.lost<GRACE)return;
  this.carry=null;const s=c.snap,screen=this.world.boardToScreen(c.at[0],c.at[1]);
  if(s?.ok){const before=c.from??cloneBuild(this.build);const id=place(this.build,c.item,s);this.changed();this.remember(before,c.origin?'Moved':'Placed',false);this.sound({type:'clink'});this.say(s.reason,screen.x,screen.y);void id;return;}
  if(c.from){
   if(s?.reason==='Back to the tray'){this.remember(c.from,`Took off the ${label(c.origin!)}`,true);this.say(`${label(c.origin!)} back in the tray. 👎 undoes`,screen.x,screen.y);this.sound({type:'undo'});return;}
   this.build=c.from;this.changed();this.say(`${s?.reason??'Cannot go there'}: put back`,screen.x,screen.y,'miss');this.sound({type:'miss'});return;
  }
  this.say(s?.reason==='Back to the tray'?'Back in the tray':`${s?.reason??'Cannot go there'}`,screen.x,screen.y,'miss');this.sound({type:'miss'});
 }

 // ---- Point: inspect, and the power path ----
 private inspectAt(hand:HandIn){
  this.pathOn=true;this.hover=this.partAt(hand.tip,hand.mmPerPx);
 }
 inspect(p:Part):{title:string;detail:string}{
  const s=this.shownSol,r=s.ratio(p.id),rpm=Math.round(r*60*10)/10,b=this.shown,body=s.bodies.get(bodyKey(b,p)),torque=body?.torque??0,way=r>0?'same way as the input':r<0?'reversed':'not driven';
  const sp=`${fraction(r)} · ${Math.abs(rpm)} rpm at 60 in, ${way}`;
  if(p.kind==='gear'){
   const load=s.loads.find(l=>l.mesh.a===p.id||l.mesh.b===p.id),use=load?Math.round(load.use*100):0;
   return {title:`${p.z}T ${p.steel?'steel idler':'brass gear'}${p.keyed?'':' · free'}${p.broken>=0?' · broken tooth':''}`,detail:`${sp} · ${torque.toFixed(2)} N·m · tooth load ${use}% of ${Math.round(toothStrength(p.z))} N`};
  }
  if(p.kind==='hand')return {title:'Output hand',detail:`${sp} · carries ${this.loads.hand} N·m`};
  if(p.kind==='crank')return {title:`Crank, ${p.throw} mm throw`,detail:`${sp} · ${2*p.throw} mm stroke`};
  if(p.kind==='rod')return {title:'Connecting rod',detail:`${ROD_LENGTH} mm between pins`};
  const at=sliderAt(b,p,s,this.theta);return {title:'Slider',detail:`${at.stroke} mm stroke · ${Math.abs(Math.round(r*60))} strokes a minute`};
 }
 anchor(p:Part):V{
  const b=this.shown;
  if(p.kind==='gear'){const c=centre(b,p.shaft);return [c[0]+tipR(p.z)*.7,c[1]+tipR(p.z)*.7];}
  if(p.kind==='hand'||p.kind==='crank')return centre(b,p.shaft);
  if(p.kind==='slider')return sliderAt(b,p,this.shownSol,this.theta).at;
  return rodEnd(b,p,this.shownSol,this.theta);
 }
 private toWorld(at:V){return this.world.boardWorld(at);}

 // ---- Victory: free a gear from its shaft, or key it back ----
 private victory(hand:HandIn,t:Track){
  if(this.mode==='draw'){this.held(hand,t,HOLD.victory,'✌️','Clear drawing',()=>this.clearDrawing(hand));return;}
  if(t.edge){
   const b=this.build,pad=HIT_PX*hand.mmPerPx;let best:number|null=null,bd=Infinity;
   for(const s of b.shafts){const on=gearsOn(b,s.id);if(on.length<2)continue;const d=dist(hand.tip,[s.x,s.y]);if(d<Math.max(pitchR(on[on.length-1].z),pad)&&d<bd){bd=d;best=s.id;}}
   t.target=best;
   if(best===null){t.done=true;this.say('✌️ slices a compound shaft: point it at a shaft with two gears',hand.screen.tip.x,hand.screen.tip.y,'miss');this.sound({type:'miss'});return;}
  }
  if(t.target===null)return;
  const top=gearsOn(this.build,t.target as number).at(-1)!;
  this.held(hand,t,HOLD.victory,'✌️',top.keyed?`Free the ${top.z}T`:`Key the ${top.z}T`,()=>{
   const before=cloneBuild(this.build),g=partOf(this.build,top.id) as Gear;g.keyed=!g.keyed;this.changed();
   this.remember(before,g.keyed?`Keyed the ${g.z}T`:`Freed the ${g.z}T`,true);this.sound({type:'free'});
   this.say(g.keyed?`Keyed: the ${g.z}T turns with its shaft`:`Freed: the ${g.z}T spins on its own, an idler. 👎 undoes`,hand.screen.tip.x,hand.screen.tip.y);
  });
 }

 // ---- Open: explode to the side ----
 private explode(){this.exploded=!this.exploded;this.sound({type:'mode'});}

 // ---- Two fists: stretch a gear's teeth or a crank's throw ----
 private twoFists(list:HandIn[],taken:Set<number>){
  const f=list.filter(x=>x.pose==='fist'&&x.id!==this.crankHand&&x.id!==this.linkHand).sort((a,b)=>a.id-b.id);
  const st=this.stretch;
  if(st){
   const a=f.find(x=>x.id===st.a),b=f.find(x=>x.id===st.b);
   if(!a||!b){this.endStretch();return;}
   taken.add(a.id);taken.add(b.id);this.stretching(dist(a.palm,b.palm),a,b);return;
  }
  if(f.length<2||this.mode!=='build')return;
  const [a,b]=f,ta=this.tracks.get(a.id)!,tb=this.tracks.get(b.id)!;
  if(!ta.edge&&!tb.edge)return;
  const mid:V=[(a.palm[0]+b.palm[0])/2,(a.palm[1]+b.palm[1])/2],pad=HIT_PX*a.mmPerPx;
  let target:number|null=null,bd=Infinity;
  for(const p of this.build.parts){
   if(p.kind!=='gear'&&p.kind!=='crank')continue;
   const c=centre(this.build,p.shaft),r=p.kind==='gear'?tipR(p.z):p.throw+12,d=Math.min(dist(mid,c),Math.abs(dist(a.palm,c)-r)+Math.abs(dist(b.palm,c)-r));
   if(d<Math.max(r+pad,pad*2)&&d<bd){bd=d;target=p.id;}
  }
  if(target===null)return;
  const p=partOf(this.build,target)!;
  this.stretch={a:a.id,b:b.id,target,d0:Math.max(20,dist(a.palm,b.palm)),z0:p.kind==='gear'?p.z:(p as Crank).throw,base:cloneBuild(this.build),sol:this.sol,valid:true};
  taken.add(a.id);taken.add(b.id);this.sound({type:'pick'});
 }
 private stretching(d:number,a:HandIn,b:HandIn){
  const st=this.stretch!,preview=cloneBuild(st.base),p=partOf(preview,st.target)!,k=d/st.d0;
  if(p.kind==='gear'){
   const z=clamp(Math.round(st.z0*k),Z_MIN,Z_MAX);
   if(z!==p.z){p.z=z;this.sound({type:'tooth'});}
   respace(preview,st.sol);
  }else if(p.kind==='crank')p.throw=clamp(Math.round(st.z0*k),THROW_MIN,THROW_MAX);
  st.valid=!anyClash(preview);
  this.preview(preview);
  const mx=(a.screen.palm.x+b.screen.palm.x)/2,my=(a.screen.palm.y+b.screen.palm.y)/2;
  this.rings.push({x:mx,y:my,p:1,glyph:'✊✊',label:p.kind==='gear'?`${p.z} teeth${st.valid?'':' · clashes'}`:`${(p as Crank).throw} mm throw · ${2*(p as Crank).throw} mm stroke`});
 }
 private endStretch(){
  const st=this.stretch;if(!st)return;this.stretch=null;
  const now=this.shown,p=partOf(now,st.target),was=partOf(st.base,st.target);this.preview(null);
  if(!p||!was)return;
  const changed=p.kind==='gear'?p.z!==(was as Gear).z:(p as Crank).throw!==(was as Crank).throw;
  if(!changed)return;
  const at=this.world.boardToScreen(...centre(now,(p as Gear).shaft));
  if(!st.valid){this.say('That size clashes with a neighbour: left as it was',at.x,at.y,'miss');this.sound({type:'miss'});return;}
  this.build=now;this.changed();this.remember(st.base,p.kind==='gear'?`${(was as Gear).z}T stretched to ${p.z}T`:`Throw set to ${(p as Crank).throw} mm`,true);
  this.say(p.kind==='gear'?`Now ${p.z} teeth; its neighbours re-spaced. 👎 undoes`:`Throw ${(p as Crank).throw} mm: a ${2*(p as Crank).throw} mm stroke. 👎 undoes`,at.x,at.y);this.sound({type:'clink'});
 }

 // ---- Two pinches: pull a meshed pair apart ----
 private twoPinches(list:HandIn[]){
  const pinches=list.filter(x=>x.pose==='pinch').sort((a,b)=>a.id-b.id);const pl=this.pull;
  if(pl){
   const a=pinches.find(x=>x.id===pl.a),b=pinches.find(x=>x.id===pl.b);
   if(!a||!b){this.endPull();return;}
   const sep=dist(a.pinch,b.pinch)-pl.d0;pl.sep=sep;
   const preview=cloneBuild(pl.base),move=Math.max(0,sep);
   for(const id of pl.shafts){const s=preview.shafts.find(x=>x.id===id);if(s){s.x+=pl.dir[0]*move;s.y+=pl.dir[1]*move;}}
   this.preview(preview);
   const mx=(a.screen.pinch.x+b.screen.pinch.x)/2,my=(a.screen.pinch.y+b.screen.pinch.y)/2;
   this.rings.push({x:mx,y:my,p:clamp(sep/PULL_APART,0,1),glyph:'🤏🤏',label:sep>=PULL_APART?'Let go to separate':'Pull apart'});
   return;
  }
  if(pinches.length<2||this.mode!=='build'||this.carry)return;
  const [a,b]=pinches,ta=this.tracks.get(a.id)!,tb=this.tracks.get(b.id)!;
  if(!ta.edge&&!tb.edge&&!this.pending)return;
  this.pending=null;
  const ga=this.gearAt(a),gb=this.gearAt(b);
  const m=ga!==null&&gb!==null?this.sol.meshes.find(x=>(x.a===ga&&x.b===gb)||(x.a===gb&&x.b===ga)):undefined;
  if(!m){if(ta.edge||tb.edge){this.say('🤏🤏 pulls apart two gears in mesh: pinch one with each hand',(a.screen.pinch.x+b.screen.pinch.x)/2,(a.screen.pinch.y+b.screen.pinch.y)/2,'miss');this.sound({type:'miss'});}return;}
  const ka=this.sol.bodies.get(m.ka)!,kb=this.sol.bodies.get(m.kb)!,moveB=kb.depth>=ka.depth&&!(kb.reached&&!ka.reached);
  const moving=moveB?m.b:m.a,fixed=moveB?m.a:m.b,mk=moveB?m.kb:m.ka;
  const mg=partOf(this.build,moving) as Gear,fg=partOf(this.build,fixed) as Gear,mc=centre(this.build,mg.shaft),fc=centre(this.build,fg.shaft),d=dist(mc,fc);
  if(this.build.shafts.find(s=>s.id===mg.shaft)?.input){this.say('The input shaft stays put',a.screen.pinch.x,a.screen.pinch.y,'miss');return;}
  this.pull={a:a.id,b:b.id,moving,fixed,d0:dist(a.pinch,b.pinch),base:cloneBuild(this.build),sol:this.sol,sep:0,shafts:subtreeShafts(this.build,this.sol,mk),dir:[(mc[0]-fc[0])/d,(mc[1]-fc[1])/d]};
  this.sound({type:'pick'});
 }
 private gearAt(hand:HandIn):number|null{return this.partAt(hand.pinch,hand.mmPerPx,true);}
 private endPull(){
  const pl=this.pull;if(!pl)return;this.pull=null;const now=this.shown;this.preview(null);
  const g=partOf(pl.base,pl.moving) as Gear,at=this.world.boardToScreen(...centre(pl.base,g.shaft));
  if(pl.sep<PULL_APART){this.say('Pull further to separate them',at.x,at.y,'miss');this.sound({type:'miss'});return;}
  if(anyClash(now)){this.say('No room there: left meshed',at.x,at.y,'miss');this.sound({type:'miss'});return;}
  this.build=now;this.changed();this.remember(pl.base,`Pulled the ${g.z}T out of mesh`,true);
  this.say(`Out of mesh: the ${g.z}T and all it drove stop. 👎 undoes`,at.x,at.y);this.sound({type:'tear'});
 }

 // ---- Clap: overload, or a leg ----
 private clap(list:HandIn[]){
  const x=list.length?list.reduce((s,h)=>s+h.screen.palm.x,0)/list.length:this.world.boardToScreen(0,0).x,y=list.length?list.reduce((s,h)=>s+h.screen.palm.y,0)/list.length:200;
  if(this.mode==='draw'){this.toggleLeg(x,y);return;}
  const sol=this.sol;
  if(!sol.loads.length){this.say('👐 Nothing to overload yet: mesh two gears and add a load',x,y,'miss');this.sound({type:'miss'});return;}
  if(sol.broken||sol.jammed){this.say('Already stuck: 👎 or Recenter first',x,y,'miss');this.sound({type:'miss'});return;}
  const worst=sol.loads.reduce((p,q)=>q.use>p.use?q:p),use=worst.use*SHOCK,gear=partOf(this.build,worst.weak) as Gear,broke=use>1;
  this.spike={age:0,gear:gear.id,use,broke,at:worst.mesh.at};
  if(!broke){this.survived=this.version;this.say(`Held a ${SHOCK}× shock: the weakest tooth, on the ${gear.z}T, reached ${Math.round(use*100)}%`,x,y);this.sound({type:'held'});return;}
  const before=cloneBuild(this.build),g=partOf(this.build,gear.id) as Gear,angle=this.sol.angle(g.id,this.theta),toward=Math.atan2(worst.mesh.at[1]-centre(this.build,g.shaft)[1],worst.mesh.at[0]-centre(this.build,g.shaft)[0]);
  g.broken=((Math.round(wrap(toward-angle)/(TAU/g.z))%g.z)+g.z)%g.z;this.motor=0;this.omega=0;this.changed();
  this.remember(before,`A tooth broke off the ${g.z}T`,true);
  this.say(`Overload: a tooth snapped off the ${g.z}T at ${Math.round(use*100)}% of its strength. 👎 or Recenter repairs`,x,y,'warn');this.sound({type:'break'});
 }

 // ---- Edits and history ----
 private preview(b:Build|null){this.shown=b??this.build;this.shownSol=b?solve(b,this.loads):this.sol;}
 private changed(){this.version++;this.sol=solve(this.build,this.loads);this.preview(null);}
 private remember(before:Build,label:string,destructive:boolean){this.history.push({build:before,label,at:this.clock,destructive,kind:'build'});if(this.history.length>30)this.history.shift();this.caption=label;}
 undoable(){const last=this.history.at(-1);return !!last&&last.destructive&&this.clock-last.at<UNDO_WINDOW&&(last.kind==='draw')===(this.mode==='draw');}
 get undoLabel(){return this.undoable()?this.history.at(-1)!.label:'';}
 undo(hand?:HandIn){
  const last=this.history.pop();if(!last)return false;
  if(last.kind==='draw'&&last.draw)Object.assign(this,{stroke:last.draw.stroke,closed:last.draw.closed,matches:last.draw.matches,matchIndex:last.draw.index,leg:last.draw.leg,trace:[]});
  else{this.build=last.build;this.changed();}
  if(hand)this.say(`Undone: ${last.label.toLowerCase()}`,hand.screen.palm.x,hand.screen.palm.y);this.sound({type:'undo'});return true;
 }
 /** Recenter repairs: a broken tooth first, else the last destructive change. */
 restore(){
  let i=-1;this.history.forEach((x,n)=>{if(/tooth broke/.test(x.label))i=n;});
  if(i>=0&&this.sol.broken){this.build=this.history[i].build;this.history.splice(i);this.changed();this.sound({type:'undo'});return;}
  const last=this.history.at(-1);if(last?.destructive)this.undo();
 }
 setBrief(n:number){this.brief=clamp(n,0,briefs.length-1);const b=briefs[this.brief];this.loads={hand:b.load,slider:b.push};this.build=emptyBuild();this.history=[];this.motor=0;this.omega=0;this.metAt=-Infinity;this.lastMet=false;this.changed();this.judgeNow();}
 setMode(m:Mode){if(m==='draw'&&!this.atlas&&typeof setTimeout!=='undefined')setTimeout(()=>{this.atlas??=Atlas.build();},60);this.mode=m;this.carry=null;this.pending=null;this.stretch=null;this.pull=null;this.preview(null);this.motor=0;this.crankHand=this.linkHand=null;}
 private judgeNow(){
  this.verdict=judge(this.current,this.build,this.sol,this.survived===this.version);
  if(this.verdict.met&&!this.lastMet){this.metAt=this.clock;this.sound({type:'met'});}
  this.lastMet=this.verdict.met;
 }
 get metFor(){return this.verdict.met?this.clock-this.metAt:-1;}
 restart(){this.build=emptyBuild();this.history=[];this.theta=this.omega=this.motor=0;this.carry=this.pending=null;this.stretch=this.pull=null;this.spike=null;this.exploded=false;this.schematic=false;this.clearDraw();this.changed();}
 private calm(){this.crankHand=this.linkHand=null;if(this.stretch)this.endStretch();if(this.pull){this.pull=null;this.preview(null);}if(this.carry){const c=this.carry;this.carry=null;if(c.from){this.build=c.from;this.changed();}}if(this.drawing!==null)this.endStroke();}

 // ---- Mouse: the same picks and drops, with no grace needed ----
 pointerDown(p:V,mmPerPx:number):boolean{
  const hit=this.pickAt(p,mmPerPx);if(!hit)return false;
  const fake:HandIn={id:-1,pose:'pinch',pinch:p,tip:p,palm:p,ratio:0,speed:0,screen:{pinch:this.world.boardToScreen(...p),tip:this.world.boardToScreen(...p),palm:this.world.boardToScreen(...p)},mmPerPx};
  if(hit.startsWith('tile:'))this.tile(hit.slice(5),fake);else if(this.mode==='build'&&this.explodeU<.5)this.lift(Number(hit.slice(5)),fake);
  if(this.carry)this.tracks.set(-1,{pose:'pinch',t:0,edge:false,done:false,target:null,prev:'none'});
  return true;
 }
 pointerMove(p:V){if(this.carry?.hand===-1){this.carry.at=p;this.snapCarry();}}
 pointerUp(){if(this.carry?.hand===-1){this.tracks.delete(-1);this.carry.lost=-GRACE*2;this.endCarries();}}

 // ---- Drawing the motion ----
 private drawPoint(hand:HandIn,t:Track){
  if(this.drawing===hand.id){this.drawLost=0;const last=this.stroke.at(-1)!;if(dist(last,hand.tip)>2.5)this.stroke.push(hand.tip);
   if(this.stroke.length>24&&pathLength(this.stroke,false)>140&&dist(hand.tip,this.stroke[0])<18)this.endStroke(true);return;}
  if(this.drawing!==null||t.done)return;
  this.held(hand,t,HOLD.point,'☝️','Draw',()=>{
   if(this.stroke.length)this.history.push({build:this.build,label:'Cleared the drawing',at:this.clock,destructive:true,kind:'draw',draw:this.drawState()});
   this.clearDraw();this.drawing=hand.id;this.drawLost=0;this.stroke=[hand.tip];this.sound({type:'draw'});
  });
 }
 private endStroke(closedByHand=false){
  if(this.drawing===null)return;this.drawing=null;this.drawLost=0;
  const len=pathLength(this.stroke,false),at=this.world.boardToScreen(...(this.stroke.at(-1)??[0,0]));
  if(len<80||this.stroke.length<12){this.stroke=[];this.say('Too short: draw a loop in the air',at.x,at.y,'miss');this.sound({type:'miss'});return;}
  this.closed=true;this.say(closedByHand?'Closed. Hold 👍 to find a linkage':'Closed for you. Hold 👍 to find a linkage',at.x,at.y);this.sound({type:'clink'});
 }
 private drawState():DrawState{return {stroke:this.stroke,closed:this.closed,matches:this.matches,index:this.matchIndex,leg:this.leg};}
 private clearDraw(){this.stroke=[];this.closed=false;this.matches=[];this.matchIndex=0;this.trace=[];this.leg=null;this.drawing=null;}
 private clearDrawing(hand:HandIn){
  if(!this.stroke.length){this.say('Nothing drawn yet',hand.screen.tip.x,hand.screen.tip.y,'miss');return;}
  this.history.push({build:this.build,label:'Cleared the drawing',at:this.clock,destructive:true,kind:'draw',draw:this.drawState()});this.clearDraw();this.say('Cleared. 👎 brings it back',hand.screen.tip.x,hand.screen.tip.y);this.sound({type:'slice'});
 }
 searching=false;
 /** The hold is acknowledged on this frame; the search runs on the next, so the screen never sits silent through it. */
 private search(hand:HandIn){
  if(!this.closed){this.synthesise(hand);return;}
  this.searching=true;this.say('Searching 6,000 four-bars…',hand.screen.palm.x,hand.screen.palm.y);
  setTimeout(()=>{this.searching=false;this.synthesise(hand);},40);
 }
 /** Atlas search, then refinement; the top three stay for cycling. */
 synthesise(hand?:HandIn){
  const at=hand?hand.screen.palm:this.world.boardToScreen(0,0);
  if(!this.closed){this.say('Draw a closed loop with ☝️ first',at.x,at.y,'miss');this.sound({type:'miss'});return false;}
  this.atlas??=Atlas.build();
  this.matches=this.atlas.match(this.stroke,3,undefined,undefined,STAGE);this.matchIndex=0;this.trace=[];this.leg=null;this.linkTheta=0;this.linkDir=1;
  const m=this.match;if(!m){this.say('No linkage found for that',at.x,at.y,'miss');return false;}
  this.say(`Four-bar found: fits within ${fitPercent(m.err)}%`,at.x,at.y);this.sound({type:'match'});return true;
 }
 private cycle(){
  if(!this.matches.length){this.say('Draw a loop, then hold 👍 to find linkages to cycle',this.world.boardToScreen(0,0).x,300,'miss');return;}
  this.matchIndex=(this.matchIndex+1)%this.matches.length;this.trace=[];this.leg=null;this.sound({type:'match'});
 }
 private toggleLeg(x:number,y:number){
  if(this.leg){this.leg=null;this.say('Leg off',x,y);return;}
  const m=this.match;if(!m){this.say('👐 chains a leg onto a linkage: find one first',x,y,'miss');this.sound({type:'miss'});return;}
  const path=Array.from({length:64},(_,i)=>this.linkPose(i/64*TAU)?.P).filter((p):p is V=>!!p),found=chainLeg(path,7,WORK);
  if(!found){this.say('No leg fits this curve',x,y,'miss');return;}
  this.leg=found.leg;this.say('A second linkage chained on: the foot walks, flat along the ground',x,y);this.sound({type:'clink'});
 }
 /** The current linkage at a crank angle, in board millimetres. */
 linkPose(theta=this.linkTheta){
  const m=this.match;if(!m)return null;
  const s=pose(m.linkage,m.fit.reverse?-theta:theta);if(!s)return null;
  const f=(p:V)=>placeFit(m.fit,p);
  return {O2:f([0,0]),O4:f([m.linkage.g,0]),A:f(s.A),B:f(s.B),P:f(s.P)};
 }
 legPose(theta=this.linkTheta){const l=this.leg,s=this.linkPose(theta);if(!l||!s)return null;const r=legPose(s.P,l);return r?{...r,G:l.G,P:s.P}:null;}
 private advanceDraw(h:number){
  if(!this.match||this.linkHand!==null)return;
  this.linkTheta+=h*TAU*.4*this.linkDir;
  const s=this.linkPose();if(s){this.trace.push(s.P);if(this.trace.length>160)this.trace.shift();}
 }
}
const segment=(p:V,a:V,b:V)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l,0,1):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
export const label=(p:Part)=>p.kind==='gear'?`${p.z}T`:p.kind==='crank'?'crank':p.kind==='hand'?'hand':p.kind==='rod'?'rod':'slider';
/** A fit's residual as a share of the drawing's size. */
export const fitPercent=(err:number)=>Math.max(.1,Math.round(Math.sqrt(Math.max(0,err))*1000)/10);
export {LAYERS,PEG,centreDistance};
