import type {TitrationEngine} from './engine';
import type {BenchView} from './view';
import {HINT_COST,calcSteps,type CalcStep} from './bench';
import {CONCORDANT,TITRE_UNCERTAINTY,fmt,indicatorNames,percentError,quizPoints} from './model';
import {hints,questions,theory} from './content';
import {steps} from './script';
import {clock,reportHtml} from './report';
import {drawLens} from './lens';
import {matchKey} from '../mirror/a11y';

const typing='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
const calcText:Record<CalcStep,{label:string;unit:string}>={
 nBase:{label:'Moles of sodium hydroxide',unit:'mol'},
 nAcid:{label:'Moles of hydrochloric acid',unit:'mol'},
 conc:{label:'Concentration of the acid',unit:'mol/dm3'},
};
const hintKey:Record<string,string>={rinse:'rinse',fill:'fill',bubble:'bubble',pipette:'pipette',indicator:'indicator',rough:'rough',accurate:'accurate',calc:'calculate'};
const LENS=168;

/** The guided overlay on the bench: one task card, one guide bubble, a progress strip, and a Notebook drawer for everything else. */
export function mountGuide(root:HTMLElement,engine:TitrationEngine,view:()=>BenchView|null,runAction:(id:string)=>boolean,keyed:{id:string;key?:string}[]){
 const stage=root.querySelector<HTMLElement>('#titration-stage')!,viewport=stage.querySelector<HTMLElement>('#titration-viewport')!;
 const lab=()=>engine.lab;
 const host=document.createElement('div');host.className='ti-overlay';
 host.innerHTML=`
<ol class="ti-dots" id="titration-progress" aria-label="Progress">${steps.map((s,i)=>`<li data-step="${i}"${s.checkpoint?` data-checkpoint="${s.checkpoint}"`:''}><span class="ti-sr"></span></li>`).join('')}</ol>
<section class="ti-task" id="titration-task" aria-label="Current task">
 <div class="ti-head"><p class="ti-step" id="titration-step"></p><button type="button" class="ti-skip" id="titration-skip">Skip this step</button></div>
 <p class="ti-how"><i aria-hidden="true" id="titration-glyph"></i><span id="titration-how"></span></p>
 <p class="ti-alt" id="titration-alt"></p>
 <div class="ti-body" id="titration-body"></div>
 <div class="ti-foot"><button type="button" class="ti-primary" id="titration-primary" hidden></button></div>
</section>
<div class="ti-guide" id="titration-guide"><span class="ti-pip" aria-hidden="true">Pip</span><p id="titration-line"></p><button type="button" id="titration-next">Next</button></div>
<div class="ti-acks" id="titration-acks" aria-hidden="true"></div>
<aside class="ti-drawer mirror-drawer" id="titration-drawer" aria-label="Notebook" hidden>
 <div class="ti-drawer-head"><h2>Notebook</h2><button type="button" id="titration-drawer-close">Close</button></div>
 <section aria-labelledby="ti-h-readings"><h3 id="ti-h-readings">Readings</h3><div id="titration-results"></div></section>
 <section aria-labelledby="ti-h-hint"><h3 id="ti-h-hint">Hint</h3><button type="button" id="titration-hint">Show a hint for this step</button><span class="ti-note"> Each hint costs ${HINT_COST} points.</span><ul class="ti-hints" id="titration-hints"></ul></section>
 <section aria-labelledby="ti-h-theory"><h3 id="ti-h-theory">Theory</h3><ul class="ti-theory">${theory.map(t=>`<li>${t}</li>`).join('')}</ul></section>
 <section aria-labelledby="ti-h-report"><h3 id="ti-h-report">Report</h3><p class="ti-note" id="titration-report-note">Finish the calculation to see your report.</p><div id="titration-report"></div>
  <div class="ti-row"><button type="button" id="titration-download" disabled>Download report</button><button type="button" id="titration-print" disabled>Print or save as PDF</button><button type="button" id="titration-restart">New session</button></div></section>
</aside>`;
 viewport.after(host);
 const live=document.createElement('p');live.id='titration-live';live.className='ti-sr';live.setAttribute('role','status');live.setAttribute('aria-live','polite');stage.append(live);
 const $=<T extends HTMLElement=HTMLElement>(id:string)=>host.querySelector<T>(`#titration-${id}`)!;
 const tools=stage.querySelector('.mirror-tools')!,notebook=document.createElement('button');notebook.id='titration-notebook';notebook.type='button';notebook.textContent='Notebook';notebook.setAttribute('aria-expanded','false');notebook.setAttribute('aria-controls','titration-drawer');tools.prepend(notebook);
 const drawer=$('drawer');

 // ---- Announcements: only changes, at most one every 700 ms.
 let pending='',lastSaid='',lastAt=0;
 const announce=(text:string)=>{if(text&&text!==lastSaid)pending=text;};
 const flush=(now:number)=>{if(pending&&now-lastAt>700){live.textContent=pending;lastSaid=pending;pending='';lastAt=now;}};

 // ---- Drawer.
 let shownHints:{step:string;text:string}[]=[];let reportOpened=false;
 const setDrawer=(open:boolean)=>{drawer.hidden=!open;stage.classList.toggle('has-notebook',open);notebook.setAttribute('aria-expanded',String(open));if(open){render(true);$('drawer-close').focus();}else if(document.activeElement&&drawer.contains(document.activeElement))notebook.focus();};
 notebook.onclick=()=>setDrawer(drawer.hidden);$('drawer-close').onclick=()=>setDrawer(false);
 drawer.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();setDrawer(false);}});
 engine.ui=cmd=>{if(cmd==='notebook')setDrawer(drawer.hidden);else hint();};
 function hint(){
  const l=lab(),key=hintKey[l.id],list=key?hints[key]:undefined;
  if(!list){announce('No hint for this step.');return;}
  if(!shownHints.some(h=>h.step===l.id)){l.bench.useHint();shownHints.push({step:l.id,text:list[0]});}
  announce(`Hint: ${list[0]}`);l.say(list[0]);setDrawer(true);render(true);
 }
 $('hint').onclick=hint;
 $('skip').onclick=()=>{lab().skip();engine.cue('step');render(true);};
 $('next').onclick=()=>{lab().advanceLine();render(true);};
 $('primary').onclick=()=>{primary();};
 $('restart').onclick=()=>{engine.restart();shownHints=[];reportOpened=false;lastBody='';setDrawer(false);announce('New session. A new unknown acid is in the bottle.');render(true);};
 const quizLines=()=>questions.filter(q=>lab().bench.quiz[q.id]).map(q=>{const s=lab().bench.quiz[q.id];return {text:q.text,attempts:s.attempts,correct:s.correct,points:s.correct?quizPoints(s.attempts):0};});
 $('download').onclick=()=>{
  const blob=new Blob([reportHtml(lab().bench.report(),quizLines())],{type:'text/html'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='titration-report.html';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);announce('Report downloaded.');
 };
 $('print').onclick=()=>{
  const frame=document.createElement('iframe');frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(frame);const doc=frame.contentDocument!;doc.open();doc.write(reportHtml(lab().bench.report(),quizLines()));doc.close();
  setTimeout(()=>{frame.contentWindow?.focus();frame.contentWindow?.print();setTimeout(()=>frame.remove(),1500);},150);
 };

 // ---- The card's body changes with the moment: a question, a reading, a sum, or nothing.
 let lastBody='';
 function primary(){
  const l=lab();
  if(l.quiz){if(l.quiz.right)l.closeQuiz();}
  else if(l.readingPhase)engine.confirmReading();
  else if(l.phase==='run')l.endPoint();
  else if(calcSteps.includes(l.phase as CalcStep))checkCalc();
  render(true);
 }
 function checkCalc(){
  const l=lab(),inp=host.querySelector<HTMLInputElement>('#titration-calc-input');if(!inp)return;
  const raw=inp.value.trim().replace(',','.').replace(/\s*[x×]\s*10\^?/i,'e'),value=Number(raw);
  if(!raw||!Number.isFinite(value)){l.say('Enter a number, for example 0.00245 or 2.45e-3.');return;}
  const res=l.submitCalc(l.phase as CalcStep,value);engine.cue(res.ok?'done':'alert');
  lastBody='';
 }
 function renderBody(force:boolean){
  const l=lab(),body=$('body'),primaryBtn=$<HTMLButtonElement>('primary'),q=l.quiz;
  const sig=q?`q${q.q.id}${q.wrong.join()}${q.right}`:l.readingPhase?`r${l.phase}${l.id}${l.entry}`:calcSteps.includes(l.phase as CalcStep)?`c${l.phase}`:`p${l.phase}${l.id}${l.finished}`;
  primaryBtn.hidden=true;
  if(sig===lastBody&&!force){return;}
  const keepFocus=body.contains(document.activeElement)?(document.activeElement as HTMLElement).id:'';
  lastBody=sig;
  if(q){
   body.innerHTML=`<fieldset class="ti-q"><legend>${esc(q.q.text)}</legend>${q.q.options.map((o,i)=>`<button type="button" class="ti-opt" data-o="${i}" ${q.right||q.wrong.includes(i)?'disabled':''} data-state="${q.right&&i===q.q.answer?'right':q.wrong.includes(i)?'wrong':''}">${esc(o)}</button>`).join('')}</fieldset><p class="ti-feedback" role="status">${esc(q.feedback)}</p>`;
   body.querySelectorAll<HTMLButtonElement>('.ti-opt').forEach(b=>b.onclick=()=>{const pts=l.answer(Number(b.dataset.o));engine.cue(l.quiz?.right?'done':'alert');announce(l.line);void pts;render(true);});
  }else if(l.readingPhase){
   body.innerHTML=`<div class="ti-read"><canvas id="titration-lens" width="${LENS}" height="${LENS}" role="img" aria-label="Magnified burette scale. Read the bottom of the curved surface against the marks."></canvas>
<div class="ti-stepper" role="group" aria-label="Burette reading"><button type="button" data-d="-1" aria-label="Down 1">-1</button><button type="button" data-d="-.05" aria-label="Down 0.05">-0.05</button><input id="titration-reading" type="text" inputmode="decimal" aria-label="Burette reading in cm3" value="${l.entry.toFixed(2)}"><button type="button" data-d=".05" aria-label="Up 0.05">+0.05</button><button type="button" data-d="1" aria-label="Up 1">+1</button></div></div>`;
   body.querySelectorAll<HTMLButtonElement>('[data-d]').forEach(b=>b.onclick=()=>{l.nudge(Number(b.dataset.d));engine.cue('step');render(true);});
   const inp=body.querySelector<HTMLInputElement>('#titration-reading')!;
   inp.addEventListener('change',()=>{const v=Number(inp.value.replace(',','.'));if(Number.isFinite(v))l.setEntry(v);});
   inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const v=Number(inp.value.replace(',','.'));if(Number.isFinite(v))l.setEntry(v);engine.confirmReading();render(true);}});
  }else if(calcSteps.includes(l.phase as CalcStep)){
   const c=calcText[l.phase as CalcStep];
   body.innerHTML=`<label class="ti-calc" for="titration-calc-input">${c.label} (${c.unit})</label><input id="titration-calc-input" type="text" inputmode="decimal" autocomplete="off">`;
   const inp=body.querySelector<HTMLInputElement>('#titration-calc-input')!;
   inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();checkCalc();render(true);}});
  }else body.innerHTML='';
  if(keepFocus){const again=body.querySelector<HTMLElement>(`#${keepFocus}`)??body.querySelector<HTMLElement>('input,button:not(:disabled)');again?.focus();}
  if(q)primaryBtn.hidden=!q.right;
 }
 function renderPrimary(){
  const l=lab(),btn=$<HTMLButtonElement>('primary');
  const label=l.quiz?(l.quiz.right?'Continue':''):l.readingPhase?'Confirm reading':l.phase==='run'?'End point reached':calcSteps.includes(l.phase as CalcStep)?'Check':'';
  btn.hidden=!label;if(label&&btn.textContent!==label)btn.textContent=label;
 }

 // ---- Notebook content.
 function renderNotebook(){
  if(drawer.hidden)return;
  const l=lab(),b=l.bench,runs=b.runs,con=b.concordance,acc=b.accurate;
  const results=$('results'),sig='R'+JSON.stringify(runs.map(r=>[r.initial,r.final]));
  if(results.dataset.sig!==sig){
   results.dataset.sig=sig;
   results.innerHTML=!runs.length?'<p class="ti-note">Your titres will appear here. The first run is the rough titration.</p>':`<table class="ti-table"><caption class="ti-sr">Titration results</caption><thead><tr><th scope="col">Run</th><th scope="col">Initial</th><th scope="col">Final</th><th scope="col">Titre</th><th scope="col">Note</th></tr></thead><tbody>${runs.map(r=>{const ai=acc.indexOf(r),used=r.kind==='accurate'&&con.indices.includes(ai);return `<tr data-kind="${r.kind}"><th scope="row">${r.kind==='rough'?'Rough':'Accurate '+(ai+1)}</th><td>${fmt(r.initial)}</td><td>${fmt(r.final)}</td><td>${fmt(r.titre)}</td><td>${r.kind==='rough'?'not used in the mean':used?'used in the mean':''}</td></tr>`;}).join('')}</tbody></table>
<p class="ti-note">Readings in cm3. Each titre is uncertain by about ±${fmt(TITRE_UNCERTAINTY)} cm3.</p>
<p class="ti-conc" id="titration-concordance" data-ok="${con.mean!==null}">${con.mean!==null?`Titres ${con.indices.map(i=>fmt(acc[i].titre)).join(' and ')} agree within ${fmt(CONCORDANT)} cm3. Mean ${fmt(con.mean)} ± ${fmt(TITRE_UNCERTAINTY)} cm3.`:acc.length?`No two accurate titres agree within ${fmt(CONCORDANT)} cm3 yet.`:'Run an accurate titration next.'}</p>`;
  }
  $('hints').innerHTML=shownHints.map(h=>`<li>${esc(h.text)}</li>`).join('');
  const ready=b.calcDone;
  ($('download') as HTMLButtonElement).disabled=!ready;($('print') as HTMLButtonElement).disabled=!ready;
  $('report-note').textContent=ready?'Your report is ready.':'Finish the calculation to see your report.';
  const rep=$('report');
  if(!ready){rep.innerHTML='';return;}
  const r=b.report(),found=b.found!,err=percentError(found,b.acid),causes=r.issues.filter(i=>i.affects);
  rep.innerHTML=`<p class="ti-compare" id="titration-compare">Your result ${fmt(found,4)} mol/dm3. True value ${fmt(b.acid,4)} mol/dm3. Error <b>${err>=0?'+':'-'}${Math.abs(err).toFixed(1)}%</b>.</p>${causes.length?`<p>Likely causes from your technique:</p><ul>${causes.map(i=>`<li>${esc(i.text)}</li>`).join('')}</ul>`:''}
<p class="ti-score" id="titration-score">${r.total}<small> / 100</small></p><table class="ti-table"><tbody><tr><th scope="row">Technique</th><td>${r.technique} / 30</td></tr><tr><th scope="row">Burette readings</th><td>${r.readings} / 10</td></tr><tr><th scope="row">Accuracy</th><td>${r.accuracy} / 40</td></tr><tr><th scope="row">Checkpoint questions</th><td>${r.quiz} / 20</td></tr><tr><th scope="row">Hints used</th><td>-${r.hints}</td></tr></tbody></table>${r.issues.length?`<ul>${r.issues.map(i=>`<li>${esc(i.text)} <em>(-${i.cost})</em></li>`).join('')}</ul>`:'<p>No technique errors.</p>'}<p class="ti-note">Time ${clock(r.elapsed)}.</p>`;
 }

 // ---- Every frame.
 const canvas=()=>host.querySelector<HTMLCanvasElement>('#titration-lens');
 const ratio=Math.min(2,window.devicePixelRatio||1);
 let lastRev=-1,lastSig='',lastKey='',lastLine='',lastRefresh=0,lastInset=0,lastDelivered='';
 function render(force=false){
  const l=lab(),b=l.bench;
  const sig=`${l.step}|${l.phase}|${l.rev}|${!!l.quiz}|${l.finished}|${l.entry}`;
  const changed=sig!==lastSig||l.rev!==lastRev;
  if(changed||force){
   lastSig=sig;lastRev=l.rev;
   const t=l.task;
   $('step').innerHTML=l.finished?'<b>All ten steps done</b>':`Step ${l.step+1} of ${steps.length} · <b>${esc(l.quiz?'Quick check':l.title)}</b>`;
   $('glyph').textContent=l.quiz?'?':l.finished?'📓':t.glyph;
   $('how').textContent=l.quiz?'Pick the best answer. A wrong pick explains why and you try again.':l.finished?'Open the Notebook for your readings, hints and report.':t.how;
   $('alt').textContent=l.quiz?'Mouse or keys: click an answer, Tab between them.':l.finished?'':`Mouse or keys: ${t.alt}`;
   host.querySelectorAll<HTMLElement>('.ti-dots li').forEach((li,i)=>{
    const st:string=l.done[i]??(i===l.step&&!l.finished?'current':'todo');
    li.dataset.state=st;li.setAttribute('aria-label',`${i+1}, ${steps[i].title}${steps[i].checkpoint?`, checkpoint ${steps[i].checkpoint}`:''}: ${st}`);
    if(st==='current')li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');
    li.firstElementChild!.textContent=`${steps[i].title}: ${st}`;
   });
   $<HTMLButtonElement>('skip').textContent=l.quiz?'Skip this question':'Skip this step';$('skip').hidden=l.finished;
   $('line').textContent=l.line;$('next').hidden=!l.more;$('guide').hidden=!l.line;
   if(l.line!==lastLine){announce(l.line);lastLine=l.line;}
   renderBody(force);renderPrimary();
   const key=`${l.step}${l.phase}${!!l.quiz}${l.finished}`;
   if(key!==lastKey){lastKey=key;announce(l.finished?'All steps done.':l.quiz?'Quick check. Pick the best answer.':`Step ${l.step+1} of ${steps.length}: ${l.title}. ${t.how}`);}
   renderNotebook();
   if(l.bench.calcDone&&l.finished&&!reportOpened){reportOpened=true;setDrawer(true);}
  }
  void b;
 }
 render(true);

 // ---- Lens, acks and the running commentary.
 function frame(now:number){
  render();
  const l=lab(),b=l.bench,cv=canvas();
  if(cv){
   if(cv.width!==LENS*ratio){cv.width=LENS*ratio;cv.height=LENS*ratio;}
   const ctx=cv.getContext('2d');if(ctx){ctx.setTransform(ratio,0,0,ratio,0,0);drawLens(ctx,LENS,LENS,b.filled?b.reading:null,false);}
  }
  if(now-lastRefresh>250){lastRefresh=now;renderNotebook();
   const f=b.flask;
   if(f&&f.initial!==null&&!f.done&&l.phase==='run'){
    const key=`${(Math.round(f.delivered*20)/20).toFixed(2)}|${b.flaskColour}`;
    if(key!==lastDelivered){lastDelivered=key;announce(`Burette ${fmt(f.delivered)} cm3 delivered, flask ${b.flaskColour}, pH ${b.bulkPH.toFixed(1)}`);}
   }
  }
  const v=view(),chips=$('acks');
  const acks=engine.activeAcks;
  if(v){
   const have=new Set([...chips.children].map(c=>(c as HTMLElement).dataset.id));
   for(const a of acks)if(!have.has(String(a.id))){const c=document.createElement('span');c.dataset.id=String(a.id);c.className='ti-ack';c.dataset.miss=String(a.miss);c.textContent=a.text;chips.append(c);announce(a.text);}
   for(const c of [...chips.children] as HTMLElement[]){
    const a=acks.find(x=>String(x.id)===c.dataset.id);
    if(!a){c.remove();continue;}
    const p=v.screenOf({x:a.x,y:a.y,z:.7});c.style.left=`${p.x}px`;c.style.top=`${p.y}px`;
   }
  }
  if(v&&now-lastInset>150){
   lastInset=now;
   const s=stage.getBoundingClientRect(),card=$('task').getBoundingClientRect(),gb=stage.querySelector('.mirror-gestures')!.getBoundingClientRect(),gd=$('guide').hidden?gb:$('guide').getBoundingClientRect();
   v.setInsets(card.bottom-s.top+6,s.bottom-Math.min(gb.top,gd.top)+6);
  }
  flush(now);
  requestAnimationFrame(frame);
 }
 requestAnimationFrame(frame);

 // ---- Keys that work from anywhere outside a form field.
 document.addEventListener('keydown',e=>{
  if(e.altKey||e.ctrlKey||e.metaKey||e.defaultPrevented||document.querySelector('dialog[open]'))return;
  const t=e.target instanceof Element?e.target:null;
  if(t?.closest(typing)||t?.closest('button,a,summary,[role=button]')&&(e.key==='Enter'||e.key===' '))return;
  if(e.key==='Escape'&&!drawer.hidden){setDrawer(false);return;}
  if(e.key==='Enter'){e.preventDefault();runAction('run');return;}
  const hit=keyed.find(a=>a.key&&matchKey(e,a.key));
  if(hit&&(!e.repeat||/arrow|\[|\]|^f$/.test(hit.key!))){e.preventDefault();runAction(hit.id);}
 });
 return {render:()=>render(true),setDrawer,get live(){return live.textContent;},get drawerOpen(){return !drawer.hidden;}};
}
