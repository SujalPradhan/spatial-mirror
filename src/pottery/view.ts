import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {vaseGeometry,radiusAt,type Vase,type PaintStroke} from './model';
export function paintTexture(canvas:HTMLCanvasElement,vase:Vase){
 const ctx=canvas.getContext('2d')!,size=canvas.width;ctx.fillStyle=vase.color;ctx.fillRect(0,0,size,size);ctx.lineCap=ctx.lineJoin='round';
 for(const stroke of vase.strokes){ctx.strokeStyle=ctx.fillStyle=stroke.color;ctx.lineWidth=stroke.width*size;let previous:[number,number]|null=null;
 for(const point of stroke.points){let u=point[0];const v=point[1];if(previous&&stroke.wrap){while(u-previous[0]>.5)u--;while(u-previous[0]<-.5)u++;}
 for(const offset of [-1,0,1]){if(previous){ctx.beginPath();ctx.moveTo((previous[0]+offset)*size,(1-previous[1])*size);ctx.lineTo((u+offset)*size,(1-v)*size);ctx.stroke();}else{ctx.beginPath();ctx.arc((u+offset)*size,(1-v)*size,ctx.lineWidth/2,0,2*Math.PI);ctx.fill();}}
 previous=[point[0],v];}
 }
}
export function makeArtwork(vase:Vase){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;paintTexture(canvas,vase);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;texture.anisotropy=4;
 const material=new THREE.MeshStandardMaterial({map:texture,roughness:.57,metalness:0});
 const inside=new THREE.MeshStandardMaterial({color:vase.color,roughness:.8});
 const mesh=new THREE.Mesh(vaseGeometry(vase),[material,inside]);mesh.name=vase.name;mesh.castShadow=true;mesh.receiveShadow=true;return {mesh,texture,canvas};
}
export function disposeArtwork(art:ReturnType<typeof makeArtwork>){art.mesh.geometry.dispose();for(const m of art.mesh.material)m.dispose();art.texture.dispose();}
// Stage-only floor: it fades out so the page's dark backdrop shows through. Never exported.
function floorFade(){const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d')!,g=ctx.createRadialGradient(128,128,20,128,128,128);g.addColorStop(0,'#fff');g.addColorStop(1,'#000');ctx.fillStyle=g;ctx.fillRect(0,0,256,256);return new THREE.CanvasTexture(c);}
export class PotteryView {
 readonly scene=new THREE.Scene();readonly camera=new THREE.PerspectiveCamera(38,1,1,3000);readonly renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});readonly root=new THREE.Group();
 readonly controls:OrbitControls;private art:ReturnType<typeof makeArtwork>|null=null;private shapeKey='';private paintKey='';private ring=new THREE.Mesh(new THREE.TorusGeometry(1,.008,8,96),new THREE.MeshBasicMaterial({color:0xffc861}));private plane=new THREE.Mesh(new THREE.CircleGeometry(450,96),new THREE.MeshStandardMaterial({color:0x101a24,roughness:1,transparent:true,alphaMap:floorFade()}));
 constructor(private el:HTMLElement){this.renderer.setPixelRatio(Math.min(2,devicePixelRatio));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;el.prepend(this.renderer.domElement);
 this.camera.position.set(290,240,370);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,90,0);this.controls.minDistance=220;this.controls.maxDistance=850;this.controls.enableDamping=false;this.controls.update();this.scene.add(this.root);
 this.plane.rotation.x=-Math.PI/2;this.plane.position.y=-2;this.plane.receiveShadow=true;this.scene.add(this.plane);this.scene.add(new THREE.HemisphereLight(0xffffff,0xc1b9a4,2.8));const sun=new THREE.DirectionalLight(0xfff0da,3.3);sun.position.set(150,400,220);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-180;sun.shadow.camera.right=180;sun.shadow.camera.top=350;sun.shadow.camera.bottom=-80;sun.shadow.camera.far=1000;this.scene.add(sun);
 this.ring.rotation.x=Math.PI/2;this.root.add(this.ring);new ResizeObserver(()=>this.resize()).observe(el);this.resize();}
 private resize(){this.renderer.setSize(this.el.clientWidth,this.el.clientHeight);this.camera.aspect=this.el.clientWidth/this.el.clientHeight;this.camera.updateProjectionMatrix();}
 update(vase:Vase,band:number,shape:boolean){
 const shapeKey=JSON.stringify([vase.height,vase.radii]),paintKey=JSON.stringify([vase.color,vase.strokes]);
 if(!this.art){this.art=makeArtwork(vase);this.root.add(this.art.mesh);}
 else{
  if(shapeKey!==this.shapeKey){const old=this.art.mesh.geometry;this.art.mesh.geometry=vaseGeometry(vase);old.dispose();}
  if(paintKey!==this.paintKey){paintTexture(this.art.canvas,vase);this.art.texture.needsUpdate=true;this.art.mesh.material[1].color.set(vase.color);}
 }
 this.shapeKey=shapeKey;this.paintKey=paintKey;this.art.mesh.name=vase.name;this.art.mesh.position.y=-vase.height/2;this.root.position.y=vase.height/2;
 this.ring.visible=shape;this.ring.position.y=band*vase.height/32-vase.height/2;this.ring.scale.set(radiusAt(vase,band/32)+1,radiusAt(vase,band/32)+1,1);}
 hit(clientX:number,clientY:number):[number,number]|null{if(!this.art)return null;const r=this.renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((clientX-r.x)/r.width*2-1,1-(clientY-r.y)/r.height*2),this.camera);const h=ray.intersectObject(this.art.mesh)[0];return h?.uv&&h.face?.materialIndex===0?[h.uv.x,h.uv.y]:null;}
 render(){this.controls.update();this.renderer.render(this.scene,this.camera);}
 async export(vase:Vase){const art=makeArtwork(vase);art.mesh.scale.setScalar(.001);art.mesh.userData={units:'metres',sourceUnits:'mm',heightMm:vase.height,kind:'axisymmetric vase concept'};try{return await new GLTFExporter().parseAsync(art.mesh,{binary:true}) as ArrayBuffer;}finally{disposeArtwork(art);}}
}
