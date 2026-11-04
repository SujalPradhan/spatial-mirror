import {briefs} from './briefs';
import type {DrivetrainEngine} from './engine';

const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
const drawSteps=[['☝️','Point and trace a closed loop in the air'],['👍','Hold: find a four-bar that draws it'],['🖐','Hold: the next of the three best'],['👐','Clap: chain a leg onto it'],['✊','Fist on the crank pivot turns it by hand'],['✌️','Hold: clear, 👎 brings it back']];

/** The brief and its live check, the brief-met moment, the undo note, and mouse controls for everything hands can do. */
export class DrivetrainHud {
 private readonly card:HTMLElement;private readonly banner:HTMLElement;private readonly toast:HTMLElement;private readonly controls:HTMLElement;
 private said='';private bannerFor=-1;
 constructor(stage:HTMLElement,private readonly engine:DrivetrainEngine){
  stage.insertAdjacentHTML('beforeend',`<section class="dt-card" aria-live="polite"></section><div class="dt-banner" hidden><b>Brief met</b><span></span></div><p class="dt-toast" hidden></p>
<div class="dt-controls"><button data-act="prev" title="Previous brief">◀</button><button data-act="next" title="Next brief, N">▶</button><button data-act="mode" title="D">Draw the motion</button><button data-act="schematic" title="S">Schematic</button><button data-act="undo">Undo</button></div>`);
  const $=(s:string)=>stage.querySelector<HTMLElement>(s)!;
  this.card=$('.dt-card');this.banner=$('.dt-banner');this.toast=$('.dt-toast');this.controls=$('.dt-controls');
  this.controls.onclick=e=>{const act=(e.target as HTMLElement).closest('button')?.dataset.act;if(act)this.act(act);};
 }
 act(act:string){
  const t=this.engine.train;
  if(act==='prev'||act==='next'){if(t.mode==='draw')t.setMode('build');t.setBrief(t.brief+(act==='next'?1:-1));}
  else if(act==='mode')t.setMode(t.mode==='draw'?'build':'draw');
  else if(act==='schematic')t.schematic=!t.schematic;
  else if(act==='undo')t.undo();
 }
 update(){
  const t=this.engine.train,b=t.current,v=t.verdict;
  const html=t.mode==='draw'
   ?`<small>Draw the motion</small><h2>Trace a path, get a linkage</h2><ol class="dt-steps">${drawSteps.map(([g,s])=>`<li><i>${g}</i>${s}</li>`).join('')}</ol>${t.match?`<p class="dt-now">Showing linkage ${t.matchIndex+1} of ${t.matches.length}${t.leg?' · with a leg':''}</p>`:t.closed?'<p class="dt-now">Loop closed. Hold 👍</p>':''}`
   :`<small>Brief ${t.brief+1} of ${briefs.length} · ${esc(b.title)}</small><h2>${esc(b.goal)}</h2><ul class="dt-checks">${v.checks.map(c=>`<li class="${c.ok?'is-ok':''}"><i>${c.ok?'✓':'·'}</i>${esc(c.label)}<span>${esc(c.now)}</span></li>`).join('')}</ul>${v.met?`<p class="dt-met">Met${t.brief<briefs.length-1?' · pinch Next brief in the tray':' · every brief done'}</p>`:`<p class="dt-hint">${esc(b.hint)}</p>`}`;
  if(html!==this.said){this.card.innerHTML=html;this.said=html;}
  this.card.classList.toggle('is-met',t.mode==='build'&&v.met);
  const met=t.mode==='build'?t.metFor:-1,show=met>=0&&met<3.2;
  if(show!==!this.banner.hidden){this.banner.hidden=!show;if(show){this.banner.querySelector('span')!.textContent=b.goal;this.bannerFor=t.brief;}}
  void this.bannerFor;
  const undo=t.undoLabel;this.toast.hidden=!undo;if(undo){const text=`${undo}. 👎 or Undo puts it back`;if(this.toast.textContent!==text)this.toast.textContent=text;}
  const mode=this.controls.querySelector<HTMLElement>('[data-act=mode]')!,label=t.mode==='draw'?'Back to build':'Draw the motion';if(mode.textContent!==label)mode.textContent=label;
  this.controls.querySelector<HTMLElement>('[data-act=schematic]')!.classList.toggle('is-on',t.schematic);
 }
}
