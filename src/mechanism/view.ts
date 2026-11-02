import * as T from 'three';
import {panels,type Part,type Panel} from './model';
import type {State} from './store';
export class AssemblyView {
 readonly camera=new T.PerspectiveCamera(38,1,1,3000);readonly renderer:T.WebGLRenderer;
 private scene=new T.Scene();private root=new T.Group();private meshes=new Map<string,T.Mesh<T.BoxGeometry,T.MeshStandardMaterial>>();private ray=new T.Raycaster();private observer:ResizeObserver;private guide=new T.ArrowHelper(new T.Vector3(0,1,0),new T.Vector3(0,90,0),170,0xffc861,12,6);private hinge=new T.Mesh(new T.CylinderGeometry(3,3,255,16),new T.MeshStandardMaterial({color:0x9b7748}));
 private fit=1;
 private colors={body:0x8cae9b,lid:0x649283,tray:0xe1b878,shelf:0x8b8d8d};
 constructor(readonly host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.prepend(this.renderer.domElement);
  this.scene.add(this.root,new T.HemisphereLight(0xffffff,0x3c4a50,2.2));const sun=new T.DirectionalLight(0xffffff,2.6);sun.position.set(150,500,400);this.scene.add(sun);
  const grid=new T.GridHelper(700,28,0x53697c,0x24364a);grid.position.y=-1;this.root.add(grid,this.guide,this.hinge);this.hinge.rotation.z=Math.PI/2;this.hinge.position.set(0,100,-80);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
 }
 private resize(){const r=this.host.getBoundingClientRect();this.renderer.setSize(r.width,r.height);this.camera.aspect=r.width/Math.max(1,r.height);
  // A full-bleed stage is much taller than the free space between its drawers. CSS states how tall a frame the model should fill and how far to lift it clear of the recording dock.
  const css=getComputedStyle(this.host),frame=Number.parseFloat(css.getPropertyValue('--view-frame')),lift=Number.parseFloat(css.getPropertyValue('--view-lift'))||0;
  this.fit=frame>0?Math.min(1,frame/Math.max(1,r.height)):1;
  if(lift)this.camera.setViewOffset(r.width,r.height,0,r.height*lift,r.width,r.height);else this.camera.clearViewOffset();
  this.camera.updateProjectionMatrix();}
 update(state:State,contact:string[]=[],hover:Part|null=null){
  const v=state.view,yaw=.65+v.yaw,elevation=.6+v.pitch,radius=560;const target=new T.Vector3(v.x,100+v.y,0);
  this.camera.position.set(target.x+radius*Math.cos(elevation)*Math.sin(yaw),target.y+radius*Math.sin(elevation),target.z+radius*Math.cos(elevation)*Math.cos(yaw));this.camera.lookAt(target);this.camera.zoom=v.zoom*this.fit;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
  const list=panels(state.pose,state.config),ids=new Set(list.map(p=>p.id));for(const [id,mesh] of this.meshes)if(!ids.has(id)){this.root.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();this.meshes.delete(id);}
  for(const p of list){let mesh=this.meshes.get(p.id);if(!mesh){mesh=new T.Mesh(new T.BoxGeometry(...p.size),new T.MeshStandardMaterial({roughness:.7,metalness:.05}));mesh.userData.part=p.part;const edge=new T.LineSegments(new T.EdgesGeometry(mesh.geometry),new T.LineBasicMaterial({color:0x264b3c,transparent:true,opacity:.6}));mesh.add(edge);this.meshes.set(p.id,mesh);this.root.add(mesh);}
   mesh.position.set(...p.center);mesh.rotation.x=p.rotation;mesh.material.color.setHex(this.colors[p.part]);mesh.material.emissive.setHex(contact.includes(p.part)?0x81391d:hover===p.part?0x263d26:state.selected===p.part?0x102b22:0);mesh.material.emissiveIntensity=contact.includes(p.part)?.65:.45;
  }
  this.guide.visible=state.selected==='tray';this.guide.position.y=90+state.pose.lift;this.root.updateMatrixWorld(true);
 }
 pick(x:number,y:number):Part|null{
  this.ray.setFromCamera(new T.Vector2(x*2-1,1-y*2),this.camera);
  // All panels occlude. A hidden tray cannot be selected through a closed lid.
  const hit=this.ray.intersectObjects([...this.meshes.values()],false)[0];return hit&&['lid','tray'].includes(hit.object.userData.part)?hit.object.userData.part:null;
 }
 project(part:Part){const list=[...this.meshes.values()].filter(m=>m.userData.part===part);const center=new T.Vector3();for(const mesh of list)center.add(mesh.position);center.divideScalar(list.length||1);return this.projectPoint(center);}
 private projectPoint(p:T.Vector3){const s=p.clone().project(this.camera);return {x:(s.x+1)/2,y:(1-s.y)/2};}
 axisDrag(dx:number,dy:number){const a=this.projectPoint(new T.Vector3(0,90,0)),b=this.projectPoint(new T.Vector3(0,250,0)),x=b.x-a.x,y=b.y-a.y,n=x*x+y*y;return n>.0008?(dx*x+dy*y)/n*160:null;}
 render(){this.renderer.render(this.scene,this.camera);}
 dispose(){this.observer.disconnect();this.renderer.dispose();}
}
