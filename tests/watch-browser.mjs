// Run with: PORT=4203 node server.mjs, then STUDIO_URL=http://localhost:4203 npx tsx tests/watch-browser.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4203',shots=process.env.SHOTS;
const gpu=process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...gpu]});
const fixture=(pose,x=.5,y=.6)=>posedHand(pose).map(p=>({x:x+p.x*.12,y:y+p.y*.12*16/9,z:p.z*.12}));
if(shots)await mkdir(shots,{recursive:true});
const errors=[],open=async(url,size={width:1280,height:800})=>{const context=await browser.newContext({permissions:['camera'],viewport:size}),page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(url);return {context,page};};
const within=(page,ms,fn,arg)=>page.waitForFunction(fn,arg,{timeout:ms,polling:50});
try{
 for(const [id,key] of [['atp','__atpStudio'],['perfume','__perfumeStudio']]){
  const {context:pc,page:presenter}=await open(`${base}/${id}`);
  await presenter.waitForFunction(key=>window[key]?.ready&&window[key].owns,key);
  const feed=(page,pose,x,y)=>page.evaluate(([key,hands])=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>window[key].hands(hands),20);},[key,pose?[fixture(pose,x,y)]:[]]);
  // Share dialog.
  await presenter.locator(`#${id}-share`).click();await presenter.waitForFunction(id=>/\?watch=/.test(document.querySelector(`#${id}-share-link`).value),id);
  const link=await presenter.locator(`#${id}-share-link`).inputValue();assert.match(link,new RegExp(`^${base}/${id}\\?watch=[0-9a-f]+$`));
  assert.equal(await presenter.locator(`#${id}-share-count`).innerText(),'0 watching');
  if(shots&&id==='atp')await presenter.screenshot({path:`${shots}/share-dialog.png`});
  await presenter.locator(`#${id}-share-close`).click();
  // Two viewers, in their own contexts.
  const v1=await open(link),v2=await open(link);
  for(const {page} of [v1,v2]){await page.waitForFunction(key=>window[key]?.ready&&window[key].live,key);await page.waitForFunction(()=>document.querySelector('.mirror-watch').textContent==='Watching live');}
  await presenter.locator(`#${id}-share`).click();await presenter.waitForFunction(id=>document.querySelector(`#${id}-share-count`).textContent==='2 watching',id);await presenter.locator(`#${id}-share-close`).click();
  // Viewer chrome is read-only: only Sound and About remain.
  for(const {page} of [v1,v2]){
   const visible=await page.locator('.mirror-corner button:visible').allInnerTexts();assert.deepEqual(visible,['Sound','About'],visible.join());
   assert.equal(await page.locator(`#${id}-camera`).isVisible(),false);assert.equal(await page.locator(`#${id}-gestures`).isVisible(),false);
  }
  // The presenter orbits; both viewers show the same view inside a second.
  const rect=await presenter.locator(`#${id}-viewport`).boundingBox(),before=await presenter.evaluate(key=>window[key].state.view.q,key);
  await presenter.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.4);await presenter.mouse.down();await presenter.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.55,{steps:6});await presenter.mouse.up();
  const after=await presenter.evaluate(key=>window[key].state.view.q,key);assert.notDeepEqual(after,before);
  for(const {page} of [v1,v2]){await within(page,1000,([key,q])=>window[key].state.view.q.every((n,i)=>Math.abs(n-q[i])<.01),[key,after]);await within(page,2500,([key,q])=>window[key].shownView.q.every((n,i)=>Math.abs(n-q[i])<.02),[key,after]);}
  // Zoom too.
  await presenter.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);await presenter.mouse.wheel(0,-300);
  const zoom=await presenter.evaluate(key=>window[key].state.view.zoom,key);assert.ok(zoom>1);
  for(const {page} of [v1,v2])await within(page,1000,([key,z])=>Math.abs(window[key].state.view.zoom-z)<.01,[key,zoom]);
  // A hand and an ink stroke appear on viewers within a second.
  await feed(presenter,'open',.4,.6);
  for(const {page} of [v1,v2]){await within(page,1000,key=>window[key].frame.hands.length===1&&window[key].engine.scene.hands.length===1,key);assert.equal(await page.evaluate(key=>window[key].frame.hands[0].landmarks.length,key),21);}
  const sample=await presenter.evaluate(key=>window[key].frame.hands[0].landmarks[8],key);
  const seen=await v1.page.evaluate(key=>window[key].frame.hands[0].landmarks[8],key);
  assert.ok(Math.abs(seen.x-sample.x)<.05&&Math.abs(seen.y-sample.y)<.05,`skeleton lands on the same stage point ${JSON.stringify(sample)} ${JSON.stringify(seen)}`);
  await feed(presenter,null);
  await presenter.locator(`#${id}-viewport`).focus();await presenter.keyboard.press('i');
  await presenter.evaluate(([key,hands])=>{clearInterval(window.testFeed);let i=0;window.testFeed=setInterval(()=>{const t=Math.min(1,i++/40);window[key].hands([hands.map(p=>({...p,x:p.x-.2+t*.3}))]);},20);},[key,fixture('pinch',.5,.5)]);
  for(const {page} of [v1,v2])await within(page,1000,key=>window[key].ink.board.strokes.length>0&&window[key].ink.board.strokes[0].points.length>3,key);
  await presenter.waitForTimeout(800);
  // Keep the stroke so a late joiner can see it, then join.
  await presenter.locator(`#${id}-ink-keep`).click();await presenter.waitForTimeout(300);
  const late=await open(link);await within(late.page,3000,key=>window[key]?.ready&&window[key].live&&window[key].ink.board.strokes.length>0&&window[key].state,key);
  assert.deepEqual(await late.page.evaluate(key=>window[key].state.view.q,key).then(q=>q.map(n=>+n.toFixed(2))),after.map(n=>+n.toFixed(2)),'late joiner gets the view');
  assert.equal(await late.page.evaluate(key=>window[key].ink.board.keep,key),true);
  if(shots&&id==='atp')await v1.page.screenshot({path:`${shots}/viewer.png`});
  // Viewers cannot change anything: drags, wheel, clicks on hidden actions, keys.
  const vr=await v1.page.locator(`#${id}-viewport`).boundingBox(),viewerBefore=await v1.page.evaluate(key=>JSON.stringify(window[key].shownView,(_,n)=>typeof n==='number'?+n.toFixed(3):n),key),presenterBefore=await presenter.evaluate(key=>JSON.stringify(window[key].state),key);
  await v1.page.mouse.move(vr.x+vr.width*.5,vr.y+vr.height*.5);await v1.page.mouse.down();await v1.page.mouse.move(vr.x+vr.width*.2,vr.y+vr.height*.2,{steps:6});await v1.page.mouse.up();await v1.page.mouse.wheel(0,-600);
  await v1.page.keyboard.press('i');await v1.page.keyboard.press(' ');await v1.page.keyboard.press('Home');
  await v1.page.locator(`#${id}-recenter`).click({force:true,timeout:1000}).catch(()=>{});await v1.page.locator(`#${id}-ink`).click({force:true,timeout:1000}).catch(()=>{});
  await v1.page.waitForTimeout(600);
  assert.equal(await v1.page.evaluate(key=>JSON.stringify(window[key].shownView,(_,n)=>typeof n==='number'?+n.toFixed(3):n),key).then(s=>s),viewerBefore,'viewer view unchanged by local input');
  assert.equal(await presenter.evaluate(key=>JSON.stringify(window[key].state),key),presenterBefore,'presenter untouched');
  assert.equal(await v1.page.locator('.mirror-ink-toggle').isVisible(),false);
  // Sound and About still work for a viewer.
  await v1.page.locator(`#${id}-sources`).click();assert.equal(await v1.page.locator(`#${id}-about`).isVisible(),true);await v1.page.locator(`#${id}-about-close`).click();
  await v1.page.locator(`#${id}-sound`).click();assert.equal(await v1.page.locator(`#${id}-sound`).getAttribute('aria-pressed'),'false');
  // Presenter leaves: viewers say so within two seconds.
  await pc.close();
  for(const {page} of [v1,v2,late]){await within(page,2000,()=>document.querySelector('.mirror-watch').textContent==='Presenter offline');}
  // A fresh presenter page brings them back.
  const next=await open(`${base}/${id}`);await next.page.waitForFunction(key=>window[key]?.ready&&window[key].owns,key);
  await next.page.locator(`#${id}-share`).click();await next.page.waitForFunction(id=>/\?watch=/.test(document.querySelector(`#${id}-share-link`).value),id);
  const link2=await next.page.locator(`#${id}-share-link`).inputValue();assert.equal(link2,link,'the same local link works again');
  await within(v1.page,6000,()=>document.querySelector('.mirror-watch').textContent==='Watching live');
  if(shots&&id==='atp')await v2.page.setViewportSize({width:1280,height:800});
  for(const c of [v1.context,v2.context,late.context,next.context])await c.close();
  console.log(`${id}: watch ok (link, 2 viewers + late joiner, view/zoom, hand, ink, read-only, offline, rejoin)`);
 }
 // Pages whose own state lives outside the shell state: one change through the page's own controls, mirrored on a viewer.
 const pages=[
  ['machine','__machineStudio',async(p)=>{await p.locator('#machine-viewport').focus();await p.keyboard.press('t');await p.evaluate(()=>document.querySelector('#machine-framing').click());},
   p=>p.evaluate(()=>{const m=__machineStudio.machine;return JSON.stringify([m.timing,m.close,__machineStudio.engine.caption]);}),r=>JSON.parse(r)[0]===1&&JSON.parse(r)[1]===false],
  ['organ','__organ',async(p)=>{await p.evaluate(()=>document.querySelector('.organ-chapters button[data-value="3"]').click());await p.evaluate(()=>document.querySelector('#organ-viewport').dispatchEvent(new CustomEvent('organ-action',{detail:{act:'warm',value:0}})));},
   p=>p.evaluate(()=>JSON.stringify([__organ.engine.story.beat,__organ.engine.doc.warm])),r=>r==='["chypre",true]'],
  ['follow','__follow',async(p)=>{await p.locator('[data-lesson]').nth(1).click();},
   p=>p.evaluate(()=>JSON.stringify([__follow.engine.lessonId,__follow.engine.index,__follow.engine.mode])),(r,mine)=>JSON.parse(r)[0]===mine],
  ['grasp','__grasp',async(p)=>{await p.locator('#grasp-viewport').focus();await p.keyboard.press('3');await p.keyboard.press('n');},
   p=>p.evaluate(()=>JSON.stringify([__grasp.engine.motors,__grasp.engine.objectId])),r=>JSON.parse(r)[0]===3&&JSON.parse(r)[1]!=='mug'],
  ['drivetrain','__drivetrain',async(p)=>{await p.locator('#drivetrain-viewport').focus();await p.keyboard.press('n');await p.keyboard.press('s');},
   p=>p.evaluate(()=>JSON.stringify([__drivetrain.train.brief,__drivetrain.train.schematic])),r=>r==='[1,true]'],
  ['perfume','__perfumeStudio',async(p)=>{await p.evaluate(()=>{const e=__perfumeStudio.engine;e.pump.removed.add('cap');e.mechanism.order.push('cap');});},
   p=>p.evaluate(()=>JSON.stringify([...__perfumeStudio.engine.pump.removed])),r=>r==='["cap"]'],
 ];
 for(const [id,key,act,read,ok] of pages){
  const {context:pc,page:presenter}=await open(`${base}/${id}`);
  await presenter.waitForFunction(key=>window[key]?.ready&&window[key].owns,key);
  await presenter.locator(`#${id}-share`).click();await presenter.waitForFunction(id=>/\?watch=/.test(document.querySelector(`#${id}-share-link`).value),id);
  const link=await presenter.locator(`#${id}-share-link`).inputValue();await presenter.locator(`#${id}-share-close`).click();
  const v=await open(link);await v.page.waitForFunction(key=>window[key]?.ready&&window[key].live,key);
  const first=id==='follow'?await presenter.evaluate(()=>__follow.engine.lessons[1].id):null;
  await act(presenter);
  const mine=await read(presenter);assert.ok(ok(mine,first),`${id} presenter changed: ${mine}`);
  await v.page.waitForFunction(([key,want])=>{const h=window[key];return !!h;},[key,mine],{timeout:1000});
  const want=JSON.stringify(JSON.parse(mine).slice(0,id==='machine'?2:undefined));
  const same=async()=>{const r=await read(v.page);return JSON.stringify(JSON.parse(r).slice(0,id==='machine'?2:undefined))===want;};
  const t0=Date.now();while(!(await same())&&Date.now()-t0<1000)await v.page.waitForTimeout(50);
  assert.ok(await same(),`${id} viewer shows ${await read(v.page)} wanted ${mine}`);
  if(id==='machine'){assert.equal(await v.page.locator('#machine-caption').innerText(),await presenter.locator('#machine-caption').innerText(),'caption matches');}
  if(id==='organ')assert.equal(await v.page.locator('.organ-line, .organ-story').first().innerText().catch(()=>''),await presenter.locator('.organ-line, .organ-story').first().innerText().catch(()=>''),'story text matches');
  // Stays converged, and viewer keys cannot change it.
  await v.page.keyboard.press('n');await v.page.keyboard.press('3');await v.page.waitForTimeout(1500);
  assert.ok(await same(),`${id} viewer stays converged`);
  if(shots&&id==='organ')await v.page.screenshot({path:`${shots}/viewer-organ.png`});
  await pc.close();await v.context.close();
  console.log(`${id}: page state mirrored within 1 s and stays converged`);
 }
 // A bad code never connects.
 const bad=await open(`${base}/atp?watch=nope`);await bad.page.waitForFunction(()=>window.__atpStudio?.ready);await bad.page.waitForTimeout(1500);assert.equal(await bad.page.locator('.mirror-watch').innerText(),'Presenter offline');await bad.context.close();
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
