import * as T from 'three';
import type {HandPose,HandSide,MirrorField,MirrorHandView,MirrorLabel,MirrorShock,WorldPoint} from './contracts';

const MAX_HANDS=4,HAND_CAPSULES=MAX_HANDS*42,RINGS=5,SHOCK_LIFE=1.5,SHOCK_SPEED=6.5;
const HAND_BONES=[0,1,1,2,2,3,3,4,0,5,5,6,6,7,7,8,5,9,9,10,10,11,11,12,9,13,13,14,14,15,15,16,13,17,17,18,18,19,19,20,0,17];
const poseTint:Record<HandPose,T.Color>={none:new T.Color('#9fb4c8'),open:new T.Color('#9ff4ff'),fist:new T.Color('#ff8a4c'),pinch:new T.Color('#ffd76a'),point:new T.Color('#8cff9f'),victory:new T.Color('#ff7be0'),thumbUp:new T.Color('#c8ff6a'),thumbDown:new T.Color('#ff6470'),love:new T.Color('#ff9fc4')};
const sideTint:Record<HandSide,T.Color>={left:new T.Color('#b8d4ff'),right:new T.Color('#ffe4c4'),unknown:new T.Color('#ffffff')};
const capsuleVert=/* glsl */`
attribute vec3 aA,aB,aColor;attribute vec2 aStyle;uniform vec2 uRes;
varying vec2 vL;varying vec3 vColor;varying vec3 vStyle;
void main(){
 vec4 a=projectionMatrix*viewMatrix*vec4(aA,1.),b=projectionMatrix*viewMatrix*vec4(aB,1.);
 vec2 pa=a.xy/a.w*uRes*.5,pb=b.xy/b.w*uRes*.5,d=pb-pa;
 float l=length(d),pad=aStyle.x*5.+3.;
 vec2 t=l>.001?d/l:vec2(1.,0.),n=vec2(-t.y,t.x);
 vec2 px=(position.x<0.?pa:pb)+t*position.x*pad+n*position.y*pad;
 vL=vec2(dot(px-pa,t),dot(px-pa,n));vColor=aColor;vStyle=vec3(aStyle,l);
 vec4 c=position.x<0.?a:b;
 gl_Position=vec4(px/(uRes*.5),c.z/c.w,1.);
}`;
const capsuleFrag=/* glsl */`
varying vec2 vL;varying vec3 vColor;varying vec3 vStyle;
void main(){
 float d=length(vec2(vL.x-clamp(vL.x,0.,vStyle.z),vL.y)),w=vStyle.x;
 float core=1.-smoothstep(w-.7,w+.7,d),glow=exp(-d/(w*1.6+.8))*.5;
 vec3 c=vColor*(core+glow)*vStyle.y+vec3(1.)*core*.45*vStyle.y;
 gl_FragColor=vec4(c,min(1.,(core*.85+glow*.15)*vStyle.y));
}`;
const mix=new T.Color(),v=new T.Vector3();
const SVG='http://www.w3.org/2000/svg',AIMS=6,RETICLE_FAR=30,RETICLE_NEAR=13,ARM_R=26;
/** Pre-grab feedback, in world space. A reticle follows a closing pinch and locks gold on whatever it would take; a miss is a small ring where a pinch closed on nothing; arming fills while a held pose counts in. */
export interface MirrorAim {kind:'reticle'|'miss'|'arming';x:number;y:number;z:number;
 /** Reticle only: where a pinch closing now would take hold, when something is there. */
 target:WorldPoint|null;
 /** Reticle: 0 fingers apart to 1 closed. Miss: 0 to 1 through its fade. Arming: 0 to 1 filled. */
 amount:number}
export interface PartsOverlayScene {hands?:MirrorHandView[];label?:MirrorLabel|null;fields?:MirrorField[];shocks?:MirrorShock[];aims?:MirrorAim[]}

/** What hands add over a mesh object: the skeleton, a hover chip and rings for fields and shocks. Draws over the object, as the molecule's does. */
export class PartsOverlay {
 private readonly res={value:new T.Vector2(1,1)};
 private readonly data=new Float32Array(HAND_CAPSULES*11);
 private readonly buffer=new T.InstancedInterleavedBuffer(this.data,11).setUsage(T.DynamicDrawUsage);
 private readonly capsules:T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
 private readonly rings:T.Mesh<T.RingGeometry,T.MeshBasicMaterial>[]=[];
 private readonly chip=document.createElement('div');
 private readonly chipTitle=document.createElement('b');
 private readonly chipDetail=document.createElement('small');
 private count=0;
 constructor(scene:T.Scene,host:HTMLElement){
  const quad=new T.PlaneGeometry(2,2),g=new T.InstancedBufferGeometry();
  g.setIndex(quad.index);g.setAttribute('position',quad.attributes.position);
  g.setAttribute('aA',new T.InterleavedBufferAttribute(this.buffer,3,0));g.setAttribute('aB',new T.InterleavedBufferAttribute(this.buffer,3,3));
  g.setAttribute('aColor',new T.InterleavedBufferAttribute(this.buffer,3,6));g.setAttribute('aStyle',new T.InterleavedBufferAttribute(this.buffer,2,9));
  g.instanceCount=0;
  this.capsules=new T.Mesh(g,new T.ShaderMaterial({vertexShader:capsuleVert,fragmentShader:capsuleFrag,uniforms:{uRes:this.res},transparent:true,depthWrite:false,depthTest:false,side:T.DoubleSide,blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneMinusSrcAlphaFactor}));
  this.capsules.frustumCulled=false;this.capsules.visible=false;this.capsules.renderOrder=300;scene.add(this.capsules);
  for(let i=0;i<RINGS;i++){
   const ring=new T.Mesh(new T.RingGeometry(.97,1,72),new T.MeshBasicMaterial({transparent:true,depthWrite:false,depthTest:false,blending:T.AdditiveBlending,toneMapped:false,side:T.DoubleSide}));
   ring.visible=false;ring.renderOrder=299;scene.add(ring);this.rings.push(ring);
  }
  this.chip.className='mirror-chip';this.chip.hidden=true;this.chip.append(this.chipTitle,this.chipDetail);host.append(this.chip);
  // Screen-sized marks, so they stay finger-sized however far the object is scaled.
  this.marks.setAttribute('aria-hidden','true');this.marks.setAttribute('class','mirror-aims');
  this.marks.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:2';
  for(let i=0;i<AIMS;i++){
   const g=document.createElementNS(SVG,'g'),ring=document.createElementNS(SVG,'circle'),fill=document.createElementNS(SVG,'circle'),dot=document.createElementNS(SVG,'circle'),tether=document.createElementNS(SVG,'line');
   ring.setAttribute('fill','none');fill.setAttribute('fill','none');fill.setAttribute('stroke-linecap','round');dot.setAttribute('r','2.5');tether.setAttribute('stroke-dasharray','3 4');
   g.append(tether,ring,fill,dot);g.style.display='none';this.marks.append(g);this.aimEls.push({g,ring,fill,dot,tether});
  }
  host.append(this.marks);
 }
 private readonly marks=document.createElementNS(SVG,'svg');
 private readonly aimEls:{g:SVGGElement;ring:SVGCircleElement;fill:SVGCircleElement;dot:SVGCircleElement;tether:SVGLineElement}[]=[];
 private screen(p:WorldPoint,camera:T.Camera,width:number,height:number){v.set(p.x,p.y,p.z).project(camera);return {x:(v.x+1)*width/2,y:(1-v.y)*height/2};}
 private drawAims(aims:readonly MirrorAim[],camera:T.Camera,width:number,height:number){
  let n=0;
  for(const aim of aims){
   if(n>=AIMS)break;
   const e=this.aimEls[n++],at=this.screen(aim,camera,width,height),k=Math.max(0,Math.min(1,aim.amount));
   e.g.style.display='';
   const set=(el:Element,attrs:Record<string,string|number>)=>{for(const [a,b] of Object.entries(attrs))el.setAttribute(a,String(b));};
   if(aim.kind==='reticle'){
    const to=aim.target?this.screen(aim.target,camera,width,height):at,locked=!!aim.target,r=RETICLE_FAR-(RETICLE_FAR-RETICLE_NEAR)*k,color=locked?'#ffd76a':'#e8f4ff';
    // Locked, the ring jumps to the target and a dashed tether shows the pull from the fingers.
    set(e.ring,{cx:to.x,cy:to.y,r,stroke:color,'stroke-width':locked?2.2:1.4,'stroke-opacity':(locked?.6:.3)+.35*k});
    set(e.fill,{cx:to.x,cy:to.y,r:r+5,stroke:color,'stroke-width':locked?5:0,'stroke-opacity':locked?.18+.2*k:0,'stroke-dasharray':''});
    set(e.dot,{cx:to.x,cy:to.y,fill:color,'fill-opacity':locked?.95:.5});
    const far=Math.hypot(to.x-at.x,to.y-at.y)>4;
    set(e.tether,{x1:at.x,y1:at.y,x2:to.x,y2:to.y,stroke:color,'stroke-width':1.2,'stroke-opacity':far?.55:0});
   }else if(aim.kind==='miss'){
    set(e.ring,{cx:at.x,cy:at.y,r:9+14*k,stroke:'#ffb0a0','stroke-width':1.6,'stroke-opacity':.7*(1-k)});
    set(e.fill,{'stroke-opacity':0,'stroke-width':0});set(e.dot,{'fill-opacity':0});set(e.tether,{'stroke-opacity':0});
   }else{
    // A track and an arc filling clockwise from the top: hold still until it closes.
    const c=2*Math.PI*ARM_R;
    set(e.ring,{cx:at.x,cy:at.y,r:ARM_R,stroke:'#9ff4ff','stroke-width':3,'stroke-opacity':.22});
    set(e.fill,{cx:at.x,cy:at.y,r:ARM_R,stroke:'#9ff4ff','stroke-width':3.5,'stroke-opacity':.9,'stroke-dasharray':`${(c*k).toFixed(1)} ${c.toFixed(1)}`,transform:`rotate(-90 ${at.x.toFixed(1)} ${at.y.toFixed(1)})`});
    set(e.dot,{cx:at.x,cy:at.y,fill:'#9ff4ff','fill-opacity':.4+.5*k});set(e.tether,{'stroke-opacity':0});
   }
   if(aim.kind!=='arming')e.fill.removeAttribute('transform');
  }
  for(let i=n;i<AIMS;i++)this.aimEls[i].g.style.display='none';
 }
 private add(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number},width:number,gain:number){
  if(this.count>=HAND_CAPSULES)return;
  const d=this.data,i=this.count++*11;
  d[i]=a.x;d[i+1]=a.y;d[i+2]=a.z;d[i+3]=b.x;d[i+4]=b.y;d[i+5]=b.z;d[i+6]=mix.r;d[i+7]=mix.g;d[i+8]=mix.b;d[i+9]=width;d[i+10]=gain;
 }
 update(scene:PartsOverlayScene,camera:T.Camera,width:number,height:number){
  this.res.value.set(width,height);this.count=0;
  for(const hand of (scene.hands??[]).slice(0,MAX_HANDS)){
   const j=hand.joints;if(j.length<21)continue;
   mix.copy(poseTint[hand.pose]??poseTint.none).multiply(sideTint[hand.side]??sideTint.unknown);
   const gain=hand.active?1.25:.62,line=hand.active?1.5:1;
   for(let i=0;i<HAND_BONES.length;i+=2)this.add(j[HAND_BONES[i]],j[HAND_BONES[i+1]],line,gain);
   for(let i=0;i<21;i++)this.add(j[i],j[i],i>0&&i%4===0?3:2.1,gain+.3);
  }
  this.capsules.geometry.instanceCount=this.count;this.capsules.visible=this.count>0;if(this.count)this.buffer.needsUpdate=true;
  let r=0;
  const ring=(x:number,y:number,z:number,size:number,color:string,opacity:number)=>{if(r>=RINGS)return;const m=this.rings[r++];m.position.set(x,y,z);m.scale.setScalar(Math.max(.01,size));m.material.color.set(color);m.material.opacity=opacity;m.visible=true;};
  for(const f of scene.fields??[])ring(f.x,f.y,f.z,f.radius*.72,'#9ff4ff',f.strength*.5);
  for(const s of scene.shocks??[])ring(s.x,s.y,s.z,.2+s.age*SHOCK_SPEED,'#ffd9a0',Math.exp(-s.age*2.6)*(1-s.age/SHOCK_LIFE));
  for(;r<RINGS;r++)this.rings[r].visible=false;
  this.drawAims(scene.aims??[],camera,width,height);
  const label=scene.label;this.chip.hidden=!label;
  if(label){
   if(this.chipTitle.textContent!==label.title)this.chipTitle.textContent=label.title;
   if(this.chipDetail.textContent!==label.detail)this.chipDetail.textContent=label.detail;
   v.set(label.x,label.y,label.z).project(camera);
   this.chip.style.left=`${Math.round((v.x+1)*width/2)+14}px`;this.chip.style.top=`${Math.round((1-v.y)*height/2)}px`;
  }
 }
 dispose(){this.chip.remove();this.marks.remove();}
}
