import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4197';
// Pose events last one tracker frame, so software rendering below the 30 Hz feed would drop them.
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'])]});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// The tracker divides y by the camera's aspect, so hands must be drawn at it.
let aspect=1,stageAspect=1;
const place=(pose,x,y=.6)=>posedHand(pose).map(p=>({x:x+p.x*.14,y:y+p.y*.14*aspect,z:p.z*.14}));
// One tracker update per rendered frame: a pose event lives for one tracker frame, and a loaded machine may render slower than a camera.
const feed=hands=>page.evaluate(h=>{window.testHands=h;if(window.testFeed)return;window.testFeed=true;const loop=()=>{if(!window.testFeed)return;window.__machineStudio.hands(window.testHands);requestAnimationFrame(loop);};loop();},hands);
const clear=async()=>{await page.evaluate(()=>{window.testFeed=false;});await page.waitForTimeout(500);};
const get=fn=>page.evaluate(fn);
const until=(fn,arg,timeout=15000)=>page.waitForFunction(fn,arg,{timeout});
const sew=turns=>page.evaluate(async n=>{const m=__machineStudio.machine;for(let i=0;i<n*12;i++){m.crank+=30;await new Promise(requestAnimationFrame);}},turns);
/** The raw hand origin that lands a pinch on a stage point, undoing the mirror and the cover crop. */
const pinchAt=(sx,sy)=>{
 const mx=aspect>stageAspect?(sx-.5)*stageAspect/aspect+.5:sx,my=aspect>stageAspect?sy:(sy-.5)*aspect/stageAspect+.5;
 return {x:1-mx+.475*.14,y:my+1.7*.14*aspect};
};
async function pull(id,close){
 await page.evaluate(c=>__machineStudio.machine.setClose(c),close);await page.waitForTimeout(close?2000:2600);
 const at=await page.evaluate(i=>__machineStudio.engine.screenOf(i),id),o=pinchAt(at.x,at.y);
 await feed([place('pinch',o.x,o.y)]);await page.waitForTimeout(350);
 for(let i=1;i<=8;i++){await feed([place('pinch',o.x-.02*i,o.y)]);await page.waitForTimeout(70);}
 await until(i=>__machineStudio.machine.removed.includes(i),id,4000);await clear();
}
try{
 await page.goto(base+'/machine');await until(()=>window.__machineStudio?.ready&&window.__machineStudio.owns&&document.querySelector('#machine-caption'));
 assert.match(await page.title(),/Sewing machine/);
 // Idle motor and the opening move run with nothing touched.
 await until(()=>__machineStudio.engine.position>5);
 await until(()=>__machineStudio.machine.close);
 // Hands go straight to the shell, as the tutorial test does, but with no camera running: a live probe would interleave its own frames and drop pose events.
 // With no video the stage maps 1:1, and the tracker's default aspect is 16:9.
 aspect=16/9;stageAspect=16/9;
 // Hold turns, Scale crosses into each framing.
 await feed([place('fist',.5)]);await until(()=>__machineStudio.frame.hands[0]?.pose==='fist');await page.waitForTimeout(150);
 await feed([place('fist',.6)]);await page.waitForTimeout(400);await clear();
 assert.ok(await get(()=>__machineStudio.state.view.x)!==0,'hold moves the object');
 await feed([place('fist',.4),place('fist',.6)]);await page.waitForTimeout(400);await feed([place('fist',.3),place('fist',.7)]);await page.waitForTimeout(300);await feed([place('fist',.2),place('fist',.8)]);
 await until(()=>__machineStudio.state.view.zoom>=1.35);await clear();assert.equal(await get(()=>__machineStudio.machine.close),true);
 await feed([place('fist',.2),place('fist',.8)]);await page.waitForTimeout(400);await feed([place('fist',.35),place('fist',.65)]);await page.waitForTimeout(300);await feed([place('fist',.42),place('fist',.58)]);
 await until(()=>__machineStudio.state.view.zoom<=.85);await clear();assert.equal(await get(()=>__machineStudio.machine.close),false,'scale out shows the whole machine');
 await page.locator('#machine-recenter').click();assert.equal(await get(()=>__machineStudio.state.view.zoom),1);assert.equal(await get(()=>__machineStudio.machine.close),true);
 // Skin, Slice, Part, Tear, Shock.
 await feed([place('love',.5)]);await until(()=>__machineStudio.engine.live.skin==='xray');await clear();
 await feed([place('love',.5)]);await until(()=>__machineStudio.engine.live.skin==='glass');await clear();
 await feed([place('victory',.5)]);await until(()=>__machineStudio.engine.live.slice.amount>.9);await clear();
 await feed([place('open',.5)]);await until(()=>__machineStudio.engine.live.parted>.4);await clear();await until(()=>__machineStudio.engine.live.parted<.05);
 await feed([place('pinch',.4),place('pinch',.6)]);await page.waitForTimeout(350);await feed([place('pinch',.25),place('pinch',.75)]);await until(()=>__machineStudio.engine.live.explode>.3);await clear();
 await feed([place('open',.15),place('open',.85)]);await page.waitForTimeout(350);await feed([place('open',.45),place('open',.55)]);await until(()=>__machineStudio.engine.live.shocks.length>0,null,6000);await clear();
 // Run, Reverse, Stir.
 await feed([place('thumbUp',.5)]);await until(()=>__machineStudio.engine.speed>.8);const up=await get(()=>__machineStudio.machine.count);await until(n=>__machineStudio.machine.count>n,up);await clear();
 await feed([place('thumbDown',.5)]);await until(()=>__machineStudio.engine.speed<-.5);await until(n=>__machineStudio.machine.count<=n,up);await clear();
 await page.waitForTimeout(1500);
 const before=await get(()=>__machineStudio.engine.position);
 const steps=48;for(let i=0;i<steps;i++){const t=i/steps*Math.PI*2;await feed([place('point',.5+.3*Math.cos(t)+.03,.5+.22*Math.sin(t)*aspect+.3)]);await page.waitForTimeout(45);}await clear();
 assert.ok(Math.abs(await get(()=>__machineStudio.engine.position)-before)>90,'stir turns the wheel');
 // Pluck: each part out, consequence in the next stitches, one-line caption.
 const last=()=>get(()=>__machineStudio.machine.stitches.at(-1)?.kind),cap=()=>page.locator('#machine-caption').textContent();
 await pull('bobbin',true);await sew(2);assert.equal(await last(),'single-thread');assert.match(await cap(),/No bobbin/);
 const held=await get(()=>__machineStudio.machine.count);await sew(1);assert.equal(await get(()=>__machineStudio.machine.count),held,'no lock, no count');
 await page.locator('#machine-recenter').click();assert.deepEqual(await get(()=>__machineStudio.machine.removed),[]);await sew(1);assert.equal(await last(),'formed');
 await pull('feedDog',true);await sew(2);assert.equal(await last(),'stationary');assert.match(await cap(),/No feed dog/);await page.locator('#machine-recenter').click();
 await pull('takeUp',false);await sew(2);assert.equal(await last(),'loose');assert.match(await cap(),/No take-up/);assert.equal(await get(()=>__machineStudio.machine.close),true,'a removal goes close');await page.locator('#machine-recenter').click();
 // Timing fault from the corner control and the keyboard.
 await sew(1);await page.locator('#machine-timing').click();await sew(2);assert.equal(await last(),'skipped');assert.match(await cap(),/late/);
 await page.locator('#machine-viewport').focus();await page.keyboard.press('t');await sew(1);assert.match(await cap(),/early/);await page.keyboard.press('Home');await sew(1);assert.equal(await last(),'formed');
 // The framing control, and the cap on what is kept.
 await page.locator('#machine-framing').click();assert.equal(await get(()=>__machineStudio.machine.close),false);
 await sew(30);assert.ok(await get(()=>__machineStudio.machine.stitches.length)<=24);
 assert.equal(await page.locator('#machine-count').textContent(),String(await get(()=>__machineStudio.machine.count)));
 await page.locator('#machine-sources').click();const about=await page.locator('#machine-about').textContent();assert.match(about,/Elias Howe/);assert.match(about,/1846/);assert.match(about,/1856/);await page.locator('#machine-about-close').click();
 assert.deepEqual(errors,[]);console.log('Machine passed: idle, hold, scale both ways, skin, slice, part, tear, shock, run, reverse, stir, pull bobbin/feed dog/take-up with consequence, timing late and early, recenter, cap, about.');
}finally{await browser.close();}
