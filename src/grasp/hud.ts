import type {GraspScene} from './contracts';
import type {GraspEngine} from './engine';
import {PRESETS} from './engine';
import {DIGITS,DIP_RATIO,RANGE,forward,jointName,row,type Link} from './kinematics';
import {OBJECTS,objectById} from './objects';
import {KINDS} from './score';
import {COUPLINGS,MOTOR_COUNTS,residualGlow} from './synergy';
import {NEWTONS,PULLEY_MM,jointTorque} from './tendon';
import type {GraspView} from './view';

const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
const deg=(i:number,q:number)=>Math.round(q*(i===0?95:i<3?[0,RANGE.tMcp,RANGE.tIp][i]*180/Math.PI:[RANGE.mcp,RANGE.pip,RANGE.dip][i%3]*180/Math.PI));
const pct=(x:number)=>`${Math.round(x*100)}%`;
const DIGIT_SHORT=['Thumb','Index','Middle','Ring','Little'];

/** Everything around the 3D stage: the motor count, the object and its verdict, the checklist, the finger zoom, calibration and hints. */
export class GraspHud {
 private readonly el:Record<string,HTMLElement>={};private said:Record<string,string>={};private hoverRow=-1;private hoverAt={x:0,y:0};
 constructor(private readonly stage:HTMLElement,private readonly engine:GraspEngine,private readonly view:GraspView){
  stage.insertAdjacentHTML('beforeend',`
<section class="gr-motors" aria-label="Motor count"><small>How many motors?</small><div class="gr-seg" role="radiogroup">${MOTOR_COUNTS.map(k=>`<button role="radio" data-motors="${k}" title="${esc(COUPLINGS[k].blurb)}"><b>${k}</b><span>${COUPLINGS[k].motors.map(m=>`<i style="background:${m.color}"></i>`).join('')}</span></button>`).join('')}</div><p class="gr-blurb"></p><div class="gr-explained" title="Of the hand shapes you have made in the last half minute, how much each robot could follow"></div></section>
<section class="gr-card" aria-live="polite"><nav class="gr-objects">${OBJECTS.map(o=>`<button data-object="${o.id}"><b>${o.name}</b><small></small></button>`).join('')}</nav><div class="gr-verdict"></div></section>
<section class="gr-tax" aria-label="Grasp taxonomy"><small>Grasps found</small><ol></ol><p class="gr-tax-note">After Feix et al.’s grasp taxonomy</p></section>
<section class="gr-zoom" aria-label="One finger, close up"><nav>${DIGIT_SHORT.map((d,i)=>`<button data-digit="${i}">${d}</button>`).join('')}</nav><svg viewBox="-52 -105 215 150" aria-hidden="true"></svg><p></p></section>
<div class="gr-calib" hidden><div class="gr-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/><circle class="gr-ring-fill" cx="50" cy="50" r="44"/></svg><i></i></div><b></b><small></small><button data-act="skip">Skip, use typical ranges</button></div>
<p class="gr-tips" hidden>Rest your elbow on the desk, hand up, palm to the side · a webcam that sees your hand side-on reads finger curl best</p>
<div class="gr-presets" hidden><small>No hand in view. Mouse presets, a poor second: your hand makes fifteen angles at once.</small><div>${Object.entries(PRESETS).map(([id,p])=>`<button data-preset="${id}">${p.label}</button>`).join('')}</div></div>
<div class="gr-labels"><span class="gr-tag gr-tag-you">Your hand</span><span class="gr-tag gr-tag-robot"></span></div>
<div class="gr-tip" hidden></div><p class="gr-note" hidden></p>`);
  for(const k of ['motors','card','tax','zoom','calib','tips','presets','labels','tip','note'])this.el[k]=stage.querySelector<HTMLElement>(`.gr-${k}`)!;
  stage.addEventListener('click',e=>{
   const b=(e.target as HTMLElement).closest<HTMLElement>('button');if(!b)return;
   if(b.dataset.motors)engine.setMotors(Number(b.dataset.motors) as never);
   else if(b.dataset.object)engine.setObject(b.dataset.object as never);
   else if(b.dataset.digit)engine.setInspect(Number(b.dataset.digit));
   else if(b.dataset.preset)engine.setPreset(engine.preset===b.dataset.preset?null:b.dataset.preset);
   else if(b.dataset.act==='skip')engine.skipCalibration();
  });
  const viewport=stage.querySelector<HTMLElement>('.mirror-viewport')!;
  viewport.addEventListener('pointermove',e=>{this.hoverRow=e.buttons?-1:view.pick(e.clientX,e.clientY);const r=stage.getBoundingClientRect();this.hoverAt={x:e.clientX-r.left,y:e.clientY-r.top};});
  viewport.addEventListener('pointerleave',()=>{this.hoverRow=-1;});
  // A click (not a drag) on a finger opens it in the zoom.
  let down={x:0,y:0};viewport.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
  viewport.addEventListener('click',e=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const r=view.pick(e.clientX,e.clientY);if(r>=0)engine.setInspect(r<3?0:Math.floor(r/3));});
 }
 private set(key:string,el:Element,html:string){if(this.said[key]!==html){el.innerHTML=html;this.said[key]=html;}}
 update(live:boolean){
  const s=this.view.last;if(!s)return;
  const e=this.engine,c=s.coupling,v=s.verdict,o=objectById(s.object);
  // Motor count.
  for(const b of this.el.motors.querySelectorAll<HTMLElement>('[data-motors]'))b.setAttribute('aria-checked',String(Number(b.dataset.motors)===c.k));
  this.set('blurb',this.el.motors.querySelector('.gr-blurb')!,`${esc(c.blurb)} <span class="gr-legend">${c.motors.map(m=>`<i style="background:${m.color}"></i>${esc(m.name)}`).join(' ')}</span>`);
  const ex=s.samples>=8?MOTOR_COUNTS.map(k=>`<span class="${k===c.k?'is-on':''}"><b>${k}</b><em style="width:${Math.round(s.explained[k]*100)}%"></em><small>${pct(s.explained[k])}</small></span>`).join(''):'<small>Move your hand for a few seconds: here you will see how much of what it does each robot can follow.</small>';
  this.set('ex',this.el.motors.querySelector('.gr-explained')!,ex);
  // Object tabs and verdict.
  for(const b of this.el.card.querySelectorAll<HTMLElement>('[data-object]')){const id=b.dataset.object as keyof typeof s.best;b.classList.toggle('is-on',id===s.object);const best=s.best[id];const t=best?`best ${best}`:'';const sm=b.querySelector('small')!;if(sm.textContent!==t)sm.textContent=t;}
  const touching=v.forces.filter(f=>f.contact.kind==='object').length,held=s.lift>.5;
  const kind=v.kind?KINDS.find(k=>k.id===v.kind)!:null,goal=KINDS.find(k=>k.id===o.goal)!;
  const why=held?`Held: ${kind?.name??'stable'}. ${v.capacity>v.weight*4?'Plenty of grip to spare.':'Just enough grip.'}`:v.stable?'Stable… lifting':esc(v.reason);
  const hint=s.object==='pen'&&c.k===1&&!v.stable?'<p class="gr-hint">One motor: the thumb only bends, its rotation fixed for power grips. It cannot swing round to meet the index. Try 2 motors.</p>':s.object==='mug'&&c.k===1&&held?'<p class="gr-hint gr-good">One motor wrapped it: the fingers that touched stopped, and the whiffletree sent the pull on to the rest.</p>':'';
  this.set('verdict',this.el.card.querySelector('.gr-verdict')!,`<p class="gr-goal"><small>Goal</small>${esc(o.goalText)}</p>
<div class="gr-score ${held?'is-held':v.stable?'is-stable':''}"><output>${v.score}</output><div><b>${why}</b><small>${touching} pushing · ${v.contacts} touching · squeeze ${pct(v.balance)} · grip ${v.capacity.toFixed(1)} N for ${v.weight.toFixed(2)} N</small></div></div>${hint}`);
  // Taxonomy.
  this.set('tax',this.el.tax.querySelector('ol')!,KINDS.map(k=>{const t=s.taxonomy[k.id];return `<li class="${t?'is-found':''}${v.kind===k.id?' is-now':''}"><i>${t?'✓':''}</i><b>${k.name}</b><small>${t?`${t.motors} motor${t.motors>1?'s':''} · ${esc(objectById(t.object).name.toLowerCase())}`:esc(k.how)}</small></li>`;}).join(''));
  for(const b of this.el.zoom.querySelectorAll<HTMLElement>('[data-digit]'))b.classList.toggle('is-on',Number(b.dataset.digit)===s.inspect);
  this.drawZoom(s);
  // Calibration.
  const cal=s.calibration,showCal=cal.phase==='flat'||cal.phase==='fist'||(cal.phase==='done'&&cal.doneFor<1.6);
  this.el.calib.hidden=!showCal;
  if(showCal){
   const step=cal.phase==='flat'?['🖐','Hold your hand flat, fingers together','Step 1 of 2 · this is 0 for every joint']:cal.phase==='fist'?['✊','Now a fist, thumb wrapped over','Step 2 of 2 · this is 1 for every joint']:['✓','Calibrated','Your flat hand is 0 and your fist is 1, joint by joint'];
   this.set('cal',this.el.calib.querySelector('i')!,step[0]);this.el.calib.querySelector('b')!.textContent=step[1];this.el.calib.querySelector('small')!.textContent=step[2];
   this.el.calib.querySelector<SVGCircleElement>('.gr-ring-fill')!.style.strokeDashoffset=String(276.5*(1-(cal.phase==='done'?1:cal.progress)));
  }
  this.el.tips.hidden=!live||showCal;
  const presets=s.source==='preset'||s.source==='rest';this.el.presets.hidden=!presets;
  for(const b of this.el.presets.querySelectorAll<HTMLElement>('[data-preset]'))b.classList.toggle('is-on',b.dataset.preset===s.preset);
  // Labels over each hand.
  // Over the highest point of each hand as it is now.
  const top=(links:Link[],ghost:boolean)=>{let best={x:0,y:Infinity};for(const l of links)for(const p of [l.origin,[l.origin[0]+l.along[0]*l.length,l.origin[1]+l.along[1]*l.length,l.origin[2]+l.along[2]*l.length]]){const q=this.view.screenOf(p as never,ghost);if(q.y<best.y)best=q;}return {x:best.x,y:best.y-18};};
  const you=top(forward(s.user,true,{abd:s.spread}),true),robot=top(s.sim.links,false);robot.x=this.view.screenOf([0,9,0]).x;you.x=this.view.screenOf([0,9,0],true).x;
  const youTag=this.el.labels.querySelector<HTMLElement>('.gr-tag-you')!,robotTag=this.el.labels.querySelector<HTMLElement>('.gr-tag-robot')!;
  youTag.style.transform=`translate(${you.x}px,${you.y}px)`;robotTag.style.transform=`translate(${robot.x}px,${robot.y}px)`;
  const youText=s.source==='preset'?`Preset · ${PRESETS[s.preset!].label}`:s.source==='rest'?'Your hand · waiting':s.thumbUncertain?'Your hand · thumb hidden, holding':`Your hand${s.source==='phone'?' · phone camera':''}`;
  if(youTag.textContent!==youText)youTag.textContent=youText;
  const rt=`Robot · ${c.k} motor${c.k>1?'s':''}`;if(robotTag.textContent!==rt)robotTag.textContent=rt;
  // Hover readout: torque is pulley radius times tension.
  const tip=this.el.tip;
  if(this.hoverRow>=0){
   const i=this.hoverRow,t=jointTorque(c,s.sim,i),res=s.residual[i],ang=deg(i,s.sim.q[i]);
   const parts=t.parts.map(p=>`<span><i style="background:${c.motors[p.motor].color}"></i>${p.radius.toFixed(1)} mm × ${p.tension.toFixed(1)} N${p.share<1?` <em>(${p.share===.5?'½':p.share===.25?'¼':p.share===.125?'⅛':p.share.toFixed(2)} of ${c.motors[p.motor].name})</em>`:''}</span>`).join('');
   const slaved=i>=3&&i%3===2;
   this.set('tip',tip,`<b>${esc(jointName(i).replace(/^./,x=>x.toUpperCase()))}</b><small>${ang}°${s.sim.blocked[i]?' · stopped on contact':''}</small>${slaved?`<p>No tendon: a crossed four-bar turns it ${DIP_RATIO.toFixed(2)}× the PIP.</p>`:t.parts.length?`<p>${parts}</p><p class="gr-tq">τ = r × T = <b>${(t.torque/10).toFixed(1)} N·cm</b></p>`:'<p>No motor drives this joint at this count.</p>'}${residualGlow(res)>.05?`<p class="gr-res">Your hand is ${Math.abs(deg(i,res))}° ${res>0?'more bent':'straighter'}: no motor setting reaches it.</p>`:''}`);
   tip.style.transform=`translate(${this.hoverAt.x+16}px,${this.hoverAt.y+12}px)`;tip.hidden=false;
  }else tip.hidden=true;
  const note=s.note;this.el.note.hidden=!note;if(note){if(this.el.note.textContent!==note.text)this.el.note.textContent=note.text;this.el.note.style.opacity=String(Math.min(1,(4.5-note.age)/.6));}
  void e;void NEWTONS;void PULLEY_MM;
 }
 /** One finger in profile: links, pulleys, the tendon over them, the four-bar, and your own finger dashed behind. */
 private drawZoom(s:GraspScene){
  const d=s.inspect,links=s.sim.links.slice(d*3,d*3+3),c=s.coupling;
  // Project into the digit's bending plane: along the first link's direction and its pad side.
  // Fingers in the palm's own side view, so the knuckle bend shows; the thumb in its bending plane.
  const u=d===0?links[0].along:[0,1,0],w=d===0?links[0].pad:[0,0,1],o=links[0].origin,K=10.5;
  const P=(p:number[])=>{const r=[p[0]-o[0],p[1]-o[1],p[2]-o[2]];return [(r[0]*u[0]+r[1]*u[1]+r[2]*u[2])*K,-(r[0]*w[0]+r[1]*w[1]+r[2]*w[2])*K];};
  const end=(l:Link)=>[l.origin[0]+l.along[0]*l.length,l.origin[1]+l.along[1]*l.length,l.origin[2]+l.along[2]*l.length];
  const pts=[links[0].origin,...links.map(end)].map(P);
  // Your finger, measured: the same model with your angles, drawn over the robot's base so the shapes compare.
  const mine=(()=>{const q=s.user;let a=0;const rows=[row(d,0),row(d,1),row(d,2)],r=d===0?[0,RANGE.tMcp,RANGE.tIp]:[RANGE.mcp,RANGE.pip,RANGE.dip],lens=links.map(l=>l.length);let x=0,y=0;const out=[[0,0]];
   // The thumb's opposition turns its plane rather than bending it, so its first link sets the base direction.
   for(let k=0;k<3;k++){a+=(d===0&&k===0?0:q[rows[k]]*r[k]);x+=Math.cos(a)*lens[k]*K;y+=-Math.sin(a)*lens[k]*K;out.push([x,y]);}
   // Rotate to start along the robot's first link, which the projection lays on +x.
   const base=0;return out.map(([px,py])=>[px*Math.cos(base)-py*Math.sin(base),px*Math.sin(base)+py*Math.cos(base)]);})();
  const poly=(p:number[][])=>p.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const users=c.motors.map((m,j)=>({m,j})).filter(({m})=>[0,1,2].some(k=>m.column[row(d,k)]>0));
  // The tendon rides the gripping side, which the projection puts above each link: over each pulley, then along the phalanx.
  const tendon=users.map(({m,j},n)=>{
   const off=(n-(users.length-1)/2)*3,path:number[][]=[[-46,pts[0][1]-(PULLEY_MM[row(d,0)]*.75+off)]];
   let last=0;for(let k=0;k<3;k++)if(m.column[row(d,k)]>0)last=k;if(d>0)last=Math.min(last,1);
   for(let k=0;k<=last;k++){
    const dir=Math.atan2(pts[k+1][1]-pts[k][1],pts[k+1][0]-pts[k][0]),nx=Math.sin(dir),ny=-Math.cos(dir),r=(PULLEY_MM[row(d,k)]||6)*.75+off,side=links[k].radius*K*.85+off;
    path.push([pts[k][0]+nx*r,pts[k][1]+ny*r],[pts[k][0]+(pts[k+1][0]-pts[k][0])*(k===last?.6:.85)+nx*side,pts[k][1]+(pts[k+1][1]-pts[k][1])*(k===last?.6:.85)+ny*side]);
   }
   return `<polyline class="gr-z-tendon" points="${poly(path)}" stroke="${m.color}" style="stroke-width:${(1.4+Math.min(3,s.sim.motors[j].tension)).toFixed(1)}"/>`;
  }).join('');
  const bars=links.map((l,k)=>`<line class="gr-z-link${s.sim.blocked[row(d,k)]?' is-stopped':''}" x1="${pts[k][0].toFixed(1)}" y1="${pts[k][1].toFixed(1)}" x2="${pts[k+1][0].toFixed(1)}" y2="${pts[k+1][1].toFixed(1)}" style="stroke-width:${(l.radius*K*1.7).toFixed(1)}"/>`).join('');
  const pulleys=links.map((l,k)=>{const r=(PULLEY_MM[row(d,k)]||0)*.75,g=residualGlow(s.residual[row(d,k)]);return `${g>.05?`<circle class="gr-z-res" cx="${pts[k][0].toFixed(1)}" cy="${pts[k][1].toFixed(1)}" r="${(10+g*10).toFixed(1)}" style="opacity:${g.toFixed(2)}"/>`:''}<circle class="gr-z-pulley${r?'':' is-pin'}" cx="${pts[k][0].toFixed(1)}" cy="${pts[k][1].toFixed(1)}" r="${(r||3).toFixed(1)}"/>`;}).join('');
  // Crossed four-bar across the middle phalanx, for the fingers.
  const four=d>0?(()=>{const a=pts[1],b=pts[2],cc=pts[3],t=(p:number[],q:number[],f:number)=>[p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f];const p1=t(a,b,.25),p2=t(b,cc,.35);const nrm=(p:number[],q:number[])=>{const dx=q[0]-p[0],dy=q[1]-p[1],l=Math.hypot(dx,dy)||1;return [-dy/l*5,dx/l*5];};const n1=nrm(a,b),n2=nrm(b,cc);
   return `<line class="gr-z-four" x1="${(p1[0]+n1[0]).toFixed(1)}" y1="${(p1[1]+n1[1]).toFixed(1)}" x2="${(p2[0]-n2[0]).toFixed(1)}" y2="${(p2[1]-n2[1]).toFixed(1)}"/><line class="gr-z-four" x1="${(p1[0]-n1[0]).toFixed(1)}" y1="${(p1[1]-n1[1]).toFixed(1)}" x2="${(p2[0]+n2[0]).toFixed(1)}" y2="${(p2[1]+n2[1]).toFixed(1)}"/>`;})():'';
  const angles=links.map((_,k)=>`<text x="${(pts[k][0]+6).toFixed(1)}" y="${(pts[k][1]-8).toFixed(1)}">${deg(row(d,k),s.sim.q[row(d,k)])}°</text>`).join('');
  const svg=`<polyline class="gr-z-mine" points="${poly(mine)}"/>${bars}${four}${pulleys}${tendon}${angles}<line class="gr-z-palm" x1="-48" y1="${(pts[0][1]+8).toFixed(1)}" x2="-4" y2="${(pts[0][1]+8).toFixed(1)}"/>`;
  this.set('zoom',this.el.zoom.querySelector('svg')!,svg);
  const ui=row(d,1),ud=row(d,2),ratio=s.user[ui]>.15?(s.user[ud]*RANGE.dip)/(s.user[ui]*RANGE.pip):NaN;
  const cap=d===0?`Thumb: ${c.k===1?'rotation fixed at a power-grip angle; one tendon bends it':`the ${c.motors.find(m=>m.column[0]>0)?.name.toLowerCase()} tendon swings it round, opposition ${deg(0,s.sim.q[0])}%`}.`:`${DIGITS[d].replace(/^./,x=>x.toUpperCase())}: one tendon over the MCP and PIP pulleys; the DIP has no motor. A crossed four-bar turns it ${DIP_RATIO.toFixed(2)}× the PIP${Number.isFinite(ratio)?`, and yours turns ${ratio.toFixed(2)}×: you cannot bend your fingertip alone either`:''}. Dashed: your finger.`;
  this.set('zcap',this.el.zoom.querySelector('p')!,esc(cap));
 }
}
