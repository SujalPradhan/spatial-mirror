import * as T from 'three';
import type {MirrorPoint,MirrorView,MirrorViewState,WorldPoint} from '../mirror/contracts';
import {mirrorToStage} from '../mirror/projection';
import {Studio} from '../perfume/studio';
import {CONC,intensity,toBlend} from './accord';
import type {OrganScene,OrganWorld,Px} from './contracts';
import {OrganHud} from './hud';
import {familyColor,ingredientById,organ,type Ingredient} from './ingredients';
import {SPAN,inZone,shelfPlace} from './layout';
import {mixColor,remaining} from './model';

/** Front objects sit this far from the camera; the dim organ is behind them. */
const DEPTH=10,CLOUD=900,DROPS=9,VIAL_H=.8;
const v=new T.Vector3(),w=new T.Vector3(),gold=new T.Color('#f3cf86');
function glowTexture(){
 const k=document.createElement('canvas');k.width=k.height=64;const g=k.getContext('2d')!,r=g.createRadialGradient(32,32,0,32,32,32);
 r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.25,'rgba(255,240,210,.55)');r.addColorStop(1,'rgba(255,220,160,0)');g.fillStyle=r;g.fillRect(0,0,64,64);
 const t=new T.CanvasTexture(k);t.colorSpace=T.SRGBColorSpace;return t;
}
const cloudVert=/* glsl */`attribute float aSize,aAlpha;attribute vec3 aColor;uniform float uPx;varying vec3 vC;varying float vA;
void main(){vC=aColor;vA=aAlpha;vec4 m=modelViewMatrix*vec4(position,1.);gl_PointSize=aAlpha>0.001?min(160.,uPx*aSize/-m.z):0.;gl_Position=projectionMatrix*m;}`;
const cloudFrag=/* glsl */`varying vec3 vC;varying float vA;
void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;float a=(exp(-r*3.)*.24+exp(-r*30.)*.16)*vA;gl_FragColor=vec4(mix(vC,vec3(1.,.97,.9),.12)*a,a*.45);}`;
class Points {
 readonly geometry=new T.BufferGeometry();readonly pos:Float32Array;readonly size:Float32Array;readonly alpha:Float32Array;readonly color:Float32Array;readonly object:T.Points<T.BufferGeometry,T.ShaderMaterial>;
 constructor(n:number){
  this.pos=new Float32Array(n*3);this.size=new Float32Array(n);this.alpha=new Float32Array(n);this.color=new Float32Array(n*3);
  const a=(name:string,arr:Float32Array,k:number)=>this.geometry.setAttribute(name,new T.BufferAttribute(arr,k).setUsage(T.DynamicDrawUsage));
  a('position',this.pos,3);a('aSize',this.size,1);a('aAlpha',this.alpha,1);a('aColor',this.color,3);
  this.object=new T.Points(this.geometry,new T.ShaderMaterial({vertexShader:cloudVert,fragmentShader:cloudFrag,uniforms:{uPx:{value:1}},transparent:true,depthWrite:false,blending:T.CustomBlending,blendSrc:T.OneFactor,blendDst:T.OneMinusSrcAlphaFactor}));
  this.object.frustumCulled=false;this.object.renderOrder=60;
 }
 flush(){for(const k of ['position','aSize','aAlpha','aColor'])(this.geometry.attributes[k] as T.BufferAttribute).needsUpdate=true;}
}
interface Vial {group:T.Group;inner:T.Group;liquid:T.Mesh<T.BufferGeometry,T.MeshPhysicalMaterial>;halo:T.Sprite;ing:Ingredient;glow:number;tilt:number;seen:boolean}
interface Shelf {group:T.Group;liquid:T.Mesh<T.BufferGeometry,T.MeshPhysicalMaterial>}
/** The dim organ behind, the vials you can take in front of it, your palm as a lit target, and the scent rising off it at the hour on the ribbon. */
export class OrganView implements MirrorView<OrganScene>,OrganWorld {
 readonly ready:Promise<void>;readonly partCount=0;
 readonly scene=new T.Scene();readonly camera=new T.PerspectiveCamera(34,1,.1,80);readonly renderer:T.WebGLRenderer;
 /** The organ, turned by a mouse drag; the front stays where your hands are. */
 readonly root=new T.Group();readonly front=new T.Group();
 private studio:Studio;readonly hud:OrganHud;readonly vials=new Map<string,Vial>();private shelf:Shelf[]=[];
 private palmMesh!:T.Group;private skin!:T.MeshPhysicalMaterial;private target!:T.Sprite;private drops:T.Mesh<T.SphereGeometry,T.MeshBasicMaterial>[][]=[];
 private cloud=new Points(CLOUD);private seeds=new Float32Array(CLOUD*4);private owner=new Int16Array(CLOUD).fill(-1);private ownerKey='';
 private width=1;private height=1;private videoAspect=0;private zoom=1;private lastNow=0;private disposed=false;
 private resizer:ResizeObserver;private still=matchMedia('(prefers-reduced-motion: reduce)');private glow=glowTexture();
 private bodyG!:T.LatheGeometry;private liqG!:T.CylinderGeometry;private capG!:T.CylinderGeometry;private bandG!:T.CylinderGeometry;private glass!:T.MeshPhysicalMaterial;private cap!:T.MeshPhysicalMaterial;private band!:T.MeshPhysicalMaterial;
 /** Last-drawn values the tests read. */
 stats={front:0,cloud:0,drops:0,palmGlow:0,tilts:{} as Record<string,number>};
 constructor(readonly host:HTMLElement){
  const r=this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  r.setPixelRatio(Math.min(devicePixelRatio||1,1.75));r.setClearColor(0,0);r.toneMapping=T.ACESFilmicToneMapping;r.toneMappingExposure=1.08;
  r.domElement.className='mirror-canvas organ-canvas';r.domElement.setAttribute('aria-hidden','true');host.prepend(r.domElement);
  this.scene.add(this.root,this.front);
  this.studio=new Studio(r,this.scene,[]);
  this.scene.traverse(o=>{if(o.renderOrder===-100)o.visible=false;});
  const key=new T.DirectionalLight('#ffe6c4',1.2);key.position.set(-3,7,6);const fill=new T.PointLight('#ffb870',14,14,1.6);fill.position.set(0,1.5,3.5);this.scene.add(key,fill,new T.HemisphereLight('#3b2a1c','#050404',.6));
  this.buildParts();this.buildOrgan();this.buildHand();
  this.front.add(this.cloud.object);for(let i=0;i<CLOUD*4;i++)this.seeds[i]=Math.random();
  this.hud=new OrganHud(host);
  this.resizer=new ResizeObserver(()=>this.resize());this.resizer.observe(host);this.resize();
  this.ready=Promise.resolve();
 }
 // ---- Building.
 private buildParts(){
  const profile=[[0,0],[.16,0],[.18,.03],[.18,.5],[.15,.58],[.07,.62],[.07,.7],[0,.7]].map(([x,y])=>new T.Vector2(x,y));
  this.bodyG=new T.LatheGeometry(profile,28);this.liqG=new T.CylinderGeometry(.155,.155,.44,24).translate(0,.25,0);this.capG=new T.CylinderGeometry(.085,.085,.13,24).translate(0,.74,0);this.bandG=new T.CylinderGeometry(.183,.183,.1,28,1,true).translate(0,.3,0);
  this.glass=new T.MeshPhysicalMaterial({color:'#ffffff',roughness:.04,transparent:true,opacity:.16,clearcoat:1,clearcoatRoughness:0,envMapIntensity:1.1,depthWrite:false,side:T.DoubleSide});
  this.cap=new T.MeshPhysicalMaterial({color:gold,metalness:1,roughness:.16,envMapIntensity:1.6});this.band=new T.MeshPhysicalMaterial({color:gold,metalness:1,roughness:.3,envMapIntensity:1.2,side:T.DoubleSide});
 }
 private vialMesh(ing:Ingredient,shelf=false){
  const inner=new T.Group(),liquid=new T.Mesh(this.liqG,new T.MeshPhysicalMaterial({color:ing.color,roughness:.1,transparent:true,opacity:shelf?.5:.88,emissive:ing.color,emissiveIntensity:shelf?.05:.3,envMapIntensity:1}));
  const body=new T.Mesh(this.bodyG,this.glass);body.renderOrder=20;inner.add(liquid,body,new T.Mesh(this.capG,this.cap),new T.Mesh(this.bandG,shelf?this.band:new T.MeshPhysicalMaterial({color:familyColor[ing.family],metalness:.6,roughness:.3,emissive:familyColor[ing.family],emissiveIntensity:.25,side:T.DoubleSide})));
  return {inner,liquid};
 }
 private vial(id:string){
  let vi=this.vials.get(id);if(vi)return vi;
  const ing=ingredientById.get(id)!,{inner,liquid}=this.vialMesh(ing),group=new T.Group();
  // The group's origin is the cap, where the fingers hold it, so a tilt pivots there.
  inner.position.y=-VIAL_H;group.add(inner);
  const halo=new T.Sprite(new T.SpriteMaterial({map:this.glow,color:ing.color,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}));halo.scale.setScalar(1.5);halo.position.y=-VIAL_H*.55;group.add(halo);
  this.front.add(group);vi={group,inner,liquid,halo,ing,glow:0,tilt:0,seen:false};this.vials.set(id,vi);return vi;
 }
 private buildOrgan(){
  const wood=new T.MeshPhysicalMaterial({color:'#2a160c',roughness:.45,clearcoat:.35,clearcoatRoughness:.35,envMapIntensity:.1,specularIntensity:.3});
  for(let tier=0;tier<4;tier++){
   const r=3.1+.8*tier,y=-1.55+.5*tier,shape=new T.Shape(),from=-SPAN/2-.12,to=SPAN/2+.12,n=48,pt=(a:number,rr:number)=>new T.Vector2(Math.sin(a)*rr,-(-Math.cos(a)*rr*.82+.2));
   for(let i=0;i<=n;i++){const p=pt(from+(to-from)*i/n,r+.4);i?shape.lineTo(p.x,p.y):shape.moveTo(p.x,p.y);}
   for(let i=n;i>=0;i--){const p=pt(from+(to-from)*i/n,r-.4);shape.lineTo(p.x,p.y);}
   const g=new T.ExtrudeGeometry(shape,{depth:.5,bevelEnabled:false,curveSegments:4});g.rotateX(-Math.PI/2);
   const shelf=new T.Mesh(g,wood);shelf.position.y=y-.5;this.root.add(shelf);
   const rim=new T.BufferGeometry().setFromPoints(Array.from({length:n+1},(_,i)=>{const a=from+(to-from)*i/n,p=pt(a,r-.4);return new T.Vector3(p.x,y+.002,-p.y);}));
   this.root.add(new T.Line(rim,new T.LineBasicMaterial({color:gold,transparent:true,opacity:.5})));
  }
  organ.forEach((ing,i)=>{const {inner,liquid}=this.vialMesh(ing,true),p=shelfPlace(i);inner.position.set(p.x,p.y,p.z);this.root.add(inner);this.shelf.push({group:inner,liquid});});
  this.root.position.set(0,1.1,-7);this.root.scale.setScalar(1.15);
 }
 /** An open hand, palm up: a soft pad, four fingers and a thumb. */
 private buildHand(){
  const skin=new T.MeshPhysicalMaterial({color:'#c8907a',roughness:.62,sheen:.6,sheenColor:new T.Color('#ffd2bc'),sheenRoughness:.5,emissive:'#3a1a0c',emissiveIntensity:.35});
  const g=new T.Group(),pad=new T.Mesh(new T.SphereGeometry(.5,32,20),skin);pad.scale.set(1,.22,.95);g.add(pad);
  [[-.33,.52,.42,.22],[-.11,.6,.5,.06],[.12,.58,.47,-.06],[.33,.5,.38,-.2]].forEach(([x,z,l,a])=>{const f=new T.Mesh(new T.CapsuleGeometry(.085,l,6,14),skin);f.rotation.set(Math.PI/2,0,a);f.position.set(x+Math.sin(-a)*l*.5,.02,-(z+l*.5));g.add(f);});
  const thumb=new T.Mesh(new T.CapsuleGeometry(.1,.36,6,14),skin);thumb.rotation.set(Math.PI/2,0,1.05);thumb.position.set(.58,.0,.05);g.add(thumb);
  g.rotation.set(.42,0,0);this.palmMesh=new T.Group();this.palmMesh.add(g);this.skin=skin;this.front.add(this.palmMesh);
  this.target=new T.Sprite(new T.SpriteMaterial({map:this.glow,color:'#ffd9a0',transparent:true,opacity:.5,depthWrite:false,blending:T.AdditiveBlending}));this.target.renderOrder=5;this.front.add(this.target);
  const drop=new T.SphereGeometry(.05,12,10);
  for(let k=0;k<3;k++)this.drops.push(Array.from({length:DROPS},()=>{const m=new T.Mesh(drop,new T.MeshBasicMaterial({color:'#fff',transparent:true,opacity:.9,depthWrite:false}));m.visible=false;m.renderOrder=70;this.front.add(m);return m;}));
 }
 // ---- Mapping.
 private resize(){
  if(this.disposed)return;
  this.width=Math.max(1,this.host.clientWidth);this.height=Math.max(1,this.host.clientHeight);
  this.renderer.setSize(this.width,this.height,false);this.camera.aspect=this.width/this.height;
  this.camera.position.set(0,3.2,13.4);this.camera.lookAt(0,-.6,0);this.applyCamera();
 }
 private applyCamera(){this.camera.zoom=this.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();}
 setPose(view:MirrorViewState){
  this.root.quaternion.fromArray(view.q).normalize();this.root.updateMatrixWorld(true);
  const z=Math.min(2.5,Math.max(.65,view.zoom));if(z!==this.zoom){this.zoom=z;this.applyCamera();}
 }
 setVideoAspect(a:number){this.videoAspect=a;}
 stage(p:MirrorPoint):Px{const s=mirrorToStage(p.x,p.y,this.videoAspect,this.width/this.height);return {x:s.x*this.width,y:s.y*this.height};}
 mirrorToWorld(p:MirrorPoint):WorldPoint{const s=this.stage(p);return {x:s.x,y:s.y,z:0};}
 /** Stage pixels, not world units: the engine hit-tests in the space the viewer sees. */
 pointToWorld(clientX:number,clientY:number):WorldPoint{const r=this.renderer.domElement.getBoundingClientRect();return {x:(clientX-r.left)/(r.width||1)*this.width,y:(clientY-r.top)/(r.height||1)*this.height,z:0};}
 partAt(){return -1;}
 get size(){return {w:this.width,h:this.height};}
 /** A stage pixel to the world point DEPTH in front of the camera. */
 private at(px:Px,out:T.Vector3,depth=DEPTH){
  out.set(px.x/this.width*2-1,1-px.y/this.height*2,.5).unproject(this.camera).sub(this.camera.position).normalize();
  const fwd=w.set(0,0,-1).applyQuaternion(this.camera.quaternion);return out.multiplyScalar(depth/out.dot(fwd)).add(this.camera.position);
 }
 /** World units per stage pixel at the front plane. */
 private get unit(){return 2*DEPTH*Math.tan(T.MathUtils.degToRad(this.camera.fov/2))/(this.height*this.zoom);}
 project(p:T.Vector3):Px{w.copy(p).project(this.camera);return {x:(w.x+1)/2*this.width,y:(1-w.y)/2*this.height};}
 // ---- Drawing.
 draw(s:OrganScene,now:number){
  if(this.disposed)return;
  const dt=Math.min(.1,Math.max(0,(now-this.lastNow)/1000));this.lastNow=now;
  const still=this.still.matches;
  this.drawVials(s,dt);this.drawPalm(s,dt);this.drawCloud(s,now,still);this.drawDrops(s,now);
  this.studio.update(dt,still,{x:0,y:0,tint:new T.Color('#ffd9a0'),sides:8,stretch:1,floor:0});
  this.renderer.render(this.scene,this.camera);
  this.hud.update(s,this);
 }
 private drawVials(s:OrganScene,dt:number){
  const u=this.unit,front=new Set(s.slots.map(x=>x.id)),hot=new Set([s.hover?.id,...s.reticles.map(r=>r.target)]);let n=0;
  organ.forEach((ing,i)=>{this.shelf[i].group.visible=!front.has(ing.id);});
  for(const vi of this.vials.values())vi.seen=false;
  for(const sl of s.slots){
   const vi=this.vial(sl.id),held=s.held.find(g=>g.id===sl.id),k=sl.size*u/VIAL_H,active=s.story.active.includes(sl.id);vi.seen=true;n++;
   const anchor=held?{x:held.x,y:held.y}:{x:sl.x,y:sl.y-sl.size/2};
   this.at(anchor,vi.group.position);vi.group.scale.setScalar(k*(held?1.08:1));
   vi.tilt+=((held?.tilt??0)-vi.tilt)*(1-Math.exp(-dt/.05));vi.group.rotation.set(0,0,-vi.tilt);this.stats.tilts[sl.id]=vi.tilt;
   const glow=held?1:hot.has(sl.id)?.85:active?.4:.05;vi.glow+=(glow-vi.glow)*(1-Math.exp(-dt/.08));
   vi.halo.material.opacity=vi.glow*.9;vi.liquid.material.emissiveIntensity=.08+vi.glow*.45;vi.liquid.material.opacity=active?.9:.45;
  }
  for(const vi of this.vials.values())vi.group.visible=vi.seen;
  this.stats.front=n;
 }
 private drawPalm(s:OrganScene,dt:number){
  const u=this.unit,p=s.palm,k=Math.min(118,this.width*.1)*u;
  this.at({x:p.x,y:p.y+4},this.palmMesh.position);this.palmMesh.scale.setScalar(k);
  // Warm skin flushes the palm.
  this.skin.emissive.setRGB(.23+.25*s.warm,.1+.03*s.warm,.05);
  const pouring=s.held.some(g=>g.rate>0&&g.inZone),aimed=s.held.some(g=>inZone(g,this.width,this.height)),items=s.doc.items,has=Object.keys(items).length>0;
  const [r,g,b]=has?mixColor(toBlend(items)):[1,.85,.62];
  const want=pouring?.9:aimed?.7:has?.45:.3;this.stats.palmGlow+=(want-this.stats.palmGlow)*(1-Math.exp(-dt/.1));
  this.at(p,this.target.position,DEPTH+2);this.target.scale.setScalar(k*3.2*(1+.06*Math.sin(this.lastNow/400)*(aimed?1:0)));this.target.material.color.setRGB(r,g,b,T.SRGBColorSpace);this.target.material.opacity=this.stats.palmGlow;
 }
 /** What is in the air over the palm at the ribbon's hour: each material a share of the points, as strong as it smells then. Wafts lift it. */
 private drawCloud(s:OrganScene,now:number,still:boolean){
  const cl=this.cloud,u=this.unit,P=this.at({x:s.palm.x,y:s.palm.y-10},new T.Vector3(),DEPTH+.5),R=Math.min(120,this.width*.1)*u,items=s.doc.items,skin=s.doc.warm?'warm':'normal';
  cl.object.material.uniforms.uPx.value=this.height*this.zoom/(2*Math.tan(T.MathUtils.degToRad(this.camera.fov/2)));
  const ids=Object.keys(items),key=ids.map(id=>id+items[id].toFixed(1)).join();
  const strength=ids.map(id=>intensity(id,items[id],0,skin)),sum=strength.reduce((a,b)=>a+b,0);
  if(key!==this.ownerKey){this.ownerKey=key;let acc=0;const cum=strength.map(x=>acc+=sum?x/sum:0);for(let k=0;k<CLOUD;k++){const r=this.seeds[k*4];this.owner[k]=cum.findIndex(q=>r<=q+1e-9);}}
  const left=ids.map(id=>remaining(ingredientById.get(id)!,s.clock,skin,CONC)),cols=ids.map(id=>new T.Color(ingredientById.get(id)!.color));
  const fill=Math.min(1,Object.values(items).reduce((a,b)=>a+b,0)/10),t=still?0:now/1000,lift=s.puffs.length?Math.max(0,1-s.puffs[s.puffs.length-1].age/1.6):0;let live=0;
  for(let k=0;k<CLOUD;k++){
   const o=this.owner[k],at=k*3;
   if(o<0||!ids[o]||this.seeds[k*4+1]>fill){cl.alpha[k]=0;continue;}
   const ing=ingredientById.get(ids[o])!,r=left[o],seed=this.seeds[k*4+1]/Math.max(.01,fill),a0=this.seeds[k*4+2]*Math.PI*2,q=this.seeds[k*4+3],vol=1-Math.min(1,Math.log(1+ing.tau)/Math.log(31));
   const rad=R*(.25+.75*vol)*Math.sqrt(q),a=a0+t*(.15+vol*.4),rise=((q*7.3+t*(.12+vol*.3))%1);
   let x=Math.cos(a)*rad,y=R*(.1+rise*(.5+vol*.6)),z=Math.sin(a)*rad*.5,alpha=0;
   if(seed<r){alpha=.55*(1-rise*.7);}
   y+=lift*R*(.8+q)*(.5+vol);x*=1+lift*.3;
   cl.pos[at]=P.x+x;cl.pos[at+1]=P.y+y;cl.pos[at+2]=P.z+z;cl.alpha[k]=alpha*(1+lift);cl.size[k]=(.16+.1*ing.strength)*(1-vol*.3)*R/1.2;
   const col=cols[o];cl.color[at]=col.r;cl.color[at+1]=col.g;cl.color[at+2]=col.b;if(alpha>0)live++;
  }
  cl.flush();this.stats.cloud=live;
 }
 /** Drops fall from each tilted vial: onto the palm when it is over it, past it and fading when not. */
 private drawDrops(s:OrganScene,now:number){
  let shown=0;
  this.drops.forEach((list,k)=>{
   const g=s.held[k],u=this.unit;
   list.forEach((m,i)=>{
    if(!g||g.rate<=0){m.visible=false;return;}
    const ing=ingredientById.get(g.id)!,phase=((now/1000)*(.6+g.rate*.25)+i/DROPS)%1,on=g.inZone,end=on?s.palm.y-6:g.y+this.height*.3;
    const lip={x:g.x+Math.sign(g.tilt||1)*14,y:g.y+4};
    const y=lip.y+(end-lip.y)*phase*phase,x=lip.x;
    if(i>=Math.ceil(DROPS*Math.min(1,g.rate/3))){m.visible=false;return;}
    this.at({x,y},m.position);m.scale.setScalar(5*u/.05*(.7+.3*(1-phase)));m.material.color.set(ing.color);m.material.opacity=on?.95:.55*(1-phase);m.visible=true;shown++;
   });
  });
  this.stats.drops=shown;
 }
 get cameraZoom(){return this.camera.zoom;}
 get cameraMatrix(){return [...this.camera.projectionMatrix.elements,...this.camera.matrixWorld.elements];}
 dispose(){
  if(this.disposed)return;this.disposed=true;this.resizer.disconnect();this.hud.dispose();this.studio.dispose();
  this.scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Points||o instanceof T.Line){o.geometry.dispose();for(const m of [o.material].flat())(m as T.Material).dispose();}});
  this.glow.dispose();this.renderer.dispose();this.renderer.domElement.remove();
 }
}
