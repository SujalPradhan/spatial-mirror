import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4174';
const shots=process.env.SHOTS||'/tmp/mirror-walkthrough-checks';
const gpu=process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const fail=(what,e)=>{console.error(`mirror-walkthrough FAILED: ${what}\n${e?.stack||e}`);process.exit(1);};
try{const r=await fetch(`${base}/atp`);if(!r.ok)throw new Error(`HTTP ${r.status}`);}catch(e){fail(`no studio at ${base} (start one, or set STUDIO_URL)`,e);}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...gpu]});
const bases=Object.fromEntries(['fist','open','pinch','point','victory','thumbUp','thumbDown','love'].map(p=>[p,posedHand(p)]));
const stub="self.onmessage=({data})=>{if(data.type==='init')self.postMessage({type:'ready',delegate:'synthetic-test-stub'});if(data.type==='frame')data.bitmap.close();};";
const circle='[[.5+.12*Math.cos(t*8),.5+.12*Math.sin(t*8)]]',still=(x=.5,y=.55)=>`[[${x},${y}]]`;
const surfaces={
 atp:{debug:'__atpStudio',steps:[
  {id:'fist',poses:['fist'],path:still(),does:{poses:['fist'],path:'[[.3+.25*Math.min(t,1.2),.55]]'},holds:false},
  {id:'open',poses:['open'],path:still(.5,.5),holds:true},
  {id:'pinch',poses:['pinch'],path:still(.5,.6),anchor:'pinch',does:{poses:['pinch'],path:'[[.5+.2*Math.min(t,1),.6]]',anchor:'pinch'},holds:false},
  {id:'point',poses:['point'],path:still(),anchor:'tip',does:{poses:['point'],path:circle,anchor:'tip'},holds:false},
  {id:'victory',poses:['victory'],path:still(),holds:true},
  {id:'thumbUp',poses:['thumbUp'],path:still(),holds:true},
  {id:'thumbDown',poses:['thumbDown'],path:still(),holds:true},
  {id:'love',poses:['love'],path:still(),does:[{poses:['fist'],path:still(),ms:500},{poses:['love'],path:still()}],holds:false},
  {id:'both-pinch',poses:['pinch','pinch'],path:'[[.3,.5],[.7,.5]]',anchor:'pinch',does:{poses:['pinch','pinch'],path:'[[.35-.15*Math.min(t,1),.5],[.65+.15*Math.min(t,1),.5]]',anchor:'pinch'},holds:false},
  {id:'both-fist',poses:['fist','fist'],path:'[[.4,.6],[.6,.6]]',does:{poses:['fist','fist'],path:'[[.4-.2*Math.min(t,1),.6],[.6+.2*Math.min(t,1),.6]]'},holds:false},
  {id:'clap',poses:['open','open'],path:'[[.2,.5],[.8,.5]]',does:[{poses:['open','open'],path:'[[.2,.5],[.8,.5]]',ms:500},{poses:['open','open'],path:'[[.2+.3*Math.min(t/.12,1),.5],[.8-.3*Math.min(t/.12,1),.5]]'}],holds:false,poseOnly:true},
 ]},
 atom:{debug:'__atomStudio',steps:[
  {id:'open',poses:['open'],path:still(.7,.5),holds:true},
  {id:'both-pinch',poses:['pinch','pinch'],path:'[[.3,.5],[.7,.5]]',anchor:'pinch',does:{poses:['pinch','pinch'],path:'[[.35-.15*Math.min(t,1),.5],[.65+.15*Math.min(t,1),.5]]',anchor:'pinch'},holds:false},
  {id:'fist',poses:['fist'],path:still(),does:{poses:['fist'],path:'[[.3+.25*Math.min(t,1.2),.55]]'},holds:false},
  {id:'thumbUp',poses:['thumbUp'],path:still(),holds:true},
  {id:'thumbDown',poses:['thumbDown'],path:still(),holds:true},
  {id:'both-fist',poses:['fist','fist'],path:'[[.4,.6],[.6,.6]]',does:{poses:['fist','fist'],path:'[[.4-.2*Math.min(t,1),.6],[.6+.2*Math.min(t,1),.6]]'},holds:false},
  {id:'clap',poses:['open','open'],path:'[[.2,.5],[.8,.5]]',does:[{poses:['open','open'],path:'[[.2,.5],[.8,.5]]',ms:500},{poses:['open','open'],path:'[[.2+.3*Math.min(t/.12,1),.5],[.8-.3*Math.min(t/.12,1),.5]]'}],holds:false,poseOnly:true},
 ]},
};
await mkdir(shots,{recursive:true});
const open=async(id,{viewport={width:1280,height:800},before}={})=>{
 const context=await browser.newContext({permissions:['camera'],viewport}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/hand-worker.js?*',route=>route.fulfill({contentType:'text/javascript',body:stub}));
 if(before)await page.addInitScript(before);
 await page.goto(`${base}/${id}`);const key=surfaces[id].debug;
 await page.waitForFunction(key=>window[key]?.ready&&window[key].owns,key);
 const api={
  context,page,errors,key,
  feed:(poses,path,{scale=.1,anchor='wrist'}={})=>page.evaluate(([key,bases,poses,path,scale,anchor])=>{
   clearInterval(window.testFeed);const f=new Function('t',`return ${path}`),t0=performance.now();
   const off=name=>{const b=bases[name],pick=anchor==='tip'?b[8]:anchor==='pinch'?{x:(b[4].x+b[8].x)/2,y:(b[4].y+b[8].y)/2}:b[0];return {x:pick.x*scale,y:pick.y*scale*16/9};};
   window.testFeed=setInterval(()=>{const t=(performance.now()-t0)/1000,c=f(t);window[key].hands(poses.map((p,i)=>{const o=off(p);return bases[p].map(q=>({x:c[i][0]-o.x+q.x*scale,y:c[i][1]-o.y+q.y*scale*16/9,z:q.z*scale}));}));},20);
  },[key,bases,poses,path,scale,anchor]),
  quiet:async()=>{await page.evaluate(()=>clearInterval(window.testFeed));await page.waitForFunction(key=>window[key].frame.hands.length===0,key);},
  tutorial:()=>page.evaluate(key=>{const t=window[key].tutorial;return t&&{index:t.index,phase:t.phase,done:t.done,checkpoint:t.checkpoint,id:t.step?.id,total:t.total};},key),
  text:sel=>page.locator(sel).innerText(),
  start:async()=>{await page.locator(`#${id}-camera`).click();await page.locator(`#${id}-stage.is-live`).waitFor();},
 };
 return api;
};
const feedSpec=(api,spec)=>api.feed(spec.poses,spec.path,{anchor:spec.anchor});
async function advance(api,step,i,total){
 // After a full step the tutorial may sit at the basics checkpoint, where the viewer chooses to go on.
 await api.page.waitForFunction(([key,i])=>{const t=window[key].tutorial;return t&&(t.index>i||t.done);},[api.key,i],{timeout:12000}).catch(async e=>{console.log('stuck',step.id,await api.tutorial(),await api.page.evaluate(k=>({speed:window[k].engine.speed,state:window[k].state.view,hands:window[k].frame.hands.map(h=>h.pose)}),api.key));throw e;});
}
const feedback=api=>api.page.locator('.wt-feedback');
const withFeedback=async(api,spec,pattern,label,shot)=>{
 await feedSpec(api,spec);
 await api.page.waitForFunction(re=>new RegExp(re).test(document.querySelector('.wt-feedback')?.textContent??''),pattern.source,{timeout:6000}).catch(async()=>{throw new Error(`${label}: feedback was "${await feedback(api).textContent()}"`);});
 if(shot)await api.page.screenshot({path:`${shots}/${shot}.png`});
};
try{
 for(const id of ['atp','atom']){
  const {steps,debug}=surfaces[id];
  // 1. Walkthrough: pose alone does not finish a step that needs an effect; the effect does.
  {
   const api=await open(id),{page}=api;
   const card=page.locator(`#${id}-tutorial`);
   await api.start();assert.equal(await card.isVisible(),true,'first visit starts the walkthrough');
   assert.equal(await page.evaluate(()=>localStorage.getItem('mirror-tutorial-v1')),null);
   assert.match(await api.text(`#${id}-tutorial`),new RegExp(`Step 1 of ${steps.length}`,"i"));
   await page.screenshot({path:`${shots}/${id}-1-show-me.png`});
   // No hand, far, close, edge.
   await withFeedback(api,{poses:[],path:'[]'},/cannot see your hand/,'no hand');
   await page.evaluate(()=>clearInterval(window.testFeed));
   await page.screenshot({path:`${shots}/${id}-feedback-no-hand.png`});
   const probe=id==='atp'?'open':'point';
   await api.feed([probe],still(),{scale:.02});await page.waitForFunction(()=>/too far/.test(document.querySelector('.wt-feedback').textContent));
   await api.feed([probe],still(),{scale:.6});await page.waitForFunction(()=>/too close/.test(document.querySelector('.wt-feedback').textContent));
   await api.feed([probe],'[[.02,.5]]');await page.waitForFunction(()=>/edge of the frame/.test(document.querySelector('.wt-feedback').textContent));
   // nothing rewrites the live region while a steady pose is held
   if(steps[0].holds===false){
    await api.feed(steps[0].poses,steps[0].path);
    await page.waitForFunction(([key])=>window[key].tutorial?.phase==='do',[debug]);
   }else{
    await api.feed(['point'],still());
    await page.waitForFunction(()=>/looks like a pointing finger/.test(document.querySelector('.wt-feedback').textContent));
   }
   await page.waitForTimeout(1200);
   const mutations=await page.evaluate(()=>new Promise(resolve=>{let n=0;const o=new MutationObserver(r=>{n+=r.length;window.__mut=r.map(x=>[x.type,x.target.nodeName,x.target.textContent,x.attributeName]);});o.observe(document.querySelector('.mirror-tutorial p'),{childList:true,characterData:true,subtree:true,attributes:true});setTimeout(()=>{o.disconnect();resolve(n);},2000);}));
   assert.ok(mutations<=1,`a steady hand writes at most the one stuck hint to the live region over 2s of about 100 frames (saw ${mutations}: ${JSON.stringify(await page.evaluate(()=>window.__mut))})`);
   const lines=await page.evaluate(()=>({how:document.querySelector('.wt-how').textContent,phase:document.querySelector('.wt-phase').textContent}));
   if(steps[0].holds===false){assert.equal(lines.phase,'Now do it');assert.equal((await api.tutorial()).index,0,'the shown pose alone does not finish the step');await page.screenshot({path:`${shots}/${id}-2-now-do-it.png`});}
   // the gestures, one after the other
   for(const [i,step] of steps.entries()){
    if(i>0){
     const t=await api.tutorial();
     if(t.checkpoint){assert.match(await api.text(`#${id}-tutorial`),/Basics done/);await page.screenshot({path:`${shots}/${id}-checkpoint.png`});await page.locator(`#${id}-tutorial-next`).click();}
     await api.quiet();
    }
    // The fist step pans the model by however far the hand moved, so aimed steps start from the centred view.
    if(step.anchor==='pinch'&&step.poses.length===1){await page.locator(`#${id}-recenter`).click();await page.waitForTimeout(300);}
    assert.equal((await api.tutorial()).id,step.id);
    await feedSpec(api,step);
    if(!step.poseOnly&&step.holds===false){
     await page.waitForFunction(([key])=>window[key].tutorial?.phase==='do',[debug]);await page.waitForTimeout(900);
     const t=await api.tutorial();assert.deepEqual([t.index,t.phase],[i,'do'],`${step.id}: the pose alone does not pass`);
     if(step.id==='point'||step.id==='pinch')await page.screenshot({path:`${shots}/${id}-do-${step.id}.png`});
     for(const part of [].concat(step.does)){await api.feed(part.poses,part.path,{anchor:part.anchor});if(part.ms)await page.waitForTimeout(part.ms);}
    }
    if(step.poseOnly){for(const part of step.does){await api.feed(part.poses,part.path,{anchor:part.anchor});if(part.ms)await page.waitForTimeout(part.ms);}}
    await advance(api,step,i,steps.length);
   }
   assert.equal((await api.tutorial()).done,true);
   await api.quiet();
   assert.equal(await page.evaluate(id=>localStorage.getItem(`mirror-tutorial-v1:${id}`),id),'1','finishing marks this page seen');
   assert.equal(await page.evaluate(()=>localStorage.getItem('mirror-tutorial-v1')),null,'the old shared flag is not written');
   assert.deepEqual(api.errors,[]);
   await api.context.close();
  }
  // 2. Confused pose: the specific correction for thumbs up.
  {
   const api=await open(id),{page}=api;await api.start();
   const target=steps.findIndex(s=>s.id==='thumbUp');
   for(let i=0;i<target;i++){const t=await api.tutorial();await page.locator(`#${id}-tutorial-next`).click();if(t.checkpoint===false&&(await api.tutorial()).checkpoint)await page.locator(`#${id}-tutorial-next`).click();}
   assert.equal((await api.tutorial()).id,'thumbUp');
   await withFeedback(api,{poses:['fist'],path:still()},/^That looks like a fist\. Point your thumb up\.$/,'fist for thumb',`${id}-feedback-fist-for-thumb`);
   await api.context.close();
  }
  // 3. Keyboard only, with Skip step in the effect phase, and a mouse-free finish.
  {
   const api=await open(id),{page}=api;await api.start();
   const first=steps[0];await feedSpec(api,first);
   if(first.holds===false){
    await page.waitForFunction(key=>window[key].tutorial?.phase==='do',debug);
    const skip=page.locator(`#${id}-tutorial-skip-step`);assert.equal(await skip.isVisible(),true,'Skip step shows once the effect is awaited');
    await skip.focus();await page.keyboard.press('Enter');assert.equal((await api.tutorial()).index,1);
   }
   await api.quiet();
   for(let n=0;n<steps.length+2&&!(await api.tutorial()).done;n++)await page.keyboard.press('ArrowRight');
   assert.equal((await api.tutorial()).done,true,'arrow keys alone reach the end');
   await api.context.close();
  }
  // 4. Cheat sheet.
  {
   const api=await open(id),{page}=api;
   const pop=page.locator(`#${id}-gesture-pop`),item=gesture=>page.locator(`#${id}-gestures li[data-gesture="${gesture}"] button`);
   assert.equal(await page.locator(`#${id}-gestures li button`).count(),steps.length,'every gesture-bar item is a button');
   assert.equal(await pop.isVisible(),false);
   const subject=steps.find(s=>s.id==='fist');
   await item('fist').click();assert.equal(await pop.isVisible(),true);
   assert.match(await pop.innerText(),/Close your fist over the (molecule|atom), then move or twist your hand to turn it\./);
   assert.equal(await pop.locator('.wt-demo').count(),1);assert.equal(await pop.locator('.wt-try').isVisible(),true);
   await page.screenshot({path:`${shots}/${id}-cheat-sheet.png`});
   await item('both-fist').click();assert.match(await pop.innerText(),/Make a fist with both hands/);
   await page.keyboard.press('Escape');assert.equal(await pop.isVisible(),false);
   await item('fist').click();await pop.locator('.wt-try').click();
   assert.equal(await pop.isVisible(),false);assert.equal(await page.locator(`#${id}-tutorial`).isVisible(),true,'Try it starts a one-step practice');
   assert.match(await api.text(`#${id}-tutorial`),/practice/i);assert.equal((await api.tutorial()).total,1);
   await page.locator(`#${id}-tutorial-skip`).click();
   assert.equal(await page.locator(`#${id}-tutorial`).isVisible(),false);assert.equal(await page.evaluate(id=>localStorage.getItem(`mirror-tutorial-v1:${id}`),id),null,'ending a practice does not mark the walkthrough seen');
   await page.setViewportSize({width:640,height:800});await item('open').click();await page.screenshot({path:`${shots}/${id}-cheat-sheet-640.png`});
   const r=await pop.boundingBox();assert.ok(r.x>=0&&r.x+r.width<=640,'popover fits a narrow stage');
   await page.keyboard.press('Escape');
   await page.locator(`#${id}-tutorial-replay`).click();await page.screenshot({path:`${shots}/${id}-walkthrough-640.png`});
   const c=await page.locator(`#${id}-tutorial`).boundingBox();assert.ok(c.x>=0&&c.x+c.width<=640);
   assert.deepEqual(api.errors,[]);await api.context.close();
  }
 }
 // 5. Seen flags are per page; the old flag counts for ATP only.
 {
  const api=await open('atp',{before:()=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('mirror-tutorial-v1','1');}}}),{page}=api;
  await api.start();assert.equal(await page.locator('#atp-tutorial').isVisible(),false,'the old flag keeps ATP quiet');
  await page.goto(`${base}/atom`);await page.waitForFunction(()=>window.__atomStudio?.ready&&window.__atomStudio.owns);await page.locator('#atom-camera').click();await page.locator('#atom-stage.is-live').waitFor();
  assert.equal(await page.locator('#atom-tutorial').isVisible(),true,'the old flag does not hide the Atom walkthrough');
  await page.locator('#atom-tutorial-skip').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('mirror-tutorial-v1:atom')),'1');assert.equal(await page.evaluate(()=>localStorage.getItem('mirror-tutorial-v1:atp')),null);
  await api.context.close();
 }
 console.log('Walkthrough checks passed on /atp and /atom. Camera streams are synthetic; the model worker is stubbed; hand landmarks are injected synthetic fixtures. No physical camera or real model. Screenshots: '+shots);
}catch(e){console.error(`mirror-walkthrough FAILED: ${e?.stack||e}`);process.exitCode=1;}finally{await browser.close();}
