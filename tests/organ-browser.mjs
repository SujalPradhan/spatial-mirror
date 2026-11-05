// Run against the dev server (PORT=4194 node server.mjs) with `npx tsx tests/organ-browser.mjs`. SHOTS=<dir> keeps a screenshot of each beat.
// Every gesture goes through the real tracker via debug hands, camera off, so the stage maps mirror space one to one.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4194',shots=process.env.SHOTS;
// Metal on a Mac is far quicker than the software renderer, which matters for grace windows; GL=swiftshader forces software.
const gpu=(process.env.GL||(process.platform==='darwin'?'metal':'swiftshader'))==='metal'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const browser=await chromium.launch({channel:'chrome',headless:true,args:gpu});
const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[],checks=[];
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
let W=1280,H=758;const S=.085;
/** `near` is an open hand whose thumb has come within half a palm of the index tip: a pinch about to close. */
function hand(pose){if(pose!=='near')return posedHand(pose);const h=posedHand('open');h[3]={x:-.5,y:-1.9,z:0};h[4]={x:.12,y:-2.4,z:0};return h;}
/** Raw camera landmarks for a hand whose working point (pinch, fingertip or palm) lands at stage pixel (px,py), rolled by `turn` radians about it. */
function place(pose,px,py,turn=0){
 const h=hand(pose),ref=pose==='pinch'||pose==='near'?{x:(h[4].x+h[8].x)/2,y:(h[4].y+h[8].y)/2}:{x:-.07,y:-.86},c=Math.cos(turn),s=Math.sin(turn),k=W/H;
 return h.map(p=>{const x=p.x-ref.x,y=p.y-ref.y,rx=x*c-y*s,ry=x*s+y*c;return {x:1-(px/W)+rx*S,y:py/H+ry*S*k,z:p.z*S};});
}
const feed=(hands,ms=33)=>page.evaluate(([h,ms])=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>{window.__organ.hands(h);},ms);},[hands,ms]);
const quiet=async()=>{await page.evaluate(()=>clearInterval(window.testFeed));await page.waitForFunction(()=>window.__organ.frame.hands.length===0);};
const read=(fn,arg)=>page.evaluate(fn,arg);
const shot=async name=>{if(shots){await frames(3);await page.screenshot({path:`${shots}/${name}.png`});}};
const frames=n=>page.evaluate(n=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);}),n);
const until=(fn,arg,timeout=30000)=>page.waitForFunction(fn,arg,{timeout,polling:'raf'});
const check=m=>{checks.push(m);console.log('ok',m);};
const slot=id=>read(id=>window.__organ.scene.slots.find(s=>s.id===id),id);
const palm=()=>read(()=>window.__organ.scene.palm);
const drops=id=>read(id=>window.__organ.doc.items[id]??0,id);
const beat=()=>read(()=>window.__organ.story.beat);
const camera=()=>read(()=>JSON.stringify({m:window.__organ.view.cameraMatrix,z:window.__organ.view.cameraZoom,v:window.__organ.state.view}));
const wait=ms=>page.waitForTimeout(ms);
/** Glides one or more hands from where they are to new spots in a few frames, so the tracker keeps each identity. */
async function glide(from,to,steps=6,ms=40){for(let i=1;i<=steps;i++){const k=i/steps;await feed(to.map((t,j)=>place(t[0],from[j][1]+(t[1]-from[j][1])*k,from[j][2]+(t[2]-from[j][2])*k,(from[j][3]??0)+((t[3]??0)-(from[j][3]??0))*k)));await wait(ms);}return to;}
/** Pinch a vial, carry it over the palm, and tilt to pour until the palm holds `want` drops of it. */
async function pour(id,want,dx=0,tilt=.85){
 const v=await slot(id),p=await palm(),over=['pinch',p.x+dx,p.y-110,0];
 await feed([place('pinch',v.x,v.y)]);await until(id=>window.__organ.scene.held.some(g=>g.id===id),id);
 let at=await glide([['pinch',v.x,v.y,0]],[over]);
 at=await glide(at,[['pinch',over[1],over[2],tilt]],5);
 await until(([id,n])=>(window.__organ.doc.items[id]??0)>=n,[id,want-.35]);
 at=await glide(at,[over],3,30);
 await feed([place('open',p.x+dx,p.y+200)]);await until(()=>!window.__organ.scene.held.length);await quiet();
}
try{
 await page.goto(base+'/organ');await page.waitForFunction(()=>window.__organ?.ready&&window.__organ.owns,null,{timeout:60000});
 ({w:W,h:H}=await read(()=>window.__organ.view.size));
 assert.equal(await page.title(),'The Accord — Spatial Studio');
 assert.equal(await beat(),'intro');
 assert.equal(await read(()=>window.__organ.scene.slots.map(s=>s.id).join()),'tonka,lavender,oakmoss','three vials first');
 assert.equal(await page.locator('.organ-label.is-on').count(),0,'no label in chapter 1');
 assert.equal(await page.locator('#organ-gestures').isVisible(),false,'no eleven-gesture bar');
 assert.match(await page.locator('.organ-line').textContent(),/Perfumes change through the day/);
 await shot('01-intro');check('Opens on the question: three vials, a lit palm, the day ribbon with its dotted outline, one line of text');

 // Rule 1: nothing moves the camera by itself.
 const cam0=await camera();await wait(5000);assert.equal(await camera(),cam0);check('Camera projection, pose and zoom unchanged over 5 s idle');
 await until(()=>window.__organ.story.beat==='lavender');
 assert.deepEqual(await read(()=>[...document.querySelectorAll('.organ-line li')].map(l=>l.dataset.gesture)),['pinch','tilt'],'only the gestures in use');

 // A pinch about to close shows the reticle and lights the vial it would take; a pinch on the sleeping tonka is answered as a miss.
 const lav=await slot('lavender');
 await feed([place('near',lav.x+8,lav.y+6)]);await until(()=>window.__organ.scene.reticles.some(r=>r.target==='lavender'&&r.close>.3));
 await page.locator('.organ-reticle.is-on.has-target').waitFor();await shot('02-approach');check('An approaching pinch shows a reticle and lights the lavender before it closes');
 const tonka=await slot('tonka');await feed([place('pinch',tonka.x,tonka.y)]);await until(()=>[...document.querySelectorAll('.organ-ack.is-miss')].some(a=>/First, the lavender/.test(a.textContent)));await quiet();
 check('Pinching a vial out of turn is acknowledged as a miss');

 // 🤏 Pick up: acknowledged within 100 ms of the pinch being seen.
 const latency=page.evaluate(()=>new Promise(r=>{let t0=0;const f=()=>{const o=window.__organ;if(!t0&&o.frame.hands.some(h=>h.pose==='pinch'))t0=performance.now();if(t0&&[...document.querySelectorAll('.organ-ack')].some(a=>a.textContent.includes('Lavender: tilt')))return r(performance.now()-t0);requestAnimationFrame(f);};f();}));
 await feed([place('pinch',lav.x,lav.y)]);const ms=await latency;assert.ok(ms<100,`pick acknowledged in ${ms} ms`);
 await until(()=>window.__organ.scene.held[0]?.id==='lavender');
 // Reaching is inert: carried level over the palm, nothing pours.
 const p=await palm();let at=await glide([['pinch',lav.x,lav.y,0]],[['pinch',p.x,p.y-110,0]]);await wait(400);
 assert.equal(await drops('lavender'),0,'level: nothing pours');assert.equal(await read(()=>window.__organ.scene.held[0].inZone),true);
 check(`Pinch picks up the lavender (ack ${ms.toFixed(0)} ms); carried level over the palm it pours nothing`);
 // ↻ Tilt pours: the rate follows the angle, and levelling stops it.
 at=await glide(at,[['pinch',p.x,p.y-110,.4]],4);await wait(350);const slow=await read(()=>window.__organ.scene.held[0].rate);
 at=await glide(at,[['pinch',p.x,p.y-110,.95]],4);await wait(350);const fast=await read(()=>window.__organ.scene.held[0].rate);
 assert.ok(slow>0&&fast>slow*1.5,`rate follows tilt: ${slow.toFixed(2)} → ${fast.toFixed(2)} drops/s`);
 await page.locator('.organ-meter.is-pouring').waitFor();await until(()=>window.__organ.view.stats.drops>0);await shot('03-pour');
 await until(()=>(window.__organ.doc.items.lavender??0)>=7.2);
 at=await glide(at,[['pinch',p.x,p.y-110,0]],3,30);await until(()=>window.__organ.scene.held[0].rate===0);
 const level=await drops('lavender');await wait(500);assert.ok(Math.abs(await drops('lavender')-level)<.05,'levelling stops the pour');
 check(`Tilting pours ${slow.toFixed(1)} drops/s at a slight tilt and ${fast.toFixed(1)} at a steep one; levelling stops at ${level.toFixed(1)} drops`);
 await feed([place('open',p.x,p.y+200)]);await until(()=>!window.__organ.scene.held.length);await quiet();
 await until(()=>window.__organ.story.beat==='waft');assert.equal(await read(()=>window.__organ.scene.draw),0,'the ribbon waits for the first smell');

 // 🖐 Waft: an open hand stroked up toward the face and back. The up stroke previews; the turn back commits.
 const waft=async(x,y0=.86)=>{let a=[['open',x,H*y0]];await feed([place('open',x,H*y0)]);await wait(250);for(const y of [.8,.74,.68,.62,.58]){a=await glide(a,[['open',x,H*y]],1,45);}await until(()=>window.__organ.scene.waftPreview!==null||window.__organ.scene.puffs.length>0);a=await glide(a,[['open',x,H*.64]],2,45);};
 await waft(p.x+430);
 await until(()=>window.__organ.story.beat==='top');await page.locator('.organ-puff').first().waitFor();
 const puff=await page.locator('.organ-puff').first().textContent();assert.match(puff,/fresh/);await wait(300);await shot('04-waft');await quiet();
 await until(()=>window.__organ.scene.draw>=1);
 assert.match(await page.locator('.organ-line').textContent(),/top note/);await shot('05-top-note');
 check(`A waft puffs “${puff.trim()}” off the palm and draws the ribbon: lavender is a top note`);

 // 🤏🤏 Carry: tonka in one hand, oakmoss in the other, poured together; the balance bar sits between the hands.
 await until(()=>window.__organ.story.beat==='carry',null,15000);
 assert.ok((await read(()=>window.__organ.story.gestures)).includes('both'));
 const tk=await slot('tonka'),om=await slot('oakmoss'),L=await drops('lavender'),wantT=L*.75,wantO=L*.25;
 await feed([place('pinch',tk.x,tk.y),place('pinch',om.x,om.y)]);await until(()=>window.__organ.scene.held.length===2);
 let two=await glide([['pinch',tk.x,tk.y,0],['pinch',om.x,om.y,0]],[['pinch',p.x-120,p.y-100,0],['pinch',p.x+120,p.y-100,0]],8);
 await page.locator('.organ-pair.is-on').waitFor();
 two=await glide(two,[['pinch',p.x-120,p.y-100,-.9],['pinch',p.x+120,p.y-100,.55]],6);
 await until(()=>window.__organ.scene.held.every(g=>g.rate>0));await shot('06-two-hands');
 const pairText=await page.locator('.organ-pair').textContent();
 // Each hand levels when its own material has reached its share.
 let tDone=false,oDone=false;
 for(let i=0;i<200&&!(tDone&&oDone);i++){
  const [t,o]=await read(()=>[window.__organ.doc.items.tonka??0,window.__organ.doc.items.oakmoss??0]);
  const nt=!tDone&&t>=wantT-.3,no=!oDone&&o>=wantO-.15;
  if(nt||no){tDone||=nt;oDone||=no;two=await glide(two,[['pinch',p.x-120,p.y-100,tDone?0:-.9],['pinch',p.x+120,p.y-100,oDone?0:.55]],2,25);}
  else await wait(30);
 }
 await feed([place('open',p.x-150,p.y+220),place('open',p.x+150,p.y+220)]);await until(()=>!window.__organ.scene.held.length);await quiet();
 const [T,O]=[await drops('tonka'),await drops('oakmoss')];
 check(`Two hands pour tonka and oakmoss together (${T.toFixed(1)} : ${O.toFixed(1)}), the bar between them reads “${pairText.replace(/\s+/g,' ').trim()}”`);

 // ✊ Scrub: a fist turned like a dial moves through the day; the words change with the hour.
 await until(()=>window.__organ.story.beat==='scrub');
 await feed([place('fist',p.x,p.y+150)]);await until(()=>window.__organ.frame.hands[0]?.pose==='fist');await wait(300);
 const words0=await page.locator('.organ-cursor').textContent();let f=[['fist',p.x,p.y+150,0]];
 for(let i=1;i<=8;i++)f=await glide(f,[['fist',p.x,p.y+150,-i*.13]],1,40);
 await until(()=>window.__organ.scene.clock>1.5);if(await beat()==='scrub')await shot('07-scrub');
 for(let i=9;i<=14;i++)f=await glide(f,[['fist',p.x,p.y+150,-i*.13]],1,40);
 await until(()=>window.__organ.scene.clock>4);const mid=await page.locator('.organ-cursor').textContent();
 // A screenshot can stall the feed long enough to lose the hand, so the fist is re-gripped before turning back.
 await until(()=>window.__organ.frame.hands[0]?.pose==='fist'&&!window.__organ.scene.holds.length);await wait(250);
 for(let i=13;i>=-4;i--)f=await glide(f,[['fist',p.x,p.y+150,-i*.13]],1,40);
 await until(()=>window.__organ.scene.clock<.6);await quiet();
 assert.notEqual(words0,mid);
 check(`A turning fist scrubs the day: “${words0.trim()}” → “${mid.trim()}”, span ${(await read(()=>window.__organ.engine.facts().scrubbed)).toFixed(1)} h`);

 // Lock: filling the outline rings a chord and names what you made.
 const score=await read(()=>window.__organ.scene.match?.score??0);
 if(await beat()!=='reveal'){
  await until(()=>['adjust','reveal'].includes(window.__organ.story.beat));
  for(let k=0;k<4&&await beat()==='adjust';k++){
   const need=await read(()=>{const o=window.__organ,m=o.scene.match;const w=[...m.per].sort((a,b)=>a.score-b.score)[0];return w.ratio<1?w.id:null;});
   if(need)await pour(need,(await drops(need))+.8);else{await feed([place('thumbDown',p.x,p.y+150)]);await until(()=>!window.__organ.scene.holds.length&&window.__organ.scene.acks.some(a=>/Took back/.test(a.text)));await quiet();}
   await wait(900);
  }
 }
 await until(()=>window.__organ.story.beat==='reveal');assert.ok(await read(()=>window.__organ.story.locked>=0));
 const reveal=await page.locator('.organ-line').textContent();assert.match(reveal,/fougère/);assert.match(reveal,/1882/);assert.match(reveal,/barbershop/);
 await page.locator('.organ-offer.is-on').waitFor();await wait(500);await shot('08-reveal');
 check(`The outline locks at ${Math.round(await read(()=>window.__organ.scene.match.score*100))}% (was ${Math.round(score*100)}% after scrubbing): “${reveal.slice(0,70)}…”`);

 // The offer is a lower-centre target a pinch can take.
 const offer=await read(()=>window.__organ.scene.offer);
 await feed([place('near',offer.x,offer.y)]);await until(()=>window.__organ.scene.offerHot);
 await feed([place('pinch',offer.x,offer.y)]);await until(()=>window.__organ.story.chapter===2);await quiet();
 await page.locator('.organ-label.is-on').waitFor();
 const lines=await read(()=>window.__organ.view.hud.labelLines);const moss=lines.find(l=>l.id==='oakmoss');
 assert.ok(moss&&/Oakmoss extract: must be named, use limited/.test(moss.text),JSON.stringify(lines));
 assert.equal(await read(()=>window.__organ.scene.slots.map(s=>s.id).join()),'tonka,lavender,oakmoss,moss-accord');
 await shot('09-restricted');check(`Pinching the offer opens chapter 2: the label reads “${moss.text.split('from')[0].trim()}”`);

 // Swap in the stand-in: the evening shrinks and the character kept is reported.
 await pour('moss-accord',(await drops('oakmoss'))+.4,0,.6);
 await until(()=>window.__organ.story.beat==='insight');
 const swap=await read(()=>window.__organ.doc.swap);assert.ok(swap&&swap.kept<1&&swap.changes.some(c=>c.id==='oakmoss'&&c.by==='moss-accord'));
 await page.locator('.organ-swap.is-on').waitFor();const evening=await page.locator('.organ-swap dd').last().textContent();assert.match(evening,/^-\d+%$/,`evening shrank: ${evening}`);
 assert.equal(await read(()=>window.__organ.doc.items.oakmoss??0),0);
 assert.match(await page.locator('.organ-line').textContent(),/reformulated/);
 await shot('10-swap');check(`Pouring the stand-in swaps out the oakmoss: ${Math.round(swap.kept*100)}% character kept, evening ${evening}`);

 // 👎 Undo everything: the stand-in pour, then the swap itself.
 const undo=async()=>{const n=await read(()=>window.__organ.engine.history.size);await feed([place('thumbDown',p.x,p.y+150)]);await until(n=>window.__organ.engine.history.size<n,n);await quiet();};
 await undo();await undo();assert.ok(await read(()=>window.__organ.doc.items.oakmoss>0&&!window.__organ.doc.swap),'swap undone, oakmoss back');
 check('Thumbs down held takes back the stand-in pour, then the swap: the oakmoss is back');

 // Mouse: click the offer, click a vial, scroll to tilt, click again to set it down; drag the ribbon to scrub.
 await page.locator('.organ-offer').click();await until(()=>window.__organ.story.chapter===3);
 const box=await page.locator('#organ-viewport').boundingBox(),berg=await slot('bergamot');
 await page.mouse.click(box.x+berg.x,box.y+berg.y);await until(()=>window.__organ.scene.held[0]?.id==='bergamot');
 await page.mouse.move(box.x+p.x,box.y+p.y-110,{steps:6});for(let i=0;i<6;i++){await page.mouse.wheel(0,80);await wait(30);}
 await until(()=>(window.__organ.doc.items.bergamot??0)>2);for(let i=0;i<6;i++){await page.mouse.wheel(0,-80);await wait(20);}
 await page.mouse.click(box.x+p.x,box.y+p.y-110);await until(()=>!window.__organ.scene.held.length);
 assert.equal(await read(()=>window.__organ.view.cameraZoom),1,'the wheel tilted the vial, not the camera');
 const rb=await page.locator('.organ-ribbon-plot').boundingBox();await page.mouse.move(rb.x+20,rb.y+rb.height/2);await page.mouse.down();await page.mouse.move(rb.x+rb.width*.7,rb.y+rb.height/2,{steps:5});await page.mouse.up();
 await until(()=>window.__organ.scene.clock>5);await shot('11-chypre-mouse');
 check(`Mouse: click, scroll to pour ${(await drops('bergamot')).toFixed(1)} drops of bergamot, click to set down; dragging the ribbon moves to ${await read(()=>window.__organ.scene.clock.toFixed(1))} h`);

 // The full organ, families as colour only.
 await page.locator('.organ-chapters button[data-value="4"]').click();await until(()=>window.__organ.story.chapter===4);
 assert.equal(await read(()=>window.__organ.scene.slots.length),21);assert.ok(await read(()=>window.__organ.scene.slots.every(s=>s.r>=30)),'every target at least 60 px across');
 await pour('rose',3,-60);await pour('cedar',2,60);
 // 🙌 Rub palms: warm skin squeezes the ribbon left.
 let r=[['open',p.x-50,p.y+120],['open',p.x+50,p.y+120]];await feed(r.map(x=>place(...x)));await wait(200);
 for(let i=0;i<10&&!await read(()=>window.__organ.doc.warm);i++){const d=i%2?24:-24;r=await glide(r,[['open',p.x-50,p.y+120+d],['open',p.x+50,p.y+120-d]],2,35);}
 await until(()=>window.__organ.doc.warm);await quiet();await shot('12-free-play');
 check('The full organ: 21 vials coloured by family; rubbing palms warms the skin');

 // Copy: honest limits and sources, and no house, product or perfumer names anywhere.
 await page.locator('#organ-sources').click();const about=await page.locator('#organ-about').textContent();await page.locator('#organ-about-close').click();
 for(const word of ['illustrative','exponential','4 : 3 : 1','2023/1545','0.001%','pulse points','weakly supported'])assert.ok(about.includes(word),word);
 assert.equal(await page.locator('#organ-about a').count(),4);
 const text=await read(()=>document.body.innerText);for(const banned of JSON.parse(Buffer.from('WyJIb3ViaWdhbnQiLCJSb3lhbGUiLCJDb3R5IiwiR3VlcmxhaW4iLCJDaGFuZWwiLCJEaW9yIiwiQ2FybGVzIiwiTWl0c291a28iLCJKaWNreSJd','base64').toString()))assert.ok(!text.includes(banned),banned);
 assert.equal(await camera(),cam0,'no gesture moved the camera all run');
 check('About gives honest limits and five sources; no brand or perfumer names on the page; the camera never moved');
 assert.deepEqual(errors,[]);console.log(`Organ passed: ${checks.length} checks.`);
}catch(e){console.log('Done so far:',checks);console.log(await page.evaluate(()=>{const o=window.__organ;return o&&{beat:o.story.beat,hands:o.frame.hands.map(h=>h.pose),doc:o.doc,held:o.scene.held,acks:o.scene.acks.map(a=>a.text),match:o.scene.match?.score,clock:o.scene.clock,story:o.story.text};}).catch(()=>null));if(shots)await page.screenshot({path:`${shots}/zz-failure.png`});console.log(errors);throw e;}finally{await browser.close();}
