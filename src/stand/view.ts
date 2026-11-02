import * as T from 'three';
import type {State} from './model';
export class StandView {
 readonly renderer:T.WebGLRenderer;readonly camera=new T.PerspectiveCamera(36,1,1,2500);
 private scene=new T.Scene();private assembly=new T.Group();private back=new T.Group();private device=new T.Group();private observer:ResizeObserver;
 constructor(readonly host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.prepend(this.renderer.domElement);
  this.scene.add(this.assembly,new T.HemisphereLight(0xffffff,0x8fa3a0,3));const light=new T.DirectionalLight(0xffffff,3);light.position.set(150,400,250);this.scene.add(light);
  const grid=new T.GridHelper(650,26,0x3d5163,0x202f3c);grid.position.y=-1;this.scene.add(grid);
  const panel=(parent:T.Object3D,size:[number,number,number],pos:[number,number,number],color:number)=>{const m=new T.Mesh(new T.BoxGeometry(...size),new T.MeshStandardMaterial({color,roughness:.65,metalness:.15}));m.position.set(...pos);parent.add(m);const edge=new T.LineSegments(new T.EdgesGeometry(m.geometry),new T.LineBasicMaterial({color:0xcfe6da,transparent:true,opacity:.3}));m.add(edge);return m;};
  panel(this.assembly,[140,8,220],[0,6,0],0xa7b9a3);
  for(const x of [-55,55])for(const z of [-85,85])panel(this.assembly,[20,2,25],[x,1,z],0x74877b);
  const hinge=new T.Mesh(new T.CylinderGeometry(7,7,144,32),new T.MeshStandardMaterial({color:0x607869,metalness:.5,roughness:.4}));hinge.rotation.z=Math.PI/2;hinge.position.set(0,15,100);this.assembly.add(hinge);
  this.back.position.set(0,15,100);this.assembly.add(this.back);
  panel(this.back,[128,6,190],[0,0,-95],0x467c66);
  // The retaining lip and its rubber strip rotate with the backrest.
  panel(this.back,[108,15,7],[0,10,-4],0x729680);
  panel(this.back,[98,2,11],[0,5,-10],0x66806f);
  this.back.add(this.device);
  panel(this.device,[92,8,164],[0,9,-95],0x5a7a6c);
  const screen=panel(this.device,[84,1,149],[0,13.6,-95],0xe8e3ca);screen.material=new T.MeshStandardMaterial({color:0xe9e8d4,roughness:.9});
  for(const [z,w] of [[-148,53],[-133,68],[-118,68],[-103,48],[-75,68],[-60,58]] as const)panel(this.device,[w,.6,3],[-(68-w)/2,14.3,z],0xa0ad8e);
  panel(this.device,[68,.6,20],[0,14.3,-33],0xc5d1b1);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
 }
 private resize(){const r=this.host.getBoundingClientRect();this.renderer.setSize(r.width,r.height);this.camera.aspect=r.width/Math.max(1,r.height);this.camera.updateProjectionMatrix();}
 update(state:State,showDevice=true){const v=state.view,r=510,yaw=.6+v.yaw,pitch=.48+v.pitch;const target=new T.Vector3(v.x,70+v.y,0);this.camera.position.set(target.x+r*Math.cos(pitch)*Math.sin(yaw),target.y+r*Math.sin(pitch),target.z+r*Math.cos(pitch)*Math.cos(yaw));this.camera.lookAt(target);this.camera.zoom=v.zoom;this.camera.updateProjectionMatrix();this.back.rotation.x=state.angle*Math.PI/180;this.device.visible=showDevice;}
 render(){this.renderer.render(this.scene,this.camera);}
 dispose(){this.observer.disconnect();this.scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineSegments){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});this.renderer.dispose();}
}
