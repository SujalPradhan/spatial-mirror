import * as T from 'three';
import type {MirrorPoint,MirrorView,MirrorViewState,WorldPoint} from '../mirror/contracts';
import {mirrorToStage} from '../mirror/projection';
import {bottleForms,collarForm,KNURL_SEGMENTS,liquidRows,turned} from '../perfume/flacon';
import {Studio} from '../perfume/studio';
import type {OrganScene,OrganWorld,Px} from './contracts';
import {OrganHud} from './hud';
import {ingredientById,organ,type Ingredient} from './ingredients';
import {FLASK,FOREARM,PALM,SPAN,place,vialCount,type Placed} from './layout';
import {FULL_DROPS,composition,dropCount,ingredient,layering,layers,mixColor,remaining,shares,type Blend} from './model';

const MM=.019,VIAL_MID=.36,CLOUD=1100,MIST=160;
/** The ✌️ cut's normal on the palm: it removes the half nearest the viewer, so the cut face looks back at them. */
/** World height of the flask's open neck: the flacon's neck top is 78 mm above its bore floor, and its foot 7 mm below. */
const NECK_Y=FLASK.y+(7+78)*MM;
const CUT_X=Math.sin(.75),CUT_Z=Math.cos(.75);
const v=new T.Vector3(),w=new T.Vector3(),c=new T.Color(),gold=new T.Color('#f3cf86');
const hsl={h:0,s:0,l:0};
/** The drops' mixed colour, a little richer than a straight average so a blend reads as a juice and not a grey. */
const rgb=(b:Blend)=>{const [r,g,bl]=mixColor(b);c.setRGB(r,g,bl,T.SRGBColorSpace).getHSL(hsl);return new T.Color().setHSL(hsl.h,Math.min(1,hsl.s*1.5+.08),Math.min(.72,hsl.l));};
/** A soft round glow for sprites and points. */
function glowTexture(){
 const k=document.createElement('canvas');k.width=k.height=64;const g=k.getContext('2d')!,r=g.createRadialGradient(32,32,0,32,32,32);
 r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.25,'rgba(255,240,210,.55)');r.addColorStop(1,'rgba(255,220,160,0)');g.fillStyle=r;g.fillRect(0,0,64,64);
 const t=new T.CanvasTexture(k);t.colorSpace=T.SRGBColorSpace;return t;
}
const cloudVert=/* glsl */`attribute float aSize,aAlpha;attribute vec3 aColor;uniform float uPx;varying vec3 vC;varying float vA;
void main(){vC=aColor;vA=aAlpha;vec4 m=modelViewMatrix*vec4(position,1.);gl_PointSize=aAlpha>0.001?min(220.,uPx*aSize/-m.z):0.;gl_Position=projectionMatrix*m;}`;
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
interface Vial {group:T.Group;body:T.Mesh;liquid:T.Mesh<T.BufferGeometry,T.MeshPhysicalMaterial>;halo:T.Sprite;ing:Ingredient;at:Placed;lift:number;screen:Px&{on:boolean}}
/** The organ, the flask, the palm and the forearm, drawn from a scene snapshot. Hit tests answer in stage pixels from the last drawn frame. */
export class OrganView implements MirrorView<OrganScene>,OrganWorld {
 readonly ready:Promise<void>;readonly partCount=0;
 readonly scene=new T.Scene();readonly camera=new T.PerspectiveCamera(34,1,.1,80);readonly renderer:T.WebGLRenderer;
 readonly root=new T.Group();
 private studio:Studio;private crystal!:T.MeshPhysicalMaterial;readonly hud:OrganHud;readonly vials:Vial[]=[];private flaskGroup=new T.Group();private liquid!:T.Mesh;private studioTint=new T.Color('#ffffff');
 private layerPucks:T.Mesh<T.BufferGeometry,T.MeshPhysicalMaterial>[]=[];private ghosts:T.Mesh<T.SphereGeometry,T.MeshPhysicalMaterial>[]=[];
 private cloud=new Points(CLOUD);private mist=new Points(MIST);private seeds=new Float32Array(CLOUD*4);private owner:Int16Array=new Int16Array(CLOUD).fill(-1);private ownerKey='';
 private palmMesh!:T.Group;private skin!:T.MeshPhysicalMaterial;private sliceDisc:T.Mesh<T.RingGeometry,T.MeshBasicMaterial>;private forearm:T.Group=new T.Group();private bands:T.Mesh<T.CylinderGeometry,T.MeshPhysicalMaterial>[]=[];private bandGlow:T.Sprite[]=[];
 private width=1;private height=1;private videoAspect=0;private zoom=1;private lastNow=0;private disposed=false;private sprays=0;private mistT=-1;private clock=0;
 private resizer:ResizeObserver;private still=matchMedia('(prefers-reduced-motion: reduce)');private glow=glowTexture();
 /** Last-drawn values the tests read. */
 stats={visibleVials:0,cloud:0,ribbons:0,core:0,fill:0,liquid:'#ffffff',lifted:-1};
 constructor(readonly host:HTMLElement){
  const r=this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  r.setPixelRatio(Math.min(devicePixelRatio||1,1.75));r.setClearColor(0,0);r.toneMapping=T.ACESFilmicToneMapping;r.toneMappingExposure=1.08;
  r.domElement.className='mirror-canvas organ-canvas';r.domElement.setAttribute('aria-hidden','true');host.prepend(r.domElement);
  this.camera.position.set(0,4.6,13.4);this.camera.lookAt(0,-.25,0);
  this.scene.add(this.root);
  this.studio=new Studio(r,this.scene,[]);
  // The studio's bright sweep is for a lone bottle; here the glass should bend the organ behind it, so the sweep stays dark.
  this.scene.traverse(o=>{if(o.renderOrder===-100)o.visible=false;});
  // What the crystal bends: a dim warm room, drawn only in the transmission pass. three.js would otherwise clear that pass to half white behind a transparent canvas.
  const room=new T.Mesh(new T.SphereGeometry(40,24,16),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{uShow:{value:0}},vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:'uniform float uShow;varying vec3 vP;void main(){if(uShow<.5)discard;float h=normalize(vP).y;vec3 c=mix(vec3(.05,.035,.025),vec3(.16,.11,.07),smoothstep(-.2,.5,h))+vec3(.5,.36,.2)*smoothstep(.985,1.,dot(normalize(vP),normalize(vec3(-.3,.5,-1.))));vec3 n=normalize(vP);float a=atan(n.x,-n.z);c+=vec3(.9,.75,.55)*(smoothstep(.05,0.,abs(a-.55))+smoothstep(.04,0.,abs(a+.7))*.7)*smoothstep(.6,0.,abs(n.y-.1));gl_FragColor=vec4(c,1.);}'}));
  room.renderOrder=-200;room.frustumCulled=false;room.onBeforeRender=rr=>{const show=rr.getRenderTarget()?1:0,u=room.material.uniforms.uShow;if(u.value!==show){u.value=show;room.material.uniformsNeedUpdate=true;}};this.scene.add(room);
  const key=new T.DirectionalLight('#ffe6c4',1.2);key.position.set(-3,7,6);const fill=new T.PointLight('#ffb870',14,14,1.6);fill.position.set(0,1.5,3.5);this.scene.add(key,fill,new T.HemisphereLight('#3b2a1c','#050404',.6));
  this.buildOrgan();this.buildFlask();this.buildHand();this.buildForearm();
  this.cloud.object.material.uniforms.uPx.value=1;this.root.add(this.cloud.object,this.mist.object);
  for(let i=0;i<CLOUD*4;i++)this.seeds[i]=Math.random();
  const disc=new T.RingGeometry(.9,1.0,64);this.sliceDisc=new T.Mesh(disc,new T.MeshBasicMaterial({color:gold,transparent:true,opacity:0,side:T.DoubleSide,depthWrite:false,blending:T.AdditiveBlending}));this.root.add(this.sliceDisc);
  this.hud=new OrganHud(host);
  this.resizer=new ResizeObserver(()=>this.resize());this.resizer.observe(host);this.resize();
  this.ready=Promise.resolve();
 }
 // ---- Building.
 private buildOrgan(){
  const wood=new T.MeshPhysicalMaterial({color:'#2a160c',roughness:.45,clearcoat:.35,clearcoatRoughness:.35,envMapIntensity:.1,specularIntensity:.3});
  for(let tier=0;tier<4;tier++){
   const r=3.1+.8*tier,y=-1.55+.5*tier,shape=new T.Shape(),from=-SPAN/2-.12,to=SPAN/2+.12,n=48,pt=(a:number,rr:number)=>new T.Vector2(Math.sin(a)*rr,-(-Math.cos(a)*rr*.82+.2));
   for(let i=0;i<=n;i++){const p=pt(from+(to-from)*i/n,r+.4);i?shape.lineTo(p.x,p.y):shape.moveTo(p.x,p.y);}
   for(let i=n;i>=0;i--){const p=pt(from+(to-from)*i/n,r-.4);shape.lineTo(p.x,p.y);}
   const g=new T.ExtrudeGeometry(shape,{depth:.5,bevelEnabled:false,curveSegments:4});g.rotateX(-Math.PI/2);
   const shelf=new T.Mesh(g,wood);shelf.position.y=y-.5;this.root.add(shelf);
   const rim=new T.BufferGeometry().setFromPoints(Array.from({length:n+1},(_,i)=>{const a=from+(to-from)*i/n,p=pt(a,r-.4);return new T.Vector3(p.x,y+.002,-p.y);}));
   this.root.add(new T.Line(rim,new T.LineBasicMaterial({color:gold,transparent:true,opacity:.85})));
  }
  const profile=[[0,0],[.16,0],[.18,.03],[.18,.5],[.15,.58],[.07,.62],[.07,.7],[0,.7]].map(([x,y])=>new T.Vector2(x,y));
  const bodyG=new T.LatheGeometry(profile,28),liqG=new T.CylinderGeometry(.155,.155,.44,24).translate(0,.25,0),capG=new T.CylinderGeometry(.085,.085,.13,24).translate(0,.74,0),bandG=new T.CylinderGeometry(.183,.183,.1,28,1,true).translate(0,.3,0);
  const glass=new T.MeshPhysicalMaterial({color:'#ffffff',roughness:.04,transparent:true,opacity:.16,clearcoat:1,clearcoatRoughness:0,envMapIntensity:1.1,depthWrite:false,side:T.DoubleSide});
  const cap=new T.MeshPhysicalMaterial({color:gold,metalness:1,roughness:.16,envMapIntensity:1.6}),band=new T.MeshPhysicalMaterial({color:gold,metalness:1,roughness:.3,envMapIntensity:1.2,side:T.DoubleSide});
  organ.forEach(ing=>{
   const group=new T.Group(),body=new T.Mesh(bodyG,glass),liquid=new T.Mesh(liqG,new T.MeshPhysicalMaterial({color:ing.color,roughness:.1,transparent:true,opacity:.86,emissive:ing.color,emissiveIntensity:.28,envMapIntensity:1}));
   body.renderOrder=20;group.add(liquid,body,new T.Mesh(capG,cap),new T.Mesh(bandG,band));
   const halo=new T.Sprite(new T.SpriteMaterial({map:this.glow,color:ing.color,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}));halo.scale.setScalar(1.3);halo.position.y=VIAL_MID;group.add(halo);
   this.root.add(group);this.vials.push({group,body,liquid,halo,ing,at:{x:0,y:0,z:0,angle:0,shown:1},lift:0,screen:{x:-1e4,y:-1e4,on:false}});
  });
 }
 private buildFlask(){
  const L=this.studio.looks,g=this.flaskGroup;g.scale.setScalar(MM);g.position.set(FLASK.x,FLASK.y+7*MM,FLASK.z);
  // The studio's crystal, toned down: seen from above, the overhead softbox would otherwise fill every facet.
  const crystal=L.glass.clone();crystal.envMapIntensity=.9;crystal.iridescence=.2;crystal.clearcoat=.8;this.crystal=crystal;
  const bottle=new T.Mesh(turned([bottleForms.tower],96),crystal),collar=new T.Mesh(turned([collarForm],KNURL_SEGMENTS),L.collar);
  this.liquid=new T.Mesh(turned([{rows:liquidRows,section:()=>1,crease:60}],72),L.liquid);this.liquid.renderOrder=50;
  g.add(this.liquid,bottle,collar,this.studio.floor);this.root.add(g);
  const puck=new T.SphereGeometry(.42,40,20).scale(1,.36,1);
  for(let i=0;i<3;i++){const m=new T.Mesh(puck,new T.MeshPhysicalMaterial({color:'#fff',roughness:.05,transparent:true,opacity:.85,emissive:'#fff',emissiveIntensity:.45,clearcoat:1,clearcoatRoughness:0,envMapIntensity:1.4}));m.visible=false;this.layerPucks.push(m);this.root.add(m);}
  const drop=new T.SphereGeometry(.07,16,12);
  for(let i=0;i<10;i++){const m=new T.Mesh(drop,new T.MeshPhysicalMaterial({color:'#fff',transparent:true,opacity:.5,emissive:'#fff',emissiveIntensity:.6,roughness:.05,depthWrite:false}));m.visible=false;this.ghosts.push(m);this.root.add(m);}
 }
 /** An open hand, palm up: a soft pad, four fingers and a thumb, so the cloud clearly sits on skin. */
 private buildHand(){
  const skin=new T.MeshPhysicalMaterial({color:'#c8907a',roughness:.62,sheen:.6,sheenColor:new T.Color('#ffd2bc'),sheenRoughness:.5,transparent:true,opacity:0,emissive:'#3a1a0c',emissiveIntensity:.35});
  const g=new T.Group(),pad=new T.Mesh(new T.SphereGeometry(.5,32,20),skin);pad.scale.set(1,.22,.95);g.add(pad);
  [[-.33,.52,.42,.22],[-.11,.6,.5,.06],[.12,.58,.47,-.06],[.33,.5,.38,-.2]].forEach(([x,z,l,a])=>{const f=new T.Mesh(new T.CapsuleGeometry(.085,l,6,14),skin);f.rotation.set(Math.PI/2,0,a);f.position.set(x+Math.sin(-a)*l*.5,.02,-(z+l*.5));g.add(f);});
  const thumb=new T.Mesh(new T.CapsuleGeometry(.1,.36,6,14),skin);thumb.rotation.set(Math.PI/2,0,1.05);thumb.position.set(.58,.0,.05);g.add(thumb);
  const wrist=new T.Mesh(new T.CapsuleGeometry(.3,.5,6,16),skin);wrist.rotation.x=Math.PI/2;wrist.scale.set(1.1,.55,1);wrist.position.set(0,-.02,.62);g.add(wrist);
  g.rotation.set(.75,-.3,.12);g.position.set(PALM.x,PALM.y-.12,PALM.z);g.scale.setScalar(.72);this.palmMesh=g;this.skin=skin;this.root.add(g);
 }
 private buildForearm(){
  const skin=new T.MeshPhysicalMaterial({color:'#c8907a',roughness:.62,sheen:.6,sheenColor:new T.Color('#ffd2bc'),sheenRoughness:.5,emissive:'#2a140a',emissiveIntensity:.3});
  const profile=Array.from({length:21},(_,i)=>{const t=i/20,r=.24+.11*t-.02*Math.sin(t*Math.PI);return new T.Vector2(i===0||i===20?0:r,(t-.5)*3);});
  profile[0].set(0,-1.5);profile.splice(1,0,new T.Vector2(.2,-1.5));profile.splice(-1,0,new T.Vector2(.3,1.5));
  const arm=new T.Mesh(new T.LatheGeometry(profile,40),skin);arm.rotation.z=Math.PI/2;arm.scale.set(1,1,.8);this.forearm.add(arm);
  for(let i=0;i<3;i++){
   const r=.25+.11*(1-(i+.5)/3*.8);
   const b=new T.Mesh(new T.CylinderGeometry(r+.025,r+.025,.62,40,1,true),new T.MeshPhysicalMaterial({color:'#fff',transparent:true,opacity:.82,roughness:.2,clearcoat:1,emissive:'#fff',emissiveIntensity:.2,side:T.DoubleSide,depthWrite:false}));
   b.rotation.z=Math.PI/2;b.scale.set(1,.7,.8);b.position.x=.85-i*.78;this.forearm.add(b);this.bands.push(b);
   const s=new T.Sprite(new T.SpriteMaterial({map:this.glow,transparent:true,depthWrite:false,blending:T.AdditiveBlending}));s.position.set(.85-i*.78,.45,0);this.forearm.add(s);this.bandGlow.push(s);
  }
  this.forearm.position.set(FOREARM.x,FOREARM.y,FOREARM.z);this.forearm.rotation.set(-.2,.5,.08);this.forearm.visible=false;this.root.add(this.forearm);
 }
 // ---- Mapping.
 private resize(){
  if(this.disposed)return;
  this.width=Math.max(1,this.host.clientWidth);this.height=Math.max(1,this.host.clientHeight);
  this.renderer.setSize(this.width,this.height,false);this.camera.aspect=this.width/this.height;
  // A narrow stage steps back rather than cropping the organ's ends.
  this.camera.position.set(0,4.6,this.camera.aspect<1.25?17:13.4);this.camera.lookAt(0,-.25,0);
  this.applyCamera();
 }
 private applyCamera(){this.camera.zoom=this.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();}
 setPose(view:MirrorViewState){
  this.root.quaternion.fromArray(view.q).normalize();this.root.position.set(view.x,view.y,0);this.root.updateMatrixWorld(true);
  const z=Math.min(2.5,Math.max(.65,view.zoom));if(z!==this.zoom){this.zoom=z;this.applyCamera();}
 }
 setVideoAspect(a:number){this.videoAspect=a;}
 stage(p:MirrorPoint):Px{const s=mirrorToStage(p.x,p.y,this.videoAspect,this.width/this.height);return {x:s.x*this.width,y:s.y*this.height};}
 mirrorToWorld(p:MirrorPoint):WorldPoint{const s=this.stage(p);return {x:s.x,y:s.y,z:0};}
 /** Stage pixels, not world units: the engine hit-tests in the space the viewer sees. */
 pointToWorld(clientX:number,clientY:number):WorldPoint{const r=this.renderer.domElement.getBoundingClientRect();return {x:(clientX-r.left)/(r.width||1)*this.width,y:(clientY-r.top)/(r.height||1)*this.height,z:0};}
 partAt(){return -1;}
 vial(i:number){return this.vials[i]?.screen??{x:-1e4,y:-1e4,on:false};}
 flask(){return this.project(v.set(FLASK.x,NECK_Y+.3,FLASK.z));}
 palm(){return this.project(v.set(PALM.x,PALM.y,PALM.z));}
 /** World (inside the posed organ) to stage pixels. */
 project(p:T.Vector3):Px{w.copy(p).applyMatrix4(this.root.matrixWorld).project(this.camera);return {x:(w.x+1)/2*this.width,y:(1-w.y)/2*this.height};}
 /** A stage pixel back onto the plane through a world point, facing the camera. */
 private unproject(px:Px,depthOf:T.Vector3,out:T.Vector3){
  const world=w.copy(depthOf).applyMatrix4(this.root.matrixWorld),ndc=world.clone().project(this.camera);
  out.set(px.x/this.width*2-1,1-px.y/this.height*2,ndc.z).unproject(this.camera);
  return this.root.worldToLocal(out);
 }
 // ---- Drawing.
 draw(s:OrganScene,now:number){
  if(this.disposed)return;
  const dt=Math.min(.1,Math.max(0,(now-this.lastNow)/1000));this.lastNow=now;
  const still=this.still.matches,blend=s.doc.blend;
  this.clock=s.clock;
  this.drawVials(s,dt);this.drawFlask(s,blend);this.drawCloud(s,now,dt,still);this.drawForearm(s);
  this.studio.update(dt,still,{x:this.root.position.x,y:this.root.position.y,tint:this.studioTint,sides:8,stretch:1,floor:1});
  this.root.updateMatrixWorld(true);
  this.renderer.render(this.scene,this.camera);
  this.hud.update(s,this);
 }
 private drawVials(s:OrganScene,dt:number){
  const grab=s.grab,hover=s.hover?.vial??-1,cands=new Set(s.reticles.map(r=>r.vial));let shown=0;
  this.vials.forEach((vi,i)=>{
   place(i,s.ring,s.fan,vi.at);const held=grab?.vial===i;
   vi.lift+=((held?1:0)-vi.lift)*(1-Math.exp(-dt/.08));
   const g=vi.group;g.position.set(vi.at.x,vi.at.y,vi.at.z);g.rotation.set(0,0,0);
   if(held&&grab){
    // The vial leaves its slot for the hand, tipping toward the flask as the dose grows.
    const target=this.unproject({x:grab.x,y:grab.y+28},v.set(vi.at.x,vi.at.y+VIAL_MID,vi.at.z+1.2),new T.Vector3());
    g.position.lerp(target.sub(v.set(0,VIAL_MID,0)),vi.lift);g.rotation.z=-Math.sign(grab.to.x-grab.x||1)*grab.drops/10*1.1*vi.lift;
   }
   const scale=.4+.6*vi.at.shown;g.scale.setScalar(scale);g.visible=vi.at.shown>.02;
   const glow=held?1:i===hover?.8:cands.has(i)?.6:0;
   vi.halo.material.opacity+=(glow*.9-vi.halo.material.opacity)*(1-Math.exp(-dt/.06));
   vi.liquid.material.emissiveIntensity=.28+glow*.9;
   const scr=this.project(v.set(g.position.x,g.position.y+VIAL_MID*scale,g.position.z));
   vi.screen.x=scr.x;vi.screen.y=scr.y;vi.screen.on=vi.at.shown>.5&&!held;if(vi.screen.on)shown++;
  });
  this.stats.visibleVials=shown;this.stats.lifted=grab?.vial??-1;
 }
 private drawFlask(s:OrganScene,blend:Blend){
  const n=dropCount(blend),fill=Math.min(1,n/FULL_DROPS),grab=s.grab,level=Math.max(.02,fill),col=n?rgb(blend):new T.Color('#ffffff');
  const top=5.05+(62.7-5.05)*level,sc=Math.max(.001,(top-5.05)/(62.7-5.05)),m=this.liquid;
  m.scale.y=sc;m.position.y=5.05*(1-sc);m.visible=n>0&&s.split<.98;
  const tint=this.studio.liquidTint;tint.uLight.value.copy(col);tint.uDeep.value.copy(col).multiplyScalar(.42);tint.uAlpha.value=.85*(1-s.split);
  this.studioTint.copy(col).lerp(new T.Color('#ffd9a0'),n?.4:1);
  this.stats.fill=fill;this.stats.liquid='#'+col.getHexString();
  // Ghost drops fall into the neck, one per drop the pinch would add.
  const neck=v.set(FLASK.x,NECK_Y,FLASK.z),drip=grab&&!grab.loose?grab.drops:0,gc=grab?new T.Color(ingredientById.get(organ[grab.vial].id)!.color):col,fall=(this.lastNow/700)%1;
  this.ghosts.forEach((g,i)=>{g.visible=i<drip;if(!g.visible)return;const k=(i+fall)/Math.max(1,drip);g.position.set(neck.x,neck.y+.12+k*.8,neck.z);g.scale.set(1.1,1.5,1.1);
   g.material.color.copy(gc);g.material.emissive.copy(gc);g.material.emissiveIntensity=1.1;g.material.opacity=.85*Math.sin(Math.PI*Math.min(1,k*1.15));});
  // 🤏🤏 lifts the blend out as three pucks: base low, heart, top highest, each its own colour and size.
  const ls=layers(blend);
  this.layerPucks.forEach((p,i)=>{
   const L=ls[2-i],on=s.split>.02&&L.share>0;p.visible=on;if(!on)return;
   const sub:Blend={items:L.parts.map(q=>({id:q.id,drops:q.share})),conc:blend.conc},k=s.split;
   p.position.set(FLASK.x-1.6*k,FLASK.y+.4+k*(.6+i*.85),FLASK.z+.2);p.scale.set(.5+Math.cbrt(L.share)*.7,1,.5+Math.cbrt(L.share)*.7);
   p.material.color.copy(rgb(sub));p.material.emissive.copy(p.material.color);p.material.opacity=.85*k;
  });
 }
 /** The blend on the palm: each material a share of the points, leaving at its own rate as ribbons that rise and fade. */
 private drawCloud(s:OrganScene,now:number,dt:number,still:boolean){
  const worn=s.doc.mode==='drydown',b=s.doc.blend,cl=this.cloud,P=v.set(PALM.x,PALM.y+.25,PALM.z);
  const pm=this.skin;pm.opacity+=((worn?1:0)-pm.opacity)*(1-Math.exp(-dt/.2));pm.transparent=pm.opacity<.99;this.palmMesh.visible=pm.opacity>.01;
  if(s.sprays!==this.sprays){this.sprays=s.sprays;this.mistT=0;}
  cl.object.material.uniforms.uPx.value=this.height*this.zoom/(2*Math.tan(T.MathUtils.degToRad(this.camera.fov/2)));
  this.mist.object.material.uniforms.uPx.value=cl.object.material.uniforms.uPx.value;
  // Each point belongs to one material, in proportion to its drops; reassigned only when the blend changes.
  const sh=[...shares(b)],key=sh.map(([id,x])=>id+x.toFixed(3)).join();
  if(key!==this.ownerKey){this.ownerKey=key;let acc=0;const cum=sh.map(([id,x])=>({i:ingredient(id),to:acc+=x}));for(let k=0;k<CLOUD;k++){const r=this.seeds[k*4];const hit=cum.findIndex(q=>r<=q.to+1e-9);this.owner[k]=hit;}}
  const mats=sh.map(([id])=>ingredient(id)),left=mats.map(i=>remaining(i,s.clock,s.doc.skin,b.conc)),cols=mats.map(i=>new T.Color(i.color));
  const t=still?0:now/1000,cut=s.slice;let live=0,ribbons=0,core=0;
  for(let k=0;k<CLOUD;k++){
   const o=this.owner[k],at=k*3;
   if(!worn||o<0||!mats[o]){cl.alpha[k]=0;continue;}
   const ing=mats[o],r=left[o],seed=this.seeds[k*4+1],a0=this.seeds[k*4+2]*Math.PI*2,u=this.seeds[k*4+3],vol=1-Math.min(1,Math.log(1+ing.tau)/Math.log(31));
   // Volatile materials sit wide and loose; base materials pack into a glowing core.
   const rad=(.12+.62*vol)*Math.sqrt(u),a=a0+t*(.15+vol*.4);
   let x=Math.cos(a)*rad,y=(u-.5)*.5*(.4+vol)+.1,z=Math.sin(a)*rad*.7,alpha=0;
   const leaving=(seed-r)/.28;
   if(seed<r){alpha=.75;if(vol<.25)core++;}
   else if(leaving<1){
    // Peeling off: a ribbon that climbs and twists away from the palm while it fades.
    const q=leaving,turn=a0+q*4+t*.6;x+=Math.cos(turn)*q*(.4+vol*.8);z+=Math.sin(turn)*q*.4;y+=q*(1.2+vol*1.4);alpha=(1-q)*.7;ribbons++;
   }
   if(cut>0&&x*CUT_X+z*CUT_Z>0)alpha*=1-cut;
   cl.pos[at]=P.x+x;cl.pos[at+1]=P.y+y;cl.pos[at+2]=P.z+z;cl.alpha[k]=alpha;cl.size[k]=(.2+.16*ing.strength)*(1-vol*.3)*(alpha>0&&seed>=r?1.25:1);
   const col=cols[o];cl.color[at]=col.r;cl.color[at+1]=col.g;cl.color[at+2]=col.b;if(alpha>0)live++;
  }
  cl.flush();this.stats.cloud=live;this.stats.ribbons=ribbons;this.stats.core=core;
  // The cut: a gold disc through the cloud's middle, square to the viewer.
  const d=this.sliceDisc;d.position.set(P.x,P.y+.2,P.z);d.lookAt(P.x+CUT_X,P.y+.2,P.z+CUT_Z);d.material.opacity=.3*cut;d.visible=cut>.01;
  // 👍 mist: a short arc of droplets from the flask's neck to the palm.
  const mi=this.mist;
  if(this.mistT>=0){this.mistT+=dt;const col=b.items.length?rgb(b):new T.Color('#fff');
   for(let k=0;k<MIST;k++){const q=Math.min(1,Math.max(0,this.mistT*1.8-this.seeds[k*4]*.6)),at=k*3,sx=FLASK.x+.2,sy=NECK_Y+.15;
    mi.pos[at]=sx+(P.x-sx)*q+(this.seeds[k*4+1]-.5)*.5*q;mi.pos[at+1]=sy+(P.y+.3-sy)*q+Math.sin(q*Math.PI)*.9+(this.seeds[k*4+2]-.5)*.3;mi.pos[at+2]=FLASK.z+(P.z-FLASK.z)*q;
    mi.alpha[k]=q>0&&q<1?.8*(1-q*.6):0;mi.size[k]=.06;mi.color[at]=col.r;mi.color[at+1]=col.g;mi.color[at+2]=col.b;}
   if(this.mistT>1.2){this.mistT=-1;mi.alpha.fill(0);}
   mi.flush();
  }
 }
 private drawForearm(s:OrganScene){
  const stack=s.doc.stack,on=stack.length>0&&(s.doc.mode==='layering'||s.doc.mode==='compose'&&stack.length>0);this.forearm.visible=on;
  if(!on)return;
  const L=layering(stack,s.clock,s.doc.skin),active=s.doc.mode==='layering';
  this.bands.forEach((b,i)=>{
   const blend=stack[i];b.visible=!!blend;this.bandGlow[i].visible=!!blend&&active;if(!blend)return;
   const col=rgb(blend),left=L.left[i]/Math.max(1e-6,blend.conc);
   b.material.color.copy(col);b.material.emissive.copy(col);b.material.emissiveIntensity=.08+.4*left;b.material.opacity=.55+.4*left;
   const g=this.bandGlow[i];g.material.color.copy(col);g.material.opacity=.25+.7*L.share[i];g.scale.setScalar(.5+1.6*L.share[i]);
  });
 }
 /** For the HUD: the dry-down composition at the clock, and the palm on screen. */
 composition(s:OrganScene){return composition(s.doc.blend,s.clock,s.doc.skin);}
 projectWorld(x:number,y:number,z:number){return this.project(v.set(x,y,z));}
 get size(){return {w:this.width,h:this.height};}
 get cameraZoom(){return this.camera.zoom;}
 get cameraMatrix(){return this.camera.projectionMatrix.elements.slice();}
 dispose(){
  if(this.disposed)return;this.disposed=true;this.resizer.disconnect();this.hud.dispose();this.studio.dispose();
  this.scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Points||o instanceof T.Line){o.geometry.dispose();for(const m of [o.material].flat())(m as T.Material).dispose();}});
  this.glow.dispose();this.crystal.dispose();this.renderer.dispose();this.renderer.domElement.remove();
 }
}
