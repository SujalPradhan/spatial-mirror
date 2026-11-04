import * as T from 'three';
import {MeshPartsView,type MeshFrame,type MeshScene} from '../mirror/parts-view';
import type {MirrorField,MirrorHandView,MirrorShock,MirrorViewState} from '../mirror/contracts';
import {clamp} from '../mirror/engine';
import {cutYaw,slotOffset} from './behaviour';
import type {PerfumeScene,PerfumeWorld} from './contracts';
import {fragrances,silhouettes,type Silhouette} from './flacon';
import {liquidY,type Spray} from './model';
import {PerfumeOverlay,type Leader} from './overlay';
import {dims,pumpExtras,pumpParts,type PartId} from './parts';
import {DryDown,DRY,ScentCloud,pickNote,type Hand} from './scent';
import {PumpSpray,SwirlChamber} from './spray';
import {Studio} from './studio';

const UNIT=.05,CENTER=[0,47,0] as const;
/** Past the zoom limit the camera can reach, Dive grows the model around the pump, fades the bottle and cuts everything open. */
export const DIVE_FROM=1.8,DIVE_TO=2.4,DIVE_SCALE=1.3,DIVE_FOCUS_Y=80;
/** Apart, the object is half as tall again, so the view eases back to keep it on stage: but only once the hands let go, so nothing slides out from under the fingers mid-tear. */
const APART_SCALE=.7,APART_FOCUS_Y=76,APART_TAU=.35;
/** Zoom at which the dive cue starts to show how near the threshold is. */
export const DIVE_CUE=1.35;
/** Seconds a 🤟 morph takes, and how long the cap waits on an untouched bottle before it settles back. */
const MORPH_S=.9,CAP_REST_S=2.5;
const moving=['actuator','nozzle','stem','piston','fluid-stem','fluid-duct','fluid-swirl','socket'];
/** Liquid and voids stay inside whatever holds them when parts move. */
const inside:Record<string,string>={liquid:'bottle','fluid-tube':'tube','fluid-cage':'body','fluid-chamber':'body','fluid-stem':'stem','fluid-duct':'actuator','fluid-swirl':'nozzle',socket:'actuator'};
/** Tiny parts are grown once out, or a 2mm ball vanishes beside a bottle. Each with its own middle, model millimetres. */
const shown:Record<string,{scale:number;x:number;y:number}>={ball:{scale:3,x:0,y:55.4},nozzle:{scale:2,x:5.6,y:95.5}};
/** The atelier's second line for each part. */
const brief:Record<string,string>={bottle:'thick crystal, 50 ml bore',liquid:'the perfume',cap:'sculpted, lifts away',tube:'drinks from the bottom',body:'cylinder and valve seat',ball:'one-way valve',spring:'returns the stroke',piston:'builds the pressure',stem:'carries liquid up',collar:'knurled, clamps the neck',actuator:'the button',nozzle:'swirl chamber and orifice'};
const fluids=['liquid','fluid-tube','fluid-cage','fluid-chamber','fluid-stem','fluid-duct','fluid-swirl'];
const fade=(t:number)=>{const k=clamp(t,0,1);return k*k*(3-2*k);};
const v=new T.Vector3(),w=new T.Vector3(),pivot=new T.Vector3(0,96,0),Z=new T.Vector3(0,0,1);
const palette=(pick:(s:Silhouette)=>string)=>silhouettes.map(s=>new T.Color(pick(s)));
const gold=new T.Color('#f3cf86'),black=new T.Color('#070708');
const deep=palette(s=>fragrances[s].deep),light=palette(s=>fragrances[s].light),tints=palette(s=>fragrances[s].tint);

/** Draws the pump from a scene: the only place that knows which part moves how, and how the scent looks. */
export class PerfumeView extends MeshPartsView implements PerfumeWorld {
 private spray=new PumpSpray();private scent=new ScentCloud();private dry=new DryDown();private studio:Studio;private html:PerfumeOverlay;private swirl:SwirlChamber;
 private offsets=new Float32Array(pumpParts.length*3);private hiddenIds=new Set<string>();
 private pose:MirrorViewState={q:[0,0,0,1],zoom:1,x:0,y:0};private dive=0;private slot=new Float32Array(3);
 private note=document.createElement('p');private still=matchMedia('(prefers-reduced-motion: reduce)');
 /** Morph weights per silhouette, where a morph started, and how far through it is. */
 readonly weights=new Float32Array([1,0,0]);private from=new Float32Array([1,0,0]);private target=0;private morphT=1;private worn=-1;
 private skin:Silhouette='tower';private lift=0;private restT=0;private catchWeight=0;private catching=false;private catchAt={x:0,y:0};private dryHand=-1;private kind:Spray='none';
 private slowFor=0;private lastDraw=0;
 /** The explode share the framing follows: held while two pinches tear, then eased to the live value. */
 private apart=0;private apartAt=0;private cue=document.createElement('div');
 private tips=new Map<number,{x:number;y:number}>();private seen=new WeakSet<MirrorShock>();
 private nozzle=new T.Vector3();private aim=new T.Vector3();private mix={deep:new T.Color(),light:new T.Color(),tint:new T.Color()};private at=new T.Vector3();
 constructor(host:HTMLElement){
  super(host,{parts:pumpParts,extras:pumpExtras,unit:UNIT,center:CENTER,canvasClass:'mirror-canvas perfume-canvas',onFrame:f=>this.animate(f)});
  const clips=(this.part('bottle')!.motion.children[0] as T.Mesh).material as T.Material;
  this.studio=new Studio(this.renderer,this.scene,clips.clippingPlanes!);
  this.swirl=new SwirlChamber(clips.clippingPlanes!,4.1,7.25,dims.ductY,.92,.26);
  this.body.add(this.spray.points,this.swirl.group,this.studio.floor);this.scene.add(this.scent.points,this.dry.points);
  this.html=new PerfumeOverlay(host);
  this.note.className='perfume-caption';this.note.setAttribute('aria-live','polite');host.parentElement?.append(this.note);
  this.cue.className='perfume-dive-cue';this.cue.hidden=true;this.cue.setAttribute('aria-hidden','true');this.cue.innerHTML='<b></b><i><s></s><em></em></i>';host.parentElement?.append(this.cue);
 }
 // ---- Read by tests and the shell's debug handle.
 get droplets(){return this.spray.live;}
 get wisps(){return this.scent.count;}
 get notes(){return [...this.scent.byNote];}
 get stirred(){return this.scent.stirred;}
 get caught(){return this.dry.dots;}
 get dryClock(){return this.dry.clock;}
 get swirling(){return this.swirl.live;}
 get capLift(){return this.lift;}
 get labels(){return {notes:this.html.notesOn,dry:this.html.dryOn,lens:this.html.lensOn,leaders:this.html.leaderCount};}
 inFlight(){return this.spray.live+this.scent.count;}
 /** A model point on the spray axis, mm beyond the orifice, in world units: where a palm catches. */
 plume(mm:number){const a=this.part('actuator')!.group.position;return v.set(dims.nozzleTipX+mm+a.x,dims.ductY+a.y,a.z).applyMatrix4(this.body.matrixWorld).clone();}

 override setPose(view:MirrorViewState){super.setPose(view);this.pose=view;}
 override draw(input:MeshScene,now:number){
  const scene=input as unknown as PerfumeScene;this.skin=scene.skin;
  const pump=scene.pump,o=this.offsets,base=scene.partOffsets,d=this.dive=fade((this.pose.zoom-DIVE_FROM)/(DIVE_TO-DIVE_FROM)),hidden=this.hiddenIds;
  hidden.clear();
  if(pump.removed.has('nozzle'))hidden.add('fluid-swirl');
  if(pump.removed.has('tube'))hidden.add('fluid-tube');
  // Diving in, a floating cap would fill the view: it waits off stage.
  if(d>.4&&!pump.removed.has('cap'))hidden.add('cap');
  pumpParts.forEach((p,i)=>{
   const a=scene.parked[i]??0,at=i*3;
   for(let k=0;k<3;k++)o[at+k]=base[at+k];
   if(!a&&!scene.parkFrom[at]&&!scene.parkFrom[at+1]&&!scene.parkFrom[at+2])return;
   slotOffset(p.id,this.pose,this.slot,0);
   for(let k=0;k<3;k++)o[at+k]+=scene.parkFrom[at+k]*(1-a)+this.slot[k]*a;
  });
  // A palm held in the mist catches it instead of parting the pump.
  const c=this.catchWeight,fields=c>0?scene.fields.map((f:MirrorField)=>Math.hypot(f.x-this.catchAt.x,f.y-this.catchAt.y)<.6?{...f,strength:f.strength*(1-c)}:f):scene.fields;
  this.frame(scene,now);
  super.draw({...scene,partOffsets:o,hidden,fields,skin:'glass',scale:(1+(DIVE_SCALE-1)*d)*(1-(1-APART_SCALE)*this.apart),fade:d?{bottle:1-d*.68,liquid:1-d*.7}:undefined,
   // The pose has moved the axis off world x=0, and the bores are narrower than that offset.
   slice:{amount:Math.max(scene.slice.amount,d),x:this.pose.x,yaw:cutYaw(this.pose)}} as never,now);
  if(this.note.textContent!==scene.caption)this.note.textContent=scene.caption;
  this.diveCue();
  this.adapt(now);
 }
 /** Read by tests: the explode share the framing follows. */
 get framedApart(){return this.apart;}
 private frame(scene:PerfumeScene,now:number){
  const dt=this.apartAt?Math.min(.1,Math.max(0,(now-this.apartAt)/1000)):0;this.apartAt=now;
  const tearing=scene.hands.filter(h=>h.pose==='pinch').length>1;
  if(!tearing)this.apart+=(scene.explode-this.apart)*(1-Math.exp(-dt/APART_TAU));
  if(Math.abs(this.apart-scene.explode)<1e-3&&!tearing)this.apart=scene.explode;
 }
 /** As Scale nears the dive, a bar shows how much further to spread; past it, that the view is inside. */
 private diveCue(){
  const z=this.pose.zoom,near=clamp((z-DIVE_CUE)/(DIVE_FROM-DIVE_CUE),0,1),inside=this.dive,show=z>DIVE_CUE&&inside<.98;
  if(this.cue.hidden===show)this.cue.hidden=!show;
  if(!show)return;
  const text=inside>0?'Diving inside the pump':near>.98?'Spread a little more to dive inside':'Keep spreading to dive inside',b=this.cue.querySelector('b')!;
  if(b.textContent!==text)b.textContent=text;
  (this.cue.querySelector('s') as HTMLElement).style.width=`${(near*100).toFixed(1)}%`;(this.cue.querySelector('em') as HTMLElement).style.width=`${(inside*100).toFixed(1)}%`;
  this.cue.classList.toggle('is-in',inside>0);
 }
 /** Glass and soft wisps are fill-heavy: a machine that cannot keep up gets fewer pixels, never below half, rather than a stuttering hand. */
 private adapt(now:number){
  const ms=now-this.lastDraw;this.lastDraw=now;
  if(ms<=0||ms>1000)return;
  this.slowFor=ms>60?this.slowFor+ms:Math.max(0,this.slowFor-ms);
  const r=this.renderer,ratio=r.getPixelRatio();
  if(this.slowFor<1000||ratio<=.5)return;
  const next=Math.max(.5,ratio*.7),size=r.getSize(new T.Vector2());
  r.setPixelRatio(next);r.setSize(size.x,size.y,false);this.pixelsPerUnit*=next/ratio;this.slowFor=0;
 }
 private mesh(id:string){return this.part(id)!.motion.children[0] as T.Mesh;}
 private animate({dt,scene,view}:MeshFrame){
  const s=scene as unknown as PerfumeScene,{pump,parked,explode}=s,part=(id:string)=>view.part(id)!,travel=pump.depth*dims.strokeMm,bottomY=dims.pistonBottomY-travel,still=this.still.matches,time=s.time??1;
  // World y is fixed by the pose, so the focus moves here rather than in the saved view.
  const k=view.body.scale.x;view.body.position.y-=(this.dive*(DIVE_FOCUS_Y-CENTER[1])+this.apart*(APART_FOCUS_Y-CENTER[1]))*k;
  const out=(id:string)=>pump.removed.has(id as PartId);
  for(const id of moving)part(id).motion.position.y=out(id)?0:-travel;
  const stretch=(id:string,from:number,top:number,rest:number)=>{const m=part(id).motion,s=Math.max(.001,(top-from)/(rest-from));m.scale.y=s;m.position.y=from*(1-s);};
  const surface=liquidY(pump.liquidMl);
  stretch('liquid',dims.baseY,surface,dims.fullY);
  if(out('spring'))stretch('spring',dims.chamberFloorY,dims.pistonBottomY-.1,dims.pistonBottomY-.1);else stretch('spring',dims.chamberFloorY,bottomY-.1,dims.pistonBottomY-.1);
  // The fluid columns run from what the model says is primed: dead volume first, then the swept dose on top.
  const sweptBottom=dims.pistonBottomY-dims.strokeMm,dead=dims.chamberFloorY+(sweptBottom-dims.chamberFloorY)*pump.tubeFill;
  stretch('fluid-chamber',dims.chamberFloorY,Math.min(bottomY,dead+dims.strokeMm*pump.chamberFill),dims.pistonBottomY);
  const tubeTop=Math.min(54.3,surface+(54.3-surface)*pump.tubeFill);
  stretch('fluid-tube',dims.tubeEndY,Math.max(dims.tubeEndY+.01,tubeTop),54.3);
  part('ball').motion.position.y=out('ball')?0:dims.ballLiftMm*pump.valveLift;
  pumpParts.forEach((p,i)=>{
   const size=shown[p.id];if(!size)return;
   const group=part(p.id).group,s=1+(size.scale-1)*(parked[i]??0);
   group.scale.setScalar(s);group.position.x-=size.x*(s-1);group.position.y-=size.y*(s-1);
  });
  for(const [fluid,holder] of Object.entries(inside))part(fluid).group.position.copy(part(holder).group.position);
  if(pump.spray!=='none')this.kind=pump.spray;
  this.morph(dt,this.skin,still);
  this.dress(s,dt,still);
  view.root.updateMatrixWorld(true);
  // Where the orifice is now, and which way it points, in world units.
  const tip=part('actuator').group.position,m=this.body.matrixWorld,me=m.elements;
  this.nozzle.set(dims.nozzleTipX+tip.x,dims.ductY-travel+tip.y,tip.z).applyMatrix4(m);
  this.aim.set(1,0,0).transformDirection(m);
  const hands=s.hands.map(h=>this.hand(h)),palms=s.hands.map((h,i)=>h.pose==='open'?hands[i]:null);
  // The mist runs from the orifice along the nozzle's axis: a palm a little way down that cone is catching, not parting.
  const ax=this.aim.x,ay=this.aim.y,al=Math.hypot(ax,ay)||1;let catcher:Hand|null=null;
  for(const p of palms){if(!p)continue;const rx=p.x-this.nozzle.x,ry=p.y-this.nozzle.y,t=(rx*ax+ry*ay)/al,off=Math.abs(rx*ay-ry*ax)/al;if(t>.25&&t<5.5&&off<.75+.45*t){catcher=p;break;}}
  this.catching=!!catcher;this.catchWeight=clamp(this.catchWeight+(catcher?1:-1)*dt/.15,0,1);
  if(catcher){this.catchAt.x=catcher.x;this.catchAt.y=catcher.y;this.dryHand=catcher.id;}
  const px=view.pixelsPerUnit*this.camera.position.z,radius=catcher?Math.max(.35,Math.hypot(catcher.ux,catcher.uy)*1.05):0;
  const scent=this.scent,dry=this.dry;
  this.spray.update({kind:explode>.05?'none':pump.spray,x:dims.nozzleTipX+tip.x,y:dims.ductY-travel+tip.y,z:tip.z,dt,px:px*k,time,rewind:s.rewind??-1,
   catcher:catcher?{m:me,x:catcher.x,y:catcher.y,r:radius}:null,
   caught:(x,y)=>{if(Math.random()<.3)dry.land(x,y);},
   // A droplet that has finished flying becomes scent: mostly from mist, little from a wasteful jet, none from a dribble.
   settled:(x,y,z,vx,vy,vz,kind)=>{
    if(Math.random()>(kind==='mist'?.11:kind==='jet'?.04:kind==='sputter'?.08:0))return;
    v.set(x,y,z).applyMatrix4(m);w.set(vx,vy,vz).transformDirection(m).multiplyScalar(Math.hypot(vx,vy,vz)*k*.18);
    scent.spawn(v.x,v.y,v.z,w.x+(Math.random()-.5)*.2,w.y+(Math.random()-.5)*.2,w.z,pickNote());
   }});
  for(const shock of s.shocks){
   if(this.seen.has(shock))continue;this.seen.add(shock);
   // 👐 Bloom: one burst from the bottle fills the stage, then settles and evaporates note by note.
   for(let i=0;i<240;i++){const a=Math.random()*Math.PI*2,r=1.2+Math.random()*4.6;scent.spawn(this.nozzle.x,this.nozzle.y-.3,this.nozzle.z,Math.cos(a)*r,Math.sin(a)*r*.75,(Math.random()-.5)*1.2,pickNote(),1.3);}
  }
  const fingers:{x:number;y:number;vx:number;vy:number}[]=[];
  s.hands.forEach(h=>{
   if(h.pose!=='point'||h.joints.length<21){this.tips.delete(h.id);return;}
   const tip=h.joints[8],was=this.tips.get(h.id);
   fingers.push({x:tip.x,y:tip.y,vx:was&&dt>0?(tip.x-was.x)/dt:0,vy:was&&dt>0?(tip.y-was.y)/dt:0});this.tips.set(h.id,{x:tip.x,y:tip.y});
  });
  const drawn=scent.update({dt,time,still,rewind:s.rewind??-1,home:this.nozzle,fingers,palm:catcher},px);
  for(let i=0;i<drawn;i++)dry.land(catcher!.x+(Math.random()-.5)*radius,catcher!.y+(Math.random()-.5)*radius);
  const worn=s.hands.find(h=>h.id===this.dryHand),wornHand=worn?hands[s.hands.indexOf(worn)]:null;
  dry.update(dt,wornHand,this.catching,px);
  const nozzleAt=part('nozzle').group.position;
  this.swirl.update(dt*time,pump.spray==='mist',this.dive*(out('nozzle')?0:1),v.set(nozzleAt.x,nozzleAt.y-travel,nozzleAt.z),px*k);
  const shift=this.weights[1];
  this.studio.update(dt,still,{x:view.root.position.x,y:view.root.position.y,tint:this.mix.light,sides:this.weights[0]*8+this.weights[1]*12+this.weights[2]*6,stretch:1+.17*shift,floor:(1-explode)*(1-this.dive)});
  this.annotate(s,travel,wornHand,dt);
 }
 /** Palm centre and axes on the screen plane, from the drawn joints. */
 private hand(h:MirrorHandView):Hand {
  const j=h.joints;if(j.length<21)return {id:h.id,x:0,y:0,z:0,ux:0,uy:0,wx:0,wy:0};
  let x=0,y=0,z=0;for(const i of [0,5,9,13,17]){x+=j[i].x;y+=j[i].y;z+=j[i].z;}
  return {id:h.id,x:x/5,y:y/5,z:z/5,ux:j[9].x-j[0].x,uy:j[9].y-j[0].y,wx:j[17].x-j[5].x,wy:j[17].y-j[5].y};
 }
 /** 🤟 eases every vertex from one flacon to the next, and the juice, glass tint and notes with it. */
 private morph(dt:number,skin:string,still:boolean){
  const target=Math.max(0,silhouettes.indexOf(skin as Silhouette)),w=this.weights;
  if(target!==this.target){this.target=target;this.from.set(w);this.morphT=still?1:0;}
  this.morphT=Math.min(1,this.morphT+dt/MORPH_S);const e=fade(this.morphT);
  for(let i=0;i<3;i++)w[i]=this.from[i]*(1-e)+(i===target?e:0);
  for(const id of ['bottle','cap'])for(const child of this.part(id)!.motion.children){const t=(child as T.Mesh).morphTargetInfluences;if(t)for(let i=0;i<3;i++)t[i]=w[i];}
  const mix=this.mix;mix.deep.setRGB(0,0,0);mix.light.setRGB(0,0,0);mix.tint.setRGB(0,0,0);
  for(let i=0;i<3;i++){mix.deep.add(deep[i].clone().multiplyScalar(w[i]));mix.light.add(light[i].clone().multiplyScalar(w[i]));mix.tint.add(tints[i].clone().multiplyScalar(w[i]));}
  const lead=w.indexOf(Math.max(...w));
  if(lead!==this.worn){
   this.worn=lead;const f=fragrances[silhouettes[lead]];
   this.scent.fragrance(f);this.dry.fragrance(f);this.html.fragrance(f);this.spray.tint(new T.Color(f.light));
   // Cut faces and the pump's own liquid columns take the juice's colour.
   for(const id of fluids){this.cutColor(id)?.set(f.light);if(id!=='liquid')((this.mesh(id).material as T.MeshPhysicalMaterial).color as T.Color).set(f.light);}
  }
 }
 /** Swaps in the luxury materials, fades for Dive, and floats the cap away while anything is happening. */
 private dress(s:PerfumeScene,dt:number,still:boolean){
  const L=this.studio.looks,d=this.dive,index=(id:string)=>pumpParts.findIndex(p=>p.id===id);
  const use=(id:string,material:T.Material,order:number)=>{const m=this.mesh(id);m.material=material;m.renderOrder=order;};
  use('bottle',L.glass,0);use('liquid',L.liquid,50);use('cap',L.cap,0);use('collar',L.collar,0);use('actuator',L.actuator,0);
  for(const id of ['collar','actuator'] as const)L[id].emissiveIntensity=(s.partGlow[index(id)]??0)*.3;
  const glassFade=1-d*.68,clear=glassFade<.999;
  if(L.glass.transparent!==clear){L.glass.transparent=clear;L.glass.needsUpdate=true;}
  // Nearly colourless crystal: only a breath of the juice's tint, so the liquid reads as a separate volume inside.
  L.glass.opacity=glassFade;L.glass.attenuationColor.set('#ffffff').lerp(this.mix.tint,.1);
  const lacquer=this.weights[2];L.cap.metalness=1-lacquer;L.cap.roughness=.12-lacquer*.06;L.cap.clearcoat=lacquer;L.cap.color.copy(gold).lerp(black,lacquer);L.cap.emissiveIntensity=(s.partGlow[index('cap')]??0)*.3;
  const t=this.studio.liquidTint;t.uDeep.value.copy(this.mix.deep);t.uLight.value.copy(this.mix.light);t.uAlpha.value=.8*(1-d*.7);
  // The liquid sits inset in the bore; a lower alpha lets the clear glass round it read as glass.
  const busy=s.hands.length>0||s.pump.depth>.002||this.spray.live>0||this.scent.count>0||d>.02||s.slice.amount>0||!!s.label||s.explode>.02;
  this.restT=busy?0:this.restT+dt;
  const up=!s.pump.removed.has('cap')&&(busy||this.restT<CAP_REST_S)&&(busy||this.lift>0)?1:0;
  this.lift=clamp(this.lift+(up?dt/.14:-dt/.7),0,1);
  const e=fade(this.lift)*(1-s.explode),cap=this.part('cap')!.motion,bob=still?0:Math.sin(performance.now()/900)*1.2;
  cap.quaternion.setFromAxisAngle(Z,.18*e);
  cap.position.copy(pivot).sub(v.copy(pivot).applyQuaternion(cap.quaternion)).add(v.set(-31*e,(bob-9)*e,6*e));
 }
 private screen(p:T.Vector3,out={x:0,y:0}){v.copy(p).project(this.camera);out.x=(v.x+1)/2*this.host.clientWidth;out.y=(1-v.y)/2*this.host.clientHeight;return out;}
 private centre(id:string){const m=this.mesh(id);m.geometry.boundingSphere??m.geometry.computeBoundingSphere();return this.at.copy(m.geometry.boundingSphere!.center).applyMatrix4(m.matrixWorld);}
 /** Labels in HTML: notes by their clouds, the dry-down by the palm, the loupe in bullet time, and gold leaders for the atelier and the dive. */
 private annotate(s:PerfumeScene,travel:number,hand:Hand|null,dt:number){
  const o=this.html,W=this.host.clientWidth,H=this.host.clientHeight;
  o.notesAt(this.scent.labels.map(l=>({...this.screen(v.set(l.x,l.y,l.z)),weight:l.weight})));
  o.dry(hand&&this.dry.clock>=0?this.screen(v.set(hand.x,hand.y,hand.z)):null,[0,1,2].map(i=>this.dry.level(i)));
  const bullet=(s.time??1)<.5&&this.spray.live>0;
  if(bullet){
   const from=this.screen(v.set(dims.nozzleTipX+26,dims.ductY-travel,0).add(this.part('actuator')!.group.position).applyMatrix4(this.body.matrixWorld));
   o.lensAt({x:clamp(from.x+150,100,W-100),y:clamp(from.y-150,100,H-100),fromX:from.x,fromY:from.y},this.kind,dt);
  }else o.lensAt(null,'none',dt);
  const list:Leader[]=[];
  if(s.explode>.3){
   const left:Leader[]=[],right:Leader[]=[];
   pumpParts.forEach((p,i)=>{
    if(this.hiddenIds.has(p.id)||p.id==='liquid')return;
    const a=this.screen(this.centre(p.id)),side=p.explode[0]<0?left:right;
    side.push({x:a.x,y:a.y,text:`<i>${String(i+1).padStart(2,'0')}</i>${p.title}`,small:brief[p.id],lx:0,ly:a.y,align:side===left?'right':'left'});
   });
   const column=(list:Leader[],x:number)=>{list.sort((a,b)=>a.y-b.y);let y=-Infinity;for(const l of list){l.ly=Math.max(l.y,y+38);y=l.ly;l.lx=x;}const over=y-(H-130);if(over>0)for(const l of list)l.ly-=over;};
   column(left,clamp(Math.min(...left.map(l=>l.x))-80,170,W));column(right,clamp(Math.max(...right.map(l=>l.x))+60,0,W-190));
   list.push(...left,...right);
  }else if(this.dive>.5){
   const a=this.screen(v.set(5.4,dims.ductY-travel,0).add(this.part('nozzle')!.group.position).applyMatrix4(this.body.matrixWorld));
   list.push({x:a.x,y:a.y,text:'Swirl chamber',small:'tangential slots spin the liquid',lx:a.x-60,ly:a.y-90,align:'right'});
   if(this.swirl.live>0){const b=this.screen(v.set(dims.nozzleTipX+22,dims.ductY-travel+7,0).add(this.part('nozzle')!.group.position).applyMatrix4(this.body.matrixWorld));list.push({x:b.x,y:b.y,text:'Hollow cone',small:'a spinning sheet breaks into droplets',lx:b.x+40,ly:b.y-70,align:'left'});}
  }else if((s.rewind??-1)>=0&&this.inFlight()>0){
   const a=this.screen(this.nozzle);list.push({x:a.x,y:a.y,text:'Rewind',small:'the mist streams home',lx:a.x+50,ly:a.y-60,align:'left'});
  }
  o.leaders(list,fade((s.explode-.3)/.4));
 }
 override dispose(){this.note.remove();this.cue.remove();this.html.dispose();this.studio.dispose();super.dispose();}
}
