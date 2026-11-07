import * as T from 'three';
import {mirrorToStage} from '../mirror/projection';
import {PartsOverlay} from '../mirror/parts-overlay';
import type {MirrorPoint,MirrorViewState,WorldPoint} from '../mirror/contracts';
import {DEFAULT_ELEMENT,elements,nucleons,plural,shellOfElectron,shellsOf,SHELL_RADIUS,tearLayout,type Nucleon,type Tear} from './model';
import type {AtomScene,AtomWorld} from './contracts';

const CAPACITY=320,TRAIL=7,NUCLEON=.34,ELECTRON=.34,PICK_NUCLEON=.24,PICK_ELECTRON=.3;
const NEUTRON=new T.Color('#8fb0d8'),PROTON=new T.Color('#ff7a45'),ELECTRON_COLOR=new T.Color('#4fe8ff'),TAKEN_COLOR=new T.Color('#c8fbff'),RING=new T.Color('#5fdcff'),FLASH=new T.Color('#9feaff');
/** Each shell's orbit plane, as turns about x then z, before a tear lays the rings flat to the viewer. */
const TILTS:[number,number][]=[[1.05,.35],[-.8,-.6],[.5,1.0]];
const RING_SEGMENTS=160;
const smooth=(t:number)=>t*t*(3-2*t);

const vert=/* glsl */`
attribute vec3 aCenter,aColor,aInfo;varying vec2 vUv;varying vec3 vColor,vInfo;
void main(){
 vec3 c=(modelMatrix*vec4(aCenter,1.)).xyz;
 vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
 vUv=position.xy;vColor=aColor;vInfo=aInfo;
 gl_Position=projectionMatrix*viewMatrix*vec4(c+(right*position.x+up*position.y)*aInfo.y,1.);
}`;
// kind 0 neutron, 1 proton, 2 electron, 3 soft dot (trail, glow), 4 flash
const frag=/* glsl */`
varying vec2 vUv;varying vec3 vColor,vInfo;
void main(){
 float r2=dot(vUv,vUv);if(r2>1.)discard;
 float kind=vInfo.x,alpha=vInfo.z;vec3 c;float a;
 if(kind<1.5){
  vec2 q=vUv/.55;float rr=dot(q,q);
  vec3 n=vec3(q,sqrt(max(0.,1.-rr)));
  float body=1.-smoothstep(.82,1.,rr),diff=.5+.5*dot(n,normalize(vec3(-.4,.6,.7))),rim=pow(1.-n.z,2.2);
  float spec=pow(max(0.,dot(n,normalize(vec3(-.3,.5,.8)))),18.);
  float halo=exp(-r2*5.5);
  c=vColor*(.14+diff*diff*.8)*body+vColor*rim*.55*body+vec3(1.)*spec*.3*body+vColor*halo*.22;
  if(kind>.5){
   vec2 p=abs(q);
   float bar=(1.-smoothstep(.07,.12,p.x))*(1.-smoothstep(.34,.42,p.y)),cross2=(1.-smoothstep(.07,.12,p.y))*(1.-smoothstep(.34,.42,p.x));
   c+=vec3(1.,.93,.78)*max(bar,cross2)*body*.9+vec3(1.,.6,.3)*halo*.2;
  }
  a=(body+halo*.5)*alpha;
 }else if(kind<2.5){
  float core=exp(-r2*26.),halo=exp(-r2*4.5);
  c=vColor*(halo*.8+core*.9)+vec3(1.)*core*core*1.1;a=(halo*.7+core)*alpha;
 }else if(kind<3.5){
  float g=exp(-r2*6.);c=vColor*g*.9;a=g*alpha;
 }else{
  float g=exp(-r2*3.)*(1.-r2);c=vColor*g;a=g*alpha;
 }
 gl_FragColor=vec4(c*alpha,min(1.,a)*.4);
}`;
const blend:Partial<T.ShaderMaterialParameters>={
 transparent:true,depthWrite:false,depthTest:false,side:T.DoubleSide,
 blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneMinusSrcAlphaFactor,
};
const v=new T.Vector3(),w=new T.Vector3(),a=new T.Vector3(),b=new T.Vector3(),o=new T.Vector3(),c1=new T.Color(),face=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/2),q1=new T.Quaternion(),e1=new T.Euler(),spinQ=new T.Quaternion(),nucleusQ=new T.Quaternion(),identity=new T.Quaternion(),inverse=new T.Matrix4(),axis=new T.Vector3(.4,1,.25).normalize();

/** The Bohr atom as glowing particles: a packed nucleus, electrons on tilted orbits, and whatever the hands have pulled out. */
export class AtomView implements AtomWorld {
 readonly ready=Promise.resolve();
 readonly scene=new T.Scene();
 readonly camera=new T.PerspectiveCamera(37,1,.1,100);
 readonly renderer:T.WebGLRenderer;
 partCount:number;
 private readonly root=new T.Group();
 /** The slow turn the atom keeps by itself, laid over the viewer's own pose. */
 private readonly atom=new T.Group();
 private readonly rings:{group:T.Group;line:T.LineLoop<T.BufferGeometry,T.LineBasicMaterial>}[]=[];
 private readonly centers=new Float32Array(CAPACITY*3);private readonly colors=new Float32Array(CAPACITY*3);private readonly infos=new Float32Array(CAPACITY*3);
 private readonly particles:T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
 private readonly overlay:PartsOverlay;
 private readonly tags=document.createElement('div');private readonly tagEls:HTMLElement[]=[];
 private readonly note=document.createElement('p');
 private readonly mark:HTMLElement|null;private readonly count:HTMLElement|null;
 private readonly resizeObserver:ResizeObserver;
 private pick=new Float32Array(0);private nucleons:Nucleon[]=[];private shown=-1;private shownCharge=NaN;private n=0;
 private videoAspect=0;private zoom=1;private width=1;private height=1;private disposed=false;private contextLost=false;

 constructor(readonly host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
  this.renderer.setClearColor(0,0);
  this.renderer.domElement.className='atom-canvas mirror-canvas';
  this.renderer.domElement.setAttribute('aria-hidden','true');
  host.prepend(this.renderer.domElement);
  this.camera.position.set(0,0,13);
  this.scene.add(this.root);this.root.add(this.atom);
  const quad=new T.PlaneGeometry(2,2),g=new T.InstancedBufferGeometry();
  g.setIndex(quad.index);g.setAttribute('position',quad.attributes.position);
  for(const [name,data] of [['aCenter',this.centers],['aColor',this.colors],['aInfo',this.infos]] as const)g.setAttribute(name,new T.InstancedBufferAttribute(data,3).setUsage(T.DynamicDrawUsage));
  g.instanceCount=0;
  this.particles=new T.Mesh(g,new T.ShaderMaterial({vertexShader:vert,fragmentShader:frag,...blend}));
  this.particles.frustumCulled=false;this.particles.renderOrder=4;this.atom.add(this.particles);
  const circle=Float32Array.from({length:RING_SEGMENTS*3},(_,i)=>{const k=Math.floor(i/3)/RING_SEGMENTS*Math.PI*2,c=i%3;return c===0?Math.cos(k):c===2?Math.sin(k):0;});
  for(let i=0;i<TILTS.length;i++){
   const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(circle,3));
   const line=new T.LineLoop(geometry,new T.LineBasicMaterial({color:RING,transparent:true,opacity:.25,depthWrite:false,depthTest:false,blending:T.AdditiveBlending}));
   const group=new T.Group();group.add(line);group.visible=false;line.renderOrder=2;this.atom.add(group);this.rings.push({group,line});
  }
  this.overlay=new PartsOverlay(this.scene,host);
  this.tags.className='atom-tags';this.tags.setAttribute('aria-hidden','true');host.append(this.tags);
  const stage=host.parentElement;
  this.mark=stage?.querySelector<HTMLElement>('.mirror-mark')??null;this.count=stage?.querySelector<HTMLElement>('.mirror-count')??null;
  this.note.className='atom-caption';this.note.setAttribute('aria-live','polite');stage?.append(this.note);
  this.use(DEFAULT_ELEMENT);this.partCount=this.n;
  this.renderer.domElement.addEventListener('webglcontextlost',this.onContextLost);
  this.renderer.domElement.addEventListener('webglcontextrestored',this.onContextRestored);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
 }
 private readonly onContextLost=(event:Event)=>{event.preventDefault();this.contextLost=true;this.host.dispatchEvent(new CustomEvent('mirror-render-error',{bubbles:true,detail:'The 3D view paused. Reload if it does not recover.'}));};
 private readonly onContextRestored=()=>{this.contextLost=false;this.renderer.render(this.scene,this.camera);};

 private resize(){
  if(this.disposed)return;
  this.width=Math.max(1,this.host.clientWidth);this.height=Math.max(1,this.host.clientHeight);
  this.renderer.setSize(this.width,this.height,false);
  this.camera.aspect=this.width/this.height;this.camera.position.z=this.width<700?14:11.5;this.applyCamera();
  if(!this.contextLost)this.renderer.render(this.scene,this.camera);
 }
 private applyCamera(){this.camera.zoom=this.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();}
 setPose(view:MirrorViewState){
  if(this.disposed)return;
  this.root.quaternion.fromArray(view.q).normalize();this.root.position.set(view.x,view.y,0);this.root.updateMatrixWorld(true);
  this.zoom=Math.min(3,Math.max(.4,view.zoom));if(this.camera.zoom!==this.zoom)this.applyCamera();
 }
 setVideoAspect(aspect:number){this.videoAspect=aspect;}
 mirrorToWorld(point:MirrorPoint):WorldPoint{
  const stage=mirrorToStage(point.x,point.y,this.videoAspect,this.width/this.height);
  return this.unproject(stage.x*2-1,1-stage.y*2,Math.max(-1,Math.min(1,-point.z*1.4)));
 }
 pointToWorld(clientX:number,clientY:number):WorldPoint{
  const rect=this.renderer.domElement.getBoundingClientRect();
  return this.unproject((clientX-rect.left)/(rect.width||1)*2-1,1-(clientY-rect.top)/(rect.height||1)*2,0);
 }
 private unproject(x:number,y:number,z:number):WorldPoint{
  const c=this.camera.position;v.set(x,y,.5).unproject(this.camera).sub(c);
  const t=(z-c.z)/v.z;return {x:c.x+v.x*t,y:c.y+v.y*t,z};
 }
 /** Where a world point lands on the stage, in CSS pixels from its top left. Read by tests. */
 screenOf(p:WorldPoint){v.set(p.x,p.y,p.z).project(this.camera);return {x:(v.x+1)*this.width/2,y:(1-v.y)*this.height/2};}
 /** The first particle along the ray through a point, nearest the viewer. */
 partAt(point:WorldPoint){
  const c=this.camera.position;v.set(point.x-c.x,point.y-c.y,point.z-c.z);
  const reach=v.length();if(!reach)return -1;
  const dx=v.x/reach,dy=v.y/reach,dz=v.z/reach,p=this.pick;let best=-1,bestScore=Infinity;
  for(let i=0;i<this.n&&i*3+2<p.length;i++){
   const px=p[i*3]-c.x,py=p[i*3+1]-c.y,pz=p[i*3+2]-c.z,along=px*dx+py*dy+pz*dz;
   if(along<=0)continue;
   const off=Math.sqrt(Math.max(0,px*px+py*py+pz*pz-along*along))*reach/along;
   if(off>(i<this.nucleons.length?PICK_NUCLEON:PICK_ELECTRON))continue;
   const score=off+along*.06;if(score<bestScore){bestScore=score;best=i;}
  }
  return best;
 }
 private use(index:number){
  const e=elements[index];this.shown=index;this.nucleons=nucleons(e.z,e.neutrons);this.n=this.nucleons.length+e.z;this.pick=new Float32Array(this.n*3);this.partCount=this.n;
  if(this.mark)this.mark.innerHTML=`${e.name} <span>atom</span>`;
 }
 private add(i:number,x:number,y:number,z:number,color:T.Color,kind:number,size:number,alpha:number){
  if(i>=CAPACITY)return i;
  const k=i*3;this.centers[k]=x;this.centers[k+1]=y;this.centers[k+2]=z;this.colors[k]=color.r;this.colors[k+1]=color.g;this.colors[k+2]=color.b;this.infos[k]=kind;this.infos[k+1]=size;this.infos[k+2]=alpha;
  return i+1;
 }

 draw(scene:AtomScene,_:number){
  if(this.disposed||this.contextLost)return;
  if(scene.element!==this.shown)this.use(scene.element);
  const el=elements[scene.element],tear=tearLayout(scene.explode),fade=smooth(scene.fade),shells=shellsOf(el.z),count=shells.length,flat=tear.flat;
  // The atom's own turn eases out as it is torn apart, so the pieces and their labels hold still.
  spinQ.setFromEuler(e1.set(Math.sin(scene.spin*.37)*.3,scene.spin,0,'YXZ')).slerp(identity,flat);
  this.atom.quaternion.copy(spinQ);this.root.updateMatrixWorld(true);
  nucleusQ.setFromAxisAngle(axis,scene.tumble);
  inverse.copy(this.atom.matrixWorld).invert();this.atom.getWorldQuaternion(q1).invert();
  const offsets=scene.partOffsets,total=this.nucleons.length,pick=this.pick,scale=.4+.6*fade,world=this.atom.matrixWorld;
  const place=(index:number,p:T.Vector3)=>{
   if(index*3+2<offsets.length){o.set(offsets[index*3],offsets[index*3+1],offsets[index*3+2]).applyQuaternion(q1);p.add(o);}
   w.copy(p).applyMatrix4(world);pick[index*3]=w.x;pick[index*3+1]=w.y;pick[index*3+2]=w.z;
  };
  let i=0;
  for(let k=0;k<total;k++){
   const nu=this.nucleons[k],proton=nu.kind==='proton',c=proton?tear.protons:tear.neutrons;
   a.set(...nu.packed).applyQuaternion(nucleusQ).multiplyScalar(1+.55*tear.loosen);
   b.set(...nu.grouped).applyQuaternion(nucleusQ).multiplyScalar(1+.2*tear.group);b.x+=c[0];b.y+=c[1];b.z+=c[2];
   a.lerp(b,tear.group).multiplyScalar(scale);place(k,a);
   i=this.add(i,a.x,a.y,a.z,proton?PROTON:NEUTRON,proton?1:0,NUCLEON*(.55+.45*fade),1);
  }
  const radius=(s:number)=>SHELL_RADIUS[s]*tear.ringScale*(.45+.55*fade),centre=(s:number)=>(s-(count-1)/2)*tear.gap;
  for(let s=0;s<this.rings.length;s++){
   const ring=this.rings[s];ring.group.visible=s<count;
   if(s>=count)continue;
   ring.group.position.set(centre(s),tear.ringY,0);ring.group.scale.setScalar(radius(s));
   ring.group.quaternion.setFromEuler(e1.set(TILTS[s][0],0,TILTS[s][1])).slerp(face,flat);
   ring.line.material.opacity=.26*fade;
  }
  const sign=scene.rate<0?-1:1,tail=Math.min(1,Math.abs(scene.rate)*1.5),step=.07*Math.min(1.6,Math.abs(scene.rate)+.3);
  for(let e=0;e<el.z;e++){
   const {shell}=shellOfElectron(shells,e),ring=this.rings[shell].group,r=radius(shell),angle=scene.angles[e]??0;
   const at=(theta:number,p:T.Vector3)=>p.set(Math.cos(theta)*r,0,Math.sin(theta)*r).applyQuaternion(ring.quaternion).add(ring.position);
   const t=scene.taken.find(x=>x.electron===e),away=t?smooth(t.amount):0;
   if(away<.5)for(let k=TRAIL;k>=1;k--){at(angle-sign*k*step,a);i=this.add(i,a.x,a.y,a.z,ELECTRON_COLOR,3,.14,tail*(1-k/(TRAIL+1))**2*.7*(1-away*2));}
   at(angle,a);
   if(t){b.set(t.x,t.y,t.z).applyMatrix4(inverse);a.lerp(b,away);}
   place(total+e,a);
   if(t)i=this.add(i,a.x,a.y,a.z,ELECTRON_COLOR,3,.9,.4*away);
   i=this.add(i,a.x,a.y,a.z,t?c1.copy(ELECTRON_COLOR).lerp(TAKEN_COLOR,away):ELECTRON_COLOR,2,ELECTRON*(1+.7*away)*(.5+.5*fade),1);
  }
  if(scene.fade<1)i=this.add(i,0,0,0,FLASH,4,1.2+3*(1-fade),(1-fade)*.8);
  const g=this.particles.geometry;g.instanceCount=i;
  for(const name of ['aCenter','aColor','aInfo'])g.getAttribute(name).needsUpdate=true;
  this.tag(scene,el.z,el.neutrons,shells,tear,radius,centre);
  this.say(scene,tear);
  this.overlay.update({hands:scene.hands,label:scene.label,shocks:scene.shocks},this.camera,this.width,this.height);
  this.renderer.render(this.scene,this.camera);
 }
 /** Floating counts, shown once the atom is pulled apart. */
 private tag(scene:AtomScene,protons:number,neutrons:number,shells:number[],tear:Tear,radius:(s:number)=>number,centre:(s:number)=>number){
  const list:{kind:string;text:string;x:number;y:number}[]=[{kind:'proton',text:plural(protons,'proton'),x:tear.protons[0],y:tear.protons[1]-1.05}];
  if(neutrons)list.push({kind:'neutron',text:plural(neutrons,'neutron'),x:tear.neutrons[0],y:tear.neutrons[1]-1.05});
  list.push({kind:'electron',text:plural(protons-scene.taken.filter(t=>t.amount>.5).length,'electron'),x:0,y:tear.ringY+radius(shells.length-1)+.55});
  shells.forEach((n,s)=>list.push({kind:'electron',text:`shell ${s+1}: ${n}`,x:centre(s),y:tear.ringY-radius(s)-.35}));
  while(this.tagEls.length<list.length){const e=document.createElement('span');e.className='atom-tag';this.tags.append(e);this.tagEls.push(e);}
  this.tagEls.forEach((e,k)=>{
   const item=list[k],on=!!item&&tear.labels>.02;
   if(!on){e.style.opacity='0';return;}
   if(e.textContent!==item.text)e.textContent=item.text;
   e.dataset.kind=item.kind;
   v.set(item.x,item.y,0).applyMatrix4(this.atom.matrixWorld).project(this.camera);
   e.style.transform=`translate(${Math.round((v.x+1)*this.width/2)}px,${Math.round((1-v.y)*this.height/2)}px) translate(-50%,-50%)`;
   e.style.opacity=tear.labels.toFixed(2);
  });
 }
 /** The electron count and the status line follow the atom. */
 private say(scene:AtomScene,tear:Tear){
  const charge=scene.taken.filter(t=>t.amount>.5).length;
  if(this.count?.lastChild&&charge!==this.shownCharge){this.shownCharge=charge;this.count.lastChild.textContent=charge?` electrons, charge +${charge}`:' electrons';}
  if(this.note.textContent!==scene.caption)this.note.textContent=scene.caption;
  this.note.style.opacity=String(1-tear.labels);
 }
 /** Read by tests: the counts floating beside the pieces, once they are clear. */
 get labels(){return this.tagEls.filter(e=>+e.style.opacity>.5).map(e=>e.textContent);}
 /** Read by tests: the world-space position of a particle; nucleons come first, then electrons. */
 particle(part:number):WorldPoint{return {x:this.pick[part*3],y:this.pick[part*3+1],z:this.pick[part*3+2]};}
 dispose(){
  if(this.disposed)return;
  this.disposed=true;this.resizeObserver.disconnect();
  this.renderer.domElement.removeEventListener('webglcontextlost',this.onContextLost);this.renderer.domElement.removeEventListener('webglcontextrestored',this.onContextRestored);
  this.scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineLoop){o.geometry.dispose();(o.material as T.Material).dispose();}});
  this.overlay.dispose();this.tags.remove();this.note.remove();this.renderer.dispose();this.renderer.domElement.remove();this.scene.clear();
 }
}
