// Run with: PORT=4203 node server.mjs, then STUDIO_URL=http://localhost:4203 npx tsx tests/presenter-ink-browser.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4203',shots=process.env.SHOTS;
const gpu=process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...gpu]});
const surfaces=[['atp','__atpStudio',11],['perfume','__perfumeStudio',11]];
const fixture=(pose,x=.5,y=.6)=>posedHand(pose).map(p=>({x:x+p.x*.12,y:y+p.y*.12*16/9,z:p.z*.12}));
if(shots)await mkdir(shots,{recursive:true});
try{
 for(const [id,key,gestureCount] of surfaces){
  const errors=[],context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage();
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  const feed=(pose,x,y)=>page.evaluate(([key,hands])=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>window[key].hands(hands),20);},[key,pose?[fixture(pose,x,y)]:[]]);
  const sweep=(pose,from,to,y)=>page.evaluate(([key,pose,from,to,y,hands])=>{clearInterval(window.testFeed);let i=0;window.testFeed=setInterval(()=>{const t=Math.min(1,i++/40),x=from+(to-from)*t;window[key].hands([hands.map(p=>({...p,x:p.x+x-.5}))]);},20);},[key,pose,from,to,y,fixture(pose,.5,y)]);
  const strokes=()=>page.evaluate(key=>window[key].ink.board.strokes.length,key);
  const viewKey=()=>page.evaluate(key=>JSON.stringify(window[key].state.view),key);
  const orbit=()=>page.evaluate(key=>window[key].state.view.q,key);
  const lis=()=>page.locator(`#${id}-gestures li`).evaluateAll(l=>l.map(x=>x.textContent.trim()));
  try{
   await page.goto(`${base}/${id}`);await page.waitForFunction(key=>window[key]?.ready&&window[key].owns,key);
   const labels=await lis(),corner=await page.locator('.mirror-corner button:visible').allInnerTexts();
   assert.equal(labels.length,gestureCount);assert.ok(corner.includes('Ink'),corner.join());assert.equal(await page.locator(`#${id}-ink-keep`).isVisible(),false);assert.equal(await page.locator('.mirror-ink').isVisible(),false);
   // Off: a fist drag moves the object, as today.
   const v0=await viewKey();await sweep('fist',.4,.6,.5);await page.waitForTimeout(1200);assert.notEqual(await viewKey(),v0,'a fist moves the view with ink off');await feed(null);await page.waitForTimeout(600);
   // On via keyboard.
   await page.locator(`#${id}-viewport`).focus();await page.keyboard.press('i');
   assert.equal(await page.locator(`#${id}-ink`).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.mirror-ink').isVisible(),true);assert.equal(await page.locator(`#${id}-ink-keep`).isVisible(),true);
   assert.deepEqual(await lis(),['🤏Draw','👎Undo']);
   await page.keyboard.press('i');assert.equal(await page.locator('.mirror-ink').isVisible(),false);assert.deepEqual(await lis(),labels,'bar restored exactly');
   await page.locator(`#${id}-ink`).click();assert.equal(await page.locator('.mirror-ink').isVisible(),true);
   // The input guard: typing i in a field does not toggle.
   await page.evaluate(()=>{const i=document.createElement('input');i.id='probe';document.body.append(i);i.focus();});await page.keyboard.press('i');assert.equal(await page.locator('.mirror-ink').isVisible(),true);await page.evaluate(()=>document.querySelector('#probe').remove());
   // Pinch draws where the pinch is: a hand left of centre in the camera is right of centre on screen.
   await sweep('pinch',.3,.6,.5);await page.waitForFunction(key=>window[key].ink.board.strokes.length>0&&window[key].ink.board.strokes[0].points.length>6,key);
   await page.waitForTimeout(500);
   const pts=await page.evaluate(key=>window[key].ink.board.strokes[0].points,key);
   assert.ok(pts[0].x>.55&&pts.at(-1).x<pts[0].x,`stroke starts right and moves left like the mirrored hand: ${pts[0].x} -> ${pts.at(-1).x}`);
   await page.screenshot({path:shots?`${shots}/${id}-ink.png`:undefined});
   // A fist drag while inking leaves the object alone.
   await feed(null);await page.waitForTimeout(500);const v1=await viewKey();await sweep('fist',.4,.6,.5);await page.waitForTimeout(1200);assert.equal(await viewKey(),v1,'no hold while inking');
   // Thumb down for 0.7 s undoes the stroke.
   await feed('thumbDown',.5,.6);await page.waitForFunction(key=>window[key].ink.board.strokes.length===0,key);
   // Mouse drag draws and does not orbit.
   await feed(null);const q0=await orbit(),r=await page.locator(`#${id}-viewport`).boundingBox();
   await page.mouse.move(r.x+r.width*.3,r.y+r.height*.4);await page.mouse.down();await page.mouse.move(r.x+r.width*.5,r.y+r.height*.6,{steps:8});await page.mouse.up();
   assert.equal(await strokes(),1);assert.deepEqual(await orbit(),q0,'a drag draws instead of orbiting');
   const mp=await page.evaluate(key=>window[key].ink.board.strokes[0].points,key);assert.ok(Math.abs(mp[0].x-.3)<.02&&Math.abs(mp[0].y-(.4*r.height-0)/r.height)<.03,JSON.stringify(mp[0]));
   // Keep ink holds strokes past the fade, and turning it off restarts the fade.
   await page.locator(`#${id}-ink-keep`).click();assert.equal(await page.locator(`#${id}-ink-keep`).getAttribute('aria-pressed'),'true');
   assert.equal(await page.evaluate(key=>window[key].ink.board.keep,key),true);
   // The object keeps animating: kick it with space while inking.
   await page.locator(`#${id}-viewport`).focus();
   // Off: ink cleared, normal behaviour back.
   await page.locator(`#${id}-ink`).click();assert.equal(await strokes(),0);assert.equal(await page.locator('.mirror-ink').isVisible(),false);assert.equal(await page.locator(`#${id}-ink-keep`).isVisible(),false);assert.equal(await page.evaluate(key=>window[key].ink.board.keep,key),false);
   assert.deepEqual(await lis(),labels);
   await page.mouse.move(r.x+r.width*.9,r.y+r.height*.3);await page.mouse.down();await page.mouse.move(r.x+r.width*.8,r.y+r.height*.45,{steps:5});await page.mouse.up();
   assert.notDeepEqual(await orbit(),q0,'orbit works again');
   const v2=await viewKey();await sweep('fist',.4,.6,.5);await page.waitForTimeout(1200);assert.notEqual(await viewKey(),v2,'a fist holds again');
   assert.deepEqual(errors,[]);console.log(`${id}: ink on/off ok (keyboard, button, pinch draw mirrored, thumb undo, mouse draw, keep, suppression, restore)`);
  }finally{await context.close();}
 }
}finally{await browser.close();}
