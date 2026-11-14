import {REV,clamp,ease} from '../mirror/engine';
import type {MirrorBehaviour,MirrorContext,MirrorScene} from '../mirror/contracts';
import type {AtomSceneExtra,AtomSkin,AtomSound,AtomTaken} from './contracts';
import {DEFAULT_ELEMENT,describeAtom,elements,nucleons,outermostFree,shellOfElectron,shellSpeed,shellsOf,stepElement,type Nucleon} from './model';

const SPIN=.22,TUMBLE=.5,RATE_UP=3,RATE_BACK=-1.5,RATE_TAU=.35,KICK=1.2,RATE_MAX=4,RATE_MIN=-3;
const LIFT=.6,BOB=.06,GRACE=.3,FOLLOW_TAU=.07,FLY_TAU=.16,BACK_TAU=.18,GONE=.015,ARRIVED=.985,TAKEN_AT=.5;
const FADE_OUT=.22,FADE_IN=.5,TEAR_BLOCK=.2;
const PALM=[0,5,9,13,17],MANUAL=-1;
type Context=MirrorContext<AtomSkin,AtomSceneExtra,AtomSound>;
interface Take extends AtomTaken {lastOpen:number;releasing:boolean}

/** Electrons spread evenly round each shell, each shell offset from the last so they never line up. */
export function startAngles(z:number){
 const shells=shellsOf(z),out=new Float32Array(z);
 for(let e=0;e<z;e++){const {shell,slot,count}=shellOfElectron(shells,e);out[e]=slot/count*REV+shell*1.1;}
 return out;
}

/** The atom's motion: orbits, the slow turn, electrons taken by open palms, and the step to the next element. */
export class AtomBehaviour implements MirrorBehaviour<AtomSkin,AtomSceneExtra,AtomSound> {
 element=DEFAULT_ELEMENT;
 /** Off when the viewer asked for less motion: nothing turns by itself, though a thumb still drives the orbits. */
 idle=true;
 /** A taken electron held without a hand, for buttons and keys. */
 manualTake=false;
 private rate=1;private driving=0;private clock=0;private pending:number|null=null;
 private takes=new Map<number,Take>();private seen=new WeakSet<object>();private parts:Nucleon[]=[];
 constructor(){this.parts=this.build();}
 private build(){const e=elements[this.element];return nucleons(e.z,e.neutrons);}

 initialScene():AtomSceneExtra{return {element:this.element,angles:startAngles(elements[this.element].z),rate:1,taken:[],spin:0,tumble:0,fade:1,caption:''};}
 fit(_:number){}
 describe(part:number){
  const total=this.parts.length;
  if(part<total){const proton=this.parts[part].kind==='proton';return {title:proton?'Proton':'Neutron',detail:`${proton?'positive charge':'no charge'} · in the nucleus`};}
  const e=part-total,{shell}=shellOfElectron(shellsOf(elements[this.element].z),e),away=[...this.takes.values()].some(t=>t.electron===e&&t.amount>TAKEN_AT);
  return {title:'Electron',detail:`negative charge · ${away?'taken from':'in'} shell ${shell+1}`};
 }
 drive(direction:number){this.driving=direction;}
 stir(_:number,__:number){}
 /** A nudge to the orbital speed, for the space key; it settles back on its own. */
 kick(direction:1|-1){this.rate=clamp(this.rate+direction*KICK,RATE_MIN,RATE_MAX);}
 /** Fades the atom out, swaps the element, fades it back in. */
 next(step=1){if(this.pending===null)this.pending=stepElement(this.element,step);}
 get electrons(){return elements[this.element].z-this.removed;}
 get removed(){let n=0;for(const t of this.takes.values())if(t.amount>TAKEN_AT)n++;return n;}
 get busy(){return this.pending!==null;}

 advance(h:number,c:Context){
  const s=c.scene;this.clock+=h;
  const target=this.driving>0?RATE_UP:this.driving<0?RATE_BACK:this.idle?1:0;
  this.rate+=(target-this.rate)*ease(h,RATE_TAU);
  if(this.idle){s.spin+=h*SPIN;s.tumble+=h*TUMBLE;}
  const shells=shellsOf(elements[this.element].z);
  for(let e=0;e<s.angles.length;e++)s.angles[e]+=shellSpeed(shellOfElectron(shells,e).shell)*this.rate*h;
  this.claps(c);this.swap(h,c);this.hands(h,c);
 }
 settle(_:number,__:Context){}
 publish(c:Context){
  const s=c.scene;s.rate=this.rate;s.caption=describeAtom(elements[this.element],this.electrons);
  s.taken.length=0;for(const t of this.takes.values())s.taken.push(t);
 }
 reset(s:MirrorScene<AtomSkin>&AtomSceneExtra){
  this.rate=1;this.driving=0;this.pending=null;this.manualTake=false;this.takes.clear();this.setElement(DEFAULT_ELEMENT,s);s.spin=s.tumble=0;s.fade=1;s.taken.length=0;
 }
 private setElement(index:number,s:AtomSceneExtra){
  this.element=index;this.takes.clear();this.parts=this.build();s.element=index;s.angles=startAngles(elements[index].z);
 }
 /** A clap is the engine's shock; each one steps once. */
 private claps(c:Context){
  for(const shock of c.scene.shocks){if(this.seen.has(shock))continue;this.seen.add(shock);if(!c.frozen&&shock.age<.1)this.next();}
 }
 private swap(h:number,c:Context){
  const s=c.scene;
  if(this.pending===null){if(s.fade<1)s.fade=Math.min(1,s.fade+h/FADE_IN);return;}
  s.fade=Math.max(0,s.fade-h/FADE_OUT);
  if(s.fade>0)return;
  this.setElement(this.pending,s);this.pending=null;c.sound({type:'next'});
 }
 /** One electron per open palm: it leaves its shell for a spot above the hand, and goes home a moment after the palm does. */
 private hands(h:number,c:Context){
  const s=c.scene,open=new Map<number,{x:number;y:number;z:number}>(),z=elements[this.element].z;
  const allowed=!c.frozen&&this.pending===null&&s.fade>=1&&s.explode<TEAR_BLOCK;
  if(allowed&&this.manualTake)open.set(MANUAL,{x:c.view.x+2,y:c.view.y+.6,z:0});
  if(allowed)for(const hand of s.hands){
   if(hand.pose!=='open'||hand.joints.length<21)continue;
   const p={x:0,y:0,z:0};for(const i of PALM){p.x+=hand.joints[i].x/PALM.length;p.y+=hand.joints[i].y/PALM.length;p.z+=hand.joints[i].z/PALM.length;}
   open.set(hand.id,p);
  }
  for(const [id,p] of open){
   let t=this.takes.get(id);
   if(!t){
    const used=new Set([...this.takes.values()].map(x=>x.electron)),electron=outermostFree(z,used);
    if(electron<0)continue;
    t={hand:id,electron,amount:0,x:p.x,y:p.y+LIFT,z:p.z,lastOpen:this.clock,releasing:false};this.takes.set(id,t);c.sound({type:'take'});
   }
   t.lastOpen=this.clock;t.releasing=false;
   const k=ease(h,FOLLOW_TAU);
   t.x+=(p.x-t.x)*k;t.y+=(p.y+LIFT+Math.sin(this.clock*3+t.electron)*BOB-t.y)*k;t.z+=(p.z-t.z)*k;
   t.amount+=(1-t.amount)*ease(h,FLY_TAU);if(t.amount>ARRIVED)t.amount=1;
  }
  for(const [id,t] of [...this.takes]){
   if(open.has(id)||this.clock-t.lastOpen<=GRACE)continue;
   if(!t.releasing){t.releasing=true;c.sound({type:'return'});}
   t.amount-=t.amount*ease(h,BACK_TAU);
   if(t.amount<GONE)this.takes.delete(id);
  }
 }
}
