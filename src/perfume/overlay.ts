import type {Fragrance} from './flacon';
import type {Spray} from './model';

const SVG='http://www.w3.org/2000/svg';
export interface Leader {x:number;y:number;text:string;small?:string;
 /** Where the label sits; the line runs from (x,y) to it with one elbow. */
 lx:number;ly:number;align:'left'|'right'}
export interface NoteSpot {x:number;y:number;weight:number}
/** Illustrative droplet diameters in micrometres for what the pump is doing. Fine-mist pumps make droplets tens of micrometres across. */
const sizes:Record<Exclude<Spray,'none'>,[number,number,number]>={mist:[18,85,50],jet:[140,520,500],sputter:[90,700,500],dribble:[900,2600,1000]};
interface Drop {x:number;y:number;d:number;vx:number;vy:number;seed:number}
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls:string,parent:HTMLElement)=>{const e=document.createElement(tag);e.className=cls;parent.append(e);return e;};

/** Everything the perfume draws in HTML over the canvas: note labels, the dry-down card, the bullet-time loupe and gold leader lines. */
export class PerfumeOverlay {
 readonly root:HTMLDivElement;
 private svg:SVGSVGElement;private lensPath=document.createElementNS(SVG,'path');private paths:SVGPathElement[]=[];private dots:SVGCircleElement[]=[];private tags:HTMLElement[]=[];
 private notes:HTMLElement[]=[];private card:HTMLElement;private rows:HTMLElement[]=[];private title:HTMLElement;
 private loupe:HTMLElement;private lens:HTMLCanvasElement;private lensNote:HTMLElement;private drops:Drop[]=[];private lensKind:Spray='none';
 private shown=new WeakMap<HTMLElement,string>();
 constructor(host:HTMLElement){
  this.root=el('div','perfume-overlay',host);this.root.setAttribute('aria-hidden','true');
  this.svg=document.createElementNS(SVG,'svg');this.svg.classList.add('perfume-leaders');this.root.append(this.svg);this.svg.append(this.lensPath);
  this.title=el('p','perfume-atelier-title',this.root);this.title.innerHTML='<b>Atelier</b><span>exploded view · every part named</span>';
  for(let i=0;i<3;i++){const n=el('div','perfume-note',this.root);n.dataset.note=['top','heart','base'][i];n.innerHTML='<i></i><b></b><span></span>';this.notes.push(n);}
  this.card=el('div','perfume-drydown',this.root);this.card.innerHTML='<b>On skin</b><small>dry-down, hours shown in seconds</small>';
  for(let i=0;i<3;i++){const r=el('div','perfume-dry-row',this.card);r.innerHTML='<i></i><b></b><span></span><em><s></s></em>';this.rows.push(r);}
  this.loupe=el('div','perfume-loupe',this.root);this.lens=el('canvas','',this.loupe);this.lensNote=el('p','',this.loupe);
  this.lens.width=this.lens.height=Math.round(170*Math.min(2,devicePixelRatio||1));
 }
 private text(e:HTMLElement,value:string){if(this.shown.get(e)!==value){this.shown.set(e,value);e.innerHTML=value;}}
 private place(e:HTMLElement,x:number,y:number,opacity:number){
  const on=opacity>.02;e.classList.toggle('is-on',on);
  if(on){e.style.transform=`translate(${Math.round(x)}px,${Math.round(y)}px)`;e.style.opacity=opacity.toFixed(2);}
 }
 fragrance(f:Fragrance){
  f.notes.forEach((n,i)=>{
   for(const e of [this.notes[i],this.rows[i]]){e.style.setProperty('--note',n.color);this.text(e.querySelector('b')!,n.name);this.text(e.querySelector('span')!,n.line);}
  });
 }
 /** Floating labels by each note's cloud, top above, base below, so they rarely collide. */
 notesAt(spots:NoteSpot[]){
  // Top stays highest and base lowest, each at least a label apart, even when the clouds overlap.
  let last=-Infinity;
  spots.forEach((s,i)=>{const y=Math.max(s.y+(i-1)*24-12,last+44),on=s.weight>.3;if(on)last=y;this.place(this.notes[i],s.x+26,y,Math.min(1,s.weight*.05));});
 }
 /** levels: each note's strength on skin now; null hides the card. */
 dry(at:{x:number;y:number}|null,levels:number[]){
  this.place(this.card,at?at.x+60:0,at?at.y-70:0,at?1:0);
  if(!at)return;
  const lead=levels.indexOf(Math.max(...levels));
  this.rows.forEach((r,i)=>{r.classList.toggle('is-lead',levels[i]>.05&&i===lead);(r.querySelector('s') as HTMLElement).style.width=`${Math.round(levels[i]*100)}%`;});
 }
 leaders(list:Leader[],title:number){
  const n=list.length;
  while(this.paths.length<n){const p=document.createElementNS(SVG,'path'),c=document.createElementNS(SVG,'circle');c.setAttribute('r','2.2');this.svg.append(p,c);this.paths.push(p);this.dots.push(c);this.tags.push(el('div','perfume-tag',this.root));}
  for(let i=0;i<this.paths.length;i++){
   const l=list[i],p=this.paths[i],c=this.dots[i],t=this.tags[i];
   if(!l){p.setAttribute('d','');c.setAttribute('r','0');t.classList.remove('is-on');continue;}
   const elbow=l.lx+(l.align==='left'?14:-14);
   p.setAttribute('d',`M${l.x.toFixed(1)} ${l.y.toFixed(1)}L${elbow.toFixed(1)} ${l.ly.toFixed(1)}L${l.lx.toFixed(1)} ${l.ly.toFixed(1)}`);
   c.setAttribute('cx',l.x.toFixed(1));c.setAttribute('cy',l.y.toFixed(1));c.setAttribute('r','2.2');
   this.text(t,`<b>${l.text}</b>${l.small?`<small>${l.small}</small>`:''}`);t.dataset.align=l.align;
   this.place(t,l.lx,l.ly,1);
  }
  this.place(this.title,24,this.root.clientHeight-200,title);
 }
 get leaderCount(){return this.tags.filter(t=>t.classList.contains('is-on')).length;}
 /** Bullet time: a magnified sample of the droplets, with a scale bar. Sizes are illustrative, from the spray kind. */
 lensAt(at:{x:number;y:number;fromX:number;fromY:number}|null,kind:Spray,dt:number){
  this.place(this.loupe,at?at.x-85:0,at?at.y-85:0,at&&kind!=='none'?1:0);
  if(!at||kind==='none'){this.lensPath.setAttribute('d','');return;}
  {const dx=at.fromX-at.x,dy=at.fromY-at.y,l=Math.hypot(dx,dy)||1;this.lensPath.setAttribute('d',`M${at.fromX.toFixed(1)} ${at.fromY.toFixed(1)}L${(at.x+dx/l*86).toFixed(1)} ${(at.y+dy/l*86).toFixed(1)}`);}
  const [lo,hi,bar]=sizes[kind],c=this.lens,g=c.getContext('2d')!,w=c.width,scale=w/170,px=w*.22/bar;
  if(kind!==this.lensKind){this.lensKind=kind;this.drops=Array.from({length:kind==='mist'?15:6},()=>({x:Math.random()*w,y:Math.random()*w,d:lo+(hi-lo)*Math.random()**1.6,vx:(Math.random()*.6+.7)*6*scale,vy:(Math.random()-.5)*3*scale,seed:Math.random()*6}));}
  g.clearRect(0,0,w,w);g.save();g.beginPath();g.arc(w/2,w/2,w/2-1,0,Math.PI*2);g.clip();
  g.fillStyle='rgba(6,10,14,.82)';g.fillRect(0,0,w,w);
  g.strokeStyle='rgba(255,255,255,.05)';g.lineWidth=1;for(let k=0;k<w;k+=w/8){g.beginPath();g.moveTo(k,0);g.lineTo(k,w);g.moveTo(0,k);g.lineTo(w,k);g.stroke();}
  for(const d of this.drops){
   // Almost frozen: a slow crawl and a shimmer, so they read as droplets in flight.
   d.x+=d.vx*dt;d.y+=d.vy*dt+Math.sin(performance.now()/700+d.seed)*.05*scale;
   const r=Math.max(1.2*scale,d.d*px/2);if(d.x-r>w){d.x=-r;d.y=Math.random()*w;}
   const grad=g.createRadialGradient(d.x-r*.35,d.y-r*.35,r*.1,d.x,d.y,r);
   grad.addColorStop(0,'rgba(255,255,255,.95)');grad.addColorStop(.35,'rgba(214,236,255,.45)');grad.addColorStop(1,'rgba(160,200,230,.12)');
   g.fillStyle=grad;g.beginPath();g.arc(d.x,d.y,r,0,Math.PI*2);g.fill();
   g.strokeStyle='rgba(220,240,255,.55)';g.lineWidth=scale;g.stroke();
  }
  g.restore();
  // Scale bar: bar micrometres at the same magnification as the droplets.
  const len=bar*px,x0=w/2-len/2,y0=w*.86;
  g.strokeStyle='#f3cf86';g.lineWidth=2*scale;g.beginPath();g.moveTo(x0,y0);g.lineTo(x0+len,y0);g.moveTo(x0,y0-4*scale);g.lineTo(x0,y0+4*scale);g.moveTo(x0+len,y0-4*scale);g.lineTo(x0+len,y0+4*scale);g.stroke();
  g.fillStyle='#f3cf86';g.font=`${11*scale}px "DM Sans",system-ui,sans-serif`;g.textAlign='center';g.fillText(`${bar>=1000?bar/1000+' mm':bar+' µm'}`,w/2,y0-8*scale);
  this.text(this.lensNote,`Bullet time · ${kind} · droplets ~${lo}–${hi} µm, illustrative`);
 }
 get lensOn(){return this.loupe.classList.contains('is-on');}
 get notesOn(){return this.notes.map(n=>n.classList.contains('is-on'));}
 get dryOn(){return this.card.classList.contains('is-on');}
 dispose(){this.root.remove();}
}
