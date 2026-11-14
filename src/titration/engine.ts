import type {GestureFrame,MirrorDriver,MirrorViewState,MirrorWorld,TrackedHand,WorldPoint} from '../mirror/contracts';
import {handRoll,wrapAngle} from '../organ/accord';
import {Bench} from './bench';
import {ACID_VOLUME,SwirlDetector,tapFromTurn} from './model';
import type {TitrationOutput,TitrationScene,TitrationSound} from './contracts';

/** An open hand turned like a stopcock key; a fist going round swirls the flask. A gripped flask often shows the thumb up, so that counts as a fist. */
const TAP_TAU=.08,SWIRL_FULL=1.5,SWIRL_RADIUS=.25;
const upright=-Math.PI/2;

export class TitrationEngine implements MirrorDriver<TitrationOutput> {
 bench:Bench;
 idle=false;readonly position=0;readonly speed=0;
 private readonly swirler=new SwirlDetector(800,SWIRL_RADIUS);
 private source:'ui'|'hand'='ui';private sounds:TitrationSound[]=[];private lastDrop=0;
 /** The wrist turn the hand is making now, in radians, or null with no open hand. Read by tests. */
 turn:number|null=null;
 swirlLevel=0;focus=false;
 constructor(private readonly world:MirrorWorld,seed=Date.now()%1e9){this.bench=new Bench(seed);}
 /** Start a fresh session at the bench, optionally with a fixed seed. */
 restart(seed=Date.now()%1e9){this.bench=new Bench(seed);this.lastDrop=0;this.source='ui';this.swirler.reset();}
 seek(_:number){}
 /** Space on the stage shuts the stopcock. */
 kick(_:1|-1){this.setTap(0);}
 pointerDown(_:WorldPoint){return false;}
 pointerMove(_:WorldPoint){}
 pointerUp(){}
 hover(_:WorldPoint|null){}
 reset(){this.setTap(0);this.swirler.reset();this.swirlLevel=0;}
 cue(sound:TitrationSound['type']){this.sounds.push({type:sound} as TitrationSound);}
 /** The mouse, keyboard and sliders all come through here and win over a hand that has gone. */
 setTap(value:number){this.source='ui';this.bench.setTap(value);}
 private roll(hand:TrackedHand){
  if(hand.landmarks.length<21)return null;
  // handRoll expects pixels, so world units are scaled up.
  const points=hand.landmarks.map(p=>{const w=this.world.mirrorToWorld(p);return {x:w.x*100,y:-w.y*100};});
  return handRoll(points);
 }
 private hands(frame:GestureFrame,dt:number){
  const open=frame.hands.find(h=>h.pose==='open'),fist=frame.hands.find(h=>h.pose==='fist'||h.pose==='thumbUp');
  const roll=open?this.roll(open):null;
  if(open&&roll!==null){
   this.turn=wrapAngle(roll-upright);
   const goal=tapFromTurn(this.turn),k=1-Math.exp(-dt/TAP_TAU);
   this.source='hand';this.bench.setTap(this.bench.tap+(goal-this.bench.tap)*k);
  }else{
   this.turn=null;
   if(this.source==='hand'){this.source='ui';this.bench.setTap(0);}
  }
  if(fist){
   const w=this.world.mirrorToWorld(fist.palm);this.swirler.push(w.x,w.y,frame.at);
   this.swirlLevel=Math.min(1,this.swirler.rate()/SWIRL_FULL);
  }else{this.swirler.reset();this.swirlLevel=0;}
  this.bench.setSwirl(this.swirlLevel);
 }
 step(frame:GestureFrame,dt:number,_view:MirrorViewState,frozen:boolean):TitrationOutput{
  if(!frozen)this.hands(frame,dt);
  const b=this.bench,before=b.drops;
  b.step(frozen?0:dt);
  const whole=Math.floor(b.drops);
  if(whole>this.lastDrop&&before<b.drops)this.sounds.push({type:'drip'});
  const dropCount=whole;this.lastDrop=whole;
  const f=b.flask,tint=b.tint,local=b.localTint;
  const scene:TitrationScene={
   reading:b.reading,filled:b.filled,bubble:b.bubble,tap:b.canFlow?b.tap:0,streaming:b.canFlow&&b.tap>=.2,dropCount,
   flask:{present:!!f,volume:f?ACID_VOLUME+f.delivered:0,rgb:tint.rgb,alpha:tint.alpha,localRgb:local.rgb,localAlpha:f&&f.local>1e-4?local.alpha:0},
   swirl:Math.max(this.swirlLevel,b.swirlTimer>0?1:0),focus:this.focus,
  };
  const sounds=this.sounds;this.sounds=[];
  return {scene,view:null,sounds,holding:false};
 }
}
