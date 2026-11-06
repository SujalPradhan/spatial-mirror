// Run with: PORT=4202 node server.mjs, then STUDIO_URL=http://localhost:4202 npx tsx tests/follow-browser.mjs  (SHOTS=<dir> saves screenshots)
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {handFromAngles} from './grasp-hands.ts';
import {defaultCalibration} from '../src/grasp/joints.ts';
import {LESSONS} from '../src/follow/lessons.ts';

const base=process.env.STUDIO_URL||'http://localhost:4202',shots=process.env.SHOTS;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'])]});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800},acceptDownloads:true}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// Until every deployment lists /follow among the shared mirror pages, the relay may see it as the shapes workspace. A no-op once it does.
await page.addInitScript(()=>{const send=WebSocket.prototype.send;WebSocket.prototype.send=function(d){return send.call(this,typeof d==='string'&&location.pathname==='/follow'?d.replace('"workspace":"shapes"','"workspace":"atp"'):d);};});
const D=Math.PI/180,cal=defaultCalibration(),aspect=16/9;
/** Raw degrees that read back as these normalised joints under the default calibration. */
const degrees=q=>q.map((v,i)=>(cal.flat[i]+v*(cal.fist[i]-cal.flat[i]))/D);
/** A phone-style hand showing these joints; tilt turns it in the image, roll about the fingers. */
const synth=(q,{tilt=0,roll=0,x=.5}={})=>{
 const c=Math.cos(roll),s=Math.sin(roll),ct=Math.cos(tilt),st=Math.sin(tilt);
 return handFromAngles(degrees(q)).map(([px,py,pz])=>{const rx=px*c+pz*s,rz=-px*s+pz*c,tx=rx*ct-py*st,ty=rx*st+py*ct;return {x:x+tx*.016,y:.84-ty*.016*aspect,z:-rz*.016};});
};
const feed=(hand,side=null)=>page.evaluate(([h,sd])=>{window.testHands=[h];window.testSide=sd;if(window.testFeed)return;window.testFeed=true;const loop=()=>{if(!window.testFeed)return;if(window.testPath?.length)window.testHands=[window.testPath.shift()];window.__follow.hands(window.testHands,[],window.testSide?[window.testSide]:[]);requestAnimationFrame(loop);};loop();},[hand,side]);
const nohand=()=>page.evaluate(()=>{window.testHands=[];window.testPath=[];});
const clear=async(ms=300)=>{await page.evaluate(()=>{window.testFeed=false;window.testPath=[];});await page.waitForTimeout(ms);};
const get=(fn,arg)=>page.evaluate(fn,arg);
const info=()=>get(()=>{const f=__follow.scene.follow;return {mode:f.mode,index:f.index,waiting:f.waiting,hold:f.hold,hint:f.hint,hand:f.hand,matched:f.matched,mirrored:f.mirrored,count:f.countdown,steps:f.steps.length,lessonId:f.lessonId};});
const until=(fn,arg,timeout=12000)=>page.waitForFunction(fn,arg,{timeout}).catch(async e=>{console.error(JSON.stringify(await info()));throw e;});
const shot=name=>shots?page.screenshot({path:`${shots}/follow-${name}.png`}):null;
/** Plays a smooth move between two poses, one tracker frame per rendered frame. */
const glide=async(a,b,n=14,opts={})=>{const frames=Array.from({length:n},(_,i)=>{const t=(i+1)/n,u=t*t*(3-2*t);return synth(a.map((x,j)=>x+(b[j]-x)*u),opts);});await page.evaluate(f=>{window.testPath=f;},frames.slice(1));await feed(frames[0]);await until(()=>!window.testPath.length,null,15000);};
const OPEN=new Array(15).fill(0);
try{
 await page.goto(base+'/follow');await until(()=>window.__follow?.ready&&window.__follow.owns&&window.__follow.scene?.follow&&document.querySelector('.fo-steps li'),null,30000);
 assert.match(await page.title(),/Follow my hands/);
 assert.equal(await page.locator('.workspace-nav [aria-current="page"]').innerText(),'Follow');
 // No camera, no hand: the teacher plays by itself and says hands are the real input.
 assert.equal((await info()).mode,'demo');
 assert.match(await page.locator('.fo-now').innerText(),/Hands are the real input/);
 const first=(await info()).index;await until(i=>__follow.scene.follow.index!==i,first,8000);
 assert.equal(await page.locator('.fo-lessons button').count(),2);assert.equal(await page.locator('.fo-steps li').count(),LESSONS[0].steps.length);
 await until(()=>__follow.scene.follow.index===1&&__follow.scene.follow.arrived,null,15000);await page.waitForTimeout(100);
 assert.equal(await get(()=>__follow.scene.follow.touch),2,'the teacher shows the contact');
 await shot('idle');

 // A hand appears: the lesson starts at step one and the teacher waits.
 await feed(synth(OPEN));await until(()=>__follow.scene.follow.mode==='follow'&&__follow.scene.follow.index===0&&__follow.scene.follow.waiting);
 const steps=LESSONS[0].steps;
 for(let i=0;i<steps.length;i++){
  await until(n=>__follow.scene.follow.index===n&&__follow.scene.follow.waiting,i,12000);
  if(i===2){
   // Ring finger meant to curl to the thumb: keep it straight. It glows, a hint names it, and the teacher waits.
   const wrong=steps[2].q.map((v,j)=>j>=9&&j<=11?.02:v);
   await glide(steps[1].q,wrong,8);await page.waitForTimeout(2200);
   const m=await info();assert.equal(m.index,2,'the teacher waits');assert.match(m.hint??'',/Bend your ring finger more/);
   assert.ok(await get(()=>__follow.view.youResidualOpacity(10)>.5),'the ring finger glows red');
   assert.ok(await get(()=>__follow.view.ghostHand.residual.every(r=>r.material.opacity<.05)),'the teacher never glows');
   assert.ok(await get(()=>__follow.view.youResidualOpacity(3)<.3&&__follow.view.youResidualOpacity(13)<.3),'the fingers that match stay dark');
   assert.match(await page.locator('.fo-now small').innerText(),/ring finger/);
   await shot('mid-lesson-red-joint');
   await glide(wrong,steps[2].q,8);
  }else await glide(i?steps[i-1].q:OPEN,steps[i].q,8);
  if(i<steps.length-1)await until(n=>__follow.scene.follow.index===n+1,i,8000);
 }
 await until(()=>__follow.scene.follow.mode==='done',null,8000);
 const done=await get(()=>__follow.scene.follow.results);
 assert.equal(done.length,8);assert.ok(done.every(r=>!r.skipped&&r.score>30&&r.seconds>=.5),JSON.stringify(done));
 assert.equal(await page.locator('.fo-summary tbody tr').count(),8);assert.match(await page.locator('.fo-total').innerText(),/total .*average match/);
 await page.waitForTimeout(400);await shot('summary');
 await clear(200);

 // The spray pump lesson: tilt and roll are wrist steps. Which way the image tilts depends on the tracker's mirroring, so read the sign back first.
 await page.locator('.fo-lessons button').nth(1).click();await feed(synth(OPEN,{tilt:.5}));await page.waitForTimeout(600);
 const tiltSign=await get(()=>Math.sign(__follow.scene.follow.youWrist.tilt))*1;assert.ok(tiltSign!==0,'a tilted hand reads as tilted');
 const read=await get(()=>__follow.scene.follow.youWrist.tilt);assert.ok(Math.abs(read-.5)<.12,`tilt read as ${read}`);
 await feed(synth(OPEN,{roll:1}));await page.waitForTimeout(600);
 const rolled=await get(()=>Math.abs(__follow.scene.follow.youWrist.roll));assert.ok(Math.abs(rolled-1)<.25,`roll read as ${rolled}`);
 await feed(synth(OPEN));await until(()=>__follow.scene.follow.lessonId==='pump'&&__follow.scene.follow.mode==='follow'&&__follow.scene.follow.index===0,null,8000);
 const pump=LESSONS[1].steps;let prev=OPEN;
 for(let i=0;i<pump.length;i++){
  await until(n=>__follow.scene.follow.index===n&&__follow.scene.follow.waiting,i,12000);
  const w=pump[i].wrist,opts=w?{tilt:w.tilt*tiltSign,roll:w.roll}:{};
  if(i===3){
   // The collar needs a turn: the right shape without the roll is not enough, and it says so.
   await glide(prev,pump[i].q,8);await page.waitForTimeout(2200);
   const m=await info();assert.equal(m.index,3,'a grip without the twist does not pass');assert.match(m.hint??'',/Twist your wrist more/);
  }
  await glide(prev,pump[i].q,8,opts);if(i===0){await page.waitForTimeout(120);await shot('pump-pinch');}prev=pump[i].q;
  if(i<pump.length-1)await until(n=>__follow.scene.follow.index===n+1,i,8000);
 }
 await until(()=>__follow.scene.follow.mode==='done',null,8000);await clear(200);

 // Record, then replay. Hold three poses for a second each, with a quick move between.
 await page.locator('#follow-again,[data-act=again]').first().click();await until(()=>__follow.scene.follow.mode==='follow');
 await feed(synth(OPEN));await page.locator('#follow-record').click();
 await until(()=>__follow.scene.follow.mode==='countdown');assert.equal(await page.locator('.fo-count').isVisible(),true);assert.equal(await page.locator('#follow-record').innerText(),'Cancel');
 await until(()=>__follow.scene.follow.mode==='record',null,6000);assert.equal(await page.locator('#follow-record').innerText(),'Stop');
 const pose=[steps[0].q,steps[1].q,steps[3].q];
 await feed(synth(pose[0]));await page.waitForTimeout(1100);
 await glide(pose[0],pose[1],10);await page.waitForTimeout(1100);
 await glide(pose[1],pose[2],10);await page.waitForTimeout(1100);
 await page.locator('#follow-record').click();
 await until(()=>__follow.scene.follow.lessonId==='mine',null,4000);
 assert.equal(await page.locator('.fo-lessons button').count(),3);assert.match(await page.locator('.fo-lessons button[aria-pressed=true]').innerText(),/Your move/);
 const saved=await get(()=>JSON.parse(localStorage.getItem('follow-lessons-v1')).mine.steps.length);assert.ok(saved>=3&&saved<=4,`steps saved: ${saved}`);
 const mine=await get(()=>__follow.engine.steps.map(s=>s.q));
 // Replay: the teacher plays your move and waits for it.
 for(let i=0;i<mine.length;i++){
  await until(n=>__follow.scene.follow.mode==='follow'&&__follow.scene.follow.index===n&&__follow.scene.follow.waiting,i,12000);
  await glide(i?mine[i-1]:OPEN,mine[i],8);
  if(i<mine.length-1)await until(n=>__follow.scene.follow.index===n+1,i,8000);
 }
 await until(()=>__follow.scene.follow.mode==='done',null,8000);await clear(200);
 // It is still there after a reload; undo removes it.
 await page.reload();await until(()=>window.__follow?.ready&&document.querySelector('.fo-lessons button:nth-child(3)'),null,30000);
 assert.equal(await page.locator('.fo-lessons button').count(),3);
 await page.locator('#follow-undo').click();await until(()=>__follow.scene.follow.lessonId==='thumb'&&document.querySelectorAll('.fo-lessons button').length===2);
 assert.equal(await get(()=>localStorage.getItem('follow-lessons-v1').includes('"mine":null')),true);
 // Import a lesson from a file, then export it again.
 const file=`${tmpdir()}/follow-import-${Date.now()}.json`;
 writeFileSync(file,JSON.stringify({format:'follow-lesson',version:1,lesson:{title:'Imported',steps:[{name:'Fist',q:LESSONS[0].steps[0].q},{name:'Open',q:OPEN}]}}));
 await page.locator('#follow-sources').click();await page.locator('#follow-file').setInputFiles(file);
 await until(()=>__follow.scene.follow.lessonId==='mine'&&__follow.scene.follow.steps.length===2);
 assert.match(await page.locator('.fo-lessons button[aria-pressed=true]').innerText(),/Imported/);
 await page.locator('#follow-sources').click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#follow-export').click()]);
 assert.match(download.suggestedFilename(),/imported\.json$/);
 await page.locator('#follow-about-close').click();

 // Either hand: a hand labelled right is mirrored into the teacher, and the shared tracker's label for a left hand flips the stage.
 await page.locator('.fo-lessons button').first().click();
 await feed(synth(OPEN),'Left');await until(()=>__follow.scene.follow.hand&&__follow.scene.follow.side==='right'&&!__follow.scene.follow.mirrored);
 await feed(synth(OPEN),'Right');await until(()=>__follow.scene.follow.mirrored&&__follow.view.ghostHand.group.scale.x===-1&&__follow.view.youHand.group.scale.x===-1);
 await shot('left-hand');
 // A hand that vanishes for a moment keeps its hold: lose it for 0.3 s while matching step one.
 await feed(synth(OPEN),'Left');await until(()=>__follow.scene.follow.mode==='follow'&&__follow.scene.follow.waiting,null,15000);
 await glide(OPEN,LESSONS[0].steps[0].q,6);await until(()=>__follow.scene.follow.hold>.3,null,3000);
 const index=(await info()).index;await nohand();await page.waitForTimeout(250);await feed(synth(LESSONS[0].steps[0].q),'Left');
 await until(n=>__follow.scene.follow.index>n,index,3000);
 await clear(200);

 // The shared nav on one row at 1280 and 1440 on every page. At 1440 and on the mirror pages it must fit; at 1280 the shapes and mechanism pages have a narrower nav, and any overflow there is reported rather than fixed.
 const overflow=[];
 for(const width of [1280,1440]){
  await page.setViewportSize({width,height:800});
  await page.goto(base+'/follow');await page.waitForSelector('.workspace-nav a');
  const links=await get(()=>[...document.querySelectorAll('.workspace-nav a')].map(a=>a.getAttribute('href')));
  assert.ok(links.includes('/follow'));
  for(const href of links){
   await page.goto(base+href);await page.waitForSelector('.workspace-nav');
   const fit=await get(()=>{const n=document.querySelector('.workspace-nav'),tops=new Set([...n.querySelectorAll('a')].map(a=>Math.round(a.getBoundingClientRect().top)));return {over:n.scrollWidth-n.clientWidth,rows:tops.size};});
   if(fit.over>0||fit.rows>1){overflow.push(`${href} at ${width}: ${fit.over}px over`);assert.ok(width===1280&&!['/follow','/grasp'].includes(href),`${href} at ${width}: ${JSON.stringify(fit)}`);}
  }
 }
 if(overflow.length)console.warn('NAV OVERFLOW (not restyled):\n  '+overflow.join('\n  '));
 assert.deepEqual(errors,[]);
 console.log('follow browser: ok');
}finally{await browser.close();}
