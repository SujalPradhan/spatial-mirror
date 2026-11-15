import * as T from 'three';

/** Scene units: the bench top is y=0, the burette's zero mark and 50 mark fix the scale of the scale. */
export const BENCH_Y=-3.6,TILE_TOP=BENCH_Y+.12;
export const BURETTE={x:0,zero:5.9,fifty:1.5,tip:.55,radius:.24,top:6.5};
/** y of a burette reading (cm3 down from the zero mark). */
export const buretteY=(reading:number)=>BURETTE.zero-(BURETTE.zero-BURETTE.fifty)*Math.max(-3,Math.min(50,reading))/50;

const V=(r:number,y:number)=>new T.Vector2(r,y);
/** Outer profile of a 250 cm3 conical flask, base at y=0, as (radius, y) from the centre line outwards. */
export const FLASK_OUTER=[V(0,0),V(1.28,0),V(1.4,.08),V(.42,2.5),V(.4,2.6),V(.4,3.1),V(.47,3.22),V(.47,3.3)];
export const FLASK_INNER=[V(0,.07),V(1.24,.07),V(1.33,.14),V(.37,2.5),V(.35,2.6),V(.35,3.1)];
const radiusAt=(y:number)=>{
 const p=FLASK_INNER;
 for(let i=1;i<p.length;i++)if(y<=p[i].y&&p[i].y>p[i-1].y)return p[i-1].x+(p[i].x-p[i-1].x)*(y-p[i-1].y)/(p[i].y-p[i-1].y);
 return p[p.length-1].x;
};
const LEVELS:{y:number;v:number}[]=[];
{let vol=0,y0=.07;for(let k=1;k<=60;k++){const y=.07+(2.6-.07)*k/60,r=(radiusAt(y)+radiusAt(y0))/2;vol+=Math.PI*r*r*(y-y0);LEVELS.push({y,v:vol});y0=y;}}
/** Liquid height in the flask for a volume in cm3, scaled so 210 cm3 reaches the shoulder. */
export function flaskLevel(cm3:number){
 const full=LEVELS[LEVELS.length-1].v,v=Math.max(0,cm3)/210*full;
 if(v<=0)return .07;
 for(let i=0;i<LEVELS.length;i++)if(v<=LEVELS[i].v){const a=i?LEVELS[i-1]:{y:.07,v:0},b=LEVELS[i];return a.y+(b.y-a.y)*(v-a.v)/(b.v-a.v);}
 return 2.6;
}
export function flaskLiquid(level:number){
 const pts=[V(0,.07)];
 for(const p of FLASK_INNER.slice(1)){if(p.y>=level)break;pts.push(V(p.x,p.y));}
 pts.push(V(Math.min(radiusAt(level),FLASK_INNER[1].x),level),V(0,level));
 return new T.LatheGeometry(pts,48);
}

/** A see-through glass look: pale body, brighter where the surface turns away. */
export function glassMaterial(strength=.5){
 return new T.ShaderMaterial({
  transparent:true,depthWrite:false,side:T.DoubleSide,uniforms:{k:{value:strength}},
  vertexShader:'varying vec3 n;varying vec3 v;void main(){vec4 m=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-m.xyz);gl_Position=projectionMatrix*m;}',
  fragmentShader:'uniform float k;varying vec3 n;varying vec3 v;void main(){float f=pow(1.-abs(dot(normalize(n),normalize(v))),2.2);gl_FragColor=vec4(vec3(.78,.9,1.)*(.55+.45*f),(.05+f*.55)*k);}',
 });
}
const lathe=(points:T.Vector2[],material:T.Material,segments=40)=>new T.Mesh(new T.LatheGeometry(points,segments),material);

export function buildFlask(){
 return lathe(FLASK_OUTER,glassMaterial(.9),56);
}
export function buildBurette(){
 const g=new T.Group(),r=BURETTE.radius,glass=glassMaterial(.8);
 const body=lathe([V(0,BURETTE.top),V(r*1.15,BURETTE.top),V(r,BURETTE.top-.08),V(r,1.25),V(r*.55,1.1),V(r*.3,.8),V(r*.2,BURETTE.tip)],glass,32);
 g.add(body);
 const tap=new T.Group(),metal=new T.MeshStandardMaterial({color:'#b9c2cc',roughness:.4,metalness:.6});
 const barrel=new T.Mesh(new T.CylinderGeometry(.19,.19,.7,20),new T.MeshStandardMaterial({color:'#dfe6ee',roughness:.35,transparent:true,opacity:.85}));barrel.rotation.z=Math.PI/2;
 const key=new T.Mesh(new T.BoxGeometry(.9,.14,.26),new T.MeshStandardMaterial({color:'#2d7be0',roughness:.5}));key.name='key';
 tap.add(barrel,key);tap.position.set(0,1.2,0);tap.add(new T.Mesh(new T.CylinderGeometry(.05,.05,.8,8),metal));
 g.add(tap);
 return {group:g,key,tap};
}
/** Graduation marks as a texture for a half-pipe in front of the tube: a number every 5 cm3, a long mark every 1, short every 0.5. */
export function graduationTexture(){
 const c=document.createElement('canvas');c.width=160;c.height=1024;
 const x=c.getContext('2d');
 if(x){
  x.clearRect(0,0,160,1024);x.strokeStyle='#e8f1fa';x.fillStyle='#e8f1fa';x.lineWidth=2;x.font='bold 24px system-ui,sans-serif';x.textAlign='right';
  const top=1024*(BURETTE.top-BURETTE.zero)/(BURETTE.top-BURETTE.tip),span=1024*(BURETTE.zero-BURETTE.fifty)/(BURETTE.top-BURETTE.tip);
  for(let k=0;k<=100;k++){
   const y=top+span*k/100,main=k%2===0,five=k%10===0,len=five?70:main?46:26;
   x.beginPath();x.moveTo(100,y);x.lineTo(100+len*.8,y);x.stroke();
   if(five)x.fillText(String(k/2),92,y+8);
  }
 }
 const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;
}
export function buildPipette(){
 const g=new T.Group(),glass=glassMaterial(.8);
 g.add(lathe([V(0,0),V(.05,.02),V(.06,.7),V(.12,.9),V(.36,1.6),V(.4,2.2),V(.36,2.8),V(.12,3.4),V(.07,3.6),V(.07,6.4),V(0,6.45)],glass,28));
 const mark=new T.Mesh(new T.TorusGeometry(.075,.012,6,20),new T.MeshBasicMaterial({color:'#2a62b0'}));mark.rotation.x=Math.PI/2;mark.position.y=5.3;g.add(mark);
 return g;
}
export function buildStand(){
 const g=new T.Group(),metal=new T.MeshStandardMaterial({color:'#4a5663',roughness:.5,metalness:.55}),rodX=-2.3,armY=4.4;
 const base=new T.Mesh(new T.BoxGeometry(3,.18,2.2),metal);base.position.set(rodX+.3,BENCH_Y+.09,-.6);
 const height=BURETTE.top-BENCH_Y+.2,rod=new T.Mesh(new T.CylinderGeometry(.075,.075,height,16),metal);rod.position.set(rodX,BENCH_Y+height/2,-.6);
 const arm=new T.Mesh(new T.CylinderGeometry(.05,.05,rodX*-1-.25,12),metal);arm.rotation.z=Math.PI/2;arm.position.set(rodX/2-.12,armY,-.6);
 const boss=new T.Mesh(new T.BoxGeometry(.34,.24,.34),metal);boss.position.set(rodX,armY,-.6);
 const ring=new T.Mesh(new T.TorusGeometry(BURETTE.radius+.04,.05,8,28),metal);ring.rotation.x=Math.PI/2;ring.position.set(BURETTE.x,armY,-.02);
 const link=new T.Mesh(new T.CylinderGeometry(.04,.04,.6,8),metal);link.rotation.x=Math.PI/2;link.position.set(BURETTE.x,armY,-.32);
 g.add(base,rod,arm,boss,ring,link);return g;
}

/** A text label on a canvas, for bottles and sprites. */
export function labelTexture(lines:string[],width:number,height:number,ink='#0d2238',paper='rgba(246,248,251,.94)',size=34){
 const c=document.createElement('canvas');c.width=width;c.height=height;
 const x=c.getContext('2d');
 if(x){
  x.fillStyle=paper;x.beginPath();x.roundRect(2,2,width-4,height-4,height/5);x.fill();
  x.fillStyle=ink;x.textAlign='center';x.textBaseline='middle';
  lines.forEach((line,i)=>{x.font=`${i?500:700} ${i?size*.8:size}px system-ui,sans-serif`;x.fillText(line,width/2,height*(i+1)/(lines.length+1));});
 }
 const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
export const BEAKER={waste:{r:1.1,h:1.7},acid:{r:.95,h:1.6}};
/** A beaker with its base at y=0, and a liquid cylinder of height 1 to scale from the base. */
export function buildBeaker(r:number,h:number,liquid:string){
 const g=new T.Group();
 g.add(lathe([V(0,0),V(r,0),V(r+.02,.06),V(r+.02,h),V(r+.1,h+.05)],glassMaterial(.9),44));
 const l=new T.Mesh(new T.CylinderGeometry(r-.05,r-.05,1,32),new T.MeshStandardMaterial({color:liquid,transparent:true,opacity:.6,roughness:.2}));
 l.name='liquid';l.renderOrder=1;g.add(l);
 return g;
}
/** The reagent bottle: 2.3 tall, base at y=0, with a label on the front. */
export function buildBottle(){
 const g=new T.Group();
 g.add(lathe([V(0,0),V(.55,0),V(.6,.1),V(.6,1.5),V(.36,1.9),V(.26,1.98),V(.26,2.1)],glassMaterial(.9),36));
 const l=new T.Mesh(new T.CylinderGeometry(.52,.52,1.3,28),new T.MeshStandardMaterial({color:'#cfe6f6',transparent:true,opacity:.55,roughness:.2}));l.position.y=.78;l.renderOrder=1;g.add(l);
 const cap=new T.Mesh(new T.CylinderGeometry(.3,.3,.2,20),new T.MeshStandardMaterial({color:'#2d3a49',roughness:.6}));cap.position.y=2.2;g.add(cap);
 const label=new T.Mesh(new T.PlaneGeometry(.95,.7),new T.MeshBasicMaterial({map:labelTexture(['NaOH','0.100 M'],256,192,'#0d2238','#f6f8fb',58),transparent:true}));
 label.position.set(0,.8,.62);label.renderOrder=3;g.add(label);
 return g;
}
export function buildGoggles(){
 const g=new T.Group(),frame=new T.MeshStandardMaterial({color:'#2f8f5b',roughness:.5}),lens=new T.MeshStandardMaterial({color:'#bfe8ff',transparent:true,opacity:.55,roughness:.1});
 for(const sx of [-.4,.4]){
  const ring=new T.Mesh(new T.TorusGeometry(.3,.07,10,24),frame);ring.position.set(sx,.3,0);
  const disc=new T.Mesh(new T.CircleGeometry(.3,24),lens);disc.position.set(sx,.3,0);g.add(ring,disc);
 }
 const bridge=new T.Mesh(new T.BoxGeometry(.2,.09,.09),frame);bridge.position.set(0,.34,0);
 const strap=new T.Mesh(new T.BoxGeometry(1.9,.09,.05),new T.MeshStandardMaterial({color:'#24303d',roughness:.8}));strap.position.set(0,.3,-.1);
 g.add(bridge,strap);return g;
}
export const DROPPER_TINT:Record<string,string>={'dropper-phenolphthalein':'#e6edf4','dropper-methyl-orange':'#f0a23c','dropper-universal':'#6fc25f'};
/** A glass dropper with a rubber bulb: 2 tall, tip at y=0. */
export function buildDropper(tint:string){
 const g=new T.Group();
 g.add(lathe([V(0,0),V(.03,.05),V(.1,.7),V(.1,1.5)],glassMaterial(.9),16));
 const liquid=new T.Mesh(new T.CylinderGeometry(.075,.075,.9,12),new T.MeshStandardMaterial({color:tint,roughness:.3}));liquid.position.y=.55;liquid.renderOrder=1;g.add(liquid);
 const bulb=new T.Mesh(new T.CapsuleGeometry(.17,.3,6,14),new T.MeshStandardMaterial({color:'#2d3a49',roughness:.7}));bulb.position.y=1.75;g.add(bulb);
 return g;
}
/** A funnel for the top of the burette: its spout ends at y=0. */
export function buildFunnel(){return lathe([V(.08,0),V(.1,.3),V(.78,.95),V(.84,1.02)],glassMaterial(.9),32);}
