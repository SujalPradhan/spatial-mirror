import * as T from 'three';
import type {ArtState,Stroke} from './model';
/** Dark ink is lifted on the dark stage only: saved strokes and 3D exports keep the chosen colour. */
export function onStage(color:string){const c=new T.Color(color),hsl={h:0,s:0,l:0};c.getHSL(hsl);return hsl.l<.62?c.setHSL(hsl.h,hsl.s,.62):c;}
export function strokeGeometry(s:Stroke):T.BufferGeometry|null{
 if(s.points.length<2)return null;
 const points=s.points.map(p=>new T.Vector3(...p));
 if(s.frame.kind==='stable'){const curve=new T.CurvePath<T.Vector3>();for(let i=1;i<points.length;i++)if(points[i].distanceToSquared(points[i-1])>1e-12)curve.add(new T.LineCurve3(points[i-1],points[i]));return curve.curves.length?new T.TubeGeometry(curve,Math.max(1,points.length-1),s.frame.width/2,6,false):null;}
 const pos:number[]=[],index:number[]=[];let previous=new T.Vector3(1,0,0);
 for(let i=0;i<points.length;i++){const tangent=points[Math.min(i+1,points.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize();let side=new T.Vector3(...s.sides[i]);side.addScaledVector(tangent,-side.dot(tangent));if(side.lengthSq()<1e-8)side.copy(previous);side.normalize();if(i&&side.dot(previous)<0)side.negate();previous.copy(side);side.multiplyScalar(s.frame.width/2);pos.push(...points[i].clone().add(side).toArray(),...points[i].clone().sub(side).toArray());if(i){const n=i*2;index.push(n-2,n-1,n,n-1,n+1,n);}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(index);g.computeVertexNormals();return g;
}
export class ArtView {
 readonly scene=new T.Scene();readonly artwork=new T.Group();readonly camera=new T.PerspectiveCamera(40,1,.01,200);readonly renderer:T.WebGLRenderer;
 private plane=new T.Group();private meshes=new Map<string,{mesh:T.Mesh;length:number;finished:boolean;points:Stroke['points'];frame:string}>();private observer:ResizeObserver;
 async withTrueInk<R>(run:()=>Promise<R>){const inks=[...this.meshes.values()].map(i=>{const c=i.mesh.material as T.MeshStandardMaterial,shown=c.color.clone();c.color.set(JSON.parse(i.frame).color);return ()=>c.color.copy(shown);});try{return await run();}finally{inks.forEach(back=>back());}}
 constructor(readonly host:HTMLElement){this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.prepend(this.renderer.domElement);this.scene.add(this.artwork,new T.HemisphereLight(0xffffff,0x60765a,3));const light=new T.DirectionalLight(0xffffff,3);light.position.set(3,5,5);this.scene.add(light);const grid=new T.GridHelper(12,24,0x7d93a3,0x54697a);grid.position.y=-2;this.scene.add(grid,this.plane);
 const sheet=new T.Mesh(new T.PlaneGeometry(3.2,3.2),new T.MeshBasicMaterial({color:0x94b6a3,transparent:true,opacity:.14,side:T.DoubleSide,depthWrite:false}));this.plane.add(sheet);const edge=new T.LineSegments(new T.EdgesGeometry(sheet.geometry),new T.LineBasicMaterial({color:0x9db5a1}));this.plane.add(edge);const top=new T.Mesh(new T.BoxGeometry(3.2,.035,.015),new T.MeshBasicMaterial({color:0xc69a57}));top.position.y=1.6;this.plane.add(top);
 this.observer=new ResizeObserver(()=>{const r=host.getBoundingClientRect();this.renderer.setSize(r.width,r.height);this.camera.aspect=r.width/Math.max(1,r.height);this.camera.updateProjectionMatrix();});this.observer.observe(host);}
 update(a:ArtState,aspect:number){const v=a.view,yaw=v.yaw,r=7/Math.max(.5,v.zoom);this.camera.position.set(v.x+r*Math.cos(v.pitch)*Math.sin(yaw),v.y+r*Math.sin(v.pitch),r*Math.cos(v.pitch)*Math.cos(yaw));this.camera.lookAt(v.x,v.y,0);this.plane.position.set(...a.origin);this.plane.quaternion.fromArray(a.q);this.plane.scale.y=1/aspect;
 const ids=new Set(a.strokes.map(s=>s.id));for(const [id,item] of this.meshes)if(!ids.has(id)){this.artwork.remove(item.mesh);item.mesh.geometry.dispose();(item.mesh.material as T.Material).dispose();this.meshes.delete(id);}
 for(const s of a.strokes){const old=this.meshes.get(s.id);if(old&&old.length===s.points.length&&old.finished===s.finished&&old.points===s.points&&old.frame===JSON.stringify(s.frame))continue;const g=strokeGeometry(s);if(!g)continue;if(old){old.mesh.geometry.dispose();old.mesh.geometry=g;old.length=s.points.length;old.finished=s.finished;old.points=s.points;old.frame=JSON.stringify(s.frame);(old.mesh.material as T.MeshStandardMaterial).color.copy(onStage(s.frame.color));}else{const mesh=new T.Mesh(g,new T.MeshStandardMaterial({color:onStage(s.frame.color),roughness:.65,side:T.DoubleSide}));this.artwork.add(mesh);this.meshes.set(s.id,{mesh,length:s.points.length,finished:s.finished,points:s.points,frame:JSON.stringify(s.frame)});}}
 }
 render(){this.renderer.render(this.scene,this.camera);}
 png(){this.plane.visible=false;this.render();const data=this.renderer.domElement.toDataURL('image/png');this.plane.visible=true;return data;}
 dispose(){this.observer.disconnect();this.scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineSegments){o.geometry.dispose();const m=Array.isArray(o.material)?o.material:[o.material];m.forEach(m=>m.dispose());}});this.renderer.dispose();}
}
