import * as T from 'three';
import type {AtpComponent, AtpField, AtpHandView, AtpScene, AtpSkin, AtpStructureAsset, AtpViewState, AtpWorld, HandPose, HandSide, MirrorPoint, WorldPoint} from './contracts';

/** Where a mirror-space video point lands on an object-fit:cover stage, in 0..1 stage coords. */
export function mirrorToStage(x: number, y: number, videoAspect: number, stageAspect: number) {
  const video = videoAspect > 0 && Number.isFinite(videoAspect) ? videoAspect : stageAspect;
  // Cover crops the long axis symmetrically, so only the cropped axis stretches about its centre.
  return video > stageAspect
    ? {x: (x - .5) * video / stageAspect + .5, y}
    : {x, y: (y - .5) * stageAspect / video + .5};
}

const GAP = 5.2, MOLECULE_HEIGHT = 5.8, FADE_SECONDS = .3, PICK_RADIUS = .45, PICK_STRIDE = 6;
const BEAD_SIZE = .082, HALO_SIZE = .34, HALO_STRIDE = 6, TUBE_RADIUS = .052, TUBE_STEPS = 3, TUBE_SIDES = 6;
const MAX_HANDS = 4, HAND_CAPSULES = MAX_HANDS * 42, MAX_PROTONS = 256, MAX_ATP = 64, LIPIDS = 1100;
const THERMAL = .012;
// A cut along pure world x is edge-on to the camera and would hide the interior; this yaw keeps the
// plane vertical and on the slice x at z=0 while turning its face to the viewer. Set 0 for a literal x cut.
const SLICE_YAW = .62, CUT_X = Math.cos(SLICE_YAW), CUT_Z = Math.sin(SLICE_YAW);

const HAND_BONES = [0, 1, 1, 2, 2, 3, 3, 4, 0, 5, 5, 6, 6, 7, 7, 8, 5, 9, 9, 10, 10, 11, 11, 12, 9, 13, 13, 14, 14, 15, 15, 16, 13, 17, 17, 18, 18, 19, 19, 20, 0, 17];
const skins: AtpSkin[] = ['constellation', 'ribbon', 'solid'];
const haloGain: Record<AtpSkin, number> = {constellation: .05, ribbon: .07, solid: .05};
const poseTint: Record<HandPose, T.Color> = {
  none: new T.Color('#9fb4c8'), open: new T.Color('#9ff4ff'), fist: new T.Color('#ff8a4c'), pinch: new T.Color('#ffd76a'),
  point: new T.Color('#8cff9f'), victory: new T.Color('#ff7be0'), thumbUp: new T.Color('#c8ff6a'), thumbDown: new T.Color('#ff6470'), love: new T.Color('#ff9fc4'),
};
const sideTint: Record<HandSide, T.Color> = {left: new T.Color('#b8d4ff'), right: new T.Color('#ffe4c4'), unknown: new T.Color('#ffffff')};

/** Bioluminescent palette: complementary head subunits make the α3β3 alternation legible from any angle. */
function chainStyle(name: string, order: number) {
  const n = name.toLowerCase();
  if (n.includes('alpha')) return {color: '#3f9bff', out: 1.85, lift: .72, tilt: .46};
  if (n.includes('beta')) return {color: '#c264ff', out: 1.9, lift: 1.02, tilt: .56};
  if (n.includes('delta')) return {color: '#72f0b0', out: .9, lift: 1.05, tilt: 0};
  if (n.includes('gamma')) return {color: '#ff4a6b', out: 0, lift: .15, tilt: 0};
  if (n.includes('epsilon')) return {color: '#ff9440', out: 1.2, lift: -.25, tilt: .3};
  if (n.includes('subunit c')) return {color: order % 2 ? '#ffb648' : '#ff8a4e', out: 1.25, lift: -.75, tilt: .72};
  if (n.includes('subunit a')) return {color: '#27e3c4', out: 2.7, lift: -.45, tilt: -.25};
  return {color: '#4bd2f2', out: 2.7, lift: .25, tilt: -.14};
}

const quad = new T.PlaneGeometry(2, 2);

const deformGl = /* glsl */`
uniform float uTime,uJitter;uniform vec4 uField[2];uniform vec2 uFieldK;uniform vec4 uShock[3];
vec3 thermal(float s){return uJitter*vec3(sin(uTime*1.3+s*.9),sin(uTime*1.7+s*1.3+2.),sin(uTime*1.1+s*.7+4.));}
// World space, so hands read true whatever the rotor, explode or pose have done to the chain.
vec3 deform(vec3 p,inout float heat){
 for(int i=0;i<2;i++){
  float k=uFieldK[i];if(k==0.)continue;
  vec3 d=p-uField[i].xyz;float r=uField[i].w,l=length(d);
  if(l>=r)continue;
  float f=1.-l/r;f=f*f*(3.-2.*f)*k;
  vec3 n=d/(l+.001);
  p+=(n+.42*cross(n,vec3(.2,.4,1.)))*f*r*.5;heat+=f*.9;
 }
 for(int i=0;i<3;i++){
  float a=uShock[i].w;if(a<0.)continue;
  vec3 d=p-uShock[i].xyz;float l=length(d),e=exp(-a*2.6),w=(l-a*6.5)/(.34+a*.5),b=exp(-w*w)*e;
  p+=d/(l+.001)*b*.42;heat+=b;
 }
 return p;
}`;
const sliceGl = /* glsl */`
uniform vec2 uSlice;const vec3 cutN=vec3(${CUT_X.toFixed(5)},0.,${CUT_Z.toFixed(5)});
float cutSide(vec3 w){return dot(w-vec3(uSlice.y,0.,0.),cutN);}
float cutGlow(float s){return uSlice.x*smoothstep(-.17,0.,s);}`;

const beadVert = /* glsl */`
attribute vec3 aCenter;attribute vec2 aInfo;uniform float uSize,uFade;
varying vec2 vUv;varying vec3 vC,vW;varying float vHeat,vShade,vR;
${deformGl}
void main(){
 vec3 c=(modelMatrix*vec4(aCenter+thermal(aInfo.x),1.)).xyz;
 vHeat=0.;c=deform(c,vHeat);
 vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
#ifdef SOLID
 vR=uSize*uFade;float s=vR*1.08;
#else
 vR=uSize*(1.+min(vHeat,1.5)*.6);float s=vR;
#endif
 vUv=position.xy;vC=c;vShade=aInfo.y;
 vW=c+(right*position.x+up*position.y)*s;
 gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);
}`;
const beadFrag = /* glsl */`
uniform vec3 uTint;uniform float uGlow,uFade,uGain,uCore;
varying vec2 vUv;varying vec3 vC;varying float vHeat,vShade;
${sliceGl}
void main(){
 float r2=dot(vUv,vUv),s=cutSide(vC);
 if(r2>1.||(uSlice.x>0.&&s>0.))discard;
 float core=exp(-r2*7.)*uCore,halo=exp(-r2*3.2)*(1.-r2)*(1.-uCore*.8);
 float depth=clamp(.6+vC.z*.17,.22,1.15),rimCut=cutGlow(s);
 float a=(core+halo*.4)*uGain*uFade*(1.+uGlow*2.4)*(1.+min(vHeat,1.5)*.9)*mix(1.,vShade,uCore)*depth;
 // Heat and the cut shift hue toward ice rather than adding gain: dense regions must keep their colour.
 vec3 c=mix(uTint*(1.+uGlow*.5),vec3(.75,.93,1.),clamp(rimCut*.7+vHeat*.28,0.,.7))+vec3(1.)*core*core*.28;
 gl_FragColor=vec4(c*a,a*.4);
}`;
const lineVert = /* glsl */`
attribute float aPhase;varying vec3 vW;varying float vHeat;
${deformGl}
void main(){
 vec3 c=(modelMatrix*vec4(position+thermal(aPhase),1.)).xyz;
 vHeat=0.;vW=deform(c,vHeat);
 gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);
}`;
const lineFrag = /* glsl */`
uniform vec3 uTint;uniform float uGlow,uFade,uGain;varying vec3 vW;varying float vHeat;
${sliceGl}
void main(){
 float s=cutSide(vW);if(uSlice.x>0.&&s>0.)discard;
 float a=uGain*uFade*(1.+uGlow*2.5+vHeat*2.);
 vec3 c=uTint+vec3(.8,.95,1.)*cutGlow(s);
 gl_FragColor=vec4(c*a,a*.3);
}`;
const ribbonVert = /* glsl */`
attribute float aPhase;uniform float uRadius,uFade;varying vec3 vW,vN;varying float vHeat;
${deformGl}
void main(){
 vec3 p=position-normal*uRadius*(1.-uFade);
 vec3 c=(modelMatrix*vec4(p+thermal(aPhase),1.)).xyz;
 vHeat=0.;vW=deform(c,vHeat);
 vN=mat3(modelMatrix)*normal;
 gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);
}`;
const ribbonFrag = /* glsl */`
uniform vec3 uTint;uniform float uGlow;varying vec3 vW,vN;varying float vHeat;
${sliceGl}
void main(){
 float s=cutSide(vW);if(uSlice.x>0.&&s>0.)discard;
 vec3 n=normalize(vN),v=normalize(cameraPosition-vW);
 float nv=dot(n,v),cut=cutGlow(s);
 if(!gl_FrontFacing){gl_FragColor=vec4(uTint*1.2+vec3(.8,.95,1.)*.32,1.);return;}
 float diff=max(0.,dot(n,normalize(vec3(-.35,.6,.72)))),rim=pow(1.-max(nv,0.),2.4);
 vec3 c=uTint*(.2+.66*diff*diff)+mix(uTint,vec3(1.),.5)*rim*1.7+uTint*uGlow*.7+mix(uTint,vec3(1.),.5)*vHeat*.8+vec3(.8,.95,1.)*cut*.45;
 gl_FragColor=vec4(c,1.);
}`;
const solidFrag = /* glsl */`
uniform mat4 projectionMatrix;
uniform vec3 uTint;uniform float uGlow;
varying vec3 vC,vW;varying float vHeat,vShade,vR;
${sliceGl}
void main(){
 // Analytic spheres: smooth at a fraction of the triangles real meshes would need for 5000 beads.
 vec3 d=normalize(vW-cameraPosition),oc=cameraPosition-vC;
 float b=dot(oc,d),h=b*b-dot(oc,oc)+vR*vR;
 if(h<=0.)discard;
 h=sqrt(h);
 float t=-b-h,cap=0.;
 vec3 p=cameraPosition+d*t,n=(p-vC)/vR;
 if(uSlice.x>0.&&cutSide(p)>0.){
  // The ray entered in the removed half: show the sphere's section where it crosses the plane.
  float q=dot(d,cutN),u=q==0.?-1.:-cutSide(cameraPosition)/q;
  if(u<t||u>-b+h)discard;
  p=cameraPosition+d*u;n=cutN;cap=1.;
 }
 float diff=.5+.5*dot(n,normalize(vec3(-.35,.65,.68))),nv=max(dot(n,-d),0.),rim=pow(1.-nv,3.);
 float depth=clamp(.72+p.z*.1,.34,1.08),ao=mix(.3,1.,vShade*vShade);
 vec3 c=mix(uTint,vec3(1.),.14*diff)*(.16+.8*diff*diff)*ao*depth+mix(uTint,vec3(1.),.5)*rim*.8*ao;
 c+=uTint*uGlow*.6+mix(uTint,vec3(1.),.5)*vHeat*.7;
 c+=vec3(.8,.95,1.)*cutGlow(cutSide(p))*.22;
 if(cap>0.){float e=dot(p-vC,p-vC)/(vR*vR);c=uTint*1.1+vec3(.8,.95,1.)*e*e*e*.75;}
 vec4 clip=projectionMatrix*viewMatrix*vec4(p,1.);
 gl_FragDepth=.5+.5*clip.z/clip.w;
 gl_FragColor=vec4(c,1.);
}`;
const lipidVert = /* glsl */`
attribute float aSeed;uniform float uTime,uPx,uMotion;varying float vA;varying vec3 vW;
void main(){
 float t=uTime*uMotion,r=length(position.xz);
 vec3 p=position;p.y+=sin(t*1.1+aSeed*6.)*.018+sin(r*2.4-t*.8)*.012;
 vec4 w=modelMatrix*vec4(p,1.),mv=viewMatrix*w;
 vW=w.xyz;
 vA=(.35+.65*(.5+.5*sin(t*1.7+aSeed*23.)))*smoothstep(3.3,2.3,r)*smoothstep(.95,1.2,r);
 gl_PointSize=uPx*(.028+.02*fract(aSeed*7.))/-mv.z;
 gl_Position=projectionMatrix*mv;
}`;
const lipidFrag = /* glsl */`
varying float vA;varying vec3 vW;
${sliceGl}
void main(){
 if(uSlice.x>0.&&cutSide(vW)>0.)discard;
 vec2 p=gl_PointCoord*2.-1.;float r2=dot(p,p);if(r2>1.)discard;
 float a=exp(-r2*3.5)*vA*.34;
 gl_FragColor=vec4(vec3(.42,.78,.86)*a,a*.15);
}`;
const planeVert = /* glsl */`
varying vec2 vUv;
void main(){vUv=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const planeFrag = /* glsl */`
uniform float uAmount;varying vec2 vUv;
void main(){
 float e=(1.-smoothstep(.6,1.,abs(vUv.x)))*(1.-smoothstep(.6,1.,abs(vUv.y)));
 vec2 g=abs(fract(vUv*11.)-.5);
 float grid=smoothstep(.47,.5,max(g.x,g.y));
 float a=e*uAmount*(.03+.04*grid);
 gl_FragColor=vec4(vec3(.55,.9,1.)*a,a*.5);
}`;
const capsuleVert = /* glsl */`
attribute vec3 aA,aB,aColor;attribute vec2 aStyle;uniform vec2 uRes;
varying vec2 vL;varying vec3 vColor;varying vec3 vStyle;
void main(){
 // Thick lines in pixels: GL lines are one device pixel on most laptops.
 vec4 a=projectionMatrix*viewMatrix*vec4(aA,1.),b=projectionMatrix*viewMatrix*vec4(aB,1.);
 vec2 pa=a.xy/a.w*uRes*.5,pb=b.xy/b.w*uRes*.5,d=pb-pa;
 float l=length(d),pad=aStyle.x*5.+3.;
 vec2 t=l>.001?d/l:vec2(1.,0.),n=vec2(-t.y,t.x);
 vec2 px=(position.x<0.?pa:pb)+t*position.x*pad+n*position.y*pad;
 vL=vec2(dot(px-pa,t),dot(px-pa,n));vColor=aColor;vStyle=vec3(aStyle,l);
 vec4 c=position.x<0.?a:b;
 gl_Position=vec4(px/(uRes*.5),c.z/c.w,1.);
}`;
const capsuleFrag = /* glsl */`
varying vec2 vL;varying vec3 vColor;varying vec3 vStyle;
void main(){
 float d=length(vec2(vL.x-clamp(vL.x,0.,vStyle.z),vL.y)),w=vStyle.x;
 float core=1.-smoothstep(w-.7,w+.7,d),glow=exp(-d/(w*1.6+.8))*.5;
 vec3 c=vColor*(core+glow)*vStyle.y+vec3(1.)*core*.45*vStyle.y;
 gl_FragColor=vec4(c,min(1.,(core*.85+glow*.15)*vStyle.y));
}`;
const atpVert = /* glsl */`
attribute vec3 aCenter;attribute vec2 aInfo;uniform float uTime;
varying vec2 vUv;varying vec2 vI;
void main(){
 vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
 float a=uTime*.8+aInfo.y;vec2 q=position.xy;
 vUv=mat2(cos(a),-sin(a),sin(a),cos(a))*q;
 // Foreshortening fakes a tumble out of the billboard plane.
 vUv.y/=.72+.28*cos(uTime*.53+aInfo.y*2.);
 vI=aInfo;
 gl_Position=projectionMatrix*viewMatrix*vec4(aCenter+(right*q.x+up*q.y)*.3,1.);
}`;
const atpFrag = /* glsl */`
varying vec2 vUv;varying vec2 vI;
float bead(vec2 p,vec2 c,float r){vec2 d=(p-c)/r;return exp(-dot(d,d)*1.3);}
void main(){
 vec2 p=vUv;
 float adenosine=bead(p,vec2(.3,.12),.27);
 float phosphate=max(max(bead(p,vec2(-.1,-.1),.15),bead(p,vec2(-.34,.08),.15)),bead(p,vec2(-.58,-.1),.15));
 float life=clamp(vI.x,0.,1.),fade=min(1.,life*5.)*(1.-smoothstep(.92,1.,life)*.6);
 float halo=exp(-dot(p,p)*4.)*.3;
 vec3 c=vec3(1.,.72,.2)*(adenosine*1.1+phosphate*1.5+halo)+vec3(1.,.95,.75)*(adenosine*adenosine*.4+phosphate*phosphate*.8);
 float a=(adenosine+phosphate+halo);
 gl_FragColor=vec4(c*fade,min(1.,a*.6)*fade);
}`;

const glow: Partial<T.ShaderMaterialParameters> = {
  transparent: true, depthWrite: false, depthTest: false, side: T.DoubleSide,
  // RGB adds with no alpha gate so light lands on the video like a real glow; the small alpha
  // the shaders emit darkens what is behind just enough to survive over bright skin.
  blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor,
  blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor,
};

/** Screen-space capsules, one instanced draw: shared by hand bones, joints and proton streaks. */
class Capsules {
  readonly mesh: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  private readonly data: Float32Array;
  private readonly buffer: T.InstancedInterleavedBuffer;
  private count = 0;
  constructor(private readonly capacity: number, res: {value: T.Vector2}, depthTest: boolean) {
    this.data = new Float32Array(capacity * 11);
    this.buffer = new T.InstancedInterleavedBuffer(this.data, 11).setUsage(T.DynamicDrawUsage);
    const g = new T.InstancedBufferGeometry();
    g.setIndex(quad.index); g.setAttribute('position', quad.attributes.position);
    g.setAttribute('aA', new T.InterleavedBufferAttribute(this.buffer, 3, 0));
    g.setAttribute('aB', new T.InterleavedBufferAttribute(this.buffer, 3, 3));
    g.setAttribute('aColor', new T.InterleavedBufferAttribute(this.buffer, 3, 6));
    g.setAttribute('aStyle', new T.InterleavedBufferAttribute(this.buffer, 2, 9));
    g.instanceCount = 0;
    this.mesh = new T.Mesh(g, new T.ShaderMaterial({vertexShader: capsuleVert, fragmentShader: capsuleFrag, uniforms: {uRes: res}, ...glow, depthTest}));
    this.mesh.frustumCulled = false; this.mesh.visible = false;
  }
  reset() {this.count = 0;}
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: T.Color, width: number, gain: number) {
    if (this.count >= this.capacity) return;
    const d = this.data, i = this.count++ * 11;
    d[i] = ax; d[i + 1] = ay; d[i + 2] = az; d[i + 3] = bx; d[i + 4] = by; d[i + 5] = bz;
    d[i + 6] = c.r; d[i + 7] = c.g; d[i + 8] = c.b; d[i + 9] = width; d[i + 10] = gain;
  }
  flush() {
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count) this.buffer.needsUpdate = true;
  }
}

interface Chain {
  id: string; name: string; component: AtpComponent; residues: number; group: T.Group; rotor: boolean;
  /** Coarse model-space CA sample for picking. */
  samples: Float32Array;
  centroid: T.Vector3; radial: T.Vector3; hinge: T.Vector3; out: number; lift: number; tilt: number;
  glow: {value: number};
}
const v = new T.Vector3(), w = new T.Vector3(), rootInverse = new T.Quaternion(), rotorInverse = new T.Quaternion();
const Y = new T.Vector3(0, 1, 0), mix = new T.Color(), protonColor = new T.Color('#b8f6ff');

export class AtpView implements AtpWorld {
  readonly ready: Promise<void>;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(37, 1, .1, 100);
  readonly renderer: T.WebGLRenderer;
  chainCount = 0;
  private readonly root = new T.Group();
  private readonly rotor = new T.Group();
  private readonly chains: Chain[] = [];
  private readonly skinMeshes: Record<AtpSkin, T.Object3D[]> = {constellation: [], ribbon: [], solid: []};
  private readonly halos: T.Object3D[] = [];
  private readonly fades: Record<AtpSkin, number> = {constellation: 0, ribbon: 0, solid: 0};
  private readonly skinFade: Record<AtpSkin, {value: number}> = {constellation: {value: 0}, ribbon: {value: 0}, solid: {value: 0}};
  private readonly shared = {
    uTime: {value: 0}, uJitter: {value: 0}, uSlice: {value: new T.Vector2()}, uFieldK: {value: new T.Vector2()},
    uField: {value: [new T.Vector4(), new T.Vector4()]}, uShock: {value: [new T.Vector4(0, 0, 0, -1), new T.Vector4(0, 0, 0, -1), new T.Vector4(0, 0, 0, -1)]},
  };
  private readonly haloGain = {value: 0};
  private readonly px = {value: 1};
  private readonly motionScale = {value: 1};
  private readonly res = {value: new T.Vector2(1, 1)};
  private readonly motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  private readonly hands = new Capsules(HAND_CAPSULES, this.res, false);
  private readonly protons = new Capsules(MAX_PROTONS, this.res, true);
  private readonly proton = new Float32Array(MAX_PROTONS * 3);
  private protonCount = 0;
  private readonly atpData = new Float32Array(MAX_ATP * 5);
  private readonly atpBuffer = new T.InstancedInterleavedBuffer(this.atpData, 5).setUsage(T.DynamicDrawUsage);
  private readonly atp: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  private readonly plane: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
  private readonly chip = document.createElement('div');
  private readonly chipTitle = document.createElement('b');
  private readonly chipDetail = document.createElement('small');
  private readonly resizeObserver: ResizeObserver;
  private readonly abort = new AbortController();
  private headAnchor = new T.Vector3(0, 1.8, 0);
  private explode = 0;
  private sliceAmount = 0;
  private sliceX = 0;
  private videoAspect = 0;
  private zoom = 1;
  private lastNow = 0;
  private skin: AtpSkin | null = null;
  private disposed = false;
  private contextLost = false;
  private width = 1;
  private height = 1;

  constructor(readonly host: HTMLElement) {
    this.renderer = new T.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0, 0);
    this.renderer.domElement.className = 'atp-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.prepend(this.renderer.domElement);
    this.camera.position.set(0, 0, 13);
    this.scene.add(this.root);
    this.root.add(this.rotor);

    const atpGeometry = new T.InstancedBufferGeometry();
    atpGeometry.setIndex(quad.index); atpGeometry.setAttribute('position', quad.attributes.position);
    atpGeometry.setAttribute('aCenter', new T.InterleavedBufferAttribute(this.atpBuffer, 3, 0));
    atpGeometry.setAttribute('aInfo', new T.InterleavedBufferAttribute(this.atpBuffer, 2, 3));
    atpGeometry.instanceCount = 0;
    this.atp = new T.Mesh(atpGeometry, new T.ShaderMaterial({vertexShader: atpVert, fragmentShader: atpFrag, uniforms: {uTime: this.shared.uTime}, ...glow, depthTest: true}));
    this.atp.frustumCulled = false; this.atp.visible = false; this.atp.renderOrder = 6;
    this.protons.mesh.renderOrder = 6; this.hands.mesh.renderOrder = 10;
    this.plane = new T.Mesh(new T.PlaneGeometry(8, 8), new T.ShaderMaterial({vertexShader: planeVert, fragmentShader: planeFrag, uniforms: {uAmount: {value: 0}}, ...glow, depthTest: true}));
    this.plane.rotation.y = Math.atan2(CUT_X, CUT_Z);
    this.plane.visible = false; this.plane.renderOrder = 2;
    this.scene.add(this.atp, this.protons.mesh, this.hands.mesh, this.plane);
    this.buildMembrane();

    this.chip.className = 'atp-chip'; this.chip.hidden = true;
    this.chip.append(this.chipTitle, this.chipDetail);
    host.append(this.chip);

    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.ready = this.loadStructure();
  }

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.host.dispatchEvent(new CustomEvent('atp-render-error', {bubbles: true, detail: 'The 3D view paused. Reload if it does not recover.'}));
  };
  private readonly onContextRestored = () => {this.contextLost = false; this.renderer.render(this.scene, this.camera);};

  private buildMembrane() {
    const positions = new Float32Array(LIPIDS * 3), seeds = new Float32Array(LIPIDS);
    for (let i = 0; i < LIPIDS; i++) {
      // Low-discrepancy radius and angle with a hashed leaflet: even and sparse, with no visible rows.
      const r = 1 + 2.4 * Math.sqrt((i * .7548777) % 1), a = i * .5698403 * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.sin(i * 12.9898) > 0 ? .1 : -.1;
      positions[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = (i * .618034) % 1;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(positions, 3));
    g.setAttribute('aSeed', new T.BufferAttribute(seeds, 1));
    const points = new T.Points(g, new T.ShaderMaterial({
      vertexShader: lipidVert, fragmentShader: lipidFrag,
      uniforms: {uTime: this.shared.uTime, uSlice: this.shared.uSlice, uPx: this.px, uMotion: this.motionScale}, ...glow, depthTest: true,
    }));
    points.frustumCulled = false; points.renderOrder = 1; points.name = 'membrane';
    this.root.add(points);
  }

  private async loadStructure() {
    const response = await fetch('/models/atp-6oqr.json', {signal: this.abort.signal});
    if (!response.ok) throw new Error(`Molecular structure could not load (${response.status}).`);
    const asset = await response.json() as AtpStructureAsset;
    if (this.disposed) return;
    if (asset.schema !== 'atp-structure-v1' || asset.pdb !== '6OQR' || !Array.isArray(asset.chains) || !asset.chains.length || asset.chains.length > 100 || !asset.anchors) throw new Error('The ATP molecular asset has an unsupported format.');
    let total = 0, low = Infinity, high = -Infinity;
    for (const chain of asset.chains) {
      if (!['rotor', 'stator', 'head'].includes(chain.component) || !Array.isArray(chain.points) || chain.points.length % 3) throw new Error('Invalid molecular chain data.');
      total += chain.points.length / 3;
      if (total > 20000) throw new Error('The molecular asset exceeds the supported size.');
      for (let i = 0; i < chain.points.length; i += 3) {
        if (!Number.isFinite(chain.points[i]) || !Number.isFinite(chain.points[i + 1]) || !Number.isFinite(chain.points[i + 2])) throw new Error('Invalid molecular coordinates.');
        low = Math.min(low, chain.points[i + 1]); high = Math.max(high, chain.points[i + 1]);
      }
    }
    const height = high - low;
    if (!total || !Number.isFinite(height) || height < 1) throw new Error('Molecular coordinates are empty.');
    const scale = MOLECULE_HEIGHT / height, midY = (low + high) / 2;
    const anchor = (xyz: number[]) => new T.Vector3(xyz[0] * scale, (xyz[1] - midY) * scale, xyz[2] * scale);
    for (const part of ['rotor', 'stator', 'head', 'membrane'] as const) {
      const xyz = asset.anchors[part];
      if (!Array.isArray(xyz) || xyz.length !== 3 || !xyz.every(Number.isFinite)) throw new Error('Invalid molecular label anchors.');
    }
    this.headAnchor = anchor(asset.anchors.head);
    // x and z stay at zero: the ring axis must pass through the origin for the rotor to turn true.
    this.root.getObjectByName('membrane')!.position.y = -midY * scale;
    const coords = asset.chains.map(chain => Float32Array.from(chain.points, (n, i) => i % 3 === 1 ? (n - midY) * scale : n * scale));
    const shades = burial(coords, 11 * scale);
    asset.chains.forEach((chain, i) => this.buildChain(chain, coords[i], shades[i], GAP * scale, i));
    this.chainCount = this.chains.length;
    if (!this.contextLost) this.renderer.render(this.scene, this.camera);
  }

  private buildChain(source: AtpStructureAsset['chains'][number], xyz: Float32Array, shade: Float32Array, gap: number, index: number) {
    const count = xyz.length / 3, style = chainStyle(source.name, index);
    const tint = {value: new T.Color(style.color)}, chainGlow = {value: 0}, seed = index * 13.7;
    const centers = new Float32Array(xyz), info = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {info[i * 2] = i + seed; info[i * 2 + 1] = shade[i];}
    const group = new T.Group();
    const material = (vertexShader: string, fragmentShader: string, skin: AtpSkin, own: Record<string, T.IUniform>, extra: Partial<T.ShaderMaterialParameters> = glow) =>
      new T.ShaderMaterial({vertexShader, fragmentShader, uniforms: {...this.shared, uTint: tint, uGlow: chainGlow, uFade: this.skinFade[skin], ...own}, ...extra});
    const add = <O extends T.Mesh | T.LineSegments>(object: O, skin: AtpSkin | null, order: number) => {
      object.frustumCulled = false; object.renderOrder = order; object.visible = false;
      group.add(object);
      (skin ? this.skinMeshes[skin] : this.halos).push(object);
      return object;
    };
    const instanced = (c: Float32Array, n: Float32Array) => {
      const g = new T.InstancedBufferGeometry();
      g.setIndex(quad.index); g.setAttribute('position', quad.attributes.position);
      g.setAttribute('aCenter', new T.InstancedBufferAttribute(c, 3));
      g.setAttribute('aInfo', new T.InstancedBufferAttribute(n, 2));
      g.instanceCount = c.length / 3;
      return g;
    };
    const beads = instanced(centers, info);
    add(new T.Mesh(beads, material(beadVert, beadFrag, 'constellation', {uSize: {value: BEAD_SIZE}, uGain: {value: .4}, uCore: {value: 1}})), 'constellation', 4);
    add(new T.Mesh(beads, material(beadVert, solidFrag, 'solid', {uSize: {value: 3.9 * gap / GAP}}, {defines: {SOLID: 1}})), 'solid', 0);

    const haloCount = Math.ceil(count / HALO_STRIDE), haloC = new Float32Array(haloCount * 3), haloI = new Float32Array(haloCount * 2);
    for (let i = 0; i < haloCount; i++) {
      const from = i * HALO_STRIDE;
      haloC.set(xyz.subarray(from * 3, from * 3 + 3), i * 3);
      haloI[i * 2] = info[from * 2]; haloI[i * 2 + 1] = 1;
    }
    add(new T.Mesh(instanced(haloC, haloI), new T.ShaderMaterial({
      vertexShader: beadVert, fragmentShader: beadFrag,
      uniforms: {...this.shared, uTint: tint, uGlow: chainGlow, uFade: {value: 1}, uSize: {value: HALO_SIZE}, uGain: this.haloGain, uCore: {value: 0}}, ...glow,
    })), null, 5);

    // Segment the backbone where it is contiguous; deposited gaps stay gaps.
    const segments: [number, number][] = [];
    let start = 0;
    for (let i = 1; i <= count; i++) {
      const d = i < count ? Math.hypot(xyz[i * 3] - xyz[i * 3 - 3], xyz[i * 3 + 1] - xyz[i * 3 - 2], xyz[i * 3 + 2] - xyz[i * 3 - 1]) : 0;
      if (i === count || d <= .1 * gap / GAP || d >= gap) {if (i - start > 1) segments.push([start, i]); start = i;}
    }
    const lineCount = segments.reduce((sum, [a, b]) => sum + b - a - 1, 0);
    const linePos = new Float32Array(lineCount * 6), linePhase = new Float32Array(lineCount * 2);
    let at = 0;
    for (const [a, b] of segments) for (let i = a; i + 1 < b; i++, at++) {
      linePos.set(xyz.subarray(i * 3, i * 3 + 6), at * 6);
      linePhase[at * 2] = info[i * 2]; linePhase[at * 2 + 1] = info[i * 2 + 2];
    }
    const lines = new T.BufferGeometry();
    lines.setAttribute('position', new T.BufferAttribute(linePos, 3));
    lines.setAttribute('aPhase', new T.BufferAttribute(linePhase, 1));
    add(new T.LineSegments(lines, material(lineVert, lineFrag, 'constellation', {uGain: {value: .26}})), 'constellation', 3);
    add(new T.Mesh(tube(xyz, segments, seed), material(ribbonVert, ribbonFrag, 'ribbon', {uRadius: {value: TUBE_RADIUS}}, {side: T.DoubleSide})), 'ribbon', 0);

    const samples = new Float32Array(Math.ceil(count / PICK_STRIDE) * 3), centroid = new T.Vector3();
    for (let i = 0; i < count; i++) {
      centroid.x += xyz[i * 3]; centroid.y += xyz[i * 3 + 1]; centroid.z += xyz[i * 3 + 2];
      if (i % PICK_STRIDE === 0) samples.set(xyz.subarray(i * 3, i * 3 + 3), i / PICK_STRIDE * 3);
    }
    centroid.divideScalar(count);
    const radial = new T.Vector3(centroid.x, 0, centroid.z);
    if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
    radial.normalize();
    (source.component === 'rotor' ? this.rotor : this.root).add(group);
    this.chains.push({
      id: source.id, name: source.name, component: source.component, residues: count, group, rotor: source.component === 'rotor',
      samples, centroid, radial, hinge: new T.Vector3().crossVectors(Y, radial), out: style.out, lift: style.lift, tilt: style.tilt, glow: chainGlow,
    });
  }

  private resize() {
    if (this.disposed) return;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    this.res.value.set(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.position.z = this.width < 700 ? 15 : 13;
    this.applyCamera();
    if (!this.contextLost) this.renderer.render(this.scene, this.camera);
  }

  private applyCamera() {
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.px.value = this.renderer.getPixelRatio() * this.height * this.zoom / (2 * Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)));
  }

  setPose(view: AtpViewState) {
    if (this.disposed) return;
    this.root.quaternion.fromArray(view.q).normalize();
    this.root.position.set(view.x, view.y, 0);
    this.root.updateMatrixWorld(true);
    this.zoom = Math.min(3, Math.max(.4, view.zoom));
    if (this.camera.zoom !== this.zoom) this.applyCamera();
  }

  setVideoAspect(aspect: number) {this.videoAspect = aspect;}

  mirrorToWorld(point: MirrorPoint): WorldPoint {
    const stage = mirrorToStage(point.x, point.y, this.videoAspect, this.width / this.height);
    // Unprojecting along the ray keeps a joint under the real finger whatever depth it is given.
    return this.unproject(stage.x * 2 - 1, 1 - stage.y * 2, Math.max(-1, Math.min(1, -point.z * 1.4)));
  }

  pointToWorld(clientX: number, clientY: number): WorldPoint {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.unproject((clientX - rect.left) / (rect.width || 1) * 2 - 1, 1 - (clientY - rect.top) / (rect.height || 1) * 2, 0);
  }

  private unproject(ndcX: number, ndcY: number, z: number): WorldPoint {
    const c = this.camera.position;
    v.set(ndcX, ndcY, .5).unproject(this.camera).sub(c);
    const t = (z - c.z) / v.z;
    return {x: c.x + v.x * t, y: c.y + v.y * t, z};
  }

  chainAt(point: WorldPoint) {
    const c = this.camera.position;
    v.set(point.x - c.x, point.y - c.y, point.z - c.z);
    const reach = v.length();
    if (!reach) return -1;
    const dx = v.x / reach, dy = v.y / reach, dz = v.z / reach;
    let best = -1, bestScore = Infinity;
    for (let n = 0; n < this.chains.length; n++) {
      const chain = this.chains[n], m = chain.group.matrixWorld.elements, s = chain.samples;
      for (let i = 0; i < s.length; i += 3) {
        const a = s[i], b = s[i + 1], e = s[i + 2];
        const x = m[0] * a + m[4] * b + m[8] * e + m[12], y = m[1] * a + m[5] * b + m[9] * e + m[13], z = m[2] * a + m[6] * b + m[10] * e + m[14];
        if (this.sliceAmount > 0 && (x - this.sliceX) * CUT_X + z * CUT_Z > 0) continue;
        const px = x - c.x, py = y - c.y, pz = z - c.z, along = px * dx + py * dy + pz * dz;
        if (along <= 0) continue;
        const dot = px * px + py * py + pz * pz - along * along;
        // Measured on the query's depth so the radius means the same at the molecule's front and back.
        const off = Math.sqrt(Math.max(0, dot)) * reach / along;
        if (off > PICK_RADIUS) continue;
        // Favouring the nearer bead keeps a touch on the front chain, not whatever sits behind it.
        const score = off + along * .06;
        if (score < bestScore) {bestScore = score; best = n;}
      }
    }
    return best;
  }

  chainInfo(index: number) {
    const chain = this.chains[index];
    return chain ? {id: chain.id, name: chain.name, component: chain.component, residues: chain.residues} : {id: '', name: '', component: 'head' as AtpComponent, residues: 0};
  }

  headPoint(): WorldPoint {
    v.copy(this.headAnchor);
    v.y += this.explode * .9;
    v.applyMatrix4(this.root.matrixWorld);
    return {x: v.x, y: v.y, z: v.z};
  }

  draw(scene: AtpScene, now: number) {
    if (this.disposed || this.contextLost) return;
    const dt = Math.min(.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const u = this.shared, still = this.motion?.matches;
    u.uTime.value = now / 1000 % 3600;
    u.uJitter.value = still ? 0 : THERMAL * (1 + Math.min(3, Math.abs(scene.rotorSpeed)) * 1.6);
    this.motionScale.value = still ? 0 : 1;
    this.setFields(scene.fields);
    for (let i = 0; i < 3; i++) {
      const s = scene.shocks[i];
      if (s) u.uShock.value[i].set(s.x, s.y, s.z, s.age); else u.uShock.value[i].w = -1;
    }
    this.sliceAmount = scene.slice.amount; this.sliceX = scene.slice.x;
    u.uSlice.value.set(scene.slice.amount, scene.slice.x);
    this.plane.visible = scene.slice.amount > 0;
    this.plane.material.uniforms.uAmount.value = scene.slice.amount;
    this.plane.position.x = scene.slice.x;
    this.updateSkins(scene.skin, dt);
    this.updateChains(scene);
    this.updateSparks(scene);
    this.updateHands(scene.hands);
    this.updateChip(scene);
    this.renderer.render(this.scene, this.camera);
  }

  private setFields(fields: AtpField[]) {
    const u = this.shared;
    for (let i = 0; i < 2; i++) {
      const f = fields[i];
      if (f) u.uField.value[i].set(f.x, f.y, f.z, Math.max(.001, f.radius));
      u.uFieldK.value.setComponent(i, f ? f.strength : 0);
    }
  }

  private updateSkins(target: AtpSkin, dt: number) {
    const first = this.skin === null;
    this.skin = target;
    let gain = 0;
    for (const name of skins) {
      const goal = name === target ? 1 : 0;
      const from = this.fades[name], next = first ? goal : from + Math.max(-dt / FADE_SECONDS, Math.min(dt / FADE_SECONDS, goal - from));
      this.fades[name] = next;
      const eased = next * next * (3 - 2 * next);
      this.skinFade[name].value = eased;
      gain += haloGain[name] * eased;
      const on = next > .002, meshes = this.skinMeshes[name];
      if (meshes.length && meshes[0].visible !== on) for (let i = 0; i < meshes.length; i++) meshes[i].visible = on;
    }
    this.haloGain.value = gain;
    if (this.halos.length && !this.halos[0].visible) for (let i = 0; i < this.halos.length; i++) this.halos[i].visible = true;
  }

  private updateChains(scene: AtpScene) {
    const e = Math.max(0, Math.min(1, scene.explode)), offsets = scene.chainOffsets, glows = scene.chainGlow;
    this.explode = e;
    this.rotor.rotation.y = scene.rotorAngle;
    rootInverse.copy(this.root.quaternion).invert();
    rotorInverse.setFromAxisAngle(Y, -scene.rotorAngle);
    for (let i = 0; i < this.chains.length; i++) {
      const c = this.chains[i], o = i * 3;
      // Tilting about the chain's own centroid opens it like a petal instead of swinging it round the axis.
      c.group.quaternion.setFromAxisAngle(c.hinge, c.tilt * e);
      w.copy(c.centroid).applyQuaternion(c.group.quaternion);
      c.group.position.copy(c.centroid).sub(w).addScaledVector(c.radial, c.out * e);
      c.group.position.y += c.lift * e;
      if (o + 2 < offsets.length) {
        v.set(offsets[o], offsets[o + 1], offsets[o + 2]).applyQuaternion(rootInverse);
        if (c.rotor) v.applyQuaternion(rotorInverse);
        c.group.position.add(v);
      }
      c.glow.value = i < glows.length ? glows[i] : 0;
    }
    this.root.updateMatrixWorld(true);
  }

  private updateSparks(scene: AtpScene) {
    const d = this.atpData, prev = this.proton, sparks = scene.sparks;
    let atp = 0, protons = 0;
    this.protons.reset();
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      if (s.kind === 'atp') {
        if (atp === MAX_ATP) continue;
        const n = atp++ * 5;
        d[n] = s.x; d[n + 1] = s.y; d[n + 2] = s.z; d[n + 3] = s.life; d[n + 4] = i * 1.7;
      } else if (protons < MAX_PROTONS) {
        const n = protons * 3, known = protons < this.protonCount;
        let tx = known ? s.x + (prev[n] - s.x) * 3 : s.x, ty = known ? s.y + (prev[n + 1] - s.y) * 3 : s.y, tz = known ? s.z + (prev[n + 2] - s.z) * 3 : s.z;
        // Sparks have no ids: a long jump means the slot changed owner, which must not draw a streak.
        if ((tx - s.x) ** 2 + (ty - s.y) ** 2 + (tz - s.z) ** 2 > .2) {tx = s.x; ty = s.y; tz = s.z;}
        prev[n] = s.x; prev[n + 1] = s.y; prev[n + 2] = s.z;
        const fade = Math.min(1, Math.max(0, s.life) * 4);
        this.protons.add(s.x, s.y, s.z, tx, ty, tz, protonColor, 1.6, fade);
        protons++;
      }
    }
    this.protonCount = protons;
    this.protons.flush();
    this.atp.geometry.instanceCount = atp;
    this.atp.visible = atp > 0;
    if (atp) this.atpBuffer.needsUpdate = true;
  }

  private updateHands(hands: AtpHandView[]) {
    this.hands.reset();
    const count = Math.min(MAX_HANDS, hands.length);
    for (let h = 0; h < count; h++) {
      const hand = hands[h], j = hand.joints;
      if (j.length < 21) continue;
      mix.copy(poseTint[hand.pose] ?? poseTint.none).multiply(sideTint[hand.side] ?? sideTint.unknown);
      const gain = hand.active ? 1.25 : .62, width = hand.active ? 1.5 : 1;
      for (let i = 0; i < HAND_BONES.length; i += 2) {
        const a = j[HAND_BONES[i]], b = j[HAND_BONES[i + 1]];
        this.hands.add(a.x, a.y, a.z, b.x, b.y, b.z, mix, width, gain);
      }
      for (let i = 0; i < 21; i++) {
        const a = j[i], tip = i > 0 && i % 4 === 0;
        this.hands.add(a.x, a.y, a.z, a.x, a.y, a.z, mix, tip ? 3 : 2.1, gain + .3);
      }
    }
    this.hands.flush();
  }

  private updateChip(scene: AtpScene) {
    const label = scene.label;
    this.chip.hidden = !label;
    if (!label) return;
    if (this.chipTitle.textContent !== label.title) this.chipTitle.textContent = label.title;
    if (this.chipDetail.textContent !== label.detail) this.chipDetail.textContent = label.detail;
    v.set(label.x, label.y, label.z).project(this.camera);
    this.chip.style.left = `${Math.round((v.x + 1) * this.width / 2) + 14}px`;
    this.chip.style.top = `${Math.round((1 - v.y) * this.height / 2)}px`;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    this.scene.traverse(object => {
      if (object instanceof T.Mesh || object instanceof T.LineSegments || object instanceof T.Points) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    this.renderer.dispose(); this.renderer.domElement.remove();
    this.chip.remove();
    this.scene.clear();
  }

}


/** Per-residue exposure in 0.35..1 from neighbour counts: real burial is the honest occlusion here, and it stops the dense core saturating. */
function burial(chains: Float32Array[], radius: number) {
  const cells = new Map<number, number[]>(), key = (x: number, y: number, z: number) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  const all: number[] = [];
  for (const xyz of chains) for (let i = 0; i < xyz.length; i += 3) {
    const k = key(Math.floor(xyz[i] / radius), Math.floor(xyz[i + 1] / radius), Math.floor(xyz[i + 2] / radius));
    let cell = cells.get(k);
    if (!cell) cells.set(k, cell = []);
    cell.push(all.length);
    all.push(xyz[i], xyz[i + 1], xyz[i + 2]);
  }
  const counts = new Float32Array(all.length / 3), r2 = radius * radius;
  for (let n = 0; n < counts.length; n++) {
    const x = all[n * 3], y = all[n * 3 + 1], z = all[n * 3 + 2], cx = Math.floor(x / radius), cy = Math.floor(y / radius), cz = Math.floor(z / radius);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (const m of cells.get(key(cx + a, cy + b, cz + c)) ?? []) {
        if ((all[m * 3] - x) ** 2 + (all[m * 3 + 1] - y) ** 2 + (all[m * 3 + 2] - z) ** 2 < r2) counts[n]++;
      }
    }
  }
  const sorted = counts.slice().sort(), lo = sorted[Math.floor(sorted.length * .1)], hi = sorted[Math.floor(sorted.length * .9)];
  let at = 0;
  return chains.map(xyz => {
    const shade = new Float32Array(xyz.length / 3);
    for (let i = 0; i < shade.length; i++, at++) shade[i] = 1 - .65 * Math.max(0, Math.min(1, (counts[at] - lo) / Math.max(1, hi - lo)));
    return shade;
  });
}

/** Catmull-Rom tubes for every contiguous segment of one chain, merged so a chain stays one draw. */
function tube(xyz: Float32Array, segments: [number, number][], seed: number) {
  const parts = segments.map(([a, b]) => {
    const points: T.Vector3[] = [];
    for (let i = a; i < b; i++) points.push(new T.Vector3(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]));
    const curve = new T.CatmullRomCurve3(points, false, 'centripetal');
    curve.arcLengthDivisions = (b - a) * TUBE_STEPS * 2;
    return {start: a, span: b - a - 1, g: new T.TubeGeometry(curve, (b - a - 1) * TUBE_STEPS, TUBE_RADIUS, TUBE_SIDES, false)};
  });
  const vertices = parts.reduce((n, p) => n + p.g.attributes.position.count, 0), indices = parts.reduce((n, p) => n + p.g.index!.count, 0);
  const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), phase = new Float32Array(vertices), index = new Uint32Array(indices);
  let vertex = 0, offset = 0;
  for (const {start, span, g} of parts) {
    const uv = g.attributes.uv, source = g.index!;
    position.set(g.attributes.position.array, vertex * 3);
    normal.set(g.attributes.normal.array, vertex * 3);
    for (let i = 0; i < uv.count; i++) phase[vertex + i] = start + uv.getX(i) * span + seed;
    for (let i = 0; i < source.count; i++) index[offset + i] = source.getX(i) + vertex;
    vertex += uv.count; offset += source.count;
    g.dispose();
  }
  const merged = new T.BufferGeometry();
  merged.setAttribute('position', new T.BufferAttribute(position, 3));
  merged.setAttribute('normal', new T.BufferAttribute(normal, 3));
  merged.setAttribute('aPhase', new T.BufferAttribute(phase, 1));
  merged.setIndex(new T.BufferAttribute(index, 1));
  return merged;
}
