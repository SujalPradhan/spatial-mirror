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
/** Mirror point under a world point the view computes, e.g. 'view.plume(40)'. */
const atWorld=expr=>page.evaluate(async expr=>{
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const view=window.__perfumeStudio.view,p=eval(expr).clone().project(view.camera),v=document.querySelector('#perfume-video'),a=v.videoWidth/v.videoHeight,host=document.querySelector('#perfume-viewport'),stage=host.clientWidth/host.clientHeight;
 const x=(p.x+1)/2,y=(1-p.y)/2;
 return a>stage?{x:(x-.5)*stage/a+.5,y}:{x,y:(y-.5)*a/stage+.5};
},expr);
/** Waits for n rendered frames: the software renderer can be slower than the hand feed. */
const frames=n=>page.evaluate(n=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);}),n);
const until=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:90000});
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
 await page.goto(base+'/perfume');await page.waitForFunction(()=>window.__perfumeStudio?.ready&&window.__perfumeStudio.owns,null,{timeout:60000});
 assert.equal(await page.title(),'Perfume Spray — Spatial Studio');
 assert.ok(await page.locator('.perfume-page').count());
 assert.equal(await page.locator('#perfume-count').textContent(),'0');
 await page.locator('#perfume-camera').click();await page.waitForSelector('#perfume-stage.is-live');
 aspect=await read(()=>{const v=document.querySelector('#perfume-video');return v.videoWidth/v.videoHeight;});
 await shot('01-home');

 // Hold.
 const q0=await read(()=>JSON.stringify(window.__perfumeStudio.state.view));
 await feed([place('fist',.5,.5)]);await posed('fist');await frames(4);await feed([place('fist',.62,.42)]);
 await page.waitForFunction(q=>JSON.stringify(window.__perfumeStudio.state.view)!==q,q0);await shot('02-hold');check('Hold moves the object');
 await recenter();

 // Scale, into Dive.
 // A loaded software renderer can drop the grip between frames, so the gesture is tried again rather than timed tighter.
 for(let k=0;k<4&&await read(()=>window.__perfumeStudio.state.view.zoom)<2.4;k++){
  await quiet();await feed([place('fist',.42,.5),place('fist',.58,.5)]);await page.waitForFunction(()=>window.__perfumeStudio.frame.hands.filter(h=>h.pose==='fist').length===2);await frames(4);
  for(const g of [.14,.22,.3]){await feed([place('fist',.5-g,.5),place('fist',.5+g,.5)]);await frames(2);}
  await page.waitForFunction(()=>window.__perfumeStudio.state.view.zoom>=2.4,null,{timeout:15000}).catch(()=>{});
 }
 await until(()=>window.__perfumeStudio.state.view.zoom>=2.4);await page.waitForTimeout(400);await shot('03-dive');
 check(`Two fists scale past the dive threshold (zoom ${(await read(()=>window.__perfumeStudio.state.view.zoom)).toFixed(2)})`);
 await press();await page.waitForTimeout(150);await shot('04-dive-press');
 await page.evaluate(()=>window.__perfumeStudio.engine.kick(1));await until(()=>window.__perfumeStudio.view.swirling>20&&window.__perfumeStudio.view.labels.leaders>=1);check('Dive shows liquid spiralling in the swirl chamber, labelled');
 await recenter();

 // Part: an open hand spreads what is near it.
 const home=await read(()=>window.__perfumeStudio.view.part('stem').group.position.toArray());
 const mid=await at('stem');await feed([place('open',mid.x,mid.y)]);await posed('open');
 await page.waitForFunction(h=>{const p=window.__perfumeStudio.view.part('stem').group.position;return Math.hypot(p.x-h[0],p.y-h[1])>3;},home);await shot('05-part');check('Open hand parts nearby pieces');
 await recenter();

 // Tear explodes everything, and it falls back.
 await feed([place('pinch',.47,.5),place('pinch',.53,.5)]);await page.waitForFunction(()=>window.__perfumeStudio.frame.hands.filter(h=>h.pose==='pinch').length===2);await frames(4);
 for(const g of [.2,.3,.4]){await feed([place('pinch',.5-g,.5),place('pinch',.5+g,.5)]);await frames(2);}
 await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.explode>.8);await page.waitForTimeout(250);await shot('06-explode');
 await until(()=>window.__perfumeStudio.view.labels.leaders>=10);check(`Tear opens an atelier view with ${await read(()=>window.__perfumeStudio.view.labels.leaders)} named parts on leader lines`);
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
 await page.evaluate(()=>{window.__perfumeStudio.engine.kick(1);});await until(()=>window.__perfumeStudio.lastSpray==='mist'&&window.__perfumeStudio.view.droplets>60);await page.waitForTimeout(90);await shot('10-mist');
 assert.equal(await read(()=>window.__perfumeStudio.lastSpray),'mist');await page.waitForFunction(()=>window.__perfumeStudio.pump.doses===1&&window.__perfumeStudio.pump.phase==='rest');check('Press sprays a hollow mist and refills');
 // The mist becomes scent: notes bloom with labels, and top evaporates before base.
 await until(()=>window.__perfumeStudio.view.notes.every(n=>n>0)&&window.__perfumeStudio.view.labels.notes[0]);await shot('10b-notes');
 assert.match(await page.locator('.perfume-note[data-note=top]').textContent(),/Top/);
 await until(()=>{const n=window.__perfumeStudio.view.notes;return n[0]===0&&n[2]>0;});check('Mist turns into labelled scent notes, and the top notes fade before the base');
 // A pointing finger stirs the lingering scent.
 const air=await atWorld('view.plume(30)');
 for(let i=0;i<14&&!await read(()=>window.__perfumeStudio.view.stirred>0);i++){const a=i*.9;await feed([place('point',air.x+Math.cos(a)*.05,air.y+.1+Math.sin(a)*.05)]);await page.waitForTimeout(120);}
 await until(()=>window.__perfumeStudio.view.stirred>0);check('A pointing finger swirls the wisps');await quiet();
 await press();await until(()=>window.__perfumeStudio.view.wisps>5&&window.__perfumeStudio.pump.depth>.9);
 await feed([place('thumbDown',.86,.5)]);await posed('thumbDown');
 const back=await page.waitForFunction(()=>{const s=window.__perfumeStudio;return s.engine.scene.rewind>=0&&s.view.inFlight()>0&&s.pump.depth>.5&&{flying:s.view.inFlight(),depth:s.pump.depth};},null,{timeout:30000,polling:16});await shot('10c-rewind');
 await page.waitForFunction(()=>window.__perfumeStudio.pump.depth===0,null,{timeout:30000});assert.equal(await read(()=>window.__perfumeStudio.view.inFlight()),0,'everything in flight is home before the actuator is up');
 check(`Thumbs down rewinds: ${(await back.jsonValue()).flying} in flight stream home, then the actuator rises`);
 await quiet();
 // A palm in the mist catches it, and a dry-down plays on the hand instead of parting the pump.
 await recenter();const actuatorHome=await read(()=>window.__perfumeStudio.view.part('nozzle').group.position.toArray());
 const plume=await atWorld('view.plume(45)');await feed([place('open',plume.x,plume.y+.1),place('thumbUp',.1,.8)]);
 await until(()=>window.__perfumeStudio.view.caught>3&&window.__perfumeStudio.view.labels.dry);await shot('10d-palm');
 assert.ok(await page.evaluate(h=>{const p=window.__perfumeStudio.view.part('nozzle').group.position;return Math.hypot(p.x-h[0],p.y-h[1])<1;},actuatorHome),'a catching palm does not part the pump');
 await feed([place('open',plume.x,plume.y+.1)]);await until(()=>window.__perfumeStudio.view.dryClock>6);
 assert.match(await page.locator('.perfume-drydown .is-lead').textContent(),/Heart|Base/);check('An open palm in the mist catches droplets and plays the dry-down on the hand, top then heart then base');await quiet();
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
 await page.evaluate(()=>window.__perfumeStudio.engine.kick(1));await until(()=>window.__perfumeStudio.view.droplets>10&&window.__perfumeStudio.view.labels.lens);
 await until(()=>window.__perfumeStudio.engine.scene.time<.1);assert.match(await page.locator('.perfume-loupe p').textContent(),/µm/);await shot('12b-bullet');check('Slice is bullet time: the spray crawls and a loupe shows droplets against a micrometre scale bar');

 // Pull the spring while cut, to see it from inside.
 await pullOut('spring',.3);await feed([place('victory',.8,.5)]);await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.parked[6]>.85);await shot('13-slice-spring-out');
 await recenter();

 // Skin.
 // The camera loop can overwrite a tracker frame before it renders, so a one-shot pose gets a few tries.
 for(const skin of ['pebble','prism','tower']){
  for(let i=0;i<8&&await read(()=>window.__perfumeStudio.engine.scene.skin)!==skin;i++){await feed([place('open',.86,.5)],240);await posed('open');await feed([place('love',.86,.5)],240);await posed('love');await page.waitForTimeout(500);}
  assert.equal(await read(()=>window.__perfumeStudio.engine.scene.skin),skin);await until(s=>window.__perfumeStudio.view.weights[['tower','pebble','prism'].indexOf(s)]>.99,skin);await shot(`14-skin-${skin}`);
 }
 check('Skin morphs the flacon: pebble, prism, then back to the tower');await quiet();

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
 await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.shocks.length>0);await page.waitForTimeout(100);await shot('16-shock');
 await until(()=>window.__perfumeStudio.view.wisps>150);check('Clap blooms a scent cloud across the stage');await quiet();
 await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.partOffsets.every(n=>Math.abs(n)<.02));check('Shock settles back with nothing left displaced');

 // Copy.
 await page.locator('#perfume-sources').click();const about=await page.locator('#perfume-about').textContent();await shot('17-about');await page.locator('#perfume-about-close').click();
 for(const word of ['illustrative','qualitative','0.065–0.1 ml','top notes','evaporate first','visual reversal'])assert.ok(about.includes(word),word);
 assert.equal((await page.locator('#perfume-about a').all()).length,4);
 const gestures=await page.locator('#perfume-gestures').textContent();for(const word of ['Press','Release','Pull out','Name','Dive'])assert.ok(gestures.includes(word),word);
 assert.deepEqual(errors,[]);console.log(`Perfume passed: ${checks.length} checks.`);
}catch(e){console.log('Done so far:',checks);console.log(await page.evaluate(()=>{const s=window.__perfumeStudio;return s&&{hands:s.frame.hands.map(h=>h.pose),view:s.state.view,caption:s.caption,depth:s.pump.depth,removed:[...s.pump.removed],parked:[...s.engine.scene.parked],explode:s.engine.scene.explode};}).catch(()=>null));await shot('zz-failure');console.log(errors);throw e;}finally{await browser.close();}
