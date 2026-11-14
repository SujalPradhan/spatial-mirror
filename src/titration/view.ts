import * as T from 'three';
import {mirrorToStage} from '../mirror/projection';
import type {MirrorPoint,MirrorViewState,WorldPoint} from '../mirror/contracts';
import type {TitrationScene,TitrationView} from './contracts';
import {BENCH_Y,BURETTE,TILE_TOP,buildBurette,buildFlask,buildPipette,buildStand,buretteY,flaskLevel,flaskLiquid,graduationTexture} from './glassware';

const FLASK_X=0,DROPS=10,GRAVITY=26,CAMERA_Y=1.45,HALF_TAN=Math.tan(18.5*Math.PI/180);
const WATER=new T.Color('#d8e8f2'),TITRANT=new T.Color('#cfe6f6');
const v=new T.Vector3();
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;

/** The bench: a stand and burette over a conical flask on a white tile. Glassware is built from lathes, nothing is loaded. */
export class BenchView implements TitrationView {
 readonly ready=Promise.resolve();
 readonly scene=new T.Scene();
 readonly camera=new T.PerspectiveCamera(37,1,.1,100);
 readonly renderer:T.WebGLRenderer;
 partCount=0;
 private readonly root=new T.Group();
 private readonly flask=new T.Group();
 private liquid:T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;
 private liquidLevel=-1;
 private patch:T.Mesh<T.CircleGeometry,T.MeshBasicMaterial>;
 private readonly buretteLiquid:T.Mesh<T.CylinderGeometry,T.MeshStandardMaterial>;
 private readonly bubble:T.Mesh;
 private readonly key:T.Object3D;
 private readonly stream:T.Mesh<T.CylinderGeometry,T.MeshBasicMaterial>;
 private readonly drops:{mesh:T.Mesh;y:number;vy:number;on:boolean}[]=[];
 private lastDropCount=0;private lastTime=0;private shownReading=-1;
 private focusAmount=0;private baseZoom=1;private zoom=1;
 private videoAspect=0;private width=1;private height=1;private disposed=false;private contextLost=false;
 private readonly resizeObserver:ResizeObserver;

 constructor(readonly host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
  this.renderer.setClearColor(0,0);
  this.renderer.domElement.className='titration-canvas mirror-canvas';
  this.renderer.domElement.setAttribute('aria-hidden','true');
  host.prepend(this.renderer.domElement);
  this.camera.position.set(0,CAMERA_Y,18);
  this.scene.add(this.root);
  this.scene.add(new T.AmbientLight('#cfe0f2',1.2));
  const key=new T.DirectionalLight('#ffffff',2.2);key.position.set(-4,8,9);this.scene.add(key);
  const rim=new T.DirectionalLight('#7fb4ff',1.1);rim.position.set(6,3,-5);this.scene.add(rim);

  const bench=new T.Mesh(new T.BoxGeometry(14,.3,5),new T.MeshStandardMaterial({color:'#1b2531',roughness:.8}));bench.position.set(0,BENCH_Y-.15,-.4);
  const tile=new T.Mesh(new T.BoxGeometry(3.8,.12,3.2),new T.MeshStandardMaterial({color:'#f1f4f7',roughness:.5}));tile.position.set(FLASK_X,BENCH_Y+.06,.2);
  this.root.add(bench,tile,buildStand());

  const burette=buildBurette();this.key=burette.key;burette.group.position.x=BURETTE.x;this.root.add(burette.group);
  const marks=new T.Mesh(new T.CylinderGeometry(BURETTE.radius+.012,BURETTE.radius+.012,BURETTE.top-BURETTE.tip,28,1,true,-Math.PI*.42,Math.PI*.84),new T.MeshBasicMaterial({map:graduationTexture(),transparent:true,side:T.FrontSide,depthWrite:false}));
  marks.position.set(BURETTE.x,(BURETTE.top+BURETTE.tip)/2,0);marks.renderOrder=3;this.root.add(marks);
  this.buretteLiquid=new T.Mesh(new T.CylinderGeometry(BURETTE.radius-.04,BURETTE.radius-.04,1,24),new T.MeshStandardMaterial({color:TITRANT,transparent:true,opacity:.5,roughness:.2}));
  this.buretteLiquid.renderOrder=1;this.root.add(this.buretteLiquid);
  this.bubble=new T.Mesh(new T.SphereGeometry(.07,12,10),new T.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.9}));this.bubble.position.set(BURETTE.x,BURETTE.tip+.32,0);this.root.add(this.bubble);

  this.flask.position.set(FLASK_X,TILE_TOP,.2);this.root.add(this.flask);
  this.flask.add(buildFlask());
  this.liquid=new T.Mesh(flaskLiquid(.2),new T.MeshStandardMaterial({color:WATER,transparent:true,opacity:.6,roughness:.15}));this.liquid.renderOrder=1;this.flask.add(this.liquid);
  this.patch=new T.Mesh(new T.CircleGeometry(.5,24),new T.MeshBasicMaterial({color:'#e22884',transparent:true,opacity:0,depthWrite:false}));this.patch.rotation.x=-Math.PI/2;this.patch.renderOrder=2;this.flask.add(this.patch);
  const pipette=buildPipette();pipette.position.set(3.3,BENCH_Y,-.3);pipette.scale.setScalar(.72);this.root.add(pipette);

  this.stream=new T.Mesh(new T.CylinderGeometry(.035,.035,1,8),new T.MeshBasicMaterial({color:TITRANT,transparent:true,opacity:.75}));this.stream.visible=false;this.root.add(this.stream);
  for(let i=0;i<DROPS;i++){const mesh=new T.Mesh(new T.SphereGeometry(.07,10,8),new T.MeshBasicMaterial({color:TITRANT,transparent:true,opacity:.85}));mesh.visible=false;this.root.add(mesh);this.drops.push({mesh,y:0,vy:0,on:false});}
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
  this.camera.aspect=this.width/this.height;
  // The bench is about 11 units tall and 9 wide, so the camera backs off until both fit.
  this.camera.position.z=Math.max(6.2/HALF_TAN,5/(HALF_TAN*this.camera.aspect));
  this.applyCamera();
  if(!this.contextLost)this.renderer.render(this.scene,this.camera);
 }
 private applyCamera(){this.camera.zoom=this.baseZoom*this.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();}
 setFocus(_on:boolean){}
 setPose(view:MirrorViewState){
  if(this.disposed)return;
  this.root.quaternion.fromArray(view.q).normalize();this.root.position.set(view.x,view.y,0);this.root.updateMatrixWorld(true);
  this.zoom=Math.min(3,Math.max(.4,view.zoom));
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
 partAt(_:WorldPoint){return -1;}
 /** Where a world point lands on the stage, in CSS pixels. Read by tests. */
 screenOf(p:WorldPoint){v.set(p.x,p.y,p.z).project(this.camera);return {x:(v.x+1)*this.width/2,y:(1-v.y)*this.height/2};}

 draw(scene:TitrationScene,now:number){
  if(this.disposed||this.contextLost)return;
  const dt=this.lastTime?Math.min(.05,(now-this.lastTime)/1000):.016;this.lastTime=now;
  const calm=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Zoom to the burette: the camera slides to the meniscus and closes in.
  this.focusAmount+=((scene.focus?1:0)-this.focusAmount)*(calm?1:1-Math.exp(-dt*6));
  const yLevel=buretteY(scene.reading),f=this.focusAmount;
  this.baseZoom=lerp(1,3.4,f);
  this.camera.position.x=lerp(0,BURETTE.x,f);this.camera.position.y=lerp(CAMERA_Y,yLevel-.1,f);this.applyCamera();

  // Burette: titrant from the level down to the tip.
  const top=yLevel,bottom=BURETTE.tip+.3,height=Math.max(.001,top-bottom);
  this.buretteLiquid.visible=scene.filled;this.buretteLiquid.scale.y=height;this.buretteLiquid.position.set(BURETTE.x,bottom+height/2,0);
  this.bubble.visible=scene.filled&&scene.bubble;
  this.key.rotation.y=scene.tap*Math.PI/2;
  this.shownReading=scene.reading;

  // Flask: level, colour, the local patch, and the swirl.
  this.flask.visible=scene.flask.present;
  const level=flaskLevel(scene.flask.volume);
  if(Math.abs(level-this.liquidLevel)>.004){this.liquid.geometry.dispose();this.liquid.geometry=flaskLiquid(level);this.liquidLevel=level;}
  const tint=new T.Color(scene.flask.rgb[0]/255,scene.flask.rgb[1]/255,scene.flask.rgb[2]/255);
  this.liquid.material.color.copy(WATER).lerp(tint,Math.min(1,scene.flask.alpha*2.2));
  this.liquid.material.opacity=.5+.3*scene.flask.alpha;
  this.patch.position.y=level+.01;this.patch.scale.setScalar(.5+.5*Math.min(1,scene.flask.volume/80));
  this.patch.material.color.setRGB(scene.flask.localRgb[0]/255,scene.flask.localRgb[1]/255,scene.flask.localRgb[2]/255);
  this.patch.material.opacity=scene.flask.localAlpha*.8;
  const t=now/1000,sw=calm?0:scene.swirl;
  this.flask.position.x=FLASK_X+Math.cos(t*11)*.16*sw;this.flask.position.z=.2+Math.sin(t*11)*.16*sw;

  // Stream and drops.
  const surface=TILE_TOP+level,tipY=BURETTE.tip,tapOpen=scene.tap>0&&scene.filled;
  this.stream.visible=scene.streaming&&tapOpen&&scene.flask.present;
  if(this.stream.visible){const len=tipY-surface;this.stream.scale.y=Math.max(.01,len);this.stream.position.set(BURETTE.x,surface+len/2,.2);}
  if(scene.dropCount>this.lastDropCount&&!scene.streaming){
   const spawn=Math.min(3,scene.dropCount-this.lastDropCount);
   for(let k=0;k<spawn;k++){const d=this.drops.find(x=>!x.on);if(d){d.on=true;d.y=tipY-k*.3;d.vy=0;d.mesh.visible=true;}}
  }
  this.lastDropCount=scene.dropCount;
  for(const d of this.drops){
   if(!d.on)continue;
   d.vy-=GRAVITY*dt;d.y+=d.vy*dt;
   if(d.y<=surface||!scene.flask.present){d.on=false;d.mesh.visible=false;continue;}
   d.mesh.position.set(BURETTE.x,d.y,.2);
  }
  this.renderer.render(this.scene,this.camera);
 }
 /** Read by tests: the world y of the burette reading line. */
 get readingY(){return buretteY(this.shownReading);}
 get liquidColour(){return '#'+this.liquid.material.color.getHexString();}
 get dropsFalling(){return this.drops.filter(d=>d.on).length;}
 dispose(){
  if(this.disposed)return;
  this.disposed=true;this.resizeObserver.disconnect();
  this.renderer.domElement.removeEventListener('webglcontextlost',this.onContextLost);this.renderer.domElement.removeEventListener('webglcontextrestored',this.onContextRestored);
  this.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();const m=o.material as T.Material|T.Material[];(Array.isArray(m)?m:[m]).forEach(x=>x.dispose());}});
  this.renderer.dispose();this.renderer.domElement.remove();this.scene.clear();
 }
}
