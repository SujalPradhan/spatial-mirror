import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MIRROR_ZOOM_MAX,MIRROR_ZOOM_MIN,type MirrorPoint,type MirrorView,type MirrorViewState,type WorldPoint} from '../mirror/contracts';
import {PartsOverlay} from '../mirror/parts-overlay';
import {mirrorToStage} from '../mirror/projection';
import {BOARD,FACE,HAND_CRANK,INPUT_AT,LAYER_GAP,LAYERS,PEG,ROD_LENGTH,centre,crankPin,gearOutline,gearsOn,partOf,pitchR,rodEnd,rootR,sliderAt,tipR,type Build,type Crank,type Gear,type Item,type Part,type Solution,type V} from './gears';
import type {DrivetrainBehaviour} from './behaviour';
import type {DrivetrainScene,DrivetrainWorld} from './contracts';
import {DrivetrainOverlay} from './overlay';

/** World units per board millimetre, and where the board's centre sits. */
export const K=1/50;
const BOARD_X=.75,BOARD_Y=.5,TAU=Math.PI*2,LIFT=34,HUB=7.5;
const smooth=(n:number)=>{const u=Math.max(0,Math.min(1,n));return u*u*(3-2*u);};
const v=new T.Vector3(),plane=new T.Plane(),ray=new T.Raycaster(),ndc=new T.Vector2();
const zOf=(layer:number)=>1.6+layer*LAYER_GAP;
/** Opacity, recompiling only when the material crosses between opaque and see-through. */
function fadeTo(m:T.Material,a:number){const see=a<.99;m.opacity=a;if(m.transparent!==see){m.transparent=see;m.depthWrite=!see;m.needsUpdate=true;}}

/** Brass and steel as a machinist would leave them: bright, a little brushed, edges catching the light. */
function materials(){
 const m=(color:string,metalness:number,roughness:number,extra:T.MeshPhysicalMaterialParameters={})=>new T.MeshPhysicalMaterial({color,metalness,roughness,...extra});
 return {
  brass:m('#b9832a',1,.3,{clearcoat:.15,clearcoatRoughness:.3}),brassDark:m('#8a6326',1,.4),steel:m('#848d97',1,.36,{clearcoat:.15}),steelDark:m('#5b636c',1,.36),
  blued:m('#2b4f96',.85,.28,{clearcoat:.6,clearcoatRoughness:.15}),wood:m('#6a321c',0,.5,{clearcoat:.5,clearcoatRoughness:.3}),enamel:m('#f1e9d6',0,.45,{clearcoat:.6}),
  ruby:m('#c2183a',0,.15,{transmission:.2,clearcoat:1}),pen:m('#ff4a3a',.2,.35,{emissive:new T.Color('#ff2a1a'),emissiveIntensity:.4}),
 };
}
type Mats=ReturnType<typeof materials>;
const gearCache=new Map<string,T.BufferGeometry>();
/** An involute gear plate: hub bore, lightening holes on the bigger wheels, chamfered faces. */
export function gearGeometry(z:number,broken=-1){
 const key=`${z}:${broken}`;let g=gearCache.get(key);if(g)return g;
 const shape=new T.Shape(gearOutline(z,undefined,broken).map(([x,y])=>new T.Vector2(x,y)));
 const bore=new T.Path();bore.absarc(0,0,3.2,0,TAU,true);shape.holes.push(bore);
 const rf=rootR(z);
 if(z>=22){const n=z>=40?6:z>=30?5:4,ring=(HUB+2+rf-3)/2,r=Math.min((rf-3-HUB-2)/2*.92,ring*Math.sin(Math.PI/n)*.78);
  if(r>2)for(let i=0;i<n;i++){const a=i/n*TAU+Math.PI/n,p=new T.Path();p.absarc(ring*Math.cos(a),ring*Math.sin(a),r,0,TAU,true);shape.holes.push(p);}}
 g=new T.ExtrudeGeometry(shape,{depth:FACE-1,bevelEnabled:true,bevelThickness:.5,bevelSize:.42,bevelSegments:2,curveSegments:10});
 g.translate(0,0,.5);g.computeVertexNormals();gearCache.set(key,g);return g;
}
const cyl=(r:number,h:number,seg=28)=>{const g=new T.CylinderGeometry(r,r,h,seg);g.rotateX(Math.PI/2);g.translate(0,0,h/2);return g;};
function rounded(w:number,h:number,r:number,depth:number,bevel=.6){
 const s=new T.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
 return new T.ExtrudeGeometry(s,{depth,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:6});
}
/** Pegboard: anodised dark aluminium, a hole every peg, faint scale along the edge. */
function boardTexture(){
 const W=BOARD.x1-BOARD.x0,H=BOARD.y1-BOARD.y0,px=4,c=document.createElement('canvas');c.width=W*px;c.height=H*px;const g=c.getContext('2d')!;
 const grd=g.createLinearGradient(0,0,0,c.height);grd.addColorStop(0,'#232b33');grd.addColorStop(1,'#161c22');g.fillStyle=grd;g.fillRect(0,0,c.width,c.height);
 // Brushed grain.
 for(let i=0;i<1400;i++){const y=Math.random()*c.height;g.strokeStyle=`rgba(255,255,255,${Math.random()*.025})`;g.lineWidth=1;g.beginPath();g.moveTo(0,y);g.lineTo(c.width,y+Math.random()*4-2);g.stroke();}
 const X=(x:number)=>(x-BOARD.x0)*px,Y=(y:number)=>(BOARD.y1-y)*px;
 for(let x=Math.ceil(BOARD.x0/PEG)*PEG;x<BOARD.x1;x+=PEG)for(let y=Math.ceil((BOARD.tray+8)/PEG)*PEG;y<BOARD.y1-4;y+=PEG){
  const r=2.1*px,h=g.createRadialGradient(X(x)-1,Y(y)-1,r*.2,X(x),Y(y),r*1.5);h.addColorStop(0,'#05070a');h.addColorStop(.62,'#090c10');h.addColorStop(.7,'rgba(160,175,190,.25)');h.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=h;g.beginPath();g.arc(X(x),Y(y),r*1.5,0,TAU);g.fill();
 }
 g.strokeStyle='rgba(255,200,97,.18)';g.lineWidth=1.5;g.strokeRect(6*px,6*px,c.width-12*px,(BOARD.y1-BOARD.tray-8)*px);
 g.fillStyle='rgba(238,243,242,.22)';g.font=`${3*px}px ui-monospace,Menlo,monospace`;
 for(let x=-240;x<=240;x+=40){g.fillRect(X(x)-.5,Y(BOARD.y1-6),1.5,-8);g.fillText(`${x}`,X(x)+4,Y(BOARD.y1-13));}
 const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;
}
/** A tapered blued-steel clock hand with a counterweight tail, pointing along +x. */
function handGeometry(){
 const s=new T.Shape();s.moveTo(-12,0);s.quadraticCurveTo(-12,4.5,-6,3.2);s.lineTo(0,2.6);s.lineTo(30,1);s.lineTo(35,0);s.lineTo(30,-1);s.lineTo(0,-2.6);s.lineTo(-6,-3.2);s.quadraticCurveTo(-12,-4.5,-12,0);
 const h=new T.Path();h.absarc(0,0,1.6,0,TAU,true);s.holes.push(h);
 return new T.ExtrudeGeometry(s,{depth:1.2,bevelEnabled:true,bevelThickness:.3,bevelSize:.3,bevelSegments:2});
}
function dialTexture(){
 const c=document.createElement('canvas'),n=256,g=c.getContext('2d')!;c.width=c.height=n;g.fillStyle='#f1e9d6';g.fillRect(0,0,n,n);
 g.translate(n/2,n/2);g.strokeStyle='#2a2622';
 for(let i=0;i<60;i++){const a=i/60*TAU,big=i%5===0;g.lineWidth=big?5:2;g.beginPath();g.moveTo(Math.cos(a)*(n*.47),Math.sin(a)*(n*.47));g.lineTo(Math.cos(a)*(n*(big?.39:.43)),Math.sin(a)*(n*(big?.39:.43)));g.stroke();}
 g.strokeStyle='rgba(42,38,34,.4)';g.lineWidth=1.5;g.beginPath();g.arc(0,0,n*.3,0,TAU);g.stroke();
 const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
/** A bar between two points with round eyes: length is a scale, so it can be re-set every frame. */
class Bar {
 readonly group=new T.Group();private readonly body:T.Mesh;private readonly ends:T.Mesh[];
 constructor(mat:T.Material,readonly width=7,readonly thick=3,eye=mat){
  this.body=new T.Mesh(new T.BoxGeometry(1,width,thick),mat);this.body.castShadow=true;
  this.ends=[0,1].map(()=>{const m=new T.Mesh(cyl(width/2,thick,24),eye);m.castShadow=true;m.position.z=-thick/2;return m;});
  this.group.add(this.body,...this.ends);
 }
 set(a:V,b:V,z:number){
  const l=Math.hypot(b[0]-a[0],b[1]-a[1]);this.group.position.set(a[0],a[1],z);this.group.rotation.z=Math.atan2(b[1]-a[1],b[0]-a[0]);
  this.body.scale.x=Math.max(.01,l);this.body.position.set(l/2,0,0);this.ends[0].position.x=0;this.ends[1].position.x=l;
 }
}
interface PartMesh {key:string;group:T.Group;spin:T.Object3D;mats:T.MeshPhysicalMaterial[]}

/** The drivetrain on a dark stage, posed like every mirror object. The board is a plane through the root, so hands are read by a ray onto it. */
export class DrivetrainView implements MirrorView<DrivetrainScene>,DrivetrainWorld {
 readonly ready:Promise<void>;readonly scene=new T.Scene();readonly camera=new T.PerspectiveCamera(37,1,.1,100);readonly renderer:T.WebGLRenderer;
 readonly root=new T.Group();readonly board=new T.Group();readonly partCount=0;
 private readonly mats=materials();private readonly overlay:PartsOverlay;readonly hud:DrivetrainOverlay;
 private readonly parts=new Map<number,PartMesh>();private readonly shafts=new Map<number,T.Group>();private readonly tray=new Map<string,T.Group>();
 private readonly crank=new T.Group();private readonly crankSpin=new T.Group();private readonly carry=new T.Group();private readonly ghost=new T.Group();
 private carryKey='';private ghostKey='';private readonly ghostMat=new T.MeshPhysicalMaterial({color:'#8cffb0',transparent:true,opacity:.35,emissive:new T.Color('#3bff86'),emissiveIntensity:.6,depthWrite:false,roughness:.4});
 private readonly linkage=new T.Group();private readonly bars:Record<string,Bar>;private readonly pivots:T.Mesh[]=[];private readonly penTip:T.Mesh;
 private readonly shard:T.Mesh;private readonly boardMat:T.MeshStandardMaterial;private readonly dialMap=dialTexture();private readonly handGeo=handGeometry();
 private readonly resizeObserver:ResizeObserver;private videoAspect=0;private zoom=1;private width=1;private height=1;private disposed=false;private contextLost=false;
 constructor(readonly host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));this.renderer.setClearColor(0,0);
  this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.95;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFShadowMap;
  this.renderer.domElement.className='mirror-canvas';this.renderer.domElement.setAttribute('aria-hidden','true');host.prepend(this.renderer.domElement);
  this.camera.position.set(0,0,13);
  const pmrem=new T.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.scene.environment=pmrem.fromScene(room,.03).texture;this.scene.environmentIntensity=.7;pmrem.dispose();
  room.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});
  const key=new T.DirectionalLight('#fff2df',1.5);key.position.set(-5,7,11);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.radius=4;key.shadow.bias=-.0004;key.shadow.normalBias=.02;
  Object.assign(key.shadow.camera,{left:-9,right:9,top:7,bottom:-7,near:1,far:40});
  const rim=new T.DirectionalLight('#9fd8ff',.9);rim.position.set(7,3,-4);
  this.scene.add(key,rim,new T.HemisphereLight('#bcd4ff','#1a1208',.25),this.root);this.root.add(this.board);
  this.board.position.set(BOARD_X,BOARD_Y,0);this.board.scale.setScalar(K);
  // The board itself, then the tray recess along its lower edge.
  const W=BOARD.x1-BOARD.x0,H=BOARD.y1-BOARD.y0;
  this.boardMat=new T.MeshStandardMaterial({map:boardTexture(),roughness:.78,metalness:.15,envMapIntensity:.35,color:'#8a95a0'});
  const slab=new T.Mesh(rounded(W,H,10,8,1.2),[this.boardMat,new T.MeshStandardMaterial({color:'#11161b',roughness:.5,metalness:.5})]);
  // Extrude puts its cap uvs in shape units: remap the face to the texture.
  const uv=slab.geometry.attributes.uv as T.BufferAttribute,pos=slab.geometry.attributes.position as T.BufferAttribute;
  for(let i=0;i<uv.count;i++)uv.setXY(i,(pos.getX(i)+W/2)/W,(pos.getY(i)+H/2)/H);
  slab.position.z=-9.2;slab.receiveShadow=true;this.board.add(slab);
  const trayH=BOARD.tray-BOARD.y0-6,trayPlate=new T.Mesh(rounded(W-10,trayH,6,.6,.6),new T.MeshStandardMaterial({color:'#0d1115',roughness:.8,metalness:.2}));
  trayPlate.position.set(0,(BOARD.y0+BOARD.tray)/2,-1.2);trayPlate.receiveShadow=true;this.board.add(trayPlate);
  // The hand crank on the input shaft: steel arm, turned wooden knob.
  const base=new T.Mesh(cyl(14,2.5,40),this.mats.brassDark);base.receiveShadow=true;
  const hub=new T.Mesh(cyl(8,6,32),this.mats.steel),arm=new T.Mesh(rounded(HAND_CRANK+14,11,5.5,4,.8),this.mats.steel),knob=new T.Mesh(new T.CylinderGeometry(6.5,7.5,22,32).rotateX(Math.PI/2).translate(0,0,11),this.mats.wood),cap=new T.Mesh(new T.SphereGeometry(6.6,24,12,0,TAU,0,Math.PI/2).rotateX(Math.PI/2).translate(0,0,22),this.mats.wood);
  arm.position.set(HAND_CRANK/2,0,0);hub.position.z=-2;knob.position.set(HAND_CRANK,0,4);cap.position.set(HAND_CRANK,0,4);
  for(const m of [hub,arm,knob,cap])m.castShadow=true;
  this.crankSpin.add(hub,arm,knob,cap);this.crankSpin.position.z=zOf(LAYERS)+2;
  this.crank.add(base,this.crankSpin);this.crank.position.set(INPUT_AT[0],INPUT_AT[1],0);this.board.add(this.crank);
  this.board.add(this.carry,this.ghost,this.linkage);
  this.bars={ab:new Bar(this.mats.brass,9,4),ap:new Bar(this.mats.brass,9,4),bp:new Bar(this.mats.brass,9,4),crank:new Bar(this.mats.steel,8,3.5),rocker:new Bar(this.mats.steel,8,3.5),thigh:new Bar(this.mats.steelDark,7,3,this.mats.steel),shin:new Bar(this.mats.steelDark,7,3,this.mats.steel),thigh2:new Bar(this.mats.steelDark,7,3,this.mats.steel),shin2:new Bar(this.mats.steelDark,7,3,this.mats.steel)};
  for(const b of Object.values(this.bars))this.linkage.add(b.group);
  for(let i=0;i<8;i++){const p=new T.Mesh(i<3?rounded(18,14,3,6,.8):cyl(2.4,9,16),i<3?this.mats.brassDark:this.mats.steel);p.castShadow=true;this.pivots.push(p);this.linkage.add(p);}
  this.penTip=new T.Mesh(new T.ConeGeometry(3,10,20).rotateX(-Math.PI/2),this.mats.pen);this.linkage.add(this.penTip);
  this.shard=new T.Mesh(new T.BoxGeometry(4,3,FACE),this.mats.brass);this.shard.visible=false;this.shard.castShadow=true;this.board.add(this.shard);
  this.overlay=new PartsOverlay(this.scene,host);this.hud=new DrivetrainOverlay(host,this);
  this.renderer.domElement.addEventListener('webglcontextlost',this.onLost);this.renderer.domElement.addEventListener('webglcontextrestored',this.onRestored);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
  this.ready=Promise.resolve();
 }
 private readonly onLost=(e:Event)=>{e.preventDefault();this.contextLost=true;this.host.dispatchEvent(new CustomEvent('mirror-render-error',{bubbles:true,detail:'The 3D view paused. Reload if it does not recover.'}));};
 private readonly onRestored=()=>{this.contextLost=false;};
 private resize(){
  if(this.disposed)return;this.width=Math.max(1,this.host.clientWidth);this.height=Math.max(1,this.host.clientHeight);
  this.renderer.setSize(this.width,this.height,false);this.camera.aspect=this.width/this.height;this.camera.position.z=this.width<700?15:13;this.applyCamera();
 }
 private applyCamera(){this.camera.zoom=this.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();}
 get cameraZoom(){return this.camera.zoom;}
 setPose(view:MirrorViewState){
  if(this.disposed)return;this.root.quaternion.fromArray(view.q).normalize();this.root.position.set(view.x,view.y,0);this.root.updateMatrixWorld(true);
  this.zoom=Math.min(MIRROR_ZOOM_MAX,Math.max(MIRROR_ZOOM_MIN,view.zoom));if(this.camera.zoom!==this.zoom)this.applyCamera();
 }
 setVideoAspect(aspect:number){this.videoAspect=aspect;}
 handAspect(){return this.videoAspect>0?this.videoAspect:16/9;}
 private unproject(nx:number,ny:number,z:number):WorldPoint{const c=this.camera.position;v.set(nx,ny,.5).unproject(this.camera).sub(c);const t=(z-c.z)/v.z;return {x:c.x+v.x*t,y:c.y+v.y*t,z};}
 mirrorToWorld(p:MirrorPoint):WorldPoint{const s=mirrorToStage(p.x,p.y,this.videoAspect,this.width/this.height);return this.unproject(s.x*2-1,1-s.y*2,Math.max(-1,Math.min(1,-p.z*1.4)));}
 pointToWorld(cx:number,cy:number):WorldPoint{const r=this.renderer.domElement.getBoundingClientRect();return this.unproject((cx-r.left)/(r.width||1)*2-1,1-(cy-r.top)/(r.height||1)*2,0);}
 partAt(){return -1;}
 private boardPlane(){this.board.updateMatrixWorld();const n=v.set(0,0,1).transformDirection(this.board.matrixWorld);return plane.setFromNormalAndCoplanarPoint(n.clone(),new T.Vector3().setFromMatrixPosition(this.board.matrixWorld));}
 private ndcToBoard(nx:number,ny:number):V|null{
  ndc.set(nx,ny);ray.setFromCamera(ndc,this.camera);const hit=ray.ray.intersectPlane(this.boardPlane(),new T.Vector3());if(!hit)return null;
  this.board.worldToLocal(hit);return [hit.x,hit.y];
 }
 toBoard(p:MirrorPoint){const s=mirrorToStage(p.x,p.y,this.videoAspect,this.width/this.height);return this.ndcToBoard(s.x*2-1,1-s.y*2);}
 worldToBoard(p:WorldPoint){v.set(p.x,p.y,p.z).project(this.camera);return this.ndcToBoard(v.x,v.y);}
 toScreen(p:MirrorPoint){const s=mirrorToStage(p.x,p.y,this.videoAspect,this.width/this.height);return {x:s.x*this.width,y:s.y*this.height};}
 boardWorld(at:V,z=0):WorldPoint{this.board.updateMatrixWorld();v.set(at[0],at[1],z);this.board.localToWorld(v);return {x:v.x,y:v.y,z:v.z};}
 boardToScreen(x:number,y:number,z=0){this.board.updateMatrixWorld();v.set(x,y,z);this.board.localToWorld(v).project(this.camera);return {x:(v.x+1)/2*this.width,y:(1-v.y)/2*this.height};}
 mmPerPx(at:V){const a=this.boardToScreen(at[0],at[1]),b=this.boardToScreen(at[0]+10,at[1]),c=this.boardToScreen(at[0],at[1]+10);return 20/Math.max(1e-3,Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(c.x-a.x,c.y-a.y));}
 get size(){return {width:this.width,height:this.height};}

 // ---- Parts ----
 private gearMesh(z:number,broken:number,steel:boolean,mat?:T.Material){
  const g=new T.Group(),spin=new T.Group(),m=(mat??(steel?this.mats.steel:this.mats.brass)) as T.MeshPhysicalMaterial,body=mat?m:m.clone(),hubm=mat??(steel?this.mats.steelDark:this.mats.brassDark).clone();
  const gear=new T.Mesh(gearGeometry(z,broken),body),hub=new T.Mesh(cyl(HUB,FACE+2.4,36),hubm),screw=new T.Mesh(cyl(1.3,1.2,10).rotateY(Math.PI/2),this.mats.steelDark);
  hub.position.z=-.7;screw.position.set(HUB-.2,0,FACE*.5);gear.castShadow=hub.castShadow=true;gear.receiveShadow=true;
  spin.add(gear,hub,screw);g.add(spin);return {group:g,spin,mats:[body,hubm as T.MeshPhysicalMaterial].filter((x,i,a)=>a.indexOf(x)===i) as T.MeshPhysicalMaterial[]};
 }
 private linkMesh(item:Item,mat?:T.Material){
  const g=new T.Group(),spin=new T.Group(),mats:T.MeshPhysicalMaterial[]=[];g.add(spin);
  const use=(base:T.MeshPhysicalMaterial)=>{const m=(mat??base.clone()) as T.MeshPhysicalMaterial;if(!mats.includes(m))mats.push(m);return m;};
  if(item.kind==='crank'){const r=(item.throw??15)+8,disc=new T.Mesh(rounded(r*2,r*2,r,3.5,.6),use(this.mats.steel)),pin=new T.Mesh(cyl(3,12,20),use(this.mats.brass));pin.position.set(item.throw??15,0,0);disc.castShadow=pin.castShadow=true;spin.add(disc,pin);}
  else if(item.kind==='hand'){const dial=new T.Mesh(cyl(26,1.6,64),mat??new T.MeshPhysicalMaterial({map:this.dialMap,roughness:.45,clearcoat:.6})),hand=new T.Mesh(this.handGeo,use(this.mats.blued)),boss=new T.Mesh(cyl(3,4,20),use(this.mats.brass));
   if(!mat)mats.push(dial.material as T.MeshPhysicalMaterial);dial.receiveShadow=true;hand.castShadow=true;hand.position.z=2.6;boss.position.z=2;g.add(dial);spin.add(hand,boss);}
  else if(item.kind==='rod'){const bar=new Bar(use(this.mats.steel),9,3.5);bar.set([0,0],[ROD_LENGTH,0],0);spin.add(bar.group);}
  else{const block=new T.Mesh(rounded(26,16,3,9,.8),use(this.mats.brass)),pin=new T.Mesh(cyl(3,12,20),use(this.mats.steel));block.castShadow=true;spin.add(block,pin);}
  return {group:g,spin,mats};
 }
 private makePart(item:Item,mat?:T.Material,broken=-1){return item.kind==='gear'?this.gearMesh(item.z!,broken,!!item.steel,mat):this.linkMesh(item,mat);}
 private sync(b:Build){
  const keep=new Set<number>();
  for(const p of b.parts){
   const key=p.kind==='gear'?`g${p.z}:${p.broken}:${p.steel}`:p.kind==='crank'?`c${p.throw}`:p.kind;keep.add(p.id);
   let e=this.parts.get(p.id);
   if(e&&e.key!==key){this.board.remove(e.group);e=undefined;}
   if(!e){const built=this.makePart(p.kind==='gear'?{kind:'gear',z:p.z,steel:p.steel}:p.kind==='crank'?{kind:'crank',throw:p.throw}:{kind:p.kind},undefined,p.kind==='gear'?p.broken:-1);e={key,...built};this.parts.set(p.id,e);this.board.add(e.group);}
  }
  for(const [id,e] of this.parts)if(!keep.has(id)){this.board.remove(e.group);this.parts.delete(id);}
  // Axles: a bearing on the board and a steel shaft up through every layer used.
  const shafts=new Set(b.shafts.map(s=>s.id));
  for(const s of b.shafts){
   let g=this.shafts.get(s.id);
   if(!g){g=new T.Group();const foot=new T.Mesh(cyl(6.5,1.6,32),this.mats.brassDark),axle=new T.Mesh(cyl(3,1,20),this.mats.steel);axle.name='axle';foot.receiveShadow=true;axle.castShadow=true;g.add(foot,axle);this.shafts.set(s.id,g);this.board.add(g);}
   const on=b.parts.filter(p=>(p.kind==='gear'||p.kind==='crank'||p.kind==='hand')&&p.shaft===s.id),top=Math.max(0,...on.map(p=>p.kind==='gear'?p.layer:LAYERS));
   g.position.set(s.x,s.y,0);g.getObjectByName('axle')!.scale.z=zOf(top)+(top>=LAYERS?6:FACE+3);g.visible=!s.input||true;
  }
  for(const [id,g] of this.shafts)if(!shafts.has(id)){this.board.remove(g);this.shafts.delete(id);}
 }
 private pose(t:DrivetrainBehaviour,b:Build,sol:Solution,now:number){
  const ex=smooth(t.explodeU),fade=1-.84*smooth(t.schematicU),drawing=smooth(t.mode==='draw'?1:0);
  for(const p of b.parts){
   const e=this.parts.get(p.id)!,layer=p.kind==='gear'?p.layer:LAYERS,angle=sol.angle(p.id,t.theta);
   const dx=ex*layer*92,dz=ex*layer*26;
   if(p.kind==='gear'||p.kind==='crank'||p.kind==='hand'){const c=centre(b,p.shaft);e.group.position.set(c[0]+dx,c[1],zOf(layer)+dz+(p.kind==='hand'?2:0));e.spin.rotation.z=angle;}
   if(p.kind==='rod'){const c=partOf(b,p.crank) as Crank,pin=crankPin(b,c,sol.angle(c.id,t.theta)),end=rodEnd(b,p,sol,t.theta);e.group.position.set(pin[0]+dx,pin[1],zOf(LAYERS)+8+dz);e.spin.rotation.z=Math.atan2(end[1]-pin[1],end[0]-pin[0]);e.spin.scale.x=Math.hypot(end[0]-pin[0],end[1]-pin[1])/ROD_LENGTH;}
   if(p.kind==='slider'){const s=sliderAt(b,p,sol,t.theta);e.group.position.set(s.at[0]+dx,s.at[1],zOf(LAYERS)+dz);e.spin.rotation.z=p.axis;}
   const hot=(t.candidate===`part:${p.id}`||t.hover===p.id)?.5:0,spike=t.spike&&t.spike.gear===p.id?Math.max(0,1-t.spike.age/1.4)*(.6+.4*Math.sin(now*.03)):0;
   for(const m of e.mats){m.emissive.set(spike?'#ff3020':'#ffd27a');m.emissiveIntensity=Math.max(hot*.35,spike*1.6);fadeTo(m,fade*(1-drawing*.85));}
   e.group.visible=drawing<.99;
  }
  for(const [id,g] of this.shafts){const s=b.shafts.find(x=>x.id===id)!;g.visible=drawing<.99&&(!s.input||true);}
  this.crankSpin.rotation.z=t.theta;this.crank.visible=t.mode==='build';
  this.crank.traverse(o=>{if(o instanceof T.Mesh){const m=o.material as T.MeshPhysicalMaterial;if(m.userData.own!==true){o.material=m.clone();(o.material as T.Material).userData.own=true;}fadeTo(o.material as T.Material,fade);}});
  // A crank turned against a jam shakes in the hand.
  if(t.crankHand!==null&&(sol.jammed||sol.broken))this.crankSpin.rotation.z+=Math.sin(now*.09)*.03;
 }
 private trayIcons(t:DrivetrainBehaviour){
  const tiles=t.tiles,seen=new Set<string>();
  for(const tile of tiles){
   seen.add(tile.id);let g=this.tray.get(tile.id);
   if(!g){
    g=new T.Group();const plate=new T.Mesh(rounded(tile.w,tile.h,5,2,.7),new T.MeshPhysicalMaterial({color:tile.item?'#1a2028':'#3a2a10',metalness:.15,roughness:.7,envMapIntensity:.3,emissive:new T.Color('#ffc861'),emissiveIntensity:0}));plate.name='plate';plate.receiveShadow=true;g.add(plate);
    if(tile.item){const icon=this.makePart(tile.item),r=tile.item.kind==='gear'?tipR(tile.item.z!):tile.item.kind==='rod'?ROD_LENGTH/2:tile.item.kind==='hand'?28:20,s=Math.min(1,(tile.item.kind==='crank'?10:13)/r);icon.group.scale.setScalar(s);icon.group.position.set(tile.item.kind==='rod'?-ROD_LENGTH/2*s:0,7,3);if(tile.item.kind==='rod')icon.spin.rotation.z=0;g.add(icon.group);}
    else{const gem=new T.Mesh(new T.OctahedronGeometry(7,0),this.mats.brass);gem.name='gem';gem.position.set(-34,2,8);gem.castShadow=true;g.add(gem);}
    this.tray.set(tile.id,g);this.board.add(g);
   }
   g.position.set(tile.x,tile.y,0);const plate=g.getObjectByName('plate') as T.Mesh<T.BufferGeometry,T.MeshPhysicalMaterial>;
   plate.material.emissiveIntensity=t.candidate===`tile:${tile.id}`?.28:tile.id==='next'?.12:0;
  }
  for(const [id,g] of this.tray)if(!seen.has(id)){this.board.remove(g);this.tray.delete(id);}
 }
 private carried(t:DrivetrainBehaviour,now:number){
  const c=t.carry;this.carry.visible=this.ghost.visible=!!c;if(!c)return;
  const key=JSON.stringify(c.item);
  if(key!==this.carryKey){this.carry.clear();this.carry.add(this.makePart(c.item).group);this.carryKey=key;}
  if(key!==this.ghostKey){this.ghost.clear();this.ghost.add(this.makePart(c.item,this.ghostMat).group);this.ghostKey=key;}
  this.carry.position.set(c.at[0],c.at[1],LIFT);this.carry.rotation.set(.12*Math.sin(now*.002),.1,0);
  const s=c.snap;this.ghost.visible=!!s;if(!s)return;
  const ok=s.ok;this.ghostMat.color.set(ok?'#8cffb0':'#ff7a6a');this.ghostMat.emissive.set(ok?'#3bff86':'#ff3a2a');this.ghostMat.opacity=.32+.1*Math.sin(now*.008);
  const layer=c.item.kind==='gear'?s.layer:LAYERS;this.ghost.position.set(s.x,s.y,zOf(layer)+(ok?0:1));
  // Links show where they will hang.
  const inner=this.ghost.children[0] as T.Group,spin=inner.children.find(x=>x instanceof T.Group) as T.Group|undefined;
  if(spin&&c.item.kind==='rod')spin.rotation.z=s.angle??0;
  if(spin&&c.item.kind==='slider')spin.rotation.z=s.angle??0;
  if(c.item.kind==='rod'||c.item.kind==='slider')this.ghost.position.z=zOf(LAYERS)+(c.item.kind==='rod'?8:0);
 }
 private spikeShard(t:DrivetrainBehaviour){
  const s=t.spike;this.shard.visible=!!s&&s.broke;if(!s||!s.broke)return;
  const u=s.age,dir=Math.atan2(s.at[1]-BOARD.y0,s.at[0]),vx=Math.cos(dir)*60,vy=Math.sin(dir)*30+40;
  this.shard.position.set(s.at[0]+vx*u,s.at[1]+vy*u-80*u*u,Math.max(2,zOf(1)+60*u-140*u*u));this.shard.rotation.set(u*9,u*7,u*5);
 }
 private drawLinkage(t:DrivetrainBehaviour){
  const s=t.linkPose(),on=t.mode==='draw'&&!!s;this.linkage.visible=on;if(!on||!s)return;
  const z=zOf(0);
  // The coupler is a rigid brass triangle: crank pin, rocker pin and the drawing point.
  this.bars.ab.set(s.A,s.B,z+5);this.bars.ap.set(s.A,s.P,z+5);this.bars.bp.set(s.B,s.P,z+5);
  this.bars.crank.set(s.O2,s.A,z+1);this.bars.rocker.set(s.O4,s.B,z+1);
  const leg=t.legPose(),leg2=t.legPose(t.linkTheta+Math.PI),show=!!leg&&t.legU>.02;
  for(const k of ['thigh','shin','thigh2','shin2'])this.bars[k].group.visible=show;
  if(leg){this.bars.thigh.set(leg.P,leg.foot,z+9);this.bars.shin.set(leg.G,leg.knee,z+12);}
  if(leg2){this.bars.thigh2.set(leg2.P,leg2.foot,z-3);this.bars.shin2.set(leg2.G,leg2.knee,z-1);}
  const ground=[s.O2,s.O4,leg?.G];
  this.pivots.forEach((p,i)=>{
   if(i<3){const g=ground[i];p.visible=!!g&&(i<2||show);if(g)p.position.set(g[0],g[1]-4,0);}
   else{const pins=[s.O2,s.O4,s.A,s.B,leg?.knee];const g=pins[i-3];p.visible=!!g&&(i<7||show);if(g)p.position.set(g[0],g[1],z);}
  });
  this.penTip.position.set(s.P[0],s.P[1],z+12);
 }
 draw(scene:DrivetrainScene,now:number){
  if(this.disposed||this.contextLost)return;
  const t=scene.train,b=t.shown,sol=t.shownSol;
  this.sync(b);this.pose(t,b,sol,now);this.trayIcons(t);this.carried(t,now);this.spikeShard(t);this.drawLinkage(t);
  this.boardMat.color.set('#8a95a0').multiplyScalar(1-.45*smooth(t.schematicU));
  this.root.updateMatrixWorld(true);
  this.overlay.update(scene,this.camera,this.width,this.height);
  this.hud.update(t,now);
  this.renderer.render(this.scene,this.camera);
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;this.overlay.dispose();this.hud.dispose();this.resizeObserver.disconnect();
  this.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of [o.material].flat())m.dispose();}});
  gearCache.clear();this.renderer.dispose();this.renderer.domElement.remove();
 }
}
export {gearsOn,pitchR};
export type {Gear,Part};
