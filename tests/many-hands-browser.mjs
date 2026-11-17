// Run with tsx against the local dev server, which also hosts the local party relay: PORT=4580 npm run dev, STUDIO_URL=http://localhost:4580.
// Phone hand tracking is stubbed with synthetic landmarks; camera, relay, crowd logic and the 3D scene are real.
// Forty more phones are plain sockets on the same relay, so the presenter's frame time can be compared with an empty room.
import {chromium} from 'playwright';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {posedHand} from './hand-fixtures.ts';

const base=process.env.STUDIO_URL||'http://localhost:4580',shots=process.env.SHOTS||'',aspect=4/3;
const hand=(name,cx=.5,cy=.7)=>posedHand(name).map(p=>({x:cx+p.x*.14,y:cy+p.y*.14*aspect,z:p.z*.14}));
const gl=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const bigBrowser=await chromium.launch({channel:'chrome',headless:true,args:gl});
const phoneBrowser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const errors=[];const watch=(page,name)=>{page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(name+': '+e.message));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(shots)await mkdir(shots,{recursive:true});

const stubWorker=()=>{window.testHands=[];window.Worker=class{constructor(){setTimeout(()=>this.onmessage?.({data:{type:'ready',delegate:'CPU'}}),0);}postMessage(m){if(m.type!=='frame')return;m.bitmap.close();setTimeout(()=>this.onmessage?.({data:{type:'result',landmarks:window.testHands,worldLandmarks:[],handedness:[],inferenceMs:1,timestamp:m.timestamp}}),30);}terminate(){}};};
const phoneContext=()=>phoneBrowser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,permissions:['camera']});
const show=(page,name,cx,cy)=>page.evaluate(h=>{window.testHands=h?[h]:[];},name?hand(name,cx,cy):null);
const M=big=>big.evaluate(()=>{const m=window.__manyHands;return {crowd:m.crowd,speed:m.speed,target:m.target,rain:m.rain,drops:m.drops,grip:m.grip,meters:{...m.meters},torn:m.torn,explode:m.explode};});

try{
 const big=await (await bigBrowser.newContext({viewport:{width:1440,height:900}})).newPage();watch(big,'big');
 await big.goto(base+'/many-hands');
 await big.waitForFunction(()=>window.__manyHands?.ready);
 const code=await big.evaluate(()=>window.__manyHands.code);assert.match(code,/^[A-HJ-NP-Z2-9]{5}$/);
 assert.equal(await big.locator('#mh-code').innerText(),code);
 assert.equal(await big.locator('.workspace-nav [aria-current=page]').innerText(),'Many Hands');
 assert.ok(await big.locator('#mh-qr').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<d.length;i+=4)if(d[i]<80)dark++;return dark>1000;}),'the QR code is drawn');
 assert.match(await big.locator('.mh-join-text span').innerText(),/Scan and hold up your hand/);
 assert.equal(await big.locator('#mh-hands').innerText(),'0');
 const idle=await M(big);assert.equal(idle.crowd.n,0);assert.equal(idle.rain,0);assert.ok(idle.speed<20,'the motor only idles with nobody here: '+idle.speed);

 // Hide and show the QR code.
 await big.locator('#mh-hide').click();assert.equal(await big.locator('#mh-qr').isVisible(),false);assert.equal(await big.locator('#mh-code').isVisible(),true);
 await big.locator('#mh-hide').click();assert.equal(await big.locator('#mh-qr').isVisible(),true);

 // Three phones, joined from the link alone: no name or code to type.
 const link=`${base}/many-hands/join?code=${code}`;
 const ctxs=await Promise.all([1,2,3].map(phoneContext));for(const c of ctxs)await c.addInitScript(stubWorker);
 const pages=await Promise.all(ctxs.map(c=>c.newPage()));pages.forEach((p,i)=>watch(p,'phone'+i));
 const [a,b,c]=pages;
 for(const p of pages)await p.goto(link);
 for(const p of pages){
  await p.waitForFunction(()=>window.__manyHandsPhone?.online);
  assert.equal(await p.locator('#mh-start').isHidden(),true,'no start gate off iOS');assert.equal(await p.locator('input').count(),0,'no name or code field');
  assert.equal(await p.locator('#mh-poses li').count(),3);
 }
 await big.waitForFunction(()=>document.querySelector('#mh-joined').textContent==='3 joined');
 await big.waitForSelector('.mh-toasts li');
 assert.match(await big.locator('.mh-toasts li').first().innerText(),/^\+ .+ joined$/);
 const names=await Promise.all(pages.map(p=>p.locator('#mh-name').innerText()));assert.equal(new Set(names).size,3);
 const dots=await Promise.all(pages.map(p=>p.locator('#mh-dot').evaluate(e=>e.style.background)));assert.equal(new Set(dots).size,3,'three colours');
 await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__manyHandsPhone.camera)));

 // Ghost hands appear, in each person's place, and move.
 await show(a,'open',.3,.55);await show(b,'open',.5,.55);await show(c,'open',.7,.55);
 await big.waitForFunction(()=>window.__manyHands.crowd.open===3,null,{timeout:15000});
 const placed=await big.evaluate(()=>window.__manyHands.hands.map(h=>({name:h.name,x:h.x,alpha:h.alpha})));
 assert.ok(placed.every(h=>h.alpha===1),'three ghosts are showing');
 const xs=placed.map(h=>h.x);assert.ok(xs[0]>xs[1]&&xs[1]>xs[2],'a hand on the left of the camera is on the right of the screen, like a mirror: '+xs);
 const before=(await big.evaluate(()=>window.__manyHands.hands))[0];
 await show(a,'open',.62,.7);
 await big.waitForFunction(b=>{const h=window.__manyHands.hands[0];return h.x<b.x-.2&&Math.abs(h.sx-h.x)<.05;},before,{timeout:8000});
 await show(a,'open',.3,.7);await big.waitForFunction(()=>window.__manyHands.hands[0].x>.7);

 // All open: protons rain and the rotor speeds up.
 await big.waitForFunction(()=>window.__manyHands.speed>120&&window.__manyHands.drops>5,null,{timeout:15000});
 const open=await M(big);assert.ok(open.rain>idle.rain+5,'rain '+open.rain);assert.ok(open.speed>idle.speed*8,'speed '+open.speed);assert.ok(open.meters.open>.8&&open.grip<.1);
 await big.waitForFunction(()=>window.__manyHands.rotor>200);
 assert.equal(await big.locator('#mh-hands').innerText(),'3');
 await a.waitForFunction(()=>window.__manyHandsPhone.pose==='open');
 assert.equal(await a.locator('#mh-poses li.is-on').getAttribute('data-pose'),'open');
 await sleep(900);
 if(shots){await big.screenshot({path:shots+'/presenter-3-open.png'});await a.screenshot({path:shots+'/phone-open.png'});}

 // A held, still hand is sent only a few times a second.
 const sent0=await b.evaluate(()=>window.__manyHandsPhone.sent);await sleep(2000);
 const sentPerSec=((await b.evaluate(()=>window.__manyHandsPhone.sent))-sent0)/2;assert.ok(sentPerSec>=1.5&&sentPerSec<=4,'a still hand repeats about every 400 ms: '+sentPerSec);

 // All fist: the grip meter fills and the rotor spins faster than for open hands.
 await Promise.all([a,b,c].map((p,i)=>show(p,'fist',.3+.2*i,.6)));
 await big.waitForFunction(()=>window.__manyHands.crowd.fist===3&&window.__manyHands.meters.fist>.9&&window.__manyHands.grip>.8,null,{timeout:15000});
 await big.waitForFunction(o=>window.__manyHands.speed>o*1.5,open.speed,{timeout:12000});
 const fist=await M(big);assert.ok(fist.speed>open.speed*1.5,`fist ${fist.speed} vs open ${open.speed}`);assert.ok(fist.rain<1&&!fist.torn);
 await a.waitForFunction(()=>window.__manyHandsPhone.pose==='fist');
 await sleep(700);if(shots)await big.screenshot({path:shots+'/presenter-3-fist.png'});

 // Two of three pinching tears it apart; one pinching is not enough; releasing reassembles.
 await show(a,'pinch',.3,.6);await sleep(1200);
 let one=await M(big);assert.equal(one.crowd.pinch,1);assert.equal(one.torn,false,'1 of 3 does not tear');
 await show(b,'pinch',.5,.6);await show(c,'open',.7,.6);
 await big.waitForFunction(()=>window.__manyHands.crowd.pinch===2&&window.__manyHands.crowd.n===3&&window.__manyHands.torn&&window.__manyHands.explode>.6,null,{timeout:15000});
 assert.match(await big.locator('#mh-state').innerText(),/pulled apart/i);
 await sleep(500);if(shots)await big.screenshot({path:shots+'/presenter-3-pull.png'});
 await show(b,'open',.5,.6);
 await sleep(900);assert.equal((await M(big)).torn,true,'one pinch left keeps it apart (hysteresis)');
 await show(a,'open',.3,.6);
 await big.waitForFunction(()=>!window.__manyHands.torn&&window.__manyHands.explode<.1,null,{timeout:15000});
 assert.match(await big.locator('#mh-state').innerText(),/together/i);

 // Orbit with the mouse still works over the ghost layer.
 const q0=await big.evaluate(()=>[...window.__manyHands.pose.q]);
 await big.mouse.move(720,500);await big.mouse.down();await big.mouse.move(820,520,{steps:6});await big.mouse.up();
 assert.notDeepEqual(await big.evaluate(()=>[...window.__manyHands.pose.q]),q0,'dragging orbits the model');
 const z0=await big.evaluate(()=>window.__manyHands.pose.zoom);await big.mouse.wheel(0,-300);await big.waitForFunction(z=>window.__manyHands.pose.zoom>z,z0);

 // A phone that drops reconnects by itself, keeps its name and colour, and the ghost returns.
 const name=await c.locator('#mh-name').innerText();
 await c.evaluate(()=>window.__manyHandsPhone.drop());
 await c.waitForFunction(()=>window.__manyHandsPhone.online,null,{timeout:12000});
 assert.equal(await c.locator('#mh-name').innerText(),name);
 await big.waitForFunction(()=>window.__manyHands.crowd.n===3);
 assert.equal(await big.locator('.mh-toasts li').evaluateAll(l=>l.filter(x=>/joined/.test(x.textContent)).length)<=3,true);

 // Leaving hides the ghost: the hand stops counting at once and fades out in about two seconds.
 await Promise.all([a,b,c].map(p=>show(p,null)));
 await big.waitForFunction(()=>window.__manyHands.crowd.n===0&&window.__manyHands.rain===0,null,{timeout:6000});
 const t0=Date.now();await big.waitForFunction(()=>window.__manyHands.hands.every(h=>h.alpha===0),null,{timeout:8000});
 const faded=Date.now()-t0;assert.ok(faded<3500,'faded in '+faded);
 await big.waitForFunction(()=>window.__manyHands.speed<30,null,{timeout:10000});
 await a.waitForFunction(()=>window.__manyHandsPhone.pose==='none');
 assert.ok(await a.locator('#mh-say').innerText().then(t=>/Hold up one hand/.test(t)));

 // Ghosts that were on screen return when a hand comes back, and a link with no code offers the code box.
 const bare=await (await phoneContext()).newPage();watch(bare,'bare');await bare.goto(base+'/many-hands/join');
 await bare.locator('#mh-code').fill(code.toLowerCase());await bare.locator('#mh-form button').click();
 await bare.waitForFunction(()=>window.__manyHandsPhone?.online);assert.equal(new URL(bare.url()).searchParams.get('code'),code);

 // iPhone: one big Tap to join, and the camera is only asked for after it.
 const iosCtx=await phoneBrowser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',permissions:['camera']});
 await iosCtx.addInitScript(()=>{window.asked=[];const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=c=>{window.asked.push('camera');return gum(c);};});
 await iosCtx.addInitScript(stubWorker);
 const ios=await iosCtx.newPage();watch(ios,'ios');await ios.goto(link);
 await ios.waitForSelector('#mh-go');assert.equal(await ios.locator('#mh-go').textContent(),'Tap to join');
 assert.deepEqual(await ios.evaluate(()=>window.asked),[],'the camera is not asked for before the tap');
 await ios.locator('#mh-go').click();assert.deepEqual(await ios.evaluate(()=>window.asked),['camera']);
 await ios.waitForFunction(()=>window.__manyHandsPhone.online&&window.__manyHandsPhone.camera);assert.equal(await ios.locator('#mh-start').isHidden(),true);

 for(const x of [...ctxs,iosCtx,bare.context()])await x.close();
 // Forty more phones as plain sockets: the presenter stays responsive and the screen looks right.
 const origin=new URL(base).origin,wsBase=origin.replace('http','ws');
 const socks=[];let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 const ring=[];for(let i=0;i<40;i++){ring.push({x:.06+.88*rnd(),y:.14+.74*rnd(),pose:i<22?'open':i<34?'fist':'pinch'});}
 for(const [i,h] of ring.entries()){
  const ws=new WebSocket(`${wsBase}/parties/${code}/stream?role=player`,{headers:{Origin:origin}});ws.on('error',e=>errors.push('socket '+e.message));
  ws.i=i;socks.push(ws);
 }
 await Promise.all(socks.map(ws=>new Promise(r=>ws.once('open',r))));
 await big.waitForFunction(()=>document.querySelector('#mh-joined').textContent.startsWith('4'),null,{timeout:15000});
 await sleep(1500);big.evaluate(()=>window.__manyHands.perf());await sleep(3000);
 const empty=await big.evaluate(()=>window.__manyHands.perf());
 let tick=0;const pump=setInterval(()=>{tick++;for(const ws of socks){const h=ring[ws.i];if(ws.readyState!==1)continue;const wob=Math.sin(tick/8+ws.i)*.03;ws.send(JSON.stringify({v:1,type:'hand',x:Math.min(1,Math.max(0,h.x+wob)),y:Math.min(1,Math.max(0,h.y+Math.cos(tick/9+ws.i)*.03)),pose:h.pose,c:.9}));}},100);
 await big.waitForFunction(()=>window.__manyHands.crowd.n>=38,null,{timeout:20000});
 await sleep(2500);
 const hot=await big.evaluate(()=>{const p=window.__manyHands.perf();return {...p,crowd:window.__manyHands.crowd,drops:window.__manyHands.drops};});
 if(shots)await big.screenshot({path:shots+'/presenter-40.png'});
 console.log('frame ms, empty room',JSON.stringify(empty),'\nframe ms, 40 hands',JSON.stringify(hot));
 assert.ok(hot.crowd.n>=38,'40 hands are in: '+hot.crowd.n);assert.ok(hot.drops>20,'rain is falling from the crowd');
 assert.ok(hot.median<Math.max(empty.median*1.8,empty.median+25),`median frame ${hot.median} vs ${empty.median}`);
 assert.ok(hot.workMedian<12,'page script work per frame '+hot.workMedian);
 assert.equal(await big.evaluate(()=>window.__manyHands.hands.length>=43),true);
 clearInterval(pump);for(const ws of socks)ws.close();
 await big.waitForFunction(()=>window.__manyHands.crowd.n<=3,null,{timeout:8000});
 assert.deepEqual(errors,[]);
 console.log('Many Hands browser passed: QR and code, hide QR, 3 phones auto-join, join toast, ghosts appear, mirror and move, open rain and speed, fist grip meter and speed, 2 of 3 pinch tears and release reassembles, mouse orbit, reconnect, leaving fades the ghost, iPhone tap to join, 40 socket phones with frame time compared with an empty room. Hand landmarks are synthetic.');
}finally{await bigBrowser.close();await phoneBrowser.close();}
