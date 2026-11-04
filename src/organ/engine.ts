import type {GestureFrame,HandPose,MirrorDriver,MirrorViewState,TrackedHand,WorldPoint} from '../mirror/contracts';
import type {Ack,Grab,Hold,OrganOutput,OrganScene,OrganSound,OrganWorld,Px,Reticle} from './contracts';
import {apply,emptyDoc,History,layerName,STACK_MAX,type OrganDoc} from './doc';
import {ingredientAt,vialCount} from './layout';
import {CONC_MAX,CONC_MIN,HOURS,MAX_DROPS,concName,dropCount,label,makeCompliant,skins} from './model';

/** Stage pixels: every target answers within this radius, so a vial is a 120 px wide target whatever its drawn size. */
export const MAGNET=60;
/** Seconds a let-go pinch waits for the same hand to close again nearby, and how near. */
export const GRACE=.28,REATTACH=110;
/** Seconds each deliberate pose must be held before it acts. */
export const HOLD:Partial<Record<HandPose,number>>={thumbUp:.45,thumbDown:.45,love:.55,open:.9};
const ENGAGE:Partial<Record<HandPose,number>>={fist:.2,victory:.15};
const PAIR_ENGAGE=.15,NEAR=.8,SHUT=.35,CLOCK_RATE=.5,ACK_LIFE=1.4,SPLIT_PX=260,BOTTLE_SQUEEZE=.62,TURN_PX=600;
const EASE=(h:number,tau:number)=>1-Math.exp(-h/tau);
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const wrapAngle=(a:number)=>a-Math.PI*2*Math.floor((a+Math.PI)/(Math.PI*2));
interface HandState {pose:HandPose;since:number;fired:boolean;tried:boolean;x:number;y:number;angle:number;engaged:boolean;missed:boolean}
interface Pair {kind:'pinch'|'fist';a:number;b:number;since:number;d0:number;conc0:number;done:boolean;engaged:boolean}
interface Grabbing extends Grab {hand:number;releasedAt:number}
const glyphs:Partial<Record<HandPose,string>>={open:'🖐',fist:'✊',pinch:'🤏',point:'☝️',victory:'✌️',thumbUp:'👍',thumbDown:'👎',love:'🤟'};

/** The perfumer's hands: picks, doses, holds and two-hand moves, all in stage pixels. Never moves the camera. */
export class OrganEngine implements MirrorDriver<OrganOutput> {
 doc:OrganDoc=emptyDoc();readonly history=new History();
 idle=false;speed=0;
 private t=0;private lastAt=NaN;private hands=new Map<number,HandState>();private pair:Pair|null=null;
 private grabbing:Grabbing|null=null;private mouseHover:Px|null=null;private ackId=0;private sounds:OrganSound[]=[];
 private sliceOn=false;private openHands=0;private splitTarget=0;private ackKeys=new Map<string,number>();
 readonly scene:OrganScene={doc:this.doc,ring:0,fan:0,clock:0,playing:false,sprays:0,hover:null,reticles:[],grab:null,holds:[],acks:[],slice:0,split:0,conc:null,shock:null,hands:[],undoable:0};
 constructor(private world:OrganWorld){}

 get position(){return this.scene.clock/HOURS*359;}
 seek(degrees:number){if(Number.isFinite(degrees)){this.scene.clock=clamp(degrees/359*HOURS,0,HOURS);this.scene.playing=false;}}
 kick(direction:1|-1){if(direction>0)this.spray(this.world.palm());else this.undo(this.world.palm());}
 reset(){this.doc=emptyDoc();this.history.clear();this.grabbing=null;this.pair=null;this.hands.clear();Object.assign(this.scene,{ring:0,clock:0,playing:false,hover:null,grab:null,slice:0,split:0,conc:null,shock:null});this.scene.acks.length=0;}
 // Mouse: the shell hands over stage pixels from the view's pointToWorld.
 pointerDown(p:WorldPoint){const v=this.nearest(p);if(v<0)return false;this.pick(v,-1,p);return true;}
 pointerMove(p:WorldPoint){const g=this.grabbing;if(g&&g.hand===-1)this.drag(g,p);}
 pointerUp(){const g=this.grabbing;if(g&&g.hand===-1)this.commit();}
 hover(p:WorldPoint|null){this.mouseHover=p?{x:p.x,y:p.y}:null;}

 // ---- Actions, each undoable and each acknowledged where it happened.
 private change(what:string,fn:(d:OrganDoc)=>void){const before=this.doc;this.doc=apply(this.doc,this.history,what,fn);return this.doc!==before;}
 add(id:string,drops:number,at:Px){
  const name=ingredientAt(this.indexOf(id))?.name??id,before=label(this.doc.blend).filter(l=>l.declared).length;
  this.change(`${drops} drop${drops===1?'':'s'} of ${name}`,d=>{d.blend.items.push({id,drops});d.compliance=null;if(d.mode==='layering')d.mode='compose';});
  const now=label(this.doc.blend).filter(l=>l.declared).length;
  this.ack(at,`+ ${drops} ${drops===1?'drop':'drops'} ${name}${now>before?` · label +${now-before}`:''}`);this.sound('drop');
 }
 spray(at:Px){
  if(!dropCount(this.doc.blend)){this.ack(at,'👍 Add a material first: nothing to spray',true);this.sound('miss');return;}
  this.change('Sprayed on the palm',d=>{d.mode='drydown';});
  this.scene.clock=0;this.scene.playing=true;this.scene.sprays++;this.ack(at,'👍 Sprayed on the palm · 8 h in 16 s');this.sound('spray');
 }
 undo(at:Px){
  const back=this.history.undo();
  if(!back){this.ack(at,'👎 Nothing to undo',true);this.sound('miss');return;}
  this.doc=back.doc;this.ack(at,`👎 Undid: ${back.what}`);this.sound('undo');
 }
 nextSkin(at:Px){const next=skins[(skins.indexOf(this.doc.skin)+1)%skins.length];this.change(`Skin: ${next}`,d=>{d.skin=next;});this.ack(at,`🤟 ${next[0].toUpperCase()+next.slice(1)} skin`);this.sound('skin');}
 toggleFan(at:Px){const on=!this.doc.fan;this.change(on?'Fanned by family':'Back to tiers',d=>{d.fan=on;});this.ack(at,on?'🖐 Fanned by family':'🖐 Back to tiers by note');this.sound('fan');}
 compliant(at:Px){
  if(!dropCount(this.doc.blend)){this.ack(at,'👐 Nothing in the flask to check',true);this.sound('miss');return;}
  const result=makeCompliant(this.doc.blend);
  if(!result.changes.length){this.change('Checked compliance',d=>{d.compliance=result;});this.ack(at,'👐 Already under every ceiling: label only');this.sound('shock');return;}
  this.change('Made compliant',d=>{d.blend=result.after;d.compliance=result;});
  this.ack(at,`👐 Compliant · ${result.changes.length} changed · ${Math.round(result.kept*100)}% character kept`);this.sound('shock');
 }
 bottle(at:Px){
  if(!dropCount(this.doc.blend)){this.ack(at,'🤏🤏 Make a blend first, then push together to bottle it',true);this.sound('miss');return;}
  const name=layerName(Math.min(this.doc.stack.length,STACK_MAX-1));
  this.change(`Bottled ${name}`,d=>{d.stack.push(d.blend);if(d.stack.length>STACK_MAX)d.stack.shift();d.blend={items:[],conc:d.blend.conc};d.compliance=null;d.mode=d.stack.length>=2?'layering':'compose';});
  if(this.doc.mode==='layering'){this.scene.clock=0;this.scene.playing=true;}
  this.ack(at,this.doc.stack.length>=2?`🤏🤏 Layered ${this.doc.stack.map((_,i)=>layerName(i)).join(' + ')} on the forearm`:`🤏🤏 Bottled ${name} · make another to layer`);this.sound('bottle');
 }
 setProduct(p:OrganDoc['product']){this.change(`Product: ${p}`,d=>{d.product=p;});}
 clearFlask(){this.change('Emptied the flask',d=>{d.blend={items:[],conc:d.blend.conc};d.compliance=null;d.mode='compose';});}
 setConc(c:number){this.change(`Concentration: ${concName(c)}`,d=>{d.blend.conc=c;for(const s of d.stack)s.conc=c;});}

 step(frame:GestureFrame,dt:number,_view:MirrorViewState,frozen:boolean):OrganOutput{
  const h=Number.isFinite(dt)?clamp(dt,0,.05):0,s=this.scene;this.t+=h;
  s.holds.length=0;s.reticles.length=0;s.hover=null;
  if(frame.at!==this.lastAt){this.lastAt=frame.at;if(!frozen)for(const e of frame.events)if(e.type==='clap'){const p=this.world.stage({x:e.x,y:e.y,z:0});s.shock={...p,age:0};this.compliant(p);}}
  if(frozen){this.hands.clear();this.pair=null;if(this.grabbing)this.commit();}
  else this.hands_(frame.hands);
  const g=this.grabbing;
  if(g&&g.releasedAt>=0&&this.t-g.releasedAt>GRACE)this.commit();
  if(!this.grabbing&&this.mouseHover){const v=this.nearest(this.mouseHover);if(v>=0)s.hover={vial:v,...this.mouseHover};}
  if((s.doc.mode!=='compose')&&s.playing){s.clock=Math.min(HOURS,s.clock+h*CLOCK_RATE*(this.sliceOn?0:1));if(s.clock>=HOURS)s.playing=false;}
  s.slice+=((this.sliceOn?1:0)-s.slice)*EASE(h,.12);
  s.split+=(this.splitTarget-s.split)*EASE(h,.08);
  s.fan+=((this.doc.fan?1:0)-s.fan)*EASE(h,.25);
  if(s.shock&&(s.shock.age+=h)>1.6)s.shock=null;
  for(let i=s.acks.length-1;i>=0;i--)if((s.acks[i].age+=h)>ACK_LIFE)s.acks.splice(i,1);
  s.grab=this.grabbing;s.doc=this.doc;s.undoable=this.history.size;
  const sounds=this.sounds;this.sounds=[];
  return {scene:s,view:null,sounds,holding:false,drops:dropCount(this.doc.blend)};
 }

 private hands_(list:TrackedHand[]){
  const s=this.scene;s.hands=list.map(h=>({id:h.id,pose:h.pose,points:h.landmarks.map(p=>this.world.stage(p))}));
  for(const id of [...this.hands.keys()])if(!list.some(h=>h.id===id))this.hands.delete(id);
  for(const hand of list){
   const palm=this.world.stage(hand.palm),pts=s.hands.find(x=>x.id===hand.id)!.points,angle=pts.length>9?Math.atan2(pts[9].y-pts[0].y,pts[9].x-pts[0].x):0;
   let st=this.hands.get(hand.id);
   if(!st||st.pose!==hand.pose){
    st={pose:hand.pose,since:this.t,fired:false,tried:false,x:palm.x,y:palm.y,angle,engaged:false,missed:false};this.hands.set(hand.id,st);
    this.greet(hand.pose,palm);
   }
  }
  const pinches=list.filter(h=>h.pose==='pinch'),fists=list.filter(h=>h.pose==='fist');
  if(pinches.length>=2)this.twoHands('pinch',pinches[0],pinches[1]);
  else if(fists.length>=2)this.twoHands('fist',fists[0],fists[1]);
  else this.endPair();
  this.openHands=list.filter(h=>h.pose==='open').length;
  for(const hand of list){
   if(this.pair&&(hand.id===this.pair.a||hand.id===this.pair.b))continue;
   this.oneHand(hand,this.hands.get(hand.id)!);
  }
  // A pinch that let go, or a hand that vanished, starts the grace window instead of dropping the vial at once.
  const g=this.grabbing;
  if(g&&g.hand>=0&&g.releasedAt<0){const hand=list.find(h=>h.id===g.hand);if(!hand||hand.pose!=='pinch'){g.releasedAt=this.t;g.loose=true;}}
  this.sliceOn=list.some(h=>{const st=this.hands.get(h.id)!;return h.pose==='victory'&&this.t-st.since>=ENGAGE.victory!&&this.doc.mode!=='compose';});
 }
 /** Within a frame of a pose being recognised, a chip at the hand says what it does here. */
 private greet(pose:HandPose,at:Px){
  const d=this.doc.mode!=='compose',text:Partial<Record<HandPose,string>>={
   pinch:'🤏 Pinch a vial, pull toward the flask',point:'☝️ Point at a vial to read it',fist:d?'✊ Turn to scrub the hours':'✊ Turn to spin the organ',
   victory:d?'✌️ Slice the dry-down':'✌️ Spray first: nothing to slice yet',thumbUp:'👍 Hold to spray on the palm',thumbDown:'👎 Hold to undo',love:'🤟 Hold to change skin',open:'🖐 Hold still to fan by family'};
  const line=text[pose];if(!line)return;
  this.ack(at,line,pose==='victory'&&!d,`pose:${pose}`);if(pose==='victory'&&!d)this.sound('miss');
 }
 private oneHand(hand:TrackedHand,st:HandState){
  const palm=this.world.stage(hand.palm),tip=this.world.stage(hand.indexTip),pinch=this.world.stage(hand.pinch),age=this.t-st.since,ratio=this.ratio(hand);
  const g=this.grabbing;
  if(hand.pose==='pinch'){
   if(g&&g.hand===hand.id&&g.releasedAt<0)this.drag(g,pinch);
   else if(g&&g.releasedAt>=0&&Math.hypot(pinch.x-g.x,pinch.y-g.y)<REATTACH){g.hand=hand.id;g.releasedAt=-1;g.loose=false;this.drag(g,pinch);}
   else if(!g&&!st.tried){
    st.tried=true;const v=this.nearest(pinch);
    if(v>=0)this.pick(v,hand.id,pinch);else{this.ack(pinch,'🤏 Nothing in reach: close the pinch on a vial',true);this.sound('miss');}
   }
  }else if(!g&&ratio<NEAR&&(hand.pose==='open'||hand.pose==='none')){
   const v=this.nearest(pinch);this.scene.reticles.push({x:pinch.x,y:pinch.y,close:clamp((NEAR-ratio)/(NEAR-SHUT),0,1),vial:v});
   if(v>=0)this.scene.hover={vial:v,x:pinch.x,y:pinch.y};
  }
  if(hand.pose==='point'){const v=this.nearest(tip);if(v>=0)this.scene.hover={vial:v,x:tip.x,y:tip.y};}
  if(hand.pose==='fist'){
   const engaged=age>=ENGAGE.fist!;
   if(!engaged){this.scene.holds.push({x:palm.x,y:palm.y,glyph:'✊',label:this.doc.mode!=='compose'?'Scrub':'Spin',progress:age/ENGAGE.fist!});st.x=palm.x;st.angle=this.angleOf(hand,st.angle);}
   else{
    const angle=this.angleOf(hand,st.angle),turn=wrapAngle(angle-st.angle)+(palm.x-st.x)/TURN_PX*Math.PI;st.angle=angle;st.x=palm.x;
    if(this.doc.mode!=='compose'){this.scene.clock=clamp(this.scene.clock+turn/Math.PI*HOURS/2,0,HOURS);this.scene.playing=false;}
    else this.scene.ring+=turn*.8;
   }
  }
  const need=HOLD[hand.pose];
  if(need&&!st.fired){
   // An open hand only counts as deliberate while still and spread: reaching for a vial is not fanning.
   // Two open hands are a clap on its way, not a fan.
   if(hand.pose==='open'&&(Math.hypot(palm.x-st.x,palm.y-st.y)>40||ratio<.95||this.openHands>1)){st.since=this.t;st.x=palm.x;st.y=palm.y;return;}
   const p=age/need;this.scene.holds.push({x:palm.x,y:palm.y,glyph:glyphs[hand.pose]!,label:{thumbUp:'Spray',thumbDown:'Undo',love:'Skin',open:'Fan'}[hand.pose as string]??'',progress:Math.min(1,p)});
   if(p>=1){st.fired=true;
    if(hand.pose==='thumbUp')this.spray(palm);else if(hand.pose==='thumbDown')this.undo(palm);else if(hand.pose==='love')this.nextSkin(palm);else if(hand.pose==='open')this.toggleFan(palm);}
  }
 }
 private twoHands(kind:'pinch'|'fist',a:TrackedHand,b:TrackedHand){
  const pa=this.world.stage(kind==='pinch'?a.pinch:a.palm),pb=this.world.stage(kind==='pinch'?b.pinch:b.palm),d=Math.hypot(pa.x-pb.x,pa.y-pb.y),mid={x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2};
  let p=this.pair;
  if(!p||p.kind!==kind||p.a!==a.id||p.b!==b.id){
   this.endPair();
   if(this.grabbing){this.grabbing.drops=0;this.commit();}
   p=this.pair={kind,a:a.id,b:b.id,since:this.t,d0:d,conc0:this.doc.blend.conc,done:false,engaged:false};
   this.ack(mid,kind==='pinch'?'🤏🤏 Apart: split the notes · together: bottle':'✊✊ Spread for stronger, close for lighter',false,`pair:${kind}`);
  }
  const age=this.t-p.since;
  if(!p.engaged){
   this.scene.holds.push({x:mid.x,y:mid.y,glyph:kind==='pinch'?'🤏🤏':'✊✊',label:kind==='pinch'?'Split':'Strength',progress:age/PAIR_ENGAGE});
   if(age<PAIR_ENGAGE){p.d0=d;return;}
   p.engaged=true;p.d0=Math.max(d,1);if(kind==='pinch')this.sound('split');
  }
  if(kind==='pinch'){
   this.splitTarget=dropCount(this.doc.blend)?clamp((d-p.d0)/SPLIT_PX,0,1):0;
   if(!p.done&&p.d0>140&&d<p.d0*BOTTLE_SQUEEZE){p.done=true;this.splitTarget=0;this.bottle(mid);}
  }else this.scene.conc=clamp(p.conc0*Math.pow(d/p.d0,1.6),CONC_MIN,CONC_MAX);
 }
 private endPair(){
  const p=this.pair;if(!p)return;this.pair=null;this.splitTarget=0;
  if(p.kind==='fist'&&this.scene.conc!==null){const c=this.scene.conc;this.scene.conc=null;if(Math.abs(c-this.doc.blend.conc)>.002)this.setConc(c);}
 }
 // ---- Picking and dosing.
 private pick(v:number,hand:number,at:Px){
  const from=this.world.vial(v),to=this.world.flask();
  this.grabbing={vial:v,hand,x:at.x,y:at.y,drops:0,loose:false,from:{x:from.x,y:from.y},to,releasedAt:-1};
  this.ack(at,`🤏 ${ingredientAt(v)!.name}: pull toward the flask`,false,'pick');this.sound('pick');
 }
 /** The dose is how far along the line from the vial to the flask the hand has come. */
 private drag(g:Grabbing,p:Px){
  g.x=p.x;g.y=p.y;g.to=this.world.flask();
  const ax=g.to.x-g.from.x,ay=g.to.y-g.from.y,l2=Math.max(1,ax*ax+ay*ay),f=((p.x-g.from.x)*ax+(p.y-g.from.y)*ay)/l2;
  const drops=clamp(Math.round(f*1.15*MAX_DROPS),0,MAX_DROPS);
  if(drops!==g.drops&&drops>0)this.sound('tick');g.drops=drops;
 }
 private commit(){
  const g=this.grabbing;if(!g)return;this.grabbing=null;
  const id=ingredientAt(g.vial)!.id;
  if(g.drops>0)this.add(id,g.drops,g.to);else{this.ack({x:g.x,y:g.y},`${ingredientAt(g.vial)!.name} back on the organ · no drops`,true);this.sound('return');}
 }
 /** The vial nearest a point within the magnet radius, among those on the organ. */
 private nearest(p:Px){
  let best=-1,bd=MAGNET;
  for(let i=0;i<vialCount;i++){const v=this.world.vial(i);if(!v.on)continue;const d=Math.hypot(v.x-p.x,v.y-p.y);if(d<bd){bd=d;best=i;}}
  return best;
 }
 private indexOf(id:string){for(let i=0;i<vialCount;i++)if(ingredientAt(i)?.id===id)return i;return -1;}
 private ratio(hand:TrackedHand){
  const l=hand.landmarks;if(l.length<21)return Infinity;
  const a=this.world.stage(l[4]),b=this.world.stage(l[8]),w=this.world.stage(l[0]),m=this.world.stage(l[9]),palm=Math.hypot(w.x-m.x,w.y-m.y);
  return palm>1?Math.hypot(a.x-b.x,a.y-b.y)/palm:Infinity;
 }
 private angleOf(hand:TrackedHand,fallback:number){
  const l=hand.landmarks;if(l.length<21)return fallback;
  const w=this.world.stage(l[0]),m=this.world.stage(l[9]);return Math.atan2(m.y-w.y,m.x-w.x);
 }
 /** A keyed chip replaces its predecessor, so a held gesture does not stack copies. */
 private ack(at:Px,text:string,miss=false,key?:string){
  const acks=this.scene.acks;
  if(key){const old=this.ackKeys.get(key),i=acks.findIndex(a=>a.id===old);if(i>=0)acks.splice(i,1);}
  const id=++this.ackId;if(key)this.ackKeys.set(key,id);
  acks.push({id,x:at.x,y:at.y,text,miss,age:0});if(acks.length>6)acks.shift();
 }
 private sound(type:OrganSound['type']){this.sounds.push({type});}
}
export type {Ack,Hold,Reticle};
