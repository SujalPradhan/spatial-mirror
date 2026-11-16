// Run against a dev server: STUDIO_URL=http://localhost:4520 SHOTS=<dir> npx tsx tests/titration-demo-browser.mjs
// Checks the Watch the demo button and ?demo deep link, a full autoplay to the report, Pause, Exit, Escape,
// Now try it yourself, the layout at four sizes while the demo runs, and that nothing leaks into normal mode.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.STUDIO_URL||'http://localhost:4520',shots=process.env.SHOTS;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],checks=[];
const check=m=>{checks.push(m);console.log('ok',m);};
const sizes=[[1280,800],[1024,768],[768,1024],[390,844]];
const em=/[—–]/;

async function open(query='',{width=1280,height=800,reducedMotion}={}){
 const context=await browser.newContext({viewport:{width,height},hasTouch:width<500,reducedMotion}),page=await context.newPage();
 page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 // Record every line and chip the demo shows, and whether an answer was ringed.
 await page.addInitScript(()=>{
  window.__seen={lines:[],chips:[],picked:false,doing:[]};
  const watch=()=>{
   const note=(id,key)=>{const el=document.getElementById(id);if(!el)return false;new MutationObserver(()=>{const t=el.textContent.trim();if(t&&window.__seen[key].at(-1)!==t)window.__seen[key].push(t);}).observe(el,{childList:true,characterData:true,subtree:true});return true;};
   if(!(note('titration-line','lines')&&note('titration-chip','chips')&&note('titration-how','doing')))return requestAnimationFrame(watch);
   new MutationObserver(()=>{if(document.querySelector('.ti-opt.is-picked'))window.__seen.picked=true;}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
  };
  addEventListener('DOMContentLoaded',watch);
 });
 assert.equal((await page.goto(`${base}/titration${query}`)).status(),200);
 await page.waitForFunction(()=>window.__titration?.ready&&window.__titration.owns,null,{timeout:60000});
 return page;
}
const until=(page,fn,arg,timeout=150000)=>page.waitForFunction(fn,arg,{polling:'raf',timeout});
const lab=page=>page.evaluate(()=>{const l=__titration.lab;return {step:l.step,id:l.id,phase:l.phase,finished:l.finished,quiz:!!l.quiz,runs:l.bench.runs.length,calc:l.bench.calcDone,hints:l.bench.hints,reading:l.bench.reading,line:document.querySelector('#titration-line').textContent,quizzes:Object.keys(l.quizResult).length};});
const demoState=page=>page.evaluate(()=>__titration.guide.demo.state);
const visible=(page,sel)=>page.locator(sel).isVisible();
const storageKeys=page=>page.evaluate(()=>Object.keys(localStorage).sort().map(k=>k+'='+localStorage.getItem(k)));
async function assertNormalStepOne(page,why){
 const s=await lab(page);
 assert.equal(await demoState(page),'idle',why);
 assert.equal(s.step,0,why);assert.equal(s.finished,false,why);assert.equal(s.runs,0,`${why}: no titrations left over`);assert.equal(s.calc,false,why);assert.equal(s.quizzes,0,`${why}: no answers left over`);assert.equal(s.hints,0,why);
 assert.equal(await visible(page,'#titration-demo'),false,`${why}: demo controls hidden`);
 assert.equal(await page.evaluate(()=>__titration.guide.drawerOpen),false,`${why}: the Notebook panel is closed`);
 assert.equal(await visible(page,'#titration-demo-start'),true,`${why}: the Watch the demo button is back`);
 assert.equal(await visible(page,'#titration-demo-try'),false,why);
 assert.equal(await page.locator('#titration-drawer').isHidden(),true,`${why}: notebook closed`);
 assert.equal(await page.locator('#titration-compare').count(),0,`${why}: no result or score left in the notebook`);
 assert.match(await page.locator('#titration-step').innerText(),/Step 1 of 10 · Put on your goggles/,why);
 assert.match(await page.locator('#titration-skip').innerText(),/Skip this step/,why);
 assert.equal(await page.evaluate(()=>__titration.engine.demoLock),false,`${why}: the bench takes the mouse again`);
 assert.equal(await page.evaluate(()=>__titration.engine.paused),false,why);
 assert.equal(await page.evaluate(()=>__titration.engine.simSpeed),1,why);
}
/** Boxes that must never overlap: the strip, card, guide bubble, gesture bar, corner buttons and drawer. */
const overlaps=page=>page.evaluate(()=>{
 const sel=['.ti-dots','.ti-task','.ti-guide','.mirror-gestures','.mirror-corner','.mirror-mark','#titration-drawer','.mirror-enter','.workspace-nav'];
 const rs=sel.map(s=>[s,document.querySelector(s)]).filter(([,e])=>e&&!e.hidden&&e.offsetParent!==null).map(([s,e])=>[s,e.getBoundingClientRect()]).filter(([,r])=>r.width>0&&r.height>0);
 const bad=[];for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){const a=rs[i][1],b=rs[j][1];if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)bad.push(`${rs[i][0]} x ${rs[j][0]}`);}
 const off=rs.filter(([s,r])=>s.startsWith('.ti-')&&(r.left<-1||r.right>innerWidth+1||r.bottom>innerHeight+1)).map(([s])=>s);
 return {bad,off,scroll:document.documentElement.scrollWidth>innerWidth};
});
async function layoutAtEverySize(page,label){
 for(const [w,h] of sizes){
  await page.setViewportSize({width:w,height:h});await page.waitForTimeout(700);
  const o=await overlaps(page);
  assert.deepEqual(o.bad,[],`${label} at ${w}x${h}: nothing overlaps`);
  assert.deepEqual(o.off,[],`${label} at ${w}x${h}: nothing runs off the screen`);
  assert.equal(o.scroll,false,`${label} at ${w}x${h}: no sideways scroll`);
  if(shots)await page.screenshot({path:`${shots}/${w}-${label}.png`});
 }
 await page.setViewportSize({width:1280,height:800});await page.waitForTimeout(400);
}

let page=null;
try{
 // ======== Normal mode at four sizes, and the demo button.
 page=await open('?seed=21');
 await layoutAtEverySize(page,'normal-1-safety');
 const btn=page.locator('#titration-demo-start');
 assert.equal(await btn.isVisible(),true);
 assert.match(await btn.innerText(),/Watch the demo/);
 const box=await btn.boundingBox();assert.ok(box.width>=100&&box.height>=30,'the button is a proper target');
 assert.equal(await visible(page,'#titration-demo'),false);
 const keysBefore=await storageKeys(page);
 check('normal mode: a clear Watch the demo button in the task card, no overlaps at 1280x800, 1024x768, 768x1024, 390x844');

 // ======== Pause halts progress, Resume carries on, Exit returns to a clean step 1.
 await btn.click();
 await page.waitForFunction(()=>__titration.guide.demo.state==='running');
 for(const sel of ['#titration-demo','#titration-demo-pause','#titration-demo-exit'])assert.equal(await visible(page,sel),true,`${sel} is visible`);
 assert.equal(await visible(page,'#titration-demo-start'),false);
 assert.match(await page.locator('#titration-demo-pause').innerText(),/Pause/);
 assert.equal(await page.evaluate(()=>__titration.engine.demoLock),true);
 await until(page,()=>__titration.lab.id==='fill'&&__titration.lab.phase==='pour');
 await page.locator('#titration-demo-pause').click();
 assert.match(await page.locator('#titration-demo-pause').innerText(),/Resume/);
 assert.equal(await demoState(page),'paused');
 await page.waitForTimeout(300);
 const frozen=await page.evaluate(()=>({...(({id,phase,level,rev})=>({id,phase,level,rev}))(__titration.lab),line:document.querySelector('#titration-line').textContent,tap:__titration.bench.tap,elapsed:__titration.bench.elapsed}));
 await page.waitForTimeout(3000);
 const later=await page.evaluate(()=>({...(({id,phase,level,rev})=>({id,phase,level,rev}))(__titration.lab),line:document.querySelector('#titration-line').textContent,tap:__titration.bench.tap,elapsed:__titration.bench.elapsed}));
 assert.deepEqual(later,frozen,'nothing moves while paused: step, level, line and bench clock hold still');
 assert.equal(await visible(page,'#titration-demo-pause'),true,'Pause/Resume stays visible');
 await page.locator('#titration-demo-pause').click();
 await page.waitForFunction(()=>__titration.guide.demo.state==='running');
 await until(page,()=>__titration.lab.id!=='fill');
 check('Pause freezes the lab and the story for 3 seconds, Resume carries on');
 // The mouse and keys do not drive the lab during the demo.
 await page.locator('#titration-viewport').focus();await page.keyboard.press('n');await page.keyboard.press('h');
 assert.equal(await page.locator('#titration-drawer').isHidden(),true,'the Notebook key does nothing during the demo');
 assert.equal((await lab(page)).hints,0,'the hint key does nothing during the demo');
 await page.locator('#titration-demo-exit').click();
 await assertNormalStepOne(page,'Exit demo');
 assert.deepEqual(await storageKeys(page),keysBefore,'the demo wrote nothing to storage, so the walkthrough seen flag is untouched');
 check('Exit demo returns to a clean normal step 1: no demo controls, no score, no leftovers, storage unchanged');

 // ======== Escape exits from the middle.
 await btn.click();await page.waitForFunction(()=>__titration.guide.demo.state==='running');
 await until(page,()=>__titration.lab.step>=3);
 await page.locator('#titration-viewport').focus();
 await page.keyboard.press('Escape');
 await assertNormalStepOne(page,'Escape');
 check('Escape exits the demo mid-run to a clean normal step 1');

 // The reset is a real lab: it plays normally by hand afterwards.
 await page.locator('#titration-viewport').focus();await page.keyboard.press('g');
 await until(page,()=>__titration.lab.id==='rinse');
 assert.deepEqual(await storageKeys(page),keysBefore);
 await page.context().close();

 // ======== Reduced motion: the demo still plays, and the overlay has no running animation.
 page=await open('?demo',{reducedMotion:'reduce'});
 await until(page,()=>__titration.lab.id==='pipette');
 assert.equal(await page.evaluate(()=>document.querySelector('.ti-overlay').getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0,'no running animations in the overlay');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.ti-task button')).transitionDuration),'0s');
 check('reduced motion: the demo plays and the overlay has no animations or transitions');
 await page.context().close();

 // ======== ?demo starts by itself, runs all ten steps, ends on the report, then Now try it yourself.
 page=await open('?demo');
 const t0=Date.now();
 assert.ok(await demoState(page)==='running','the deep link starts the demo with no click');
 assert.equal(await visible(page,'#titration-demo'),true);
 assert.equal(await visible(page,'#titration-demo-start'),false);
 await until(page,()=>!!__titration.lab.quiz);
 // Pause at the first question to check layout and take pictures.
 await page.waitForTimeout(1500);
 await page.locator('#titration-demo-pause').click();
 assert.ok(await page.locator('.ti-opt').count()>=3,'the question is on the card');
 await layoutAtEverySize(page,'demo-1-quiz');
 await page.locator('#titration-demo-pause').click();
 const stepsSeen=new Set();
 // Pause again at the rough run for pictures.
 await until(page,()=>__titration.lab.id==='rough'&&__titration.lab.phase==='run'&&__titration.bench.excess>-2);
 await page.locator('#titration-demo-pause').click();
 assert.match(await page.locator('#titration-chip').innerText(),/With your hand: open hand, turn the tap/);
 await layoutAtEverySize(page,'demo-2-rough');
 await page.locator('#titration-demo-pause').click();
 await until(page,()=>__titration.guide.demo.state==='done');
 const seconds=(Date.now()-t0)/1000;void stepsSeen;
 const end=await lab(page);
 assert.equal(end.finished,true,'the demo reaches the end of step 10');
 assert.equal(end.calc,true);
 assert.equal(end.quizzes,4,'all four questions were answered');
 await page.locator('#titration-compare').waitFor();await page.locator('#titration-demo-try').waitFor();
 assert.equal(await page.locator('#titration-drawer').isVisible(),true,'it ends on the Notebook report');
 const seen=await page.evaluate(()=>window.__seen);
 assert.equal(seen.picked,true,'the chosen answer was ringed before it was clicked');
 assert.ok(seen.chips.includes('With your hand: pinch and lift'),`the gesture chip taught the first gesture: ${seen.chips[0]}`);
 assert.ok(seen.chips.length>=8,`the chip changed with the moment: ${seen.chips.length} different`);
 assert.ok(seen.chips.some(c=>/keyboard/.test(c))&&seen.chips.some(c=>/mouse/.test(c)));
 const text=seen.lines.join(' ')+' '+seen.doing.join(' ');
 assert.doesNotMatch(text,em,'no dashes in the story');
 assert.match(text,/descaler/);assert.match(text,/about 0\.1 mol\/dm3/);assert.match(text,/unsafe/);
 for(const t of seen.lines)assert.ok(t.length<=95,`short line: ${t}`);
 const found=await page.evaluate(()=>__titration.bench.found),acid=await page.evaluate(()=>__titration.bench.acid);
 const finalLine=await page.locator('#titration-line').innerText();
 assert.ok(finalLine.includes(found.toFixed(3)),`the verdict quotes the computed concentration ${found.toFixed(3)}: ${finalLine}`);
 const within=found>=.095&&found<=.105;
 assert.match(finalLine,within?/within spec/:/too (strong|weak)/);
 assert.ok(Math.abs(found-acid)/acid<.03,`the demo measured ${found} for a true ${acid}`);
 assert.equal(await visible(page,'#titration-demo-try'),true,'Now try it yourself shows at the end');
 assert.match(await page.locator('#titration-demo-try').innerText(),/Now try it yourself/);
 assert.equal(await visible(page,'#titration-demo-exit'),true,'Exit demo stays visible at the end');
 assert.ok(seconds>=45&&seconds<=120,`the demo took ${seconds.toFixed(0)} s on this machine`);
 await page.waitForTimeout(800);
 if(shots)await page.screenshot({path:`${shots}/1280-demo-3-report.png`});
 await layoutAtEverySize(page,'demo-3-report');
 check(`?demo starts itself and plays all ten steps in ${seconds.toFixed(0)} s: four answers ringed then clicked, ${seen.chips.length} gesture chips, ends on the Notebook report: "${finalLine}"`);

 // Now try it yourself.
 await page.locator('#titration-demo-try').click();
 await assertNormalStepOne(page,'Now try it yourself');
 assert.equal(new URL(page.url()).searchParams.has('demo'),false,'?demo is gone from the address so a reload is normal');
 assert.deepEqual((await storageKeys(page)).filter(k=>/tutorial|walkthrough|seen/i.test(k)),[],'no seen flag was written');
 await page.locator('#titration-viewport').focus();await page.keyboard.press('g');
 await until(page,()=>__titration.lab.id==='rinse');
 check('Now try it yourself resets to a clean step 1 in normal mode and the lab plays by hand');
 assert.deepEqual(errors,[]);
 console.log('Titration demo browser passed:',checks.length,'checks.');
}catch(e){
 console.log('Done so far:',checks.length);console.log(await page?.evaluate(()=>{const l=__titration.lab;return JSON.stringify({demo:__titration.guide.demo.state,id:l.id,phase:l.phase,quiz:!!l.quiz,line:document.querySelector('#titration-line').textContent});}).catch(()=>null));console.error(e);process.exitCode=1;
}finally{await browser.close();}
