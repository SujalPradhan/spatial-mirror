import {HAND_CRANK,INPUT_AT,bodyKey,centre,fraction,partOf,pitchR,type Gear,type OutHand,type V} from './gears';
import type {DrivetrainBehaviour} from './behaviour';
import {fitPercent} from './behaviour';

interface Projector {boardToScreen(x:number,y:number,z?:number):{x:number;y:number};size:{width:number;height:number}}
const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
const TAU=Math.PI*2,f1=(n:number)=>n.toFixed(1);

/** Everything flat over the 3D: what will be grabbed, held-gesture progress, acknowledgements, the power path, the schematic arithmetic and the drawing. */
export class DrivetrainOverlay {
 private readonly root=document.createElement('div');private readonly svg:SVGSVGElement;private readonly g:SVGGElement;private readonly labels=document.createElement('div');
 private lastSvg='';private lastLabels='';private feetKey='';private feet:V[]=[];
 constructor(host:HTMLElement,private readonly view:Projector){
  this.root.className='dt-overlay';this.root.setAttribute('aria-hidden','true');
  this.root.innerHTML=`<svg class="dt-lines"><defs><marker id="dt-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker><filter id="dt-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g></g></svg>`;
  this.svg=this.root.querySelector('svg')!;this.g=this.svg.querySelector('g')!;this.labels.className='dt-labels';this.root.append(this.labels);host.append(this.root);
 }
 private p(x:number,y:number,z=0){return this.view.boardToScreen(x,y,z);}
 private poly(pts:V[],closed=false,z=0){return pts.map((q,i)=>{const s=this.p(q[0],q[1],z);return `${i?'L':'M'}${f1(s.x)} ${f1(s.y)}`;}).join('')+(closed?'Z':'');}
 private circle(c:V,r:number,z=0,n=56){return this.poly(Array.from({length:n},(_,i):V=>[c[0]+r*Math.cos(i/n*TAU),c[1]+r*Math.sin(i/n*TAU)]),true,z);}
 update(t:DrivetrainBehaviour,now:number){
  const {width,height}=this.view.size;this.svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  let svg='',labels='';const b=t.shown,sol=t.shownSol,build=t.mode==='build',sch=t.schematicU;
  const tag=(x:number,y:number,html:string,cls='',style='')=>{labels+=`<div class="dt-tag ${cls}" style="transform:translate(${f1(x)}px,${f1(y)}px);${style}">${html}</div>`;};
  // Tray names under each tile.
  for(const tile of t.tiles){const s=this.p(tile.x,tile.y-tile.h/2+6,4);tag(s.x,s.y,`<b>${esc(tile.label)}</b><small>${esc(tile.sub)}</small>`,`dt-tile${tile.item?'':' is-action'}${t.candidate===`tile:${tile.id}`?' is-hot':''}`);}
  if(build){
   const s=this.p(INPUT_AT[0],INPUT_AT[1]+HAND_CRANK+16,20);tag(s.x,s.y,`<b>Input</b><small>${Math.abs(Math.round(t.inputRpm))} rpm${t.motor?t.motor>0?' · motor':' · backwards':''}</small>`,'dt-io');
   for(const h of b.parts.filter((p):p is OutHand=>p.kind==='hand')){const c=centre(b,h.shaft),r=sol.ratio(h.id),q=this.p(c[0],c[1]-30,26);tag(q.x,q.y,`<b>${fraction(r)}</b><small>${Math.abs(Math.round(r*t.inputRpm*10)/10)} rpm · ${r>0?'same way':r<0?'reversed':'still'}</small>`,'dt-io is-out');}
  }
  // The power path: from the input, mesh by mesh, to every driven body; brighter toward what the finger is on.
  if(build&&(t.pathOn||sch>.02)&&sol.meshes.length){
   const target=t.hover!==null?partOf(b,t.hover):undefined,lit=new Set<string>();
   if(target){let k:string|undefined=bodyKey(b,target);while(k){lit.add(k);const s=sol.bodies.get(k);const m=s?.parent;k=m?(m.ka===k?m.kb:m.ka):undefined;}}
   const dash=-(now*.05)%20*Math.sign(t.omega||1);
   for(const s of sol.bodies.values()){
    if(!s.parent||!s.reached)continue;const m=s.parent,up=m.ka===s.key?m.kb:m.ka,ga=partOf(b,m.ka===s.key?m.b:m.a) as Gear,gb=partOf(b,m.ka===s.key?m.a:m.b) as Gear;
    const a=centre(b,ga.shaft),c=centre(b,gb.shaft),on=lit.has(s.key)&&lit.has(up),z=24;
    if(t.pathOn)svg+=`<path class="dt-power${on?' is-lit':''}" d="${this.poly([a,m.at,c],false,z)}" stroke-dashoffset="${f1(dash)}" marker-end="url(#dt-arrow)"/>`;
   }
  }
  // Schematic: pitch circles, the line of centres, and the arithmetic on every mesh.
  if(build&&sch>.02){
   svg+=`<g style="opacity:${sch.toFixed(2)}">`;const placed:{x:number;y:number}[]=[];
   // Arithmetic boxes step down past any already placed, so neighbouring meshes stay legible.
   const free=(q:{x:number;y:number})=>{for(let i=0;i<6&&placed.some(p=>Math.abs(p.x-q.x)<150&&Math.abs(p.y-q.y)<36);i++)q.y+=36;placed.push(q);return q;};
   for(const g of b.parts.filter((p):p is Gear=>p.kind==='gear')){const c=centre(b,g.shaft),z=1.6+g.layer*9+6;svg+=`<path class="dt-pitch${g.layer?' is-upper':''}" d="${this.circle(c,pitchR(g.z),z)}"/>`;const q=this.p(c[0],c[1]+(g.layer?1:-1)*pitchR(g.z)*.6,z);labels+=`<div class="dt-z" style="opacity:${sch.toFixed(2)};transform:translate(${f1(q.x)}px,${f1(q.y)}px)">${g.z}T${g.keyed?'':' free'}</div>`;}
   for(const m of sol.meshes){
    const ga=partOf(b,m.a) as Gear,gb=partOf(b,m.b) as Gear,a=centre(b,ga.shaft),c=centre(b,gb.shaft),z=1.6+ga.layer*9+6,sb=sol.bodies.get(m.kb)!,[drv,drn]=sb.parent===m?[ga,gb]:[gb,ga];
    svg+=`<path class="dt-centres" d="${this.poly([a,c],false,z)}"/>`;
    // Below the line of centres, clear of both gears' teeth.
    let n=[-Math.sin(m.angle),Math.cos(m.angle)];if(n[1]>0)n=[-n[0],-n[1]];const off=Math.min(pitchR(ga.z),pitchR(gb.z))+24,q=free(this.p(m.at[0]+n[0]*off,m.at[1]+n[1]*off,z));
    labels+=`<div class="dt-math" style="opacity:${sch.toFixed(2)};transform:translate(${f1(q.x)}px,${f1(q.y)}px)">${drv.z} : ${drn.z} <i>→</i> −${fraction(drv.z/drn.z).slice(1)}<small>(${drv.z}+${drn.z})·2.5/2 = ${Math.round((pitchR(ga.z)+pitchR(gb.z))*10)/10} mm</small></div>`;
   }
   for(const s of b.shafts){const k=`s${s.id}`,st=sol.bodies.get(k);if(!st)continue;const q=this.p(s.x,s.y,30);labels+=`<div class="dt-ratio" style="opacity:${sch.toFixed(2)};transform:translate(${f1(q.x)}px,${f1(q.y)}px)">${s.input?'×1 in':st.reached?(st.ratio<0?'−':'+')+fraction(st.ratio).slice(1):'idle'}</div>`;}
   svg+='</g>';
  }
  // Overload: the weakest tooth, and how hard it was pushed.
  if(t.spike){const s=t.spike,q=this.p(s.at[0],s.at[1],14),a=Math.max(0,1-s.age/1.8),r=12+s.age*90;svg+=`<circle class="dt-burst${s.broke?' is-broke':''}" cx="${f1(q.x)}" cy="${f1(q.y)}" r="${f1(r)}" style="opacity:${a.toFixed(2)}"/>`;tag(q.x,q.y-26,`<b>${Math.round(s.use*100)}%</b><small>${s.broke?'tooth broke':'held'}</small>`,`dt-spike${s.broke?' is-broke':''}`);}
  // What a carried part will do when it is let go.
  if(t.carry?.snap){const s=t.carry.snap,q=this.p(s.x,s.y,20);tag(q.x,q.y+30,esc(s.reason),`dt-reason${s.ok?'':' is-bad'}`);}
  // Drawing the motion.
  if(t.mode==='draw'){
   if(t.stroke.length>1)svg+=`<path class="dt-stroke${t.closed?' is-closed':''}" d="${this.poly(t.stroke,t.closed)}"/>`;
   if(t.trace.length>1)svg+=`<path class="dt-trace" filter="url(#dt-glow)" d="${this.poly(t.trace,false,10)}"/>`;
   const m=t.match;
   if(m){const q=this.p(0,128);tag(q.x,q.y,`<b>Linkage ${t.matchIndex+1} of ${t.matches.length}</b><small>fits within ${fitPercent(m.err)}% · crank ${m.linkage.a.toFixed(2)}, coupler ${m.linkage.b.toFixed(2)}, rocker ${m.linkage.c.toFixed(2)} of the ground</small>`,'dt-card');}
   if(t.leg&&t.legU>.02){
    const key=`${t.matchIndex}:${t.leg.G.join()}`;
    if(key!==this.feetKey){this.feetKey=key;this.feet=Array.from({length:96},(_,i)=>t.legPose(i/96*TAU)?.foot).filter((x):x is V=>!!x);}
    const g=t.leg.ground,xs=this.feet.map(p=>p[0]),x0=Math.min(...xs)-40,x1=Math.max(...xs)+40;
    svg+=`<g style="opacity:${t.legU.toFixed(2)}"><path class="dt-foot" d="${this.poly(this.feet,true,4)}"/><path class="dt-ground" d="${this.poly([[x0,g-1],[x1,g-1]])}"/>`;
    // Hatching that slides under the stance: the ground going by.
    const off=((t.linkTheta*30)%16+16)%16;for(let x=x0+off;x<x1;x+=16)svg+=`<path class="dt-hatch" d="${this.poly([[x,g-1],[x-8,g-9]])}"/>`;
    svg+='</g>';
   }
   if(sch>.02&&t.linkPose()){const s=t.linkPose()!;for(const [a,c,n] of [[s.O2,s.A,'crank'],[s.A,s.B,'coupler'],[s.O4,s.B,'rocker'],[s.O2,s.O4,'ground']] as [V,V,string][]){const q=this.p((a[0]+c[0])/2,(a[1]+c[1])/2,20);labels+=`<div class="dt-math" style="opacity:${sch.toFixed(2)};transform:translate(${f1(q.x)}px,${f1(q.y)}px)">${n} ${Math.round(Math.hypot(c[0]-a[0],c[1]-a[1]))} mm</div>`;}}
  }
  // Before the fingers close: a reticle at the pinch point, green when something is in reach.
  for(const r of t.reticles){const rad=22-12*r.closing;svg+=`<circle class="dt-reticle${r.hit?' is-hit':''}" cx="${f1(r.x)}" cy="${f1(r.y)}" r="${f1(rad)}"/><circle class="dt-dot" cx="${f1(r.x)}" cy="${f1(r.y)}" r="2"/>`;}
  // Held gestures fill a ring.
  for(const r of t.rings){
   const R=30,a=r.p*TAU,large=r.p>.5?1:0,x=r.x+R*Math.sin(a),y=r.y-R*Math.cos(a);
   svg+=`<circle class="dt-ring-bg" cx="${f1(r.x)}" cy="${f1(r.y)}" r="${R}"/>`;
   if(r.p>=.999)svg+=`<circle class="dt-ring" cx="${f1(r.x)}" cy="${f1(r.y)}" r="${R}"/>`;else if(r.p>0)svg+=`<path class="dt-ring" d="M${f1(r.x)} ${f1(r.y-R)}A${R} ${R} 0 ${large} 1 ${f1(x)} ${f1(y)}"/>`;
   tag(r.x,r.y+R+14,`<b>${r.glyph} ${esc(r.label)}</b>`,'dt-hold');
  }
  for(const a of t.acks){const o=Math.min(1,(1.4-a.age)/.4);tag(a.x,a.y-48-a.age*14,esc(a.text),`dt-ack is-${a.tone}`,`opacity:${o.toFixed(2)}`);}
  if(svg!==this.lastSvg){this.g.innerHTML=svg;this.lastSvg=svg;}
  if(labels!==this.lastLabels){this.labels.innerHTML=labels;this.lastLabels=labels;}
 }
 dispose(){this.root.remove();}
}
