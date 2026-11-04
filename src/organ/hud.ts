import type {OrganScene,Px} from './contracts';
import {layerName} from './doc';
import {allergenById,families,familyColor,halfLife,noteClass,organ} from './ingredients';
import {FLASK,familyAngle} from './layout';
import {HOURS,MAX_DROPS,THRESHOLD,composition,concName,dropCount,ingredient,label,layering,layers,stackLabel,totals,type LabelLine} from './model';

export interface HudWorld {vial(i:number):Px&{on:boolean};projectWorld(x:number,y:number,z:number):Px;flask():Px;palm():Px;readonly size:{w:number;h:number}}
const pct=(n:number)=>n>=10?n.toFixed(0):n>=1?n.toFixed(1):n>=.01?n.toFixed(2):n.toFixed(3);
const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
const hours=(h:number)=>h<1?`${Math.round(h*60)} min`:`${h.toFixed(1)} h`;
/** Writes only when the markup changed, so the live label can fade lines in with CSS. */
function set(el:HTMLElement,html:string){if(el.dataset.html!==html){el.dataset.html=html;el.innerHTML=html;}}
function at(el:HTMLElement,p:Px|null,on=true){
 const show=!!p&&on;el.classList.toggle('is-on',show);
 if(show)el.style.transform=`translate(${Math.round(p!.x)}px,${Math.round(p!.y)}px)`;
}
const div=(cls:string,parent:HTMLElement,tag='div')=>{const el=document.createElement(tag);el.className=cls;parent.append(el);return el;};

/** The organ's HTML layer: the formula card, the self-writing label, and every cue a hand needs before and after it acts. */
export class OrganHud {
 readonly root:HTMLElement;
 private formula:HTMLElement;private label:HTMLElement;private hover:HTMLElement;private dose:HTMLElement;private clock:HTMLElement;private slicePanel:HTMLElement;private forearmPanel:HTMLElement;private conc:HTMLElement;private shock:HTMLElement;private palmTag:HTMLElement;private flaskTag:HTMLElement;
 private labelHead:HTMLElement;private labelEmpty:HTMLElement;private labelContains:HTMLElement;private labelList:HTMLElement;private labelFoot:HTMLElement;private lines=new Map<string,HTMLElement>();
 private tags:HTMLElement[]=[];private fams:HTMLElement[]=[];private reticles:HTMLElement[]=[];private holds:HTMLElement[]=[];private splits:HTMLElement[]=[];private acks=new Map<number,HTMLElement>();private ackBox:HTMLElement;private skeleton:SVGSVGElement;
 constructor(host:HTMLElement){
  const r=this.root=div('organ-hud',host);
  this.skeleton=document.createElementNS('http://www.w3.org/2000/svg','svg');this.skeleton.setAttribute('class','organ-bones');r.append(this.skeleton);
  organ.forEach(i=>{const t=div('organ-tag',r);t.innerHTML=`<b>${i.name}</b><small style="--c:${familyColor[i.family]}">${i.family}</small>`;this.tags.push(t);});
  families.forEach(f=>{const t=div('organ-family',r);t.innerHTML=`<b style="--c:${familyColor[f]}">${f}</b>`;this.fams.push(t);});
  this.formula=div('organ-card organ-formula',r,'section');this.formula.setAttribute('aria-label','Formula');
  this.label=div('organ-card organ-label',r,'section');this.label.setAttribute('aria-label','Label');
  this.labelHead=div('',this.label,'header');this.labelEmpty=div('organ-empty',this.label,'p');this.labelEmpty.textContent='Nothing to declare yet.';
  this.labelContains=div('organ-contains',this.label,'p');this.labelContains.textContent='Contains:';this.labelList=div('',this.label,'ul');this.labelList.setAttribute('aria-live','polite');this.labelFoot=div('',this.label);
  this.hover=div('organ-hover',r);this.dose=div('organ-dose',r);this.clock=div('organ-clock',r);this.slicePanel=div('organ-slice',r);this.forearmPanel=div('organ-forearm',r);this.conc=div('organ-conc',r);this.shock=div('organ-shock',r);
  this.palmTag=div('organ-place',r);this.flaskTag=div('organ-place organ-place-flask',r);
  for(let i=0;i<3;i++)this.splits.push(div('organ-split',r));
  for(let i=0;i<2;i++){this.reticles.push(div('organ-reticle',r));const h=div('organ-hold',r);h.innerHTML='<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27"/><circle class="is-run" cx="32" cy="32" r="27"/></svg><i></i><span></span>';this.holds.push(h);}
  this.ackBox=div('organ-acks',r);
  // Buttons are a mouse and keyboard way to every hand action; they must not start an orbit drag underneath.
  for(const el of [this.formula,this.label])el.addEventListener('pointerdown',e=>e.stopPropagation());
  r.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-act]');if(b)host.dispatchEvent(new CustomEvent('organ-action',{bubbles:true,detail:b.dataset.act}));});
 }
 update(s:OrganScene,w:HudWorld){
  const doc=s.doc,b=doc.blend,worn=doc.mode!=='compose',{w:W,h:H}=w.size;
  // Names under the vials, and family names over the wedges when fanned.
  organ.forEach((_,i)=>{const p=w.vial(i);at(this.tags[i],{x:p.x,y:p.y+34},p.on);this.tags[i].classList.toggle('is-hot',s.hover?.vial===i||s.reticles.some(r=>r.vial===i));});
  families.forEach((_,f)=>{const a=familyAngle(f),R=5.7,p=w.projectWorld(Math.sin(a)*R,.85,-Math.cos(a)*R*.82+.2);at(this.fams[f],p,s.fan>.5);this.fams[f].style.opacity=String(Math.max(0,s.fan*2-1));});
  this.drawFormula(s);this.drawLabel(s);
  // ☝️ or an approaching pinch: what the vial is before anything is taken.
  const hv=s.hover&&!s.grab?s.hover:null;
  if(hv){const ing=organ[hv.vial],note=noteClass(ing.tau),vol=1-Math.min(1,Math.log(1+ing.tau)/Math.log(31)),al=Object.entries(ing.allergens).sort((a,b)=>b[1]-a[1]);
   set(this.hover,`<b>${ing.name}</b><small><i style="--c:${familyColor[ing.family]}"></i>${ing.family} · ${note} note</small><p>${ing.words.map(esc).join(' · ')}</p><dl><dt>Volatility</dt><dd><s style="width:${Math.round(vol*100)}%"></s></dd><dt>Half-life on skin</dt><dd>${hours(halfLife(ing.tau))}</dd></dl>${al.length?`<ul>${al.map(([id,f])=>`<li>${allergenById.get(id)!.name}<span>${pct(f*100)}%${allergenById.get(id)!.since===2023?' <em>2023</em>':''}</span></li>`).join('')}</ul>`:'<p class="is-none">No declarable allergens</p>'}`);
   const p=w.vial(hv.vial);at(this.hover,{x:Math.min(W-250,Math.max(10,p.x+46)),y:Math.max(60,Math.min(H-260,p.y-150))});
  }else at(this.hover,null);
  // The dose meter rides with the pinch: ten ticks, a count, and the share it would take.
  const g=s.grab;
  if(g){const ing=organ[g.vial],n=dropCount(b),share=n+g.drops>0?g.drops/(n+g.drops)*100:0;
   set(this.dose,`<b>${ing.name}</b><span>${Array.from({length:MAX_DROPS},(_,i)=>`<i class="${i<g.drops?'is-on':''}" style="--c:${ing.color}"></i>`).join('')}</span><small>${g.drops?`${g.drops} drop${g.drops>1?'s':''} · ${share.toFixed(0)}% of the blend`:'pull toward the flask'}${g.loose?' · let go?':''}</small>`);
   at(this.dose,{x:g.x+26,y:g.y-70});this.dose.classList.toggle('is-loose',g.loose);
  }else at(this.dose,null);
  s.reticles.slice(0,2).forEach((rt,i)=>{const el=this.reticles[i],v=rt.vial>=0?w.vial(rt.vial):null,p=v&&rt.close>.3?{x:rt.x+(v.x-rt.x)*.35*rt.close,y:rt.y+(v.y-rt.y)*.35*rt.close}:rt;
   at(el,p);el.style.setProperty('--k',String(1-rt.close*.6));el.classList.toggle('has-target',rt.vial>=0);});
  for(let i=s.reticles.length;i<2;i++)at(this.reticles[i],null);
  s.holds.slice(0,2).forEach((h,i)=>{const el=this.holds[i];at(el,{x:h.x,y:h.y-90});el.style.setProperty('--p',String(Math.min(1,h.progress)));el.querySelector('i')!.textContent=h.glyph;el.querySelector('span')!.textContent=h.label;});
  for(let i=s.holds.length;i<2;i++)at(this.holds[i],null);
  this.drawAcks(s);this.drawBones(s,W,H);
  // Places: where the palm and the flask are, so a first-timer knows where things go.
  const palm=w.palm(),flask=w.flask();
  set(this.palmTag,worn&&doc.mode==='drydown'?`<b>Palm</b><small>${doc.skin} skin · ${concName(b.conc)}</small>`:'');at(this.palmTag,{x:palm.x+120,y:palm.y+6},doc.mode==='drydown');
  set(this.flaskTag,`<b>Flask</b><small>${dropCount(b)?`${dropCount(b)} drops · ${concName(b.conc)} ${Math.round(b.conc*100)}%`:'pull a vial here'}</small>`);at(this.flaskTag,{x:flask.x,y:w.projectWorld(FLASK.x,FLASK.y-.15,FLASK.z).y+12});
  // The dry-down clock: 0 to 8 h, scrubbed by ✊.
  if(worn){const k=s.clock/HOURS;set(this.clock,`<b>${s.clock.toFixed(1)} h</b><span><s style="width:${(k*100).toFixed(1)}%"></s>${[0,2,4,6,8].map(h=>`<i style="left:${h/HOURS*100}%">${h}</i>`).join('')}</span><small>${s.playing?'running · hours compressed into seconds':'✊ turn to scrub'}</small>`);}
  at(this.clock,{x:W/2,y:14},worn);
  // ✌️ the composition at this hour.
  if(s.slice>.1&&doc.mode==='drydown'){const c=composition(b,s.clock,doc.skin);
   set(this.slicePanel,`<b>At ${s.clock.toFixed(1)} h</b><small>${c.left>1e-4?'what is left on the palm':'almost nothing left'}</small><ul>${c.parts.filter(p=>p.share>.005).slice(0,7).map(p=>{const i=ingredient(p.id);return `<li><i style="--c:${i.color}"></i>${i.name}<s style="width:${(p.share*100).toFixed(0)}%;--c:${i.color}"></s><span>${(p.share*100).toFixed(0)}%</span></li>`;}).join('')}</ul>`);
   at(this.slicePanel,{x:Math.min(W-240,palm.x-240),y:palm.y-260});
  }else at(this.slicePanel,null);
  // 🤏🤏 layer names beside the pucks.
  const ls=layers(b);
  this.splits.forEach((el,i)=>{const L=ls[2-i],k=s.split,on=k>.3&&L.share>0;
   if(on){set(el,`<b>${L.note}</b><small>${(L.share*100).toFixed(0)}% · ${L.parts.slice(0,3).map(p=>ingredient(p.id).name).join(', ')}</small>`);at(el,w.projectWorld(FLASK.x-1.6*k-.75,FLASK.y+.4+k*(.6+i*.85),FLASK.z+.2));}else at(el,null);});
  // Layering on the forearm.
  if(doc.stack.length){const L=layering(doc.stack,s.clock,doc.skin),active=doc.mode==='layering';
   set(this.forearmPanel,`<b>Forearm</b><small>${active?`layered ${doc.stack.map((_,i)=>layerName(i)).join(' + ')} · at ${s.clock.toFixed(1)} h`:`bottled ${doc.stack.map((_,i)=>layerName(i)).join(', ')} · bottle another to layer`}</small>${doc.stack.map((x,i)=>`<p><i>${layerName(i)}</i><span>${[...totals(x).keys()].slice(0,3).map(id=>ingredient(id).name).join(', ')}</span>${active?`<s style="width:${(L.share[i]*100).toFixed(0)}%"></s><em>${(L.share[i]*100).toFixed(0)}%</em>`:''}</p>`).join('')}${active&&L.fix>.01?`<small class="organ-fix">base notes fix the lighter layers: top and heart last ${Math.round(L.fix/(1-L.fix)*100)}% longer</small>`:''}${active?`<small>leading now: ${L.dominant>=0?layerName(L.dominant):'none'}</small>`:''}`);
   at(this.forearmPanel,{x:18,y:Math.min(H-this.forearmPanel.offsetHeight-78,this.formula.offsetTop+this.formula.offsetHeight+12)});
  }else at(this.forearmPanel,null);
  // ✊✊ strength gauge.
  if(s.conc!==null){const k=(s.conc-.03)/(.3-.03);set(this.conc,`<b>${concName(s.conc)}</b><span><s style="width:${(k*100).toFixed(0)}%"></s></span><small>${(s.conc*100).toFixed(0)}% oil · lasts ${s.conc>b.conc+.002?'longer':s.conc<b.conc-.002?'shorter':'as now'}</small>`);at(this.conc,{x:W/2,y:H*.3});}else at(this.conc,null);
  if(s.shock){at(this.shock,s.shock);this.shock.style.setProperty('--a',String(s.shock.age));}else at(this.shock,null);
 }
 private drawFormula(s:OrganScene){
  const doc=s.doc,b=doc.blend,t=totals(b),n=dropCount(b);
  const rows=[...t].map(([id,d])=>{const i=ingredient(id),changed=doc.compliance?.changes.find(c=>c.by===id||c.id===id);return `<tr class="${changed?'is-changed':''}"><td><i style="--c:${i.color}"></i>${i.name}</td><td>${noteClass(i.tau)[0].toUpperCase()}</td><td>${+d.toFixed(1)}</td><td>${(d/n*100).toFixed(1)}%</td></tr>`;}).join('');
  const comp=doc.compliance;
  set(this.formula,`<header><b>Formula</b><small>${concName(b.conc)} · ${Math.round(b.conc*100)}% oil · ${doc.skin} skin</small></header>${n?`<table><thead><tr><th>Material</th><th></th><th>drops</th><th>%</th></tr></thead><tbody>${rows}</tbody></table><p class="organ-total">${+n.toFixed(1)} drops in the flask</p>`:'<p class="organ-empty">Empty. Pinch a vial and pull it to the flask.</p>'}${comp?this.complianceHtml(comp):''}<nav><button data-act="undo" ${s.undoable?'':'disabled'}>Undo</button><button data-act="spray" ${n?'':'disabled'}>Spray</button><button data-act="comply" ${n?'':'disabled'}>Make compliant</button><button data-act="bottle" ${n?'':'disabled'}>Bottle</button><button data-act="clear" ${n?'':'disabled'}>Empty</button></nav>`);
 }
 private complianceHtml(c:NonNullable<OrganScene['doc']['compliance']>){
  if(!c.changes.length)return `<div class="organ-comply"><b>Compliance</b><small>Every capped allergen already under its ceiling. Only the label lines are needed.</small></div>`;
  return `<div class="organ-comply"><b>Made compliant</b><ul>${c.changes.map(ch=>`<li>${ingredient(ch.id).name} ${ch.kind==='substituted'?`→ <em>${ingredient(ch.by!).name}</em>`:`${+ch.from.toFixed(1)} → ${+ch.to.toFixed(1)} drops`}<small>${ch.because.join(', ')}</small></li>`).join('')}</ul><p>Character kept <strong>${Math.round(c.kept*100)}%</strong>${c.losses.length?` · ${c.losses.slice(0,2).map(l=>`${l.family} ${Math.round(l.change*100)}%`).join(' · ')}`:''}</p></div>`;
 }
 /** "Contains:" lines appear as an allergen crosses the threshold; on skin they dim as it evaporates. Lines are kept by id, so only a new one plays its entrance. */
 private drawLabel(s:OrganScene){
  const doc=s.doc,wearing=doc.mode==='drydown',layered=doc.mode==='layering'&&doc.stack.length>1,live=wearing||layered;
  const lines:LabelLine[]=layered?stackLabel(doc.stack,s.clock,doc.skin,doc.product):label(doc.blend,doc.product,wearing?s.clock:0,doc.skin);
  const shown=lines.filter(l=>l.declared),under=lines.filter(l=>!l.declared),flagged=lines.filter(l=>l.flagged),th=THRESHOLD[doc.product];
  set(this.labelHead,`<b>Label</b><small>${layered?`worn together · ${doc.stack.map((_,i)=>layerName(i)).join(' + ')}`:live?`on the palm at ${s.clock.toFixed(1)} h`:'writes itself as you add'}</small>`);
  this.labelEmpty.hidden=shown.length>0;this.labelContains.hidden=!shown.length;
  const keep=new Set<string>();
  shown.forEach((l,i)=>{
   keep.add(l.id);let li=this.lines.get(l.id);
   if(!li){li=document.createElement('li');li.dataset.id=l.id;li.innerHTML=`<b></b>${l.since===2023?'<em>2023</em>':''}<span></span><small></small>`;this.lines.set(l.id,li);}
   if(this.labelList.children[i]!==li)this.labelList.insertBefore(li,this.labelList.children[i]??null);
   const gone=live&&l.onSkin<th,op=live?Math.max(.16,Math.min(1,Math.sqrt(l.strength))):1;
   li.classList.toggle('is-flagged',l.flagged);li.classList.toggle('is-gone',gone);li.style.setProperty('--o',op.toFixed(2));
   const text=(sel:string,v:string)=>{const el=li!.querySelector(sel)!;if(el.textContent!==v)el.textContent=v;};
   text('b',l.name);text('span',`${pct(l.product)}%${live?` · skin ${pct(l.onSkin)}%`:''}`);text('small',l.flagged?`over the ${l.cap}% ceiling`:'');
  });
  for(const [id,li] of this.lines)if(!keep.has(id)){li.remove();this.lines.delete(id);}
  set(this.labelFoot,`${under.length?`<p class="organ-under">Below ${th}%: ${under.map(l=>l.name).join(', ')}</p>`:''}<footer><button data-act="product" aria-pressed="${doc.product==='rinse-off'}">${doc.product==='leave-on'?'Leave-on':'Rinse-off'}</button> threshold ${th}% · ${flagged.length?`<strong>${flagged.length} over a ceiling · 👐 clap to fix</strong>`:'illustrative ceilings met'}</footer>`);
 }
 /** Chips sit at the hand that earned them; newer ones step up past older ones nearby instead of covering them. */
 private drawAcks(s:OrganScene){
  const keep=new Set<number>(),placed:{x:number;y:number}[]=[];
  for(const a of [...s.acks].sort((p,q)=>p.id-q.id)){
   keep.add(a.id);let el=this.acks.get(a.id);
   if(!el){el=div(`organ-ack${a.miss?' is-miss':''}`,this.ackBox);el.textContent=a.text;this.acks.set(a.id,el);}
   let y=a.y-40;const w=el.offsetWidth||200;
   while(placed.some(p=>Math.abs(p.y-y)<30&&Math.abs(p.x-a.x)<(w+220)/2))y-=32;
   placed.push({x:a.x,y});el.style.transform=`translate(${Math.round(a.x)}px,${Math.round(y)}px)`;
   el.style.opacity=String(Math.max(0,Math.min(1,(1.4-a.age)/.35)));
  }
  for(const [id,el] of this.acks)if(!keep.has(id)){el.remove();this.acks.delete(id);}
 }
 /** A faint gold skeleton of each tracked hand, so the viewer sees what the camera thinks. */
 private drawBones(s:OrganScene,W:number,H:number){
  this.skeleton.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const bones=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  const html=s.hands.filter(h=>h.points.length>=21).map(h=>`<g class="is-${h.pose}">${bones.map(([a,b])=>`<line x1="${h.points[a].x.toFixed(0)}" y1="${h.points[a].y.toFixed(0)}" x2="${h.points[b].x.toFixed(0)}" y2="${h.points[b].y.toFixed(0)}"/>`).join('')}<circle cx="${((h.points[4].x+h.points[8].x)/2).toFixed(0)}" cy="${((h.points[4].y+h.points[8].y)/2).toFixed(0)}" r="3"/></g>`).join('');
  if(this.skeleton.dataset.html!==html){this.skeleton.dataset.html=html;this.skeleton.innerHTML=html;}
 }
 /** Label lines as the viewer sees them, for tests. */
 get labelLines(){return [...this.labelList.querySelectorAll<HTMLElement>('li')].map(li=>({id:li.dataset.id!,gone:li.classList.contains('is-gone'),flagged:li.classList.contains('is-flagged'),opacity:Number(li.style.getPropertyValue('--o'))}));}
 dispose(){this.root.remove();}
}
