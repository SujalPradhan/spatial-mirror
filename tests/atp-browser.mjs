import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.STUDIO_URL||'http://localhost:4174';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const live=()=>page.waitForFunction(()=>window.__atpStudio?.ready&&window.__atpStudio.owns);
try{
 for(const route of ['/atp','/atp/']){assert.equal((await page.goto(base+route)).status(),200);await live();assert.equal(await page.locator('#atp-loading').isVisible(),false);assert.equal(await page.locator('.workspace-nav [aria-current=page]').innerText(),'ATP synthase');}
 for(const gone of ['.atp-story','.atp-phase','.atp-legend','#atp-guided','#atp-next'])assert.equal(await page.locator(gone).count(),0,gone);
 assert.equal(await page.locator('#atp-gestures li').count(),11);
 const initial=await page.evaluate(()=>window.__atpStudio.state),r=await page.locator('#atp-viewport').boundingBox();
 await page.mouse.move(r.x+r.width*.9,r.y+r.height*.3);await page.mouse.down();await page.mouse.move(r.x+r.width*.84,r.y+r.height*.4,{steps:5});await page.mouse.up();
 assert.notDeepEqual(await page.evaluate(()=>window.__atpStudio.state.view.q),initial.view.q);
 await page.locator('#atp-viewport').focus();await page.keyboard.press(' ');await page.waitForFunction(()=>window.__atpStudio.atp>=0);
 await page.locator('#atp-sources').click();assert.equal(await page.locator('#atp-about').isVisible(),true);await page.locator('#atp-about-close').click();
 await page.locator('#atp-camera').click();await page.waitForFunction(()=>document.querySelector('#atp-video').videoWidth>0);assert.equal(await page.locator('#atp-stage.is-live').count(),1);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#atp-video')).transform),'matrix(-1, 0, 0, 1, 0, 0)');
 await page.locator('#atp-camera').click();assert.equal(await page.locator('#atp-stage.is-live').count(),0);
 await page.waitForTimeout(500);await page.reload();await live();assert.equal(await page.evaluate(()=>window.__atpStudio.playing),false);
 await page.setViewportSize({width:393,height:852});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.locator('.workspace-nav a[href="/pottery"]').click();await page.waitForFunction(()=>window.__potteryStudio);
 assert.deepEqual(errors,[]);console.log('ATP browser passed: routes, panels removed, gesture rail, mouse orbit, spin key, about, mirrored camera start/stop, restore, mobile width, navigation. Camera input synthetic.');
}finally{await browser.close();}
