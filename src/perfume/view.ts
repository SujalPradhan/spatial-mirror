import {MeshPartsView,type MeshFrame} from '../mirror/parts-view';
import type {MirrorViewState} from '../mirror/contracts';
import {clamp} from '../mirror/engine';
import {cutYaw,slotOffset} from './behaviour';
import type {PerfumeScene,PerfumeWorld} from './contracts';
import {liquidY} from './model';
import {dims,pumpExtras,pumpParts,type PartId} from './parts';
import {PumpSpray} from './spray';

const UNIT=.05,CENTER=[0,50,0] as const;
/** Past the zoom limit the camera can reach, Dive grows the model around the pump, fades the bottle and cuts everything open. */
export const DIVE_FROM=1.8,DIVE_TO=2.4,DIVE_SCALE=1.3,DIVE_FOCUS_Y=77;
/** Apart, the object is half as tall again, so the view eases back to keep it on stage. */
const APART_SCALE=.8,APART_FOCUS_Y=78;
const moving=['actuator','nozzle','stem','piston','fluid-stem','fluid-duct','fluid-swirl','socket'];
/** Liquid and voids stay inside whatever holds them when parts move. */
const inside:Record<string,string>={liquid:'bottle','fluid-tube':'tube','fluid-cage':'body','fluid-chamber':'body','fluid-stem':'stem','fluid-duct':'actuator','fluid-swirl':'nozzle',socket:'actuator'};
/** Tiny parts are grown once out, or a 2mm ball vanishes beside a bottle. Each with its own middle, model millimetres. */
const shown:Record<string,{scale:number;x:number;y:number}>={ball:{scale:3,x:0,y:55.4},nozzle:{scale:2,x:5.6,y:95.5}};
const fade=(t:number)=>{const k=clamp(t,0,1);return k*k*(3-2*k);};

/** Draws the pump from a scene: the only place that knows which part moves how. */
export class PerfumeView extends MeshPartsView implements PerfumeWorld {
 private spray=new PumpSpray();private offsets=new Float32Array(pumpParts.length*3);private hiddenIds=new Set<string>();
 private pose:MirrorViewState={q:[0,0,0,1],zoom:1,x:0,y:0};private dive=0;private slot=new Float32Array(3);
 private note=document.createElement('p');
 constructor(host:HTMLElement){
  super(host,{parts:pumpParts,extras:pumpExtras,unit:UNIT,center:CENTER,canvasClass:'mirror-canvas perfume-canvas',onFrame:f=>this.animate(f)});
  this.body.add(this.spray.points);
  this.note.className='perfume-caption';this.note.setAttribute('aria-live','polite');host.parentElement?.append(this.note);
 }
 get droplets(){return this.spray.live;}
 override setPose(view:MirrorViewState){super.setPose(view);this.pose=view;}
 override draw(scene:PerfumeScene,now:number){
  const pump=scene.pump,o=this.offsets,base=scene.partOffsets,d=this.dive=fade((this.pose.zoom-DIVE_FROM)/(DIVE_TO-DIVE_FROM)),hidden=this.hiddenIds;
  hidden.clear();
  // The cap comes off for good until something shows it: pressing happens with it away, and exploding brings it back.
  if(scene.explode<.02&&!pump.removed.has('cap'))hidden.add('cap');
  if(pump.removed.has('nozzle'))hidden.add('fluid-swirl');
  if(pump.removed.has('tube'))hidden.add('fluid-tube');
  pumpParts.forEach((p,i)=>{
   const a=scene.parked[i]??0,at=i*3;
   for(let k=0;k<3;k++)o[at+k]=base[at+k];
   if(!a&&!scene.parkFrom[at]&&!scene.parkFrom[at+1]&&!scene.parkFrom[at+2])return;
   slotOffset(p.id,this.pose,this.slot,0);
   for(let k=0;k<3;k++)o[at+k]+=scene.parkFrom[at+k]*(1-a)+this.slot[k]*a;
  });
  super.draw({...scene,partOffsets:o,hidden,scale:(1+(DIVE_SCALE-1)*d)*(1-(1-APART_SCALE)*scene.explode),fade:d?{bottle:1-d*.68,liquid:1-d*.7}:undefined,
   // The pose has moved the axis off world x=0, and the bores are narrower than that offset.
   slice:{amount:Math.max(scene.slice.amount,d),x:this.pose.x,yaw:cutYaw(this.pose)}} as never,now);
  if(this.note.textContent!==scene.caption)this.note.textContent=scene.caption;
 }
 private animate({dt,scene,view}:MeshFrame){
  const {pump,parked,explode}=scene as unknown as PerfumeScene&{parked:Float32Array},part=(id:string)=>view.part(id)!,travel=pump.depth*dims.strokeMm,bottomY=dims.pistonBottomY-travel;
  // World y is fixed by the pose, so the focus moves here rather than in the saved view.
  const k=view.body.scale.x;view.body.position.y-=(this.dive*(DIVE_FOCUS_Y-CENTER[1])+explode*(APART_FOCUS_Y-CENTER[1]))*k;
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
  const tip=part('actuator').group.position;
  this.spray.update(explode>.05?'none':pump.spray,dims.nozzleTipX+tip.x,dims.ductY-travel+tip.y,tip.z,dt,view.pixelsPerUnit*13*k);
 }
 override dispose(){this.note.remove();super.dispose();}
}
