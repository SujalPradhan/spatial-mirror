import * as T from 'three';

/** A product-photography set in HDR values: a dark room, one wide softbox overhead, tall strips either side and a thin rim behind. Facets and gold only look expensive when there is something bright to reflect. */
function softboxes(renderer:T.WebGLRenderer) {
 const scene=new T.Scene(),panel=(w:number,h:number,at:[number,number,number],rgb:[number,number,number])=>{
  const m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color:new T.Color(...rgb),side:T.DoubleSide}));
  m.position.set(...at);m.lookAt(0,0,0);scene.add(m);
 };
 scene.add(new T.Mesh(new T.BoxGeometry(24,14,24),new T.MeshBasicMaterial({color:new T.Color(.016,.014,.013),side:T.BackSide})));
 panel(7,7,[0,6.8,1],[3.2,3,2.8]);
 panel(.6,9,[-8,1,3],[3.6,3,2.4]);
 panel(.35,9,[-7.6,1,-1],[2.4,2,1.7]);
 panel(1.2,9,[8,.5,2],[3.6,4.4,5.4]);
 panel(10,.7,[0,3,-9],[6,5.2,4.4]);
 panel(5,2,[2,-3,8],[.5,.46,.42]);
 panel(.7,.7,[-4,4,6],[14,13,12]);
 const pmrem=new T.PMREMGenerator(renderer),texture=pmrem.fromScene(scene,.02).texture;
 pmrem.dispose();scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});
 return texture;
}
const backdropVert=/* glsl */`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
/** Only the refraction sees the full set: on stage it is a faint halo, so the mirror stays visible round the bottle. */
const backdropFrag=/* glsl */`
uniform float uShow,uTime;uniform vec3 uTint;varying vec2 vUv;
float strip(float x,float c,float w){return smoothstep(w,0.,abs(x-c));}
void main(){
 vec2 p=vUv*2.-1.;p.x*=1.5;
 float r=length(p*vec2(1.,.8));
 // A pale seamless sweep behind the glass: clear crystal looks bright only if what it bends is bright.
 vec3 c=mix(vec3(.3,.295,.29),vec3(.02,.02,.022),smoothstep(.04,.42,abs(p.x)))*mix(1.,.35,smoothstep(.4,1.2,abs(p.y)));
 float sweep=sin(uTime*.23)*.18;
 c+=vec3(1.,.93,.84)*strip(p.x,-.3+sweep,.03)*smoothstep(.95,.1,abs(p.y))*2.2;
 c+=vec3(.82,.9,1.)*strip(p.x,.34+sweep*.6,.025)*smoothstep(.9,.2,abs(p.y))*1.6;
 for(int i=0;i<5;i++){float f=float(i);vec2 b=vec2(sin(f*2.3+1.)*.9,cos(f*1.7)*.55);c+=vec3(1.,.95,.88)*smoothstep(.13,.1,length(p-b))*.12;}
 float halo=smoothstep(1.,0.,r)*.22;
 gl_FragColor=uShow>.5?vec4(c,1.):vec4(mix(vec3(1.,.82,.55),uTint,.4)*halo*.55,0.);
}`;
const floorVert=/* glsl */`varying vec2 vP;void main(){vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
/** Light pooled through the glass: a soft tinted ellipse, rays as many as the facets, and a dark contact shadow. */
const floorFrag=/* glsl */`
uniform vec3 uTint;uniform float uSides,uTime,uFade,uStretch;varying vec2 vP;
void main(){
 vec2 p=vP/vec2(uStretch,1.);float r=length(p),a=atan(p.y,p.x);
 float shadow=smoothstep(26.,14.,r);
 float pool=smoothstep(64.,10.,length(vP-vec2(10.,8.)))*.55;
 float rays=pow(max(0.,cos(a*uSides+sin(r*.12-uTime*.5)*.6)),6.)*smoothstep(70.,22.,r)*smoothstep(15.,24.,r);
 float ring=smoothstep(2.,0.,abs(r-24.-sin(uTime*.4)*.8))*.5;
 vec3 c=uTint*(pool+rays*.9+ring);
 float glow=clamp(pool*.6+rays*.7+ring,0.,1.);
 gl_FragColor=vec4(c*uFade,(shadow*.55*(1.-glow)+glow*.5)*uFade);
}`;

export interface StudioLooks {
 glass:T.MeshPhysicalMaterial;liquid:T.MeshPhysicalMaterial;cap:T.MeshPhysicalMaterial;collar:T.MeshPhysicalMaterial;actuator:T.MeshPhysicalMaterial;
}
const GOLD='#f3cf86';
/** Lights, reflections, the set seen through the glass, the floor glow and the luxury materials. Knows nothing about the pump. */
export class Studio {
 readonly looks:StudioLooks;
 readonly liquidTint={uDeep:{value:new T.Color()},uLight:{value:new T.Color()},uAlpha:{value:.72}};
 private readonly env:T.Texture;
 private readonly backdrop:T.Mesh<T.PlaneGeometry,T.ShaderMaterial>;
 readonly floor:T.Mesh<T.PlaneGeometry,T.ShaderMaterial>;
 private readonly sweep=new T.DirectionalLight('#fff3e2',1.1);
 private readonly back=new T.DirectionalLight('#ffd9a8',1.6);
 private clock=0;
 constructor(renderer:T.WebGLRenderer,private readonly scene:T.Scene,clips:T.Plane[]) {
  // One transmission pass, at reduced resolution: the glass blurs what it bends anyway, and it is the costliest pass.
  renderer.transmissionResolutionScale=.5;
  this.env=softboxes(renderer);scene.environment=this.env;scene.environmentIntensity=1;
  this.back.position.set(-5,3,-7);this.sweep.position.set(4,5,6);scene.add(this.back,this.sweep);
  const physical=(p:T.MeshPhysicalMaterialParameters)=>new T.MeshPhysicalMaterial({clippingPlanes:clips,clipShadows:false,...p});
  const gold=()=>physical({color:GOLD,metalness:1,roughness:.17,envMapIntensity:1.5,emissive:GOLD,emissiveIntensity:0});
  const liquid=physical({color:'#ffffff',roughness:.06,envMapIntensity:.9,transparent:false,depthWrite:false,blending:T.CustomBlending,blendSrc:T.SrcAlphaFactor,blendDst:T.OneMinusSrcAlphaFactor,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneMinusSrcAlphaFactor});
  // In the opaque list, so the transmission pass sees it through the glass; blended, so the dip tube shows through it.
  liquid.onBeforeCompile=s=>{
   Object.assign(s.uniforms,this.liquidTint);
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying float vLevel;varying vec3 vObjN;').replace('#include <begin_vertex>','#include <begin_vertex>\nvLevel=position.y;vObjN=normal;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 uDeep,uLight;uniform float uAlpha;varying float vLevel;varying vec3 vObjN;')
    .replace('#include <color_fragment>','#include <color_fragment>\nfloat lv=smoothstep(4.,66.,vLevel);vec3 juice=mix(uDeep,uLight,lv);diffuseColor.rgb=juice;diffuseColor.a=uAlpha*mix(1.,.62,lv);')
    .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=juice*(.12+.9*smoothstep(.55,.98,vObjN.y));');
  };
  this.looks={
   glass:physical({color:'#ffffff',metalness:0,roughness:0,transmission:1,ior:1.45,thickness:1.2,dispersion:.45,iridescence:.28,iridescenceIOR:1.32,iridescenceThicknessRange:[160,420],attenuationColor:'#ffffff',attenuationDistance:12,specularIntensity:1,specularColor:'#ffffff',clearcoat:1,clearcoatRoughness:0,envMapIntensity:2.2}),
   liquid,
   // Polished gold on the tower and the pebble, black lacquer on the prism: the view blends between them.
   cap:physical({color:GOLD,metalness:1,roughness:.12,clearcoat:0,clearcoatRoughness:.04,envMapIntensity:1.6,emissive:GOLD,emissiveIntensity:0}),
   collar:gold(),actuator:gold(),
  };
  this.backdrop=new T.Mesh(new T.PlaneGeometry(44,28),new T.ShaderMaterial({vertexShader:backdropVert,fragmentShader:backdropFrag,uniforms:{uShow:{value:0},uTime:{value:0},uTint:{value:new T.Color()}},depthWrite:false,transparent:false,blending:T.CustomBlending,blendSrc:T.OneFactor,blendDst:T.OneMinusSrcAlphaFactor,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneMinusSrcAlphaFactor,toneMapped:false}));
  this.backdrop.renderOrder=-100;this.backdrop.frustumCulled=false;
  // The transmission pass draws into a render target; the stage pass draws to the canvas.
  this.backdrop.onBeforeRender=r=>{const show=r.getRenderTarget()?1:0,u=this.backdrop.material.uniforms.uShow;if(u.value!==show){u.value=show;this.backdrop.material.uniformsNeedUpdate=true;}};
  scene.add(this.backdrop);
  this.floor=new T.Mesh(new T.PlaneGeometry(190,190),new T.ShaderMaterial({vertexShader:floorVert,fragmentShader:floorFrag,uniforms:{uTint:{value:new T.Color()},uSides:{value:8},uTime:{value:0},uFade:{value:1},uStretch:{value:1}},transparent:true,depthWrite:false,toneMapped:false}));
  this.floor.rotation.x=-Math.PI/2;this.floor.position.y=-7.4;this.floor.renderOrder=1;
 }
 /** t is seconds, still freezes the light sweep for reduced motion. */
 update(dt:number,still:boolean,o:{x:number;y:number;tint:T.Color;sides:number;stretch:number;floor:number}) {
  if(!still)this.clock+=dt;
  const t=this.clock;
  // The sweep: reflections drift slowly across the facets, the way a turntable shot catches light.
  this.scene.environmentRotation.set(0,Math.sin(t*.11)*.7,0);
  this.sweep.position.set(Math.cos(t*.3)*7,4+Math.sin(t*.21),Math.sin(t*.3)*3+5);
  const b=this.backdrop.material.uniforms;b.uTime.value=t;b.uTint.value.copy(o.tint);this.backdrop.position.set(o.x,o.y,-4.5);
  const f=this.floor.material.uniforms;f.uTint.value.copy(o.tint);f.uSides.value=o.sides;f.uTime.value=t;f.uFade.value=o.floor;f.uStretch.value=o.stretch;
  this.floor.visible=o.floor>.01;
 }
 dispose(){this.env.dispose();Object.values(this.looks).forEach(m=>m.dispose());}
}
