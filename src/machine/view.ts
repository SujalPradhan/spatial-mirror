import * as T from 'three';
import {MeshPartsView,type MeshFrame} from '../mirror/parts-view';
import {PITCH} from './model';
import type {MachineScene} from './contracts';
import {bobbinPath,settledPaths,topPath} from './threads';
import {CENTER,UNIT,dims,followers,leverLength,machineExtras,machineParts,type P,type PartId} from './parts';

const TOP_COLOR='#ff5a4a',BOBBIN_COLOR='#35d6ff',THREAD_R=.4;
const smooth=(n:number)=>{const u=Math.max(0,Math.min(1,n));return u*u*(3-2*u);};
const rad=(d:number)=>d*Math.PI/180;
const {hook:HOOK,clothUnder,needleZ,shaftY,lowerY,lowerZ,linkDrop,wheelX,pivot,takeUp:TAKE_UP,clothMark}=dims;

/** A tube rewritten in place each frame along a Catmull-Rom spline. */
class Thread {
 readonly group=new T.Group();
 private readonly geometry=new T.BufferGeometry();
 private readonly position:Float32Array;private readonly normal:Float32Array;
 private readonly curve=new T.CatmullRomCurve3([],false,'centripetal');
 private readonly solid:T.MeshStandardMaterial;private readonly ghost:T.MeshBasicMaterial;
 constructor(color:string,private readonly samples=460,private readonly sides=7){
  const verts=samples*sides;this.position=new Float32Array(verts*3);this.normal=new Float32Array(verts*3);
  const index:number[]=[];
  for(let i=0;i<samples-1;i++)for(let j=0;j<sides;j++){const a=i*sides+j,b=i*sides+(j+1)%sides,c=a+sides,d=b+sides;index.push(a,c,b,b,c,d);}
  this.geometry.setIndex(index);this.geometry.setAttribute('position',new T.BufferAttribute(this.position,3).setUsage(T.DynamicDrawUsage));this.geometry.setAttribute('normal',new T.BufferAttribute(this.normal,3).setUsage(T.DynamicDrawUsage));
  this.solid=new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.42,roughness:.5});
  // Ghosted pass: the part of a strand behind the case stays followable.
  this.ghost=new T.MeshBasicMaterial({color,transparent:true,opacity:.34,depthTest:false,depthWrite:false});
  const solid=new T.Mesh(this.geometry,this.solid),ghost=new T.Mesh(this.geometry,this.ghost);
  solid.frustumCulled=ghost.frustumCulled=false;solid.renderOrder=1;ghost.renderOrder=210;this.group.add(solid,ghost);
 }
 look(alpha:number,ghost:number){this.solid.opacity=alpha;this.solid.transparent=alpha<1;this.ghost.opacity=ghost*alpha;this.ghost.visible=ghost>.01;this.group.visible=alpha>.01&&this.drawn;}
 private drawn=false;
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

/** The parts view plus what only a sewing machine needs: every part posed from the crank, and two threads. */
export class MachineView extends MeshPartsView {
 private readonly threads={top:new Thread(TOP_COLOR),bobbin:new Thread(BOBBIN_COLOR,160),settledTop:new Thread(TOP_COLOR,900),settledBobbin:new Thread(BOBBIN_COLOR,700)};
 private readonly settled=new T.Group();
 private settledKey='';
 private readonly pin=new T.Vector3();
 private readonly square=new T.Euler();
 constructor(host:HTMLElement){
  let self:MachineView;
  super(host,{parts:machineParts,extras:machineExtras,unit:UNIT,center:CENTER,onFrame:f=>self.animate(f)});
  self=this;
  this.settled.add(this.threads.settledTop.group,this.threads.settledBobbin.group);
  this.body.add(this.threads.top.group,this.threads.bobbin.group,this.settled);
  for(const id of ['hook','caseShell','bobbinCase','bobbin','bobbinRims'])this.part(id)!.motion.position.set(...(id==='hook'?HOOK:[0,0,0] as P));
  this.part('caseShell')!.motion.position.set(...HOOK);this.part('bobbinCase')!.motion.position.set(...HOOK);
  this.part('upperShaft')!.motion.position.set(0,shaftY,0);this.part('handwheel')!.motion.position.set(wheelX,shaftY,0);
  this.part('lowerShaft')!.motion.position.set(0,lowerY,lowerZ);this.part('takeUp')!.motion.position.set(...pivot);
 }
 override draw(scene:MachineScene,now:number){
  const tear=scene.explode;scene.explode=Math.max(tear,scene.parted);
  super.draw(scene,now);scene.explode=tear;
 }
 screenOf(id:string){
  const e=this.part(id);if(!e)return {x:0,y:0};
  const mesh=e.motion.children[0] as T.Mesh;mesh.geometry.boundingSphere??mesh.geometry.computeBoundingSphere();
  const c=mesh.geometry.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld).project(this.camera);
  return {x:(c.x+1)/2,y:(1-c.y)/2};
 }
 private motion(id:PartId){return this.part(id)!.motion;}
 private animate(f:MeshFrame){
  const scene=f.scene as MachineScene,s=scene.machine,o=scene.options,crank=rad(s.crank),t=this.threads;
  // The home pose is turned to show off the whole machine; the close-up turns most of that back so the plate reads level.
  const k=UNIT*scene.scale;this.body.quaternion.setFromEuler(this.square.set(-.06*scene.close,.4*scene.close,0,'YXZ'));
  this.body.position.set(-scene.focus[0],-scene.focus[1],-scene.focus[2]).multiplyScalar(k).applyQuaternion(this.body.quaternion);
  this.motion('upperShaft').rotation.x=crank;this.motion('handwheel').rotation.x=crank;this.motion('lowerShaft').rotation.x=crank;
  this.motion('needle').position.set(0,s.needleTip,needleZ);this.motion('needleBar').position.set(0,s.needleTip,needleZ);
  this.motion('hook').rotation.z=-rad(s.hookDeg);
  this.motion('feedDog').position.set(PITCH/2-s.feed.x*PITCH,clothUnder-(1-s.feed.y)*2.6,0);
  const eyeX=TAKE_UP[0]+s.takeUp.x,eyeY=TAKE_UP[1]+s.takeUp.y,lever=this.motion('takeUp');
  lever.rotation.z=Math.atan2(pivot[1]-eyeY,pivot[0]-eyeX);lever.scale.x=Math.hypot(pivot[0]-eyeX,pivot[1]-eyeY)/leverLength;
  this.pin.set(0,shaftY+17*Math.cos(crank),17*Math.sin(crank));
  const link=this.motion('link'),dy=this.pin.y-(s.needleTip+linkDrop),dz=this.pin.z-needleZ;
  link.position.copy(this.pin);link.rotation.x=Math.atan2(dz,dy);link.scale.y=Math.hypot(dy,dz)/(linkDrop*.7);
  this.part('clothMarks')!.motion.position.x=-(((scene.machine.clothTravel%clothMark)+clothMark)%clothMark);
  for(const [id,leader] of Object.entries(followers))this.part(id)!.group.position.copy(this.part(leader)!.group.position);
  t.top.set(topPath(s,o));t.bobbin.set(bobbinPath(s,o));
  const key=`${s.stitches.length}:${s.stitches.at(-1)?.index??-1}`;
  if(key!==this.settledKey){this.settledKey=key;const p=settledPaths(s.stitches);t.settledTop.set(p.top);t.settledBobbin.set(p.bobbin);}
  this.settled.position.x=-s.clothTravel;
  const alpha=1-smooth(Math.max(scene.explode,scene.parted)/.3),ghost=.34*smooth(scene.close/.5);
  for(const thread of Object.values(t))thread.look(alpha,ghost);
 }
}
