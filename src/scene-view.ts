import * as T from 'three';
import {shapes,objectPlane,section,planeBasis,type Section} from './geometry';
import {planeNormal,type SceneState,type ViewState,trackballRotation} from './scene-state';
import type {Quat} from './types';
export class SceneView {
 readonly camera=new T.PerspectiveCamera(36,1,.1,60);
 private renderer:T.WebGLRenderer;private scene=new T.Scene();private clip=new T.Plane();
 private solid=new T.Mesh(shapes.cone,new T.MeshStandardMaterial({color:0x93b5a1,roughness:.65,metalness:.04,side:T.DoubleSide,clippingPlanes:[this.clip]}));
 private ghost=new T.Mesh(shapes.cone,new T.MeshBasicMaterial({color:0x9fc8b8,transparent:true,opacity:.13,side:T.DoubleSide,depthWrite:false}));
 private outline=new T.LineSegments(new T.EdgesGeometry(shapes.cone,12),new T.LineBasicMaterial({color:0xb4dccd,transparent:true,opacity:.6}));
 private plane=new T.Group();private cap=new T.Mesh(new T.BufferGeometry(),new T.MeshBasicMaterial({color:0xffc861,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
 private boundary=new T.LineLoop(new T.BufferGeometry(),new T.LineBasicMaterial({color:0xffe2a8}));
 private targetPlane=new T.Group();private targetObject=new T.LineSegments(new T.EdgesGeometry(shapes.cube),new T.LineBasicMaterial({color:0xffc861,transparent:true,opacity:.9}));
 private observer:ResizeObserver;private solidId='';
 private cameraHome=new T.Vector3(4.2,3.1,5.2);private cameraOrientation=new T.Quaternion();
 constructor(readonly host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.localClippingEnabled=true;this.renderer.setClearColor(0x05080c,0);
  host.prepend(this.renderer.domElement);this.camera.position.copy(this.cameraHome);this.camera.lookAt(0,0,0);this.cameraOrientation.copy(this.camera.quaternion);
  this.scene.add(new T.HemisphereLight(0xdfeef0,0x24343a,1.5));const light=new T.DirectionalLight(0xffffff,2.1);light.position.set(3,6,4);this.scene.add(light);
  this.scene.add(this.solid,this.ghost,this.outline,this.cap,this.boundary,this.plane,this.targetPlane,this.targetObject);this.targetObject.visible=false;this.targetPlane.visible=false;
  const face=new T.Mesh(new T.PlaneGeometry(3.35,3.35),new T.MeshBasicMaterial({color:0x7fd1bb,side:T.DoubleSide,transparent:true,opacity:.12,depthWrite:false}));face.rotateX(-Math.PI/2);this.plane.add(face);
  const edge=new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(3.35,3.35)),new T.LineBasicMaterial({color:0x9fe0cb,transparent:true,opacity:.8}));edge.rotateX(-Math.PI/2);this.plane.add(edge);
  const arrow=new T.ArrowHelper(new T.Vector3(0,1,0),new T.Vector3(1.5,0,-1.5),.55,0x9fe0cb,.12,.07);this.plane.add(arrow);
  const targetEdge=new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(3.25,3.25)),new T.LineDashedMaterial({color:0xffc861,dashSize:.13,gapSize:.09,transparent:true,opacity:.95}));targetEdge.rotateX(-Math.PI/2);targetEdge.computeLineDistances();this.targetPlane.add(targetEdge);
  const grid=new T.GridHelper(8,16,0x4a5e6d,0x263442);grid.position.y=-1.18;this.scene.add(grid);
  const axes=new T.AxesHelper(.55);axes.position.set(-2,-1.17,1.65);this.scene.add(axes);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
 }
 private resize(){const r=this.host.getBoundingClientRect();this.renderer.setSize(r.width,r.height);this.camera.aspect=r.width/Math.max(1,r.height);this.camera.updateProjectionMatrix();}
 update(state:SceneState):Section{
  const right=new T.Vector3(1,0,0).applyQuaternion(this.cameraOrientation),up=new T.Vector3(0,1,0).applyQuaternion(this.cameraOrientation);
  this.camera.position.copy(this.cameraHome).addScaledVector(right,-state.view.x).addScaledVector(up,-state.view.y);this.camera.quaternion.copy(this.cameraOrientation);this.camera.zoom=state.view.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);
  if(this.solidId!==state.solid){this.solidId=state.solid;this.solid.geometry=shapes[state.solid];this.ghost.geometry=shapes[state.solid];this.outline.geometry.dispose();this.outline.geometry=new T.EdgesGeometry(shapes[state.solid],12);}
  for(const o of [this.solid,this.ghost,this.outline])o.quaternion.fromArray(state.object);
  const normal=planeNormal(state);this.clip.normal.copy(normal).negate();this.clip.constant=state.depth;
  this.plane.quaternion.fromArray(state.plane);this.plane.position.copy(normal).multiplyScalar(state.depth);
  const local=objectPlane(normal,state.depth,state.object);const cut=section(state.solid,local.normal,local.depth);
  const objectQ=new T.Quaternion().fromArray(state.object);const points=cut.points.map(p=>p.clone().applyQuaternion(objectQ));
  const vertices:number[]=[];if(!cut.degenerate)for(let i=1;i<points.length-1;i++)vertices.push(...points[0].toArray(),...points[i].toArray(),...points[i+1].toArray());
  this.cap.geometry.dispose();this.cap.geometry=new T.BufferGeometry();this.cap.geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  this.boundary.geometry.dispose();this.boundary.geometry=new T.BufferGeometry().setFromPoints(points);this.boundary.visible=points.length>1;
  return cut;
 }
 target(state:SceneState|null,objectOnly=false){this.targetPlane.visible=!!state&&!objectOnly;this.targetObject.visible=!!state&&objectOnly;if(state){this.targetPlane.quaternion.fromArray(state.plane);this.targetPlane.position.copy(planeNormal(state)).multiplyScalar(state.depth);this.targetObject.quaternion.fromArray(state.object);}}
 render(){this.renderer.render(this.scene,this.camera);}
 drag(from:{x:number;y:number},to:{x:number;y:number},base:Quat){return trackballRotation(from,to,base,this.camera.quaternion,this.camera.aspect);}
 pan(from:{x:number;y:number},to:{x:number;y:number},base:ViewState):ViewState{
  const height=2*Math.tan(this.camera.fov*Math.PI/360)*this.cameraHome.length()/base.zoom;
  return {...base,x:Math.max(-3,Math.min(3,base.x+(to.x-from.x)*height*this.camera.aspect)),y:Math.max(-3,Math.min(3,base.y-(to.y-from.y)*height))};
 }
 bounds(){
  const points: T.Vector3[]=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])points.push(new T.Vector3(x,y,z).applyQuaternion(this.solid.quaternion).project(this.camera));
  return {minX:Math.max(0,Math.min(...points.map(p=>(p.x+1)/2))-.06),maxX:Math.min(1,Math.max(...points.map(p=>(p.x+1)/2))+.06),minY:Math.max(0,Math.min(...points.map(p=>(1-p.y)/2))-.06),maxY:Math.min(1,Math.max(...points.map(p=>(1-p.y)/2))+.06)};
 }
 dispose(){this.observer.disconnect();this.renderer.dispose();}
}
export function sectionSvg(cut:Section,size=320){
 const values=cut.flat;const extent=Math.max(2.3,...values.flatMap(p=>[Math.abs(p.x)*2.4,Math.abs(p.y)*2.4]));const scale=(size-48)/extent;
 const point=(p:{x:number;y:number})=>`${(size/2+p.x*scale).toFixed(2)},${(size/2-p.y*scale).toFixed(2)}`;
 const polygon=values.length>2?`<polygon points="${values.map(point).join(' ')}" fill="url(#section-fill)" stroke="#ffc861" stroke-width="2"/>`:values.length===2?`<polyline points="${values.map(point).join(' ')}" stroke="#ffc861" stroke-width="3"/>`:values.length===1?`<circle cx="${size/2+values[0].x*scale}" cy="${size/2-values[0].y*scale}" r="4" fill="#ffc861"/>`:'';
 return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${cut.label} in the cutting plane"><defs><pattern id="section-grid" width="${scale/4}" height="${scale/4}" patternUnits="userSpaceOnUse"><path d="M ${scale/4} 0 H 0 V ${scale/4}" fill="none" stroke="#26333f" stroke-width=".6"/></pattern><linearGradient id="section-fill" x2="1" y2="1"><stop stop-color="#ffe2a8"/><stop offset="1" stop-color="#f0a93e"/></linearGradient></defs><rect width="${size}" height="${size}" fill="url(#section-grid)"/><path d="M 16 ${size/2} H ${size-16} M ${size/2} 16 V ${size-16}" stroke="#5a6d7a" stroke-width="1"/>${polygon}<text x="${size-23}" y="${size/2-8}" fill="#aab7bb" font-size="10">u</text><text x="${size/2+8}" y="25" fill="#aab7bb" font-size="10">v</text>${!values.length?`<text x="${size/2}" y="${size/2+25}" text-anchor="middle" fill="#aab7bb" font-size="12">Move the plane toward the solid</text>`:''}</svg>`;
}
