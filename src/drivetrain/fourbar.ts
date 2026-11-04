/** Four-bar linkages in closed form: coupler curves, a seeded atlas searched by Fourier descriptors, alignment, refinement and a chained leg. */
export type V=[number,number];
/** Ground O2=(0,0) to O4=(g,0); crank a from O2, coupler b from A to B, rocker c from O4; coupler point P at (p,q) in the A→B frame. */
export interface FourBar {g:number;a:number;b:number;c:number;p:number;q:number;branch:1|-1}
export interface Pose {A:V;B:V;P:V}
export const N=64,K=8;
const TAU=Math.PI*2;

/** Where the circles about a and c, radii ra and rc, cross; side picks which crossing. Null if they do not. */
export function crossing(a:V,ra:number,c:V,rc:number,side:1|-1):V|null{
 const dx=c[0]-a[0],dy=c[1]-a[1],d=Math.hypot(dx,dy);
 if(d<1e-12||d>ra+rc||d<Math.abs(ra-rc))return null;
 const x=(ra*ra-rc*rc+d*d)/(2*d),h=Math.sqrt(Math.max(0,ra*ra-x*x)),ex=dx/d,ey=dy/d;
 return [a[0]+x*ex-side*h*ey,a[1]+x*ey+side*h*ex];
}
export function pose(l:FourBar,theta:number):Pose|null{
 const A:V=[l.a*Math.cos(theta),l.a*Math.sin(theta)],B=crossing(A,l.b,[l.g,0],l.c,l.branch);if(!B)return null;
 const ux=(B[0]-A[0])/l.b,uy=(B[1]-A[1])/l.b;
 return {A,B,P:[A[0]+l.p*ux-l.q*uy,A[1]+l.p*uy+l.q*ux]};
}
/** Shortest plus longest no more than the other two, with the crank shortest: it turns all the way round. */
export function grashofCrank(l:FourBar){const s=[l.g,l.a,l.b,l.c].sort((x,y)=>x-y);return s[0]+s[3]<=s[1]+s[2]+1e-9&&(l.a<=Math.min(l.g,l.b,l.c)+1e-9||l.g<=Math.min(l.a,l.b,l.c)+1e-9);}
/** The coupler point over one crank turn, n samples, or null if the loop cannot close somewhere on the way. */
export function couplerCurve(l:FourBar,n=N):V[]|null{
 const out:V[]=[];for(let i=0;i<n;i++){const s=pose(l,i/n*TAU);if(!s)return null;out.push(s.P);}return out;
}
export function centroid(pts:V[]):V{let x=0,y=0;for(const p of pts){x+=p[0];y+=p[1];}return [x/pts.length,y/pts.length];}
export function length(pts:V[],closed=true){let s=0;for(let i=1;i<pts.length;i++)s+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);if(closed&&pts.length>1)s+=Math.hypot(pts[0][0]-pts.at(-1)![0],pts[0][1]-pts.at(-1)![1]);return s;}
/** n points evenly spaced along a closed polyline. */
export function resample(pts:V[],n=N):V[]{
 const ring=[...pts,pts[0]],cum=[0];for(let i=1;i<ring.length;i++)cum.push(cum[i-1]+Math.hypot(ring[i][0]-ring[i-1][0],ring[i][1]-ring[i-1][1]));
 const total=cum.at(-1)!,out:V[]=[];if(total<1e-12)return Array.from({length:n},()=>[pts[0][0],pts[0][1]] as V);
 let j=1;
 for(let i=0;i<n;i++){const t=i/n*total;while(j<cum.length-1&&cum[j]<t)j++;const u=(t-cum[j-1])/Math.max(1e-12,cum[j]-cum[j-1]);out.push([ring[j-1][0]+(ring[j][0]-ring[j-1][0])*u,ring[j-1][1]+(ring[j][1]-ring[j-1][1])*u]);}
 return out;
}
/** Harmonics ±1..±K of an evenly resampled curve, as magnitudes over their total: blind to place, size, turn, start, direction and mirror. */
export function descriptor(pts:V[],out=new Float32Array(2*K)):Float32Array{
 const c=centroid(pts),n=pts.length,mags:number[]=[];
 for(const k of [...Array(K)].flatMap((_,i)=>[i+1,-(i+1)])){
  let re=0,im=0;for(let t=0;t<n;t++){const a=-TAU*k*t/n,x=pts[t][0]-c[0],y=pts[t][1]-c[1];re+=x*Math.cos(a)-y*Math.sin(a);im+=x*Math.sin(a)+y*Math.cos(a);}
  mags.push(Math.hypot(re,im)/n);
 }
 // Traced the other way, +k and −k swap; a mirror image does the same. Keeping the stronger first harmonic first folds both away.
 if(mags[1]>mags[0])for(let i=0;i<K;i++){const t=mags[2*i];mags[2*i]=mags[2*i+1];mags[2*i+1]=t;}
 const total=Math.hypot(...mags)||1;mags.forEach((m,i)=>{out[i]=m/total;});return out;
}
/** Best similarity fit of curve C onto drawn D, both evenly resampled: over every start, both directions and the mirror image. err 0 is a perfect fit. */
export interface Fit {err:number;shift:number;reverse:boolean;mirror:boolean;z:V;cD:V;cC:V}
export function align(D:V[],C:V[]):Fit{
 const n=D.length,cD=centroid(D),c0=centroid(C),d=D.map(p=>[p[0]-cD[0],p[1]-cD[1]]);
 const dd=d.reduce((s,p)=>s+p[0]*p[0]+p[1]*p[1],0)||1;
 let best:Fit={err:Infinity,shift:0,reverse:false,mirror:false,z:[1,0],cD,cC:c0};
 for(const mirror of [false,true])for(const reverse of [false,true]){
  const c=C.map((_,i)=>{const p=C[reverse?(n-i)%n:i];return [p[0]-c0[0],mirror?-(p[1]-c0[1]):p[1]-c0[1]] as V;}),cc=c.reduce((s,p)=>s+p[0]*p[0]+p[1]*p[1],0)||1;
  for(let s=0;s<n;s++){
   // Σ D·conj(C), as complex numbers: the scale-and-turn that best lays C on D.
   let re=0,im=0;for(let k=0;k<n;k++){const a=d[k],b=c[(k+s)%n];re+=a[0]*b[0]+a[1]*b[1];im+=a[1]*b[0]-a[0]*b[1];}
   const err=1-(re*re+im*im)/(dd*cc);
   if(err<best.err)best={err,shift:s,reverse,mirror,z:[re/cc,im/cc],cD,cC:[c0[0],mirror?-c0[1]:c0[1]]};
  }
 }
 return best;
}
/** A linkage point, in its own frame, laid onto the drawing by a fit. */
export function place(fit:Fit,p:V):V{
 const x=p[0]-fit.cC[0],y=(fit.mirror?-p[1]:p[1])-fit.cC[1],[zr,zi]=fit.z;
 return [fit.cD[0]+zr*x-zi*y,fit.cD[1]+zr*y+zi*x];
}
export const fitScale=(fit:Fit)=>Math.hypot(fit.z[0],fit.z[1]);

/** Small seeded generator, so the atlas is the same on every load and in tests. */
export function rng(seed:number){let s=seed>>>0||1;return ()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
export interface Match {linkage:FourBar;fit:Fit;err:number;score?:number}
export class Atlas {
 readonly entries:FourBar[]=[];readonly features:Float32Array;
 private constructor(entries:FourBar[],features:Float32Array){this.entries=entries;this.features=features;}
 /** Crank-rockers and drag links with coupler points spread around the coupler: a few hundred kilobytes, built in tens of milliseconds. */
 static build(count=6000,seed=29):Atlas{
  const r=rng(seed),list:FourBar[]=[],feats=new Float32Array(count*2*K),f=new Float32Array(2*K);
  for(let guard=0;list.length<count&&guard<count*40;guard++){
   const drag=r()<.18,g=1,a=drag?1.2+r()*1.4:.12+r()*.55,b=.35+r()*2.4,c=.35+r()*2.4;
   const l:FourBar={g,a,b,c,p:(r()*2-.5)*b*1.3,q:(r()*2-1)*b*1.1,branch:r()<.5?1:-1};
   if(!grashofCrank(l))continue;
   const curve=couplerCurve(l,N);if(!curve)continue;
   const even=resample(curve,N);if(length(even)<.05)continue;
   descriptor(even,f);feats.set(f,list.length*2*K);list.push(l);
  }
  return new Atlas(list,feats.subarray(0,list.length*2*K));
 }
 get bytes(){return this.features.byteLength+this.entries.length*7*8;}
 /** Descriptor search, then a true fit of the nearest, then refinement of the best few distinct shapes. */
 match(path:V[],k=3,shortlist=220,iterations=260,bounds?:Bounds):Match[]{
  const D=resample(path,N),f=descriptor(D),n=this.entries.length,scores:{i:number;s:number}[]=[];
  for(let i=0;i<n;i++){let s=0;for(let j=0;j<2*K;j++){const e=this.features[i*2*K+j]-f[j];s+=e*e;}scores.push({i,s});}
  scores.sort((x,y)=>x.s-y.s);
  const fitted=scores.slice(0,shortlist).map(({i})=>{const l=this.entries[i],c=cost(l,D,bounds);return {linkage:l,fit:c.fit!,err:c.err};}).filter(m=>m.fit).sort((x,y)=>x.err-y.err).slice(0,24);
  const picked:Match[]=[];
  for(const m of fitted){if(picked.length>=k)break;if(picked.some(p=>Math.abs(p.err-m.err)<.002&&Math.abs(p.linkage.a/p.linkage.b-m.linkage.a/m.linkage.b)<.05))continue;picked.push(m);}
  const out=picked.map(m=>refine(m.linkage,D,iterations,bounds)).sort((x,y)=>(x.score??x.err)-(y.score??y.err));
  // The closest shape regardless of size joins as the last choice when it is clearly better: big, but honest.
  const loose=fitted.reduce((p,q)=>q.fit.err<p.fit.err?q:p,fitted[0]);
  if(loose){const keep={...tuning};Object.assign(tuning,{spread:0,outside:0});const m=refine(loose.linkage,D,iterations);Object.assign(tuning,keep);if(out.length&&m.err<out[0].err*.5)out[Math.min(out.length,k-1)]=m;}
  return out;
 }
}
/** Error of a linkage against an evenly resampled drawing; a loop that cannot close costs more than any fit. */
export interface Bounds {x0:number;x1:number;y0:number;y1:number}
export function cost(l:FourBar,D:V[],bounds?:Bounds):{err:number;fit:Fit|null;spread:number}{
 if(l.a<=0||l.b<=0||l.c<=0||!grashofCrank(l))return {err:2,fit:null,spread:Infinity};
 const curve=couplerCurve(l,N);if(!curve)return {err:2,fit:null,spread:Infinity};
 const even=resample(curve,N);if(length(even)<1e-3)return {err:2,fit:null,spread:Infinity};
 const fit=align(D,even),r=spread(l,fit,curve,D);return {err:fit.err+tuning.spread*Math.max(0,r-tuning.free)**2+(bounds?outside(l,fit,bounds,D):0),fit,spread:r};
}
/** How much bigger than the drawing the whole linkage is, pivots and swept links included. A fit that needs a crane to draw a coin is not useful. */
/** Penalty weights: how much bigger than the drawing a linkage may be for free, and what reaching off the board costs. */
export const tuning={spread:.002,free:3,outside:.03};
/** Pivots and swept links that leave the board, as squared overshoot in drawing sizes. */
export function outside(l:FourBar,fit:Fit,b:Bounds,D:V[]){
 const xs=D.map(p=>p[0]),ys=D.map(p=>p[1]),size=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1);let o=0;
 for(const p of ([[0,0],[l.g,0],[-l.a,0],[l.a,0],[0,-l.a],[0,l.a],[l.g-l.c,0],[l.g+l.c,0],[l.g,-l.c],[l.g,l.c]] as V[]).map(q=>place(fit,q))){const dx=Math.max(0,b.x0-p[0],p[0]-b.x1),dy=Math.max(0,b.y0-p[1],p[1]-b.y1);o+=(dx*dx+dy*dy)/(size*size);}
 return tuning.outside*o;
}
export function spread(l:FourBar,fit:Fit,curve:V[],D:V[]){
 const pts:V[]=([[-l.a,-l.a],[l.a,l.a],[l.g-l.c,-l.c],[l.g+l.c,l.c],...curve] as V[]).map(p=>place(fit,p));
 const box=(q:V[])=>{const xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);return Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));};
 return box([...pts,...D])/Math.max(1e-9,box(D));
}
/** Nelder–Mead over crank, coupler, rocker and coupler point, the ground held at 1. */
export function refine(start:FourBar,D:V[],iterations=160,bounds?:Bounds):Match{
 const toL=(x:number[]):FourBar=>({g:1,a:x[0],b:x[1],c:x[2],p:x[3],q:x[4],branch:start.branch}),f=(x:number[])=>cost(toL(x),D,bounds).err;
 const x0=[start.a,start.b,start.c,start.p,start.q],simplex=[x0,...x0.map((_,i)=>x0.map((v,j)=>j===i?v+(Math.abs(v)*.08||.05):v))];
 let values=simplex.map(f);
 for(let it=0;it<iterations;it++){
  const order=values.map((v,i)=>i).sort((a,b)=>values[a]-values[b]);
  const s=order.map(i=>simplex[i]),v=order.map(i=>values[i]);simplex.splice(0,simplex.length,...s);values=v;
  if(v[v.length-1]-v[0]<1e-7)break;
  const n=x0.length,c=x0.map((_,j)=>s.slice(0,n).reduce((t,p)=>t+p[j],0)/n),worst=s[n];
  const at=(t:number)=>c.map((cj,j)=>cj+t*(worst[j]-cj)),r=at(-1),fr=f(r);
  if(fr<v[0]){const e=at(-2),fe=f(e);if(fe<fr){s[n]=e;v[n]=fe;}else{s[n]=r;v[n]=fr;}}
  else if(fr<v[n-1]){s[n]=r;v[n]=fr;}
  else{const k=at(fr<v[n]?-.5:.5),fk=f(k);if(fk<Math.min(fr,v[n])){s[n]=k;v[n]=fk;}else for(let i=1;i<=n;i++){s[i]=s[i].map((x,j)=>s[0][j]+(x-s[0][j])*.5);v[i]=f(s[i]);}}
  values=v;
 }
 const i=values.indexOf(Math.min(...values)),l=toL(simplex[i]),r=cost(l,D,bounds);
 if(!r.fit){const s0=cost(start,D,bounds);return {linkage:start,fit:s0.fit!,err:s0.fit!.err,score:s0.err};}
 // err is the honest shape error; score carries the penalties that ranked it.
 return {linkage:l,fit:r.fit,err:r.fit.err,score:r.err};
}

// ---- A second linkage chained on: a leg ----
/** A dyad from the coupler point to a new ground pivot G meets at the knee; the foot carries on past the knee along the thigh. Board coordinates. */
export interface Leg {G:V;thigh:number;shin:number;reach:number;side:1|-1;ground:number}
export function legPose(P:V,leg:Leg):{knee:V;foot:V}|null{
 const knee=crossing(P,leg.thigh,leg.G,leg.shin,leg.side);if(!knee)return null;
 return {knee,foot:[P[0]+(knee[0]-P[0])*(1+leg.reach),P[1]+(knee[1]-P[1])*(1+leg.reach)]};
}
/** Searches a few hundred dyads for the foot path with the longest, flattest bottom: the stance of a walking leg. */
export function chainLeg(path:V[],seed=7,bounds?:Bounds):{leg:Leg;feet:V[];score:number}|null{
 const r=rng(seed),c=centroid(path),xs=path.map(p=>p[0]),ys=path.map(p=>p[1]),size=Math.max((Math.max(...xs)-Math.min(...xs)+Math.max(...ys)-Math.min(...ys))/2,1);
 const off=(p:V)=>!!bounds&&(p[0]<bounds.x0||p[0]>bounds.x1||p[1]<bounds.y0||p[1]>bounds.y1);
 let best:{leg:Leg;feet:V[];score:number}|null=null;
 for(let t=0;t<2400;t++){
  const leg:Leg={G:[c[0]+(r()*2-1)*size,c[1]+(r()*1.2-.3)*size],thigh:size*(.5+r()*1.1),shin:size*(.4+r()*1.1),reach:r()*.7,side:r()<.5?1:-1,ground:0};
  const feet:V[]=[];let ok=true;
  for(const P of path){const s=legPose(P,leg);if(!s){ok=false;break;}feet.push(s.foot);}
  if(!ok||off(leg.G)||feet.some(off))continue;
  const fy=feet.map(p=>p[1]),low=Math.min(...fy),high=Math.max(...fy),lift=high-low;if(lift<size*.15)continue;
  // Stance: every point within a tenth of the lift of the lowest; the foot should stay flat across a wide stretch of it.
  const stance=feet.filter(p=>p[1]<low+lift*.1),span=Math.max(...stance.map(p=>p[0]))-Math.min(...stance.map(p=>p[0]));
  const share=stance.length/feet.length,fx=feet.map(p=>p[0]),stride=Math.max(...fx)-Math.min(...fx);
  if(share<.25||share>.7||feet.some(p=>p[1]>c[1]+size*.3||Math.abs(p[0]-c[0])>size*1.6||p[1]<c[1]-size*2.2))continue;
  const score=span/size*Math.min(1,stride/size)*Math.sqrt(share)-Math.abs(stance.reduce((s,p)=>s+p[1],0)/stance.length-low)/size;
  if(!best||score>best.score){leg.ground=low;best={leg,feet,score};}
 }
 return best;
}
