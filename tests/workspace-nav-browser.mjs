import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.STUDIO_URL||'http://localhost:4174';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1360,height:950}});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
 await page.goto(base+'/cylinder');await page.waitForFunction(()=>window.__sectionStudio?.state.solid==='cylinder');
 assert.equal(await page.locator('.workspace-nav').count(),1);
 await page.locator('#camera-shortcut').click();await page.waitForFunction(()=>document.querySelector('#gesture-video').videoWidth>0);
 await page.evaluate(()=>window.testCameraTrack=document.querySelector('#gesture-video').srcObject.getVideoTracks()[0]);
 await page.locator('[data-solid="cube"]').click();await page.waitForFunction(()=>location.pathname==='/cube'&&window.__sectionStudio.state.solid==='cube');
 assert.equal(await page.evaluate(()=>window.testCameraTrack===document.querySelector('#gesture-video').srcObject.getVideoTracks()[0]&&window.testCameraTrack.readyState==='live'),true);
 await page.goBack();await page.waitForFunction(()=>location.pathname==='/cylinder'&&window.__sectionStudio.state.solid==='cylinder');
 await page.goForward();await page.waitForFunction(()=>window.__sectionStudio.state.solid==='cube');
 await page.locator('#undo').click();await page.waitForFunction(()=>location.pathname==='/cylinder'&&window.__sectionStudio.state.solid==='cylinder');
 await page.locator('#camera-shortcut').click();
 await page.locator('.workspace-nav a[href="/mechanism"]').click();await page.waitForSelector('#stand-view canvas');
 assert.equal(await page.locator('.workspace-nav [aria-current="page"]').innerText(),'Mechanism');
 await page.locator('.workspace-nav a[href="/cone"]').click();await page.waitForFunction(()=>window.__sectionStudio?.state.solid==='cone');
 for(const shape of ['cone','cylinder','cube']){
  const response=await page.goto(base+'/'+shape);assert.equal(response.status(),200);await page.waitForFunction(s=>window.__sectionStudio?.state.solid===s,shape);
 }
 await page.setViewportSize({width:393,height:852});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 for(const route of ['/cone','/mechanism']){
  await page.goto(base+route);await page.waitForSelector('.workspace-nav');
  assert.equal(await page.locator('.workspace-nav').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 }
 assert.deepEqual(errors,[]);
 console.log('Shared navigation passed: direct production routes, active selection, history, undo, mobile layout, preserved camera track between shapes, and mechanism return. Camera input was synthetic.');
}finally{await browser.close();}
