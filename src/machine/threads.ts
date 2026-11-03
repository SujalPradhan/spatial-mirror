import {PITCH} from './model';
import type {MachineOptions,MachineState,Stitch} from './model';
import {dims,type P} from './parts';

/** Threads are authored from the crank angle: no physics, and length is not conserved. */
const {hook:CENTRE,caseR:CASE_R,caseW:CASE_W,hookOut:HOOK_OUT,clothTop:CLOTH_TOP,clothUnder:CLOTH_UNDER,needleZ:NEEDLE_Z,takeUp:TAKE_UP}=dims;
const LOOP_Z=CASE_W+.9,FIRST_LOCK=-PITCH,LOOSE_LOCK=-6,TAIL=44;
export const LOCKS_DRAWN=16;
const SPOOL:P[]=[[102,146,0],[97,163,1],[92,166,0],[62,137,0],[34,118,24],[32,104,25.5],[34,94,27],[33,80,27],[30,74,26.5],[27,69,25.5],[23,74,26]];
const GUIDES_DOWN:P[]=[[4,58,25],[3,41,21],[2.2,36,14],[1.2,35,4]];
const BOBBIN_EXIT:P=[2.5,-15.7,0];
const mix=(a:number,b:number,u:number)=>a+(b-a)*u;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const smooth=(n:number)=>{const u=clamp(n,0,1);return u*u*(3-2*u);};
const lerp3=(a:P,b:P,u:number):P=>[mix(a[0],b[0],u),mix(a[1],b[1],u),mix(a[2],b[2],u)];

const lockY=(s:{kind:string})=>s.kind==='loose'?LOOSE_LOCK:0;
const lastLock=(list:Stitch[])=>{for(let i=list.length-1;i>=0;i--)if(list[i].locked)return list[i];return null;};
/** A loop's front or back leg: leaves the hole, spreads over a case face, rejoins at the apex, bowed so the pair reads as an open loop. */
function leg(from:P,apex:P,side:1|-1):P[] {
 const dx=apex[0]-from[0],dy=apex[1]-from[1],len=Math.hypot(dx,dy)||1,bow=Math.min(len*.34,14.5)*side,spread=clamp(len*.7,.36,LOOP_Z)*side,out:P[]=[];
 for(let i=1;i<14;i++){
  const u=i/14,up=smooth(u/.24)*(1-smooth((u-.86)/.14)),b=bow*Math.sin(Math.PI*u)**.8;
  out.push([from[0]+dx*u+(-dy/len)*b,from[1]+dy*u+(dx/len)*b,mix(from[2],apex[2],u)+spread*up]);
 }
 return out;
}
function apexOf(s:MachineState,hole:number):P {
 const a=s.loop.apexDeg*Math.PI/180,settle=s.loop.stage==='casting'||s.loop.stage==='pulling'?smooth((s.loop.apexDeg-190)/120):0,r=mix(HOOK_OUT+.7,CASE_R+1.4,settle);
 // Taken from where the thrown bulge stands, so the catch has no jump.
 const rim=lerp3([-3,s.eye+(CLOTH_UNDER-s.eye)*.3,-4.2],[r*Math.sin(a),CENTRE[1]+r*Math.cos(a),0],smooth(s.loop.apexDeg/45));
 if(s.loop.stage!=='pulling')return rim;
 const target=s.outcome==='single-thread'?CLOTH_TOP+.2:s.outcome==='loose'?LOOSE_LOCK-.25:-.25;
 return lerp3(rim,[hole,target,0],s.loop.pull);
}
export function topPath(s:MachineState,o:MachineOptions):P[] {
 const pts:P[]=[...SPOOL],hole=0,e=s.eye,lock=lastLock(s.stitches),lx=(lock?lock.x:FIRST_LOCK)-s.clothTravel,ly=lock?lockY(lock):0;
 if(!o.removed?.includes('takeUp'))pts.push([TAKE_UP[0]+s.takeUp.x+.8,TAKE_UP[1]+s.takeUp.y-1,TAKE_UP[2]-.6],[TAKE_UP[0]+s.takeUp.x,TAKE_UP[1]+s.takeUp.y,TAKE_UP[2]],[TAKE_UP[0]+s.takeUp.x-.8,TAKE_UP[1]+s.takeUp.y-1,TAKE_UP[2]+.2]);
 pts.push(...GUIDES_DOWN,[0,e+21.1,NEEDLE_Z+2.2],[0,e+12,NEEDLE_Z+.6],[0,e+6,NEEDLE_Z+.5],[0,e+1,NEEDLE_Z+.5],[0,e+.1,NEEDLE_Z+.2],[0,e,NEEDLE_Z-.3],[0,e-.2,NEEDLE_Z-1]);
 const surface:P[]=[[hole,CLOTH_TOP+.3,0],[hole-1.4,CLOTH_TOP+.28,0],[lx+1.4,CLOTH_TOP+.28,0],[lx+.3,CLOTH_TOP+.05,-.2],[lx,ly+.6,-.36],[lx,ly-.25,0]];
 const above=e>CLOTH_TOP,below=e<CLOTH_UNDER,under:P=[hole,CLOTH_UNDER-.2,.1],through:P[]=above?[surface[0],under]:below?[]:[under];
 if(s.loop.stage==='carried'||s.loop.stage==='casting'||s.loop.stage==='pulling'){
  const apex=apexOf(s,hole),start:P=below?[0,e-.4,0]:under;
  pts.push(...through,...leg(start,apex,1),apex,...leg(start,apex,-1).reverse());
  if(below)pts.push(under);
  pts.push(...(s.loop.pull>.98?surface.slice(0,1):[under,surface[0]]),...surface.slice(1));
  return pts;
 }
 if(above){if(lx<-1.5*PITCH)pts.push([-PITCH*.6,CLOTH_TOP+.3,-.1]);pts.push([lx+.3,CLOTH_TOP+.3,-.1],[lx+.05,CLOTH_TOP-.1,-.3],[lx,ly+.6,-.36],[lx,ly-.25,0]);return pts;}
 const o2=s.loop.open,gap=Math.max(.1,CLOTH_UNDER-e);
 if(below)pts.push([-1.2*o2,e+gap*.08,-.8-2.2*o2],[-3*o2,e+gap*.2,-.9-3.8*o2],[-3.2*o2,e+gap*.38,-.9-3.4*o2],[-1.2*o2,e+gap*.66,-.6-1.4*o2],[hole,CLOTH_UNDER-.2,-.1]);
 pts.push(surface[0],...surface.slice(1));
 return pts;
}
export function bobbinPath(s:MachineState,o:MachineOptions):P[] {
 if(o.removed?.includes('bobbin'))return [];
 const pts:P[]=[[7,-22,3],[5.5,-18.2,3.4],[3.8,-16.6,3.2],BOBBIN_EXIT],lock=lastLock(s.stitches),lx=(lock?lock.x:FIRST_LOCK)-s.clothTravel,ly=lock?lockY(lock):0,y=Math.min(CLOTH_UNDER-.3,ly),end:P[]=[[lx+1.3,y,0],[lx+.4,ly-.3,0],[lx,ly+.55,0]];
 if(s.loop.stage==='pulling'){
  const a=apexOf(s,0),f=(a[1]-BOBBIN_EXIT[1])/(end[0][1]-BOBBIN_EXIT[1]),line=mix(BOBBIN_EXIT[0],end[0][0],f);
  // The bobbin strand is only dragged once the apex has crossed it, so the catch happens on screen.
  if(a[0]>line){
   pts.push([a[0]+.35,a[1]-.15,0],[a[0],a[1]+.55,0]);
   if(a[1]>CLOTH_UNDER-.5)pts.push([-.35,-.8,0],[-1.2,y,0]);
  }
 }
 if(lx<-1.5*PITCH)pts.push([-PITCH*.6,CLOTH_UNDER-.3,0]);
 pts.push(...end);return pts;
}
/** Settled thread in cloth coordinates, as one strand per side from the tail to the newest lock. */
export function settledPaths(list:Stitch[]):{top:P[];bobbin:P[]} {
 const locks=list.filter(s=>s.locked).slice(-LOCKS_DRAWN),first=locks[0]?.index??0,start=first?locks[0].x:FIRST_LOCK;
 const top:P[]=[[start-TAIL,CLOTH_TOP+.28,0],[start-TAIL/2,CLOTH_TOP+.28,0]],bobbin:P[]=[[start-TAIL,CLOTH_UNDER-.3,0],[start-TAIL/2,CLOTH_UNDER-.3,0]];
 const add=(x:number,ly:number,z=0)=>{
  const y=Math.min(CLOTH_UNDER-.3,ly);
  top.push([x-1.4,CLOTH_TOP+.28,z],[x-.3,CLOTH_TOP+.05,z+.2],[x,ly+.6,z+.36],[x,ly-.25,z],[x,ly+.6,z-.36],[x+.3,CLOTH_TOP+.05,z-.2],[x+1.4,CLOTH_TOP+.28,z]);
  bobbin.push([x-1.3,y,z],[x-.4,ly-.3,z],[x,ly+.55,z],[x+.4,ly-.3,z],[x+1.3,y,z]);
 };
 if(!first)add(FIRST_LOCK,0);
 locks.forEach((s,i)=>add(s.kind==='stationary'?s.x+.32*Math.sin(i*2.4):s.x,lockY(s),s.kind==='stationary'?.32*Math.cos(i*2.4):0));
 return {top,bobbin};
}
