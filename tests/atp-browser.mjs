import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.STUDIO_URL||'http://localhost:4174';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 for(const route of ['/atp','/atp/']){
  assert.equal((await page.goto(base+route)).status(),200);await page.waitForFunction(()=>window.__atpStudio?.ready&&window.__atpStudio.owns);
  assert.equal(await page.locator('#atp-loading').isVisible(),false);
  assert.equal(await page.locator('.workspace-nav [aria-current=page]').innerText(),'ATP synthase');
 }
 const initial=await page.evaluate(()=>window.__atpStudio.state);
 await page.locator('#atp-tool-rotor').click();assert.equal(await page.evaluate(()=>window.__atpStudio.state.representation),'mechanism');
 await page.locator('[data-phase="240"]').click();assert.equal(await page.evaluate(()=>window.__atpStudio.state.phase),240);
 assert.match(await page.locator('#atp-sites').innerText(),/Tight/);
 const phase=await page.evaluate(()=>window.__atpStudio.state.phase);
 await page.locator('#atp-tool-view').click();const r=await page.locator('#atp-viewport').boundingBox();
 await page.mouse.move(r.x+r.width*.55,r.y+r.height*.3);await page.mouse.down();await page.mouse.move(r.x+r.width*.61,r.y+r.height*.37,{steps:5});await page.mouse.up();
 assert.equal(await page.evaluate(()=>window.__atpStudio.state.phase),phase);assert.notDeepEqual(await page.evaluate(()=>window.__atpStudio.state.view.q),initial.view.q);
 await page.locator('[data-representation=structure]').click();await page.locator('.atp-phase').waitFor({state:'hidden'});assert.equal(await page.locator('.atp-phase').isVisible(),false);
 await page.locator('#atp-next').click();assert.equal(await page.evaluate(()=>window.__atpStudio.state.phase),240);assert.match(await page.locator('#atp-title').innerText(),/gradient/);
 await page.locator('[data-chapter="5"]').click();await page.locator('[data-part=stator]').click();await page.locator('#atp-check-part').click();assert.match(await page.locator('#atp-feedback').innerText(),/^Yes/);
 await page.locator('[data-phase="120"]').click();await page.locator('#atp-check-phase').click();assert.match(await page.locator('#atp-feedback').innerText(),/^Yes/);
 await page.locator('[data-answer="0"]').click();assert.match(await page.locator('#atp-feedback').innerText(),/gradient drives/);
 await page.locator('#atp-play').click();await page.waitForFunction(()=>window.__atpStudio.state.phase>125);await page.locator('#atp-play').click();const paused=await page.evaluate(()=>window.__atpStudio.state.phase);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__atpStudio.state.phase),paused);
 await page.locator('#atp-guided').click();await page.waitForFunction(()=>!window.__atpStudio.state.guided&&document.querySelector('#atp-challenge').hidden);assert.equal(await page.evaluate(()=>window.__atpStudio.state.guided),false);assert.equal(await page.locator('#atp-challenge').isVisible(),false);
 await page.locator('#atp-sources').click();assert.equal(await page.locator('#atp-about').isVisible(),true);await page.locator('#atp-about-close').click();
 await page.locator('#atp-camera').click();await page.waitForFunction(()=>document.querySelector('#atp-video').videoWidth>0);assert.equal(await page.locator('#atp-camera-preview').isVisible(),true);await page.locator('#atp-camera').click();assert.equal(await page.locator('#atp-camera-preview').isVisible(),false);
 await page.screenshot({path:'/tmp/atp-mechanism.png'});
 await page.waitForTimeout(500);await page.reload();await page.waitForFunction(()=>window.__atpStudio?.ready&&window.__atpStudio.owns);assert.equal(await page.evaluate(()=>window.__atpStudio.playing),false);assert.equal(await page.locator('#atp-camera-preview').isVisible(),false);
 await page.setViewportSize({width:393,height:852});await page.locator('#atp-guided').click();await page.locator('[data-chapter="3"]').click();await page.screenshot({path:'/tmp/atp-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.locator('.workspace-nav a[href="/pottery"]').click();await page.waitForFunction(()=>window.__potteryStudio);assert.equal(await page.locator('.workspace-nav a[href="/atp"]').count(),1);
 assert.deepEqual(errors,[]);console.log('ATP browser passed: routes, actual asset, orbit/phase independence, checkpoints, chapters, challenge, playback, restore, camera start/stop, mobile width, Pottery navigation. Camera input synthetic.');
}finally{await browser.close();}
