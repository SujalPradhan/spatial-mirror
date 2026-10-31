// Run with tsx. Only the phone's hand model is stubbed: camera, relay and desktop gestures are real.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4175',aspect=4/3;
const hand=(pose,x=.5,y=.7)=>posedHand(pose).map(p=>({x:x+p.x*.14,y:y+p.y*.14*aspect,z:p.z*.14}));
const camera=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'];
const desktop=await chromium.launch({channel:'chrome',headless:true}),mobile=await chromium.launch({channel:'chrome',headless:true,args:camera});
const d=await desktop.newPage({viewport:{width:1280,height:800}}),phone=await mobile.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true}),p=await phone.newPage();
const errors=[];for(const page of[d,p]){page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));}
await p.addInitScript(()=>{window.testHands=[];window.Worker=class{constructor(){setTimeout(()=>this.onmessage?.({data:{type:'ready',delegate:'CPU'}}),0);}postMessage(m){if(m.type!=='frame')return;m.bitmap.close();setTimeout(()=>this.onmessage?.({data:{type:'result',landmarks:window.testHands,worldLandmarks:[],handedness:[],inferenceMs:1,timestamp:m.timestamp}}),30);}terminate(){}};});
const pose=async(name,want=name)=>{await p.evaluate(h=>{window.testHands=[h];},hand(name));await d.waitForFunction(w=>window.__atpStudio.frame.hands[0]?.pose===w,want);};
try{
 await d.goto(base+'/atp');await d.waitForFunction(()=>window.__atpStudio?.ready&&window.__atpStudio.owns);
 await d.locator('#atp-phone').click();await d.waitForFunction(()=>/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(document.querySelector('#pairing-code')?.textContent||''));
 const code=(await d.locator('#pairing-code').textContent()).replace('-','');await d.locator('#pair-close').click();
 await p.goto(base+'/phone#pair='+code);await p.waitForFunction(()=>document.querySelector('#workspace-title')?.textContent==='ATP Synthase');
 await p.locator('#tracking-phone h2',{hasText:'Step into the mirror'}).waitFor();
 await p.locator('#tracking-phone-start').click();await p.locator('#tracking-phone-start',{hasText:'Stop camera'}).waitFor();
 await d.waitForFunction(()=>window.__atpStudio.phoneFrames>2&&window.__atpStudio.phoneCamera);
 for(const name of ['open','fist','pinch','victory','thumbUp'])await pose(name);
 const x=await d.evaluate(()=>window.__atpStudio.frame.hands[0].palm.x);assert.ok(Math.abs(x-.5)<.25,'hand stays near the middle');
 if(process.env.SHOT)await p.screenshot({path:process.env.SHOT});
 // A held fist follows the wrist, so turn the hand in the image plane and expect the molecule to turn.
 await pose('fist');const held=await d.evaluate(()=>JSON.stringify(window.__atpStudio.state.view.q)),c=Math.cos(.7),s=Math.sin(.7);
 await p.evaluate(h=>{window.testHands=[h];},posedHand('fist').map(q=>({x:.5+(q.x*c-q.y*s)*.14,y:.7+(q.x*s+q.y*c)*.14*aspect,z:q.z*.14})));
 await d.waitForFunction(q=>JSON.stringify(window.__atpStudio.state.view.q)!==q,held);
 await p.locator('#tracking-phone-start').click();await d.waitForFunction(()=>!window.__atpStudio.phoneCamera);
 assert.deepEqual(errors,[]);console.log('ATP phone camera passed: panel, camera start/stop, poses through relay, wrist turn moves the molecule.');
}finally{await desktop.close();await mobile.close();}
