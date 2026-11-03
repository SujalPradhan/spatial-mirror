// Run with tsx against the dev server. Every gesture goes through the real tracker via debug hands. SHOTS=<dir> keeps screenshots.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4196',shots=process.env.SHOTS;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[],checks=[];
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('mirror-tutorial-v1','1'));
// The tracker divides y by the camera's aspect, so hands must be drawn at it.
let aspect=1;const S=.14;
/** `mx,my` is where the hand's reference lands in mirror space: the pinch for a pinch, otherwise the palm-ish root. */
function place(pose,mx,my=.6){
 const h=posedHand(pose),ref=pose==='pinch'?{x:(h[4].x+h[8].x)/2,y:(h[4].y+h[8].y)/2}:{x:0,y:-1};
 return h.map(p=>({x:(1-mx)+(p.x-ref.x)*S,y:my+(p.y-ref.y)*S*aspect,z:p.z*S}));
}
// Events live for one tracker frame and the software renderer is slow, so `ms` lets a one-shot pose or clap land on a rendered frame.
const feed=(hands,ms=33)=>page.evaluate(([h,ms])=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>{window.__perfumeStudio.hands(h);},ms);},[hands,ms]);
const quiet=async()=>{await page.evaluate(()=>clearInterval(window.testFeed));await page.waitForFunction(()=>window.__perfumeStudio.frame.hands.length===0);};
const posed=(...want)=>page.waitForFunction(w=>{const p=window.__perfumeStudio.frame.hands.map(h=>h.pose);return w.every(x=>p.includes(x));},want);
const read=fn=>page.evaluate(fn);
const shot=async name=>{if(shots)await page.screenshot({path:`${shots}/${name}.png`});};
/** A part's middle on stage, in mirror space, wherever it is now. The scene only takes a new view (say after Recenter) on the next animation frame, so wait for two. */
const at=id=>page.evaluate(async id=>{
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const s=window.__perfumeStudio,view=s.view,mesh=view.part(id).motion.children[0],v=document.querySelector('#perfume-video'),a=v.videoWidth/v.videoHeight;
 mesh.geometry.computeBoundingSphere();const p=mesh.localToWorld(mesh.geometry.boundingSphere.center.clone()).project(view.camera),host=document.querySelector('#perfume-viewport'),stage=host.clientWidth/host.clientHeight;
 const x=(p.x+1)/2,y=(1-p.y)/2;
 return a>stage?{x:(x-.5)*stage/a+.5,y}:{x,y:(y-.5)*a/stage+.5};
},id);
const check=m=>{checks.push(m);console.log('ok',m);};
/** Pinch a part where it is, draw it sideways in steps, let go. */
async function pullOut(id,dx=.32,steps=10){
 const from=await at(id);
 await feed([place('pinch',from.x,from.y)]);await posed('pinch');await page.waitForTimeout(150);
 for(let i=1;i<=steps;i++){await feed([place('pinch',from.x+dx*i/steps,from.y)]);await page.waitForTimeout(50);}
 await page.waitForTimeout(250);
}
async function press(){await feed([place('thumbUp',.86,.5)]);await posed('thumbUp');await page.waitForFunction(()=>window.__perfumeStudio.pump.depth>.9);}
const recenter=async()=>{await quiet();await page.locator('#perfume-recenter').click();await page.waitForFunction(()=>window.__perfumeStudio.pump.removed.size===0);};
try{
 await page.goto(base+'/perfume');await page.waitForFunction(()=>window.__perfumeStudio?.ready&&window.__perfumeStudio.owns);
 assert.equal(await page.title(),'Perfume Spray — Spatial Studio');
 assert.ok(await page.locator('.perfume-page').count());
 assert.equal(await page.locator('#perfume-count').textContent(),'0');
 await page.locator('#perfume-camera').click();await page.waitForSelector('#perfume-stage.is-live');
 aspect=await read(()=>{const v=document.querySelector('#perfume-video');return v.videoWidth/v.videoHeight;});
 await shot('01-home');

 // Hold.
 const q0=await read(()=>JSON.stringify(window.__perfumeStudio.state.view));
 await feed([place('fist',.5,.5)]);await posed('fist');await page.waitForTimeout(150);await feed([place('fist',.62,.42)]);
 await page.waitForFunction(q=>JSON.stringify(window.__perfumeStudio.state.view)!==q,q0);await shot('02-hold');check('Hold moves the object');
 await recenter();

 // Scale, into Dive.
 await feed([place('fist',.42,.5),place('fist',.58,.5)]);await page.waitForFunction(()=>window.__perfumeStudio.frame.hands.filter(h=>h.pose==='fist').length===2);await page.waitForTimeout(200);
 await feed([place('fist',.2,.5),place('fist',.8,.5)]);await page.waitForFunction(()=>window.__perfumeStudio.state.view.zoom>=2.4);await page.waitForTimeout(400);await shot('03-dive');
 check(`Two fists scale past the dive threshold (zoom ${(await read(()=>window.__perfumeStudio.state.view.zoom)).toFixed(2)})`);
 await press();await page.waitForTimeout(150);await shot('04-dive-press');
 await recenter();

 // Part: an open hand spreads what is near it.
 const home=await read(()=>window.__perfumeStudio.view.part('stem').group.position.toArray());
 const mid=await at('stem');await feed([place('open',mid.x,mid.y)]);await posed('open');
 await page.waitForFunction(h=>{const p=window.__perfumeStudio.view.part('stem').group.position;return Math.hypot(p.x-h[0],p.y-h[1])>3;},home);await shot('05-part');check('Open hand parts nearby pieces');
 await recenter();

 // Tear explodes everything, and it falls back.
 await feed([place('pinch',.47,.5),place('pinch',.53,.5)]);await page.waitForFunction(()=>window.__perfumeStudio.frame.hands.filter(h=>h.pose==='pinch').length===2);await page.waitForTimeout(150);
 for(const g of [.2,.3,.4]){await feed([place('pinch',.5-g,.5),place('pinch',.5+g,.5)]);await page.waitForTimeout(120);}
 await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.explode>.8);await page.waitForTimeout(250);await shot('06-explode');
 await quiet();await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.explode<.02);check('Two pinches explode it, and it reassembles');

 // Spring out, press, stuck.
 await pullOut('spring');assert.ok(await read(()=>window.__perfumeStudio.pump.removed.has('spring')),'spring is out');
 assert.match(await read(()=>window.__perfumeStudio.caption),/Press to see why/);await shot('07-spring-out');
 await quiet();await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.parked[6]>.8);
 await press();await quiet();await page.waitForTimeout(1200);
 const stuck=await read(()=>({depth:window.__perfumeStudio.pump.depth,stuck:window.__perfumeStudio.pump.stuck,fill:window.__perfumeStudio.pump.chamberFill,caption:window.__perfumeStudio.caption}));
 assert.equal(stuck.stuck,true);assert.equal(stuck.depth,1);assert.equal(stuck.fill,0);assert.match(stuck.caption,/stays down/);
 assert.equal(await page.locator('.perfume-caption').textContent(),stuck.caption);
 await page.locator('#perfume-count').waitFor();assert.equal(await page.locator('#perfume-count').textContent(),'1');await shot('08-spring-stuck');check('Spring out, then press: actuator stays down, no refill, caption from failures, one spray counted');

 // Pinch it again and it goes home.
 const out=await at('spring');await feed([place('pinch',out.x,out.y)]);await posed('pinch');await page.waitForTimeout(200);await quiet();
 await page.waitForFunction(()=>window.__perfumeStudio.pump.removed.size===0&&window.__perfumeStudio.pump.depth===0);check('Plucking it again sends the spring home and the actuator rises');
 await recenter();

 // Swirl out, jet.
 await pullOut('nozzle',.2);assert.ok(await read(()=>window.__perfumeStudio.pump.removed.has('nozzle')),'nozzle is out');
 await quiet();await page.waitForTimeout(300);
 await press();await page.waitForFunction(()=>window.__perfumeStudio.view.droplets>30);await shot('09-jet');
 assert.equal(await read(()=>window.__perfumeStudio.lastSpray),'jet');assert.match(await read(()=>window.__perfumeStudio.caption),/straight jet/);check('Swirl insert out, then press: jet, with its caption');
 await recenter();

 // Press cycle: mist, a count, and Release.
 await page.evaluate(()=>{window.__perfumeStudio.engine.kick(1);});await page.waitForFunction(()=>window.__perfumeStudio.view.droplets>60);await page.waitForTimeout(90);await shot('10-mist');
 assert.equal(await read(()=>window.__perfumeStudio.lastSpray),'mist');await page.waitForFunction(()=>window.__perfumeStudio.pump.doses===1&&window.__perfumeStudio.pump.phase==='rest');check('Press sprays a hollow mist and refills');
 await press();await feed([place('thumbDown',.86,.5)]);await posed('thumbDown');await page.waitForFunction(()=>window.__perfumeStudio.pump.depth===0);check('Thumbs up runs a press, thumbs down lets go');
 await recenter();

 // Direct control: the depth follows the hand.
 const top=await at('actuator');await feed([place('pinch',top.x,top.y)]);await posed('pinch');await page.waitForTimeout(150);
 assert.ok(await read(()=>window.__perfumeStudio.engine.scene.partGlow[10]>.5),'the actuator is what was pinched');
 await feed([place('pinch',top.x,top.y+.012)]);await page.waitForFunction(()=>window.__perfumeStudio.pump.depth>.03);await page.waitForTimeout(500);
 const slow=await read(()=>window.__perfumeStudio.pump.depth);assert.ok(slow>.02&&slow<.28,`a small push stays short of the threshold: ${slow}`);assert.equal(await read(()=>window.__perfumeStudio.pump.dispensedMl),0);await shot('11-push-partial');
 for(let i=2;i<=8;i++){await feed([place('pinch',top.x,top.y+.02*i)]);await page.waitForTimeout(40);}
 await page.waitForFunction(()=>window.__perfumeStudio.pump.doses===1);check(`Pinching the actuator drives depth directly (${slow.toFixed(2)} short of threshold, then through it)`);
 await recenter();

 // Slice goes through the axis, wherever the hand is.
 await feed([place('victory',.8,.5)]);await posed('victory');await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.slice.amount===1);await page.waitForTimeout(100);
 const cut=await read(()=>({x:window.__perfumeStudio.engine.scene.slice.x,pose:window.__perfumeStudio.state.view.x}));assert.equal(cut.x,cut.pose);await shot('12-slice');check('Slice cuts through the object axis');

 // Pull the spring while cut, to see it from inside.
 await pullOut('spring',.3);await feed([place('victory',.8,.5)]);await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.parked[6]>.85);await shot('13-slice-spring-out');
 await recenter();

 // Skin.
 // The camera loop can overwrite a tracker frame before it renders, so a one-shot pose gets a few tries.
 for(const skin of ['frosted','xray','glass']){
  for(let i=0;i<8&&await read(()=>window.__perfumeStudio.engine.scene.skin)!==skin;i++){await feed([place('open',.86,.5)],240);await posed('open');await feed([place('love',.86,.5)],240);await posed('love');await page.waitForTimeout(500);}
  assert.equal(await read(()=>window.__perfumeStudio.engine.scene.skin),skin);await shot(`14-skin-${skin}`);
 }
 check('Skin cycles glass, frosted, x-ray');await quiet();

 // Name: a still finger shows the chip.
 const target=await at('actuator');await feed([place('point',target.x,target.y+.12)]);
 await posed('point');const landed=await read(()=>window.__perfumeStudio.frame.hands[0].indexTip);await feed([place('point',target.x+target.x-landed.x,target.y+.12+target.y-landed.y)]);
 await page.locator('.mirror-chip:visible').waitFor();const chip=await page.locator('.mirror-chip').textContent();assert.ok(chip.length>10,chip);await page.waitForTimeout(100);await shot('15-name');check(`Point names a part: ${chip}`);
 await quiet();
 // Mouse hover too.
 const box=await page.locator('#perfume-viewport').boundingBox(),m=await at('actuator');
 await page.mouse.move(box.x+box.width*m.x,box.y+box.height*(.5+(m.y-.5)*box.width/box.height/aspect));await page.locator('.mirror-chip:visible').waitFor();check('Mouse hover shows the chip');await page.mouse.move(1,1);

 // Shock.
 for(let i=0;i<8&&!await read(()=>window.__perfumeStudio.engine.scene.shocks.length);i++){await feed([place('open',.15,.5),place('open',.85,.5)],240);await page.waitForTimeout(700);await feed([place('open',.45,.5),place('open',.55,.5)],240);await page.waitForTimeout(600);}
 await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.shocks.length>0);await page.waitForTimeout(100);await shot('16-shock');check('Clap fires a shock');await quiet();
 await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.partOffsets.every(n=>Math.abs(n)<.02));check('Shock settles back with nothing left displaced');

 // Copy.
 await page.locator('#perfume-sources').click();const about=await page.locator('#perfume-about').textContent();await shot('17-about');await page.locator('#perfume-about-close').click();
 for(const word of ['illustrative','qualitative','0.065–0.1 ml'])assert.ok(about.includes(word),word);
 assert.equal((await page.locator('#perfume-about a').all()).length,3);
 const gestures=await page.locator('#perfume-gestures').textContent();for(const word of ['Press','Release','Pull out','Name','Dive'])assert.ok(gestures.includes(word),word);
 assert.deepEqual(errors,[]);console.log(`Perfume passed: ${checks.length} checks.`);
}catch(e){console.log('Done so far:',checks);console.log(await page.evaluate(()=>{const s=window.__perfumeStudio;return s&&{hands:s.frame.hands.map(h=>h.pose),view:s.state.view,caption:s.caption,depth:s.pump.depth,removed:[...s.pump.removed],parked:[...s.engine.scene.parked],explode:s.engine.scene.explode};}).catch(()=>null));await shot('zz-failure');console.log(errors);throw e;}finally{await browser.close();}
