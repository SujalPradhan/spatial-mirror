// Run with tsx against the dev server: STUDIO_URL=http://localhost:4197 npx tsx tests/machine-assist-browser.mjs. SHOTS=<dir> keeps screenshots.
// The camera holds still unless the viewer moves it, and the thread is easy to catch.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4197',shots=process.env.SHOTS;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'])]});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// As machine-browser: no camera runs, the stage maps 1:1 and the tracker's default aspect is 16:9.
const aspect=16/9,S=.14;
/** A hand partway from open (0) to pinched (1), placed so the thumb and index midpoint lands on a stage point. */
function closing(t,mx,my){
 const open=posedHand('open'),shut=posedHand('pinch'),h=open.map((p,i)=>({x:p.x+(shut[i].x-p.x)*t,y:p.y+(shut[i].y-p.y)*t,z:p.z+(shut[i].z-p.z)*t}));
 const mid={x:(h[4].x+h[8].x)/2,y:(h[4].y+h[8].y)/2};
 return h.map(p=>({x:1-mx+(p.x-mid.x)*S,y:my+(p.y-mid.y)*S*aspect,z:p.z*S}));
}
const pinchAt=(mx,my)=>closing(1,mx,my);
const openAt=(mx,my)=>{const h=posedHand('open'),palm=[0,5,9,13,17].reduce((a,i)=>({x:a.x+h[i].x/5,y:a.y+h[i].y/5}),{x:0,y:0});return h.map(p=>({x:1-mx+(p.x-palm.x)*S,y:my+(p.y-palm.y)*S*aspect,z:p.z*S}));};
const feed=hands=>page.evaluate(h=>{window.testHands=h;if(window.testFeed)return;window.testFeed=true;const loop=()=>{if(!window.testFeed)return;window.__machineStudio.hands(window.testHands);requestAnimationFrame(loop);};loop();},hands);
const clear=async()=>{await page.evaluate(()=>{window.testFeed=false;});await page.waitForTimeout(1200);};
const get=(fn,arg)=>page.evaluate(fn,arg);
const until=(fn,arg,timeout=8000)=>page.waitForFunction(fn,arg,{timeout});
const shot=name=>shots?page.screenshot({path:`${shots}/machine-assist-${name}.png`}):null;
/** Pixels from a stage point to the drawn top thread. */
const threadPx=(x,y)=>get(([x,y])=>{const e=__machineStudio.engine,w=e.world,r=document.querySelector('#machine-viewport').getBoundingClientRect();return w.threadDistance(w.pointToWorld(r.left+x*r.width,r.top+y*r.height));},[x,y]);
const camera=()=>get(()=>{const s=__machineStudio.engine.live;return {scale:s.scale,focus:[...s.focus],zoom:__machineStudio.state.view.zoom,q:__machineStudio.state.view.q.join(),draw:s.draw,close:s.close};});
try{
 await page.goto(base+'/machine');await until(()=>window.__machineStudio?.ready&&window.__machineStudio.owns&&document.querySelector('#machine-caption'),null,20000);
 // 1. Nothing touched for five seconds: the motor idles, the camera does not move at all.
 const first=await camera(),moved=[];
 for(let i=0;i<50;i++){await page.waitForTimeout(100);const c=await camera();if(JSON.stringify(c)!==JSON.stringify(first))moved.push(c);}
 assert.deepEqual(moved,[],'no camera change with no input');assert.ok(await get(()=>__machineStudio.engine.position)>20,'while the idle motor sews');
 console.log('ok no camera move in 5 s without input, scale',first.scale);
 // 2. Fingers closing near the thread: a reticle snaps gold to it and the thread lights up.
 const on=await get(()=>__machineStudio.engine.threadScreen(.3)),W=1280,H=800;
 let spot=null;for(let dx=20;dx<=90&&!spot;dx+=2){const x=on.x+dx/W,d=await threadPx(x,on.y);if(d>=46&&d<=54)spot={x,y:on.y,d};}
 assert.ok(spot,'found a point 50 px from the thread');
 await feed([closing(.62,spot.x,spot.y)]);
 await until(()=>(__machineStudio.engine.live.aims??[]).some(a=>a.kind==='reticle'&&a.target));
 await until(()=>__machineStudio.engine.live.threadHot>.6);
 const snapped=await get(()=>{const a=__machineStudio.engine.live.aims.find(a=>a.kind==='reticle'),w=__machineStudio.engine.world;return {to:w.threadDistance(a.target),from:w.threadDistance(a)};});
 assert.ok(snapped.to<4&&snapped.from>40,`the reticle snaps from ${snapped.from.toFixed(0)} px out onto the thread (${snapped.to.toFixed(1)} px)`);
 await page.waitForTimeout(150);await shot('reticle');console.log('ok a closing pinch shows a reticle snapped to the thread',spot.d.toFixed(0),'px away');
 // 3. The pinch lands: the thread is held, and the camera stays exactly where it was while it is pulled.
 const before=await camera();await feed([pinchAt(spot.x,spot.y)]);await until(()=>!!__machineStudio.engine.live.tension.held,null,4000);
 const far=[];
 for(let i=1;i<=15;i++){const y=spot.y-i*.006;await feed([pinchAt(spot.x,y)]);await page.waitForTimeout(100);const c=await camera();if(c.scale!==before.scale||c.focus.join()!==before.focus.join()||c.zoom!==before.zoom)far.push(c);const d=await threadPx(spot.x,y);if(d>60)far.push({d});}
 assert.deepEqual(far,[],'grabbing and pulling the thread changes no camera scale, and the thread stays at the fingers');
 const pulled=await get(()=>__machineStudio.machine.tension);assert.ok(pulled>.6,`pulled up, tighter: ${pulled}`);await shot('held');
 await clear();assert.equal(await get(()=>__machineStudio.machine.held),null);
 assert.ok(Math.abs(await get(()=>__machineStudio.machine.tension)-pulled)<.03,'let go, the tension is kept');
 console.log('ok held thread, camera unchanged, tension kept on release',pulled.toFixed(2));
 // 4. A pinch that lands 50 px from the thread with no approach at all still catches it.
 const on2=await get(()=>__machineStudio.engine.threadScreen(.6));let spot2=null;
 for(let dx=20;dx<=90&&!spot2;dx+=2){const x=on2.x-dx/W,d=await threadPx(x,on2.y);if(d>=46&&d<=54)spot2={x,y:on2.y,d};}
 assert.ok(spot2);await feed([pinchAt(spot2.x,spot2.y)]);await until(()=>!!__machineStudio.engine.live.tension.held,null,4000);
 console.log('ok a direct pinch',spot2.d.toFixed(0),'px from the thread catches it');await clear();
 // 5. A pinch on nothing leaves a small ring at the fingertips.
 await feed([pinchAt(.12,.35)]);await until(()=>(__machineStudio.engine.live.aims??[]).some(a=>a.kind==='miss'));await page.waitForTimeout(60);await shot('miss');await clear();
 console.log('ok a missed pinch shows a ring');
 // 6. An open palm counts in with a filling ring before free motion tips the view.
 const cam=await camera();await feed([openAt(.2,.62)]);
 await until(()=>__machineStudio.machine.arming>.5);await shot('arming');assert.equal(await get(()=>__machineStudio.machine.drawing),false);assert.equal((await camera()).draw,cam.draw);
 await until(()=>__machineStudio.machine.drawing,null,4000);await clear();
 console.log('ok a still palm fills the ring, then draws');
 assert.deepEqual(errors,[]);console.log('Machine assist passed.');
}finally{await browser.close();}
