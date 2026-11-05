import {DAY,hourName,lasts,ribbon,smellAt,toBlend,total,wordsOf,type Items} from './accord';
import type {OrganScene,Px} from './contracts';
import {allergenById,familyColor,ingredientById} from './ingredients';
import {RIBBON_BOTTOM,RIBBON_H,inZone} from './layout';
import {label} from './model';
import {chapterNames,type Chapter,type GestureId} from './story';

export interface HudWorld {readonly size:{w:number;h:number}}
const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
/** Writes only when the markup changed, so CSS entrances play once. */
function set(el:HTMLElement,html:string){if(el.dataset.html!==html){el.dataset.html=html;el.innerHTML=html;}}
function at(el:HTMLElement,p:Px|null,on=true){const show=!!p&&on;el.classList.toggle('is-on',show);if(show)el.style.transform=`translate(${Math.round(p!.x)}px,${Math.round(p!.y)}px)`;}
const div=(cls:string,parent:HTMLElement,tag='div')=>{const el=document.createElement(tag);el.className=cls;parent.append(el);return el;};
const name=(id:string)=>ingredientById.get(id)!.name;
/** Each gesture as the hand does it, and the mouse way beside it. */
const chips:Record<GestureId,[string,string,string]>={
 pinch:['🤏','Pinch a vial to pick it up','click'],tilt:['↻','Tilt your wrist to pour','scroll'],both:['🤏🤏','A vial in each hand','one at a time'],
 waft:['🖐↑','Wave up to smell','Smell button'],fist:['✊↻','Turn a fist to move the day','drag the band'],undo:['👎','Hold to undo','⌘Z'],
 button:['🤏','Pinch the button','click'],rub:['🙌','Rub palms: warm skin','Warm button'],
};
const W0=1000,H0=100;
/** The HTML layer: one line of story, the day ribbon, the palm, and every cue a hand needs before and after it acts. */
export class OrganHud {
 readonly root:HTMLElement;
 private line:HTMLElement;private lineText:HTMLElement;private lineSub:HTMLElement;private lineChips:HTMLElement;private chapters:HTMLElement;private ribbon:HTMLElement;private ribbonSvg:HTMLElement;private ribbonHead:HTMLElement;private cursor:HTMLElement;private palmTag:HTMLElement;private pair:HTMLElement;private label:HTMLElement;private swap:HTMLElement;private offer:HTMLButtonElement;private hover:HTMLElement;private waft:HTMLElement;
 private tags=new Map<string,HTMLElement>();private meters:HTMLElement[]=[];private reticles:HTMLElement[]=[];private holds:HTMLElement[]=[];private acks=new Map<number,HTMLElement>();private puffs=new Map<number,HTMLElement>();private ackBox:HTMLElement;private skeleton:SVGSVGElement;
 constructor(private host:HTMLElement){
  const r=this.root=div('organ-hud',host);
  this.skeleton=document.createElementNS('http://www.w3.org/2000/svg','svg');this.skeleton.setAttribute('class','organ-bones');r.append(this.skeleton);
  this.line=div('organ-line',r,'section');this.lineText=div('',this.line,'b');this.lineText.setAttribute('aria-live','polite');this.lineSub=div('',this.line,'small');this.lineChips=div('',this.line);
  this.chapters=div('organ-chapters',r,'nav');this.chapters.setAttribute('aria-label','Chapters');
  this.ribbon=div('organ-ribbon',r,'section');this.ribbon.setAttribute('aria-label','Your day, 9:00 to 18:00');
  this.ribbonHead=div('organ-ribbon-head',this.ribbon,'header');this.ribbonSvg=div('organ-ribbon-plot',this.ribbon);this.cursor=div('organ-cursor',this.ribbon);
  div('organ-hours',this.ribbon).innerHTML=Array.from({length:DAY+1},(_,i)=>`<i style="left:${i/DAY*100}%">${9+i}:00</i>`).join('');
  this.palmTag=div('organ-palm',r);this.pair=div('organ-pair',r);this.label=div('organ-card organ-label',r,'section');this.swap=div('organ-card organ-swap',r,'section');
  this.offer=div('organ-offer',r,'button') as HTMLButtonElement;this.offer.dataset.act='next';
  this.hover=div('organ-hover',r);this.waft=div('organ-waft',r);
  for(let i=0;i<3;i++)this.meters.push(div('organ-meter',r));
  for(let i=0;i<2;i++){this.reticles.push(div('organ-reticle',r));const h=div('organ-hold',r);h.innerHTML='<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27"/><circle class="is-run" cx="32" cy="32" r="27"/></svg><i></i><span></span>';this.holds.push(h);}
  this.ackBox=div('organ-acks',r);
  // Buttons and the ribbon are the mouse's way in; they must not start an orbit drag underneath.
  for(const el of [this.line,this.chapters,this.ribbon,this.palmTag,this.offer,this.label])el.addEventListener('pointerdown',e=>e.stopPropagation());
  r.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-act]');if(b)this.emit(b.dataset.act!,Number(b.dataset.value));});
  // Dragging along the ribbon moves through the day.
  const scrub=(e:PointerEvent)=>{const box=this.ribbonSvg.getBoundingClientRect();this.emit('clock',Math.max(0,Math.min(1,(e.clientX-box.left)/box.width))*DAY);};
  this.ribbon.addEventListener('pointerdown',e=>{if(!this.ribbon.classList.contains('is-live'))return;this.ribbon.setPointerCapture(e.pointerId);scrub(e);});
  this.ribbon.addEventListener('pointermove',e=>{if(this.ribbon.hasPointerCapture(e.pointerId))scrub(e);});
 }
 private emit(act:string,value:number){this.host.dispatchEvent(new CustomEvent('organ-action',{bubbles:true,detail:{act,value}}));}
 update(s:OrganScene,w:HudWorld){
  const {w:W,h:H}=w.size,sv=s.story,items=s.doc.items;
  // The one line, and only the gestures this beat uses.
  const lit=new Set(s.lit);
  // Three parts, each rewritten only when it changes, so the headline's entrance plays once per beat and not on every hint.
  if(this.lineText.dataset.html!==esc(sv.text)){set(this.lineText,esc(sv.text));this.lineText.style.animation='none';void this.lineText.offsetWidth;this.lineText.style.animation='';}this.lineText.classList.toggle('is-locked',sv.locked>=0);set(this.lineSub,sv.sub?esc(sv.sub):'');
  set(this.lineChips,`${sv.gestures.length?`<ul>${sv.gestures.map(g=>`<li data-gesture="${g}" class="${lit.has(g)?'is-on':''}"><i>${chips[g][0]}</i>${chips[g][1]}<small>${g==='undo'?`<button data-act="undo" ${s.undoable?'':'disabled'}>${chips[g][2]}</button>`:g==='rub'?`<button data-act="warm" aria-pressed="${s.doc.warm}">${chips[g][2]}</button>`:chips[g][2]}</small></li>`).join('')}</ul>`:''}`);
  set(this.chapters,([1,2,3,4] as Chapter[]).map(c=>`<button data-act="chapter" data-value="${c}" ${c===sv.chapter?'aria-current="step"':''}>${c<4?`${c} `:''}${chapterNames[c]}</button>`).join(''));
  this.drawRibbon(s,W);
  // Vials: name and smell first; chemistry waits for chapter 2.
  const keep=new Set<string>();
  for(const sl of s.slots){
   keep.add(sl.id);let t=this.tags.get(sl.id);if(!t){t=div('organ-tag',this.root);this.tags.set(sl.id,t);}
   const held=s.held.some(g=>g.id===sl.id),active=sv.active.includes(sl.id),free=sv.chapter===4,ing=ingredientById.get(sl.id)!;
   set(t,`<b>${esc(name(sl.id))}</b>${free?'':`<small>${wordsOf(sl.id).join(', ')}</small>`}${sv.labelOn&&sl.id==='oakmoss'?'<em>limited</em>':''}`);
   t.style.setProperty('--c',familyColor[ing.family]);t.classList.toggle('is-asleep',!active);t.classList.toggle('is-hot',s.hover?.id===sl.id||s.reticles.some(r=>r.target===sl.id));t.classList.toggle('is-free',free);
   at(t,{x:sl.x,y:sl.y+sl.size/2+6},!held);
  }
  for(const [id,t] of this.tags)if(!keep.has(id))at(t,null);
  // The palm: what is on it, and the mouse's way to smell it.
  const n=total(items);
  set(this.palmTag,`<b>Your palm</b><small>${n?`${n<10?n.toFixed(1):Math.round(n)} drops${s.doc.warm?' · warm skin':''}`:'pour here'}</small><button data-act="waft" ${n?'':'disabled'}>Smell</button>`);
  at(this.palmTag,{x:s.palm.x,y:s.palm.y+Math.min(40,H*.055)});
  // A meter rides with each vial in a hand: tilt against the level band, the rate, and what this pour added.
  s.held.slice(0,3).forEach((g,i)=>{
   const el=this.meters[i],k=Math.max(-1,Math.min(1,g.tilt/1.1)),zone=inZone(g,W,H),state=g.loose?'let go?':g.rate>0?(zone?`pouring · ${g.rate.toFixed(1)} drops/s`:'over your palm to pour'):zone?'level · tilt to pour':'bring it over your palm';
   set(el,`<b>${esc(name(g.id))} <span>+${g.poured.toFixed(1)}</span></b><svg viewBox="-40 -40 80 44"><path class="track" d="M-34 0A34 34 0 0 1 34 0"/><path class="dead" d="${arc(-.2,.2)}"/><line x1="0" y1="0" x2="${(Math.sin(k*1.4)*34).toFixed(1)}" y2="${(-Math.cos(k*1.4)*34).toFixed(1)}"/></svg><small>${state}</small>`);
   el.classList.toggle('is-pouring',g.rate>0&&zone);el.classList.toggle('is-loose',g.loose);at(el,{x:g.x+(g.x<s.palm.x?-118:118),y:g.y+10});
  });
  for(let i=s.held.length;i<3;i++)at(this.meters[i],null);
  // The balance between two materials, the perfumery-school pair exercise, with the outline's ratio as a notch.
  const p=s.pair;
  if(p){const ra=items[p.a]??0,rb=items[p.b]??0,ratio=rb>.05?ra/rb:null;
   set(this.pair,`<span><b>${esc(name(p.a))}</b><b>${esc(name(p.b))}</b></span><div style="--a:${ingredientById.get(p.a)!.color};--b:${ingredientById.get(p.b)!.color}"><s style="width:${(p.share*100).toFixed(1)}%"></s>${p.target!==null?`<i style="left:${(p.target*100).toFixed(1)}%"></i>`:''}</div><small>${ratio===null?ra>.05?'all '+esc(name(p.a).toLowerCase()):'nothing yet':ra<.05?'all '+esc(name(p.b).toLowerCase()):`${ratio.toFixed(1)} : 1`}${p.target!==null?` · notch ${(p.target/(1-p.target)).toFixed(0)} : 1`:''}</small>`);
   at(this.pair,p);
  }else at(this.pair,null);
  this.drawLabel(s,W,H);this.drawSwap(s,H);
  // The offer, pinchable as well as clickable.
  if(s.offer&&sv.offer){this.offer.textContent=sv.offer;this.offer.style.width=`${s.offer.w}px`;this.offer.style.height=`${s.offer.h}px`;at(this.offer,{x:s.offer.x-s.offer.w/2,y:s.offer.y-s.offer.h/2});this.offer.classList.toggle('is-hot',s.offerHot);}else at(this.offer,null);
  // Hover: smell before chemistry.
  const hv=s.hover&&!s.held.length?s.hover:null;
  if(hv){const al=sv.labelOn?Object.keys(ingredientById.get(hv.id)!.allergens).map(a=>allergenById.get(a)!.name):[];
   set(this.hover,`<b>${esc(name(hv.id))}</b><p>${wordsOf(hv.id).join(', ')}</p><small>${lasts(hv.id)}</small>${al.length?`<small class="is-chem">contains ${al.slice(0,3).join(', ')}</small>`:''}`);
   const sl=s.slots.find(x=>x.id===hv.id);at(this.hover,sl?{x:Math.min(W-200,sl.x+sl.r+8),y:sl.y-sl.size/2-10}:null);
  }else at(this.hover,null);
  if(s.waftPreview){at(this.waft,{x:s.waftPreview.x,y:s.waftPreview.y-60});this.waft.style.setProperty('--k',s.waftPreview.k.toFixed(2));set(this.waft,'<i>🖐</i><span>waft…</span>');}else at(this.waft,null);
  s.reticles.slice(0,2).forEach((rt,i)=>{const el=this.reticles[i];at(el,rt);el.style.setProperty('--k',String(1-rt.close*.6));el.classList.toggle('has-target',!!rt.target);});
  for(let i=s.reticles.length;i<2;i++)at(this.reticles[i],null);
  s.holds.slice(0,2).forEach((h,i)=>{const el=this.holds[i];at(el,{x:h.x,y:h.y-90});el.style.setProperty('--p',String(Math.min(1,h.progress)));el.querySelector('i')!.textContent=h.glyph;el.querySelector('span')!.textContent=h.label;});
  for(let i=s.holds.length;i<2;i++)at(this.holds[i],null);
  this.drawPuffs(s);this.drawAcks(s);this.drawBones(s,W,H);
  this.root.classList.toggle('is-free',sv.chapter===4);
 }
 private drawRibbon(s:OrganScene,W:number){
  const sv=s.story,items=s.doc.items,skin=s.doc.warm?'warm':'normal',ghost=sv.ghost,live=sv.ribbonLive,el=this.ribbon;
  const width=Math.min(900,W-80);el.style.width=`${width}px`;el.style.height=`${RIBBON_H}px`;el.style.bottom=`${RIBBON_BOTTOM}px`;
  el.classList.toggle('is-live',live);el.classList.toggle('is-locked',sv.locked>=0&&sv.locked<2.5);
  const gt=ghost?total(ghost):16,g=ghost?ribbon(ghost,skin):null,u=ribbon(items,skin,gt),peak=Math.max(g?Math.max(...g.total):0,Math.max(...u.total,0))*1.18||1;
  const X=(j:number)=>(j/(u.t.length-1)*W0).toFixed(1),Y=(v:number)=>(H0-v/peak*H0).toFixed(1);
  const area=(lo:number[],hi:number[])=>`M${hi.map((v,j)=>`${X(j)},${Y(v)}`).join('L')}L${lo.map((v,j)=>`${X(j)},${Y(v)}`).reverse().join('L')}Z`;
  let svg='';
  if(g)svg+=`<path class="ghost" d="${area(g.total.map(()=>0),g.total)}"/>`;
  if(live&&u.bands.length){let lo=u.t.map(()=>0);svg+=`<g clip-path="url(#organ-draw)">`;for(const b of u.bands){const hi=lo.map((v,j)=>v+b.v[j]);svg+=`<path class="band" style="--c:${ingredientById.get(b.id)!.color}" d="${area(lo,hi)}"/>`;lo=hi;}svg+='</g>';}
  if(g)svg+=`<path class="ghost-line" d="M${g.total.map((v,j)=>`${X(j)},${Y(v)}`).join('L')}"/>`;
  const draw=s.draw*W0;
  set(this.ribbonSvg,`<svg viewBox="0 0 ${W0} ${H0}" preserveAspectRatio="none"><defs><clipPath id="organ-draw"><rect x="0" y="-5" width="${draw.toFixed(0)}" height="${H0+10}"/></clipPath></defs>${svg}</svg>${sv.beat==='top'?`<em style="left:1%">bright at 9:00</em><em style="left:${200/9}%">thin by 11:00</em><em style="left:${300/9}%">empty by noon</em>`:''}`);
  const m=s.match,score=sv.scoreOn&&m?Math.round(m.score*100):null;
  set(this.ribbonHead,`<b>Your day</b><small>${!live?'pour, then smell, to see how it lasts':ghost?sv.chapter===2?'dotted: your accord before the swap':'dotted: the outline to fill':'how it wears, hour by hour'}</small>${sv.chapter===4&&Object.keys(items).length?`<em>label must name: ${esc(freeLabel(items))}</em>`:''}${score!==null?`<strong class="${sv.locked>=0?'is-locked':''}">${sv.locked>=0?'✓ ':''}${score}%<small> of the outline</small></strong>`:''}`);
  // The cursor: the hour, and what you would smell then.
  const words=Object.keys(items).length?smellAt(items,s.clock,skin,ribbon(items,skin,null,2).total[0]):[];
  this.cursor.style.left=`${s.clock/DAY*100}%`;this.cursor.style.setProperty('--shift',`${(-s.clock/DAY*100).toFixed(1)}%`);this.cursor.classList.toggle('is-on',live);this.cursor.classList.toggle('is-scrub',s.scrubbing);
  set(this.cursor,`<span><b>${hourName(s.clock)}</b>${words.length?` ${esc(words.join(', '))}`:''}</span>`);
 }
 /** Chapter 2 on: the allergens the label must name, in plain words, written as they appear. */
 private drawLabel(s:OrganScene,W:number,H:number){
  if(!s.story.labelOn||s.story.chapter===4||!Object.keys(s.doc.items).length){at(this.label,null);return;}
  const items=s.doc.items,lines=label(toBlend(items)).filter(l=>l.declared).sort((a,b)=>(b.cap?1:0)-(a.cap?1:0)||b.product-a.product);
  const from=(id:string)=>Object.keys(items).filter(i=>(ingredientById.get(i)!.allergens[id]??0)>0).map(i=>name(i).toLowerCase());
  set(this.label,`<header><b>The label</b><small>what the box must say</small></header><ul>${lines.slice(0,6).map(l=>`<li class="${l.flagged?'is-flagged':''}" data-id="${l.id}"><b>${esc(l.name)}</b>: ${l.cap?'must be named, use limited':'must be named'}${l.flagged?' <em>over the limit</em>':''}<small>from ${from(l.id).join(', ')}</small></li>`).join('')}</ul><footer>Fragrance allergens above a trace must be named on the box.</footer>`);
  at(this.label,{x:W-this.label.offsetWidth-18,y:Math.max(190,H*.25)});
 }
 private drawSwap(s:OrganScene,H:number){
  const c=s.doc.swap,orig=s.story.chapter===2?s.story.ghost:null;
  if(!c||!orig){at(this.swap,null);return;}
  const skin=s.doc.warm?'warm':'normal',gt=total(orig),late=(it:Items)=>ribbon(it,skin,gt).total.at(-1)!,eve=late(s.doc.items)/late(orig)-1;
  set(this.swap,`<header><b>Reformulated</b><small>the swap the rule forces</small></header><p>${c.changes.map(ch=>`${esc(name(ch.id))} → <em>${esc(ch.by?name(ch.by):`${ch.to} drops`)}</em>`).join('<br>')}</p><dl><dt>character kept</dt><dd>${Math.round(c.kept*100)}%</dd><dt>evening at 18:00</dt><dd>${eve>=0?'+':''}${Math.round(eve*100)}%</dd></dl>`);
  at(this.swap,{x:18,y:Math.max(190,H*.25)});
 }
 private drawPuffs(s:OrganScene){
  const keep=new Set<number>();
  for(const p of s.puffs){keep.add(p.id);let el=this.puffs.get(p.id);
   if(!el){el=div(`organ-puff${p.miss?' is-miss':''}`,this.ackBox);el.innerHTML=p.words.map((x,i)=>`<span style="--i:${i}">${esc(x)}</span>`).join('');this.puffs.set(p.id,el);el.style.transform=`translate(${Math.round(p.x)}px,${Math.round(p.y)}px)`;}
  }
  for(const [id,el] of this.puffs)if(!keep.has(id)){el.remove();this.puffs.delete(id);}
 }
 /** Chips sit at the hand that earned them; newer ones step up past older ones nearby. */
 private drawAcks(s:OrganScene){
  const keep=new Set<number>(),placed:{x:number;y:number}[]=[];
  for(const a of [...s.acks].sort((p,q)=>p.id-q.id)){
   keep.add(a.id);let el=this.acks.get(a.id);
   if(!el){el=div(`organ-ack${a.miss?' is-miss':''}`,this.ackBox);el.textContent=a.text;this.acks.set(a.id,el);}
   let y=a.y-40;const w=el.offsetWidth||200;
   while(placed.some(p=>Math.abs(p.y-y)<30&&Math.abs(p.x-a.x)<(w+220)/2))y-=32;
   placed.push({x:a.x,y});el.style.transform=`translate(${Math.round(a.x)}px,${Math.round(y)}px)`;
   el.style.opacity=String(Math.max(0,Math.min(1,(1.5-a.age)/.35)));
  }
  for(const [id,el] of this.acks)if(!keep.has(id)){el.remove();this.acks.delete(id);}
 }
 private drawBones(s:OrganScene,W:number,H:number){
  this.skeleton.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const bones=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  const html=s.hands.filter(h=>h.points.length>=21).map(h=>`<g class="is-${h.pose}">${bones.map(([a,b])=>`<line x1="${h.points[a].x.toFixed(0)}" y1="${h.points[a].y.toFixed(0)}" x2="${h.points[b].x.toFixed(0)}" y2="${h.points[b].y.toFixed(0)}"/>`).join('')}</g>`).join('');
  if(this.skeleton.dataset.html!==html){this.skeleton.dataset.html=html;this.skeleton.innerHTML=html;}
 }
 /** Label lines as the viewer sees them, for tests. */
 get labelLines(){return [...this.label.querySelectorAll<HTMLElement>('li')].map(li=>({id:li.dataset.id!,text:li.textContent??'',flagged:li.classList.contains('is-flagged')}));}
 dispose(){this.root.remove();}
}
/** The free organ's label, in one line. */
function freeLabel(items:Items){const l=label(toBlend(items)).filter(x=>x.declared);return l.length?l.slice(0,4).map(x=>x.cap?`${x.name} (limited)`:x.name).join(', ')+(l.length>4?` +${l.length-4}`:''):'nothing';}
/** An arc on the tilt gauge between two tilts, radians. */
function arc(a:number,b:number){const p=(t:number)=>`${(Math.sin(t*1.4/1.1)*34).toFixed(1)} ${(-Math.cos(t*1.4/1.1)*34).toFixed(1)}`;return `M${p(a)}A34 34 0 0 1 ${p(b)}`;}
