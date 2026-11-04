import * as T from 'three';
import type {Spray} from './model';

const MAX=4000,KINDS:Spray[]=['mist','jet','sputter','dribble'];
const rand=(a:number,b:number)=>a+Math.random()*(b-a);
export interface SprayStep {
 kind:Spray;x:number;y:number;z:number;dt:number;px:number;
 /** Bullet time: 1 is real time, near 0 is frozen. */
 time:number;
 /** Seconds into a rewind, or -1. A rewind pulls every droplet back into the orifice and emits nothing. */
 rewind:number;
 /** The body's world matrix and a palm disc in world units: droplets that cross it land on the hand. */
 catcher:{m:ArrayLike<number>;x:number;y:number;r:number}|null;
 /** A droplet at the end of its flight, model mm and mm/s: where scent takes over. */
 settled?:(x:number,y:number,z:number,vx:number,vy:number,vz:number,kind:Spray)=>void;
 caught?:(x:number,y:number)=>void;
}
/** One Points cloud in model millimetres, so it follows the object through pose and scale. */
export class PumpSpray {
 private pos=new Float32Array(MAX*3);private vel=new Float32Array(MAX*3);private age=new Float32Array(MAX*2);private kind=new Uint8Array(MAX);
 private size=new Float32Array(MAX);private alive=new Float32Array(MAX);private sink=new Float32Array(MAX);private slow=new Float32Array(MAX);
 private head=0;private carry=0;private cloud=new T.BufferGeometry();private count=0;
 private droplets=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,uniforms:{uPx:{value:1},uTint:{value:new T.Color(1,.93,.8)}},
  vertexShader:`attribute float aSize,aAlpha;uniform float uPx;varying float vA;void main(){vA=aAlpha;vec4 m=modelViewMatrix*vec4(position,1.);gl_PointSize=aAlpha>0.?max(1.,uPx*aSize/-m.z):0.;gl_Position=projectionMatrix*m;}`,
  fragmentShader:`uniform vec3 uTint;varying float vA;void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;float a=exp(-r*3.)*vA;float spark=exp(-dot(p-vec2(-.3,-.3),p-vec2(-.3,-.3))*14.)*vA;gl_FragColor=vec4(uTint*a+vec3(spark*.6),a);}`});
 readonly points:T.Points;
 constructor(){
  this.cloud.setAttribute('position',new T.BufferAttribute(this.pos,3).setUsage(T.DynamicDrawUsage));
  this.cloud.setAttribute('aSize',new T.BufferAttribute(this.size,1).setUsage(T.DynamicDrawUsage));
  this.cloud.setAttribute('aAlpha',new T.BufferAttribute(this.alive,1).setUsage(T.DynamicDrawUsage));
  this.points=new T.Points(this.cloud,this.droplets);this.points.frustumCulled=false;this.points.renderOrder=200;
 }
 tint(c:T.Color){this.droplets.uniforms.uTint.value.copy(c).lerp(new T.Color(1,1,1),.55);}
 /** Fires one droplet along +x, tilted `spread` radians off the axis, with `spin` mm/s about it. */
 private emit(kind:number,x:number,y:number,z:number,spread:number,speed:number,spin:number,ttl:number,mm:number,ring:number,dt:number,fall:number,drag:number){
  const {pos,vel,age,size,alive,sink,slow}=this,i=this.head;this.head=(i+1)%MAX;
  const a=Math.random()*Math.PI*2,c=Math.cos(a),s=Math.sin(a),out=Math.sin(spread)*speed;
  pos[i*3]=x;pos[i*3+1]=y+c*ring;pos[i*3+2]=z+s*ring;
  vel[i*3]=Math.cos(spread)*speed;vel[i*3+1]=c*out-s*spin;vel[i*3+2]=s*out+c*spin;
  // Spread through the frame, so a long frame does not leave a gap at the orifice.
  const ahead=Math.random()*dt;
  for(let n=0;n<3;n++)pos[i*3+n]+=vel[i*3+n]*ahead;
  age[i*2]=ahead;age[i*2+1]=ttl;size[i]=mm;alive[i]=1;sink[i]=fall;slow[i]=drag;this.kind[i]=kind;
 }
 update(o:SprayStep){
  const {pos,vel,age,alive,sink,slow}=this,dt=o.dt*o.time,back=o.rewind>=0,c=o.catcher,m=c?.m;
  this.droplets.uniforms.uPx.value=o.px;
  const kind=back?'none':o.kind,rate=kind==='mist'?5200:kind==='jet'?1500:kind==='sputter'?(Math.sin(performance.now()/23)>.2?900:0):kind==='dribble'?26:0;
  let live=0;
  for(let i=0;i<MAX;i++){
   if(alive[i]<=0)continue;
   const j=i*3;
   if(back){
    // Time backwards: each droplet retraces toward the orifice, faster as the rewind goes on.
    const pull=Math.min(1,o.dt*(2.5+o.rewind*10)),dx=o.x-pos[j],dy=o.y-pos[j+1],dz=o.z-pos[j+2];
    pos[j]+=dx*pull;pos[j+1]+=dy*pull;pos[j+2]+=dz*pull;
    if(Math.hypot(dx,dy,dz)<.9){alive[i]=0;continue;}
    alive[i]=Math.min(.9,alive[i]+o.dt);live++;continue;
   }
   const t=age[i*2]+=dt,life=age[i*2+1];
   if(t>=life){alive[i]=0;o.settled?.(pos[j],pos[j+1],pos[j+2],vel[j],vel[j+1],vel[j+2],KINDS[this.kind[i]]);continue;}
   const drag=Math.exp(-dt*slow[i]);
   vel[j]*=drag;vel[j+1]=vel[j+1]*drag-sink[i]*dt;vel[j+2]*=drag;
   pos[j]+=vel[j]*dt;pos[j+1]+=vel[j+1]*dt;pos[j+2]+=vel[j+2]*dt;
   alive[i]=(1-t/life)*.8;
   if(m){
    const wx=m[0]*pos[j]+m[4]*pos[j+1]+m[8]*pos[j+2]+m[12],wy=m[1]*pos[j]+m[5]*pos[j+1]+m[9]*pos[j+2]+m[13];
    if((wx-c!.x)**2+(wy-c!.y)**2<c!.r*c!.r){alive[i]=0;o.caught?.(wx,wy);continue;}
   }
   live++;
  }
  this.count=live;
  this.carry+=rate*dt;
  for(;this.carry>=1;this.carry--){
   // Hollow cone: droplets leave on a shell, not through the middle.
   if(kind==='mist')this.emit(0,o.x,o.y,o.z,rand(.46,.56),rand(120,300),rand(30,70),rand(.45,.95),rand(.5,1.1),.28,dt,14,3.4);
   else if(kind==='jet')this.emit(1,o.x,o.y,o.z,rand(0,.02),rand(420,520),0,rand(.35,.6),1.2,.05,dt,110,.6);
   else if(kind==='sputter')this.emit(2,o.x,o.y,o.z,rand(0,.5),rand(60,260),0,rand(.2,.5),rand(.8,1.7),.2,dt,320,1);
   else this.emit(3,o.x,o.y,o.z,rand(0,.3),rand(4,14),0,1.1,1.5,.1,dt,320,1);
  }
  for(const name of ['position','aSize','aAlpha'])(this.cloud.attributes[name] as T.BufferAttribute).needsUpdate=true;
 }
 /** Droplets in the air. */
 get live(){return this.count;}
}

const SWIRL=420;
const clipVert=/* glsl */`
#include <common>
#include <clipping_planes_pars_vertex>
attribute float aAlpha;uniform float uPx;varying float vA;
void main(){vA=aAlpha;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_PointSize=aAlpha>0.?max(1.5,uPx*.32/-mvPosition.z):0.;gl_Position=projectionMatrix*mvPosition;
#include <clipping_planes_vertex>
}`;
const clipFrag=/* glsl */`
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uTint;varying float vA;
void main(){
#include <clipping_planes_fragment>
vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;float a=exp(-r*2.5)*vA;gl_FragColor=vec4(uTint*a*1.6,a);}`;
const coneVert=/* glsl */`
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vN,vV;varying float vX;
void main(){vX=position.x;vec4 mvPosition=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mvPosition.xyz);gl_Position=projectionMatrix*mvPosition;
#include <clipping_planes_vertex>
}`;
const coneFrag=/* glsl */`
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uTint;uniform float uA,uFrom,uLength;varying vec3 vN,vV;varying float vX;
void main(){
#include <clipping_planes_fragment>
float rim=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.2);float along=clamp((vX-uFrom)/uLength,0.,1.);
float a=(rim*.85+.05)*uA*smoothstep(0.,.06,along)*(1.-along);gl_FragColor=vec4(uTint*a,a);}`;
/** What Dive shows inside the nozzle: liquid entering the swirl chamber tangentially, spinning faster as it narrows, and leaving as a hollow cone. */
export class SwirlChamber {
 readonly group=new T.Group();
 private phi=new Float32Array(SWIRL);private u=new Float32Array(SWIRL);private speed=new Float32Array(SWIRL);private alive=new Float32Array(SWIRL);
 private pos=new Float32Array(SWIRL*3);private geometry=new T.BufferGeometry();private head=0;private carry=0;private flow=0;private count=0;
 private dots:T.ShaderMaterial;private shell:T.ShaderMaterial;
 /** Chamber from x0 to the orifice at x1, model mm along +x at height y. */
 constructor(clips:T.Plane[],private x0:number,private x1:number,private y:number,private r0:number,private r1:number){
  this.geometry.setAttribute('position',new T.BufferAttribute(this.pos,3).setUsage(T.DynamicDrawUsage));
  this.geometry.setAttribute('aAlpha',new T.BufferAttribute(this.alive,1).setUsage(T.DynamicDrawUsage));
  this.dots=new T.ShaderMaterial({vertexShader:clipVert,fragmentShader:clipFrag,uniforms:{uPx:{value:1},uTint:{value:new T.Color('#9fe8ff')}},transparent:true,depthWrite:false,depthTest:false,blending:T.AdditiveBlending,clipping:true,clippingPlanes:clips});
  const points=new T.Points(this.geometry,this.dots);points.frustumCulled=false;points.renderOrder=240;
  const length=34,cone=new T.CylinderGeometry(length*Math.tan(.51),r1,length,64,1,true);
  cone.rotateZ(-Math.PI/2);cone.translate(x1+length/2,y,0);
  this.shell=new T.ShaderMaterial({vertexShader:coneVert,fragmentShader:coneFrag,uniforms:{uTint:{value:new T.Color('#bfefff')},uA:{value:0},uFrom:{value:x1},uLength:{value:length}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,clipping:true,clippingPlanes:clips});
  const shell=new T.Mesh(cone,this.shell);shell.renderOrder=230;
  this.group.add(points,shell);
 }
 get live(){return this.count;}
 /** flowing: liquid is leaving the orifice now. on: 0..1, how far into the dive. at: where the nozzle has been carried, model mm. */
 update(dt:number,flowing:boolean,on:number,at:T.Vector3,px:number){
  const {phi,u,speed,alive,pos}=this;
  this.group.visible=on>.02;this.group.position.copy(at);
  this.dots.uniforms.uPx.value=px;
  // Flow lingers a little after the stroke, so a short real spray stays readable.
  this.flow=flowing?1:Math.max(0,this.flow-dt*1.6);
  this.shell.uniforms.uA.value=on*Math.min(1,this.flow*1.4);
  let live=0;
  for(let i=0;i<SWIRL;i++){
   if(alive[i]<=0)continue;
   u[i]+=dt*speed[i];
   if(u[i]>=1){alive[i]=0;continue;}
   const k=u[i],r=this.r0+(this.r1-this.r0)*k*k;
   // Angular momentum is kept as the radius shrinks, so the spin quickens toward the orifice.
   phi[i]+=dt*speed[i]*9*(this.r0/r)**2;
   pos[i*3]=this.x0+(this.x1-this.x0)*k;pos[i*3+1]=this.y+Math.cos(phi[i])*r;pos[i*3+2]=Math.sin(phi[i])*r;
   alive[i]=on*Math.min(1,k*6)*(1-k*.4);live++;
  }
  this.count=live;
  this.carry+=(on>.02&&this.flow>0?900*this.flow:0)*dt;
  for(;this.carry>=1;this.carry--){const i=this.head;this.head=(i+1)%SWIRL;phi[i]=Math.random()*Math.PI*2;u[i]=0;speed[i]=rand(.9,1.4);alive[i]=.01;}
  (this.geometry.attributes.position as T.BufferAttribute).needsUpdate=(this.geometry.attributes.aAlpha as T.BufferAttribute).needsUpdate=true;
 }
}
