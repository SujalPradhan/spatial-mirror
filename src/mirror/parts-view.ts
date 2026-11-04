import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MeshSurfaceSampler} from 'three/addons/math/MeshSurfaceSampler.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

import {MIRROR_ZOOM_MAX,MIRROR_ZOOM_MIN,type MirrorPoint,type MirrorView,type MirrorViewState,type WorldPoint} from './contracts';
import {PartsOverlay,type PartsOverlayScene} from './parts-overlay';
import {mirrorToStage} from './projection';

export type MeshSkin='glass'|'frosted'|'xray';
export const meshSkins:MeshSkin[]=['glass','frosted','xray'];
type Vec3=readonly [number,number,number];
export type MeshShape=
 |{kind:'lathe';profile:readonly (readonly [number,number])[];axis?:'x';at?:Vec3}
 |{kind:'helix';radius:number;wire:number;turns:number;y0:number;y1:number;endTurns:number}
 /** Any closed solid with position and normal, for bodies a lathe cannot turn. */
 |{kind:'geometry';build:()=>T.BufferGeometry};
export interface MeshLook {color:string;metalness?:number;roughness?:number;opacity?:number;shell?:boolean;cut?:string;layer?:number;
 /** Steady emissive share of the base colour, for bodies that glow by transmission, like a liquid held to the light. */
 selfLit?:number;
 /** Added to the pick score: negative lets a tiny part win against the bulk around it, within half the pick radius. */
 pickBias?:number}
export interface MeshPartSpec {id:string;title:string;role:string;shape:MeshShape;look:MeshLook;explode:Vec3;removable:boolean}
export interface MeshOptions {
 parts:MeshPartSpec[];
 /** Same as parts, but never picked or counted: fluids, voids, anything that must cut cleanly. */
 extras?:MeshPartSpec[];
 /** World units per model unit, and the model point that sits at the origin. */
 unit:number;center:Vec3;
 canvasClass?:string;
 onFrame?:(frame:MeshFrame)=>void;
}
export interface MeshSlice {amount:number;x:number;
 /** Radians: the cut's normal is (cos yaw,0,sin yaw). Defaults to the molecule's yaw. */
 yaw?:number}
export interface MeshScene extends PartsOverlayScene {
 /** 0 assembled to 1 fully apart along each part's explode offset. */
 explode:number;
 /** partCount*3 world-space displacements on top of explode. */
 partOffsets:Float32Array;
 /** partCount values in 0..1. */
 partGlow:Float32Array;
 slice:MeshSlice;skin:MeshSkin;
 /** Ids of parts or extras not drawn at all. */
 hidden?:ReadonlySet<string>;
 /** Opacity multiplier by id, for fading a shell away. */
 fade?:Readonly<Record<string,number>>;
 /** Model scale on top of the pose, for moving in further than zoom can. */
 scale?:number;
}
/** Per-frame access for object-specific animation. `motion` sits inside the explode transform and is the hook's to move. */
export interface MeshPart {spec:MeshPartSpec;group:T.Group;motion:T.Group}
export interface MeshFrame {now:number;dt:number;scene:MeshScene;view:MeshPartsView}

const PICK_RADIUS=.3,SHELL_PENALTY=1.5,PICK_SAMPLES=600,LATHE_SEGMENTS=72,CORNER=.6;
// As on the molecule: a pure x cut is edge-on to the camera, so the default plane is yawed toward the viewer.
const DEFAULT_YAW=.62,FAR=1e5,FIELD_SPREAD=.55;

/** Splits at corners so edges stay crisp: LatheGeometry alone smooths normals right round a closed profile. */
function latheGeometry(profile:readonly (readonly [number,number])[]) {
 let loop=profile.map(([r,y])=>new T.Vector2(r,y));
 let area=0;for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];area+=a.x*b.y-b.x*a.y;}
 if(area<0)loop=loop.reverse();
 const n=loop.length,corner=loop.map((p,i)=>{
  const a=p.clone().sub(loop[(i+n-1)%n]),b=loop[(i+1)%n].clone().sub(p);
  return Math.abs(Math.atan2(a.x*b.y-a.y*b.x,a.dot(b)))>CORNER||p.x<1e-6;
 });
 const start=Math.max(0,corner.indexOf(true)),runs:T.Vector2[][]=[];
 let run=[loop[start]];
 for(let i=1;i<=n;i++){
  const p=loop[(start+i)%n],last=run[run.length-1];
  if(p.x<1e-6&&last.x<1e-6){run=[p];continue;}
  run.push(p);
  if(corner[(start+i)%n]){runs.push(run);run=[p];}
 }
 const parts=runs.filter(r=>r.length>1).map(r=>{const g=new T.LatheGeometry(r,LATHE_SEGMENTS);g.deleteAttribute('uv');return g;});
 const merged=mergeGeometries(parts,false)!;
 parts.forEach(p=>p.dispose());
 return merged;
}
/** Sealed tube, since the slice caps count entries and exits and an open end would leak. */
function helixGeometry(s:Extract<MeshShape,{kind:'helix'}>) {
 class Coil extends T.Curve<T.Vector3> {
  constructor(){super();}
  getPoint(t:number,target=new T.Vector3()){
   const turn=t*s.turns,live=s.turns-2*s.endTurns,height=s.y1-s.y0-s.wire*2;
   const flat=(s.endTurns*s.wire*2)/height,u=turn<s.endTurns?turn/s.endTurns*flat:turn>s.turns-s.endTurns?1-(s.turns-turn)/s.endTurns*flat:flat+(turn-s.endTurns)/live*(1-2*flat);
   const a=turn*Math.PI*2;
   return target.set(Math.cos(a)*s.radius,s.y0+s.wire+u*height,Math.sin(a)*s.radius);
  }
 }
 const steps=Math.ceil(s.turns*36),sides=10,tube=new T.TubeGeometry(new Coil(),steps,s.wire,sides,false),pos=tube.attributes.position,nor=tube.attributes.normal;
 const verts:number[]=Array.from(pos.array),normals:number[]=Array.from(nor.array),index:number[]=Array.from(tube.index!.array);
 const seal=(ring:number,flip:boolean)=>{
  const at=(ring*(sides+1)),c=new T.Vector3();
  for(let i=0;i<sides;i++)c.add(new T.Vector3().fromBufferAttribute(pos,at+i));
  c.divideScalar(sides);
  const hub=verts.length/3;verts.push(c.x,c.y,c.z);normals.push(0,flip?-1:1,0);
  for(let i=0;i<sides;i++)flip?index.push(hub,at+i,at+i+1):index.push(hub,at+i+1,at+i);
 };
 seal(0,true);seal(steps,false);
 tube.dispose();
 const g=new T.BufferGeometry();
 g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setIndex(index);
 return g;
}
function partGeometry(shape:MeshShape) {
 if(shape.kind==='helix')return helixGeometry(shape);
 if(shape.kind==='geometry')return shape.build();
 const g=latheGeometry(shape.profile);
 if(shape.axis==='x')g.rotateZ(-Math.PI/2);
 if(shape.at)g.translate(...shape.at);
 return g;
}

/** A shell is clear face-on and dense at grazing angles, which is what makes thin glass read against a dark stage. */
function fresnelAlpha(material:T.MeshPhysicalMaterial) {
 material.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`#include <opaque_fragment>
  {float facing=abs(dot(normalize(vNormal),normalize(vViewPosition)));gl_FragColor.a=clamp(gl_FragColor.a*(.55+pow(1.-facing,2.2)*4.),0.,1.);}`);
 };
 return material;
}
const xrayVert=/* glsl */`
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vN,vV;
void main(){
 vec4 mvPosition=modelViewMatrix*vec4(position,1.);
 vN=normalize(normalMatrix*normal);vV=normalize(-mvPosition.xyz);
 gl_Position=projectionMatrix*mvPosition;
 #include <clipping_planes_vertex>
}`;
const xrayFrag=/* glsl */`
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uTint;uniform float uGlow,uFade;varying vec3 vN,vV;
void main(){
 #include <clipping_planes_fragment>
 float rim=pow(1.-abs(dot(normalize(vN),normalize(vV))),1.7);
 float a=(.05+rim*.9)*(1.+uGlow*2.)*uFade;
 gl_FragColor=vec4(mix(uTint,vec3(.8,.95,1.),rim*.5)*a,a*.4);
}`;

interface Entry extends MeshPart {
 skins:Record<MeshSkin,T.Material>;base:Record<'glass'|'frosted',number>;mesh:T.Mesh;
 cap:T.Mesh<T.PlaneGeometry,T.MeshBasicMaterial>;capColor:T.Color;emissive:T.Color;
 stencil:T.Mesh[];samples:Float32Array;pickable:boolean;
}
const v=new T.Vector3(),rootInverse=new T.Quaternion(),hot=new T.Color('#ffffff');

/** Lit mesh objects on the same transparent stage as the molecule, with the same mirror and pose mapping. Knows nothing about any object. */
export class MeshPartsView implements MirrorView<MeshScene> {
 readonly ready:Promise<void>;
 readonly scene=new T.Scene();
 readonly camera=new T.PerspectiveCamera(37,1,.1,100);
 readonly renderer:T.WebGLRenderer;
 readonly root=new T.Group();
 /** Model space: put object-specific effects here. */
 readonly body=new T.Group();
 readonly partCount:number;
 private readonly entries:Entry[]=[];
 private readonly byId=new Map<string,Entry>();
 private readonly clip=new T.Plane(new T.Vector3(1,0,0),FAR);
 private readonly clips=[this.clip];
 private readonly env:T.Texture;
 private readonly resizeObserver:ResizeObserver;
 private readonly center:T.Vector3;
 private readonly unit:number;
 private readonly onFrame?:(frame:MeshFrame)=>void;
 private readonly overlay:PartsOverlay;
 private sliceN=new T.Vector3(1,0,0);
 private sliceP=new T.Vector3();
 private sliced=false;
 private videoAspect=0;
 private zoom=1;
 private lastNow=0;
 private disposed=false;
 private contextLost=false;
 private width=1;
 private height=1;
 /** Screen pixels per world unit at the origin, for sizing point sprites. */
 pixelsPerUnit=1;

 constructor(readonly host:HTMLElement,options:MeshOptions) {
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,stencil:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
  this.renderer.setClearColor(0,0);
  this.renderer.localClippingEnabled=true;
  this.renderer.toneMapping=T.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure=1.05;
  this.renderer.domElement.className=options.canvasClass??'mirror-canvas';
  this.renderer.domElement.setAttribute('aria-hidden','true');
  host.prepend(this.renderer.domElement);
  this.camera.position.set(0,0,13);
  this.unit=options.unit;this.center=new T.Vector3(...options.center);this.onFrame=options.onFrame;
  this.partCount=options.parts.length;
  this.scene.add(this.root);this.root.add(this.body);
  const pmrem=new T.PMREMGenerator(this.renderer);
  const room=new RoomEnvironment();
  this.env=pmrem.fromScene(room,.03).texture;
  this.scene.environment=this.env;this.scene.environmentIntensity=.9;
  pmrem.dispose();
  room.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});
  const key=new T.DirectionalLight('#fff4e6',1.5);key.position.set(-4,6,7);
  const rim=new T.DirectionalLight('#9fd8ff',1.1);rim.position.set(6,2,-6);
  this.scene.add(key,rim);
  options.parts.forEach(spec=>this.build(spec,true));
  (options.extras??[]).forEach(spec=>this.build(spec,false));
  this.layerCaps();
  this.overlay=new PartsOverlay(this.scene,host);
  this.renderer.domElement.addEventListener('webglcontextlost',this.onContextLost);
  this.renderer.domElement.addEventListener('webglcontextrestored',this.onContextRestored);
  this.resizeObserver=new ResizeObserver(()=>this.resize());
  this.resizeObserver.observe(host);
  this.resize();
  this.ready=Promise.resolve();
 }
 private readonly onContextLost=(event:Event)=>{
  event.preventDefault();this.contextLost=true;
  this.host.dispatchEvent(new CustomEvent('mirror-render-error',{bubbles:true,detail:'The 3D view paused. Reload if it does not recover.'}));
 };
 private readonly onContextRestored=()=>{this.contextLost=false;this.renderer.render(this.scene,this.camera);};

 private build(spec:MeshPartSpec,pickable:boolean) {
  const look=spec.look,geometry=partGeometry(spec.shape),color=new T.Color(look.color),opacity=look.opacity??1,shell=!!look.shell;
  const physical=(p:T.MeshPhysicalMaterialParameters)=>new T.MeshPhysicalMaterial({clippingPlanes:this.clips,clipShadows:false,side:shell?T.DoubleSide:T.FrontSide,...p});
  const glass=(shell&&opacity<.6?fresnelAlpha:(m:T.MeshPhysicalMaterial)=>m)(physical({color,metalness:look.metalness??0,roughness:look.roughness??.4,opacity,transparent:opacity<1,depthWrite:!shell,envMapIntensity:shell?.8:1,clearcoat:look.metalness?0:.4,clearcoatRoughness:.2,specularIntensity:1}));
  const frosted=physical({color:color.clone().lerp(hot,.25),metalness:0,roughness:.62,opacity:shell?.2:.62,transparent:true,depthWrite:!shell,envMapIntensity:.8});
  const xray=new T.ShaderMaterial({vertexShader:xrayVert,fragmentShader:xrayFrag,uniforms:{uTint:{value:color.clone()},uGlow:{value:0},uFade:{value:1}},transparent:true,depthWrite:false,depthTest:false,side:T.DoubleSide,blending:T.AdditiveBlending,clipping:true,clippingPlanes:this.clips});
  const group=new T.Group(),motion=new T.Group(),mesh=new T.Mesh(geometry,glass);
  mesh.renderOrder=shell?100+(look.layer??0):0;
  group.add(motion);motion.add(mesh);this.body.add(group);
  // Stencil counts back faces minus front faces per part, leaving 1 wherever the plane passes through solid.
  const stencilBase={depthWrite:false,depthTest:false,colorWrite:false,stencilWrite:true,stencilFunc:T.AlwaysStencilFunc,clippingPlanes:this.clips,transparent:true};
  const stencil=([[T.BackSide,T.IncrementWrapStencilOp],[T.FrontSide,T.DecrementWrapStencilOp]] as const).map(([side,op])=>{
   const m=new T.Mesh(geometry,new T.MeshBasicMaterial({...stencilBase,side,stencilFail:op,stencilZFail:op,stencilZPass:op}));
   m.visible=false;motion.add(m);return m;
  });
  const capColor=new T.Color(look.cut??look.color);
  const cap=new T.Mesh(new T.PlaneGeometry(60,60),new T.MeshBasicMaterial({color:capColor.clone(),side:T.DoubleSide,transparent:true,toneMapped:false,stencilWrite:true,stencilRef:0,stencilFunc:T.NotEqualStencilFunc,stencilFail:T.ReplaceStencilOp,stencilZFail:T.ReplaceStencilOp,stencilZPass:T.ReplaceStencilOp}));
  cap.visible=false;cap.onAfterRender=renderer=>renderer.clearStencil();
  this.scene.add(cap);
  // Sampled over the surface, not from vertices: a straight lathe wall has none between its ends.
  const samples=new Float32Array(pickable?PICK_SAMPLES*3:0);
  if(pickable){const sampler=new MeshSurfaceSampler(mesh).build();for(let i=0;i<PICK_SAMPLES;i++){sampler.sample(v);samples[i*3]=v.x;samples[i*3+1]=v.y;samples[i*3+2]=v.z;}}
  const entry:Entry={spec,group,motion,mesh,skins:{glass,frosted,xray},base:{glass:opacity,frosted:frosted.opacity},cap,capColor,emissive:color.clone(),stencil,samples,pickable};
  this.entries.push(entry);this.byId.set(spec.id,entry);
 }
 /** Stencil pair then cap, part by part: each cap must land before the next part dirties the stencil. */
 private layerCaps() {
  [...this.entries].sort((a,b)=>(a.spec.look.layer??0)-(b.spec.look.layer??0)).forEach((e,i)=>{
   e.stencil.forEach(m=>{m.renderOrder=10+i*2;});
   e.cap.renderOrder=11+i*2;
  });
 }
 private resize() {
  if(this.disposed)return;
  this.width=Math.max(1,this.host.clientWidth);this.height=Math.max(1,this.host.clientHeight);
  this.renderer.setSize(this.width,this.height,false);
  this.camera.aspect=this.width/this.height;
  this.camera.position.z=this.width<700?15:13;
  this.applyCamera();
  if(!this.contextLost)this.renderer.render(this.scene,this.camera);
 }
 private applyCamera() {
  this.camera.zoom=this.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
  this.pixelsPerUnit=this.renderer.getPixelRatio()*this.height*this.zoom/(2*Math.tan(T.MathUtils.degToRad(this.camera.fov/2))*this.camera.position.z);
 }
 setPose(view:MirrorViewState) {
  if(this.disposed)return;
  this.root.quaternion.fromArray(view.q).normalize();
  this.root.position.set(view.x,view.y,0);
  this.root.updateMatrixWorld(true);
  this.zoom=Math.min(MIRROR_ZOOM_MAX,Math.max(MIRROR_ZOOM_MIN,view.zoom));
  if(this.camera.zoom!==this.zoom)this.applyCamera();
 }
 setVideoAspect(aspect:number){this.videoAspect=aspect;}
 mirrorToWorld(point:MirrorPoint):WorldPoint {
  const stage=mirrorToStage(point.x,point.y,this.videoAspect,this.width/this.height);
  return this.unproject(stage.x*2-1,1-stage.y*2,Math.max(-1,Math.min(1,-point.z*1.4)));
 }
 pointToWorld(clientX:number,clientY:number):WorldPoint {
  const rect=this.renderer.domElement.getBoundingClientRect();
  return this.unproject((clientX-rect.left)/(rect.width||1)*2-1,1-(clientY-rect.top)/(rect.height||1)*2,0);
 }
 private unproject(ndcX:number,ndcY:number,z:number):WorldPoint {
  const c=this.camera.position;
  v.set(ndcX,ndcY,.5).unproject(this.camera).sub(c);
  const t=(z-c.z)/v.z;
  return {x:c.x+v.x*t,y:c.y+v.y*t,z};
 }
 /** The part under a world point, nearest along the camera ray, or -1. A see-through shell loses to what is inside it. */
 partAt(point:WorldPoint) {
  const c=this.camera.position;
  v.set(point.x-c.x,point.y-c.y,point.z-c.z);
  const reach=v.length();
  if(!reach)return -1;
  const dx=v.x/reach,dy=v.y/reach,dz=v.z/reach;
  let best=-1,bestScore=Infinity;
  for(let n=0;n<this.partCount;n++){
   const e=this.entries[n],s=e.samples,m=e.mesh.matrixWorld.elements,shell=e.spec.look.shell?SHELL_PENALTY:0,bias=e.spec.look.pickBias??0;
   if(!e.group.visible)continue;
   for(let i=0;i<s.length;i+=3){
    const a=s[i],b=s[i+1],q=s[i+2];
    const x=m[0]*a+m[4]*b+m[8]*q+m[12],y=m[1]*a+m[5]*b+m[9]*q+m[13],z=m[2]*a+m[6]*b+m[10]*q+m[14];
    if(this.sliced&&(x-this.sliceP.x)*this.sliceN.x+(z-this.sliceP.z)*this.sliceN.z>0)continue;
    const px=x-c.x,py=y-c.y,pz=z-c.z,along=px*dx+py*dy+pz*dz;
    if(along<=0)continue;
    const off=Math.sqrt(Math.max(0,px*px+py*py+pz*pz-along*along))*reach/along;
    if(off>PICK_RADIUS)continue;
    // Depth decides among parts under the point, so a solid outer part beats what it encloses; only a shell gives way.
    const score=Math.max(off,.1)+along*.6+shell+(bias<0&&off>PICK_RADIUS/2?0:bias);
    if(score<bestScore){bestScore=score;best=n;}
   }
  }
  return best;
 }
 partInfo(index:number) {
  const e=index>=0&&index<this.partCount?this.entries[index]:null;
  return e?{id:e.spec.id,title:e.spec.title,role:e.spec.role,removable:e.spec.removable}:{id:'',title:'',role:'',removable:false};
 }
 part(id:string):MeshPart|undefined {return this.byId.get(id);}
 /** The live colour of a part's cut face, for an object that retints a part after building it. */
 cutColor(id:string):T.Color|undefined {return this.byId.get(id)?.capColor;}
 draw(scene:MeshScene,now:number) {
  if(this.disposed||this.contextLost)return;
  const dt=Math.min(.1,Math.max(0,(now-this.lastNow)/1000));
  this.lastNow=now;
  this.applySlice(scene.slice);
  this.applyParts(scene);
  this.onFrame?.({now,dt,scene,view:this});
  this.root.updateMatrixWorld(true);
  this.overlay.update(scene,this.camera,this.width,this.height);
  this.renderer.render(this.scene,this.camera);
 }
 private applySlice(slice:MeshSlice) {
  this.sliced=slice.amount>0;
  const yaw=slice.yaw??DEFAULT_YAW;
  this.sliceN.set(Math.cos(yaw),0,Math.sin(yaw));this.sliceP.set(slice.x,0,0);
  // The plane stays in the material list when off: dropping it would recompile every shader on each toggle.
  this.clip.normal.copy(this.sliceN).negate();
  this.clip.constant=this.sliced?this.sliceN.dot(this.sliceP):FAR;
 }
 /** How far an open hand's field parts this piece: the screen plane decides, since webcam depth is unreliable. */
 private fieldSpread(p:Entry,scene:MeshScene,k:number) {
  let most=0;
  if(!scene.fields?.length)return most;
  p.mesh.geometry.boundingSphere??p.mesh.geometry.computeBoundingSphere();
  v.copy(p.mesh.geometry.boundingSphere!.center).multiplyScalar(k).add(this.body.position).applyQuaternion(this.root.quaternion).add(this.root.position);
  for(const f of scene.fields){const d=Math.hypot(v.x-f.x,v.y-f.y)/f.radius;if(d<1)most=Math.max(most,f.strength*FIELD_SPREAD*(1-d*d));}
  return most;
 }
 private applyParts(scene:MeshScene) {
  const k=this.unit*(scene.scale??1),e=Math.max(0,Math.min(1,scene.explode)),offsets=scene.partOffsets,glows=scene.partGlow;
  this.body.scale.setScalar(k);
  this.body.position.copy(this.center).multiplyScalar(-k);
  rootInverse.copy(this.root.quaternion).invert();
  for(let i=0;i<this.entries.length;i++){
   const p=this.entries[i],o=i*3,on=!scene.hidden?.has(p.spec.id),fade=scene.fade?.[p.spec.id]??1,glow=i<this.partCount&&i<glows.length?glows[i]:0;
   p.group.visible=on;
   const apart=Math.min(1,e+this.fieldSpread(p,scene,k));
   p.group.position.set(p.spec.explode[0]*apart,p.spec.explode[1]*apart,p.spec.explode[2]*apart);
   if(i<this.partCount&&o+2<offsets.length){
    v.set(offsets[o],offsets[o+1],offsets[o+2]).applyQuaternion(rootInverse).divideScalar(k);
    p.group.position.add(v);
   }
   const material=p.skins[scene.skin];
   if(p.mesh.material!==material)p.mesh.material=material;
   if(scene.skin==='xray'){const u=(material as T.ShaderMaterial).uniforms;u.uGlow.value=glow;u.uFade.value=fade;}
   else {
    const m=material as T.MeshPhysicalMaterial,base=p.base[scene.skin];
    m.opacity=base*fade;m.transparent=base<1||fade<1;
    m.emissive.copy(p.emissive);m.emissiveIntensity=(p.spec.look.selfLit??0)+glow*.8;
    p.mesh.renderOrder=m.transparent?100+(p.spec.look.layer??0):0;
    if(!p.spec.look.shell)m.depthWrite=fade>=1;
   }
   p.stencil.forEach(s=>{s.visible=on&&this.sliced;});
   p.cap.visible=on&&this.sliced;
   if(this.sliced){
    p.cap.position.copy(this.sliceP);
    p.cap.lookAt(v.copy(this.sliceP).add(this.sliceN));
    p.cap.material.color.copy(p.capColor).lerp(hot,glow*.5);
    p.cap.material.opacity=fade;
   }
  }
 }
 dispose() {
  if(this.disposed)return;
  this.disposed=true;
  this.overlay.dispose();
  this.resizeObserver.disconnect();
  this.renderer.domElement.removeEventListener('webglcontextlost',this.onContextLost);
  this.renderer.domElement.removeEventListener('webglcontextrestored',this.onContextRestored);
  const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();
  for(const e of this.entries)Object.values(e.skins).forEach(m=>materials.add(m));
  this.scene.traverse(object=>{
   if(object instanceof T.Mesh||object instanceof T.Points){
    geometries.add(object.geometry);
    for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
   }
  });
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  this.env.dispose();
  this.renderer.dispose();this.renderer.domElement.remove();
  this.scene.clear();
 }
}
