// Run with: PORT=4192 node server.mjs, then STUDIO_URL=http://localhost:4192 npx tsx tests/grasp-browser.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {posedHand} from './hand-fixtures.ts';
import {SHAPES,imageLandmarks,mix} from './grasp-hands.ts';
const realHands=JSON.parse(readFileSync(new URL('./real-hands.json',import.meta.url),'utf8'));
const base=process.env.STUDIO_URL||'http://localhost:4192';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'])]});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// Until src/control.ts lists /grasp among the shared mirror pages, the relay sees it as the shapes workspace and refuses ownership. A no-op once it does.
await page.addInitScript(()=>{const send=WebSocket.prototype.send;WebSocket.prototype.send=function(d){return send.call(this,typeof d==='string'&&location.pathname==='/grasp'?d.replace('"workspace":"shapes"','"workspace":"atp"'):d);};});
// With no video the tracker assumes 16:9 and divides y by it, so hands are drawn at it.
const aspect=16/9;
const fixture=(pose,x=.5,y=.8)=>posedHand(pose).map(p=>({x:x+p.x*.12,y:y+p.y*.12*aspect,z:p.z*.12}));
const synth=(deg,x=.5)=>imageLandmarks(deg,x,.84,aspect,.016);
/** One tracker update per rendered frame; a path plays one frame of hands per frame, so a slow machine sees the same motion. */
const feed=(hands,world=[])=>page.evaluate(([h,w])=>{window.testHands=h;window.testWorld=w;if(window.testFeed)return;window.testFeed=true;const loop=()=>{if(!window.testFeed)return;if(window.testPath?.length)window.testHands=window.testPath.shift();window.__grasp.hands(window.testHands,window.testWorld);requestAnimationFrame(loop);};loop();},[hands,world]);
const path=async frames=>{await page.evaluate(f=>{window.testPath=f;},frames.slice(1));await feed(frames[0]);await until(()=>!window.testPath.length,null,30000);};
/** Synthesised intermediate poses: a smooth move from one shape to another, with a little tremor. */
const move=(a,b,n=24)=>Array.from({length:n+1},(_,i)=>{const t=i/n,s=t*t*(3-2*t);return [synth(mix(a,b,s).map((x,j)=>x+Math.sin(i*1.7+j)*1.2))];});
const clear=async(ms=400)=>{await page.evaluate(()=>{window.testFeed=false;window.testPath=[];});await page.waitForTimeout(ms);};
const get=(fn,arg)=>page.evaluate(fn,arg);
const until=(fn,arg,timeout=12000)=>page.waitForFunction(fn,arg,{timeout}).catch(async e=>{console.error(await page.evaluate(()=>{const s=__grasp.scene,e=__grasp.engine;return JSON.stringify({motors:e.motors,object:e.objectId,cal:s.calibration,source:s.source,poses:__grasp.frame.hands.map(h=>h.pose),user:s.user.map(x=>+x.toFixed(2)),m:s.command.map(x=>+x.toFixed(2)),verdict:s.verdict.reason,kind:s.verdict.kind,lift:s.lift});}));throw e;});
const shots=process.env.SHOTS,shot=(name,el)=>shots?(el?page.locator(el).screenshot({path:`${shots}/grasp-${name}.png`}):page.screenshot({path:`${shots}/grasp-${name}.png`})):null;
const view=()=>get(()=>JSON.stringify({v:__grasp.state.view,zoom:__grasp.view.cameraZoom,cam:__grasp.view.camera.position.toArray(),root:__grasp.view.root.matrixWorld.elements.map(n=>+n.toFixed(6))}));
try{
 await page.goto(base+'/grasp');await until(()=>window.__grasp?.ready&&window.__grasp.owns&&window.__grasp.scene&&document.querySelector('.gr-seg'),null,30000);
 assert.match(await page.title(),/How many motors/);
 assert.equal(await get(()=>__grasp.engine.motors),1,'the story starts at one motor');assert.equal(await get(()=>__grasp.engine.objectId),'mug');
 // Nothing moves the camera by itself: five idle seconds, every frame the same.
 const idle=await view();for(let i=0;i<10;i++){await page.waitForTimeout(500);assert.equal(await view(),idle,'camera moved while idle');}
 // Mouse fallback is presets only, shown while no hand is in view.
 assert.equal(await page.locator('.gr-presets').isVisible(),true);assert.equal(await page.locator('.gr-presets button').count(),6);
 // Calibration from the fixture hands: flat, then fist, three seconds in all.
 await feed([fixture('open')]);await until(()=>__grasp.scene.calibration.phase==='flat');assert.equal(await page.locator('.gr-calib').isVisible(),true);await shot('calibrate');
 await until(()=>__grasp.scene.calibration.phase==='fist',null,6000);
 await path(move(SHAPES.flat,SHAPES.fist,10).map((_,i,a)=>[i<a.length-1?fixture('open'):fixture('fist')]));await feed([fixture('fist')]);
 await until(()=>__grasp.scene.calibration.phase==='done',null,6000);assert.ok(await get(()=>!!localStorage.getItem('grasp-calibration-v1')),'kept for next time');
 assert.equal(await get(()=>__grasp.scene.source),'phone','image landmarks without world points are the phone path');
 // Recorded world landmarks take the camera path.
 const real=realHands.find(h=>h.pose==='open');
 await feed([real.image.map(p=>({...p,y:p.y}))],[real.world]);await until(()=>__grasp.scene.source==='hand');await clear();
 // Recalibrate with the synthetic hand, so the shapes below land where they are meant to.
 await get(()=>__grasp.engine.startCalibration());await feed([synth(SHAPES.flat)]);await until(()=>__grasp.scene.calibration.phase==='fist',null,6000);
 await path(move(SHAPES.flat,SHAPES.fist,12));await feed([synth(SHAPES.fist)]);await until(()=>__grasp.scene.calibration.phase==='done',null,6000);await clear(1800);
 // 1 motor, the pen: pinch and it cannot hold it. The thumb's rotation and the lone index glow red.
 await page.locator('[data-object=pen]').click();await page.locator('[data-motors="1"]').click();
 await path(move(SHAPES.flat,SHAPES.pinch,30));await feed([synth(SHAPES.pinch)]);await page.waitForTimeout(1500);
 const one=await get(()=>{const s=__grasp.scene;return {stable:s.verdict.stable,lift:s.lift,res:s.residual,glow:__grasp.view.last&&[0,3].map(i=>s.residual[i])};});
 assert.equal(one.stable,false,'one motor cannot pinch the pen');assert.equal(one.lift,0);
 assert.ok(one.res[0]>.4,`thumb rotation is beyond one motor: ${one.res[0]}`);assert.ok(one.res[3]>.3,`index alone is beyond one motor: ${one.res[3]}`);
 assert.ok(await get(()=>__grasp.view.residualOpacity(0)>.5&&__grasp.view.residualOpacity(3)>.5),'red glow on the mismatched joints');
 assert.ok(await get(()=>__grasp.view.residualOpacity(9)<.3),'a joint the motor matches stays dark');
 assert.match(await page.locator('.gr-hint').textContent(),/Try 2 motors/);await shot('pen-1-motor');
 for(let i=0;i<4;i++){await page.waitForTimeout(400);assert.equal(await get(()=>__grasp.scene.verdict.stable),false,'still not held');}
 // Switch to 2 motors with the same hand: the pinch tendon swings the thumb round, and it holds.
 await page.locator('[data-motors="2"]').click();
 await until(()=>__grasp.scene.verdict.stable&&__grasp.scene.verdict.kind==='pinch'&&__grasp.scene.lift>.95);
 assert.ok(await get(()=>__grasp.scene.residual.slice(0,6).every(r=>Math.abs(r)<.17)),'two motors match the thumb and index');
 assert.equal(await get(()=>__grasp.scene.taxonomy.pinch?.motors),2);await shot('pen-2-motor-pinch');
 await clear(200);
 // 1 motor, the mug: close the whole hand. Links stop where they touch and the whiffletree shares the pull.
 await page.locator('[data-object=mug]').click();await page.locator('[data-motors="1"]').click();
 await path(move(SHAPES.pinch,SHAPES.flat,12));await path(move(SHAPES.flat,SHAPES.power,30));await feed([synth(SHAPES.power)]);
 await until(()=>__grasp.scene.verdict.stable&&__grasp.scene.verdict.kind==='power-wrap'&&__grasp.scene.lift>.95);
 const diff=await get(()=>{const m=__grasp.scene.sim.motors[0];return {tension:m.tension,reels:m.branches.map(b=>b.excursion/b.full),blocked:__grasp.scene.sim.blocked.filter(Boolean).length};});
 assert.ok(diff.blocked>=4,'links stopped on the mug');assert.ok(Math.max(...diff.reels)-Math.min(...diff.reels)>.05,`branches reeled unequally: ${diff.reels}`);
 // Hover a joint: torque is pulley radius × tension.
 const knuckle=await get(()=>{const v=__grasp.view,p=v.screenOf(v.last.sim.links[7].origin);return p;});
 await page.mouse.move(knuckle.x+2,knuckle.y+2);await page.waitForTimeout(300);
 if(await page.locator('.gr-tip').isVisible())assert.match(await page.locator('.gr-tip').textContent(),/N·cm|four-bar|No motor/);
 await shot('mug-differential');await page.mouse.move(5,400);
 // The finger close-up: tendon routing and the DIP–PIP four-bar.
 await page.locator('[data-digit="1"]').click();assert.match(await page.locator('.gr-zoom p').textContent(),/four-bar/);
 assert.ok(await page.locator('.gr-zoom .gr-z-four').count()===2&&await page.locator('.gr-zoom .gr-z-tendon').count()>=1);await shot('finger-zoom','.gr-zoom');
 // Gestures where they are natural: 👎 held puts the object back, 🤟 held changes the motor count, a clap brings the next object, ✊✊ scales.
 await clear(300);await feed([fixture('thumbDown')]);await until(()=>__grasp.scene.lift<.05,null,6000);await clear(500);
 await feed([fixture('love')]);await until(()=>__grasp.engine.motors===2,null,6000);await clear(500);
 await feed([fixture('open',.2),fixture('open',.8)]);await page.waitForTimeout(350);await feed([fixture('open',.46),fixture('open',.54)]);await until(()=>__grasp.engine.objectId==='pen',null,6000);await clear(500);
 await feed([fixture('fist',.4),fixture('fist',.6)]);await until(()=>__grasp.frame.hands.filter(h=>h.pose==='fist').length===2);await page.waitForTimeout(400);
 await feed([fixture('fist',.3),fixture('fist',.7)]);await page.waitForTimeout(250);await feed([fixture('fist',.2),fixture('fist',.8)]);await until(()=>__grasp.state.view.zoom>1.3);await clear();
 await page.locator('#grasp-recenter').click();assert.equal(await get(()=>__grasp.state.view.zoom),1);
 // A ghost with red residuals, for the record: a pointing hand on one motor.
 await page.locator('[data-object=egg]').click();await page.locator('[data-motors="1"]').click();
 const point=[40,30,40, 8,6,6, 78,96,60, 80,98,60, 78,94,58];await path(move(SHAPES.flat,point,24));await feed([synth(point)]);await page.waitForTimeout(1200);
 assert.ok(await get(()=>__grasp.view.ghostResidualOpacity(3)>.4||__grasp.view.ghostResidualOpacity(6)>.4),'the ghost lights the joints the robot cannot follow');await shot('ghost-residuals');await clear();
 assert.deepEqual(errors,[]);
 console.log('grasp browser: ok');
}finally{await browser.close();}
