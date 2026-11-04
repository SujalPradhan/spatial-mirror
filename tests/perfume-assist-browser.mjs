// Run with tsx against the dev server: STUDIO_URL=http://localhost:4197 npx tsx tests/perfume-assist-browser.mjs. SHOTS=<dir> keeps screenshots.
// The framing holds still under the hands, the dive and a pull-out say what they are about to do, and a closing pinch shows its target.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4197',shots=process.env.SHOTS;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'])]});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('mirror-tutorial-v1','1'));
let aspect=1;const S=.14;
/** A hand from open (0) to pinched (1), its thumb and index midpoint on mirror point mx,my; other poses by their palm root, as perfume-browser places them. */
function place(pose,mx,my=.6,t=1){
 if(pose!=='closing'&&pose!=='pinch'){const h=posedHand(pose);return h.map(p=>({x:(1-mx)+(p.x-0)*S,y:my+(p.y+1)*S*aspect,z:p.z*S}));}
 const open=posedHand('open'),shut=posedHand('pinch'),k=pose==='pinch'?1:t,h=open.map((p,i)=>({x:p.x+(shut[i].x-p.x)*k,y:p.y+(shut[i].y-p.y)*k,z:p.z+(shut[i].z-p.z)*k})),mid={x:(h[4].x+h[8].x)/2,y:(h[4].y+h[8].y)/2};
 return h.map(p=>({x:(1-mx)+(p.x-mid.x)*S,y:my+(p.y-mid.y)*S*aspect,z:p.z*S}));
}
const feed=(hands,ms=33)=>page.evaluate(([h,ms])=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>{window.__perfumeStudio.hands(h);},ms);},[hands,ms]);
const quiet=async()=>{await page.evaluate(()=>clearInterval(window.testFeed));await page.waitForFunction(()=>window.__perfumeStudio.frame.hands.length===0);};
const read=(fn,arg)=>page.evaluate(fn,arg);
const shot=async name=>{if(shots)await page.screenshot({path:`${shots}/perfume-assist-${name}.png`});};
const frames=n=>page.evaluate(n=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);}),n);
const at=id=>page.evaluate(async id=>{
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const s=window.__perfumeStudio,view=s.view,mesh=view.part(id).motion.children[0],v=document.querySelector('#perfume-video'),a=v.videoWidth/v.videoHeight;
 mesh.geometry.computeBoundingSphere();const p=mesh.localToWorld(mesh.geometry.boundingSphere.center.clone()).project(view.camera),host=document.querySelector('#perfume-viewport'),stage=host.clientWidth/host.clientHeight;
 const x=(p.x+1)/2,y=(1-p.y)/2;return a>stage?{x:(x-.5)*stage/a+.5,y}:{x,y:(y-.5)*a/stage+.5};
},id);
const framing=()=>read(()=>{const v=window.__perfumeStudio.view;return {scale:v.body.scale.x,y:v.body.position.y,zoom:window.__perfumeStudio.state.view.zoom};});
try{
 await page.goto(base+'/perfume');await page.waitForFunction(()=>window.__perfumeStudio?.ready&&window.__perfumeStudio.owns,null,{timeout:60000});
 await page.locator('#perfume-camera').click();await page.waitForSelector('#perfume-stage.is-live');
 aspect=await read(()=>{const v=document.querySelector('#perfume-video');return v.videoWidth/v.videoHeight;});
 // Nothing touched for five seconds: the framing does not move.
 const first=await framing(),moved=[];
 for(let i=0;i<25;i++){await page.waitForTimeout(200);const f=await framing();if(Math.abs(f.scale-first.scale)>1e-9||Math.abs(f.y-first.y)>1e-9||f.zoom!==first.zoom)moved.push(f);}
 assert.deepEqual(moved,[],'no framing change with no input');console.log('ok no framing change in 5 s without input');
 // Fingers closing on the actuator: a gold reticle on it, and the part lights before it is taken.
 const top=await at('actuator');await feed([place('closing',top.x,top.y,.6)]);
 await page.waitForFunction(()=>(window.__perfumeStudio.engine.scene.aims??[]).some(a=>a.kind==='reticle'&&a.target));
 await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.partGlow[10]>.2);await frames(3);await shot('reticle');console.log('ok a closing pinch shows a reticle and lights the actuator');await quiet();
 // A part drawn out is only offered until the hand lets go.
 const spring=await at('spring');await feed([place('pinch',spring.x,spring.y)]);await page.waitForFunction(()=>window.__perfumeStudio.frame.hands[0]?.pose==='pinch');await page.waitForTimeout(150);
 for(let i=1;i<=10;i++){await feed([place('pinch',spring.x+.032*i,spring.y)]);await page.waitForTimeout(50);}
 await page.waitForFunction(()=>/Let go to take the spring out/.test(window.__perfumeStudio.caption));await shot('release-to-remove');
 for(let i=9;i>=0;i--){await feed([place('pinch',spring.x+.032*i,spring.y)]);await page.waitForTimeout(50);}
 await page.waitForFunction(()=>window.__perfumeStudio.caption==='');await quiet();await page.waitForTimeout(800);
 assert.equal(await read(()=>window.__perfumeStudio.pump.removed.size),0,'brought back before letting go, it stays in');console.log('ok pull-out shows "let go to take it out", and bringing it back keeps it');
 // Tear: the framing holds while the hands are apart, and eases only after they let go.
 const still=await framing();
 await feed([place('pinch',.47,.5),place('pinch',.53,.5)]);await page.waitForFunction(()=>window.__perfumeStudio.frame.hands.filter(h=>h.pose==='pinch').length===2);await frames(4);
 // Waited in time, not frames: a fast renderer would otherwise jump the hands further than the tracker matches.
 for(const g of [.1,.2,.3,.4]){await feed([place('pinch',.5-g,.5),place('pinch',.5+g,.5)]);await page.waitForTimeout(120);}
 await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.explode>.8,null,{timeout:5000}).catch(async e=>{console.log(await read(()=>({explode:window.__perfumeStudio.engine.scene.explode,hands:window.__perfumeStudio.frame.hands.map(h=>[h.pose,h.pinch.x.toFixed(2)])})));throw e;});await page.waitForTimeout(400);
 const torn=await framing();assert.ok(Math.abs(torn.scale-still.scale)<1e-6&&Math.abs(torn.y-still.y)<1e-6,`the framing holds mid-tear: ${JSON.stringify([still,torn])}`);await shot('tear-held');
 await quiet();await page.waitForFunction(()=>window.__perfumeStudio.engine.scene.explode<.02);console.log('ok tearing apart keeps the framing under the fingers');
 // Scale toward the dive: a cue shows how near the threshold is before anything changes.
 await feed([place('fist',.44,.5),place('fist',.56,.5)]);await page.waitForFunction(()=>window.__perfumeStudio.frame.hands.filter(h=>h.pose==='fist').length===2);await frames(4);
 let cued=null;
 for(const g of [.08,.1,.12,.14,.16,.18,.2,.22,.24,.26]){await feed([place('fist',.5-g,.5),place('fist',.5+g,.5)]);await page.waitForTimeout(120);const z=await read(()=>window.__perfumeStudio.state.view.zoom);if(z>1.45&&z<1.8&&!cued&&await page.locator('.perfume-dive-cue').isVisible()){cued=z;await shot('dive-cue');}}
 assert.ok(cued,'the dive cue shows before the threshold');await quiet();console.log(`ok the dive cue shows at zoom ${cued.toFixed(2)}, before the 1.8 threshold`);
 assert.deepEqual(errors,[]);console.log('Perfume assist passed.');
}finally{await browser.close();}
