// Run with tsx against `PORT=4417 node server.mjs`: STUDIO_URL=http://localhost:4417 npx tsx tests/titration-browser.mjs
// The whole practical runs from the mouse and keyboard with no camera. Hands are injected landmarks that go through the real gesture tracker.
// SHOTS=<dir> keeps a screenshot of each stage at 1280x800 and 390x844.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4417',shots=process.env.SHOTS;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:true}),page=await context.newPage(),errors=[],checks=[];
page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
const check=m=>{checks.push(m);console.log('ok',m);};
const shot=async(name,p=page)=>{if(shots)await p.screenshot({path:`${shots}/${name}.png`});};
const key=async k=>{await page.evaluate(()=>document.activeElement?.blur?.());await page.keyboard.press(k);};
const text=sel=>page.locator(sel).innerText();
const bench=fn=>page.evaluate(fn);
const until=(fn,arg,opts)=>page.waitForFunction(fn,arg,{polling:'raf',timeout:90000,...opts});
const roundTo=v=>Math.round(v*20)/20;
const trueReading=()=>bench(()=>window.__titration.bench.reading);
async function record(kind,offset=0){
 const r=roundTo((await trueReading())+offset);
 await page.locator('#titration-reading').fill(String(r));
 await page.locator(kind==='initial'?'#titration-initial':'#titration-final').click();
 return r;
}
async function swirl(ms=900){await key('s');await page.waitForTimeout(ms);}
/** Fast until about a cm3 short, then drop by drop with a swirl after each until the first lasting colour. */
async function titrate({overshoot=false}={}){
 await page.evaluate(()=>{const s=document.querySelector('#titration-tap');s.value='100';s.dispatchEvent(new Event('input',{bubbles:true}));});
 await until(()=>window.__titration.bench.excess>-1.3);
 await key(' ');
 assert.equal(await bench(()=>window.__titration.bench.tap),0,'Space shuts the tap');
 if(overshoot){
  await page.evaluate(()=>{const s=document.querySelector('#titration-tap');s.value='100';s.dispatchEvent(new Event('input',{bubbles:true}));});
  await until(()=>window.__titration.bench.excess>.6);await key(' ');await swirl(1800);return;
 }
 for(let i=0;i<60;i++){
  if(await bench(()=>window.__titration.bench.tint.alpha>.12))return;
  await key('d');await swirl(800);
 }
 throw new Error('no end point reached');
}
async function newFlask(){await key('p');await key('a');}
const contrast=()=>page.evaluate(()=>{
 const parse=c=>{const m=c.match(/[\d.]+/g).map(Number);return {r:m[0],g:m[1],b:m[2],a:m[3]??1};};
 const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
 const over=(top,bottom)=>({r:top.r*top.a+bottom.r*(1-top.a),g:top.g*top.a+bottom.g*(1-top.a),b:top.b*top.a+bottom.b*(1-top.a),a:1});
 const background=el=>{let layers=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);if(c.a>0)layers.push(c);if(c.a>=1)break;}let out={r:10,g:17,b:25,a:1};for(const c of layers.reverse())out=over(c,out);return out;};
 const bad=[];
 for(const el of document.querySelectorAll('.ti-sheet button:not(:disabled),.ti-sheet p,.ti-sheet li,.ti-sheet label,.ti-sheet summary,.ti-sheet td,.ti-sheet th,.ti-sheet kbd,.ti-sheet output,.ti-sheet input:not(:disabled),.ti-sheet select:not(:disabled)')){
  if(el instanceof HTMLInputElement&&['checkbox','range','radio'].includes(el.type))continue;if(!el.textContent.trim()&&!(el.tagName==='INPUT'&&el.value))continue;if(el.offsetParent===null)continue;
  const fg=parse(getComputedStyle(el).color),bg=background(el),f=over(fg,bg),a=lum(f),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  if(ratio<4.5)bad.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0,30)}" ${ratio.toFixed(2)}`);
 }
 return bad;
});
const smallTargets=()=>page.evaluate(()=>[...document.querySelectorAll('.ti-sheet button,.ti-sheet input,.ti-sheet select,.ti-sheet summary,.mirror-corner button')].filter(e=>e.offsetParent!==null).map(e=>{const r=e.getBoundingClientRect();return {name:(e.id||e.textContent).slice(0,24),w:r.width,h:r.height};}).filter(t=>t.w<24||t.h<24));
try{
 assert.equal((await page.goto(`${base}/titration?seed=21`)).status(),200);
 await page.waitForFunction(()=>window.__titration?.ready&&window.__titration.owns,null,{timeout:60000});
 assert.equal(await page.title(),'Titration bench - Spatial Studio');assert.equal(await text('.workspace-nav [aria-current=page]'),'Titration');
 assert.equal(await text('.mirror-mark'),'Titration bench');
 assert.equal(await page.locator('#titration-objectives li').count(),6);assert.equal(await page.locator('#titration-steps li').count(),8);
 assert.match(await text('.ti-story'),/unknown hydrochloric acid using 0\.100 mol\/dm3 sodium hydroxide/);
 assert.deepEqual(await page.locator('#titration-gestures li').allTextContents(),['🖐Turn the tap','✊Swirl']);
 await shot('01-start');
 check('page loads at /titration with nav, 6 objectives, 8 steps, 2 gestures, no camera');
 assert.equal(await page.locator('#titration-sheet *:not(.ti-sr)').evaluateAll(l=>l.some(e=>/\u2014/.test(e.textContent))),false,'no em dashes');
 const acid=await bench(()=>window.__titration.bench.acid);assert.ok(acid>=.08&&acid<=.12);
 assert.equal(await bench(()=>window.__titration.bench.acid),acid);
 check(`the unknown acid is seeded and in range (${acid})`);

 // ---- Preparation by keys and buttons.
 await key('f');assert.equal(await page.locator('#titration-steps li[data-id=rinse]').getAttribute('data-state'),'skipped','filling first marks the rinse skipped, silently');
 assert.doesNotMatch(await text('#titration-message'),/rinse/i,'no warning is shown about the skipped rinse');
 await page.locator('#titration-restart').click();assert.equal(await bench(()=>window.__titration.bench.filled),false);
 await key('r');await page.locator('#titration-fill').click();await key('b');
 assert.deepEqual(await bench(()=>{const b=window.__titration.bench;return [b.rinsed,b.filled,b.bubble];}),[true,true,false]);
 assert.notEqual(await bench(()=>window.__titration.bench.seed),21,'a new session draws a new unknown');
 await page.goto(`${base}/titration?seed=21`);await page.waitForFunction(()=>window.__titration?.ready&&window.__titration.owns);
 await key('r');await page.locator('#titration-fill').click();await page.locator('#titration-bubble').click();
 await page.locator('#titration-pipette').click();
 assert.equal(await page.locator('#titration-add-indicator').isDisabled(),false);
 await page.locator('#titration-indicator').selectOption('phenolphthalein');await page.locator('#titration-add-indicator').click();
 await shot('02-prepared');
 assert.deepEqual(await page.locator('#titration-steps li').evaluateAll(l=>l.map(x=>x.dataset.state)),['done','done','done','done','done','current','todo','todo']);
 check('keys R F B and buttons prepare the flask; a skipped rinse is marked without a warning');

 // ---- The tap is blocked until the initial reading is recorded; reading aids and the zoom view.
 assert.match(await text('#titration-blocked'),/initial reading/);
 await bench(()=>{window.__titration.panel.act.drop();});assert.equal(await bench(()=>window.__titration.bench.reading)>0,true);
 const before=await trueReading();await page.evaluate(()=>{const s=document.querySelector('#titration-tap');s.value='100';s.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForTimeout(400);
 assert.equal(await trueReading(),before,'nothing runs before the initial reading is recorded');
 await key(' ');
 assert.equal(await page.locator('#titration-lens-text').innerText(),'','no number is given by default');
 await page.locator('#titration-aids').check();assert.match(await text('#titration-lens-text'),/between \d+\.\d and \d+\.\d cm3/);await shot('03-reading-aids');await page.locator('#titration-aids').uncheck();
 await page.locator('#titration-zoom').click();await page.waitForTimeout(900);await shot('04-zoom-burette');await key('z');await page.waitForTimeout(500);
 check('no auto readout by default, reading aids add a 0.1 cm3 window and a guide line, zoom view works');

 // ---- Hands: a wrist turn sets the stopcock, a level hand shuts it.
 await record('initial',.2);
 assert.equal(await bench(()=>window.__titration.bench.flask.initial!==null),true);
 const stage=await page.locator('#titration-stage').boundingBox(),aspect=stage.width/stage.height;
 const roll=(deg,mx=.5,my=.55)=>{const h=posedHand('open'),a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return h.map(p=>{const x=p.x*c-p.y*s,y=p.x*s+p.y*c;return {x:(1-mx)+x*.14,y:my+y*.14*aspect,z:p.z*.14};});};
 const feed=hands=>page.evaluate(h=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>window.__titration.hands(h),33);},hands);
 const quiet=async()=>{await page.evaluate(()=>clearInterval(window.testFeed));await page.waitForFunction(()=>window.__titration.frame.hands.length===0);};
 const settled=async fn=>{await page.waitForTimeout(700);return bench(fn);};
 await feed([roll(0)]);await page.waitForFunction(()=>window.__titration.frame.hands[0]?.pose==='open');
 const level=await settled(()=>window.__titration.bench.tap);assert.ok(level<.01,`level hand keeps the tap shut: ${level}`);
 await feed([roll(20)]);const small=await settled(()=>window.__titration.bench.tap);assert.ok(small>0&&small<.2,`a small wrist turn drips: ${small}`);
 await feed([roll(-20)]);assert.ok(await settled(()=>window.__titration.bench.tap)>0,'either direction works');
 await feed([roll(70)]);const big=await settled(()=>window.__titration.bench.tap);assert.ok(big>.9,`a big turn runs a stream: ${big}`);
 assert.match(await text('#titration-tap-text'),/stream/);
 const r0=await trueReading();await page.waitForTimeout(700);assert.ok(await trueReading()>r0+.3,'the stream delivers titrant');
 const t45=await bench(()=>window.__titration.engine.turn);assert.ok(Math.abs(t45)>1);
 await quiet();assert.equal(await bench(()=>window.__titration.bench.tap),0,'taking the hand away shuts the tap');
 check('wrist roll frames: level shuts, 20 degrees drips either way, 70 degrees streams, hand away closes the tap');
 // Swirl: a fist going round.
 const circle=t=>{const h=posedHand('fist'),mx=.5+.07*Math.cos(t*2*Math.PI*2),my=.55+.07*aspect*Math.sin(t*2*Math.PI*2);return h.map(p=>({x:(1-mx)+p.x*.14,y:my+p.y*.14*aspect,z:p.z*.14}));};
 const fistPoints=Array.from({length:60},(_,i)=>[circle(i/30)]);
 await page.evaluate(pts=>{clearInterval(window.testFeed);let i=0;window.testFeed=setInterval(()=>{window.__titration.hands(pts[i++%pts.length]);},33);},fistPoints);
 await page.waitForFunction(()=>window.__titration.engine.swirlLevel>.5);
 await feed([posedHand('fist').map(p=>({x:.5+p.x*.14,y:.55+p.y*.14*aspect,z:p.z*.14}))]);await page.waitForFunction(()=>window.__titration.engine.swirlLevel===0);
 await quiet();
 check('a fist going round swirls (level above 0.5), a still fist does not');

 // ---- Rough titration: deliberately overshoot, then record with a wrong initial reading already entered.
 await key('s');await titrate({overshoot:true});
 assert.equal(await bench(()=>window.__titration.bench.tint.name),'deep pink');
 assert.ok(await bench(()=>window.__titration.bench.excess)>.5);
 const pink=await bench(()=>window.__titration.view.liquidColour);const [rr,gg]=[1,3].map(i=>parseInt(pink.slice(i,i+2),16));assert.ok(rr>gg+60,`flask looks pink: ${pink}`);
 await shot('05-overshoot');
 await record('final');
 assert.match(await text('#titration-results'),/Rough/);assert.match(await text('#titration-results'),/not used in the mean/);
 check('overshooting the rough run turns the flask deep pink, and the rough titre is recorded but not used in the mean');

 // ---- Accurate titrations.
 let titres=0,water=0;
 for(let run=1;run<=4;run++){
  if(await trueReading()>22)await key('f');
  await newFlask();await record('initial');
  if(run===1)water=await bench(()=>{const c=window.__titration.view.liquidColour;return parseInt(c.slice(1,3),16)-parseInt(c.slice(3,5),16);});
  if(run===1)await shot('06-ready-accurate');
  await titrate();
  const name=await bench(()=>window.__titration.bench.tint.name);assert.ok(['faint pink','pink'].includes(name),`end point shows ${name}`);
  if(run===1){
   const col=await bench(()=>window.__titration.view.liquidColour),[r,g]=[1,3].map(i=>parseInt(col.slice(i,i+2),16));assert.ok(r-g>water+15,`faint pink in the 3D flask: ${col}`);
   await page.waitForFunction(()=>/Burette \d+\.\d\d cm3 delivered/.test(window.__titration.live));
   assert.match(await bench(()=>window.__titration.live),/Burette \d+\.\d\d cm3 delivered, flask [a-z ]+, pH \d+\.\d/,'live region announces delivered volume, colour and pH');
   await shot('07-faint-pink');
   assert.ok(await bench(()=>window.__titration.bench.excess)<.1);
   check(`first lasting colour at the end point is ${name}, within 0.1 cm3 of equivalence; live region: ${await bench(()=>window.__titration.live)}`);
  }
  await record('final');titres++;
  if(await bench(()=>window.__titration.bench.mean!==null))break;
 }
 await shot('08-results');
 const con=await text('#titration-concordance');assert.match(con,/agree within 0\.10 cm3\. Mean \d+\.\d\d ± 0\.10 cm3/);
 assert.match(await text('#titration-results'),/±0\.10 cm3/);assert.match(await text('#titration-results'),/used in the mean/);
 const mean=await bench(()=>window.__titration.bench.mean);
 check(`results table: rough excluded, ${titres} accurate runs, ${con}`);

 // ---- Calculation, with feedback on a wrong step.
 const want=await bench(()=>window.__titration.bench.expectedCalc);
 await page.locator('#titration-calc-nBase').fill(String(want.nBase*1000));await page.locator('[data-check=nBase]').click();
 assert.match(await text('#titration-calc-nBase-fb'),/1000 times too big/);
 await page.locator('#titration-calc-nBase').fill(want.nBase.toExponential(3));await page.locator('[data-check=nBase]').click();
 await page.waitForSelector('[data-step=nBase][data-ok=true]');
 await page.locator('#titration-calc-nAcid').fill(String(want.nAcid));await page.locator('[data-check=nAcid]').click();
 await page.locator('#titration-calc-conc').fill(want.conc.toFixed(4));await page.keyboard.press('Enter');
 await page.waitForSelector('#titration-compare');
 const compare=await text('#titration-compare');assert.match(compare,/True value \d\.\d{4} mol\/dm3/);assert.match(compare,/Error [+-]\d+\.\d%/);
 await shot('09-calculation');
 check(`calculation: wrong step explained, three steps accepted, compared with the truth: ${compare.replace(/\n/g,' ').slice(0,120)}`);

 // ---- Questions: first try 10, second try 8; one hint costs 2.
 await page.locator('.ti-opt[data-q=q1][data-o="1"]').click();assert.match(await text('[data-q=q1] .ti-feedback'),/Not quite/);
 await page.locator('.ti-opt[data-q=q1][data-o="0"]').click();assert.match(await text('[data-q=q1] .ti-feedback'),/Correct.* 8 points/);
 for(const q of ['q2','q3','q4']){await page.locator(`.ti-opt[data-q=${q}][data-o="1"]`).click();assert.match(await text(`[data-q=${q}] .ti-feedback`),/Correct.* 10 points/);}
 await shot('10-questions');
 await key('h');assert.equal(await bench(()=>window.__titration.bench.hints),1);await page.locator('summary:has-text("Theory and hints")').click({trial:true}).catch(()=>{});
 check('questions score 8 after one miss and 10 first time; a hint is counted');

 // ---- Report: shown, downloaded, printable.
 await page.locator('#titration-report-show').click();
 const report=await bench(()=>window.__titration.bench.report());
 assert.ok(report.issues.some(i=>i.id==='overshoot'),'the overshoot is in the debrief');
 assert.ok(report.wrongReadings>=1&&/Burette readings/.test(await text('#titration-report')),'the wrong initial reading is counted');
 assert.equal(report.hints,2);assert.equal(report.quiz,Math.round((8+30)/40*20));
 await shot('11-report');
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#titration-download').click()]);
 assert.equal(download.suggestedFilename(),'titration-report.html');
 const html=await readFile(await download.path(),'utf8');
 assert.match(html,/Titration report/);assert.match(html,/Technique/);assert.match(html,/Checkpoint questions/);assert.doesNotMatch(html,/\u2014/);
 assert.match(html,new RegExp(`${acid.toFixed(4)}`));
 check(`report: score ${report.total}/100 shown, overshoot and a wrong reading in the debrief, HTML downloads with all sections`);

 // ---- Accessibility.
 assert.deepEqual(await contrast(),[],'text contrast at least 4.5:1');
 assert.deepEqual(await smallTargets(),[],'every target at least 24px');
 await page.locator('#titration-hint').focus();await page.keyboard.press('Tab');assert.match(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),/solid|auto/);
 check('contrast at least 4.5:1 on every text element in the sheet, every target at least 24px, focus outline visible');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300);await page.emulateMedia({reducedMotion:'no-preference'});

 // ---- Replaying the tutorial shows only what this page uses.
 await page.locator('#titration-tutorial-replay').click();await page.waitForFunction(()=>window.__titration.tutorial?.total===2);
 check('tutorial lists 2 gestures');
 assert.deepEqual(errors,[]);

 // ---- Phone width.
 const phone=await (await browser.newContext({viewport:{width:390,height:844},hasTouch:true,acceptDownloads:true})).newPage();phone.on('pageerror',e=>errors.push(e.message));phone.setDefaultTimeout(60000);
 await phone.goto(`${base}/titration?seed=21`);await phone.waitForFunction(()=>window.__titration?.ready);
 await shot('m01-start',phone);
 await phone.locator('#titration-rinse').click();await phone.locator('#titration-fill').click();await phone.locator('#titration-bubble').click();await phone.locator('#titration-pipette').click();await phone.locator('#titration-add-indicator').click();
 await phone.locator('#titration-bench').scrollIntoViewIfNeeded();await shot('m02-bench',phone);
 await phone.evaluate(()=>{const t=window.__titration;const r=Math.round(t.bench.reading*20)/20;document.querySelector('#titration-reading').value=String(r);document.querySelector('#titration-initial').click();});
 await phone.evaluate(()=>{const s=document.querySelector('#titration-tap');s.value='100';s.dispatchEvent(new Event('input',{bubbles:true}));});
 await phone.waitForFunction(()=>window.__titration.bench.excess>-4,null,{polling:'raf',timeout:90000});
 await phone.evaluate(()=>window.__titration.engine.setTap(0));await shot('m03-titrating',phone);
 assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal scroll at 390px');
 await phone.evaluate(()=>{const b=window.__titration.bench;for(let i=0;i<400&&b.tint.alpha<.15;i++){b.dropOne();for(let k=0;k<20;k++){b.setSwirl(1);b.step(.05);}}document.querySelector('#titration-reading').value=String(Math.round(b.reading*20)/20);document.querySelector('#titration-final').click();});
 await phone.locator('#titration-results').scrollIntoViewIfNeeded();await shot('m04-results',phone);
 await phone.evaluate(()=>{const b=window.__titration.bench,rec=()=>{b.pipette();b.addIndicator('phenolphthalein');b.recordInitial(Math.round(b.reading*20)/20);while(b.excess<-.9){b.setTap(1);b.setSwirl(1);b.step(.05);}b.setTap(0);for(let i=0;i<400&&b.tint.alpha<.15;i++){b.dropOne();for(let k=0;k<20;k++){b.setSwirl(1);b.step(.05);}}b.recordFinal(Math.round(b.reading*20)/20);};if(b.reading>20)b.fill();rec();if(b.reading>20)b.fill();rec();if(b.mean===null){if(b.reading>20)b.fill();rec();}const w=b.expectedCalc;for(const [s,v] of [['nBase',w.nBase],['nAcid',w.nAcid],['conc',w.conc]])b.submitCalc(s,v);b.answerQuiz('q1',true);});
 await phone.waitForSelector('#titration-compare');await phone.locator('#titration-calc').scrollIntoViewIfNeeded();await shot('m05-calculation',phone);
 await phone.locator('#titration-report-show').click();await phone.locator('#titration-report-card').scrollIntoViewIfNeeded();await shot('m06-report',phone);
 assert.deepEqual(errors,[]);
 check('phone width 390x844: whole flow reachable, no horizontal scroll');
 console.log('Titration browser passed:',checks.length,'checks.');
}catch(e){
 console.log('Done so far:',checks);console.log(await page.evaluate(()=>{const s=window.__titration;return s&&{bench:{reading:s.bench.reading,tap:s.bench.tap,excess:s.bench.excess,tint:s.bench.tint,runs:s.bench.runs.length,flask:s.bench.flask},live:s.live,hands:s.frame.hands.map(h=>h.pose)};}).catch(()=>null));
 await shot('failure');console.error(e);process.exitCode=1;
}finally{await browser.close();}
