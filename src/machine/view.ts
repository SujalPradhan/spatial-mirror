import * as T from 'three';
import {MeshPartsView,type MeshFrame,type MeshScene} from '../mirror/parts-view';
import type {WorldPoint} from '../mirror/contracts';
import {feedPose,hookAngle,machinePose,needleTip,PITCH,takeUp,type MachineState} from './model';
import {DRAW_PITCH,EMBROIDERY_CAP,HOOP_R} from './behaviour';
import type {MachineScene} from './contracts';
import {apexOf,bobbinPath,DISCS,settledPaths,topPath} from './threads';
import {CENTER,UNIT,dims,followers,leverLength,machineExtras,machineParts,type P,type PartId} from './parts';

const TOP_COLOR='#ff5a4a',BOBBIN_COLOR='#35d6ff',THREAD_R=.4,CLOTH='#e9dcc4';
const smooth=(n:number)=>{const u=Math.max(0,Math.min(1,n));return u*u*(3-2*u);};
const rad=(d:number)=>d*Math.PI/180;
const mod=(n:number,m:number)=>((n%m)+m)%m;
const {hook:HOOK,hookOut,clothTop,clothUnder,needleZ,shaftY,lowerY,lowerZ,linkDrop,wheelX,pivot,takeUp:TAKE_UP,clothMark}=dims;
/** Slack blue, balanced violet, tight red. */
const SLACK=new T.Color('#1f5bff'),EVEN=new T.Color('#b98cff'),TIGHT=new T.Color('#ff1a0a'),LOOSE_SIDE=new T.Color('#d9c9c4');
export const tensionColor=(t:number,out=new T.Color())=>t<.5?out.copy(SLACK).lerp(EVEN,t/.5):out.copy(EVEN).lerp(TIGHT,Math.min(1,(t-.5)/.5));
/** Vertex or instance colour multiplies the glow as well as the diffuse, so a tinted thread stays lit. */
function tintGlow(m:T.MeshStandardMaterial){m.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n totalEmissiveRadiance*=vColor.rgb;');};return m;}

/** A plain weave: warp and weft threads a shade apart, with a little irregular slub. */
function weave(){
 const c=document.createElement('canvas'),n=128,g=c.getContext('2d')!;c.width=c.height=n;
 g.fillStyle=FABRIC;g.fillRect(0,0,n,n);
 for(let i=0;i<n;i+=4)for(let j=0;j<n;j+=4){const over=((i+j)/4)%2===0,l=over?.1:-.08,k=(Math.sin(i*1.7+j*.3)+1)*.02;g.fillStyle=`rgba(${l>0?'190,205,255':'0,0,20'},${Math.abs(l)+k})`;over?g.fillRect(i,j+.5,4,3):g.fillRect(i+.5,j,3,4);}
 const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(9,9);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;
}

/** A tube rewritten in place each frame along a Catmull-Rom spline. */
class Thread {
 readonly group=new T.Group();
 private readonly geometry=new T.BufferGeometry();
 readonly position:Float32Array;private readonly normal:Float32Array;private readonly colors:Float32Array|null;
 private readonly curve=new T.CatmullRomCurve3([],false,'centripetal');
 private readonly solid:T.MeshStandardMaterial;private readonly ghost:T.MeshBasicMaterial;
 private painted=true;
 constructor(color:string,readonly samples=460,readonly sides=7,tinted=false){
  const verts=samples*sides;this.position=new Float32Array(verts*3);this.normal=new Float32Array(verts*3);this.colors=tinted?new Float32Array(verts*3).fill(1):null;
  const index:number[]=[];
  for(let i=0;i<samples-1;i++)for(let j=0;j<sides;j++){const a=i*sides+j,b=i*sides+(j+1)%sides,c=a+sides,d=b+sides;index.push(a,c,b,b,c,d);}
  this.geometry.setIndex(index);this.geometry.setAttribute('position',new T.BufferAttribute(this.position,3).setUsage(T.DynamicDrawUsage));this.geometry.setAttribute('normal',new T.BufferAttribute(this.normal,3).setUsage(T.DynamicDrawUsage));
  if(this.colors)this.geometry.setAttribute('color',new T.BufferAttribute(this.colors,3).setUsage(T.DynamicDrawUsage));
  this.solid=new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.42,roughness:.5});
  if(tinted){this.solid.vertexColors=true;this.solid.color.set('#fff');this.solid.emissive.set('#fff');tintGlow(this.solid);this.paint(()=>new T.Color(color));}
  // Ghosted pass: the part of a strand behind the case stays followable.
  this.ghost=new T.MeshBasicMaterial({color:tinted?'#fff':color,vertexColors:tinted,transparent:true,opacity:.34,depthTest:false,depthWrite:false});
  const solid=new T.Mesh(this.geometry,this.solid),ghost=new T.Mesh(this.geometry,this.ghost);
  solid.frustumCulled=ghost.frustumCulled=false;solid.renderOrder=1;ghost.renderOrder=210;this.group.add(solid,ghost);
 }
 look(alpha:number,ghost:number){this.solid.opacity=alpha;this.solid.transparent=alpha<1;this.ghost.opacity=ghost*alpha;this.ghost.visible=ghost>.01;this.group.visible=alpha>.01&&this.drawn;}
 private drawn=false;
 /** Colour by position along the strand, 0 at its start. Called with nothing new it is skipped once settled. */
 paint(at:(u:number)=>T.Color,steady=false){
  const c=this.colors;if(!c||steady&&this.painted)return;this.painted=steady;
  for(let i=0;i<this.samples;i++){const k=at(i/(this.samples-1));for(let j=0;j<this.sides;j++){const n=(i*this.sides+j)*3;c[n]=k.r;c[n+1]=k.g;c[n+2]=k.b;}}
  this.geometry.attributes.color.needsUpdate=true;
 }
 set(path:P[]){
  const clean=path.filter((p,i)=>i===0||Math.hypot(p[0]-path[i-1][0],p[1]-path[i-1][1],p[2]-path[i-1][2])>1e-3);
  this.drawn=clean.length>1;this.group.visible=this.drawn;if(!this.drawn)return;
  this.curve.points=clean.map(p=>new T.Vector3(...p));
  const p=new T.Vector3(),q=new T.Vector3(),tan=new T.Vector3(),n=new T.Vector3(0,0,1),b=new T.Vector3(),{samples,sides,position,normal}=this;
  this.curve.getPoint(0,q);
  for(let i=0;i<samples;i++){
   this.curve.getPoint(i/(samples-1),p);
   tan.copy(p).sub(q);if(i&&tan.lengthSq()>1e-10){tan.normalize();n.addScaledVector(tan,-n.dot(tan));if(n.lengthSq()<1e-6)n.set(tan.y,-tan.x,.01);n.normalize();b.crossVectors(tan,n);}
   for(let j=0;j<sides;j++){
    const a=j/sides*Math.PI*2,c=Math.cos(a),s=Math.sin(a),k=(i*sides+j)*3,x=c*n.x+s*b.x,y=c*n.y+s*b.y,z=c*n.z+s*b.z;
    position[k]=p.x+x*THREAD_R;position[k+1]=p.y+y*THREAD_R;position[k+2]=p.z+z*THREAD_R;normal[k]=x;normal[k+1]=y;normal[k+2]=z;
   }
   q.copy(p);
  }
  this.geometry.attributes.position.needsUpdate=this.geometry.attributes.normal.needsUpdate=true;
 }
}

const glowVert=/* glsl */`attribute float aSize;attribute vec3 aColor;uniform float uPx;varying vec3 vC;
void main(){vC=aColor;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uPx;}`;
const glowFrag=/* glsl */`varying vec3 vC;
void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;float a=exp(-r*r*3.2);gl_FragColor=vec4(vC*a,a);}`;
/** Additive soft dots in model space: exposures and the flow along linkages. Fixed capacity, rewritten each frame. */
class Glow {
 readonly points:T.Points;private readonly at:Float32Array;private readonly tint:Float32Array;private readonly size:Float32Array;private n=0;
 readonly px={value:1};
 constructor(private readonly cap:number){
  const g=new T.BufferGeometry();this.at=new Float32Array(cap*3);this.tint=new Float32Array(cap*3);this.size=new Float32Array(cap);
  g.setAttribute('position',new T.BufferAttribute(this.at,3).setUsage(T.DynamicDrawUsage));g.setAttribute('aColor',new T.BufferAttribute(this.tint,3).setUsage(T.DynamicDrawUsage));g.setAttribute('aSize',new T.BufferAttribute(this.size,1).setUsage(T.DynamicDrawUsage));
  this.points=new T.Points(g,new T.ShaderMaterial({vertexShader:glowVert,fragmentShader:glowFrag,uniforms:{uPx:this.px},transparent:true,depthTest:false,depthWrite:false,blending:T.AdditiveBlending}));
  this.points.frustumCulled=false;this.points.renderOrder=250;
 }
 begin(){this.n=0;}
 add(x:number,y:number,z:number,c:T.Color,gain:number,size:number){
  if(this.n>=this.cap)return;const i=this.n++;
  this.at[i*3]=x;this.at[i*3+1]=y;this.at[i*3+2]=z;this.tint[i*3]=c.r*gain;this.tint[i*3+1]=c.g*gain;this.tint[i*3+2]=c.b*gain;this.size[i]=size;
 }
 end(){const g=this.points.geometry;g.setDrawRange(0,this.n);this.points.visible=this.n>0;if(this.n)for(const k of ['position','aColor','aSize'])g.attributes[k].needsUpdate=true;}
}

/** Light painting: each moving part's working point, sampled back along the crank. */
const EXPOSE=3*360,EXPOSE_STEP=1;
type Trail={id:PartId;color:T.Color;at:(c:number,s:MachineState,o:MachineScene['options'],out:T.Vector3)=>boolean};
const trails:Trail[]=[
 {id:'needle',color:new T.Color('#e8f6ff'),at:(c,_,__,v)=>{v.set(0,needleTip(c),needleZ);return true;}},
 {id:'takeUp',color:new T.Color('#ffc861'),at:(c,_,__,v)=>{const t=takeUp(c);v.set(TAKE_UP[0]+t.x,TAKE_UP[1]+t.y,TAKE_UP[2]);return true;}},
 {id:'link',color:new T.Color('#b38cff'),at:(c,_,__,v)=>{v.set(0,shaftY+17*Math.cos(rad(c)),17*Math.sin(rad(c)));return true;}},
 {id:'hook',color:new T.Color('#ff9a3c'),at:(c,_,o,v)=>{const a=rad(hookAngle(c,o.hookTimingOffset));v.set(HOOK[0]+hookOut*Math.sin(a),HOOK[1]+hookOut*Math.cos(a),HOOK[2]-1);return true;}},
 {id:'feedDog',color:new T.Color('#7dffb0'),at:(c,_,__,v)=>{const f=feedPose(c);v.set(PITCH/2-f.x*PITCH+9,clothUnder-(1-f.y)*2.6,5);return true;}},
 {id:'bobbin',color:new T.Color('#ff5ad1'),at:(c,_,o,v)=>{const s=machinePose(c,o);if(s.loop.stage!=='carried'&&s.loop.stage!=='casting'&&s.loop.stage!=='pulling')return false;v.set(...apexOf({...s,stitches:[]},0));return true;}},
];
/** Who drives whom, from an anchor on each: what the exploded view keeps joined. */
const pin=(s:MachineState):P=>[0,shaftY+17*Math.cos(rad(s.crank)),17*Math.sin(rad(s.crank))];
const links:[PartId,(s:MachineState)=>P,PartId,(s:MachineState)=>P][]=[
 ['handwheel',()=>[wheelX-6,shaftY,0],'upperShaft',()=>[wheelX-16,shaftY,0]],
 ['upperShaft',pin,'link',pin],
 ['link',s=>[0,s.needleTip+linkDrop,needleZ],'needleBar',s=>[0,s.needleTip+linkDrop-6,needleZ]],
 ['needleBar',s=>[0,s.needleTip+26,needleZ],'needle',s=>[0,s.needleTip+20,needleZ]],
 ['upperShaft',()=>[pivot[0],shaftY,0],'takeUp',()=>[pivot[0],pivot[1],pivot[2]]],
 ['upperShaft',()=>[150,shaftY,0],'belt',()=>[150,shaftY-9,0]],
 ['belt',()=>[150,lowerY+9,lowerZ],'lowerShaft',()=>[150,lowerY,lowerZ]],
 ['lowerShaft',()=>[4,lowerY,lowerZ],'hook',()=>[0,HOOK[1],lowerZ+4]],
 ['lowerShaft',()=>[90,lowerY,lowerZ],'feedDog',s=>[PITCH/2-s.feed.x*PITCH,clothUnder-4,0]],
];
/** Stitches that stay at full colour before the oldest start to fade. */
/** Hooped fabric for free motion: indigo, woven, a little wider than the hoop. */
const FABRIC='#1d2a5e',FABRIC_R=HOOP_R+9;
const FRESH=160,FLOW=6,GOLD=new T.Color('#ffc861'),UNPICK_DRAWN=4;

/** The parts view plus what only a sewing machine needs: every part posed from the crank, two threads, and the hand effects drawn in model space. */
export class MachineView extends MeshPartsView {
 private readonly threads={top:new Thread(TOP_COLOR,460,7,true),bobbin:new Thread(BOBBIN_COLOR,160),settledTop:new Thread(TOP_COLOR,900),settledBobbin:new Thread(BOBBIN_COLOR,700)};
 private readonly settled=new T.Group();
 private settledKey='';
 private readonly pin=new T.Vector3();
 private readonly square=new T.Euler();
 private readonly plain=new T.Quaternion();private readonly looking=new T.Quaternion();
 /** Free motion: the drawn holes as instanced thread, the hoop, and a mark at the needle. */
 private readonly free=new T.Group();
 private readonly sewn:T.InstancedMesh;private readonly shade:T.InstancedMesh;private readonly fabric:T.Mesh<T.CircleGeometry,T.MeshStandardMaterial>;private sewnVersion=-1;
 private readonly hoop:T.Mesh<T.TorusGeometry,T.MeshBasicMaterial>;private readonly aim:T.Mesh<T.RingGeometry,T.MeshBasicMaterial>;
 private readonly exposure=new Glow(trails.length*(EXPOSE/EXPOSE_STEP+2));
 private readonly flow=new Glow(links.length*FLOW);
 private readonly linkLines:T.LineSegments<T.BufferGeometry,T.LineBasicMaterial>;
 private readonly unpicks=Array.from({length:UNPICK_DRAWN},()=>new Thread(TOP_COLOR,70,5));
 private painting=false;
 private readonly tmp=new T.Vector3();private readonly tmp2=new T.Vector3();private readonly color=new T.Color();private readonly m4=new T.Matrix4();private readonly q=new T.Quaternion();private readonly up=new T.Vector3(0,1,0);
 constructor(host:HTMLElement){
  let self:MachineView;
  super(host,{parts:machineParts,extras:machineExtras,unit:UNIT,center:CENTER,onFrame:f=>self.animate(f)});
  self=this;
  this.settled.add(this.threads.settledTop.group,this.threads.settledBobbin.group,...this.unpicks.map(u=>u.group));
  this.body.add(this.threads.top.group,this.threads.bobbin.group,this.settled);
  for(const id of ['hook','caseShell','bobbinCase','bobbin','bobbinRims'])this.part(id)!.motion.position.set(...(id==='hook'?HOOK:[0,0,0] as P));
  this.part('caseShell')!.motion.position.set(...HOOK);this.part('bobbinCase')!.motion.position.set(...HOOK);
  this.part('upperShaft')!.motion.position.set(0,shaftY,0);this.part('handwheel')!.motion.position.set(wheelX,shaftY,0);
  this.part('lowerShaft')!.motion.position.set(0,lowerY,lowerZ);this.part('takeUp')!.motion.position.set(...pivot);
  const stitch=new T.CylinderGeometry(.42,.42,1,6);stitch.translate(0,.5,0);
  this.sewn=new T.InstancedMesh(stitch,tintGlow(new T.MeshStandardMaterial({color:'#fff',emissive:'#fff',emissiveIntensity:.55,roughness:.45})),EMBROIDERY_CAP);
  this.sewn.instanceColor=new T.InstancedBufferAttribute(new Float32Array(EMBROIDERY_CAP*3),3);this.sewn.count=0;this.sewn.frustumCulled=false;this.sewn.renderOrder=150;
  // A soft shadow under each stitch, sharing its placement, lifts the thread off the weave.
  this.shade=new T.InstancedMesh(stitch,new T.MeshBasicMaterial({color:'#000',transparent:true,opacity:.5,depthWrite:false}),EMBROIDERY_CAP);
  this.shade.instanceMatrix=this.sewn.instanceMatrix;this.shade.count=0;this.shade.frustumCulled=false;this.shade.position.set(.35,-.32,.45);this.shade.renderOrder=149;
  this.fabric=new T.Mesh(new T.CircleGeometry(FABRIC_R,96).rotateX(-Math.PI/2),new T.MeshStandardMaterial({map:weave(),color:'#5d66a0',roughness:.95,metalness:0,envMapIntensity:.35,transparent:true,opacity:0}));
  this.fabric.position.y=-.45;this.fabric.renderOrder=140;
  this.hoop=new T.Mesh(new T.TorusGeometry(HOOP_R,.35,6,120).rotateX(Math.PI/2),new T.MeshBasicMaterial({color:'#9ff4ff',transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false}));
  this.aim=new T.Mesh(new T.RingGeometry(2.2,2.7,40).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:'#9ff4ff',transparent:true,opacity:0,depthWrite:false,depthTest:false,blending:T.AdditiveBlending,toneMapped:false,side:T.DoubleSide}));
  this.aim.position.set(0,clothTop+.5,0);this.aim.renderOrder=240;
  this.free.add(this.fabric,this.shade,this.sewn,this.hoop);this.body.add(this.free,this.aim,this.exposure.points,this.flow.points);
  const lg=new T.BufferGeometry();lg.setAttribute('position',new T.BufferAttribute(new Float32Array(links.length*6),3).setUsage(T.DynamicDrawUsage));
  this.linkLines=new T.LineSegments(lg,new T.LineBasicMaterial({color:GOLD,transparent:true,opacity:0,depthTest:false,depthWrite:false,blending:T.AdditiveBlending}));
  this.linkLines.frustumCulled=false;this.linkLines.renderOrder=245;this.body.add(this.linkLines);
 }
 /** Light painting draws as x-ray underneath; the open hand steers cloth here rather than parting parts. */
 override draw(input:MeshScene,now:number){
  const scene=input as unknown as MachineScene,skin=scene.skin,fields=scene.fields;
  this.painting=skin==='paint';input.skin=skin==='paint'?'xray':skin;scene.fields=[];
  super.draw(input,now);scene.skin=skin;scene.fields=fields;
 }
 screenOf(id:string){
  const e=this.part(id);if(!e)return {x:0,y:0};
  const mesh=e.motion.children[0] as T.Mesh;mesh.geometry.boundingSphere??mesh.geometry.computeBoundingSphere();
  const c=mesh.geometry.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld).project(this.camera);
  return {x:(c.x+1)/2,y:(1-c.y)/2};
 }
 /** A point on the top thread above the cloth, 0..1 on the stage, for a test or a hint. */
 threadScreen(rise=.5){
  const t=this.threads.top,v=this.tmp;
  for(let i=t.samples-1;i>=0;i--){const k=i*t.sides*3;if(t.position[k+1]<clothTop+6+rise*12)continue;v.set(t.position[k],t.position[k+1],t.position[k+2]).applyMatrix4(this.body.matrixWorld).project(this.camera);break;}
  return {x:(v.x+1)/2,y:(1-v.y)/2};
 }
 onThread(p:WorldPoint){
  const t=this.threads.top;if(!t.group.visible)return false;
  const w=this.host.clientWidth/2,h=this.host.clientHeight/2,target=this.tmp2.set(p.x,p.y,p.z).project(this.camera);
  for(let i=0;i<t.samples;i+=3){
   const k=i*t.sides*3;if(t.position[k+1]<clothTop+2)continue;
   const v=this.tmp.set(t.position[k],t.position[k+1],t.position[k+2]).applyMatrix4(this.body.matrixWorld).project(this.camera);
   if(Math.abs(v.x)<1&&Math.abs(v.y)<1&&Math.hypot((v.x-target.x)*w,(v.y-target.y)*h)<30)return true;
  }
  return false;
 }
 private motion(id:PartId){return this.part(id)!.motion;}
 private offset(id:PartId,out:T.Vector3){return out.copy(this.part(id)!.group.position);}
 private animate(f:MeshFrame){
  const scene=f.scene as unknown as MachineScene,s=scene.machine,o=scene.options,crank=rad(s.crank),t=this.threads,draw=smooth(scene.draw);
  // The home pose is turned to show off the whole machine; the close-up turns most of that back so the plate reads level, and drawing looks straight down the needle.
  const k=UNIT*scene.scale;this.plain.setFromEuler(this.square.set(-.06*scene.close,.4*scene.close,0,'YXZ'));
  if(draw>0){this.looking.copy(this.root.quaternion).invert().multiply(this.q.setFromAxisAngle(this.tmp.set(1,0,0),DRAW_PITCH));this.plain.slerp(this.looking,draw);}
  this.body.quaternion.copy(this.plain);
  this.body.position.set(-scene.focus[0],-scene.focus[1],-scene.focus[2]).multiplyScalar(k).applyQuaternion(this.body.quaternion);
  this.motion('upperShaft').rotation.x=crank;this.motion('handwheel').rotation.x=crank;this.motion('lowerShaft').rotation.x=crank;
  this.motion('needle').position.set(0,s.needleTip,needleZ);this.motion('needleBar').position.set(0,s.needleTip,needleZ);
  this.motion('hook').rotation.z=-rad(s.hookDeg);
  // Free motion drops the feed dog below the plate.
  this.motion('feedDog').position.set(PITCH/2-s.feed.x*PITCH,clothUnder-(1-s.feed.y)*2.6-draw*3.2,0);
  const eyeX=TAKE_UP[0]+s.takeUp.x,eyeY=TAKE_UP[1]+s.takeUp.y,lever=this.motion('takeUp');
  lever.rotation.z=Math.atan2(pivot[1]-eyeY,pivot[0]-eyeX);lever.scale.x=Math.hypot(pivot[0]-eyeX,pivot[1]-eyeY)/leverLength;
  this.pin.set(0,shaftY+17*Math.cos(crank),17*Math.sin(crank));
  const link=this.motion('link'),dy=this.pin.y-(s.needleTip+linkDrop),dz=this.pin.z-needleZ;
  link.position.copy(this.pin);link.rotation.x=Math.atan2(dz,dy);link.scale.y=Math.hypot(dy,dz)/(linkDrop*.7);
  const [ox,oz]=scene.cloth;
  this.motion('cloth').position.set(ox,0,oz);
  this.part('clothMarks')!.motion.position.set(-mod(s.clothTravel,clothMark),0,oz);
  for(const [id,leader] of Object.entries(followers))this.part(id)!.group.position.copy(this.part(leader)!.group.position);
  this.threadsFor(scene,f.now);
  const key=`${s.stitches.length}:${s.stitches.at(-1)?.index??-1}`;
  if(key!==this.settledKey){this.settledKey=key;const p=settledPaths(s.stitches);t.settledTop.set(p.top);t.settledBobbin.set(p.bobbin);}
  this.settled.position.set(-s.clothTravel,0,oz);
  const alpha=1-smooth(scene.explode/.3),ghost=.34*smooth(scene.close/.5);
  for(const thread of Object.values(t))thread.look(alpha,ghost*(1-draw));
  t.settledTop.look(alpha*(1-draw),ghost);t.settledBobbin.look(alpha*(1-draw),ghost);
  this.unpicked(scene);this.embroider(scene,f.now,draw);
  this.exposure.px.value=this.flow.px.value=this.renderer.getPixelRatio();
  this.paintLight(scene);this.linkages(scene);
 }
 /** Held, the top thread kinks toward the fingers and shows its tension from the discs down; before the discs it is unstressed. */
 private threadsFor(scene:MachineScene,now:number){
  const s=scene.machine,o=scene.options,t=this.threads,ten=scene.tension,v=ten.value,off=Math.abs(v-.5)>.03||!!ten.held||ten.broken;
  let path=topPath(s,o,Math.max(-.65,(.5-v)*2.4),ten.broken);
  if(ten.held&&!ten.broken)path=this.kink(path,ten.held);
  // Looking straight down, the route over the arm would scribble across the drawing: the thread enters from the needle bar instead.
  if(scene.draw>.5)path=path.filter(p=>p[1]<36);
  t.top.set(path);t.bobbin.set(bobbinPath(s,o));
  const disc=DISCS/Math.max(1,path.length-1),base=new T.Color(TOP_COLOR);
  if(!off){t.top.paint(()=>base,true);return;}
  const tone=tensionColor(v),tight=Math.max(0,(v-.6)/.4);
  t.top.paint(u=>u<disc?this.color.copy(LOOSE_SIDE):this.color.copy(tone).multiplyScalar(1+.45*tight*Math.sin(u*90-now*.03)));
 }
 private kink(path:P[],held:WorldPoint){
  const m=this.body.matrixWorld,target=this.tmp2.set(held.x,held.y,held.z).project(this.camera),aspect=this.camera.aspect;
  let best=-1,far=Infinity;
  for(let i=DISCS+1;i<path.length;i++){
   if(path[i][1]<clothTop+3)continue;
   const v=this.tmp.set(...path[i]).applyMatrix4(m).project(this.camera),d=Math.hypot((v.x-target.x)*aspect,v.y-target.y);
   if(d<far){far=d;best=i;}
  }
  if(best<0||far>.5)return path;
  const v=this.tmp.set(...path[best]).applyMatrix4(m).project(this.camera);v.x=target.x;v.y=target.y;v.unproject(this.camera);this.body.worldToLocal(v);
  const was=path[best],d=Math.hypot(v.x-was[0],v.y-was[1],v.z-was[2]),k=d>16?16/d:1,out=path.slice();
  out[best]=[was[0]+(v.x-was[0])*k,was[1]+(v.y-was[1])*k,was[2]+(v.z-was[2])*k];
  return out;
 }
 /** Running backwards: each lock pulled out curls up off the cloth and fades. */
 private unpicked(scene:MachineScene){
  const list=scene.unpicked.slice(-UNPICK_DRAWN);
  this.unpicks.forEach((thread,n)=>{
   const e=list[n];if(!e){thread.look(0,0);return;}
   const u=Math.min(1,e.age/1.4),path:P[]=[];
   for(let j=0;j<=18;j++){const v=j/18,a=v*10+u*7,r=(.6+v*1.6)*(.4+u);path.push([e.x+Math.sin(a)*r-u*4*v,clothTop+.3+v*(3+u*20),Math.cos(a)*r]);}
   thread.set(path);thread.look((1-u)*(1-smooth(scene.explode/.3)),.3);
  });
 }
 private embroider(scene:MachineScene,now:number,draw:number){
  const e=scene.embroidery;
  this.free.position.set(-scene.machine.clothTravel,clothTop+.32,scene.cloth[1]).add(this.part('cloth')!.group.position);this.free.visible=draw>.01||!scene.hidden.has('cloth');
  this.hoop.position.set(e.hoop[0],0,e.hoop[1]);this.hoop.material.opacity=.1*draw;this.hoop.visible=draw>.01;
  const m=this.fabric.material;this.fabric.position.set(e.hoop[0],-.45,e.hoop[1]);m.opacity=draw;m.transparent=draw<1;m.depthWrite=draw>.5;this.fabric.visible=draw>.01;this.shade.visible=draw>.01;
  this.aim.material.opacity=draw*(.45+.25*Math.sin(now*.008));this.aim.visible=draw>.01;
  if(e.version===this.sewnVersion)return;
  this.sewnVersion=e.version;
  const n=e.count,start=(e.head-n+EMBROIDERY_CAP)%EMBROIDERY_CAP,top=new T.Color(TOP_COLOR),cloth=new T.Color(CLOTH);let drawn=0;
  for(let r=1;r<n;r++){
   const i=(start+r)%EMBROIDERY_CAP,j=(start+r-1)%EMBROIDERY_CAP;if(e.jump[i])continue;
   const a=this.tmp.set(e.x[j],0,e.z[j]),b=this.tmp2.set(e.x[i],0,e.z[i]),len=a.distanceTo(b);if(len<1e-3)continue;
   // A stitch is the thread between two holes, a hair short of each so the holes read.
   b.sub(a).normalize();this.q.setFromUnitVectors(this.up,b);a.addScaledVector(b,Math.min(.25,len*.1));
   this.m4.compose(a,this.q,this.pin.set(1,Math.max(.2,len-Math.min(.5,len*.2)),1));this.sewn.setMatrixAt(drawn,this.m4);
   // The oldest fade toward the cloth, so a long drawing keeps its newest strokes bright.
   this.sewn.setColorAt(drawn,this.color.copy(cloth).lerp(top,1-.8*smooth((n-r-FRESH)/(EMBROIDERY_CAP-FRESH))));drawn++;
  }
  this.sewn.count=this.shade.count=drawn;this.sewn.instanceMatrix.needsUpdate=true;if(this.sewn.instanceColor)this.sewn.instanceColor.needsUpdate=true;
 }
 private paintLight(scene:MachineScene){
  const g=this.exposure,s=scene.machine,o=scene.options;g.begin();
  if(!this.painting||scene.exposure<=0){g.end();return;}
  const span=Math.min(EXPOSE,scene.exposure),n=Math.max(2,Math.floor(span/EXPOSE_STEP)),v=this.tmp,shift=this.tmp2,big=Math.min(2.4,Math.max(1,scene.scale/1.4));
  for(const trail of trails){
   const part=this.part(trail.id);if(!part||!part.group.visible)continue;
   this.offset(trail.id,shift);
   for(let j=0;j<=n;j++){
    const u=j/n,c=s.crank-span+u*span;if(!trail.at(c,s,o,v))continue;
    // Overlapping turns add up, as a long exposure does; the head is the brightest, largest point.
    g.add(v.x+shift.x,v.y+shift.y,v.z+shift.z,trail.color,.16+.6*u*u,(3+4*u)*big);
   }
   if(trail.at(s.crank,s,o,v))g.add(v.x+shift.x,v.y+shift.y,v.z+shift.z,trail.color,1.4,14*big);
  }
  g.end();
 }
 private linkages(scene:MachineScene){
  const apart=smooth((scene.explode-.08)/.3),g=this.flow,s=scene.machine,line=this.linkLines,pos=line.geometry.attributes.position as T.BufferAttribute;g.begin();
  line.material.opacity=.6*apart;line.visible=apart>.01;
  if(!line.visible){g.end();return;}
  const a=this.tmp,b=this.tmp2,phase=s.crank/180,big=Math.min(2,Math.max(1,scene.scale/1.4));
  links.forEach(([from,fa,to,ta],n)=>{
   const pf=this.part(from)!,pt=this.part(to)!,on=pf.group.visible&&pt.group.visible;
   a.set(...fa(s)).add(pf.group.position);b.set(...ta(s)).add(pt.group.position);
   if(!on)b.copy(a);
   pos.setXYZ(n*2,a.x,a.y,a.z);pos.setXYZ(n*2+1,b.x,b.y,b.z);
   if(!on)return;
   // Light runs from driver to driven at the crank's pace, and backwards when it reverses.
   for(let i=0;i<FLOW;i++){const u=mod(phase+i/FLOW,1);g.add(a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u,a.z+(b.z-a.z)*u,GOLD,apart*(.7+.8*Math.sin(u*Math.PI)),(9+8*Math.sin(u*Math.PI))*big);}
   g.add(b.x,b.y,b.z,GOLD,apart*1.1,18*big);
  });
  pos.needsUpdate=true;g.end();
 }
}
