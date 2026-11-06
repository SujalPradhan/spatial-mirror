import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {MIRROR_ZOOM_MAX,MIRROR_ZOOM_MIN,type MirrorPoint,type MirrorView,type MirrorViewState,type WorldPoint} from '../mirror/contracts';
import {mirrorToStage} from '../mirror/projection';
import type {GraspScene} from './contracts';
import {FINGERS,PALM,THUMB,add,forward,row,scale,tipOf,type Link,type V3} from './kinematics';
import {MUG_SIZE,OBJECTS,objectById,type GraspId} from './objects';
import {residualGlow} from './synergy';
import {PULLEY_MM,type WhiffleNode,type Branch} from './tendon';

/** World units per centimetre of hand. */
export const CM=.165;
const v=new T.Vector3(),ray=new T.Raycaster(),ndc=new T.Vector2();
/** Hand frame → world: fingers up, palm turned toward the object on the left, thumb side toward you. Mirrored, so it reads as a right hand. */
const handBasis=()=>new T.Matrix4().makeBasis(new T.Vector3(-.64,0,-.77),new T.Vector3(0,1,0),new T.Vector3(-.77,0,.64));
const ROBOT_AT=new T.Vector3(1.35,-1.45,0),GHOST_AT=new T.Vector3(-2.6,-1.3,-.3),GHOST_SCALE=.9;
const vec=(p:V3)=>new T.Vector3(p[0],p[1],p[2]);

function materials(){
 const m=(color:string,metalness:number,roughness:number,extra:T.MeshPhysicalMaterialParameters={})=>new T.MeshPhysicalMaterial({color,metalness,roughness,...extra});
 return {
  alu:m('#c6ccd3',1,.27,{clearcoat:.3,clearcoatRoughness:.35}),aluDark:m('#6f7882',1,.38),anodised:m('#20272f',.7,.42,{clearcoat:.4}),
  brass:m('#c99a45',1,.26,{clearcoat:.2}),steel:m('#9aa3ad',1,.3),rubber:m('#17191c',0,.75),
  ceramic:m('#e9e4da',0,.32,{clearcoat:.9,clearcoatRoughness:.12}),glaze:m('#1f5f86',0,.3,{clearcoat:1,clearcoatRoughness:.08}),pen:m('#e0473a',.1,.35,{clearcoat:.6}),penCap:m('#1d2128',.6,.3),
  egg:m('#e8cfa6',0,.6,{sheen:.4,sheenColor:new T.Color('#fff4e0')}),coin:m('#d8a94c',1,.22),die:m('#f3f1ea',0,.4,{clearcoat:.7}),acrylic:new T.MeshPhysicalMaterial({color:'#bfe6ff',metalness:0,roughness:.08,transmission:.85,thickness:.4,transparent:true,opacity:.22,depthWrite:false}),
  ghost:new T.MeshBasicMaterial({color:'#7fdcff',transparent:true,opacity:.2,blending:T.AdditiveBlending,depthWrite:false}),
  ghostEdge:new T.MeshBasicMaterial({color:'#bff1ff',transparent:true,opacity:.42,blending:T.AdditiveBlending,depthWrite:false}),
 };
}
type Mats=ReturnType<typeof materials>;
function glowTexture(){
 const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d')!,r=g.createRadialGradient(64,64,2,64,64,62);
 r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.25,'rgba(255,255,255,.55)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,128,128);
 const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
function dieTexture(){
 const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d')!;g.fillStyle='#f3f1ea';g.fillRect(0,0,128,128);g.fillStyle='#1b1d22';
 for(const [x,y] of [[32,32],[64,64],[96,96],[32,96],[96,32]]){g.beginPath();g.arc(x,y,11,0,Math.PI*2);g.fill();}
 const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
/** A phalanx: a machined bar with a fillet, running +y from its joint, gripping side +z. */
function phalanx(length:number,radius:number,mats:Mats,tip:boolean){
 const g=new T.Group(),w=radius*1.75,d=radius*1.6,body=new T.Mesh(new RoundedBoxGeometry(w,Math.max(.4,length-.35),d,3,radius*.45),mats.alu);
 body.position.y=length/2+.05;body.castShadow=true;g.add(body);
 const pad=new T.Mesh(new RoundedBoxGeometry(w*.8,Math.max(.3,length*.62),.3,2,.12),mats.rubber);pad.position.set(0,length*.55,d/2+.05);g.add(pad);
 if(tip){const cap=new T.Mesh(new T.SphereGeometry(radius*.88,20,12,0,Math.PI*2,0,Math.PI/2),mats.alu);cap.position.y=length-.1;cap.scale.set(1,.55,.92);g.add(cap);}
 // Side plates where the next joint's axle passes.
 for(const s of [-1,1]){const plate=new T.Mesh(new RoundedBoxGeometry(.16,1.2,d*.9,2,.06),mats.aluDark);plate.position.set(s*(w/2+.08),length-.2,0);g.add(plate);}
 return g;
}
function pulley(radius:number,width:number,mats:Mats){
 const g=new T.Group(),wheel=new T.Mesh(new T.CylinderGeometry(radius,radius,width,32),mats.brass),groove=new T.Mesh(new T.TorusGeometry(radius*.98,.06,8,32),mats.anodised),axle=new T.Mesh(new T.CylinderGeometry(.16,.16,width+.9,12),mats.steel);
 wheel.rotation.z=Math.PI/2;axle.rotation.z=Math.PI/2;groove.rotation.y=Math.PI/2;g.add(wheel,groove,axle);return g;
}
const basisOf=(l:Link,q:T.Quaternion)=>q.setFromRotationMatrix(new T.Matrix4().makeBasis(vec(l.axis),vec(l.along),vec(l.pad)));

/** A translucent human hand in the grasp joint model: a capsule per bone, a dot per joint, a palm and a wrist, and a red glow at each joint that is off. Its group sits at the wrist. */
export class GhostHand {
 readonly group=new T.Group();readonly hand=new T.Group();readonly residual:T.Sprite[]=[];
 private readonly links:T.Mesh[]=[];private readonly joints:T.Mesh[]=[];
 constructor(body:T.Material,private readonly edge:T.Material,glow:T.Texture,scale=CM*GHOST_SCALE){
  this.hand.matrixAutoUpdate=false;this.hand.matrix.copy(handBasis()).scale(new T.Vector3(scale,scale,scale));this.group.add(this.hand);
  for(let i=0;i<15;i++){
   const d=Math.floor(i/3),k=i%3,spec=d===0?{lengths:THUMB.lengths,radius:THUMB.radius}:FINGERS[d-1];
   const cap=new T.Mesh(new T.CapsuleGeometry(spec.radius[k]*.92,Math.max(.1,spec.lengths[k]-spec.radius[k]*1.2),6,14),body);cap.geometry.translate(0,spec.lengths[k]/2,0);this.links.push(cap);this.hand.add(cap);
   const joint=new T.Mesh(new T.SphereGeometry(.42,14,10),edge);this.joints.push(joint);this.hand.add(joint);
   const s=new T.Sprite(new T.SpriteMaterial({map:glow,color:'#ff3b30',transparent:true,blending:T.AdditiveBlending,depthWrite:false,depthTest:false,opacity:0}));s.renderOrder=5;this.residual.push(s);this.hand.add(s);
  }
  const palm=new T.Mesh(new RoundedBoxGeometry(PALM.x1-PALM.x0,PALM.y1-PALM.y0,1.8,4,.8),body);palm.position.set(0,(PALM.y1-PALM.y0)/2,-1);this.hand.add(palm);
  const wrist=new T.Mesh(new T.CapsuleGeometry(2.6,3,6,16),body);wrist.position.set(0,-2.4,-1);wrist.scale.set(1.1,1,.55);this.hand.add(wrist);
 }
 /** Poses the joints (0 flat to 1 fist), with finger spread and a residual per joint; the thumb dots take `unsureMat` while its reading is held. */
 pose(user:ArrayLike<number>,spread:[number,number,number,number],residual:ArrayLike<number>,thumbUnsure=false,unsureMat?:T.Material){
  forward(user,true,{abd:spread}).forEach((l,i)=>{
   this.links[i].position.copy(vec(l.origin));basisOf(l,this.links[i].quaternion);this.joints[i].position.copy(vec(l.origin));
   const r=residualGlow(residual[row(l.digit,l.k)]),sp=this.residual[i];sp.position.copy(vec(l.origin));sp.scale.setScalar(2+3*r);(sp.material as T.SpriteMaterial).opacity=r*.8;
   // A thumb the camera has lost is drawn dim and amber: it is holding its last good reading.
   this.joints[i].material=l.digit===0&&thumbUnsure&&unsureMat?unsureMat:this.edge;
  });
  this.group.visible=true;
 }
}

class Tendon {
 readonly line:Line2;private geo=new LineGeometry();
 constructor(color:string,width:number,res:T.Vector2,dashed=false){const mat=new LineMaterial({color,linewidth:width,worldUnits:false,transparent:true,opacity:.95,dashed,dashSize:.08,gapSize:.06,side:T.DoubleSide,depthTest:true});mat.resolution=res;this.line=new Line2(this.geo,mat);this.line.frustumCulled=false;this.line.renderOrder=3;}
 set(points:T.Vector3[]){const a:number[]=[];for(const p of points)a.push(p.x,p.y,p.z);if(a.length<6)a.push(a[0],a[1],a[2]);this.geo.dispose();this.geo=new LineGeometry();this.geo.setPositions(a);this.line.geometry=this.geo;this.line.computeLineDistances();}
 get material(){return this.line.material as LineMaterial;}
}

/** The stage: your ghost hand on the left, the robot on its stand on the right, the object between, tendons and whiffletrees showing. */
export class GraspView implements MirrorView<GraspScene> {
 readonly ready:Promise<void>;readonly scene=new T.Scene();readonly camera=new T.PerspectiveCamera(34,1,.1,100);readonly renderer:T.WebGLRenderer;
 readonly root=new T.Group();readonly partCount=0;
 readonly mats=materials();readonly glowMap=glowTexture();
 readonly robot=new T.Group();private readonly robotHand=new T.Group();readonly ghostHand:GhostHand;
 private readonly links:T.Group[]=[];private readonly pulleys:T.Group[]=[];
 private readonly residualSprites:T.Sprite[]=[];private readonly contactSprites:T.Sprite[]=[];private readonly forceLines:Tendon[]=[];
 private readonly objects=new Map<GraspId,T.Group>();readonly stand=new T.Group();private readonly bay=new T.Group();
 private readonly tendons:Tendon[]=[];private readonly bars:T.Mesh[]=[];private readonly spools:T.Group[]=[];private readonly fourBars:T.Mesh[]=[];
 private readonly res=new T.Vector2(1,1);private lastMotors=-1;
 private readonly resizeObserver:ResizeObserver;private videoAspect=0;private zoom=1;private width=1;private height=1;private disposed=false;private contextLost=false;
 /** Last drawn scene, for picking and labels. */
 last:GraspScene|null=null;
 constructor(readonly host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));this.renderer.setClearColor(0,0);
  this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.02;
  this.renderer.domElement.className='mirror-canvas';this.renderer.domElement.setAttribute('aria-hidden','true');host.prepend(this.renderer.domElement);
  this.camera.position.set(0,0,13.5);
  const pmrem=new T.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.scene.environment=pmrem.fromScene(room,.03).texture;this.scene.environmentIntensity=.85;pmrem.dispose();
  room.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});
  const key=new T.DirectionalLight('#fff1dc',1.7);key.position.set(-4,8,10);const rim=new T.DirectionalLight('#8fd2ff',1.1);rim.position.set(7,2,-6);
  this.scene.add(key,rim,new T.HemisphereLight('#c9dcff','#1a1410',.35),this.root);
  this.ghostHand=new GhostHand(this.mats.ghost,this.mats.ghostEdge,this.glowMap);
  this.root.add(this.robot,this.ghostHand.group);
  this.robot.position.copy(ROBOT_AT);this.ghostHand.group.position.copy(GHOST_AT);
  this.robotHand.matrixAutoUpdate=false;this.robotHand.matrix.copy(handBasis()).scale(new T.Vector3(CM,CM,CM));
  this.robot.add(this.robotHand);
  this.buildRobot();this.buildObjects();
  this.renderer.domElement.addEventListener('webglcontextlost',this.onLost);this.renderer.domElement.addEventListener('webglcontextrestored',this.onRestored);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
  this.ready=Promise.resolve();
 }
 private buildRobot(){
  const h=this.robotHand,m=this.mats;
  // Palm: an anodised chassis with an aluminium face plate, screws at the corners.
  const W=PALM.x1-PALM.x0,L=PALM.y1-PALM.y0,D=PALM.z1-PALM.z0;
  const chassis=new T.Mesh(new RoundedBoxGeometry(W,L,D,4,.7),m.anodised);chassis.position.set((PALM.x0+PALM.x1)/2,L/2,(PALM.z0+PALM.z1)/2);h.add(chassis);
  const face=new T.Mesh(new RoundedBoxGeometry(W-.5,L-.6,.35,3,.15),m.alu);face.position.set(chassis.position.x,L/2+.1,-.12);h.add(face);
  for(const [x,y] of [[-3.4,.9],[3.4,.9],[-3.4,8.6],[3.4,8.6]]){const s=new T.Mesh(new T.CylinderGeometry(.22,.22,.12,14),m.steel);s.rotation.x=Math.PI/2;s.position.set(x,y,.1);h.add(s);}
  // Forearm bay: an open frame holding the motors and the whiffletrees, so you can watch the pull split.
  const bayBack=new T.Mesh(new RoundedBoxGeometry(8.6,10.4,.4,3,.18),m.anodised);bayBack.position.set(0,-5.5,-2.3);h.add(bayBack);
  for(const x of [-4.2,4.2]){const rail=new T.Mesh(new RoundedBoxGeometry(.4,10.6,2.2,2,.15),m.aluDark);rail.position.set(x,-5.5,-1.3);h.add(rail);}
  const wrist=new T.Mesh(new RoundedBoxGeometry(8.4,1,2.4,3,.3),m.alu);wrist.position.set(0,-.4,-1.2);h.add(wrist);
  h.add(this.bay);
  // Phalanges and joint pulleys, posed each frame.
  for(let i=0;i<15;i++){
   const d=Math.floor(i/3),k=i%3,spec=d===0?{lengths:THUMB.lengths,radius:THUMB.radius}:FINGERS[d-1];
   const g=phalanx(spec.lengths[k],spec.radius[k],m,k===2);g.userData={row:row(d,k)};this.links.push(g);h.add(g);
   const r=Math.max(.42,(PULLEY_MM[row(d,k)]||5)/10*.75),p=pulley(r,spec.radius[k]*1.25,m);p.userData={row:row(d,k)};this.pulleys.push(p);h.add(p);
  }
  // The crossed four-bar that slaves each DIP to its PIP: two thin rods across the middle phalanx.
  for(let i=0;i<8;i++){const rod=new T.Mesh(new T.CylinderGeometry(.07,.07,1,8),m.steel);this.fourBars.push(rod);h.add(rod);}
  // Stand post the object waits on.
  const post=new T.Mesh(new T.CylinderGeometry(.05,.07,1,12),m.acrylic),foot=new T.Mesh(new T.CylinderGeometry(.35,.42,.05,32),m.acrylic);this.stand.add(post,foot);this.root.add(this.stand);
  for(let i=0;i<15;i++){const s=new T.Sprite(new T.SpriteMaterial({map:this.glowMap,color:'#ff3b30',transparent:true,blending:T.AdditiveBlending,depthWrite:false,depthTest:false,opacity:0}));s.renderOrder=5;this.residualSprites.push(s);this.robotHand.add(s);}
  for(let i=0;i<24;i++){const s=new T.Sprite(new T.SpriteMaterial({map:this.glowMap,color:'#fff2c2',transparent:true,blending:T.AdditiveBlending,depthWrite:false,depthTest:false,opacity:0}));s.renderOrder=6;this.contactSprites.push(s);this.robotHand.add(s);const f=new Tendon('#ffe9a8',2.2,this.res);this.forceLines.push(f);this.robotHand.add(f.line);}
 }
 private buildObjects(){
  const m=this.mats;
  for(const o of OBJECTS){
   const g=new T.Group(),s=o.shape.size;
   if(o.shape.kind==='mug'){
    const body=new T.Mesh(new T.CylinderGeometry(MUG_SIZE.r,MUG_SIZE.r*.96,MUG_SIZE.h*2,48,1,true),m.glaze),inner=new T.Mesh(new T.CylinderGeometry(MUG_SIZE.r*.9,MUG_SIZE.r*.88,MUG_SIZE.h*2-.3,48,1,true),m.glaze);
    inner.material=m.ceramic.clone();(inner.material as T.Material).side=T.BackSide;inner.position.y=.15;
    const base=new T.Mesh(new T.CylinderGeometry(MUG_SIZE.r*.96,MUG_SIZE.r*.96,.3,48),m.glaze);base.position.y=-MUG_SIZE.h+.15;
    const rim=new T.Mesh(new T.TorusGeometry(MUG_SIZE.r*.95,.14,10,48),m.ceramic);rim.rotation.x=Math.PI/2;rim.position.y=MUG_SIZE.h;
    const band=new T.Mesh(new T.CylinderGeometry(MUG_SIZE.r+.02,MUG_SIZE.r+.02,.5,48,1,true),m.ceramic);band.position.y=MUG_SIZE.h-1.4;
    const handle=new T.Mesh(new T.TorusGeometry(1.55,.42,14,32,Math.PI*1.25),m.glaze);handle.rotation.z=-Math.PI*.62;handle.position.set(0,0,-MUG_SIZE.r-.9);handle.rotation.y=Math.PI/2;
    // The mug's axis runs across the palm (hand x), so its cylinder is turned onto x.
    const turn=new T.Group();turn.add(body,inner,base,rim,band,handle);turn.rotation.z=Math.PI/2;g.add(turn);
   }else if(o.shape.kind==='capsule'){
    const half=s[0],body=new T.Mesh(new T.CylinderGeometry(s[1],s[1],half*2,24),m.pen);body.rotation.z=Math.PI/2;
    const cap=new T.Mesh(new T.CylinderGeometry(s[1]*1.06,s[1]*1.06,2.6,24),m.penCap);cap.rotation.z=Math.PI/2;cap.position.x=half-1.2;
    const tip=new T.Mesh(new T.ConeGeometry(s[1],1.4,24),m.steel);tip.rotation.z=Math.PI/2;tip.position.x=-half-.7;
    const clip=new T.Mesh(new RoundedBoxGeometry(2.2,.12,.3,2,.05),m.steel);clip.position.set(half-1.3,s[1]+.12,0);g.add(body,cap,tip,clip);
    // The pen's own middle is offset from its stand point: capX runs from -.9 to 7.5 about the centre.
    g.children.forEach(c=>{c.position.x+=3.3;});
   }else if(o.shape.kind==='ellipsoid'){const e=new T.Mesh(new T.SphereGeometry(1,40,28),m.egg);e.scale.set(s[0],s[1],s[2]);g.add(e);}
   else if(o.shape.kind==='disc'){const c=new T.Mesh(new T.CylinderGeometry(s[1],s[1],s[0]*2,40),m.coin);c.rotation.z=Math.PI/2;const ring=new T.Mesh(new T.TorusGeometry(s[1]*.82,.05,6,40),m.brass);ring.rotation.y=Math.PI/2;ring.position.x=-s[0];g.add(c,ring);}
   else {const map=dieTexture(),mat=m.die.clone();mat.map=map;const b=new T.Mesh(new RoundedBoxGeometry(s[0]*2,s[1]*2,s[2]*2,3,.18),mat);g.add(b);}
   g.position.copy(vec(o.centre));g.visible=false;this.objects.set(o.id,g);this.robotHand.add(g);
  }
 }
 private readonly onLost=(e:Event)=>{e.preventDefault();this.contextLost=true;this.host.dispatchEvent(new CustomEvent('mirror-render-error',{bubbles:true,detail:'The 3D view paused. Reload if it does not recover.'}));};
 private readonly onRestored=()=>{this.contextLost=false;};
 private resize(){
  if(this.disposed)return;this.width=Math.max(1,this.host.clientWidth);this.height=Math.max(1,this.host.clientHeight);
  this.renderer.setSize(this.width,this.height,false);this.camera.aspect=this.width/this.height;this.res.set(this.width,this.height);
  // Narrow screens step back so both hands stay in frame.
  this.camera.position.z=this.width/this.height<1.2?19:13.5;this.applyCamera();
 }
 private applyCamera(){this.camera.zoom=this.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();}
 get cameraZoom(){return this.camera.zoom;}
 setPose(view:MirrorViewState){
  if(this.disposed)return;this.root.quaternion.fromArray(view.q).normalize();this.root.position.set(view.x,view.y,0);this.root.updateMatrixWorld(true);
  this.zoom=Math.min(MIRROR_ZOOM_MAX,Math.max(MIRROR_ZOOM_MIN,view.zoom));if(this.camera.zoom!==this.zoom)this.applyCamera();
 }
 setVideoAspect(aspect:number){this.videoAspect=aspect;}
 private unproject(nx:number,ny:number,z:number):WorldPoint{const c=this.camera.position;v.set(nx,ny,.5).unproject(this.camera).sub(c);const t=(z-c.z)/v.z;return {x:c.x+v.x*t,y:c.y+v.y*t,z};}
 mirrorToWorld(p:MirrorPoint):WorldPoint{const s=mirrorToStage(p.x,p.y,this.videoAspect,this.width/this.height);return this.unproject(s.x*2-1,1-s.y*2,0);}
 pointToWorld(cx:number,cy:number):WorldPoint{const r=this.renderer.domElement.getBoundingClientRect();return this.unproject((cx-r.left)/(r.width||1)*2-1,1-(cy-r.top)/(r.height||1)*2,0);}
 partAt(){return -1;}
 /** A hand-frame point (cm) on the stage, pixels. */
 screenOf(p:V3,ghost=false){v.copy(vec(p)).applyMatrix4((ghost?this.ghostHand.hand:this.robotHand).matrixWorld).project(this.camera);return {x:(v.x+1)/2*this.width,y:(1-v.y)/2*this.height,behind:v.z>1};}
 /** The joint pulley or phalanx under a stage pixel: its joint row, or -1. */
 pick(cx:number,cy:number){
  const r=this.renderer.domElement.getBoundingClientRect();ndc.set((cx-r.left)/(r.width||1)*2-1,1-(cy-r.top)/(r.height||1)*2);ray.setFromCamera(ndc,this.camera);
  const hit=ray.intersectObjects([...this.pulleys,...this.links],true)[0];let o:T.Object3D|null=hit?.object??null;
  while(o&&o.userData.row===undefined)o=o.parent;return o?Number(o.userData.row):-1;
 }
 get size(){return {width:this.width,height:this.height};}
 /** How red a joint glows, robot or ghost, by joint row: what the browser test reads. */
 residualOpacity(i:number){return (this.residualSprites[i].material as T.SpriteMaterial).opacity;}
 ghostResidualOpacity(i:number){return (this.ghostHand.residual[i].material as T.SpriteMaterial).opacity;}
 draw(s:GraspScene,now:number){
  if(this.disposed||this.contextLost)return;this.last=s;
  const lift=s.lift*s.lift*(3-2*s.lift)*1.6;
  this.robot.position.set(ROBOT_AT.x,ROBOT_AT.y+lift*CM,ROBOT_AT.z);
  this.poseRobot(s);this.poseGhost(s);this.poseObject(s,lift,now);this.poseTendons(s);
  this.renderer.render(this.scene,this.camera);
 }
 private poseRobot(s:GraspScene){
  const q=new T.Quaternion(),links=s.sim.links;
  links.forEach((l,i)=>{
   const g=this.links[i];g.position.copy(vec(l.origin));basisOf(l,g.quaternion);
   const p=this.pulleys[i];p.position.copy(vec(l.origin));p.quaternion.copy(g.quaternion);
   // A joint the motors cannot reach where your hand is glows red, brighter the further off.
   const r=residualGlow(s.residual[row(l.digit,l.k)]),sp=this.residualSprites[i];
   sp.position.copy(vec(l.origin));sp.scale.setScalar(2.2+3.6*r);(sp.material as T.SpriteMaterial).opacity=r*.95;
  });
  void q;
  // Four-bar rods: from the proximal phalanx near the PIP to the distal phalanx near the DIP, crossing.
  for(let d=1;d<5;d++){
   const [p,mid,dist]=links.slice(d*3,d*3+3);
   for(const [n,s1,s2] of [[0,1,-1],[1,-1,1]] as const){
    const a=add(add(tipOf(p),scale(p.along,-.9)),scale(p.pad,.45*s1)),b=add(add(dist.origin,scale(dist.along,.6)),scale(dist.pad,.45*s2));
    const rod=this.fourBars[(d-1)*2+n],A=vec(a),B=vec(b),len=A.distanceTo(B);rod.position.copy(A).add(B).multiplyScalar(.5);rod.scale.set(1,len,1);rod.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),B.sub(A).normalize());
    void mid;
   }
  }
  // Contacts: a bright dot where a link presses, and an arrow for the force it pushes with.
  let n=0;
  for(const f of s.verdict.forces){
   if(n>=this.contactSprites.length)break;const c=f.contact,sp=this.contactSprites[n],line=this.forceLines[n];n++;
   sp.position.copy(vec(c.point));sp.scale.setScalar(1.3);(sp.material as T.SpriteMaterial).opacity=.95;
   (sp.material as T.SpriteMaterial).color.set(c.kind==='object'?'#fff1c4':'#9fe6ff');
   const len=Math.min(3.2,.5+f.magnitude*.12),end=add(c.point,scale(f.dir,len));line.set([vec(c.point),vec(end)]);line.line.visible=true;line.material.color.set(s.verdict.stable?'#9dffb0':'#ffd27a');
  }
  for(;n<this.contactSprites.length;n++){(this.contactSprites[n].material as T.SpriteMaterial).opacity=0;this.forceLines[n].line.visible=false;}
 }
 private poseGhost(s:GraspScene){this.ghostHand.pose(s.user,s.spread,s.residual,s.thumbUncertain,this.uncertainMat);}
 private readonly uncertainMat=new T.MeshBasicMaterial({color:'#ffb347',transparent:true,opacity:.55,blending:T.AdditiveBlending,depthWrite:false});
 private poseObject(s:GraspScene,lift:number,now:number){
  for(const [id,g] of this.objects)g.visible=id===s.object;
  const o=objectById(s.object),g=this.objects.get(s.object)!;
  // Held, the object rises with the hand; otherwise it rests on its stand, nudged a hair when only one side pushes.
  const shove=!s.verdict.stable&&s.verdict.forces.length?Math.sin(now*.02)*.03:0;
  g.position.copy(vec(o.centre));g.position.x+=shove;void lift;
  // The stand: a clear arm reaching in from the left to cradle the object, its foot on the floor clear of the robot. World space, so it stays put when the hand lifts.
  this.robotHand.updateMatrixWorld(true);
  const c=this.root.worldToLocal(vec(o.centre).applyMatrix4(this.robotHand.matrixWorld)),floor=ROBOT_AT.y-1.7-this.root.position.y;
  const cradle=c.clone().setY(c.y-lift*CM),foot=new T.Vector3(c.x-.35,floor,c.z+.9),post=this.stand.children[0],base=this.stand.children[1];
  post.position.copy(cradle).add(foot).multiplyScalar(.5);post.scale.set(1,cradle.distanceTo(foot),1);post.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),cradle.clone().sub(foot).normalize());base.position.copy(foot);
  (post as T.Mesh).visible=(base as T.Mesh).visible=s.lift<.98;
 }
 private poseTendons(s:GraspScene){
  const c=s.coupling,k=c.motors.length;
  if(k!==this.lastMotors){this.rebuildBay(s);this.lastMotors=k;}
  const links=s.sim.links;let t=0,bars=0;
  const next=(color:string,width:number,points:T.Vector3[])=>{let tn=this.tendons[t];if(!tn){tn=new Tendon(color,width,this.res);this.tendons.push(tn);this.robotHand.add(tn.line);}tn.material.color.set(color);tn.material.linewidth=width;tn.line.visible=true;tn.set(points);t++;};
  const TRAVEL=1.6,Z=-1.25,level=(d:number)=>-7.3+1.3*d,reel=(n:WhiffleNode|Branch)=>'digit' in n?(n.full>0?n.excursion/n.full:0):n.excursion;
  c.motors.forEach((motor,j)=>{
   const ms=s.sim.motors[j],x0=(j-(k-1)/2)*1.6,load=Math.min(1,ms.tension/3),width=1.5+load*2.4;
   const digitX=(d:number)=>(d===0?-3.3:FINGERS[d-1].x)*.62+x0*.38;
   // Whiffletree: a bar's ends ride where its two branches have been reeled to, so a stopped finger tips the bar and the pull goes on to the other side.
   const leaves=new Map<number,T.Vector3>();
   const place=(n:WhiffleNode|Branch,d:number):T.Vector3=>{
    if('digit' in n){const p=new T.Vector3(digitX(n.digit),level(d)-reel(n)*TRAVEL,Z);leaves.set(n.digit,p);return p;}
    const ends=n.children.map(ch=>place(ch,d+1)),a=ends[0],b=ends[ends.length-1],centre=a.clone().add(b).multiplyScalar(.5),bar=this.bars[bars++];
    if(bar){bar.position.copy(centre);bar.scale.set(1,a.distanceTo(b)+.3,1);bar.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());bar.visible=true;}
    const attach=new T.Vector3(centre.x,level(d)-reel(n)*TRAVEL,Z);next(motor.color,width,[centre,attach]);return attach;
   };
   const root=place(ms.tree,0),spool=new T.Vector3(x0,-9.4,Z);
   next(motor.color,width,[spool.clone().setY(spool.y+.55),root]);
   const sp=this.spools[j];if(sp){sp.position.copy(spool);sp.children[0].rotation.x=-ms.excursion*2.4;}
   // Up the palm to each digit, over the palm side of every joint it drives, ending on the phalanx past the last.
   for(const b of ms.branches){
    const d=b.digit,chain=links.slice(d*3,d*3+3),users=c.motors.filter(mo=>[0,1,2].some(kk=>mo.column[row(d,kk)]>0)),lane=(users.indexOf(motor)-(users.length-1)/2)*.45;
    const sx=d===0?-3.3:FINGERS[d-1].x,pts=[leaves.get(d)!.clone(),new T.Vector3(sx+lane,-.7,-.95)];
    if(d===0)pts.push(vec(THUMB.base).add(new T.Vector3(lane,-.8,.4)));else pts.push(new T.Vector3(sx+lane,1,.3),new T.Vector3(sx+lane,PALM.y1-1.1,.3));
    let last=0;for(let kk=0;kk<3;kk++)if(motor.column[row(d,kk)]>0)last=kk;if(d>0)last=Math.min(last,1);
    for(let kk=0;kk<=last;kk++){
     const l=chain[kk],r=(PULLEY_MM[row(d,kk)]||6)/10*.75+.12,o=vec(l.origin).add(vec(l.axis).multiplyScalar(lane));
     pts.push(o.clone().add(vec(l.pad).multiplyScalar(r)));
     pts.push(o.clone().add(vec(l.along).multiplyScalar(l.length*(kk===last?.6:.88))).add(vec(l.pad).multiplyScalar(l.radius*.88+.1)));
    }
    next(motor.color,width,pts);
   }
  });
  for(;t<this.tendons.length;t++)this.tendons[t].line.visible=false;
  for(let i=bars;i<this.bars.length;i++)this.bars[i].visible=false;
 }
 private rebuildBay(s:GraspScene){
  for(const sp of this.spools)this.bay.remove(sp);this.spools.length=0;
  s.coupling.motors.forEach(m=>{
   const g=new T.Group(),drum=new T.Group(),core=new T.Mesh(new T.CylinderGeometry(.55,.55,1.1,28),this.mats.brass),flanges=[-.55,.55].map(x=>{const f=new T.Mesh(new T.CylinderGeometry(.8,.8,.08,28),this.mats.brass);f.position.y=x;return f;});
   drum.add(core,...flanges);drum.rotation.z=Math.PI/2;
   const marker=new T.Mesh(new T.BoxGeometry(.12,1.12,.22),this.mats.anodised);marker.position.set(0,0,.55);drum.add(marker);
   const body=new T.Mesh(new T.CylinderGeometry(.75,.75,1.4,28),this.mats.aluDark);body.position.set(0,-1.1,0);
   const cap=new T.Mesh(new T.CylinderGeometry(.77,.77,.25,28),new T.MeshStandardMaterial({color:m.color,emissive:new T.Color(m.color),emissiveIntensity:.6,roughness:.4}));cap.position.set(0,-1.9,0);
   g.add(drum,body,cap);this.spools.push(g);this.bay.add(g);
  });
  while(this.bars.length<8){const b=new T.Mesh(new T.CylinderGeometry(.13,.13,1,10),this.mats.brass);this.bars.push(b);this.bay.add(b);}
 }
 dispose(){
  this.disposed=true;this.resizeObserver.disconnect();this.renderer.domElement.removeEventListener('webglcontextlost',this.onLost);this.renderer.domElement.removeEventListener('webglcontextrestored',this.onRestored);
  this.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();}});this.renderer.dispose();this.renderer.domElement.remove();
 }
}
