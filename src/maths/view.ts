import * as T from 'three';
import {annotationPoint,basis,centre,dataset,pca,project,type LessonState} from './model';
import type {Vec3} from '../types';

const colours={original:0x5fd6ab,projected:0xffc861,selected:0xff6fa3,plane:0x9fd0c4,pca:0xa8adff,ink:0x7fb2ff};
// The stage gradient lives in the scene, so the canvas stays opaque for PNG export and demo recording.
function stageBackground(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d')!,g=c.createRadialGradient(256,215,0,256,256,362);
  g.addColorStop(0,'#142231');g.addColorStop(.48,'#0a1119');g.addColorStop(1,'#05080c');c.fillStyle=g;c.fillRect(0,0,512,512);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;return texture;
}
export class MathsView {
  readonly renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  readonly scene=new T.Scene();readonly camera=new T.PerspectiveCamera(42,1,.1,100);
  private content=new T.Group();private signature='';private pickables:T.Object3D[]=[];
  private resize:ResizeObserver;private state:LessonState|null=null;private demo=false;
  private labels=[document.createElement('span'),document.createElement('span')];
  constructor(readonly host:HTMLElement,readonly flat:HTMLCanvasElement){
    this.scene.background=stageBackground();this.scene.add(this.content);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.prepend(this.renderer.domElement);
    this.labels.forEach((label,i)=>{label.className='demo-point-label '+(i?'projected':'original');label.hidden=true;host.append(label);});
    this.resize=new ResizeObserver(()=>{const r=host.getBoundingClientRect();this.renderer.setSize(r.width,r.height);this.camera.aspect=r.width/Math.max(1,r.height);this.camera.updateProjectionMatrix();this.drawFlat();});
    this.resize.observe(host);this.resize.observe(flat);
  }
  private line(points:Vec3[],colour:number,opacity=1){
    const g=new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(...p)));
    const o=new T.Line(g,new T.LineBasicMaterial({color:colour,transparent:opacity<1,opacity}));this.content.add(o);return o;
  }
  private dot(p:Vec3,colour:number,index:number,r=.085){
    const o=new T.Mesh(new T.SphereGeometry(r,12,8),new T.MeshBasicMaterial({color:colour}));o.position.set(...p);o.userData.index=index;this.content.add(o);this.pickables.push(o);
  }
  private segment(from:Vec3,to:Vec3,colour:number,radius:number){
    const delta=new T.Vector3(...to).sub(new T.Vector3(...from));if(delta.length()<1e-6)return;
    const mesh=new T.Mesh(new T.CylinderGeometry(radius,radius,delta.length(),8),new T.MeshBasicMaterial({color:colour}));mesh.position.copy(new T.Vector3(...from).addScaledVector(delta,.5));mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());this.content.add(mesh);
  }
  private plane(origin:Vec3,q:number[],colour:number,opacity:number){
    const g=new T.PlaneGeometry(9,9),sheet=new T.Mesh(g,new T.MeshBasicMaterial({color:colour,transparent:true,opacity,side:T.DoubleSide,depthWrite:false}));
    sheet.position.set(...origin);sheet.quaternion.fromArray(q);this.content.add(sheet);
    const edge=new T.LineSegments(new T.EdgesGeometry(g),new T.LineBasicMaterial({color:colour}));edge.position.copy(sheet.position);edge.quaternion.copy(sheet.quaternion);this.content.add(edge);
  }
  private clear(){this.content.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});this.content.clear();this.pickables=[];}
  update(s:LessonState,demo=false){
    this.state=s;this.demo=demo;const v=s.view,r=15/v.zoom;
    this.camera.position.set(v.x+r*Math.cos(v.pitch)*Math.sin(v.yaw),v.y+r*Math.sin(v.pitch),r*Math.cos(v.pitch)*Math.cos(v.yaw));this.camera.lookAt(v.x,v.y,0);
    const signature=JSON.stringify([s.stage,s.q,s.selected,s.reveal,s.residuals,s.annotations,demo]);
    if(signature!==this.signature){this.signature=signature;this.clear();const origin=centre(s.stage),points=dataset(s.stage),{u,v}=basis(s.q);
      this.plane(origin,s.q,colours.plane,.16);
      this.line([new T.Vector3(...origin).addScaledVector(u,-4.5).toArray() as Vec3,new T.Vector3(...origin).addScaledVector(u,4.5).toArray() as Vec3],0xa8bbae,.5);
      this.line([new T.Vector3(...origin).addScaledVector(v,-4.5).toArray() as Vec3,new T.Vector3(...origin).addScaledVector(v,4.5).toArray() as Vec3],0xa8bbae,.5);
      if(s.reveal&&s.stage!=='point')this.plane(origin,pca(points).q,colours.pca,.09);
      points.forEach((p,i)=>{const projected=project(p,origin,s.q).reconstructed,selected=s.selected===i;
        if(s.residuals||selected)this.line([p,projected],selected?colours.selected:0xc5a67b,selected?1:.45);
        this.dot(p,selected&&!demo?colours.selected:colours.original,i,selected?.12:.085);
        this.dot(projected,selected&&!demo?colours.selected:colours.projected,i,.065);
        if(demo){
          const delta=new T.Vector3(...p).sub(new T.Vector3(...origin));this.content.add(new T.ArrowHelper(delta.clone().normalize(),new T.Vector3(...origin),delta.length(),colours.original,.28,.16));
          this.segment(origin,p,colours.original,.025);this.segment(projected,p,colours.selected,.018);
          const {n}=basis(s.q),distance=project(p,origin,s.q).distance;
          if(Math.abs(distance)>.1){const foot=new T.Vector3(...projected),up=n.multiplyScalar(Math.sign(distance)*.24),across=u.clone().multiplyScalar(.24);this.line([foot.clone().add(up).toArray() as Vec3,foot.clone().add(up).add(across).toArray() as Vec3,foot.clone().add(across).toArray() as Vec3],colours.selected);}
        }
      });
      for(const note of s.annotations)if(note.points.length>1)this.line(note.points.map(p=>annotationPoint(p,note.frame)),colours.ink);
      this.drawFlat();
    }
    this.renderer.render(this.scene,this.camera);
    this.labels.forEach((label,i)=>{
      label.hidden=!demo;if(!demo)return;const point=i?project(pointsForLabel(s),centre(s.stage),s.q).reconstructed:pointsForLabel(s);
      const screen=new T.Vector3(...point).project(this.camera);label.style.left=((screen.x+1)/2*this.host.clientWidth+(i?-10:10))+'px';label.style.top=((1-screen.y)/2*this.host.clientHeight+(i?22:-52))+'px';label.style.transform=i?'translateX(-100%)':'';
      label.textContent=i?'Projection on the plane':'x = (2, 1, 2)';
    });
  }
  drawFlat(){
    const s=this.state;if(!s)return;const r=this.flat.getBoundingClientRect();if(r.width<1)return;
    const dpr=Math.min(devicePixelRatio,2);this.flat.width=r.width*dpr;this.flat.height=r.height*dpr;
    const c=this.flat.getContext('2d')!;c.scale(dpr,dpr);const w=r.width,h=r.height,scale=Math.min(w,h)/11;
    c.fillStyle='#0b131b';c.fillRect(0,0,w,h);c.strokeStyle='rgba(255,255,255,.07)';c.lineWidth=1;
    for(let i=-5;i<=5;i++){c.beginPath();c.moveTo(w/2+i*scale,0);c.lineTo(w/2+i*scale,h);c.moveTo(0,h/2+i*scale);c.lineTo(w,h/2+i*scale);c.stroke();}
    c.strokeStyle='rgba(238,243,242,.38)';c.beginPath();c.moveTo(0,h/2);c.lineTo(w,h/2);c.moveTo(w/2,0);c.lineTo(w/2,h);c.stroke();
    c.font='12px "DM Sans", sans-serif';c.fillStyle='rgba(238,243,242,.66)';c.fillText('coordinate 1',w-88,h/2-9);c.fillText('coordinate 2',w/2+8,18);c.fillText('0',w/2+6,h/2+15);
    dataset(s.stage).forEach((p,i)=>{const {z}=project(p,centre(s.stage),s.q);c.beginPath();c.arc(w/2+z[0]*scale,h/2-z[1]*scale,i===s.selected?6:4,0,Math.PI*2);c.fillStyle=i===s.selected&&!this.demo?'#ff6fa3':'#ffc861';c.fill();});
    // Only show ink in this flat view when it belongs to the current plane/basis.
    for(const note of s.annotations){if(Math.abs(new T.Quaternion().fromArray(note.frame.q).dot(new T.Quaternion().fromArray(s.q)))<.99999)continue;
      c.beginPath();for(let i=0;i<note.points.length;i++){const p=note.points[i],x=w/2+p[0]*9*scale,y=h/2-p[1]*9/note.frame.aspect*scale;i?c.lineTo(x,y):c.moveTo(x,y);}c.strokeStyle='#7fb2ff';c.lineWidth=2;c.stroke();}
  }
  pick(clientX:number,clientY:number):number|null {
    const r=this.host.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((clientX-r.x)/r.width*2-1,1-(clientY-r.y)/r.height*2),this.camera);
    return ray.intersectObjects(this.pickables)[0]?.object.userData.index??null;
  }
  onPlane(clientX:number,clientY:number):[number,number]|null {
    if(!this.state)return null;const r=this.host.getBoundingClientRect(),ray=new T.Raycaster(),q=this.state.q,origin=centre(this.state.stage),{u,v,n}=basis(q);
    ray.setFromCamera(new T.Vector2((clientX-r.x)/r.width*2-1,1-(clientY-r.y)/r.height*2),this.camera);
    const hit=ray.ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(n,new T.Vector3(...origin)),new T.Vector3());if(!hit)return null;
    const delta=hit.sub(new T.Vector3(...origin)),uv:[number,number]=[delta.dot(u)/9,delta.dot(v)/9];return uv.every(n=>Math.abs(n)<=.5)?uv:null;
  }
  pickFlat(clientX:number,clientY:number):number|null {
    if(!this.state)return null;const r=this.flat.getBoundingClientRect(),scale=Math.min(r.width,r.height)/11;let best=16,result:number|null=null;
    dataset(this.state.stage).forEach((p,i)=>{const {z}=project(p,centre(this.state!.stage),this.state!.q),distance=Math.hypot(r.x+r.width/2+z[0]*scale-clientX,r.y+r.height/2-z[1]*scale-clientY);if(distance<best){best=distance;result=i;}});return result;
  }
  dispose(){this.resize.disconnect();this.clear();this.labels.forEach(l=>l.remove());this.renderer.dispose();}
}
function pointsForLabel(s:LessonState){return dataset(s.stage)[s.selected];}
