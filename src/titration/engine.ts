import type {GestureFrame,MirrorDriver,MirrorViewState,MirrorWorld,TrackedHand,WorldPoint} from '../mirror/contracts';
import {MAX_RATE,handRoll,pourRate,wrapAngle} from '../organ/accord';
import {Lab,POUR_MAX} from './lab';
import {ACID_VOLUME,DROP,SwirlDetector,tapFromTurn,type IndicatorId} from './model';
import {ACID,FLASK,FUNNEL,GOGGLES_TOP,TAP,dist,propById,props,reach} from './props';
import type {AckView,PropView,TitrationOutput,TitrationScene,TitrationSound,ZoneView} from './contracts';

/** An open hand turned like a stopcock key; a fist going round swirls the flask. A gripped flask often shows the thumb up, so that counts as a fist while swirling. */
const TAP_TAU=.08,SWIRL_FULL=1.5,SWIRL_RADIUS=.25,TILT_TAU=.08;
/** Seconds a let-go pinch waits for the hand to close again nearby, and how near, in scene units. */
const GRACE=.25,REATTACH=1.4;
/** Seconds a held thumbs up confirms, and how long while swirling. Palm speed under this counts as still. */
const THUMB_HOLD=.5,THUMB_HOLD_RUN=1,STILL=.3;
const ACK_LIFE=1.7,MOUSE_TILT=.75,MOUSE_DWELL=.25,KICK=.15;
const upright=-Math.PI/2;
const labels:Record<string,string>={goggles:'Goggles',bottle:'Sodium hydroxide','dropper-phenolphthalein':'Phenolphthalein','dropper-methyl-orange':'Methyl orange','dropper-universal':'Universal indicator',pipette:'25.0 cm3 pipette'};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));

interface Held {id:string;hand:number;x:number;y:number;tilt:number;rest:number;releasedAt:number;dwell:number}
const names:Record<string,IndicatorId>={'dropper-phenolphthalein':'phenolphthalein','dropper-methyl-orange':'methyl-orange','dropper-universal':'universal'};

export class TitrationEngine implements MirrorDriver<TitrationOutput> {
 lab:Lab;
 /** Demo mode: the simulation waits while paused, runs `simSpeed` times faster, and ignores the mouse and hands while locked. */
 paused=false;simSpeed=1;demoLock=false;
 idle=false;readonly position=0;readonly speed=0;
 held:Held[]=[];
 /** The dropper chosen from the keyboard. */
 keyChoice:IndicatorId|null=null;
 private readonly swirler=new SwirlDetector(800,SWIRL_RADIUS);
 private source:'ui'|'hand'='ui';private sounds:TitrationSound[]=[];private lastDrop=0;private t=0;
 private placed=new Map<string,{x:number;y:number}>();
 private locked=new Set<number>();
 private tapDrag:{x:number;tap:number}|null=null;private mouseSwirl=false;
 private kickPour=0;private kickTap:{left:number;value:number}|null=null;
 private thumbSince=new Map<number,number>();private thumbFired=new Set<number>();
 private acks:AckView[]=[];private ackId=0;private ackKeys=new Map<string,number>();
 private cursors:{x:number;y:number;pinch:boolean}[]=[];
 /** The wrist turn the hand is making now, in radians, or null with no open hand. Read by tests. */
 turn:number|null=null;
 swirlLevel=0;
 /** Set by the page: the engine asks it to open the notebook or show a hint. */
 ui:(command:'notebook'|'hint')=>void=()=>{};
 constructor(private readonly world:MirrorWorld,seed=Date.now()%1e9){this.lab=new Lab(seed);}
 get bench(){return this.lab.bench;}
 get activeAcks(){return this.acks;}
 /** The scene of the latest step. Read by tests. */
 scene:TitrationScene|null=null;
 /** Start a fresh session at the bench, optionally with a fixed seed. */
 restart(seed=Date.now()%1e9){
  this.lab=new Lab(seed);this.lastDrop=0;this.source='ui';this.swirler.reset();this.held=[];this.placed.clear();this.locked.clear();
  this.tapDrag=null;this.mouseSwirl=false;this.keyChoice=null;this.acks=[];this.kickPour=0;this.kickTap=null;this.paused=false;this.simSpeed=1;this.demoLock=false;
 }
 seek(_:number){}
 /** Space and thumbs up: shut an open tap, otherwise carry on. */
 kick(direction:1|-1){if(direction>0)this.confirm();else this.closeTap();}
 reset(){this.closeTap();this.swirler.reset();this.swirlLevel=0;}
 cue(sound:TitrationSound['type']){this.sounds.push({type:sound} as TitrationSound);}

 // ---- What the student can do without hands: each of these is a button and a key too.
 confirm(){
  const l=this.lab;
  if(l.tapAllowed&&this.bench.tap>0){this.closeTap();return;}
  if(l.quiz){if(l.quiz.right){l.closeQuiz();this.cue('step');}return;}
  if(l.advanceLine())return;
  if(l.readingPhase)this.confirmReading();
  else if(l.phase==='run')l.endPoint();
  else if(l.finished)this.ui('notebook');
 }
 confirmReading(){const ok=this.lab.submitReading();this.cue(ok?'done':'alert');return ok;}
 closeTap(){this.source='ui';this.bench.setTap(0);}
 /** The mouse, keyboard and buttons all come through here and win over a hand that has gone. */
 setTap(value:number){this.source='ui';if(this.lab.tapAllowed)this.bench.setTap(value);}
 tapBy(delta:number){this.setTap(this.bench.tap+delta);}
 drop(){
  const l=this.lab,b=this.bench;
  if(l.phase==='drain')l.drip();else if(l.phase==='run'&&b.dropOne())this.cue('drip');
 }
 swirlPulse(){this.bench.swirlPulse();}
 pourKey(){if(this.lab.phase==='pour')this.kickPour=KICK;}
 /** R: the rinse in two key presses, a pour and then a drain. */
 rinseKey(){const l=this.lab;if(l.id!=='rinse')return;if(l.phase==='pour')this.kickPour=.5;else this.kickTap={left:.9,value:1};}
 burstKey(){if(this.lab.id==='bubble')this.kickTap={left:.7,value:1};}
 pipetteKey(){const l=this.lab;if(l.id==='pipette'){l.pipetteFill=1;if(l.deliver())this.cue('done');}}
 choose(id:IndicatorId){
  this.keyChoice=id;this.ack(`${labels[`dropper-${id}`]} chosen. Press A for a drop.`,FLASK.x,FLASK.y+2,false,'choice');
 }
 addDrop(){
  const l=this.lab;if(l.id!=='indicator')return;
  if(!this.keyChoice)return this.ack('Choose a dropper first: 1, 2 or 3.',FLASK.x,FLASK.y+2,true,'choice');
  l.dropIndicator(this.keyChoice);this.cue('drip');
 }
 wear(){this.lab.wear();}

 // ---- Mouse: press on an object to take it, drag, let go. Press on the tap key or flask for those.
 private tryPick(hand:number,p:{x:number;y:number},rest=0,pad=.3){
  const live=this.lab.live();let best:{id:string;d:number}|null=null;
  for(const def of props){
   if(!live.includes(def.id)||this.held.some(g=>g.id===def.id)||!this.visible(def.id))continue;
   const at=this.placed.get(def.id)??def.home,d=reach(p,def,at);
   if(d<=def.r+pad&&(!best||d<best.d))best={id:def.id,d};
  }
  if(!best){return false;}
  this.held.push({id:best.id,hand,x:p.x,y:p.y,tilt:0,rest,releasedAt:-1,dwell:0});this.placed.delete(best.id);this.cue('step');
  return true;
 }
 pointerDown(p:WorldPoint){
  if(this.demoLock)return true;
  if(this.lab.quiz||this.lab.finished)return true;
  if(this.tryPick(-1,p))return true;
  if(this.lab.tapAllowed&&dist(p,TAP)<1.1){this.tapDrag={x:p.x,tap:.1};this.setTap(.1);return true;}
  if(this.lab.phase==='run'&&dist(p,FLASK)<2.2){this.mouseSwirl=true;this.swirler.reset();return true;}
  return true;
 }
 pointerMove(p:WorldPoint){
  const g=this.held.find(x=>x.hand===-1);if(g){g.x=p.x;g.y=p.y;}
  if(this.tapDrag)this.setTap(clamp(.1+Math.max(0,p.x-this.tapDrag.x)/2.2,.05,1));
  if(this.mouseSwirl){this.swirler.push(p.x,p.y,performance.now());this.swirlLevel=Math.min(1,this.swirler.rate()/SWIRL_FULL);}
 }
 pointerUp(){
  const g=this.held.find(x=>x.hand===-1);if(g)this.commit(g);
  if(this.tapDrag){this.tapDrag=null;this.closeTap();}
  if(this.mouseSwirl){this.mouseSwirl=false;this.swirler.reset();this.swirlLevel=0;}
 }
 hover(_:WorldPoint|null){}

 // ---- Hands.
 private roll(hand:TrackedHand){
  if(hand.landmarks.length<21)return null;
  const points=hand.landmarks.map(p=>{const w=this.world.mirrorToWorld(p);return {x:w.x*100,y:-w.y*100};});
  return handRoll(points);
 }
 private hands(frame:GestureFrame,dt:number){
  const list=frame.hands;
  this.cursors=list.map(h=>{const w=this.world.mirrorToWorld(h.pinch);return {x:w.x,y:w.y,pinch:h.pose==='pinch'};});
  // The tap: an open hand turned like a key.
  const open=list.find(h=>h.pose==='open'),roll=open?this.roll(open):null;
  if(open&&roll!==null&&this.lab.tapAllowed){
   this.turn=wrapAngle(roll-upright);
   const goal=tapFromTurn(this.turn),k=1-Math.exp(-dt/TAP_TAU);
   this.source='hand';this.bench.setTap(this.bench.tap+(goal-this.bench.tap)*k);
  }else{
   this.turn=open&&roll!==null?wrapAngle(roll-upright):null;
   if(this.source==='hand'){this.source='ui';this.bench.setTap(0);}
  }
  // Swirl: a fist going round.
  const fist=list.find(h=>h.pose==='fist'||h.pose==='thumbUp');
  if(fist){const w=this.world.mirrorToWorld(fist.palm);this.swirler.push(w.x,w.y,frame.at);this.swirlLevel=Math.min(1,this.swirler.rate()/SWIRL_FULL);}
  else if(!this.mouseSwirl){this.swirler.reset();this.swirlLevel=0;}
  // Pinch: pick up, carry, tilt, let go.
  for(const h of list)if(h.pose!=='pinch')this.locked.delete(h.id);
  for(const g of this.held){
   if(g.hand<0)continue;
   const h=list.find(x=>x.id===g.hand);
   if(h&&h.pose==='pinch'){g.releasedAt=-1;const w=this.world.mirrorToWorld(h.pinch);g.x=w.x;g.y=w.y;const r=this.roll(h);if(r!==null){const raw=wrapAngle(r-g.rest);g.tilt+=(raw-g.tilt)*(1-Math.exp(-dt/TILT_TAU));}}
   else if(g.releasedAt<0)g.releasedAt=this.t;
  }
  for(const h of list){
   if(h.pose!=='pinch'||this.locked.has(h.id)||this.held.some(g=>g.hand===h.id))continue;
   const w=this.world.mirrorToWorld(h.pinch);
   const loose=this.held.filter(g=>g.releasedAt>=0&&g.hand>=0).sort((a,b)=>dist(a,w)-dist(b,w))[0];
   if(loose&&dist(loose,w)<REATTACH){loose.hand=h.id;loose.releasedAt=-1;continue;}
   this.tryPick(h.id,w,this.roll(h)??0);
  }
  // A held thumbs up confirms: the same as Space.
  for(const h of list){
   const still=Math.hypot(h.velocity.x,h.velocity.y)<STILL,need=this.lab.phase==='run'?THUMB_HOLD_RUN:THUMB_HOLD;
   if(h.pose==='thumbUp'&&still){
    const since=this.thumbSince.get(h.id)??this.t;this.thumbSince.set(h.id,since);
    if(this.t-since>=need&&!this.thumbFired.has(h.id)){this.thumbFired.add(h.id);this.confirm();}
   }else{this.thumbSince.delete(h.id);this.thumbFired.delete(h.id);}
  }
 }

 // ---- What a held item does each frame, and when it is let go.
 private visible(id:string){
  const s=this.lab.id;
  if(id==='goggles')return s==='safety';
  if(id==='bottle')return s==='rinse'||s==='fill';
  if(id==='pipette')return this.lab.step>=4;
  return s==='indicator';
 }
 private mouth(g:Held){
  const def=propById(g.id),side=g.x>FUNNEL.x?1:-1,angle=side*Math.min(1.35,Math.abs(g.tilt));
  return {x:g.x-Math.sin(angle)*def.half,y:g.y+Math.cos(angle)*def.half,angle};
 }
 private tip(g:Held){return {x:g.x,y:g.y-propById(g.id).half};}
 private overFunnel(g:Held){const m=this.mouth(g);return Math.abs(m.x-FUNNEL.x)<1.4&&m.y>FUNNEL.y-.6&&m.y<FUNNEL.y+2.8;}
 private overFlask(p:{x:number;y:number}){return Math.abs(p.x-FLASK.x)<1.1&&p.y>FLASK.y-.8&&p.y<FLASK.y+3.2;}
 private overAcid(p:{x:number;y:number}){return Math.abs(p.x-ACID.x)<.9&&p.y<ACID.y+.2;}
 private pourMouth:{x:number;y:number}|null=null;
 private heldStep(dt:number){
  const l=this.lab;this.pourMouth=null;
  const live=l.live();
  for(const g of [...this.held]){
   if(!live.includes(g.id)){this.release(g);continue;}
   if(g.releasedAt>=0&&this.t-g.releasedAt>GRACE){this.commit(g);continue;}
   if(g.id==='goggles'&&g.y>GOGGLES_TOP){this.release(g);l.wear();this.cue('done');continue;}
   if(g.id==='bottle'){
    const zone=this.overFunnel(g);
    if(g.hand===-1){g.dwell=zone?g.dwell+dt:0;g.tilt+=((zone&&g.dwell>MOUSE_DWELL?MOUSE_TILT:0)-g.tilt)*(1-Math.exp(-dt/TILT_TAU));}
    const rate=g.releasedAt>=0?0:pourRate(g.tilt)/MAX_RATE*POUR_MAX;
    if(rate>.05&&zone){this.pourMouth=this.mouth(g);if(l.pour(rate,dt)){this.release(g);this.cue('done');continue;}}
    else if(rate>1&&!zone)this.ack('Bring it over the funnel to pour',g.x,g.y+1.4,true,'zone');
   }
   if(g.id==='pipette'&&this.overAcid(this.tip(g))){
    const before=l.pipetteFill;l.draw(dt);
    if(before<1&&l.pipetteFill>=1)this.ack('Full to the line',g.x,g.y+1.2,false,'full');
   }
  }
  if(this.kickPour>0){
   this.kickPour-=dt;
   if(l.phase==='pour'&&(l.id==='rinse'||l.id==='fill')){
    this.pourMouth={x:FUNNEL.x+.8,y:FUNNEL.y+1.4};
    if(l.pour(POUR_MAX*.6,dt))this.pourMouth=null;
   }
  }
  if(this.kickTap){this.kickTap.left-=dt;if(this.kickTap.left>0)this.setTap(this.kickTap.value);else{this.kickTap=null;this.closeTap();}}
  l.holding(this.held.find(g=>g.releasedAt<0)?.id??null);
 }
 /** Put an item back without judging it. */
 private release(g:Held){
  this.held=this.held.filter(x=>x!==g);this.placed.delete(g.id);
  if(g.hand>=0)this.locked.add(g.hand);
 }
 /** An item let go: judged where it is, then put back on the shelf unless it is a dropper hovering over the flask. */
 private commit(g:Held){
  this.held=this.held.filter(x=>x!==g);
  if(g.hand>=0)this.locked.add(g.hand);
  const l=this.lab;this.placed.delete(g.id);
  switch(g.id){
   case 'goggles':this.ack(g.y>GOGGLES_TOP-1.2?'Higher, to the top of the frame':'Lift them to the top of the frame',g.x,g.y+.8,true,'goggles');break;
   case 'bottle':l.bottleDown();break;
   case 'pipette':{
    const tip=this.tip(g);
    if(this.overFlask(tip)){if(l.deliver()){this.cue('done');}else this.ack('Not at the line yet',g.x,g.y+1.2,true,'full');}
    else if(l.phase==='deliver')this.ack('Open your hand over the flask',g.x,g.y+1.2,true,'full');
    break;
   }
   default:{
    const id=names[g.id];
    if(!id)break;
    if(this.overFlask(this.tip(g))){l.dropIndicator(id);this.cue('drip');this.placed.set(g.id,{x:g.x,y:g.y});this.ack('Drop',g.x,this.tip(g).y-.4,false,'drop');}
    else this.ack('Over the flask, please',g.x,g.y+1,true,'drop');
   }
  }
 }
 private ack(text:string,x:number,y:number,miss=false,key?:string){
  if(key){const old=this.ackKeys.get(key),i=this.acks.findIndex(a=>a.id===old);if(i>=0){if(this.acks[i].text===text&&this.acks[i].age<ACK_LIFE*.6){this.acks[i].x=x;this.acks[i].y=y;return;}this.acks.splice(i,1);}}
  const id=++this.ackId;if(key)this.ackKeys.set(key,id);
  this.acks.push({id,text,miss,x,y,age:0});if(this.acks.length>3)this.acks.shift();
 }

 // ---- Each frame.
 private propViews():PropView[]{
  const live=this.lab.live(),out:PropView[]=[];
  for(const def of props){
   if(!this.visible(def.id))continue;
   const g=this.held.find(x=>x.id===def.id),at=g??this.placed.get(def.id)??def.home;
   const tilt=g&&def.id==='bottle'?this.mouth(g).angle:0;
   out.push({id:def.id,x:at.x,y:at.y,tilt,glow:live.includes(def.id)?1:0,fill:def.id==='pipette'?this.lab.pipetteFill:0,label:labels[def.id]});
  }
  return out;
 }
 private zoneViews():ZoneView[]{
  const live=this.lab.live(),out:ZoneView[]=[];
  if(live.includes('funnel'))out.push({id:'funnel',x:FUNNEL.x,y:FUNNEL.y+.8,r:1.5});
  if(live.includes('acid'))out.push({id:'acid',x:ACID.x,y:ACID.y+.4,r:1.2});
  if(live.includes('flask'))out.push({id:'flask',x:FLASK.x,y:FLASK.y+.3,r:1.8});
  if(live.includes('tap'))out.push({id:'tap',x:TAP.x,y:TAP.y,r:.85});
  return out;
 }
 step(frame:GestureFrame,dt:number,_view:MirrorViewState,frozen:boolean):TitrationOutput{
  const h=Number.isFinite(dt)?clamp(dt,0,.05):0;this.t+=h;
  const l=this.lab,b=l.bench,before=b.drops+l.passed/DROP;
  if(!frozen&&!this.paused){
   if(this.demoLock)this.cursors=[];else{this.hands(frame,h);if(!frame.hands.length)this.cursors=[];}
   this.heldStep(h);
   if(l.phase==='run'&&!this.mouseSwirl&&!frame.hands.some(x=>x.pose==='fist'||x.pose==='thumbUp'))this.swirlLevel=0;
   b.setSwirl(this.swirlLevel);
   l.tick(h);
   for(let i=1;i<this.simSpeed;i++){this.heldStep(h);l.tick(h);}
  }
  const whole=Math.floor(b.drops+l.passed/DROP);
  if(whole>this.lastDrop&&before<b.drops+l.passed/DROP)this.sounds.push({type:'drip'});
  this.lastDrop=whole;
  const f=b.flask,tint=b.tint,local=b.localTint,flaskPresent=!!f||l.step>=4;
  const flowing=l.tapAllowed&&b.tap>0&&l.liquid&&(b.canFlow||l.phase==='drain'||l.id==='bubble');
  for(const a of this.acks)a.age+=h;this.acks=this.acks.filter(a=>a.age<ACK_LIFE);
  const scene:TitrationScene={
   reading:l.reading,filled:l.liquid,bubble:b.bubble&&b.filled,tap:flowing?b.tap:0,streaming:flowing&&b.tap>=.2,dropCount:whole,
   flask:{present:flaskPresent,volume:f?ACID_VOLUME+f.delivered:0,rgb:tint.rgb,alpha:tint.alpha,localRgb:local.rgb,localAlpha:f&&f.local>1e-4?local.alpha:0},
   swirl:Math.max(this.swirlLevel,b.swirlTimer>0?1:0),
   props:this.propViews(),zones:this.zoneViews(),station:l.station,pour:this.pourMouth,
   waste:Math.min(1,l.passed/14),acid:f||l.step>4?.6:1,cursors:this.cursors,acks:this.acks.map(a=>({...a})),
  };
  this.scene=scene;
  const sounds=this.sounds;this.sounds=[];
  return {scene,view:null,sounds,holding:false};
 }
}
