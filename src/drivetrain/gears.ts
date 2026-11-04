/** Pure drivetrain maths: involute teeth, meshing, the train solve, tooth strength and snapping. Board units are millimetres, y up. */
export type V=[number,number];
export const MODULE=2.5,PRESSURE=20*Math.PI/180,FACE=6,LAYER_GAP=9,LAYERS=2,MESH_TOL=.6;
/** Allowable bending stress for the brass, Pa, and the clap's shock factor. */
export const SIGMA=55e6,SHOCK=4;
export const Z_MIN=10,Z_MAX=60,THROW_MIN=8,THROW_MAX=30,ROD_LENGTH=100,HAND_CRANK=58;
export const PEG=20;
/** The work area; below it is the tray. */
export const BOARD={x0:-270,x1:270,y0:-160,y1:160,tray:-108};
export const INPUT_AT:V=[-178,34];
export const pitchR=(z:number,m=MODULE)=>m*z/2;
export const tipR=(z:number,m=MODULE)=>pitchR(z,m)+m;
export const rootR=(z:number,m=MODULE)=>pitchR(z,m)-1.25*m;
export const centreDistance=(z1:number,z2:number,m=MODULE)=>(z1+z2)*m/2;
const inv=(a:number)=>Math.tan(a)-a;
const TAU=Math.PI*2;
export const dist=(a:V,b:V)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

/** A closed involute outline, counter-clockwise, tooth 0 centred on +x. `missing` leaves that tooth snapped off at the root. */
export function gearOutline(z:number,m=MODULE,missing=-1,flank=5):V[]{
 const rp=pitchR(z,m),ra=rp+m,rf=rootR(z,m),rb=rp*Math.cos(PRESSURE),r0=Math.max(rb,rf),pts:V[]=[];
 const half=(r:number)=>Math.PI/(2*z)+inv(PRESSURE)-inv(Math.acos(Math.min(1,rb/r)));
 const at=(r:number,a:number)=>{pts.push([r*Math.cos(a),r*Math.sin(a)]);};
 for(let i=0;i<z;i++){
  const c=i*TAU/z;
  if(i===missing){at(rf,c-half(r0));at(rf*.985,c);at(rf,c+half(r0));}
  else{
   if(rf<r0)at(rf,c-half(r0));
   for(let k=0;k<=flank;k++){const u=k/flank,r=r0+(ra-r0)*u*u*(3-2*u)*.4+(ra-r0)*u*.6;at(r,c-half(r));}
   for(let k=flank;k>=0;k--){const u=k/flank,r=r0+(ra-r0)*u*u*(3-2*u)*.4+(ra-r0)*u*.6;at(r,c+half(r));}
   if(rf<r0)at(rf,c+half(r0));
  }
  at(rf,c+Math.PI/z);
 }
 return pts;
}
/** Lewis form factor on the circular pitch, for 20° full-depth teeth. Fewer teeth, weaker roots. */
export const lewis=(z:number)=>.154-.912/z;
/** The tangential force one tooth carries before it bends off, newtons. */
export const toothStrength=(z:number)=>SIGMA*(FACE/1000)*Math.PI*(MODULE/1000)*lewis(z);

// ---- The build ----
export interface Shaft {id:number;x:number;y:number;input:boolean}
export interface Gear {kind:'gear';id:number;shaft:number;layer:number;z:number;keyed:boolean;broken:number;steel:boolean}
export interface Crank {kind:'crank';id:number;shaft:number;throw:number}
export interface OutHand {kind:'hand';id:number;shaft:number}
export interface Rod {kind:'rod';id:number;crank:number;angle:number}
export interface Slider {kind:'slider';id:number;rod:number;axis:number}
export type Part=Gear|Crank|OutHand|Rod|Slider;
export type PartKind=Part['kind'];
export interface Build {shafts:Shaft[];parts:Part[];next:number}
export const emptyBuild=():Build=>({shafts:[{id:1,x:INPUT_AT[0],y:INPUT_AT[1],input:true}],parts:[],next:2});
export const cloneBuild=(b:Build):Build=>({shafts:b.shafts.map(s=>({...s})),parts:b.parts.map(p=>({...p})),next:b.next});
export const gears=(b:Build)=>b.parts.filter((p):p is Gear=>p.kind==='gear');
export const shaftOf=(b:Build,id:number)=>b.shafts.find(s=>s.id===id);
export const partOf=(b:Build,id:number)=>b.parts.find(p=>p.id===id);
export const gearsOn=(b:Build,shaft:number)=>gears(b).filter(g=>g.shaft===shaft).sort((x,y)=>x.layer-y.layer);
export const centre=(b:Build,shaft:number):V=>{const s=shaftOf(b,shaft);return s?[s.x,s.y]:[0,0];};
/** Parts that count toward a brief: everything but the hand crank and its shaft. */
export const partCount=(b:Build)=>b.parts.length;
/** The rotating unit a part turns with: a shaft and its keyed parts, or a free gear on its own. */
export const bodyKey=(b:Build,p:Part):string=>{
 if(p.kind==='gear')return p.keyed?`s${p.shaft}`:`g${p.id}`;
 if(p.kind==='crank'||p.kind==='hand')return `s${p.shaft}`;
 if(p.kind==='rod'){const c=partOf(b,p.crank);return c?bodyKey(b,c):'';}
 const r=partOf(b,p.rod);return r?bodyKey(b,r):'';
};
export const crankPin=(b:Build,c:Crank,angle:number):V=>{const o=centre(b,c.shaft);return [o[0]+c.throw*Math.cos(angle),o[1]+c.throw*Math.sin(angle)];};

// ---- Solve ----
export interface Mesh {a:number;b:number;ka:string;kb:string;at:V;angle:number}
export interface BodyState {key:string;ratio:number;offset:number;reached:boolean;parent:Mesh|null;depth:number;power:number;torque:number}
export interface MeshLoad {mesh:Mesh;force:number;strength:number;use:number;weak:number}
export interface Solution {bodies:Map<string,BodyState>;meshes:Mesh[];jammed:boolean;jam:string[];loads:MeshLoad[];inputTorque:number;broken:boolean;
 /** Signed speed of a part's body, as a share of the input's. */
 ratio(id:number):number;angle(id:number,theta:number):number}
export interface Loads {hand:number;slider:number}
export const meshes=(b:Build):Mesh[]=>{
 const list:Mesh[]=[],gs=gears(b);
 for(let i=0;i<gs.length;i++)for(let j=i+1;j<gs.length;j++){
  const p=gs[i],q=gs[j];if(p.layer!==q.layer||p.shaft===q.shaft)continue;
  const a=centre(b,p.shaft),c=centre(b,q.shaft),d=dist(a,c);
  if(Math.abs(d-centreDistance(p.z,q.z))>MESH_TOL)continue;
  const rp=pitchR(p.z)/d;list.push({a:p.id,b:q.id,ka:bodyKey(b,p),kb:bodyKey(b,q),at:[a[0]+(c[0]-a[0])*rp,a[1]+(c[1]-a[1])*rp],angle:Math.atan2(c[1]-a[1],c[0]-a[0])});
 }
 return list;
};
/** Breadth first from the input: each body's speed and tooth phase follow from its parent mesh; a loop that disagrees jams. */
export function solve(b:Build,loads:Loads={hand:1,slider:20}):Solution{
 const ms=meshes(b),bodies=new Map<string,BodyState>(),keys=new Set<string>(),gearById=new Map(gears(b).map(g=>[g.id,g]));
 for(const p of b.parts)keys.add(bodyKey(b,p));
 const input=`s${b.shafts.find(s=>s.input)!.id}`;keys.add(input);
 for(const k of keys)bodies.set(k,{key:k,ratio:0,offset:0,reached:false,parent:null,depth:0,power:0,torque:0});
 const adj=new Map<string,Mesh[]>();for(const m of ms){for(const k of [m.ka,m.kb]){if(!adj.has(k))adj.set(k,[]);adj.get(k)!.push(m);}}
 const jam=new Set<string>(),seen=new Set<string>();
 const walk=(root:string,live:boolean)=>{
  const r=bodies.get(root)!;r.ratio=live?1:0;r.offset=0;r.reached=live;seen.add(root);const queue=[root];
  while(queue.length){
   const k=queue.shift()!,from=bodies.get(k)!;
   for(const m of adj.get(k)??[]){
    const [ga,gb,kb]=m.ka===k?[gearById.get(m.a)!,gearById.get(m.b)!,m.kb]:[gearById.get(m.b)!,gearById.get(m.a)!,m.ka];
    const psi=m.ka===k?m.angle:m.angle+Math.PI,k2=ga.z/gb.z,ratio=-k2*from.ratio,offset=-k2*(from.offset-psi)+psi+Math.PI+Math.PI/gb.z;
    const to=bodies.get(kb)!;
    if(seen.has(kb)){if(Math.abs(to.ratio-ratio)>1e-6*Math.max(1,Math.abs(ratio))){jam.add(k);jam.add(kb);}continue;}
    seen.add(kb);Object.assign(to,{ratio,offset,reached:live,parent:m,depth:from.depth+1});queue.push(kb);
   }
  }
 };
 walk(input,true);for(const k of keys)if(!seen.has(k))walk(k,false);
 // A jam anywhere in the driven train stops all of it.
 const jammed=[...jam].some(k=>bodies.get(k)!.reached);
 const broken=gears(b).some(g=>g.broken>=0&&bodies.get(bodyKey(b,g))!.reached);
 // Power for a unit input speed: each load times its speed, summed up each subtree toward the input.
 for(const p of b.parts){
  const k=bodyKey(b,p),s=bodies.get(k);if(!s?.reached)continue;
  if(p.kind==='hand')s.power+=loads.hand*Math.abs(s.ratio);
  if(p.kind==='slider'){const r=partOf(b,p.rod),c=r&&partOf(b,(r as Rod).crank) as Crank|undefined;if(c)s.power+=loads.slider*(2*c.throw/1000)*2/Math.PI*Math.abs(s.ratio);}
 }
 const order=[...bodies.values()].filter(s=>s.reached).sort((x,y)=>y.depth-x.depth);
 for(const s of order){if(s.parent){const up=bodies.get(s.parent.ka===s.key?s.parent.kb:s.parent.ka)!;up.power+=s.power;}}
 for(const s of bodies.values())s.torque=s.reached&&Math.abs(s.ratio)>1e-9?s.power/Math.abs(s.ratio):0;
 const loadsOut:MeshLoad[]=[];
 for(const s of order){
  const m=s.parent;if(!m)continue;
  const child=gearById.get(m.ka===s.key?m.a:m.b)!,other=gearById.get(m.ka===s.key?m.b:m.a)!;
  const force=s.torque/(pitchR(child.z)/1000),strength=Math.min(toothStrength(child.z),toothStrength(other.z));
  loadsOut.push({mesh:m,force,strength,use:force/strength,weak:toothStrength(child.z)<=toothStrength(other.z)?child.id:other.id});
 }
 const ratioOf=(id:number)=>{const p=partOf(b,id);return p?bodies.get(bodyKey(b,p))?.ratio??0:0;};
 return {bodies,meshes:ms,jammed,jam:[...jam],loads:loadsOut,inputTorque:bodies.get(input)!.power,broken,ratio:ratioOf,
  angle:(id,theta)=>{const p=partOf(b,id);const s=p&&bodies.get(bodyKey(b,p));return s?s.ratio*theta+s.offset:0;}};
}
/** A ratio as a fraction, to a sixtieth: ×1/12, ×3/2. */
export function fraction(r:number){
 if(!Number.isFinite(r)||Math.abs(r)<1e-9)return '×0';
 const a=Math.abs(r);let best=[Math.round(a),1],err=Infinity;
 for(let d=1;d<=60;d++){const n=Math.round(a*d);if(!n)continue;const e=Math.abs(n/d-a);if(e<err-1e-9){err=e;best=[n,d];}if(e<1e-6)break;}
 return `×${best[1]===1?best[0]:`${best[0]}/${best[1]}`}`;
}

// ---- Snapping ----
export interface Item {kind:PartKind;z?:number;throw?:number;steel?:boolean}
export interface Snap {ok:boolean;x:number;y:number;layer:number;shaft:number|null;target:number|null;meshes:number[];reason:string;
 /** Slider guide angle, rod angle. */
 angle?:number}
const inside=(x:number,y:number,r=0)=>x-r>BOARD.x0&&x+r<BOARD.x1&&y-r>BOARD.tray+4&&y+r<BOARD.y1;
export const overTray=(y:number)=>y<BOARD.tray;
/** Whether a gear at a spot hits any gear on its layer it does not mesh with. */
export function clash(b:Build,z:number,x:number,y:number,layer:number,skipShaft:number|null=null):Gear|null{
 for(const g of gears(b)){
  if(g.layer!==layer||g.shaft===skipShaft)continue;
  const d=dist([x,y],centre(b,g.shaft));
  if(Math.abs(d-centreDistance(z,g.z))<=MESH_TOL)continue;
  if(d<tipR(z)+tipR(g.z)+.5)return g;
 }
 // The hand crank sweeps its arm above the gears, but its hub sits on the board.
 return null;
}
const circles=(a:V,ra:number,c:V,rc:number):V[]=>{
 const d=dist(a,c);if(d>ra+rc||d<Math.abs(ra-rc)||d<1e-9)return [];
 const x=(ra*ra-rc*rc+d*d)/(2*d),h=Math.sqrt(Math.max(0,ra*ra-x*x)),ex=(c[0]-a[0])/d,ey=(c[1]-a[1])/d;
 return [[a[0]+x*ex-h*ey,a[1]+x*ey+h*ex],[a[0]+x*ex+h*ey,a[1]+x*ey-h*ex]];
};
const meshedWith=(b:Build,z:number,x:number,y:number,layer:number,shaft:number|null)=>gears(b).filter(g=>g.layer===layer&&g.shaft!==shaft&&Math.abs(dist([x,y],centre(b,g.shaft))-centreDistance(z,g.z))<=MESH_TOL).map(g=>g.id);
/** Where a gear dropped at (x,y) lands: on a shaft, meshed with the gear it is nearest (with a second if both reach), or on a peg. capture is in mm. */
export function snapGear(b:Build,z:number,x:number,y:number,capture=16):Snap{
 const fail=(reason:string,px=x,py=y,layer=0):Snap=>({ok:false,x:px,y:py,layer,shaft:null,target:null,meshes:[],reason});
 if(overTray(y))return fail('Back to the tray');
 // Onto a shaft: the hub lands on the axle and stacks a layer up.
 let best:Shaft|null=null,bd=Infinity;
 for(const s of b.shafts){const d=dist([x,y],[s.x,s.y]);if(d<bd){bd=d;best=s;}}
 if(best&&bd<Math.max(capture,Math.min(22,pitchR(z)*.5))){
  const on=gearsOn(b,best.id),layer=on.length?on[on.length-1].layer+1:0;
  if(layer>=LAYERS)return fail('That shaft is full',best.x,best.y,LAYERS-1);
  const hit=clash(b,z,best.x,best.y,layer,best.id);
  if(hit)return fail(`Would clash with the ${hit.z}T`,best.x,best.y,layer);
  return {ok:true,x:best.x,y:best.y,layer,shaft:best.id,target:on[on.length-1]?.id??null,meshes:meshedWith(b,z,best.x,best.y,layer,best.id),reason:on.length?'Compound: keyed to the shaft':'On the shaft'};
 }
 // Into mesh: the centre slides onto the circle at the right distance, so the teeth just touch.
 const near=gears(b).map(g=>{const c=centre(b,g.shaft),C=centreDistance(z,g.z),d=dist([x,y],c);return {g,c,C,d,off:Math.abs(d-C)};}).filter(n=>n.off<Math.max(capture,.45*n.C)||n.d<n.C).sort((p,q)=>p.off-q.off);
 for(const n of near){
  // Where the drop is nearest: on this gear's circle, or where it also reaches a second gear, which wins a near tie.
  const u=n.d>1e-6?[(x-n.c[0])/n.d,(y-n.c[1])/n.d]:[1,0],tries:{p:V;d:number}[]=[{p:[n.c[0]+u[0]*n.C,n.c[1]+u[1]*n.C],d:n.off}];
  for(const m of near)if(m.g.layer===n.g.layer&&m.g.shaft!==n.g.shaft){for(const p of circles(n.c,n.C,m.c,m.C)){const d=dist(p,[x,y]);if(d<Math.max(capture*1.6,26))tries.push({p,d:d-6});}}
  tries.sort((p,q)=>p.d-q.d);
  for(const {p} of tries){
   if(!inside(p[0],p[1],tipR(z)*.4))continue;
   if(clash(b,z,p[0],p[1],n.g.layer))continue;
   if(b.shafts.some(s=>dist(p,[s.x,s.y])<4))continue;
   return {ok:true,x:p[0],y:p[1],layer:n.g.layer,shaft:null,target:n.g.id,meshes:meshedWith(b,z,p[0],p[1],n.g.layer,null),reason:`Meshed with the ${n.g.z}T`};
  }
 }
 const px=Math.round(x/PEG)*PEG,py=Math.round(y/PEG)*PEG;
 if(!inside(px,py,tipR(z)*.3))return fail('Off the board',px,py);
 const hit=clash(b,z,px,py,0);if(hit)return fail(`Would clash with the ${hit.z}T`,px,py);
 return {ok:true,x:px,y:py,layer:0,shaft:null,target:null,meshes:meshedWith(b,z,px,py,0,null),reason:'On a peg'};
}
const hasOn=(b:Build,kind:'crank'|'hand',shaft:number)=>b.parts.some(p=>p.kind===kind&&p.shaft===shaft);
/** Cranks and hands go on a shaft, rods on a crank pin, sliders on a rod's free end. theta is the input angle now, so pins are found where they are. */
export function snapLink(b:Build,item:Item,x:number,y:number,capture:number,sol:Solution,theta:number):Snap{
 const fail=(reason:string):Snap=>({ok:false,x,y,layer:LAYERS,shaft:null,target:null,meshes:[],reason});
 if(overTray(y))return fail('Back to the tray');
 if(item.kind==='crank'||item.kind==='hand'){
  let best:Shaft|null=null,bd=Infinity;
  for(const s of b.shafts){if(s.input&&item.kind==='crank')continue;const reach=Math.max(capture,...gearsOn(b,s.id).map(g=>pitchR(g.z)*.6));const d=dist([x,y],[s.x,s.y]);if(d<reach&&d<bd){bd=d;best=s;}}
  if(!best)return fail(item.kind==='hand'?'Put the hand on a shaft':'Put the crank on a gear shaft');
  if(hasOn(b,item.kind,best.id))return fail(`That shaft has a ${item.kind} already`);
  if(item.kind==='crank'&&hasOn(b,'hand',best.id))return fail('That shaft carries a hand');
  if(item.kind==='hand'&&hasOn(b,'crank',best.id))return fail('That shaft carries a crank');
  return {ok:true,x:best.x,y:best.y,layer:LAYERS,shaft:best.id,target:null,meshes:[],reason:item.kind==='hand'?'Output hand on the shaft':'Crank on the shaft'};
 }
 if(item.kind==='rod'){
  let best:Crank|null=null,bd=Infinity;
  for(const p of b.parts)if(p.kind==='crank'&&!b.parts.some(r=>r.kind==='rod'&&r.crank===p.id)){const pin=crankPin(b,p,sol.angle(p.id,theta)),d=dist([x,y],pin);if(d<Math.max(capture,30)&&d<bd){bd=d;best=p;}}
  if(!best)return fail('Hook the rod onto a crank pin');
  const pin=crankPin(b,best,sol.angle(best.id,theta)),o=centre(b,best.shaft);
  // The rod hangs away from the shaft, the way you dropped it.
  return {ok:true,x:pin[0],y:pin[1],layer:LAYERS,shaft:null,target:best.id,meshes:[],reason:'Rod on the crank pin',angle:Math.atan2(pin[1]-o[1],pin[0]-o[0])};
 }
 let best:Rod|null=null,bd=Infinity,end:V=[0,0];
 for(const p of b.parts)if(p.kind==='rod'&&!b.parts.some(s=>s.kind==='slider'&&s.rod===p.id)){const e=rodEnd(b,p,sol,theta);const d=dist([x,y],e);if(d<Math.max(capture,34)&&d<bd){bd=d;best=p;end=e;}}
 if(!best)return fail('Slide the block onto a rod end');
 const c=partOf(b,best.crank) as Crank,o=centre(b,c.shaft);
 return {ok:true,x:end[0],y:end[1],layer:LAYERS,shaft:null,target:best.id,meshes:[],reason:'Slider on its guide',angle:Math.atan2(end[1]-o[1],end[0]-o[0])};
}
/** A rod with no slider hangs at its own angle from the pin. */
export function rodEnd(b:Build,r:Rod,sol:Solution,theta:number):V{
 const c=partOf(b,r.crank) as Crank|undefined;if(!c)return [0,0];
 const s=b.parts.find((p):p is Slider=>p.kind==='slider'&&p.rod===r.id);
 const pin=crankPin(b,c,sol.angle(c.id,theta));
 if(s)return sliderAt(b,s,sol,theta).at;
 return [pin[0]+ROD_LENGTH*Math.cos(r.angle),pin[1]+ROD_LENGTH*Math.sin(r.angle)];
}
/** Slider-crank, closed form: x = r cos φ + √(L² − r² sin² φ) along the guide. */
export function sliderAt(b:Build,s:Slider,sol:Solution,theta:number){
 const r=partOf(b,s.rod) as Rod,c=partOf(b,r.crank) as Crank,o=centre(b,c.shaft),phi=sol.angle(c.id,theta)-s.axis;
 const along=c.throw*Math.cos(phi)+Math.sqrt(Math.max(0,ROD_LENGTH*ROD_LENGTH-(c.throw*Math.sin(phi))**2));
 return {along,at:[o[0]+along*Math.cos(s.axis),o[1]+along*Math.sin(s.axis)] as V,stroke:2*c.throw};
}

// ---- Edits ----
/** Puts an item where its snap says. Returns the new part id. */
export function place(b:Build,item:Item,s:Snap):number{
 const id=b.next++;
 if(item.kind==='gear'){
  let shaft=s.shaft;if(shaft===null){shaft=b.next++;b.shafts.push({id:shaft,x:s.x,y:s.y,input:false});}
  b.parts.push({kind:'gear',id,shaft,layer:s.layer,z:item.z??24,keyed:true,broken:-1,steel:!!item.steel});
 }else if(item.kind==='crank')b.parts.push({kind:'crank',id,shaft:s.shaft!,throw:item.throw??15});
 else if(item.kind==='hand')b.parts.push({kind:'hand',id,shaft:s.shaft!});
 else if(item.kind==='rod')b.parts.push({kind:'rod',id,crank:s.target!,angle:s.angle??0});
 else b.parts.push({kind:'slider',id,rod:s.target!,axis:s.angle??0});
 return id;
}
/** Takes a part off with whatever hangs on it, and drops shafts left bare. Returns what came off. */
export function remove(b:Build,id:number):Part[]{
 const gone:Part[]=[],take=(pid:number)=>{const i=b.parts.findIndex(p=>p.id===pid);if(i<0)return;const [p]=b.parts.splice(i,1);gone.push(p);
  for(const q of [...b.parts]){if(q.kind==='rod'&&q.crank===pid)take(q.id);if(q.kind==='slider'&&q.rod===pid)take(q.id);}
  if(p.kind==='gear'&&!gearsOn(b,p.shaft).length&&!shaftOf(b,p.shaft)?.input){for(const q of [...b.parts])if((q.kind==='crank'||q.kind==='hand')&&q.shaft===p.shaft)take(q.id);}
 };
 take(id);
 b.shafts=b.shafts.filter(s=>s.input||b.parts.some(p=>(p.kind==='gear'||p.kind==='crank'||p.kind==='hand')&&p.shaft===s.id));
 return gone;
}
export const itemOf=(p:Part):Item=>p.kind==='gear'?{kind:'gear',z:p.z,steel:p.steel}:p.kind==='crank'?{kind:'crank',throw:p.throw}:{kind:p.kind};
/** Keeps every tree mesh's direction and resets its length to the right centre distance, outward from the input, so a stretched gear's neighbours re-space. */
export function respace(b:Build,sol:Solution){
 const order=[...sol.bodies.values()].filter(s=>s.parent).sort((x,y)=>x.depth-y.depth);
 for(const s of order){
  const m=s.parent!,childId=m.ka===s.key?m.a:m.b,parentId=m.ka===s.key?m.b:m.a;
  const cg=partOf(b,childId) as Gear|undefined,pg=partOf(b,parentId) as Gear|undefined;if(!cg||!pg)continue;
  const cs=shaftOf(b,cg.shaft)!,ps=shaftOf(b,pg.shaft)!;if(cs.input)continue;
  const a=Math.atan2(cs.y-ps.y,cs.x-ps.x),C=centreDistance(cg.z,pg.z),dx=ps.x+C*Math.cos(a)-cs.x,dy=ps.y+C*Math.sin(a)-cs.y;
  if(Math.abs(dx)<1e-9&&Math.abs(dy)<1e-9)continue;
  // Parents go first, so the whole subtree beyond rides along and meshes further out keep their distances.
  for(const id of subtreeShafts(b,sol,s.key)){const t=shaftOf(b,id);if(t&&!t.input){t.x+=dx;t.y+=dy;}}
 }
}
/** Shafts of a body and of every body it drives. */
export function subtreeShafts(b:Build,sol:Solution,key:string):Set<number>{
 const keys=new Set([key]);let grew=true;
 while(grew){grew=false;for(const s of sol.bodies.values())if(s.parent&&!keys.has(s.key)){const up=s.parent.ka===s.key?s.parent.kb:s.parent.ka;if(keys.has(up)){keys.add(s.key);grew=true;}}}
 const out=new Set<number>();
 for(const p of b.parts)if(p.kind==='gear'&&keys.has(bodyKey(b,p)))out.add(p.shaft);
 for(const k of keys)if(k.startsWith('s'))out.add(Number(k.slice(1)));
 return out;
}
/** Any gear overlapping another it does not mesh with. */
export function anyClash(b:Build):boolean{return gears(b).some(g=>{const c=centre(b,g.shaft);return clash(b,g.z,c[0],c[1],g.layer,g.shaft)!==null;})||b.shafts.some(s=>!inside(s.x,s.y));}
