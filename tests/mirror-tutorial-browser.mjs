import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4174';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// The tracker divides y by the camera's aspect, so hands must be drawn at it.
let aspect=1;
const place=(pose,x)=>posedHand(pose).map(p=>({x:x+p.x*.14,y:.6+p.y*.14*aspect,z:p.z*.14}));
// Feeds the tracker on the page's own clock, as the camera would.
const feed=hands=>page.evaluate(h=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>{window.__atpStudio.hands(h);},33);},hands);
const index=()=>page.evaluate(()=>window.__atpStudio.tutorial?.index);
const reach=n=>page.waitForFunction(n=>(window.__atpStudio.tutorial?.index??-1)>=n,n,{timeout:15000});
try{
 await page.goto(base+'/atp');await page.waitForFunction(()=>window.__atpStudio?.ready&&window.__atpStudio.owns);
 assert.equal(await page.locator('#atp-tutorial').isVisible(),false,'nothing to teach without a camera');
 await page.locator('#atp-camera').click();await page.locator('#atp-tutorial').waitFor();
 await page.waitForFunction(()=>window.__atpStudio.tutorial?.index===0);
 aspect=await page.evaluate(()=>{const v=document.querySelector('#atp-video');return v.videoWidth/v.videoHeight;});
 await feed([place('open',.5)]);await page.waitForTimeout(1200);assert.equal(await index(),0,'a wrong pose does not pass');
 const singles=['fist','open','pinch','point','victory','thumbUp','thumbDown','love'];
 for(const [i,pose] of singles.entries()){await feed([place(pose,.5)]);await reach(i+1);}
 await feed([place('pinch',.25),place('pinch',.75)]);await reach(9);
 await feed([place('fist',.25),place('fist',.75)]);await reach(10);
 // Open hands far apart, then nearly touching.
 await feed([place('open',.15),place('open',.85)]);await page.waitForTimeout(350);await feed([place('open',.45),place('open',.55)]);
 await page.waitForFunction(()=>window.__atpStudio.tutorial?.done,null,{timeout:8000});
 await page.waitForFunction(()=>document.querySelector('#atp-tutorial').hidden,null,{timeout:5000});
 await page.evaluate(()=>clearInterval(window.testFeed));
 await page.reload();await page.waitForFunction(()=>window.__atpStudio?.ready&&window.__atpStudio.owns);
 await page.locator('#atp-camera').click();await page.waitForSelector('#atp-stage.is-live');await page.waitForTimeout(400);
 assert.equal(await page.locator('#atp-tutorial').isVisible(),false,'a finished tutorial does not return');
 await page.locator('#atp-tutorial-replay').click();await page.locator('#atp-tutorial').waitFor();
 await page.locator('#atp-tutorial-skip').click();assert.equal(await page.locator('#atp-tutorial').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('Tutorial passed: first run on camera, wrong pose held back, all 11 gestures, seen on reload, replay, skip.');
}finally{await browser.close();}
