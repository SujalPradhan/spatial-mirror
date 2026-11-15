import * as T from 'three';
import {mirrorToStage} from '../mirror/projection';
import type {MirrorPoint,MirrorViewState,WorldPoint} from '../mirror/contracts';
import type {TitrationScene,TitrationView} from './contracts';
import {BEAKER,BENCH_Y,BURETTE,DROPPER_TINT,TILE_TOP,buildBeaker,buildBottle,buildBurette,buildDropper,buildFlask,buildFunnel,buildGoggles,buildPipette,buildStand,buretteY,flaskLevel,flaskLiquid,graduationTexture,labelTexture} from './glassware';
import {ACID,FLASK as FLASK_AT,FUNNEL,propById} from './props';

const ACCENT='#7fd4ff',WASTE_TOP=TILE_TOP+BEAKER.waste.h,FLASK_X=0,DROPS=10,GRAVITY=26,CAMERA_Y=1.45,HALF_TAN=Math.tan(18.5*Math.PI/180);
const WATER=new T.Color('#d8e8f2'),TITRANT=new T.Color('#cfe6f6');
const v=new T.Vector3();
const propLabel=(id:string)=>id==='dropper-phenolphthalein'?'Phenolphthalein':id==='dropper-methyl-orange'?'Methyl orange':'Universal';
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
 private readonly propGroups=new Map<string,T.Group>();
 private readonly rings=new Map<string,T.Mesh>();
 private readonly zoneRings:T.Mesh[]=[];private readonly cursorRings:T.Mesh[]=[];
 private readonly labels=new Map<string,T.Sprite>();
 private readonly waste:T.Group;private readonly acid:T.Group;private readonly pourStream:T.Mesh;
 private cam={x:0,y:CAMERA_Y,zoom:1};private baseZoom=1;private zoom=1;
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
  const funnel=buildFunnel();funnel.position.set(BURETTE.x,BURETTE.top-.1,0);this.root.add(funnel);
  this.waste=buildBeaker(BEAKER.waste.r,BEAKER.waste.h,'#cfe6f6');this.waste.position.set(FLASK_X,TILE_TOP,.2);this.root.add(this.waste);
  this.acid=buildBeaker(BEAKER.acid.r,BEAKER.acid.h,'#e4eef6');this.acid.position.set(ACID.x,BENCH_Y,.5);this.root.add(this.acid);
  this.pourStream=new T.Mesh(new T.CylinderGeometry(.05,.05,1,8),new T.MeshBasicMaterial({color:TITRANT,transparent:true,opacity:.8}));this.pourStream.visible=false;this.root.add(this.pourStream);
  const ringMat=(o:number)=>new T.MeshBasicMaterial({color:ACCENT,transparent:true,opacity:o,depthTest:false,side:T.DoubleSide});
  for(let i=0;i<4;i++){const z=new T.Mesh(new T.RingGeometry(.97,1,48),ringMat(.7));z.renderOrder=9;z.visible=false;z.position.z=.8;this.root.add(z);this.zoneRings.push(z);}
  for(let i=0;i<2;i++){const c=new T.Mesh(new T.RingGeometry(.2,.28,24),new T.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.9,depthTest:false}));c.renderOrder=10;c.visible=false;c.position.z=1.2;this.root.add(c);this.cursorRings.push(c);}

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
  this.layoutCamera();
  if(!this.contextLost)this.renderer.render(this.scene,this.camera);
 }
 /** Pixels at the top and bottom of the stage that cards cover; the bench is framed in the clear space between. */
 setInsets(top:number,bottom:number){this.insetGoal={top:Math.max(0,top),bottom:Math.max(0,bottom)};}
 private inset={top:0,bottom:0};private insetGoal={top:0,bottom:0};
 private layoutCamera(){
  const h=Math.max(60,this.height-this.inset.top-this.inset.bottom),w=this.width;
  this.camera.aspect=w/h;
  // The bench is about 11 units tall and 9 wide, so the camera backs off until both fit.
  this.camera.position.z=Math.max(6.2/HALF_TAN,5/(HALF_TAN*this.camera.aspect));
  this.camera.setViewOffset(w,h,0,-this.inset.top,w,this.height);
  this.applyCamera();
 }
 private applyCamera(){this.camera.zoom=this.baseZoom*this.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();}
 setPose(view:MirrorViewState){
  if(this.disposed)return;
  this.root.position.set(view.x,view.y,0);this.root.updateMatrixWorld(true);
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
  const yLevel=buretteY(scene.reading),st=scene.station;
  // The camera glides to the step's station, and never closer than keeps its half width in view.
  const hw=this.camera.position.z*HALF_TAN*this.camera.aspect,goal=Math.min(st.zoom,hw/st.wide),k=calm?1:1-Math.exp(-dt*5);
  this.cam.x+=(st.x-this.cam.x)*k;this.cam.y+=(st.y-this.cam.y)*k;this.cam.zoom+=(goal-this.cam.zoom)*k;
  const ik=calm?1:1-Math.exp(-dt*6);
  for(const side of ['top','bottom'] as const){const d=this.insetGoal[side]-this.inset[side];this.inset[side]=Math.abs(d)<.5?this.insetGoal[side]:this.inset[side]+d*ik;}
  this.layoutCamera();
  this.baseZoom=this.cam.zoom;this.camera.position.x=this.cam.x;this.camera.position.y=this.cam.y;this.applyCamera();
  this.drawProps(scene,now,calm);

  // Burette: titrant from the level down to the tip.
  const top=yLevel,bottom=BURETTE.tip+.3,height=Math.max(.001,top-bottom);
  this.buretteLiquid.visible=scene.filled;this.buretteLiquid.scale.y=height;this.buretteLiquid.position.set(BURETTE.x,bottom+height/2,0);
  this.bubble.visible=scene.filled&&scene.bubble;
  this.key.rotation.y=scene.tap*Math.PI/2;
  this.shownReading=scene.reading;

  // Flask: level, colour, the local patch, and the swirl.
  this.flask.visible=scene.flask.present;this.waste.visible=!scene.flask.present;
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
  const surface=scene.flask.present?TILE_TOP+level:WASTE_TOP,tipY=BURETTE.tip,tapOpen=scene.tap>0&&scene.filled;
  this.stream.visible=scene.streaming&&tapOpen;
  if(this.stream.visible){const len=tipY-surface;this.stream.scale.y=Math.max(.01,len);this.stream.position.set(BURETTE.x,surface+len/2,.2);}
  if(scene.dropCount>this.lastDropCount&&!scene.streaming){
   const spawn=Math.min(3,scene.dropCount-this.lastDropCount);
   for(let k=0;k<spawn;k++){const d=this.drops.find(x=>!x.on);if(d){d.on=true;d.y=tipY-k*.3;d.vy=0;d.mesh.visible=true;}}
  }
  this.lastDropCount=scene.dropCount;
  for(const d of this.drops){
   if(!d.on)continue;
   d.vy-=GRAVITY*dt;d.y+=d.vy*dt;
   if(d.y<=surface){d.on=false;d.mesh.visible=false;continue;}
   d.mesh.position.set(BURETTE.x,d.y,.2);
  }
  this.renderer.render(this.scene,this.camera);
 }
 private buildProp(id:string):T.Group{
  const g=id==='goggles'?buildGoggles():id==='bottle'?buildBottle():id==='pipette'?buildPipette():buildDropper(DROPPER_TINT[id]);
  if(id==='pipette'){
   g.scale.setScalar(.72);
   const fill=new T.Mesh(new T.SphereGeometry(.34,16,12),new T.MeshStandardMaterial({color:'#e4eef6',transparent:true,opacity:.75}));fill.name='fill';fill.position.y=2.2;g.add(fill);
  }
  const def=propById(id),ring=new T.Mesh(new T.RingGeometry(.96,1,48),new T.MeshBasicMaterial({color:ACCENT,transparent:true,opacity:.8,depthTest:false,side:T.DoubleSide}));
  const unit=id==='pipette'?1/.72:1;
  ring.scale.set((def.r+(id.startsWith('dropper')?.1:.4))*unit,(def.half+.35)*unit,1);ring.position.set(0,def.half*unit,.8);ring.renderOrder=9;g.add(ring);this.rings.set(id,ring);
  const text=id.startsWith('dropper')?propLabel(id):id==='pipette'?'25.0 cm3 pipette':id==='bottle'?'Sodium hydroxide':'Goggles';
  const sprite=new T.Sprite(new T.SpriteMaterial({map:labelTexture([text],id.startsWith('dropper')?330:300,64,'#0d2238','rgba(246,248,251,.95)',32),depthTest:false,transparent:true}));
  sprite.scale.set(2.2,.48,1);sprite.renderOrder=11;this.labels.set(id,sprite);
  const left=def.home.x<-2,right=def.home.x>3;sprite.center.set(left?.1:right?.9:.5,.5);
  sprite.position.set(0,(def.half*2+.6+(id.startsWith('dropper')?['dropper-phenolphthalein','dropper-methyl-orange','dropper-universal'].indexOf(id)*.6:0))*unit,.9);
  if(unit!==1)sprite.scale.set(2.2*unit,.48*unit,1);
  g.add(sprite);
  g.position.z=.7;this.root.add(g);this.propGroups.set(id,g);return g;
 }
 private drawProps(scene:TitrationScene,now:number,calm:boolean){
  const pulse=calm?.8:.65+.35*Math.sin(now/260);
  const seen=new Set<string>();
  for(const p of scene.props){
   seen.add(p.id);
   const g=this.propGroups.get(p.id)??this.buildProp(p.id),def=propById(p.id),unit=p.id==='pipette'?.72:1;
   g.visible=true;g.position.set(p.x,p.y-def.half,.7);g.rotation.z=p.tilt;
   if(p.id!=='pipette')g.scale.setScalar(1);
   const ring=this.rings.get(p.id)!,label=this.labels.get(p.id)!;
   ring.visible=p.glow>0;(ring.material as T.MeshBasicMaterial).opacity=p.glow*pulse;label.visible=p.glow>0&&p.tilt===0;
   const fill=g.getObjectByName('fill');if(fill){fill.visible=p.fill>0;fill.scale.y=Math.max(.01,p.fill);}
   void unit;
  }
  for(const [id,g] of this.propGroups)if(!seen.has(id))g.visible=false;
  scene.zones.forEach((z,i)=>{const r=this.zoneRings[i];if(!r)return;r.visible=true;r.position.set(z.x,z.y,.8);r.scale.set(z.r,z.r,1);(r.material as T.MeshBasicMaterial).opacity=.35+.4*pulse;});
  for(let i=scene.zones.length;i<this.zoneRings.length;i++)this.zoneRings[i].visible=false;
  this.cursorRings.forEach((c,i)=>{const h=scene.cursors[i];c.visible=!!h;if(h){c.position.set(h.x,h.y,1.2);c.scale.setScalar(h.pinch?.7:1.2);(c.material as T.MeshBasicMaterial).opacity=h.pinch?1:.6;}});
  const wasteLiquid=this.waste.getObjectByName('liquid')!,acidLiquid=this.acid.getObjectByName('liquid')!;
  wasteLiquid.visible=scene.waste>.01;wasteLiquid.scale.y=Math.max(.01,scene.waste*BEAKER.waste.h*.5);wasteLiquid.position.y=wasteLiquid.scale.y/2+.03;
  acidLiquid.scale.y=BEAKER.acid.h*.55*scene.acid;acidLiquid.position.y=acidLiquid.scale.y/2+.03;
  this.acid.visible=scene.props.some(p=>p.id==='pipette');
  const pour=scene.pour;this.pourStream.visible=!!pour;
  if(pour){const bottom=FUNNEL.y+.9,len=Math.max(.05,pour.y-bottom);this.pourStream.scale.y=len;this.pourStream.position.set(pour.x,bottom+len/2,.7);}
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
