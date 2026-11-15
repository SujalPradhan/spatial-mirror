// Run with tsx against a dev server: STUDIO_URL=http://localhost:4466 SHOTS=<dir> npx tsx tests/titration-browser.mjs
// Part 1 drives the guided lab with injected hand landmarks that go through the real gesture tracker (synthetic, no camera).
// Part 2 runs the whole practical from the mouse and keyboard only, start to report.
// Part 3 walks every step at 390x844 by the Skip button.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {posedHand} from './hand-fixtures.ts';
import {props} from '../src/titration/props.ts';
const base=process.env.STUDIO_URL||'http://localhost:4466',shots=process.env.SHOTS;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],checks=[];
const check=m=>{checks.push(m);console.log('ok',m);};
const home=id=>props.find(p=>p.id===id).home;
const roundTo=v=>Math.round(v*20)/20;
const em=/—/;

async function open(width,height,seed=21){
 const context=await browser.newContext({viewport:{width,height},acceptDownloads:true,hasTouch:width<500}),page=await context.newPage();
 page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));
 assert.equal((await page.goto(`${base}/titration?seed=${seed}`)).status(),200);
 await page.waitForFunction(()=>window.__titration?.ready&&window.__titration.owns,null,{timeout:60000});
 return page;
}
const until=(page,fn,arg,opts)=>page.waitForFunction(fn,arg,{polling:'raf',timeout:90000,...opts});
const st=page=>page.evaluate(()=>{const l=__titration.lab;return {id:l.id,phase:l.phase,step:l.step,level:l.level,quiz:!!l.quiz,fill:l.pipetteFill,drops:l.drops,finished:l.finished,line:l.line,reading:l.bench.reading,tap:l.bench.tap};});
async function shoot(page,name){if(!shots)return;await page.waitForTimeout(900);await page.screenshot({path:`${shots}/${name}.png`});}
const bar=page=>page.locator('#titration-gestures li').evaluateAll(l=>l.map(e=>e.textContent.replace(/^[^A-Za-z]+/,'').trim()));
const answerQuiz=async(page,{missFirst=false}={})=>{
 await page.waitForSelector('.ti-q');
 const [right,count]=await page.evaluate(()=>[__titration.lab.quiz.q.answer,__titration.lab.quiz.q.options.length]);
 if(missFirst){
  const wrong=right===0?1:0;await page.locator(`.ti-opt[data-o="${wrong}"]`).click();
  assert.match(await page.locator('.ti-feedback').innerText(),/Not quite/,'a wrong answer says why');
  assert.equal(await page.locator('.ti-opt[data-state=wrong]').count(),1);
 }
 await page.locator(`.ti-opt[data-o="${right}"]`).click();
 assert.equal(await page.locator('.ti-opt[data-state=right]').count(),1);
 await page.locator('#titration-primary').click();void count;
};

/** World position to page pixels, using the camera as it is now. */
async function posOf(page,w){
 const [s,box]=await Promise.all([page.evaluate(p=>__titration.view.screenOf({x:p.x,y:p.y,z:0}),w),page.locator('#titration-viewport').boundingBox()]);
 return {x:box.x+s.x,y:box.y+s.y,box};
}
async function camSettled(page){
 let last='';for(let i=0;i<40;i++){const p=await posOf(page,{x:0,y:0});const k=`${Math.round(p.x)},${Math.round(p.y)}`;if(k===last)return;last=k;await page.waitForTimeout(250);}
}
async function press(page,w){await camSettled(page);const p=await posOf(page,w);await page.mouse.move(p.x,p.y);await page.mouse.down();}
async function dragTo(page,w,steps=14){const p=await posOf(page,w);await page.mouse.move(p.x,p.y,{steps});}

// ---- Hands: landmarks placed so a chosen point lands on a world position.
async function hand(page,pose,w,deg=0){
 const p=await posOf(page,w),box=p.box,aspect=box.width/box.height,mx=(p.x-box.x)/box.width,my=(p.y-box.y)/box.height;
 const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a),r=posedHand(pose).map(q=>({x:q.x*c-q.y*s,y:q.x*s+q.y*c,z:q.z}));
 const ids=pose==='pinch'||pose==='open'?[4,8]:[0,5,9,13,17],ref={x:ids.reduce((t,i)=>t+r[i].x,0)/ids.length,y:ids.reduce((t,i)=>t+r[i].y,0)/ids.length};
 return r.map(q=>({x:1-mx+(q.x-ref.x)*.14,y:my+(q.y-ref.y)*.14*aspect,z:q.z*.14}));
}
const feed=(page,list)=>page.evaluate(l=>{window.handList=l;if(!window.handTimer)window.handTimer=setInterval(()=>__titration.hands(window.handList),33);},list);
const quiet=async page=>{await page.evaluate(()=>{clearInterval(window.handTimer);window.handTimer=0;});await page.waitForFunction(()=>__titration.frame.hands.length===0);};
let cur={x:0,y:0},curDeg=0;
/** A wrist turns over a fraction of a second, not in one frame. */
async function pose(page,name,w,deg=0){
 const from=curDeg,n=Math.ceil(Math.abs(deg-from)/10);
 for(let i=1;i<n;i++){await feed(page,[await hand(page,name,w,from+(deg-from)*i/n)]);await page.waitForTimeout(40);}
 cur=w;curDeg=deg;await feed(page,[await hand(page,name,w,deg)]);
}
/** A hand moves in small steps, as a real one does; a jump across the frame would be a new hand to the tracker. */
async function carry(page,pts,name='pinch',deg=0){for(const w of pts){const from=cur;for(let i=1;i<=10;i++){await pose(page,name,{x:from.x+(w.x-from.x)*i/10,y:from.y+(w.y-from.y)*i/10},deg);await page.waitForTimeout(40);}}}

let page=null;
try{
 // ======== Part 1: hands.
 page=await open(1280,800);
 assert.equal(await page.title(),'Titration bench - Spatial Studio');
 assert.equal(await page.locator('.workspace-nav [aria-current=page]').innerText(),'Titration');
 // At load: only the task card, guide bubble, progress strip and the corner buttons.
 const loose=await page.evaluate(()=>[...document.querySelectorAll('button,input,select,a,summary,[tabindex]')].filter(e=>e.offsetParent!==null&&!e.closest('.mirror-corner,.mirror-gestures,.workspace-nav,.mirror-enter,.hosted-preview,#titration-viewport')&&e.id!=='titration-viewport').map(e=>e.id||e.textContent.trim()));
 assert.ok(loose.length<=3,`few controls at load: ${loose}`);
 assert.deepEqual(await page.locator('.ti-task, .ti-guide, .ti-dots').evaluateAll(l=>l.map(e=>e.className)).then(a=>a.length),3);
 assert.equal(await page.locator('#titration-drawer').isHidden(),true,'the notebook is closed');
 assert.equal(await page.locator('.mirror-actions').isHidden(),true,'the actions list is closed');
 check(`at load only the task card, guide bubble, progress strip and corner buttons: ${loose.join(', ')} are the only other controls`);
 assert.match(await page.locator('#titration-step').innerText(),/Step 1 of 10 · Put on your goggles/);
 assert.deepEqual(await bar(page),['Pinch and lift','Next']);
 await page.locator('#titration-next').click();await page.waitForTimeout(300);
 assert.deepEqual(await bar(page),['Pinch and lift'],'the bar shows only this step\'s gesture');
 const lit=()=>page.evaluate(()=>__titration.engine.scene.props.filter(p=>p.glow>0).map(p=>p.id));
 assert.deepEqual(await lit(),['goggles']);
 assert.deepEqual(await page.evaluate(()=>__titration.engine.scene.props.map(p=>p.id)),['goggles'],'only the goggles are out');
 check('the bar shows the current step\'s gestures only, and only the goggles are lit');
 await shoot(page,'1280-01-safety');

 // Step 1: pinch the goggles and lift them.
 await camSettled(page);await pose(page,'pinch',home('goggles'));await page.waitForFunction(()=>__titration.engine.held.length===1);
 await carry(page,[{x:-4.1,y:-1},{x:-4.1,y:2},{x:-4.1,y:4},{x:-4.1,y:5.4}]);
 await until(page,()=>__titration.lab.id==='rinse');
 assert.equal(await page.evaluate(()=>__titration.bench.goggles),true);
 check('hands: pinch the goggles and lift them to the top of the frame, step 2 begins');
 await pose(page,'open',{x:0,y:3});await page.waitForTimeout(400);

 // Step 2: pick the bottle, take it over the funnel, tilt to pour, then turn the tap to drain.
 await shoot(page,'1280-02-rinse');
 assert.deepEqual(await lit(),['bottle']);
 await camSettled(page);await pose(page,'pinch',home('bottle'));await page.waitForFunction(()=>__titration.engine.held[0]?.id==='bottle');
 await carry(page,[{x:2.5,y:0},{x:1,y:4},{x:.4,y:7.2}]);
 await pose(page,'pinch',{x:.4,y:7.2},0);await page.waitForTimeout(300);
 const level0=(await st(page)).level;await page.waitForTimeout(500);assert.equal((await st(page)).level,level0,'a level bottle over the funnel pours nothing');
 await pose(page,'pinch',{x:.4,y:7.2},70);
 await until(page,()=>__titration.lab.phase==="drain",null,{timeout:12000});
 assert.equal(await page.evaluate(()=>__titration.engine.held.length),0,'the bottle goes back once enough has been poured');
 check('hands: pinch the bottle, carry it over the funnel, tilt the wrist to pour; level does not pour');
 await shoot(page,'1280-02b-drain');
 await camSettled(page);await pose(page,'open',{x:0,y:1},0);await page.waitForTimeout(500);
 assert.ok((await st(page)).tap<.05,'a level open hand keeps the tap shut');
 await pose(page,'open',{x:0,y:1},70);
 await until(page,()=>__titration.lab.id==='fill');
 check('hands: an open hand turned 70 degrees opens the tap and drains the rinse');
 await pose(page,'open',{x:0,y:1},0);await page.waitForTimeout(400);

 // Step 3: pour to just below zero, easing the tilt back to slow down.
 await camSettled(page);await pose(page,'pinch',home('bottle'),0);await page.waitForFunction(()=>__titration.engine.held[0]?.id==='bottle');
 await carry(page,[{x:2.5,y:0},{x:1,y:4},{x:.4,y:7.2}]);
 await pose(page,'pinch',{x:.4,y:7.2},70);
 await until(page,()=>__titration.lab.level<3.5);
 await pose(page,'pinch',{x:.4,y:7.2},28);
 await until(page,()=>__titration.lab.level<.9||__titration.lab.level<0);
 await pose(page,'pinch',{x:.4,y:7.2},0);await page.waitForTimeout(500);
 await pose(page,'open',{x:.4,y:7.2},0);
 await page.waitForFunction(()=>__titration.lab.id!=='fill'||__titration.lab.phase==='drain');
 let s=await st(page);
 if(s.id==='fill'){ // overfilled: the guide explains and the tap brings it back
  assert.match(s.line,/zero mark/);
  await pose(page,'open',{x:0,y:1},28);await until(page,()=>__titration.lab.id!=='fill');await pose(page,'open',{x:0,y:1},0);await page.waitForTimeout(300);
 }
 s=await st(page);assert.equal(s.id,'bubble');assert.ok(s.reading>=0&&s.reading<=1,`filled to ${s.reading}`);
 check(`hands: tilt less to slow the pour; filled to a reading of ${s.reading.toFixed(2)}`);

 // Step 4: a short burst of the tap.
 await shoot(page,'1280-04-bubble');
 await camSettled(page);await pose(page,'open',{x:0,y:1},70);await until(page,()=>__titration.lab.id==='pipette');
 assert.equal(await page.evaluate(()=>__titration.bench.bubble),false);
 await quiet(page);assert.equal((await st(page)).tap,0,'taking the hand away shuts the tap');
 check('hands: a short open-hand turn clears the air from the tip; hand away closes the tap');

 // Step 5 by key, step 6 by hands: pinch a dropper, release over the flask, once per drop.
 await page.locator('#titration-viewport').focus();await page.keyboard.press('p');
 await until(page,()=>__titration.lab.id==='indicator');await shoot(page,'1280-06-indicator');
 assert.equal((await lit()).length,3,'the three droppers are lit and nothing else');
 await camSettled(page);await pose(page,'pinch',home('dropper-phenolphthalein'));await page.waitForFunction(()=>__titration.engine.held[0]?.id==='dropper-phenolphthalein');
 await carry(page,[{x:-3,y:-1}]);await carry(page,[{x:-1,y:1},{x:0,y:1.8}]);
 await pose(page,'open',{x:0,y:1.8});await until(page,()=>__titration.lab.drops===1);
 assert.equal(await page.evaluate(()=>__titration.bench.indicator),'phenolphthalein');
 await page.waitForTimeout(500);
 await pose(page,'pinch',{x:0,y:1.8});await page.waitForFunction(()=>__titration.engine.held.length===1);
 await pose(page,'open',{x:0,y:1.8});await until(page,()=>!!__titration.lab.quiz);
 check('hands: pinch a dropper, release over the flask: each release is one drop, two drops raise the question');
 await quiet(page);
 await shoot(page,'1280-06b-quiz');
 await answerQuiz(page,{missFirst:true});
 assert.equal((await st(page)).id,'initial');

 // Step 7 and the rough run: tap and swirl by hand.
 await page.waitForTimeout(600);await shoot(page,'1280-07-read');
 await page.locator('#titration-reading').fill(String(roundTo(await page.evaluate(()=>__titration.bench.reading))));await page.locator('#titration-primary').click();
 await until(page,()=>__titration.lab.id==='rough'&&__titration.lab.phase==='run');
 await shoot(page,'1280-08-rough');
 await camSettled(page);await pose(page,'open',{x:0,y:0},0);await page.waitForFunction(()=>__titration.frame.hands[0]?.pose==='open');
 await page.waitForTimeout(700);assert.ok((await st(page)).tap<.01,'a level hand keeps the tap shut');
 await pose(page,'open',{x:0,y:0},20);await page.waitForTimeout(700);
 const small=(await st(page)).tap;assert.ok(small>0&&small<.2,`a small turn drips: ${small}`);
 await pose(page,'open',{x:0,y:0},-20);await page.waitForTimeout(500);assert.ok((await st(page)).tap>0,'either direction works');
 await pose(page,'open',{x:0,y:0},70);await page.waitForTimeout(700);
 const big=(await st(page)).tap;assert.ok(big>.9,`a big turn runs a stream: ${big}`);
 const r0=(await st(page)).reading;await page.waitForTimeout(600);assert.ok((await st(page)).reading>r0+.3,'the stream delivers titrant');
 await quiet(page);assert.equal((await st(page)).tap,0,'hand away closes the tap');
 check('hands: tap open and close: level shuts, 20 degrees drips either way, 70 degrees streams, hand away shuts');
 // Swirl: a fist going round, in the flask.
 const aspect=1280/(await page.locator('#titration-viewport').boundingBox()).height;void aspect;
 const circle=await Promise.all(Array.from({length:40},async(_,i)=>[await hand(page,'fist',{x:Math.cos(i/20*Math.PI*4)*.7,y:-1.9+Math.sin(i/20*Math.PI*4)*.7+.2},0)]));
 await page.evaluate(pts=>{clearInterval(window.handTimer);let i=0;window.handTimer=setInterval(()=>{__titration.hands(pts[i++%pts.length]);},33);},circle);
 await page.waitForFunction(()=>__titration.engine.swirlLevel>.5);
 await shoot(page,'1280-08b-swirl');
 await page.evaluate(()=>{clearInterval(window.handTimer);window.handTimer=0;});await pose(page,'fist',{x:0,y:-1.9});await page.waitForFunction(()=>__titration.engine.swirlLevel===0);await quiet(page);
 check('hands: a fist going round swirls (above 0.5), a still fist does not');
 assert.deepEqual(errors,[]);
 await page.context().close();

 // ======== Part 2: the whole practical from the mouse and keyboard.
 page=await open(1280,800);
 const logStep=n=>console.log('  mouse run:',n);
 await shoot(page,'m-01');
 await page.locator('#titration-next').click();
 // 1 goggles
 await press(page,home('goggles'));await dragTo(page,{x:-4.1,y:2});await dragTo(page,{x:-4.1,y:5.5});
 await until(page,()=>__titration.lab.id==='rinse');await page.mouse.up();logStep('goggles');
 // 2 rinse: hold the bottle over the funnel, then drag the blue tap key.
 await press(page,home('bottle'));await dragTo(page,{x:1,y:4});await dragTo(page,{x:.4,y:7.2});
 await until(page,()=>__titration.lab.phase==='drain');await page.mouse.up();
 await press(page,{x:0,y:1.2});await dragTo(page,{x:2.4,y:1.2},6);
 await until(page,()=>__titration.lab.id==='fill');await page.mouse.up();logStep('rinse');
 assert.equal((await st(page)).tap,0,'letting go of the tap key shuts it');
 // 3 fill: hold until the level is near zero; an overfill is explained and drained.
 for(let tries=0;tries<6&&(await st(page)).id==='fill';tries++){
  if((await st(page)).phase==='pour'){
   await press(page,home('bottle'));await dragTo(page,{x:1,y:4});await dragTo(page,{x:.4,y:7.2});
   await until(page,()=>__titration.lab.level<.9||__titration.lab.phase!=='pour'||__titration.lab.id!=='fill');await page.mouse.up();await page.waitForTimeout(300);
  }
  if((await st(page)).id==='fill'&&(await st(page)).phase==='drain'){
   assert.match((await st(page)).line,/zero mark/,'overfilling says why');
   await press(page,{x:0,y:1.2});await dragTo(page,{x:.5,y:1.2},4);await until(page,()=>__titration.lab.id!=='fill'||__titration.lab.phase==='pour');await page.mouse.up();
  }
 }
 assert.equal((await st(page)).id,'bubble');logStep('fill');
 // 4 clear the tip
 await press(page,{x:0,y:1.2});await dragTo(page,{x:1.4,y:1.2},4);await until(page,()=>__titration.lab.id==='pipette');await page.mouse.up();logStep('bubble');
 // 5 pipette: lower the tip into the acid, wait, carry to the flask, let go.
 await press(page,home('pipette'));await dragTo(page,{x:3.5,y:1});await dragTo(page,{x:2.7,y:-.7});
 await until(page,()=>__titration.lab.pipetteFill>=1);
 await dragTo(page,{x:1,y:2.3});await dragTo(page,{x:0,y:2.3});await page.mouse.up();
 await until(page,()=>__titration.lab.id==='indicator');logStep('pipette');
 // 6 indicator
 await press(page,home('dropper-phenolphthalein'));await dragTo(page,{x:-2,y:0});await dragTo(page,{x:0,y:1.8});await page.mouse.up();
 await until(page,()=>__titration.lab.drops===1);
 await press(page,{x:0,y:1.8});await page.mouse.up();await until(page,()=>!!__titration.lab.quiz);logStep('indicator');
 await answerQuiz(page,{missFirst:true});
 // 7 read the start: a wrong reading is explained, then the right one is set with the stepper.
 await page.waitForSelector('#titration-reading');
 const truth=()=>page.evaluate(()=>Math.round(__titration.bench.reading*20)/20);
 await page.locator('#titration-reading').fill(String((await truth())+.3));await page.locator('#titration-primary').click();
 assert.match(await page.locator('#titration-line').innerText(),/high/);
 const start=await truth(),shown=Number(await page.locator('#titration-reading').inputValue());
 await page.locator('[data-d="1"]').click();await page.locator('[data-d="-1"]').click();await page.locator('[data-d=".05"]').click();await page.locator('[data-d="-.05"]').click();
 assert.equal(Number(await page.locator('#titration-reading').inputValue()),shown,'the stepper steps by 1 and by 0.05');
 await page.locator('#titration-reading').fill(start.toFixed(2));await page.locator('#titration-primary').click();
 await until(page,()=>__titration.lab.id==='rough');logStep('read start');
 // 8 and 9: titrations by the tap key, the flask and the keyboard.
 const record=async()=>{await page.locator('#titration-reading').fill((await truth()).toFixed(2));await page.locator('#titration-primary').click();};
 async function titrate(){
  await press(page,{x:0,y:1.2});await dragTo(page,{x:2.4,y:1.2},6);
  await until(page,()=>__titration.bench.excess>-1.2);await page.mouse.up();
  assert.equal((await st(page)).tap,0);
  const flask=await posOf(page,{x:0,y:-1.9});await page.mouse.move(flask.x+40,flask.y);await page.mouse.down();
  for(let i=0;i<24;i++){const a=i/8*Math.PI*2;await page.mouse.move(flask.x+Math.cos(a)*40,flask.y+Math.sin(a)*40);await page.waitForTimeout(30);}
  const swirled=await page.evaluate(()=>__titration.engine.swirlLevel);await page.mouse.up();
  await page.locator('#titration-viewport').focus();
  for(let i=0;i<80;i++){
   if(await page.evaluate(()=>__titration.bench.tint.alpha>.12))break;
   await page.keyboard.press('d');await page.keyboard.press('s');await page.waitForTimeout(450);
  }
  await page.locator('#titration-primary').click();
  return swirled;
 }
 let swirlSeen=0;
 swirlSeen=await titrate();assert.ok(swirlSeen>.3,`the mouse can swirl: ${swirlSeen}`);
 await shoot(page,'m-08-final');
 await page.waitForSelector('#titration-reading');await record();
 await page.waitForSelector('.ti-q');await shoot(page,'m-quiz2');await answerQuiz(page);
 logStep('rough');
 for(let run=0;run<4&&(await st(page)).id==='accurate'&&!(await st(page)).quiz;run++){
  await page.waitForSelector('#titration-reading');await record();
  await until(page,()=>__titration.lab.phase==='run');
  await titrate();await page.waitForSelector('#titration-reading');await record();
  await page.waitForTimeout(300);
 }
 await page.waitForSelector('.ti-q');await answerQuiz(page);logStep('accurate');
 assert.equal((await st(page)).id,'calc');
 const mean=await page.evaluate(()=>__titration.bench.mean);assert.ok(mean!==null);
 // 10 the sums, one at a time.
 const want=await page.evaluate(()=>__titration.bench.expectedCalc);
 const sum=async value=>{await page.locator('#titration-calc-input').fill(String(value));await page.locator('#titration-primary').click();await page.waitForTimeout(150);};
 await sum(want.nBase*1000);assert.match(await page.locator('#titration-line').innerText(),/1000 times too big/);
 await page.locator('#titration-calc-input').fill(want.nBase.toExponential(3));await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__titration.lab.phase==='nAcid');
 await page.locator('#titration-calc-input').fill(String(want.nAcid));await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__titration.lab.phase==='conc');
 await page.locator('#titration-calc-input').fill(want.conc.toFixed(4));await page.keyboard.press('Enter');
 await page.waitForSelector('.ti-q');await answerQuiz(page);
 await page.waitForSelector('#titration-compare');
 const compare=await page.locator('#titration-compare').innerText();
 assert.match(compare,/True value \d\.\d{4} mol\/dm3/);assert.match(compare,/Error [+-]\d+\.\d%/);
 await shoot(page,'m-10-report');
 const report=await page.evaluate(()=>__titration.bench.report());
 assert.equal(report.quiz,Math.round((8+10*3)/40*20),'a miss then a hit scores 8, the others 10 first time');
 assert.ok(report.wrongReadings>=1,'the wrong first reading is counted');
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#titration-download').click()]);
 const html=await readFile(await download.path(),'utf8');assert.match(html,/Titration report/);assert.doesNotMatch(html,em);
 check(`mouse and keyboard only: goggles to report, score ${report.total}/100, ${compare.replace(/\n/g,' ').slice(0,90)}`);
 assert.equal(await page.evaluate(()=>__titration.lab.finished),true);

 // ---- Accessibility on the finished page.
 await page.locator('#titration-drawer-close').click();
 assert.ok(!em.test(await page.locator('.ti-overlay').innerText()),'no em dashes in the copy');
 const live=await page.evaluate(()=>__titration.live);assert.ok(live.length>0);
 await page.locator('#titration-restart').evaluate(b=>b.click()).catch(()=>{});
 await page.evaluate(()=>__titration.guide.setDrawer(false));
 const bad=await page.evaluate(()=>{
  const parse=c=>{const m=c.match(/[\d.]+/g).map(Number);return {r:m[0],g:m[1],b:m[2],a:m[3]??1};};
  const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
  const over=(top,bottom)=>({r:top.r*top.a+bottom.r*(1-top.a),g:top.g*top.a+bottom.g*(1-top.a),b:top.b*top.a+bottom.b*(1-top.a),a:1});
  const background=el=>{const layers=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);if(c.a>0)layers.push(c);if(c.a>=1)break;}let out={r:10,g:17,b:25,a:1};for(const c of layers.reverse())out=over(c,out);return out;};
  const out=[];
  for(const el of document.querySelectorAll('.ti-task button:not(:disabled),.ti-task p,.ti-task b,.ti-task legend,.ti-task label,.ti-guide p,.ti-guide button,.ti-drawer p,.ti-drawer li,.ti-drawer h2,.ti-drawer h3,.ti-drawer td,.ti-drawer th,.ti-drawer button:not(:disabled)')){
   if(el.offsetParent===null||!el.textContent.trim())continue;
   const fg=parse(getComputedStyle(el).color),bg=background(el),f=over(fg,bg),a=lum(f),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   if(ratio<4.5)out.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0,24)}" ${ratio.toFixed(2)}`);
  }
  return out;
 });
 assert.deepEqual(bad,[],'text contrast at least 4.5:1');
 const tiny=await page.evaluate(()=>[...document.querySelectorAll('.ti-overlay button,.ti-overlay input,.mirror-corner button')].filter(e=>e.offsetParent!==null).map(e=>{const r=e.getBoundingClientRect();return {n:(e.id||e.textContent).slice(0,20),w:r.width,h:r.height};}).filter(t=>t.w<24||t.h<24));
 assert.deepEqual(tiny,[],'every target at least 24px');
 await page.locator('#titration-viewport').focus();await page.keyboard.press('Tab');assert.match(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),/solid|auto/);
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300);
 check('contrast at least 4.5:1, targets at least 24px, focus outline visible, reduced motion accepted');
 await page.locator('#titration-tutorial-replay').click();await page.waitForFunction(()=>__titration.tutorial?.total===4);
 check('the tutorial lists the 4 gestures this page uses');
 assert.deepEqual(errors,[]);
 await page.context().close();

 // ======== Part 3: phone width, every step, by the Skip button.
 const phone=await open(390,844);
 await shoot(phone,'390-01-safety');
 await phone.locator('#titration-next').click();
 const names=['01-safety','02-rinse','03-fill','04-bubble','05-pipette','06-indicator','07-read','08-rough','09-accurate','10-calc'];
 for(let i=0;i<names.length;i++){
  if(i>0)await shoot(phone,`390-${names[i]}`);
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`no horizontal scroll at step ${i+1}`);
  const rects=await phone.evaluate(()=>['#titration-task','#titration-guide'].map(s=>{const e=document.querySelector(s);if(e.hidden)return null;const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom};}));
  for(const r of rects)if(r)assert.ok(r.l>=0&&r.r<=390,'cards stay inside the width');
  await phone.locator('#titration-skip').click();
  if(await phone.evaluate(()=>!!__titration.lab.quiz)){await shoot(phone,`390-${names[i]}-quiz`);await phone.locator('#titration-skip').click();}
 }
 await phone.waitForFunction(()=>__titration.lab.finished);await shoot(phone,'390-11-done');
 if(await phone.locator('#titration-drawer').isHidden())await phone.locator('#titration-notebook').click();await shoot(phone,'390-12-notebook');
 assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 check('phone width 390x844: every step by Skip, no horizontal scroll, cards inside the width');
 assert.deepEqual(errors,[]);
 console.log('Titration browser passed:',checks.length,'checks.');
}catch(e){
 console.log('Done so far:',checks.length);console.log(await page?.evaluate(()=>{const t=__titration,l=t.lab;return JSON.stringify({id:l.id,phase:l.phase,level:l.level,held:t.engine.held,pour:t.engine.scene?.pour,hands:t.frame.hands.map(h=>h.pose),line:l.line,reading:l.bench.reading,lm:t.frame.hands[0]?.landmarks.filter((_,i)=>[0,5,9,17].includes(i)).map(q=>[q.x.toFixed(3),q.y.toFixed(3)])});}).catch(()=>null));console.error(e);process.exitCode=1;
}finally{await browser.close();}
