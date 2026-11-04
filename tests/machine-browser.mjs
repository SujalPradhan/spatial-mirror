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
const feed=hands=>page.evaluate(h=>{window.testHands=h;if(window.testFeed)return;window.testFeed=true;const loop=()=>{if(!window.testFeed)return;if(window.testPath?.length)window.testHands=window.testPath.shift();window.__machineStudio.hands(window.testHands);requestAnimationFrame(loop);};loop();},hands);
/** One frame of hands per rendered frame, in order: a drawn path is the same however fast the machine renders. */
const path=async frames=>{await page.evaluate(f=>{window.testPath=f;},frames.slice(1));await feed(frames[0]);await until(()=>!window.testPath.length,null,30000);};
const shots=process.env.SHOTS,shot=name=>shots?page.screenshot({path:`${shots}/machine2-${name}.png`}):null;
const clear=async()=>{await page.evaluate(()=>{window.testFeed=false;});await page.waitForTimeout(500);};
const get=fn=>page.evaluate(fn);
// On a timeout the machine's state is printed, so a failure under load says what it was waiting on.
const until=(fn,arg,timeout=15000)=>page.waitForFunction(fn,arg,{timeout}).catch(async e=>{console.error(await page.evaluate(()=>{const m=__machineStudio.machine;return JSON.stringify({poses:__machineStudio.frame.hands.map(h=>h.pose),tension:m.tension,held:!!m.held,broken:m.broken,removed:m.removed,crank:m.crank,omega:m.omega,explode:__machineStudio.engine.live.explode});}));throw e;});
const sew=turns=>page.evaluate(async n=>{const m=__machineStudio.machine;for(let i=0;i<n*12;i++){m.crank+=30;await new Promise(requestAnimationFrame);}},turns);
/** The raw hand origin that lands a pinch on a stage point, undoing the mirror and the cover crop. */
const pinchAt=(sx,sy)=>{
 const mx=aspect>stageAspect?(sx-.5)*stageAspect/aspect+.5:sx,my=aspect>stageAspect?sy:(sy-.5)*aspect/stageAspect+.5;
 return {x:1-mx+.475*.14,y:my+1.7*.14*aspect};
};
/** The feed dog and take-up move as they are pinched, so a pinch that misses under a slow frame is tried again, up to three times. */
async function pull(id,close){
 await page.evaluate(c=>__machineStudio.machine.setClose(c),close);await page.waitForTimeout(close?2000:2600);
 for(let attempt=0;;attempt++){
  const at=await page.evaluate(i=>__machineStudio.engine.screenOf(i),id),o=pinchAt(at.x,at.y);
  await feed([place('pinch',o.x,o.y)]);await page.waitForTimeout(350);
  for(let i=1;i<=8;i++){await feed([place('pinch',o.x-.02*i,o.y)]);await page.waitForTimeout(70);}
  const out=await page.waitForFunction(i=>__machineStudio.machine.removed.includes(i),id,{timeout:4000}).then(()=>true,()=>false);await clear();
  if(out)return;if(attempt===2)throw Error(`could not pull out ${id}`);
 }
}
try{
 await page.goto(base+'/machine');await until(()=>window.__machineStudio?.ready&&window.__machineStudio.owns&&document.querySelector('#machine-caption'));
 assert.match(await page.title(),/Sewing machine/);
 // The idle motor runs with nothing touched, on the close-up from the first frame: nothing moves the camera by itself.
 await until(()=>__machineStudio.engine.position>5);
 assert.equal(await get(()=>__machineStudio.machine.close),true);
 // Hands go straight to the shell, as the tutorial test does, but with no camera running: a live probe would interleave its own frames and drop pose events.
 // With no video the stage maps 1:1, and the tracker's default aspect is 16:9.
 aspect=16/9;stageAspect=16/9;
 // Hold turns, Scale crosses into each framing.
 await feed([place('fist',.5)]);await until(()=>__machineStudio.frame.hands[0]?.pose==='fist');await page.waitForTimeout(150);
 await feed([place('fist',.6)]);await page.waitForTimeout(400);await clear();
 assert.ok(await get(()=>__machineStudio.state.view.x)!==0,'hold moves the object');
 await feed([place('fist',.4),place('fist',.6)]);await until(()=>__machineStudio.frame.hands.filter(h=>h.pose==='fist').length===2);await page.waitForTimeout(500);await feed([place('fist',.3),place('fist',.7)]);await page.waitForTimeout(300);await feed([place('fist',.2),place('fist',.8)]);
 await until(()=>__machineStudio.state.view.zoom>=1.35);await clear();assert.equal(await get(()=>__machineStudio.machine.close),true);
 await feed([place('fist',.2),place('fist',.8)]);await until(()=>__machineStudio.frame.hands.filter(h=>h.pose==='fist').length===2);await page.waitForTimeout(500);await feed([place('fist',.35),place('fist',.65)]);await page.waitForTimeout(300);await feed([place('fist',.42),place('fist',.58)]);
 await until(()=>__machineStudio.state.view.zoom<=.85);await clear();assert.equal(await get(()=>__machineStudio.machine.close),false,'scale out shows the whole machine');
 await page.locator('#machine-recenter').click();assert.equal(await get(()=>__machineStudio.state.view.zoom),1);assert.equal(await get(()=>__machineStudio.machine.close),false,'Recenter leaves the framing to the viewer');
 await page.locator('#machine-framing').click();assert.equal(await get(()=>__machineStudio.machine.close),true,'the corner control goes back in');
 // Skin cycles solid, x-ray, light painting: every working point leaves its path.
 const love=async skin=>{await feed([place('love',.5)]);await until(k=>__machineStudio.engine.live.skin===k,skin);await clear();};
 await love('xray');await love('paint');await sew(3);await until(()=>__machineStudio.engine.live.exposure>=1000);assert.match(await page.locator('#machine-caption').textContent(),/Light painting/);await shot('paint');await love('glass');
 // Slice is also a high-speed camera, with the timing diagram running.
 await feed([place('victory',.5)]);await until(()=>__machineStudio.machine.highSpeed>.9&&__machineStudio.engine.live.slice.amount>.9);
 const filmed=await get(()=>__machineStudio.machine.crank);await page.waitForTimeout(500);const slow=await get(()=>__machineStudio.machine.crank)-filmed;
 assert.ok(slow>10&&slow<200,`slow motion, ${slow}°`);assert.equal(await page.locator('.machine-film').isVisible(),true);assert.match(await page.locator('.machine-film p').textContent(),/1\/50/);await shot('film');await clear();
 // Part draws with thread: a heart traced in the air is sewn into the cloth.
 // Free motion counts in from a palm held still for a moment, so the path opens with one.
 const heart=[...Array(45).fill(0)].map(()=>[place('open',.5,.62-5*.0085*aspect*.55)]);
 for(let i=0;i<=600;i++){const t=i/600*Math.PI*2,X=16*Math.sin(t)**3,Y=13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t);heart.push([place('open',1-(.5+X*.0085),.62-Y*.0085*aspect*.55)]);}
 await path(heart);
 const sewn=await get(()=>{const e=__machineStudio.machine.embroidery,xs=[...e.x.slice(0,e.count)],zs=[...e.z.slice(0,e.count)];return {n:e.count,w:Math.max(...xs)-Math.min(...xs),h:Math.max(...zs)-Math.min(...zs),draw:__machineStudio.engine.live.draw};});
 assert.ok(sewn.n>40,`stitches drawn: ${sewn.n}`);assert.ok(sewn.w>30&&sewn.h>30,`a shape, not a line: ${sewn.w}x${sewn.h}`);assert.ok(sewn.draw>.9,'looking down on the cloth');
 assert.match(await page.locator('#machine-caption').textContent(),/Free motion/);await clear();await shot('heart');
 await until(()=>__machineStudio.engine.live.draw<.05,null,8000);assert.ok(await get(()=>__machineStudio.machine.embroidery.count)>=sewn.n,'the drawing stays in the cloth');
 // Pinch the top thread: down feeds slack, up pulls tight, too far snaps; the next stitches show it.
 await page.locator('#machine-recenter').click();await page.waitForTimeout(1800);
 const on=await get(()=>__machineStudio.engine.threadScreen(0)),grip=pinchAt(on.x,on.y);
 await feed([place('pinch',grip.x,grip.y)]);await until(()=>!!__machineStudio.engine.live.tension.held,null,4000);
 for(let i=1;i<=12;i++){await feed([place('pinch',grip.x,grip.y+i*.01)]);await page.waitForTimeout(30);}
 await until(()=>__machineStudio.machine.tension<.25);assert.match(await page.locator('#machine-caption').textContent(),/Slack/);assert.equal(await page.locator('.machine-gauge').isVisible(),true);
 await sew(2);assert.ok(await get(()=>__machineStudio.machine.stitches.at(-1).tension)<.3,'a slack lock');await shot('tension-slack');
 for(let i=1;i<=24;i++){await feed([place('pinch',grip.x,grip.y+.12-i*.01)]);await page.waitForTimeout(30);}
 await until(()=>__machineStudio.machine.tension>.75);assert.match(await page.locator('#machine-caption').textContent(),/Tight/);
 await sew(2);assert.ok(await get(()=>__machineStudio.machine.stitches.at(-1).tension)>.7,'a tight lock');await shot('tension-tight');
 for(let i=1;i<=12;i++){await feed([place('pinch',grip.x,grip.y-.12-i*.01)]);await page.waitForTimeout(30);}
 await until(()=>__machineStudio.machine.broken);assert.match(await page.locator('#machine-caption').textContent(),/Snapped/);
 await clear();await until(()=>!__machineStudio.machine.broken);
 // Tear: apart, and still running, with the links glowing between parts.
 await feed([place('pinch',.4),place('pinch',.6)]);await page.waitForTimeout(350);await feed([place('pinch',.2),place('pinch',.8)]);await until(()=>__machineStudio.engine.live.explode>.6);
 const torn=await get(()=>__machineStudio.machine.crank);await until(c=>__machineStudio.machine.crank>c+20&&__machineStudio.engine.live.explode>.6,torn,4000);await shot('apart');await clear();
 // Shock stops time, labels every part, and a second clap lets it run.
 await until(()=>__machineStudio.engine.live.explode<.05);
 const clap=async()=>{await feed([place('open',.15),place('open',.85)]);await page.waitForTimeout(350);await feed([place('open',.45),place('open',.55)]);await until(()=>__machineStudio.engine.live.shocks.length>0,null,6000);await clear();};
 await clap();await until(()=>__machineStudio.machine.frozen);
 const stopped=await get(()=>__machineStudio.machine.crank);await until(()=>document.querySelectorAll('.machine-freeze p:not(.machine-clock)').length>=5);
 assert.equal(await get(()=>__machineStudio.machine.crank),stopped,'stopped mid-stitch');assert.match(await page.locator('.machine-clock').textContent(),/Time stopped/);await shot('freeze');
 await page.waitForTimeout(800);await clap();await until(()=>!__machineStudio.machine.frozen,null,4000);assert.equal(await page.locator('.machine-freeze').isVisible(),false);
 // Run to full speed under the strobe, then reverse to unpick.
 await feed([place('thumbUp',.5)]);await until(()=>__machineStudio.machine.spm>700,null,10000);assert.equal(await get(()=>__machineStudio.machine.strobing),true);
 assert.match(await page.locator('.machine-speed').textContent(),/stitches a minute.*strobe/s);const up=await get(()=>__machineStudio.machine.count);await shot('strobe');await clear();
 await feed([place('thumbDown',.5)]);await until(()=>__machineStudio.engine.speed<-.5,null,10000);const back=await get(()=>__machineStudio.machine.count);assert.ok(back>=up);await until(n=>__machineStudio.machine.count<n,back,10000);
 assert.ok(await get(()=>__machineStudio.engine.live.unpicked.length)>0,'an unpicked lock is shown leaving');assert.match(await page.locator('#machine-caption').textContent(),/Unpicking/);await clear();
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
 await pull('takeUp',false);await sew(2);assert.equal(await last(),'loose');assert.match(await cap(),/No take-up/);assert.equal(await get(()=>__machineStudio.machine.close),false,'a removal leaves the framing alone');await page.locator('#machine-recenter').click();
 // Timing fault from the corner control and the keyboard.
 await sew(1);await page.locator('#machine-timing').click();await sew(2);assert.equal(await last(),'skipped');assert.match(await cap(),/late/);
 await page.locator('#machine-viewport').focus();await page.keyboard.press('t');await sew(1);assert.match(await cap(),/early/);await page.keyboard.press('Home');await sew(1);assert.equal(await last(),'formed');
 // The framing control, and the cap on what is kept.
 await page.locator('#machine-framing').click();assert.equal(await get(()=>__machineStudio.machine.close),true);
 await sew(30);assert.ok(await get(()=>__machineStudio.machine.stitches.length)<=24);
 assert.equal(await page.locator('#machine-count').textContent(),String(await get(()=>__machineStudio.machine.count)));
 await page.locator('#machine-sources').click();const about=await page.locator('#machine-about').textContent();assert.match(about,/Elias Howe/);assert.match(about,/1846/);assert.match(about,/1856/);assert.match(about,/light painting/);assert.match(about,/strobe/);await page.locator('#machine-about-close').click();
 assert.deepEqual(errors,[]);console.log('Machine passed: idle, hold, scale both ways, light painting, high-speed film, drawing with thread, thread tension and snap, tear running, time freeze, strobe run, unpick, stir, pull bobbin/feed dog/take-up with consequence, timing late and early, recenter, cap, about.');
}finally{await browser.close();}
