import * as T from 'three';
import type {Fragrance} from './flacon';

/** Wisps in world units, so they hang in the room rather than turning with the bottle. Notes evaporate in perfumery's order: top first, base last. */
export const NOTES=['top','heart','base'] as const;
export type NoteId=typeof NOTES[number];
/** Seconds each note lives, how fast it rises (world units per second) and how wide it blooms. Illustrative, compressed from hours. */
const life=[[2.2,3.2],[4.6,6.2],[8.5,11.5]] as const,rise=[.22,.1,-.02],bloom=[.8,1.05,1.3];
/** How a settled droplet's scent splits between the notes. */
const share=[.45,.35,.2];
const MAX=900,DOTS=110;
const rand=(a:number,b:number)=>a+Math.random()*(b-a);
const smooth=(a:number,b:number,x:number)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
export const pickNote=()=>{const r=Math.random();return r<share[0]?0:r<share[0]+share[1]?1:2;};

const wispVert=/* glsl */`
attribute float aSize,aAlpha,aSeed;attribute vec3 aColor;uniform float uPx;varying vec3 vC;varying float vA,vSeed;
void main(){vC=aColor;vA=aAlpha;vSeed=aSeed;vec4 m=modelViewMatrix*vec4(position,1.);gl_PointSize=aAlpha>0.?min(900.,uPx*aSize/-m.z):0.;gl_Position=projectionMatrix*m;}`;
const wispFrag=/* glsl */`
uniform float uTime;varying vec3 vC;varying float vA,vSeed;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
void main(){
 vec2 p=gl_PointCoord*2.-1.;float a0=vSeed*6.283+uTime*(.2+vSeed*.3),c=cos(a0),s=sin(a0);p=mat2(c,-s,s,c)*p;
 float r=length(p);if(r>1.)discard;
 float w=n(p*2.1+vSeed*31.)*.62+n(p*4.3-vSeed*13.+uTime*.15)*.38;
 float a=exp(-pow(r+(w-.5)*.45,2.)*4.)*smoothstep(1.,.7,r)*(.3+.7*w*w)*vA*.6;
 vec3 tone=mix(vC,vec3(1.,.97,.92),.18);
 gl_FragColor=vec4(tone*a,a*.35);
}`;
const dotFrag=/* glsl */`
varying vec3 vC;varying float vA,vSeed;
void main(){vec2 p=gl_PointCoord*2.-1.;float r=length(p);if(r>1.)discard;
 float a=vSeed>1.5?smoothstep(.06,0.,abs(r-.86))*vA:(exp(-r*r*7.)+exp(-r*r*40.)*.8)*vA;
 gl_FragColor=vec4(vC*a,a);}`;
const soft=(vertexShader:string,fragmentShader:string,uniforms:Record<string,T.IUniform>)=>new T.ShaderMaterial({vertexShader,fragmentShader,uniforms,transparent:true,depthWrite:false,blending:T.CustomBlending,blendSrc:T.OneFactor,blendDst:T.OneMinusSrcAlphaFactor,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneMinusSrcAlphaFactor});
class Cloud {
 readonly geometry=new T.BufferGeometry();
 readonly pos:Float32Array;readonly size:Float32Array;readonly alpha:Float32Array;readonly color:Float32Array;readonly seed:Float32Array;
 constructor(n:number){
  this.pos=new Float32Array(n*3);this.size=new Float32Array(n);this.alpha=new Float32Array(n);this.color=new Float32Array(n*3);this.seed=new Float32Array(n);
  this.geometry.setAttribute('position',new T.BufferAttribute(this.pos,3).setUsage(T.DynamicDrawUsage));
  this.geometry.setAttribute('aSize',new T.BufferAttribute(this.size,1).setUsage(T.DynamicDrawUsage));
  this.geometry.setAttribute('aAlpha',new T.BufferAttribute(this.alpha,1).setUsage(T.DynamicDrawUsage));
  this.geometry.setAttribute('aColor',new T.BufferAttribute(this.color,3).setUsage(T.DynamicDrawUsage));
  this.geometry.setAttribute('aSeed',new T.BufferAttribute(this.seed,1));
 }
 flush(){for(const k of ['position','aSize','aAlpha','aColor'])(this.geometry.attributes[k] as T.BufferAttribute).needsUpdate=true;}
}
export interface Hand {id:number;x:number;y:number;z:number;
 /** Palm axes on the screen plane: up the fingers and across the knuckles, each a palm length. */
 ux:number;uy:number;wx:number;wy:number}
export interface ScentStep {
 dt:number;time:number;still:boolean;
 /** Seconds into a rewind or -1; the orifice in world units it streams back to. */
 rewind:number;home:T.Vector3;
 /** Fingertips stirring: world position and velocity. */
 fingers:{x:number;y:number;vx:number;vy:number}[];
 /** A palm in the mist catches what drifts into it. */
 palm:Hand|null;
}
export interface NoteLabel {weight:number;x:number;y:number;z:number}

/** The scent itself: droplets turn into soft coloured wisps that bloom, drift and evaporate note by note. */
export class ScentCloud {
 readonly points:T.Points;
 private c=new Cloud(MAX);private vel=new Float32Array(MAX*3);private age=new Float32Array(MAX);private ttl=new Float32Array(MAX);private note=new Uint8Array(MAX);private big=new Float32Array(MAX);private live=new Uint8Array(MAX);
 private head=0;private clock=0;private colors=[new T.Color(),new T.Color(),new T.Color()];
 private material=soft(wispVert,wispFrag,{uPx:{value:1},uTime:{value:0}});
 /** Per note: summed weight and its centre, for the floating labels. */
 readonly labels:NoteLabel[]=NOTES.map(()=>({weight:0,x:0,y:0,z:0}));
 count=0;stirred=0;byNote=[0,0,0];
 constructor(){this.points=new T.Points(this.c.geometry,this.material);this.points.frustumCulled=false;this.points.renderOrder=220;for(let i=0;i<MAX;i++)this.c.seed[i]=Math.random();}
 fragrance(f:Fragrance){f.notes.forEach((n,i)=>this.colors[i].set(n.color));}
 /** One wisp. Velocity in world units per second; scale grows the bloom, for the clap's burst. */
 spawn(x:number,y:number,z:number,vx:number,vy:number,vz:number,note:number,scale=1){
  let i=this.head;
  // Recycles the oldest top note first, so a burst never wipes out the lingering base.
  for(let k=0;k<8&&this.live[i]&&this.note[i]===2;k++)i=(i+1)%MAX;
  this.head=(i+1)%MAX;
  const j=i*3,[a,b]=life[note];
  this.c.pos[j]=x;this.c.pos[j+1]=y;this.c.pos[j+2]=z;this.vel[j]=vx;this.vel[j+1]=vy;this.vel[j+2]=vz;
  this.age[i]=0;this.ttl[i]=rand(a,b);this.note[i]=note;this.big[i]=bloom[note]*scale*rand(.75,1.25);this.live[i]=1;
 }
 /** How many wisps have been drawn back into the palm this step. */
 update(o:ScentStep,px:number){
  const {pos,size,alpha,color}=this.c,vel=this.vel,dt=o.dt*o.time,back=o.rewind>=0;
  if(!o.still)this.clock+=dt;
  this.material.uniforms.uPx.value=px;this.material.uniforms.uTime.value=this.clock;
  let caught=0;this.count=0;this.stirred=0;this.byNote[0]=this.byNote[1]=this.byNote[2]=0;
  for(const l of this.labels){l.weight=l.x=l.y=l.z=0;}
  const t=this.clock,drag=Math.exp(-dt*1.1);
  for(let i=0;i<MAX;i++){
   if(!this.live[i]){alpha[i]=0;continue;}
   const j=i*3,n=this.note[i];
   let x=pos[j],y=pos[j+1],z=pos[j+2];
   if(back){
    // Rewind: every wisp spirals home into the orifice and shrinks as it goes.
    const pull=Math.min(1,o.dt*(1.6+o.rewind*7)),dx=o.home.x-x,dy=o.home.y-y,dz=o.home.z-z,d=Math.hypot(dx,dy,dz);
    x+=dx*pull-dy*pull*.35;y+=dy*pull+dx*pull*.35;z+=dz*pull;
    this.age[i]=Math.max(0,this.age[i]-o.dt*this.ttl[i]*.5);
    if(d<.12){this.live[i]=0;alpha[i]=0;continue;}
    pos[j]=x;pos[j+1]=y;pos[j+2]=z;
   }else{
    const u=(this.age[i]+=dt)/this.ttl[i];
    if(u>=1){this.live[i]=0;alpha[i]=0;continue;}
    // Buoyant drift with a slow curl, heavier notes hanging lower.
    vel[j]=vel[j]*drag+Math.sin(y*1.7+t*.6+this.c.seed[i]*9)*.22*dt;
    vel[j+1]=vel[j+1]*drag+(rise[n]+Math.cos(x*1.3+t*.5)*.08)*dt*1.4;
    vel[j+2]*=drag;
    for(const f of o.fingers){
     const dx=x-f.x,dy=y-f.y,d=Math.hypot(dx,dy);if(d>1.25||d<1e-4)continue;
     // A stirring finger is a small vortex that also drags the air along with it.
     const k=(1-d/1.25),spin=(1.4+Math.hypot(f.vx,f.vy)*1.2)*k;
     vel[j]+=(-dy/d*spin+f.vx*.9*k-dx*.6*k)*dt*3;vel[j+1]+=(dx/d*spin+f.vy*.9*k-dy*.6*k)*dt*3;this.stirred++;
    }
    const p=o.palm;
    if(p){const dx=p.x-x,dy=p.y-y,r=Math.hypot(p.ux,p.uy)*1.25;if(dx*dx+dy*dy<r*r){vel[j]+=dx*dt*6;vel[j+1]+=dy*dt*6;if(dx*dx+dy*dy<r*r*.12){this.live[i]=0;alpha[i]=0;caught++;continue;}}}
    x+=vel[j]*dt;y+=vel[j+1]*dt;z+=vel[j+2]*dt;pos[j]=x;pos[j+1]=y;pos[j+2]=z;
   }
   const u=Math.min(1,this.age[i]/this.ttl[i]);
   // Bloom then fade: a wisp opens out as it evaporates.
   const a=smooth(0,.12,u)*(1-smooth(.45,1,u))*(back?.9:1);
   size[i]=this.big[i]*(.35+.65*smooth(0,.4,u))*(1+u*.8)*(back?.6:1);alpha[i]=a*(n===2?.8:1);
   const col=this.colors[n];color[j]=col.r;color[j+1]=col.g;color[j+2]=col.b;
   const l=this.labels[n];l.weight+=a;l.x+=x*a;l.y+=y*a;l.z+=z*a;this.count++;this.byNote[n]++;
  }
  for(const l of this.labels)if(l.weight>0){l.x/=l.weight;l.y/=l.weight;l.z/=l.weight;}
  this.c.flush();
  return caught;
 }
 clear(){this.live.fill(0);this.c.alpha.fill(0);this.count=0;this.c.flush();}
}

/** Droplets that land on a palm, and a dry-down played on the skin: top glows first, then heart, then base, in about twelve seconds. */
export const DRY=[[0,.6,3.6],[2,4.4,8.2],[5.2,8.4,13]] as const;
export const DRY_END=14;
export class DryDown {
 readonly points:T.Points;
 private c=new Cloud(DOTS+1);private a=new Float32Array(DOTS);private b=new Float32Array(DOTS);private note=new Uint8Array(DOTS);private n=0;
 private colors=[new T.Color(),new T.Color(),new T.Color()];private hand:Hand|null=null;private gone=0;
 /** Seconds since the scent landed, or -1. */
 clock=-1;
 constructor(){
  const m=soft(wispVert.replace('min(900.,uPx*aSize/-m.z)','max(2.,uPx*aSize/-m.z)'),dotFrag,{uPx:{value:1}});m.depthTest=false;
  this.points=new T.Points(this.c.geometry,m);this.points.frustumCulled=false;this.points.renderOrder=310;
  // The last slot is the catching ring round the palm.
  this.c.seed[DOTS]=2;
 }
 fragrance(f:Fragrance){f.notes.forEach((n,i)=>this.colors[i].set(n.color));}
 get dots(){return this.n;}
 /** Strength of each note on the skin now, 0..1. */
 level(note:number){const t=this.clock,[a,b,c]=DRY[note];return t<0?0:smooth(a,b,t)*(1-smooth(b+.4,c,t));}
 land(x:number,y:number,note=pickNote()){
  const h=this.hand;if(!h)return;
  if(this.clock<0||this.clock>DRY_END*.8){this.clock=0;this.n=0;}
  // Palm coordinates, so the dot rides the hand as it moves and turns.
  const dx=x-h.x,dy=y-h.y,l2u=h.ux*h.ux+h.uy*h.uy,l2w=h.wx*h.wx+h.wy*h.wy;
  let a=(dx*h.ux+dy*h.uy)/l2u,b=(dx*h.wx+dy*h.wy)/l2w;const r=Math.hypot(a,b);if(r>.8){a*=.8/r;b*=.8/r;}
  const i=this.n<DOTS?this.n++:Math.floor(Math.random()*DOTS);this.a[i]=a+rand(-.06,.06);this.b[i]=b+rand(-.06,.06);this.note[i]=note;this.c.seed[i]=Math.random();
 }
 /** hand: the catching palm, or the same hand in any pose; null once it has left the picture. */
 update(dt:number,hand:Hand|null,catching:boolean,px:number){
  (this.points.material as T.ShaderMaterial).uniforms.uPx.value=px;
  if(hand)this.hand=hand,this.gone=0;else this.gone+=dt;
  if(this.clock>=0)this.clock+=dt;
  if(this.clock>DRY_END||this.gone>1.2){this.clock=-1;this.n=0;}
  const {pos,size,alpha,color}=this.c,h=this.hand,fade=Math.max(0,1-this.gone/1.2);
  for(let i=0;i<DOTS;i++){
   if(i>=this.n||!h){alpha[i]=0;continue;}
   const x=h.x+h.ux*this.a[i]+h.wx*this.b[i],y=h.y+h.uy*this.a[i]+h.wy*this.b[i],n=this.note[i],lv=this.level(n);
   pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=h.z;
   const twinkle=.8+.2*Math.sin(this.clock*5+this.c.seed[i]*20);
   size[i]=Math.hypot(h.ux,h.uy)*(.16+.22*lv);alpha[i]=Math.max(.12*(this.clock<DRY_END-1?1:0),lv)*twinkle*fade;
   const col=this.colors[n];color[i*3]=col.r;color[i*3+1]=col.g;color[i*3+2]=col.b;
  }
  const k=DOTS;
  if(h&&catching){pos[k*3]=h.x;pos[k*3+1]=h.y;pos[k*3+2]=h.z;size[k]=Math.hypot(h.ux,h.uy)*2.3;alpha[k]=.55;color[k*3]=1;color[k*3+1]=.85;color[k*3+2]=.55;}else alpha[k]=0;
  this.c.flush();
 }
}
