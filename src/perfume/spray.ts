import * as T from 'three';
import type {Spray} from './model';

const MAX=4000;
const rand=(a:number,b:number)=>a+Math.random()*(b-a);
/** One Points cloud in model millimetres, so it follows the object through pose and scale. */
export class PumpSpray {
 private pos=new Float32Array(MAX*3);private vel=new Float32Array(MAX*3);private age=new Float32Array(MAX*2);
 private size=new Float32Array(MAX);private alive=new Float32Array(MAX);private sink=new Float32Array(MAX);private slow=new Float32Array(MAX);
 private head=0;private carry=0;private cloud=new T.BufferGeometry();
 private droplets=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,uniforms:{uPx:{value:1}},
  vertexShader:`attribute float aSize,aAlpha;uniform float uPx;varying float vA;void main(){vA=aAlpha;vec4 m=modelViewMatrix*vec4(position,1.);gl_PointSize=aAlpha>0.?max(1.,uPx*aSize/-m.z):0.;gl_Position=projectionMatrix*m;}`,
  fragmentShader:`varying float vA;void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;float a=exp(-r*3.)*vA;gl_FragColor=vec4(vec3(1.,.93,.78)*a,a);}`});
 readonly points:T.Points;
 constructor(){
  this.cloud.setAttribute('position',new T.BufferAttribute(this.pos,3).setUsage(T.DynamicDrawUsage));
  this.cloud.setAttribute('aSize',new T.BufferAttribute(this.size,1).setUsage(T.DynamicDrawUsage));
  this.cloud.setAttribute('aAlpha',new T.BufferAttribute(this.alive,1).setUsage(T.DynamicDrawUsage));
  this.points=new T.Points(this.cloud,this.droplets);this.points.frustumCulled=false;this.points.renderOrder=200;
 }
 /** Fires one droplet along +x, tilted `spread` radians off the axis, with `spin` mm/s about it. */
 private emit(x:number,y:number,z:number,spread:number,speed:number,spin:number,ttl:number,mm:number,ring:number,dt:number,fall:number,drag:number){
  const {pos,vel,age,size,alive,sink,slow}=this,i=this.head;this.head=(i+1)%MAX;
  const a=Math.random()*Math.PI*2,c=Math.cos(a),s=Math.sin(a),out=Math.sin(spread)*speed;
  pos[i*3]=x;pos[i*3+1]=y+c*ring;pos[i*3+2]=z+s*ring;
  vel[i*3]=Math.cos(spread)*speed;vel[i*3+1]=c*out-s*spin;vel[i*3+2]=s*out+c*spin;
  // Spread through the frame, so a long frame does not leave a gap at the orifice.
  const ahead=Math.random()*dt;
  for(let n=0;n<3;n++)pos[i*3+n]+=vel[i*3+n]*ahead;
  age[i*2]=ahead;age[i*2+1]=ttl;size[i]=mm;alive[i]=1;sink[i]=fall;slow[i]=drag;
 }
 update(kind:Spray,x:number,y:number,z:number,dt:number,px:number){
  const {pos,vel,age,alive,sink,slow}=this;
  this.droplets.uniforms.uPx.value=px;
  const rate=kind==='mist'?5200:kind==='jet'?1500:kind==='sputter'?(Math.sin(performance.now()/23)>.2?900:0):kind==='dribble'?26:0;
  for(let i=0;i<MAX;i++){
   if(alive[i]<=0)continue;
   const t=age[i*2]+=dt,life=age[i*2+1];
   if(t>=life){alive[i]=0;continue;}
   const drag=Math.exp(-dt*slow[i]);
   vel[i*3]*=drag;vel[i*3+1]=vel[i*3+1]*drag-sink[i]*dt;vel[i*3+2]*=drag;
   pos[i*3]+=vel[i*3]*dt;pos[i*3+1]+=vel[i*3+1]*dt;pos[i*3+2]+=vel[i*3+2]*dt;
   alive[i]=(1-t/life)*.8;
  }
  this.carry+=rate*dt;
  for(;this.carry>=1;this.carry--){
   // Hollow cone: droplets leave on a shell, not through the middle.
   if(kind==='mist')this.emit(x,y,z,rand(.46,.56),rand(120,300),rand(30,70),rand(.45,.95),rand(.5,1.1),.28,dt,14,3.4);
   else if(kind==='jet')this.emit(x,y,z,rand(0,.02),rand(420,520),0,rand(.35,.6),1.2,.05,dt,110,.6);
   else if(kind==='sputter')this.emit(x,y,z,rand(0,.5),rand(60,260),0,rand(.2,.5),rand(.8,1.7),.2,dt,320,1);
   else this.emit(x,y,z,rand(0,.3),rand(4,14),0,1.1,1.5,.1,dt,320,1);
  }
  for(const name of ['position','aSize','aAlpha'])(this.cloud.attributes[name] as T.BufferAttribute).needsUpdate=true;
 }
 /** How many droplets are in the air, for tests. */
 get live(){let n=0;for(let i=0;i<MAX;i++)if(this.alive[i]>0)n++;return n;}
}
