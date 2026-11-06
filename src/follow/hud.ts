import {tipOf,type Link,type V3} from '../grasp/kinematics';
import {forward} from '../grasp/kinematics';
import type {FollowEngine} from './engine';
import type {FollowView} from './view';

const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
const RING=276.5;

/** Everything around the stage: lessons, the step list, the hold ring, hints, the count, the summary, and the corner and About buttons. */
export class FollowHud {
 private said:Record<string,string>={};private readonly el:Record<string,HTMLElement>={};
 constructor(private readonly stage:HTMLElement,private readonly engine:FollowEngine,private readonly view:FollowView,private readonly prefix='follow'){
  stage.insertAdjacentHTML('beforeend',`
<section class="fo-lessons" aria-label="Lessons"></section>
<section class="fo-steps" aria-label="Steps"><small>Steps</small><ol></ol></section>
<section class="fo-now" aria-live="polite"><div class="fo-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/><circle class="fo-ring-fill" cx="50" cy="50" r="44"/></svg><i></i></div><p><b></b><small></small></p></section>
<p class="fo-note" hidden></p>
<div class="fo-count" hidden aria-live="assertive"></div>
<section class="fo-summary" hidden aria-label="Lesson summary"></section>
<div class="fo-labels"><span class="fo-tag fo-tag-teacher">Teacher</span><span class="fo-tag fo-tag-you">You</span></div>`);
  for(const k of ['lessons','steps','now','note','count','summary','labels'])this.el[k]=stage.querySelector<HTMLElement>(`.fo-${k}`)!;
  const corner=stage.querySelector<HTMLElement>(`.${prefix}-corner .mirror-tools`)!;
  corner.insertAdjacentHTML('afterbegin',`<button id="${prefix}-record" title="Record your own move">Record</button><button id="${prefix}-repeat" title="Show this step again (clap)">Repeat</button><button id="${prefix}-skip" title="Skip this step">Skip</button><button id="${prefix}-undo" title="Undo the last recording" hidden>Undo recording</button>`);
  const about=stage.parentElement!.querySelector<HTMLElement>(`#${prefix}-about`)!;
  about.querySelector(`#${prefix}-about-close`)!.insertAdjacentHTML('beforebegin',`<div class="fo-io"><button id="${prefix}-export">Export lesson</button> <button id="${prefix}-import">Import lesson</button><input id="${prefix}-file" type="file" accept="application/json,.json" hidden></div> `);
  const $=<T extends HTMLElement>(id:string)=>document.querySelector<T>(`#${prefix}-${id}`)!;
  $('record').onclick=()=>engine.toggleRecord();$('repeat').onclick=()=>engine.repeat();$('skip').onclick=()=>engine.skip();$('undo').onclick=()=>engine.undoRecording();
  $('export').onclick=()=>{
   const blob=new Blob([engine.exportMine()],{type:'application/json'}),a=document.createElement('a');
   a.href=URL.createObjectURL(blob);a.download=`${engine.lesson.title.toLowerCase().replace(/\W+/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };
  $('import').onclick=()=>$('file').click();
  $<HTMLInputElement>('file').onchange=async e=>{const input=e.target as HTMLInputElement,file=input.files?.[0];if(file){engine.importLesson(await file.text());$<HTMLDialogElement>('about').close();}input.value='';};
  stage.addEventListener('click',e=>{
   const b=(e.target as HTMLElement).closest<HTMLElement>('button');if(!b)return;
   if(b.dataset.lesson)engine.select(b.dataset.lesson);else if(b.dataset.act==='again')engine.restart(false);else if(b.dataset.act==='next')engine.select(engine.lessons[(engine.lessons.findIndex(l=>l.id===engine.lessonId)+1)%engine.lessons.length].id);
  });
 }
 private set(key:string,el:Element,html:string){if(this.said[key]!==html){el.innerHTML=html;this.said[key]=html;}}
 private text(key:string,el:Element,text:string){if(this.said[key]!==text){el.textContent=text;this.said[key]=text;}}
 update(live:boolean){
  const scene=this.view.last as ReturnType<FollowEngine['step']>['scene']|null;if(!scene?.follow)return;
  const f=scene.follow,n=f.steps.length,p=this.prefix,$=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(`#${p}-${id}`)!;
  // Lessons.
  this.set('lessons',this.el.lessons,f.lessons.map(l=>`<button data-lesson="${l.id}" aria-pressed="${l.id===f.lessonId}" title="${esc(l.blurb)}">${esc(l.title)}</button>`).join(''));
  // Step list.
  this.set('steps',this.el.steps.querySelector('ol')!,f.steps.map((name,i)=>{
   const r=f.results[i],now=i===f.index&&(f.mode==='follow'||f.mode==='demo'),cls=r?(r.skipped?'is-skipped':'is-done'):now?'is-now':'';
   return `<li class="${cls}"><i>${r&&!r.skipped?'✓':i+1}</i><b>${esc(name)}</b>${r?`<small>${r.skipped?'skipped':`${r.score}% · ${r.seconds.toFixed(1)} s`}</small>`:''}</li>`;
  }).join(''));
  // The step you are on.
  const counting=f.mode==='countdown',recording=f.mode==='record',done=f.mode==='done';
  const title=counting?'Get ready':recording?`Recording ${f.recordSeconds!.toFixed(1)} s`:done?'Lesson done':`${f.index+1} of ${n} · ${f.name}`;
  const sub=counting?'Do your move and pause for half a second between poses.':recording?'Pause between poses. Press Stop when you are done, or wait for 10 s.':done?'':
   f.mode==='demo'?(live?'Show your hand and the teacher waits for you.':'Hands are the real input. Step into the mirror to follow along.'):
   !f.waiting?'Watch the move.':!f.hand?'Show your hand.':f.matched?'Hold it…':f.hint??'Match the teacher.';
  this.text('title',this.el.now.querySelector('b')!,title);this.text('sub',this.el.now.querySelector('small')!,sub);
  (this.el.now.querySelector('.fo-ring-fill') as SVGElement).style.strokeDashoffset=String(RING*(1-(f.waiting?f.hold:0)));
  this.text('ringi',this.el.now.querySelector('i')!,done?'✓':f.hold>=1||f.matched?'✓':recording||counting?'●':String(f.index+1));
  this.el.now.classList.toggle('is-match',f.matched);this.el.now.classList.toggle('is-miss',!!f.hint);
  this.el.now.hidden=done;
  // Note, count, summary.
  this.el.note.hidden=!f.note;if(f.note)this.text('note',this.el.note,f.note);
  this.el.count.hidden=!counting;if(counting)this.text('count',this.el.count,String(f.countdown));
  this.el.summary.hidden=!done;
  if(done){
   const total=f.results.reduce((a,r)=>a+r.seconds,0),done_=f.results.filter(r=>!r.skipped),avg=done_.length?Math.round(done_.reduce((a,r)=>a+r.score,0)/done_.length):0;
   this.set('summary',this.el.summary,`<h2>${esc(f.lessons.find(l=>l.id===f.lessonId)?.title??'')}</h2><p class="fo-total"><b>${total.toFixed(1)} s</b> total · <b>${avg}%</b> average match · ${done_.length} of ${n} steps</p><table><thead><tr><th>Step</th><th>Match</th><th>Time</th></tr></thead><tbody>${f.steps.map((s,i)=>{const r=f.results[i];return `<tr><td>${esc(s)}</td><td>${r?r.skipped?'skipped':`<span class="fo-bar"><em style="width:${r.score}%"></em></span>${r.score}%`:''}</td><td>${r?`${r.seconds.toFixed(1)} s`:''}</td></tr>`;}).join('')}</tbody></table><div class="fo-actions"><button data-act="again">Again</button><button data-act="next">Next lesson</button></div>`);
  }
  // Corner.
  const recBtn=$('record');this.text('rec',recBtn,counting?'Cancel':recording?'Stop':'Record');
  $('undo').hidden=!f.canUndo;$<HTMLButtonElement>('skip').disabled=f.mode!=='follow'||!f.waiting;$<HTMLButtonElement>('repeat').disabled=f.mode==='countdown'||recording;
  $('export').textContent=f.hasMine?'Export Your move':'Export lesson';
  // Hand labels.
  const top=(links:Link[],at:(p:V3)=>{x:number;y:number})=>{let best={x:0,y:Infinity};for(const l of links)for(const q of [l.origin,tipOf(l)]){const s=at(q);if(s.y<best.y)best=s;}return {x:best.x,y:best.y-18};};
  const teacherAt=(p:V3)=>this.view.screenOf(p,true),youAt=(p:V3)=>this.view.youScreen(p);
  const t=top(forward(scene.user,true),teacherAt),y=top(forward(scene.free,true),youAt);t.x=teacherAt([0,9,0]).x;y.x=youAt([0,9,0]).x;
  const tt=this.el.labels.querySelector<HTMLElement>('.fo-tag-teacher')!,yt=this.el.labels.querySelector<HTMLElement>('.fo-tag-you')!;
  tt.style.transform=`translate(${t.x}px,${t.y}px)`;yt.style.transform=`translate(${y.x}px,${y.y}px)`;
  this.text('yt',yt,f.hand?`You · ${f.side==='left'?'left hand':f.side==='right'?'right hand':'hand'}`:'You · waiting');
  this.text('tt',tt,recording||counting?'Your hand':f.mirrored?'Teacher · mirrored':'Teacher');
 }
}
