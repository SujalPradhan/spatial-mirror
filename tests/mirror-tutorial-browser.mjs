import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4174';
const shots=process.env.SHOTS||'/tmp/mirror-tutorial-checks';
const gpu=process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...gpu]});
const surfaces=[['atp','__atpStudio'],['perfume','__perfumeStudio'],['machine','__machineStudio'],['drivetrain','__drivetrain'],['organ','__organ'],['grasp','__grasp']];
const fixture=pose=>posedHand(pose).map(p=>({x:.5+p.x*.12,y:.75+p.y*.12*16/9,z:p.z*.12}));
await mkdir(shots,{recursive:true});
try{
 for(const [id,debug] of surfaces){
  const native=id==='organ'||id==='grasp',errors=[];
  const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage();
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  let modelStubs=0;
  await page.route('**/hand-worker.js?*',route=>{modelStubs++;return route.fulfill({contentType:'text/javascript',body:"self.onmessage=({data})=>{if(data.type==='init')self.postMessage({type:'ready',delegate:'synthetic-test-stub'});if(data.type==='frame')data.bitmap.close();};"});});
  const current=()=>page.evaluate(key=>window[key].tutorial,debug);
  const index=async n=>page.waitForFunction(([key,n])=>window[key].tutorial?.index===n,[debug,n]);
  const feed=pose=>page.evaluate(([key,hands])=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>window[key].hands(hands),20);},[debug,pose?[fixture(pose)]:[]]);
  const quiet=async()=>{await page.evaluate(()=>clearInterval(window.testFeed));await page.waitForFunction(key=>window[key].frame.hands.length===0,debug);};
  const bounds=()=>page.evaluate(()=>Object.fromEntries(['.workspace-nav','.mirror-stage','.mirror-viewport','.mirror-mark','.mirror-gestures','.mirror-corner'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [selector,[r.x,r.y,r.width,r.height]];})));
  const arrows=key=>page.evaluate(key=>{const e=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented;},key);
  try{
   await page.goto(`${base}/${id}`);await page.waitForFunction(key=>window[key]?.ready&&window[key].owns,debug);
   const card=page.locator(`#${id}-tutorial`),replay=page.locator(`#${id}-tutorial-replay`),next=page.locator(`#${id}-tutorial-next`),previous=page.locator(`#${id}-tutorial-previous`);
   assert.equal(await card.isVisible(),false);assert.equal(await current(),null);
   assert.equal(await arrows('ArrowRight'),false,'inactive tutorial does not consume arrows');
   const guide=await page.locator('.mirror-gestures li').allTextContents();assert.equal(guide.length,11);
   await page.locator(`#${id}-camera`).click();await page.locator(`#${id}-stage.is-live`).waitFor();
   if(native){assert.equal(await current(),null);assert.equal(await card.isVisible(),false);}
   else{await index(0);assert.equal((await current()).total,3);assert.equal(await card.isVisible(),true);}
   await page.waitForFunction(()=>document.querySelector('video').readyState>=2);assert.ok(modelStubs>0,'synthetic camera uses a stub worker, not the real model');
   await page.locator(`#${id}-camera`).click();assert.equal(await card.isVisible(),false);
   if(native){
    if(id==='grasp'){
     assert.equal(await replay.textContent(),'Calibrate');await replay.click();assert.equal(await page.evaluate(()=>window.__grasp.engine.calibrationPhase),'flat');
     await feed('open');await page.waitForFunction(()=>window.__grasp.engine.calibrationPhase==='fist');await quiet();
     assert.equal(await current(),null);assert.equal(await card.isVisible(),false);
     assert.ok(await page.locator('#grasp-next').isVisible(),'object-specific next remains available');
    }else{
     assert.equal(await replay.isVisible(),false);await page.evaluate(()=>document.querySelector('#organ-tutorial-replay').click());
     assert.equal(await current(),null);assert.equal(await card.isVisible(),false);assert.ok(await page.locator('.organ-chapters').isVisible());
    }
    assert.equal(await arrows('ArrowRight'),false,'native interactions do not acquire tutorial arrows');
   }else{
    const before=await bounds();await replay.click();await index(0);assert.deepEqual(await bounds(),before,'tutorial card does not move any shared layout');
    assert.equal(await previous.isDisabled(),true);assert.equal(await previous.getAttribute('aria-label'),'Previous tutorial step');
    assert.match(await card.innerText(),/Hold the pose or use the buttons/);
    await page.screenshot({path:`${shots}/${id}-desktop.png`});
    await next.click();await index(1);assert.ok(guide[1].endsWith((await current()).step.label),'object-specific core label matches its guide');
    await next.click();await index(2);assert.equal(await next.textContent(),'Finish');assert.equal(await next.getAttribute('aria-label'),'Finish tutorial');
    await next.click();assert.equal((await current()).done,true);assert.equal(await next.isDisabled(),true);
    await previous.click();await index(2);assert.equal((await current()).progress,0);
    assert.equal(await arrows('ArrowLeft'),true);await index(1);assert.equal(await arrows('ArrowRight'),true);await index(2);
    await page.evaluate(()=>{for(const tag of ['input','textarea','select','div']){const el=document.createElement(tag);el.id=`test-edit-${tag}`;if(tag==='div'){el.contentEditable='true';el.innerHTML='<span>Editable</span>';}document.querySelector('.mirror-stage').append(el);}});
    for(const tag of ['input','textarea','select','div']){
     const consumed=await page.evaluate(tag=>{const el=document.querySelector(`#test-edit-${tag}`);el.focus();const target=tag==='div'?el.firstElementChild:el;const e=new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true});target.dispatchEvent(e);return e.defaultPrevented;},tag);
     assert.equal(consumed,false,`${tag} retains its arrows`);assert.equal((await current()).index,2);
    }
    await page.evaluate(()=>document.querySelectorAll('[id^="test-edit-"]').forEach(el=>el.remove()));
    await page.locator(`#${id}-sources`).click();assert.equal(await arrows('ArrowLeft'),false);assert.equal((await current()).index,2);await page.locator(`#${id}-about-close`).click();
    await previous.click();await previous.click();await index(0);
    await feed('open');await page.waitForTimeout(1000);assert.equal((await current()).index,0,'wrong injected pose cannot advance');
    await next.click();await index(1);await page.waitForTimeout(1000);assert.equal((await current()).index,1,'held input cannot pass the manually selected step');assert.equal((await current()).progress,0);assert.equal((await current()).needsRelease,true);assert.match(await card.innerText(),/Release the pose/);
    await quiet();await feed('open');await index(2);
    await previous.click();await page.waitForTimeout(1000);assert.equal((await current()).index,1,'backwards also requires release');
    await quiet();await feed('pinch');await page.waitForTimeout(800);assert.equal((await current()).index,1,'wrong pose after loss cannot pass');await quiet();
    await feed('open');await index(2);await quiet();await feed('pinch');await index(3);assert.equal((await current()).done,true);await quiet();
    await page.waitForFunction(id=>document.querySelector(`#${id}-tutorial`).hidden,id);
    assert.equal(await page.evaluate(()=>localStorage.getItem('mirror-tutorial-v1')),'1');
    assert.equal(await arrows('ArrowLeft'),false);assert.deepEqual(await page.locator('.mirror-gestures li').allTextContents(),guide,'advanced mappings remain unchanged');
    await replay.click();await index(0);await page.setViewportSize({width:390,height:844});
    const mobileBefore=await bounds();await page.locator(`#${id}-tutorial-skip`).click();assert.deepEqual(await bounds(),mobileBefore);
    await replay.click();await index(0);const r=await card.boundingBox();assert.ok(r.x>=0&&r.x+r.width<=390,'tutorial fits a narrow viewport');await page.screenshot({path:`${shots}/${id}-mobile.png`});
    await page.locator(`#${id}-tutorial-skip`).click();assert.equal(await card.isVisible(),false);
    await page.setViewportSize({width:1280,height:800});await page.reload();await page.waitForFunction(key=>window[key]?.ready&&window[key].owns,debug);await page.locator(`#${id}-camera`).click();await page.locator(`#${id}-stage.is-live`).waitFor();assert.equal(await card.isVisible(),false,'seen tutorial stays hidden on camera restart');
    await page.locator(`#${id}-camera`).click();
   }
   if(native){await page.screenshot({path:`${shots}/${id}-desktop.png`});await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${shots}/${id}-mobile.png`});}
   assert.deepEqual(errors,[],id);console.log(`${id}: ${native?'native guided interactions preserved':'three core poses, manual/keyboard navigation, release gates, tracking loss, replay/skip, unchanged layout'}; desktop/mobile screenshots saved.`);
  }finally{await context.close();}
 }
 console.log(`Tutorial checks passed on all six shared mirror surfaces. Camera streams are synthetic; model worker is stubbed; gesture landmarks are injected synthetic fixtures. No physical camera or real model check. Screenshots: ${shots}`);
}finally{await browser.close();}
