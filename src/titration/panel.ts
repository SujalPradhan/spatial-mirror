import type {TitrationEngine} from './engine';
import type {BenchView} from './view';
import type {TitrationAudio} from './audio';
import {HINT_COST,calcSteps,type CalcStep} from './bench';
import {BASE_CONC,CONCORDANT,TITRE_UNCERTAINTY,dripRate,fmt,indicatorIds,indicatorNames,percentError,quizPoints,roundReading,type IndicatorId} from './model';
import {hints,keyHelp,objectives,questions,story,theory} from './content';
import {clock,reportHtml} from './report';
import {drawLens} from './lens';

const typing='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
const calcText:Record<CalcStep,{label:string;unit:string;hint:string}>={
 nBase:{label:'Moles of sodium hydroxide',unit:'mol',hint:'mean titre in dm3 times 0.100'},
 nAcid:{label:'Moles of hydrochloric acid',unit:'mol',hint:'reaction ratio 1:1'},
 conc:{label:'Concentration of the acid',unit:'mol/dm3',hint:'moles divided by 0.0250 dm3'},
};

/** The practical around the 3D bench: steps, controls, readings, results, sums, questions, hints and the report. Every action has a button and a key. */
export function mountPanel(root:HTMLElement,engine:TitrationEngine,view:()=>BenchView|null,audio:()=>TitrationAudio|null){
 const main=root.querySelector('main')!,stage=main.querySelector<HTMLElement>('.mirror-stage')!;
 const sheet=document.createElement('aside');sheet.id='titration-sheet';sheet.className='ti-sheet';sheet.setAttribute('aria-label','The practical');
 sheet.innerHTML=`
<div class="ti-next" id="titration-next"><b>Next</b><span id="titration-next-text"></span></div>
<details class="ti-card" open id="titration-brief"><summary>The practical</summary>
 <p class="ti-story">${story}</p>
 <ul class="ti-objectives" id="titration-objectives" aria-label="Objectives">${objectives.map(o=>`<li data-id="${o.id}"><i aria-hidden="true"></i>${o.text}</li>`).join('')}</ul>
 <div class="ti-row"><span class="ti-time">Time <output id="titration-time">0:00</output></span><label class="ti-check"><input type="checkbox" id="titration-aids"> Show reading aids</label><button id="titration-restart" type="button">New session</button></div>
</details>
<details class="ti-card" open><summary>Procedure</summary><ol class="ti-steps" id="titration-steps"></ol></details>
<details class="ti-card" open id="titration-bench"><summary>Bench</summary>
 <div class="ti-grid" role="group" aria-label="Preparation">
  <button id="titration-rinse" type="button">Rinse burette <kbd>R</kbd></button>
  <button id="titration-fill" type="button">Fill burette <kbd>F</kbd></button>
  <button id="titration-bubble" type="button">Clear tip <kbd>B</kbd></button>
  <button id="titration-pipette" type="button">Pipette 25.0 cm3 acid <kbd>P</kbd></button>
  <label class="ti-select">Indicator <select id="titration-indicator">${indicatorIds.map(i=>`<option value="${i}">${indicatorNames[i]}</option>`).join('')}</select></label>
  <button id="titration-add-indicator" type="button">Add indicator <kbd>A</kbd></button>
 </div>
 <div class="ti-tap" role="group" aria-label="Stopcock">
  <label for="titration-tap">Stopcock</label>
  <input id="titration-tap" type="range" min="0" max="100" step="1" value="0" aria-describedby="titration-tap-text">
  <output id="titration-tap-text">closed</output>
  <div class="ti-grid ti-tight">
   <button id="titration-drop" type="button">Add 1 drop <kbd>D</kbd></button>
   <button id="titration-swirl" type="button">Swirl <kbd>S</kbd></button>
   <button id="titration-close" type="button">Close tap <kbd>Space</kbd></button>
   <button id="titration-less" type="button" aria-label="Turn the stopcock down">Tap down <kbd>[</kbd></button>
   <button id="titration-more" type="button" aria-label="Turn the stopcock up">Tap up <kbd>]</kbd></button>
  </div>
  <p class="ti-note" id="titration-blocked"></p>
 </div>
 <div class="ti-read" role="group" aria-label="Burette reading">
  <canvas id="titration-lens" width="260" height="260" role="img" aria-label="Magnified burette scale. Read the bottom of the curved surface against the marks."></canvas>
  <p class="ti-sr" id="titration-lens-text"></p>
  <div class="ti-read-form">
   <label for="titration-reading">Burette reading, cm3, to the nearest 0.05</label>
   <input id="titration-reading" type="number" min="0" max="50" step="0.05" inputmode="decimal">
   <div class="ti-grid ti-tight"><button id="titration-initial" type="button">Record initial</button><button id="titration-final" type="button">Record final</button></div>
   <button id="titration-zoom" type="button" aria-pressed="false">Zoom 3D to burette <kbd>Z</kbd></button>
  </div>
 </div>
 <p class="ti-message" id="titration-message"></p>
 <p class="ti-note">${keyHelp}</p>
</details>
<details class="ti-card" open><summary>Results</summary><div id="titration-results"></div></details>
<details class="ti-card" open><summary>Calculation</summary><div id="titration-calc"></div></details>
<details class="ti-card" open><summary>Checkpoint questions</summary><div id="titration-quiz"></div></details>
<details class="ti-card"><summary>Theory and hints</summary>
 <ul class="ti-theory">${theory.map(t=>`<li>${t}</li>`).join('')}</ul>
 <button id="titration-hint" type="button">Show a hint for this step <kbd>H</kbd></button><span class="ti-note"> Each hint costs ${HINT_COST} points.</span>
 <ul class="ti-hints" id="titration-hints"></ul>
</details>
<details class="ti-card" id="titration-report-card"><summary>Report</summary>
 <p class="ti-note" id="titration-report-note">Finish the calculation to see your report.</p>
 <div id="titration-report"></div>
 <div class="ti-grid ti-tight"><button id="titration-report-show" type="button" disabled>Show report</button><button id="titration-download" type="button" disabled>Download report</button><button id="titration-print" type="button" disabled>Print or save as PDF</button></div>
</details>`;
 main.append(sheet);
 const live=document.createElement('p');live.id='titration-live';live.className='ti-sr';live.setAttribute('role','status');live.setAttribute('aria-live','polite');main.append(live);
 const $=<T extends HTMLElement=HTMLElement>(id:string)=>sheet.querySelector<T>(`#titration-${id}`)!;
 const bench=()=>engine.bench;
 const calcRaw:Partial<Record<CalcStep,string>>={};
 let lastAnnounce=0,lastKey='',shownHints:{step:string;text:string}[]=[],reportShown=false,reportOpened=false,signature='';

 // ---- Messages.
 const say=(text:string,sound:'step'|'alert'|'done'='step')=>{$('message').textContent=text;announce(text);engine.cue(sound);};
 function announce(text:string){live.textContent=live.textContent===text?text+' ':text;lastAnnounce=performance.now();}
 const run=(fn:()=>string)=>{void audio()?.start();const before=bench().procedure().map(s=>s.state).join();const msg=fn();const after=bench().procedure().map(s=>s.state).join();say(msg,/Right|recorded|rinsed|filled|Acid in|Indicator added|cleared|Air run|topped/i.test(msg)&&before!==after?'done':/already|Finish|first|must|Enter|Do the|not/i.test(msg)?'alert':'step');refresh();};

 // ---- Actions: each has a button and a key.
 const act={
  rinse:()=>run(()=>bench().rinse()),
  fill:()=>run(()=>bench().fill()),
  bubble:()=>run(()=>bench().clearBubble()),
  pipette:()=>run(()=>bench().pipette()),
  indicator:()=>run(()=>bench().addIndicator($<HTMLSelectElement>('indicator').value as IndicatorId)),
  drop:()=>{void audio()?.start();const b=bench();if(b.dropOne())engine.cue('drip');else say(b.blocked??'Cannot add a drop now.','alert');refresh();},
  swirl:()=>{void audio()?.start();bench().swirlPulse();},
  close:()=>{engine.setTap(0);announce('Tap closed.');},
  tap:(delta:number)=>{engine.setTap(bench().tap+delta);},
  zoom:()=>{engine.focus=!engine.focus;$('zoom').setAttribute('aria-pressed',String(engine.focus));},
  hint:()=>{
   const step=bench().procedure().find(s=>s.state==='current')?.id??'calculate',list=hints[step]??[],text=list[0];
   if(!text)return;
   if(!shownHints.some(h=>h.step===step)){bench().useHint();shownHints.push({step,text});}
   renderHints();announce(`Hint: ${text}`);refresh();
  },
  initial:()=>{const v=readingValue();if(v===null)return say('Enter the burette reading first.','alert');run(()=>bench().recordInitial(v));$<HTMLInputElement>('reading').value='';},
  final:()=>{const v=readingValue();if(v===null)return say('Enter the burette reading first.','alert');const msg=bench().recordFinal(v);say(msg,/titre recorded/.test(msg)?'done':'alert');if(/titre recorded/.test(msg))$<HTMLInputElement>('reading').value='';refresh();},
 };
 function readingValue(){const t=$<HTMLInputElement>('reading').value.trim();if(!t)return null;const v=Number(t.replace(',','.'));return Number.isFinite(v)?roundReading(v):null;}
 $('rinse').onclick=act.rinse;$('fill').onclick=act.fill;$('bubble').onclick=act.bubble;$('pipette').onclick=act.pipette;$('add-indicator').onclick=act.indicator;
 $('drop').onclick=act.drop;$('swirl').onclick=act.swirl;$('close').onclick=act.close;$('less').onclick=()=>act.tap(-.05);$('more').onclick=()=>act.tap(.05);
 $('zoom').onclick=act.zoom;$('hint').onclick=act.hint;$('initial').onclick=act.initial;$('final').onclick=act.final;
 $<HTMLInputElement>('reading').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();(bench().flask?.initial===null?act.initial:act.final)();}});
 const slider=$<HTMLInputElement>('tap');let sliding=false;
 slider.addEventListener('input',()=>engine.setTap(Number(slider.value)/100));
 slider.addEventListener('pointerdown',()=>{sliding=true;});window.addEventListener('pointerup',()=>{sliding=false;});
 $<HTMLInputElement>('aids').addEventListener('change',()=>{drawLensNow();});
 $('restart').onclick=()=>{engine.restart();engine.setTap(0);shownHints=[];reportShown=false;reportOpened=false;for(const k of calcSteps)delete calcRaw[k];signature='';$('message').textContent='';$<HTMLInputElement>('reading').value='';renderHints();refresh();announce('New session. A new unknown acid is in the bottle.');};

 const keys:Record<string,()=>void>={r:act.rinse,f:act.fill,b:act.bubble,p:act.pipette,a:act.indicator,d:act.drop,s:act.swirl,z:act.zoom,h:act.hint,'[':()=>act.tap(-.05),']':()=>act.tap(.05)};
 document.addEventListener('keydown',e=>{
  if(e.altKey||e.ctrlKey||e.metaKey||e.defaultPrevented||document.querySelector('dialog[open]'))return;
  const t=e.target instanceof Element?e.target:null;
  if(t?.closest(typing)&&!(t instanceof HTMLInputElement&&t.type==='range'))return;
  if(e.key===' '&&!t?.closest('button,a,summary,[role=button]')){e.preventDefault();act.close();return;}
  const k=keys[e.key.toLowerCase()];if(!k||e.repeat&&e.key!=='['&&e.key!==']')return;
  if(t?.closest('button')&&e.key===' ')return;
  e.preventDefault();k();
 });

 // ---- Rendering.
 const setText=(el:Node,text:string)=>{if(el.textContent!==text)el.textContent=text;};
 const setDisabled=(el:HTMLElement,off:boolean)=>{(el as HTMLButtonElement).disabled=off;};
 function renderHints(){$('hints').innerHTML=shownHints.map(h=>`<li>${esc(h.text)}</li>`).join('');}
 function stepText(b:ReturnType<typeof bench>){
  const f=b.flask,cur=b.procedure().find(s=>s.state==='current');
  if(b.calcDone)return 'Answer any questions left, then open your report.';
  if(f&&f.indicator&&!f.done&&f.initial===null)return 'Read the burette and record the initial reading.';
  if(f&&f.initial!==null&&!f.done)return b.runs.length?'Add titrant, slowing to drops near the colour change, swirling. Then record the final reading.':'Run titrant quickly, swirling, and stop at the first lasting colour change. Then record the final reading.';
  if(b.runs.length&&!f?.indicator&&b.mean===null)return 'Set up another flask: pipette acid and add the indicator.';
  if(b.mean!==null)return 'Work through the calculation.';
  return cur?.label??'';
 }
 function refresh(){
  const b=bench(),f=b.flask,steps=b.procedure();
  setText($('next-text'),stepText(b));
  const list=$('steps');if(list.children.length!==steps.length)list.innerHTML=steps.map(s=>`<li data-id="${s.id}"><i aria-hidden="true"></i><span class="ti-sr"></span><span>${s.label}</span></li>`).join('');
  steps.forEach((s,i)=>{const li=list.children[i] as HTMLElement;if(li.dataset.state!==s.state){li.dataset.state=s.state;if(s.state==='current')li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');}const word=s.state==='done'?'Done: ':s.state==='current'?'Next: ':s.state==='skipped'?'Not done: ':'To do: ';setText(li.querySelector('.ti-sr')!,word);});
  const rough=!!b.rough;
  const done:Record<string,boolean>={prepare:b.filled&&(b.bubbleCleared||b.runs.length>0)&&(b.rinsed||b.runs.length>0),rough,accurate:b.mean!==null,calculate:b.calcDone,questions:questions.every(q=>b.quiz[q.id]?.correct),judge:b.calcDone};
  sheet.querySelectorAll<HTMLElement>('#titration-objectives li').forEach(li=>{const d=!!done[li.dataset.id!];if((li.dataset.done==='true')!==d)li.dataset.done=String(d);});
  setDisabled($('rinse'),b.filled||b.rinsed);
  const fillBtn=$('fill');setText(fillBtn.firstChild as Text,b.filled?'Top up burette ':'Fill burette ');setDisabled(fillBtn,b.filled&&(!!f&&!f.done||b.reading<3));
  setDisabled($('bubble'),!b.filled||!b.bubble);
  setDisabled($('pipette'),!!f&&!f.done);
  const needIndicator=!!f&&!f.done&&!f.indicator;setDisabled($('add-indicator'),!needIndicator);setDisabled($('indicator'),!needIndicator);
  if(f?.indicator&&b.indicator)$<HTMLSelectElement>('indicator').value=b.indicator;
  setDisabled($('initial'),!(f&&f.indicator&&!f.done&&f.initial===null));setDisabled($('final'),!(f&&f.initial!==null&&!f.done));
  setText($('blocked'),b.blocked??'');
  ($('drop') as HTMLButtonElement).disabled=!b.canFlow;
  const t=b.tap;setText($('tap-text'),t<=0?'closed':t<.2?`dripping, about ${dripRate(t).toFixed(1)} drops a second`:'stream');
  slider.setAttribute('aria-valuetext',$('tap-text').textContent!);
  setText($('time'),clock(b.elapsed));
  renderResults();renderCalc();renderQuiz();renderReport();
 }
 function renderResults(){
  const b=bench(),sig='R'+JSON.stringify(b.runs.map(r=>[r.initial,r.final]));
  const host=$('results');if(host.dataset.sig===sig)return;host.dataset.sig=sig;
  if(!b.runs.length){host.innerHTML='<p class="ti-note">Your titres will appear here. The first run is the rough titration.</p>';return;}
  const con=b.concordance,acc=b.accurate;
  host.innerHTML=`<table class="ti-table"><caption class="ti-sr">Titration results</caption><thead><tr><th scope="col">Run</th><th scope="col">Initial</th><th scope="col">Final</th><th scope="col">Titre</th><th scope="col">Note</th></tr></thead><tbody>${b.runs.map(r=>{const ai=acc.indexOf(r),used=r.kind==='accurate'&&con.indices.includes(ai);return `<tr data-kind="${r.kind}"><th scope="row">${r.kind==='rough'?'Rough':'Accurate '+(ai+1)}</th><td>${fmt(r.initial)}</td><td>${fmt(r.final)}</td><td>${fmt(r.titre)}</td><td>${r.kind==='rough'?'not used in the mean':used?'used in the mean':'not within 0.10 of another'}</td></tr>`;}).join('')}</tbody></table>
  <p class="ti-note">Readings in cm3. Each titre is uncertain by about ±${fmt(TITRE_UNCERTAINTY)} cm3: two readings, each good to ±0.05.</p>
  <p class="ti-conc" id="titration-concordance" data-ok="${con.mean!==null}">${con.mean!==null?`Titres ${con.indices.map(i=>fmt(acc[i].titre)).join(' and ')} agree within ${fmt(CONCORDANT)} cm3. Mean ${fmt(con.mean)} ± ${fmt(TITRE_UNCERTAINTY)} cm3.`:acc.length?`No two accurate titres agree within ${fmt(CONCORDANT)} cm3 yet. Run another.`:'Run an accurate titration next.'}</p>`;
 }
 function renderCalc(){
  const b=bench(),mean=b.mean,sig='C'+(mean===null?'x':mean.toFixed(3))+JSON.stringify(b.calc);
  const host=$('calc');if(host.dataset.sig===sig)return;host.dataset.sig=sig;
  if(mean===null){host.innerHTML='<p class="ti-note">Unlocks when two accurate titres agree within 0.10 cm3.</p>';return;}
  const rows=calcSteps.map((s,i)=>{const c=b.calc[s],prev=i===0||b.calc[calcSteps[i-1]].ok;return `<div class="ti-calc-row" data-step="${s}" data-ok="${c.ok}"><label for="titration-calc-${s}">${i+1}. ${calcText[s].label} (${calcText[s].unit})</label><input id="titration-calc-${s}" type="text" inputmode="decimal" autocomplete="off" ${prev&&!c.ok?'':'disabled'} value="${esc(calcRaw[s]??'')}" aria-describedby="titration-calc-${s}-fb"><button type="button" data-check="${s}" ${prev&&!c.ok?'':'disabled'}>Check</button><p class="ti-note">Use ${calcText[s].hint}. Mean titre ${fmt(mean)} cm3.</p><p class="ti-feedback" id="titration-calc-${s}-fb" role="status"></p></div>`;}).join('');
  let compare='';
  if(b.calcDone){const found=b.found!,err=percentError(found,b.acid),r=b.report(),causes=r.issues.filter(i=>i.affects);compare=`<div class="ti-compare" id="titration-compare"><b>Compare</b><p>Your result ${fmt(found,4)} mol/dm3. True value ${fmt(b.acid,4)} mol/dm3. Error <b>${err>=0?'+':'-'}${Math.abs(err).toFixed(1)}%</b>.</p>${causes.length?`<p>Likely causes from your technique:</p><ul>${causes.map(i=>`<li>${esc(i.text)}</li>`).join('')}</ul>`:'<p>Nothing in your technique moved the mean, so any small difference is the uncertainty of reading a burette.</p>'}${r.issues.some(i=>!i.affects)?'<p class="ti-note">Problems in the rough run are in your report but did not change the mean.</p>':''}</div>`;}
  host.innerHTML=rows+compare;
  host.querySelectorAll<HTMLButtonElement>('[data-check]').forEach(btn=>btn.onclick=()=>checkCalc(btn.dataset.check as CalcStep));
  host.querySelectorAll<HTMLInputElement>('input').forEach(inp=>inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();checkCalc(inp.id.replace('titration-calc-','') as CalcStep);}}));
 }
 function checkCalc(step:CalcStep){
  const inp=sheet.querySelector<HTMLInputElement>(`#titration-calc-${step}`)!,raw=inp.value.trim().replace(',','.').replace(/\s*[x×]\s*10\^?/i,'e');
  const value=Number(raw);calcRaw[step]=inp.value.trim();
  if(!raw||!Number.isFinite(value)){setFeedback(step,'Enter a number, for example 0.00245 or 2.45e-3.',false);return;}
  const res=bench().submitCalc(step,value);engine.cue(res.ok?'done':'alert');
  signature='';renderCalc();setFeedback(step,res.message,res.ok);announce(res.message);refresh();
 }
 function setFeedback(step:string,text:string,ok:boolean){const fb=sheet.querySelector<HTMLElement>(`#titration-calc-${step}-fb`);if(fb){fb.textContent=text;fb.dataset.ok=String(ok);}if(ok){const next=calcSteps[calcSteps.indexOf(step as CalcStep)+1];if(next)sheet.querySelector<HTMLInputElement>(`#titration-calc-${next}`)?.focus();}}
 function unlocked(need:string){const b=bench();return need==='indicator'?!!b.indicator:need==='rough'?!!b.rough:need==='accurate'?b.mean!==null:b.calcDone;}
 function renderQuiz(){
  const b=bench(),sig='Q'+questions.map(q=>`${unlocked(q.needs)}${b.quiz[q.id]?.attempts??0}${b.quiz[q.id]?.correct??''}`).join();
  const host=$('quiz');if(host.dataset.sig===sig)return;host.dataset.sig=sig;
  host.innerHTML=questions.map((q,qi)=>{
   if(!unlocked(q.needs))return `<p class="ti-note" data-locked="true">Question ${qi+1} unlocks later in the practical.</p>`;
   const st=b.quiz[q.id],right=!!st?.correct;
   return `<fieldset class="ti-q" data-q="${q.id}" data-correct="${right}"><legend>${qi+1}. ${q.text}</legend>${q.options.map((o,oi)=>`<button type="button" class="ti-opt" data-q="${q.id}" data-o="${oi}" ${right?'disabled':''} data-state="${right&&oi===q.answer?'right':''}">${o}</button>`).join('')}<p class="ti-feedback" role="status">${right?`Correct. ${esc(q.why)} ${quizPoints(st.attempts)} points.`:st?.attempts?'Not quite. Try again for fewer points.':''}</p></fieldset>`;
  }).join('');
  host.querySelectorAll<HTMLButtonElement>('.ti-opt').forEach(btn=>btn.onclick=()=>{
   const q=questions.find(x=>x.id===btn.dataset.q)!,oi=Number(btn.dataset.o),pts=bench().answerQuiz(q.id,oi===q.answer);
   engine.cue(oi===q.answer?'done':'alert');announce(oi===q.answer?`Correct. ${q.why} ${pts} points.`:'Not quite. Try again.');
   renderQuiz();host.querySelector<HTMLButtonElement>(`.ti-opt[data-q="${q.id}"][data-o="${oi}"]`)?.focus();
   if(oi!==q.answer)host.querySelector<HTMLButtonElement>(`.ti-opt[data-q="${q.id}"][data-o="${oi}"]`)?.setAttribute('data-state','wrong');
  });
 }
 const quizLines=()=>questions.filter(q=>bench().quiz[q.id]).map(q=>{const s=bench().quiz[q.id];return {text:q.text,attempts:s.attempts,correct:s.correct,points:s.correct?quizPoints(s.attempts):0};});
 function renderReport(){
  const b=bench(),ready=b.calcDone;
  ($('report-show') as HTMLButtonElement).disabled=!ready;($('download') as HTMLButtonElement).disabled=!ready;($('print') as HTMLButtonElement).disabled=!ready;
  if(ready&&!reportOpened){reportOpened=true;$('report-card').setAttribute('open','');}
  setText($('report-note'),ready?'Your report is ready.':'Finish the calculation to see your report.');
  const host=$('report');
  if(!ready||!reportShown){if(host.innerHTML&&!ready)host.innerHTML='';return;}
  const r=b.report(),sig=JSON.stringify([r.total,r.issues.length,r.quiz,r.hints,Math.floor(r.elapsed/10)]);
  if(host.dataset.sig===sig)return;host.dataset.sig=sig;
  host.innerHTML=`<p class="ti-score" id="titration-score">${r.total}<small> / 100</small></p><table class="ti-table"><tbody><tr><th scope="row">Technique</th><td>${r.technique} / 30</td></tr><tr><th scope="row">Burette readings</th><td>${r.readings} / 10</td></tr><tr><th scope="row">Accuracy</th><td>${r.accuracy} / 40${r.error!==null?` (${r.error>=0?'+':'-'}${Math.abs(r.error).toFixed(1)}%)`:''}</td></tr><tr><th scope="row">Questions</th><td>${r.quiz} / 20</td></tr><tr><th scope="row">Hints</th><td>-${r.hints}</td></tr><tr><th scope="row">Time</th><td>${clock(r.elapsed)}</td></tr></tbody></table>${r.issues.length?`<ul>${r.issues.map(i=>`<li>${esc(i.text)}</li>`).join('')}</ul>`:'<p>No technique errors.</p>'}`;
 }
 $('report-show').onclick=()=>{reportShown=true;renderReport();$('report-card').setAttribute('open','');sheet.querySelector<HTMLElement>('#titration-score')?.scrollIntoView({block:'nearest'});announce('Report shown.');};
 $('download').onclick=()=>{
  const blob=new Blob([reportHtml(bench().report(),quizLines())],{type:'text/html'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='titration-report.html';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);announce('Report downloaded.');
 };
 $('print').onclick=()=>{
  const frame=document.createElement('iframe');frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(frame);const doc=frame.contentDocument!;doc.open();doc.write(reportHtml(bench().report(),quizLines()));doc.close();
  setTimeout(()=>{frame.contentWindow?.focus();frame.contentWindow?.print();setTimeout(()=>frame.remove(),1500);},150);
 };

 // ---- Burette lens and announcements, every frame.
 const canvas=$<HTMLCanvasElement>('lens'),ctx=canvas.getContext('2d');
 const ratio=Math.min(2,window.devicePixelRatio||1);canvas.width=260*ratio;canvas.height=260*ratio;
 function drawLensNow(){
  const b=bench(),aids=$<HTMLInputElement>('aids').checked;
  if(ctx){ctx.setTransform(ratio,0,0,ratio,0,0);drawLens(ctx,260,260,b.filled?b.reading:null,aids);}
  const text=!b.filled?'The burette is empty.':aids?`The meniscus is between ${(Math.floor(b.reading*10)/10).toFixed(1)} and ${(Math.floor(b.reading*10)/10+.1).toFixed(1)} cm3.`:'';
  setText($('lens-text'),text);
 }
 let lastRefresh=0;
 function frame(now:number){
  drawLensNow();
  const t=bench().tap;if(!sliding&&document.activeElement!==slider&&Math.abs(Number(slider.value)/100-t)>.004)slider.value=String(Math.round(t*100));
  if(now-lastRefresh>250){lastRefresh=now;refresh();}
  const b=bench(),f=b.flask;
  if(f&&f.initial!==null&&!f.done){
   const key=`${(Math.round(f.delivered*20)/20).toFixed(2)}|${b.flaskColour}`;
   const colourChanged=key.split('|')[1]!==lastKey.split('|')[1];
   if(key!==lastKey&&now-lastAnnounce>(colourChanged?500:1500)){lastKey=key;announce(`Burette ${fmt(f.delivered)} cm3 delivered, flask ${b.flaskColour}, pH ${b.bulkPH.toFixed(1)}`);}
  }
  requestAnimationFrame(frame);
 }
 refresh();requestAnimationFrame(frame);
 void view;void stage;
 return {refresh,act,get live(){return live.textContent;},sheet};
}
