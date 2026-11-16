// Run with tsx against the local dev server, which also hosts the local party relay.
// Phone hand tracking is stubbed with synthetic landmarks; camera, relay, game and 3D scene are real.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {posedHand} from './hand-fixtures.ts';

const base=process.env.STUDIO_URL||'http://localhost:4570',shots=process.env.SHOTS||'',aspect=4/3;
const hand=name=>posedHand(name).map(p=>({x:.5+p.x*.14,y:.7+p.y*.14*aspect,z:p.z*.14}));
const gl=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const bigBrowser=await chromium.launch({channel:'chrome',headless:true,args:gl});
const phoneBrowser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const errors=[];const watch=(page,name)=>{page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(name+': '+e.message));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(shots)await mkdir(shots,{recursive:true});

const stubWorker=()=>{window.testHands=[];window.Worker=class{constructor(){setTimeout(()=>this.onmessage?.({data:{type:'ready',delegate:'CPU'}}),0);}postMessage(m){if(m.type!=='frame')return;m.bitmap.close();setTimeout(()=>this.onmessage?.({data:{type:'result',landmarks:window.testHands,worldLandmarks:[],handedness:[],inferenceMs:1,timestamp:m.timestamp}}),30);}terminate(){}};};
const noCamera=()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Permission denied','NotAllowedError');};};
const phoneContext=()=>phoneBrowser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,permissions:['camera']});

try{
 // The big screen: one party, one QR code and a short code.
 const big=await (await bigBrowser.newContext({viewport:{width:1440,height:900}})).newPage();watch(big,'big');
 await big.goto(base+'/proton-party?round=20&goal=8');
 await big.waitForFunction(()=>window.__protonParty?.ready);
 const code=await big.evaluate(()=>window.__protonParty.code);assert.match(code,/^[A-HJ-NP-Z2-9]{5}$/);
 assert.equal(await big.locator('#pp-code').innerText(),code);
 assert.equal(await big.locator('.workspace-nav [aria-current=page]').innerText(),'Proton Party');
 assert.equal(await big.locator('.pp-join canvas').evaluate(c=>c.width>0),true);
 const qr=await big.locator('#pp-qr').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<d.length;i+=4)if(d[i]<80)dark++;return dark;});assert.ok(qr>1000,'the QR code is drawn');

 // Three phones, each in its own context, joined with nothing but the link: no name or code to type.
 const link=`${base}/proton-party/join?code=${code}`;
 const handCtx=await phoneContext(),gyroCtx=await phoneContext(),tapCtx=await phoneContext();
 await handCtx.addInitScript(stubWorker);
 await gyroCtx.addInitScript(noCamera);await tapCtx.addInitScript(noCamera);
 await tapCtx.addInitScript(()=>{window.addEventListener('devicemotion',e=>e.stopImmediatePropagation(),true);});
 const [hand1,gyro1,tap1]=await Promise.all([handCtx.newPage(),gyroCtx.newPage(),tapCtx.newPage()]);
 [['hand',hand1],['gyro',gyro1],['tap',tap1]].forEach(([n,p])=>watch(p,n));
 for(const p of [hand1,gyro1,tap1])await p.goto(link);
 for(const p of [hand1,gyro1,tap1]){await p.waitForFunction(()=>window.__protonPhone?.online);assert.equal(await p.locator('#pj-start').isHidden(),true,'no start gate off iOS');assert.equal(await p.locator('input').count(),0,'no name or code field');}
 await big.waitForFunction(()=>window.__protonParty.roster.filter(r=>r.on).length===3);
 const roster=await big.evaluate(()=>window.__protonParty.roster);
 assert.equal(new Set(roster.map(r=>r.color)).size,3,'three colours');assert.ok(roster.every(r=>r.name.length>2),'fun names');
 assert.equal(await big.locator('#pp-dots li').count(),3);
 assert.equal(await hand1.locator('#pj-name').innerText(),roster[0].name);

 if(shots)await big.screenshot({path:shots+'/big-lobby.png'});
 // Each input path says what to do, then a lobby throw is practice only.
 await hand1.waitForFunction(()=>window.__protonPhone.camera);
 await hand1.waitForFunction(()=>/Squeeze your hand/.test(window.__protonPhone.say),null,{timeout:15000}).catch(()=>{});
 await gyro1.evaluate(()=>window.dispatchEvent(new DeviceMotionEvent('devicemotion',{rotationRate:{alpha:0,beta:0,gamma:0}})));
 await gyro1.waitForFunction(()=>window.__protonPhone.gyro&&!window.__protonPhone.camera);
 await tap1.waitForFunction(()=>/Tap the proton/.test(window.__protonPhone.say),null,{timeout:8000});
 await tap1.locator('#pj-proton').click();await sleep(420);if(shots)await big.screenshot({path:shots+'/big-flight.png'});await sleep(200);
 assert.equal(await big.evaluate(()=>window.__protonParty.game.steps),0,'a lobby throw is practice');

 // Start the round.
 await big.locator('#pp-start').click();
 await big.waitForFunction(()=>window.__protonParty.phase==='play');
 for(const p of [hand1,gyro1,tap1])await p.waitForFunction(()=>window.__protonPhone.phase==='play');

 // Gyro: rest, a quick flick fires once, and a second spike inside 250 ms does not.
 const flickFrom=()=>gyro1.evaluate(async()=>{const s=(b)=>window.dispatchEvent(new DeviceMotionEvent('devicemotion',{rotationRate:{alpha:0,beta:b,gamma:0}}));s(0);s(420);s(30);s(0);await new Promise(r=>setTimeout(r,40));s(450);s(0);});
 await flickFrom();await gyro1.waitForFunction(()=>window.__protonPhone.threw===1);
 await sleep(300);await gyro1.evaluate(()=>{const s=b=>window.dispatchEvent(new DeviceMotionEvent('devicemotion',{rotationRate:{alpha:0,beta:b,gamma:0}}));s(0);s(500);s(0);});
 await gyro1.waitForFunction(()=>window.__protonPhone.threw===2);

 // Tap: one tap, one throw; 6 more with the 140 ms guard honoured.
 for(let i=0;i<6;i++){await tap1.locator('#pj-proton').click();await sleep(180);}
 await tap1.waitForFunction(()=>window.__protonPhone.threw===6);

 // Hand: squeeze then open, a few times, driven through the real tracking loop.
 const gesture=async()=>{await hand1.evaluate(h=>{window.testHands=[h];},hand('fist'));await sleep(450);await hand1.evaluate(h=>{window.testHands=[h];},hand('open'));await sleep(550);};
 for(let i=0;i<3;i++)await gesture();
 await hand1.waitForFunction(()=>window.__protonPhone.threw>=2,null,{timeout:8000});
 assert.equal(await hand1.locator('#pj-cam').isVisible(),true,'camera preview is shown');
 if(shots){await hand1.screenshot({path:shots+'/phone-hand.png'});await gyro1.screenshot({path:shots+'/phone-gyro.png'});}

 // The motor turned and ATP counts up on the big screen; the engine agrees with the game.
 const thrown=()=>big.evaluate(()=>window.__protonParty.game.steps);
 await big.waitForFunction(()=>window.__protonParty.game.atp>=1);
 const steps=await thrown();assert.ok(steps>=8,'steps '+steps);
 await big.waitForFunction(()=>Math.abs(window.__protonParty.rotor-window.__protonParty.game.steps*45)<1,null,{timeout:8000});
 await big.waitForFunction(()=>window.__protonParty.engineAtp===window.__protonParty.game.atp,null,{timeout:8000});
 if(shots)await big.screenshot({path:shots+'/big-play.png'});

 // Catches arrive on phones and are counted.
 const catches=async()=>(await Promise.all([hand1,gyro1,tap1].map(p=>p.evaluate(()=>window.__protonPhone.caught)))).reduce((a,b)=>a+b,0);
 await big.waitForFunction(()=>window.__protonParty.game.atp>=1);
 const atp=await big.evaluate(()=>window.__protonParty.game.atp);
 await hand1.waitForFunction(()=>true);
 for(let i=0;i<40&&await catches()<atp;i++)await sleep(100);
 assert.equal(await catches(),atp,'every ATP was caught by exactly one phone');
 assert.equal(await tap1.locator('#pj-score').innerText().then(t=>/You threw \d+, caught \d+/.test(t)),true);
 const stats=await big.evaluate(()=>[...window.__protonParty.game.stats.values()].map(s=>s.threw));
 assert.ok(stats.every(n=>n>0),'everyone threw: '+stats);

 // The goal ends the round early with a celebration, and the phones follow.
 for(let i=0;i<60&&await big.evaluate(()=>window.__protonParty.phase==='play');i++){await tap1.locator('#pj-proton').click();await sleep(160);}
 await big.waitForFunction(()=>window.__protonParty.phase==='results');
 assert.equal(await big.locator('#pp-results').isVisible(),true);
 assert.equal(await big.locator('#pp-result-atp').innerText(),String(await big.evaluate(()=>window.__protonParty.game.results.atp)));
 assert.ok(Number(await big.locator('#pp-result-atp').innerText())>=8);
 assert.ok((await big.locator('#pp-mvp').innerText()).includes('MVP'));
 for(const p of [hand1,gyro1,tap1])await p.waitForFunction(()=>window.__protonPhone.phase==='results');
 await sleep(900);if(shots)await big.screenshot({path:shots+'/big-results.png'});

 // Play again, then let the 20 second timer run out for a timed finish.
 await big.locator('#pp-again').click();await big.waitForFunction(()=>window.__protonParty.phase==='lobby'&&window.__protonParty.game.steps===0);
 await big.locator('#pp-start').click();await big.waitForFunction(()=>window.__protonParty.phase==='play');
 await tap1.waitForFunction(()=>window.__protonPhone.phase==='play'&&window.__protonPhone.threw===0);
 await tap1.locator('#pj-proton').click();await sleep(200);
 const started=Date.now();await big.waitForFunction(()=>window.__protonParty.phase==='results',null,{timeout:30000});
 const took=Date.now()-started;assert.ok(took>12000&&took<21000,'timer ran '+took+' ms');
 assert.equal(await big.evaluate(()=>window.__protonParty.game.results.won),false);

 // A phone that drops off reconnects by itself and keeps its name and colour.
 const before=await tap1.locator('#pj-name').innerText(),colour=await tap1.locator('#pj-dot').evaluate(e=>e.style.background);
 await tap1.evaluate(()=>window.__protonPhone.drop());
 await tap1.waitForFunction(()=>window.__protonPhone.online,null,{timeout:10000});
 await big.waitForFunction(()=>window.__protonParty.roster.length===3&&window.__protonParty.roster.every(r=>r.on));
 assert.equal(await tap1.locator('#pj-name').innerText(),before);assert.equal(await tap1.locator('#pj-dot').evaluate(e=>e.style.background),colour);

 // Level 2: tug of war. Burn shakes the motor back.
 await big.locator('#pp-again').click();await big.locator('.pp-levels [data-mode=tug]').click();
 await big.locator('#pp-start').click();await big.waitForFunction(()=>window.__protonParty.phase==='play'&&window.__protonParty.game.mode==='tug');
 await hand1.waitForFunction(()=>window.__protonPhone.phase==='play');
 const teamOf=async p=>p.evaluate(()=>window.__protonPhone.team);
 await Promise.all([hand1,gyro1,tap1].map(p=>p.waitForFunction(()=>window.__protonPhone.team)));
 const teams=await Promise.all([hand1,gyro1,tap1].map(teamOf));assert.ok(teams.includes('make')&&teams.includes('burn'),'both teams exist: '+teams);
 const makeIdx=teams.indexOf('make'),burnIdx=teams.indexOf('burn'),pages=[hand1,gyro1,tap1];
 const taps=async(p,n)=>{for(let i=0;i<n;i++){await p.locator('#pj-proton').click();await sleep(170);}};
 await taps(pages[makeIdx],8);await big.waitForFunction(()=>window.__protonParty.game.steps>=6);
 const peak=await thrown();await taps(pages[burnIdx],3);
 await big.waitForFunction(p=>window.__protonParty.game.steps<p,peak);
 assert.ok(await big.evaluate(()=>window.__protonParty.game.stats.size>0));
 if(shots)await big.screenshot({path:shots+'/big-tug.png'});

 assert.deepEqual(errors,[]);
 console.log('Proton Party browser passed: QR and code, 3 phones auto-join with no name step, hand/gyro/tap input, rotor and ATP, catches counted, goal and timer finishes, play again, reconnect name, tug of war. Hand landmarks and gyro events are synthetic.');
}finally{await bigBrowser.close();await phoneBrowser.close();}
