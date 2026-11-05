import type {GestureFrame,HandPose,MirrorDriver,MirrorViewState,TrackedHand,WorldPoint} from '../mirror/contracts';
import {DAY,FOUGERE,balance,diagnose,handRoll,matchScore,pourRate,ribbon,smellAt,total,toBlend,wrapAngle,type Items} from './accord';
import type {Ack,Held,Hold,OrganOutput,OrganScene,OrganSound,OrganWorld,Pair,Px,Reticle} from './contracts';
import {History,clean,emptyDoc,pourUndo,type OrganDoc} from './doc';
import {ingredient,makeCompliant,type Skin} from './model';
import {byFamily,inZone,palmAt,slots,type Slot} from './layout';
import {Story,type Chapter,type Facts,type GestureId} from './story';

/** Seconds a let-go pinch waits for a hand to close again nearby, and how near, px. */
export const GRACE=.3,REATTACH=110;
/** Seconds 👎 is held before it undoes. */
export const UNDO_HOLD=.45;
const FIST_ENGAGE=.2,NEAR=.8,SHUT=.35,ACK_LIFE=1.5,PUFF_LIFE=2.6,TILT_TAU=.08,TURN_PX=600,HOURS_PER_PI=10;
/** A waft is an open hand stroked up toward the face and back: the up stroke previews, the turn back commits. Fractions of stage height. */
export const WAFT_UP=.08,WAFT_BACK=.022,WAFT_WINDOW=.9,WAFT_COOLDOWN=1.1;
const RUB_TURNS=3,RUB_WINDOW=1.4,RUB_AMP=8;
const EASE=(h:number,tau:number)=>1-Math.exp(-h/tau);
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
interface HandState {pose:HandPose;since:number;fired:boolean;tried:boolean;x:number;y:number;angle:number;
 /** Recent palm heights for the waft, stage px. */
 trail:{t:number;x:number;y:number}[];up:number|null}
interface Holding extends Held {rest:number;releasedAt:number;tick:number;downAt:Px|null}
const greetings:Partial<Record<HandPose,[string,boolean]>>={point:['☝️ Point at a vial to read it',false],thumbUp:['👍 Not used here: 👎 undoes',true],victory:['✌️ Not used here',true],love:['🤟 Not used here',true]};

/** The perfumer's hands: pick up, tilt to pour, waft, turn the day, undo. Stage pixels throughout; never moves the camera. */
export class OrganEngine implements MirrorDriver<OrganOutput> {
 doc:OrganDoc=emptyDoc();readonly history=new History();readonly story=new Story();
 idle=false;speed=0;
 private t=0;private hands=new Map<number,HandState>();private holding:Holding[]=[];private ackId=0;private sounds:OrganSound[]=[];private ackKeys=new Map<string,number>();
 private poked=false;private wafts=0;private lastWaft=-Infinity;private scrubLo=0;private scrubHi=0;private chapter:Chapter=1;private mouseAt:Px|null=null;
 private rub:{rel:number[];times:number[];dir:number;last:number;fired:number}={rel:[],times:[],dir:0,last:NaN,fired:-Infinity};
 private drawFrom=-1;private wasLive=false;
 readonly scene:OrganScene;
 constructor(private world:OrganWorld){
  const W=world.size.w,H=world.size.h,f=this.facts();
  this.scene={doc:this.doc,story:this.story.view(f),clock:0,scrubbing:false,slots:[],palm:palmAt(W,H),offer:null,offerHot:false,held:[],reticles:[],holds:[],acks:[],puffs:[],hover:null,match:null,pair:null,draw:0,waftPreview:null,warm:0,lit:[],hands:[],undoable:0};
 }
 get skin():Skin{return this.doc.warm?'warm':'normal';}
 get position(){return this.scene.clock/DAY*359;}
 seek(degrees:number){if(Number.isFinite(degrees))this.setClock(degrees/359*DAY);}
 kick(direction:1|-1){if(direction>0)this.waft(this.scene.palm);else this.undo(this.scene.palm);}
 reset(){this.goto(1);}

 // ---- Mouse: click a vial to hold it, the wheel tilts it, click again to set it down. Dragging works too.
 pointerDown(p:WorldPoint){
  const s=this.scene;this.poked=true;
  if(s.offer&&this.inOffer(p)){this.next();return true;}
  const mine=this.holding.find(g=>g.hand===-1);if(mine){this.commit(mine);return true;}
  const slot=this.nearest(p);if(!slot)return false;
  this.tryPick(slot,-1,p);const g=this.holding.find(x=>x.hand===-1);if(g)g.downAt={x:p.x,y:p.y};return true;
 }
 pointerMove(p:WorldPoint){this.mouseAt={x:p.x,y:p.y};const g=this.holding.find(x=>x.hand===-1);if(g){g.x=p.x;g.y=p.y;}}
 pointerUp(){const g=this.holding.find(x=>x.hand===-1);if(g&&g.downAt){if(Math.hypot(g.x-g.downAt.x,g.y-g.downAt.y)>24)this.commit(g);else g.downAt=null;}}
 hover(p:WorldPoint|null){this.mouseAt=p?{x:p.x,y:p.y}:null;const g=this.holding.find(x=>x.hand===-1);if(g&&p){g.x=p.x;g.y=p.y;}}
 /** The wheel tips the vial the mouse holds; false when it holds none, so the wheel zooms as usual. */
 wheel(deltaY:number){const g=this.holding.find(x=>x.hand===-1);if(!g)return false;g.tilt=clamp(g.tilt+deltaY*.0025,-1.3,1.3);return true;}
 get mouseHolding(){return this.holding.some(x=>x.hand===-1);}

 // ---- Actions: each undoable, each acknowledged where it happened.
 waft(at:Px){
  const s=this.scene;this.poked=true;
  if(!total(this.doc.items)){this.ack(at,'🖐 Nothing on your palm yet: pour something first',true,'waft');this.sound('miss');this.puff(['nothing yet'],true);return;}
  this.wafts++;this.lastWaft=this.t;const words=smellAt(this.doc.items,s.clock,this.skin,this.peak());
  this.puff(words,false);this.ack(at,`🖐 You smell: ${words.join(', ')}`,false,'waft');this.sound('puff');
 }
 undo(at:Px){
  this.poked=true;for(const g of [...this.holding])this.commit(g);
  const back=this.history.undo(this.doc);
  if(!back){this.ack(at,'👎 Nothing to undo',true,'undo');this.sound('miss');return;}
  this.doc=back.doc;this.ack(at,`👎 Took back: ${back.what}`,false,'undo');this.sound('undo');
 }
 setClock(h:number){if(!Number.isFinite(h))return;this.scene.clock=clamp(h,0,DAY);this.scrubLo=Math.min(this.scrubLo,this.scene.clock);this.scrubHi=Math.max(this.scrubHi,this.scene.clock);}
 toggleWarm(at:Px){
  const before=this.doc;this.history.snapshot(this.doc.warm?'Warm skin':'Cool skin',before);this.doc={...structuredClone(before),warm:!before.warm};
  this.ack(at,this.doc.warm?'🙌 Warm skin: everything lifts sooner':'🙌 Back to normal skin');this.sound('skin');
 }
 next(){this.commitAll();this.story.next();this.enter();this.sound('page');}
 goto(c:Chapter){this.commitAll();this.story.goto(c);this.enter();}
 /** A chapter sets up the palm it needs: chapter 2 keeps your accord, or the reference one if you skipped here. */
 private enter(){
  const c=this.story.chapter,from=this.chapter;this.chapter=c;this.history.clear();this.scene.clock=0;this.scrubLo=this.scrubHi=0;this.drawFrom=-1;this.wasLive=c>1;
  if(c===2){if(from!==1||!(this.doc.items.oakmoss>0&&this.doc.items.lavender>0))this.doc={...emptyDoc(),items:{...FOUGERE.items}};this.doc.swap=null;this.story.original={...this.doc.items};}
  else{this.doc=emptyDoc();this.story.original=null;}
 }
 private swap(at:Px){
  const result=makeCompliant(toBlend(this.doc.items));if(!result.changes.length)return;
  this.history.snapshot('Swapped oakmoss for the stand-in',this.doc);
  const items:Items={};for(const a of result.after.items)items[a.id]=(items[a.id]??0)+a.drops;
  this.doc={...this.doc,items,swap:result};
  this.ack(at,`Oakmoss out, stand-in in · ${Math.round(result.kept*100)}% character kept`);this.sound('swap');
 }

 step(frame:GestureFrame,dt:number,_view:MirrorViewState,frozen:boolean):OrganOutput{
  const h=Number.isFinite(dt)?clamp(dt,0,.05):0,s=this.scene,{w:W,h:H}=this.world.size;this.t+=h;
  s.holds=[];s.reticles=[];s.hover=null;s.offerHot=false;s.waftPreview=null;s.lit=[];s.scrubbing=false;
  this.layout(W,H);
  if(frozen){this.hands.clear();this.commitAll();s.hands=[];}
  else this.handsStep(frame.hands,h,W,H);
  for(const g of [...this.holding])if(g.releasedAt>=0&&this.t-g.releasedAt>GRACE)this.commit(g);
  for(const g of this.holding){
   g.rate=g.loose?0:pourRate(g.tilt);g.inZone=inZone(g,W,H);
   if(g.rate>0&&g.inZone)this.pour(g,g.rate*h);
   else if(g.rate>1&&!g.inZone){this.ack({x:g.x,y:g.y},'Bring it over your palm to pour',true,`zone:${g.hand}`);}
  }
  if(!frozen&&!frame.hands.length&&this.mouseAt&&!this.holding.length){const sl=this.nearest(this.mouseAt);if(sl)s.hover={id:sl.id,...this.mouseAt};else if(s.offer&&this.inOffer(this.mouseAt))s.offerHot=true;}
  const facts=this.facts();
  if(this.story.update(facts,h)==='locked'){this.sound('chord');}
  if(this.story.chapter!==this.chapter)this.enter();
  this.poked=false;
  const f=this.facts();s.story=this.story.view(f);this.layout(W,H);
  const ghost=this.story.ghost;s.match=ghost&&total(this.doc.items)?matchScore(this.doc.items,ghost,this.skin):null;
  s.pair=this.pairOf(ghost,W,H);
  // The first time the ribbon comes alive it draws in from 9:00, so the eye follows the lavender fading.
  if(s.story.ribbonLive&&!this.wasLive&&s.story.chapter===1)this.drawFrom=this.t;this.wasLive=s.story.ribbonLive;
  s.draw=s.story.ribbonLive?this.drawFrom<0?1:clamp((this.t-this.drawFrom)/2.4,0,1):0;
  s.warm+=((this.doc.warm?1:0)-s.warm)*EASE(h,.4);
  for(let i=s.acks.length-1;i>=0;i--)if((s.acks[i].age+=h)>ACK_LIFE)s.acks.splice(i,1);
  for(let i=s.puffs.length-1;i>=0;i--)if((s.puffs[i].age+=h)>PUFF_LIFE)s.puffs.splice(i,1);
  s.held=this.holding;s.doc=this.doc;s.undoable=this.history.size;
  if(this.holding.some(g=>g.rate>0))s.lit.push('tilt');if(this.t-this.lastWaft<.6)s.lit.push('waft');
  const sounds=this.sounds;this.sounds=[];
  return {scene:s,view:null,sounds,holding:false,drops:Math.round(total(this.doc.items))};
 }
 private layout(W:number,H:number){
  const s=this.scene,sv=s.story;s.palm=palmAt(W,H);
  s.slots=slots(sv.chapter===4?byFamily(sv.vials):sv.vials,W,H);
  // Beside the palm, low and to the left, clear of the vials, their names and the label card.
  s.offer=sv.offer?{x:Math.max(160,s.palm.x-Math.max(250,W*.22)),y:s.palm.y+18,w:Math.min(350,W*.32),h:60}:null;
 }
 facts():Facts{
  const items=this.doc.items,ghost=this.story.ghost,skin=this.skin,m=ghost&&total(items)?matchScore(items,ghost,skin):null;
  return {items,held:this.holding.map(g=>({id:g.id,inZone:g.inZone,rate:g.loose?0:g.rate})),wafts:this.wafts,scrubbed:this.scrubHi-this.scrubLo,
   score:m?.score??0,diagnosis:ghost?diagnose(items,ghost,skin).text:'',swapped:!!this.doc.swap,kept:this.doc.swap?.kept??1,pair:balance(items,'tonka','oakmoss'),
   clock:this.scene?.clock??0,words:smellAt(items,this.scene?.clock??0,skin,this.peak()),poked:this.poked};
 }
 /** Full strength: what this palm smells like at 9:00. */
 private peak(){return ribbon(this.doc.items,this.skin,null,2).total[0];}
 private pairOf(ghost:Items|null,W:number,H:number):Pair|null{
  const s=this.scene,live=this.holding.filter(g=>!g.loose),beat=s.story.beat;
  let a:string,b:string,at:Px;
  if(live.length>=2){[a,b]=[live[0].id,live[1].id];if(b==='tonka'||a==='oakmoss'&&b!=='oakmoss')[a,b]=[b,a];at={x:(live[0].x+live[1].x)/2,y:(live[0].y+live[1].y)/2-30};}
  else if(['carry','scrub','adjust'].includes(beat)&&(this.doc.items.tonka||this.doc.items.oakmoss||live.some(g=>g.id==='tonka'||g.id==='oakmoss'))){a='tonka';b='oakmoss';at=live[0]?{x:live[0].x,y:live[0].y-90}:{x:s.palm.x,y:s.palm.y-Math.min(120,H*.16)};}
  else return null;
  const target=ghost&&ghost[a]&&ghost[b]?ghost[a]/(ghost[a]+ghost[b]):null;
  return {a,b,share:balance(this.doc.items,a,b),target,x:clamp(at.x,120,W-120),y:at.y};
 }

 // ---- Hands.
 private handsStep(list:TrackedHand[],h:number,W:number,H:number){
  const s=this.scene;s.hands=list.map(x=>({id:x.id,pose:x.pose,points:x.landmarks.map(p=>this.world.stage(p))}));
  for(const id of [...this.hands.keys()])if(!list.some(x=>x.id===id))this.hands.delete(id);
  for(const hand of list){
   const palm=this.world.stage(hand.palm);let st=this.hands.get(hand.id);
   if(!st||st.pose!==hand.pose){
    const trail=st?.trail??[];st={pose:hand.pose,since:this.t,fired:false,tried:false,x:palm.x,y:palm.y,angle:this.roll(hand)??0,trail,up:null};this.hands.set(hand.id,st);
    this.greet(hand.pose,palm);
   }
  }
  for(const hand of list)this.oneHand(hand,this.hands.get(hand.id)!,h,W,H);
  // A pinch that let go, or a hand that vanished, starts the grace window instead of setting the vial down at once.
  for(const g of this.holding)if(g.hand>=0&&g.releasedAt<0){const hand=list.find(x=>x.id===g.hand);if(!hand||hand.pose!=='pinch'){g.releasedAt=this.t;g.loose=true;}}
  if(s.story.gestures.includes('rub'))this.rubStep(list,H);
  const poses=list.map(x=>x.pose);
  if(poses.includes('pinch'))s.lit.push(poses.filter(p=>p==='pinch').length>1?'both':'pinch');
  if(poses.includes('fist'))s.lit.push('fist');if(poses.includes('thumbDown'))s.lit.push('undo');
 }
 private greet(pose:HandPose,at:Px){
  if(pose==='fist'){const live=this.scene.story.ribbonLive;this.ack(at,live?'✊ Turn like a dial: move through the day':'✊ Smell your palm first, then you can move through the day',!live,'fist');if(!live)this.sound('miss');return;}
  if(pose==='thumbDown'){this.ack(at,'👎 Hold to undo',false,'thumbDown');return;}
  const g=greetings[pose];if(g){this.ack(at,g[0],g[1],`pose:${pose}`);if(g[1])this.sound('miss');}
 }
 private oneHand(hand:TrackedHand,st:HandState,h:number,W:number,H:number){
  const s=this.scene,palm=this.world.stage(hand.palm),pinch=this.world.stage(hand.pinch),age=this.t-st.since,ratio=this.ratio(hand);
  const mine=this.holding.find(g=>g.hand===hand.id&&g.releasedAt<0);
  if(hand.pose==='pinch'){
   if(mine)this.move(mine,hand,pinch,h);
   else if(!st.tried){
    st.tried=true;
    const loose=this.holding.filter(g=>g.releasedAt>=0).sort((a,b)=>Math.hypot(a.x-pinch.x,a.y-pinch.y)-Math.hypot(b.x-pinch.x,b.y-pinch.y))[0];
    if(loose&&Math.hypot(loose.x-pinch.x,loose.y-pinch.y)<REATTACH){loose.hand=hand.id;loose.releasedAt=-1;loose.loose=false;this.move(loose,hand,pinch,h);}
    else if(s.offer&&this.inOffer(pinch)){this.poked=true;this.ack(pinch,'🤏 On we go');this.next();}
    else{const slot=this.nearest(pinch);this.poked=true;if(slot)this.tryPick(slot,hand.id,pinch,this.roll(hand)??0);else{this.ack(pinch,'🤏 Nothing in reach: close the pinch on a vial',true,`miss:${hand.id}`);this.sound('miss');}}
   }
  }else if(!mine&&ratio<NEAR&&(hand.pose==='open'||hand.pose==='none')){
   const slot=this.nearest(pinch),offer=s.offer&&this.inOffer(pinch);
   s.reticles.push({x:pinch.x,y:pinch.y,close:clamp((NEAR-ratio)/(NEAR-SHUT),0,1),target:offer?'offer':slot?.id??null});
   if(offer)s.offerHot=true;else if(slot)s.hover={id:slot.id,x:pinch.x,y:pinch.y};
  }
  if(hand.pose==='point'){const tip=this.world.stage(hand.indexTip),slot=this.nearest(tip);if(slot)s.hover={id:slot.id,x:tip.x,y:tip.y};}
  if(hand.pose==='open'&&!mine)this.waftStep(st,palm,pinch,ratio,H);else st.trail.length=0;
  if(hand.pose==='fist'&&s.story.ribbonLive){
   const angle=this.roll(hand)??st.angle;
   if(age<FIST_ENGAGE){s.holds.push({x:palm.x,y:palm.y,glyph:'✊',label:'Day',progress:age/FIST_ENGAGE});st.x=palm.x;st.angle=angle;}
   else{const turn=wrapAngle(angle-st.angle)+(palm.x-st.x)/TURN_PX*Math.PI;st.angle=angle;st.x=palm.x;this.setClock(s.clock+turn/Math.PI*HOURS_PER_PI);s.scrubbing=true;}
  }
  if(hand.pose==='thumbDown'&&!st.fired){
   s.holds.push({x:palm.x,y:palm.y,glyph:'👎',label:'Undo',progress:Math.min(1,age/UNDO_HOLD)});
   if(age>=UNDO_HOLD){st.fired=true;this.undo(palm);}
  }
 }
 /** Up stroke previews at the hand; the turn back down commits. Reaching for a vial never ends in a turn back, and one that ends near a vial does not count. */
 private waftStep(st:HandState,palm:Px,pinch:Px,ratio:number,H:number){
  const tr=st.trail;tr.push({t:this.t,x:palm.x,y:palm.y});while(tr.length&&this.t-tr[0].t>WAFT_WINDOW)tr.shift();
  if(ratio<.85||this.t-this.lastWaft<WAFT_COOLDOWN){tr.length=0;st.up=null;return;}
  const low=Math.max(...tr.map(p=>p.y)),i=tr.findIndex(p=>p.y===low),top=Math.min(...tr.slice(i).map(p=>p.y)),rise=(low-top)/H;
  const near=this.nearest(pinch,40);
  // While a waft is what the line asks for, one blocked by a nearby vial is still answered.
  if(near&&rise>=WAFT_UP&&this.scene.story.beat==='waft')this.ack(palm,'🖐 Wave a little away from the vials',true,'waft-near');
  if(rise>=WAFT_UP*.5&&!near)this.scene.waftPreview={x:palm.x,y:palm.y,k:Math.min(1,rise/WAFT_UP)};
  if(rise>=WAFT_UP&&!near&&(palm.y-top)/H>=WAFT_BACK&&Math.abs(tr[tr.length-1].x-tr[i].x)<(low-top)*1.5){tr.length=0;this.waft(palm);}
 }
 private rubStep(list:TrackedHand[],H:number){
  const r=this.rub,pair=list.filter(x=>x.pose!=='pinch'&&x.pose!=='fist');
  if(pair.length<2){r.rel=[];r.times=[];r.dir=0;r.last=NaN;return;}
  const [a,b]=pair.map(x=>this.world.stage(x.palm)),pts=pair.map(x=>x.landmarks.map(p=>this.world.stage(p))),size=pts[0].length>9?Math.hypot(pts[0][9].x-pts[0][0].x,pts[0][9].y-pts[0][0].y):H*.1;
  if(Math.hypot(a.x-b.x,a.y-b.y)>size*2.4){r.times=[];r.dir=0;r.last=NaN;return;}
  const rel=a.y-b.y;
  if(Number.isNaN(r.last)){r.last=rel;return;}
  const d=rel-r.last;
  if(Math.abs(d)>=RUB_AMP){const dir=Math.sign(d);if(r.dir&&dir!==r.dir)r.times.push(this.t);r.dir=dir;r.last=rel;}
  r.times=r.times.filter(t=>this.t-t<RUB_WINDOW);
  const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  if(r.times.length)this.scene.holds.push({x:mid.x,y:mid.y,glyph:'🙌',label:'Warm',progress:Math.min(1,r.times.length/RUB_TURNS)});
  if(r.times.length>=RUB_TURNS&&this.t-r.fired>2){r.fired=this.t;r.times=[];this.toggleWarm(mid);}
 }

 // ---- Picking and pouring.
 private tryPick(slot:Slot,hand:number,at:Px,rest=0){
  const s=this.scene,name=ingredient(slot.id).name;
  if(!s.story.active.includes(slot.id)){
   const why=s.story.beat==='intro'?'One moment: read the line at the top':s.story.chapter===2&&slot.id==='oakmoss'?'Oakmoss is limited now: use the stand-in':'First, the lavender';
   this.ack(at,`🤏 ${name} · ${why}`,true,`miss:${hand}`);this.sound('miss');return;
  }
  if(this.holding.some(g=>g.id===slot.id&&!g.loose)){this.ack(at,`${name} is already in a hand`,true,`miss:${hand}`);this.sound('miss');return;}
  const old=this.holding.find(g=>g.id===slot.id);if(old)this.commit(old);
  this.holding.push({hand,id:slot.id,x:at.x,y:at.y,tilt:0,rate:0,inZone:false,poured:0,loose:false,rest,releasedAt:-1,tick:0,downAt:null});
  this.ack(at,`🤏 ${name}: tilt your wrist to pour`,false,`pick:${hand}`);this.sound('pick');
 }
 private move(g:Holding,hand:TrackedHand,p:Px,h:number){
  g.x=p.x;g.y=p.y;const roll=this.roll(hand);
  if(roll!==null){const raw=wrapAngle(roll-g.rest);g.tilt+=(raw-g.tilt)*EASE(h,TILT_TAU);}
 }
 private pour(g:Holding,drops:number){
  if(g.poured===0&&g.id==='moss-accord'&&!this.doc.swap&&this.doc.items.oakmoss>0)this.swap({x:g.x,y:g.y});
  const items={...this.doc.items};items[g.id]=(items[g.id]??0)+drops;this.doc={...this.doc,items};g.poured+=drops;
  const n=Math.floor(g.poured+1e-9);if(n>g.tick){g.tick=n;this.sound('tick');}
 }
 private commit(g:Holding){
  const i=this.holding.indexOf(g);if(i<0)return;this.holding.splice(i,1);
  const name=ingredient(g.id).name,n=Math.round(g.poured*10)/10;
  if(g.poured>.05){this.history.push(`${n} drops of ${name}`,pourUndo(g.id,g.poured));this.ack({x:g.x,y:g.y},`${name} down · ${n} drop${n===1?'':'s'} poured`,false,`down:${g.hand}`);this.sound('drop');}
  else{this.ack({x:g.x,y:g.y},`${name} back · nothing poured`,true,`down:${g.hand}`);this.sound('return');}
  clean(this.doc);
 }
 private commitAll(){for(const g of [...this.holding])this.commit(g);}
 private inOffer(p:Px){const o=this.scene.offer;return !!o&&Math.abs(p.x-o.x)<o.w/2+10&&Math.abs(p.y-o.y)<o.h/2+10;}
 /** The nearest visible vial whose hit circle (plus `pad`) holds the point, not one already in a hand. */
 private nearest(p:Px,pad=0):Slot|null{
  let best:Slot|null=null,bd=Infinity;
  for(const sl of this.scene.slots){if(this.holding.some(g=>g.id===sl.id&&!g.loose))continue;const d=Math.hypot(sl.x-p.x,sl.y-p.y);if(d<sl.r+pad&&d<bd){bd=d;best=sl;}}
  return best;
 }
 private roll(hand:TrackedHand){return handRoll(hand.landmarks.length>=21?hand.landmarks.map(p=>this.world.stage(p)):[]);}
 private ratio(hand:TrackedHand){
  const l=hand.landmarks;if(l.length<21)return Infinity;
  const a=this.world.stage(l[4]),b=this.world.stage(l[8]),w=this.world.stage(l[0]),m=this.world.stage(l[9]),palm=Math.hypot(w.x-m.x,w.y-m.y);
  return palm>1?Math.hypot(a.x-b.x,a.y-b.y)/palm:Infinity;
 }
 private puff(words:string[],miss:boolean){const p=this.scene.palm;this.scene.puffs.push({id:++this.ackId,words,x:p.x,y:p.y-40,age:0,miss});if(this.scene.puffs.length>4)this.scene.puffs.shift();}
 /** A keyed chip replaces its predecessor, so a held gesture does not stack copies. */
 private ack(at:Px,text:string,miss=false,key?:string){
  const acks=this.scene.acks;
  if(key){const old=this.ackKeys.get(key),i=acks.findIndex(a=>a.id===old);if(i>=0){if(acks[i].text===text&&acks[i].age<ACK_LIFE*.6){acks[i].x=at.x;acks[i].y=at.y;return;}acks.splice(i,1);}}
  const id=++this.ackId;if(key)this.ackKeys.set(key,id);
  acks.push({id,x:at.x,y:at.y,text,miss,age:0});if(acks.length>6)acks.shift();
 }
 private sound(type:OrganSound['type']){this.sounds.push({type});}
}
export type {Ack,Hold,Reticle};
