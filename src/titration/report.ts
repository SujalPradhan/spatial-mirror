import {ACCURACY_MAX,QUIZ_MAX,READINGS_MAX,TECHNIQUE_MAX,type Report} from './bench';
import {indicatorNames,fmt} from './model';

const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
export const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const signed=(n:number)=>`${n>=0?'+':'-'}${Math.abs(n).toFixed(1)}%`;

/** A self-contained, printable page: opens as a file, prints cleanly, and saves to PDF from the print dialog. */
export function reportHtml(r:Report,quizLines:{text:string;attempts:number;correct:boolean;points:number}[]):string{
 const rows=r.runs.map((run,i)=>`<tr><td>${run.kind==='rough'?'Rough':'Accurate '+i}</td><td>${fmt(run.initial)}</td><td>${fmt(run.final)}</td><td>${fmt(run.titre)}</td><td>${esc(indicatorNames[run.indicator])}</td></tr>`).join('');
 const issues=r.issues.length?`<ul>${r.issues.map(i=>`<li>${esc(i.text)} <em>(-${i.cost})</em></li>`).join('')}</ul>`:'<p>No technique errors. Rinse, fill, tip, indicator, swirling and end point were all handled well.</p>';
 const quiz=quizLines.length?`<table><tr><th>Question</th><th>Tries</th><th>Points</th></tr>${quizLines.map(q=>`<tr><td>${esc(q.text)}</td><td>${q.attempts}</td><td>${q.points}</td></tr>`).join('')}</table>`:'<p>No checkpoint questions answered.</p>';
 const result=r.found===null?'<p>The calculation was not completed.</p>':`<p>Your result: <b>${fmt(r.found,4)} mol/dm3</b>. True value: <b>${fmt(r.acid,4)} mol/dm3</b>. Error: <b>${signed(r.error!)}</b>.</p>`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Titration report</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font:15px/1.5 system-ui,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 20px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 8px;border-bottom:1px solid #bbb;padding-bottom:4px}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}th{background:#f1f1f1}.score{font-size:34px;font-weight:700}li{margin:4px 0}@media print{body{margin:0}}
</style></head><body><h1>Titration report</h1><p>Unknown hydrochloric acid against 0.100 mol/dm3 sodium hydroxide. Time at the bench: ${clock(r.elapsed)}.</p>
<p class="score">${r.total} / 100</p>
<table><tr><th>Part</th><th>Score</th></tr><tr><td>Technique</td><td>${r.technique} / ${TECHNIQUE_MAX}</td></tr><tr><td>Burette readings</td><td>${r.readings} / ${READINGS_MAX}</td></tr><tr><td>Accuracy</td><td>${r.accuracy} / ${ACCURACY_MAX}</td></tr><tr><td>Checkpoint questions</td><td>${r.quiz} / ${QUIZ_MAX}</td></tr><tr><td>Hints used</td><td>-${r.hints}</td></tr></table>
<h2>Result</h2>${result}${r.mean!==null?`<p>Mean of the agreeing accurate titres: ${fmt(r.mean)} cm3, uncertainty about ±0.10 cm3.</p>`:''}
<h2>Titrations</h2><table><tr><th>Run</th><th>Initial / cm3</th><th>Final / cm3</th><th>Titre / cm3</th><th>Indicator</th></tr>${rows}</table>
<h2>Technique</h2>${issues}${r.wrongReadings?`<p>${r.wrongReadings} burette reading${r.wrongReadings>1?'s were':' was'} more than 0.05 cm3 from the true value.</p>`:''}
<h2>Checkpoint questions</h2>${quiz}</body></html>`;
}
