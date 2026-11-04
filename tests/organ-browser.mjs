// Run against the dev server (PORT=4194 node server.mjs). Every gesture goes through the real tracker via debug hands. SHOTS=<dir> keeps screenshots.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4194',shots=process.env.SHOTS;
// Metal on a Mac is far quicker than the software renderer, which matters for the grace windows; GL=swiftshader forces software.
const gpu=(process.env.GL||(process.platform==='darwin'?'metal':'swiftshader'))==='metal'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...gpu]});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[],checks=[];
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('mirror-tutorial-v1','1'));
// Until control.ts maps /organ to the shared mirror workspace, the served module is patched in flight; once it does, this changes nothing.
await page.route(/\/src\/control\.ts/,async route=>{const r=await route.fetch(),body=await r.text();await route.fulfill({response:r,body:/["']\/organ["']/.test(body)?body:body.replace(/(["'])\/machine\1/,"$1/machine$1,$1/organ$1")});});
let aspect=1;const S=.14;
/** `near` is an open hand whose thumb has come within half a palm of the index tip: a pinch about to close. */
function hand(pose){
 if(pose!=='near')return posedHand(pose);
 const h=posedHand('open');h[3]={x:-.5,y:-1.9,z:0};h[4]={x:.12,y:-2.4,z:0};return h;
}
/** `mx,my` is where the hand's working point lands in mirror space: the pinch, the fingertip, or the palm. `turn` rolls the hand about it. */
function place(pose,mx,my=.6,turn=0){
 const h=hand(pose),ref=pose==='pinch'||pose==='near'?{x:(h[4].x+h[8].x)/2,y:(h[4].y+h[8].y)/2}:pose==='point'?h[8]:{x:-.07,y:-.86},c=Math.cos(turn),s=Math.sin(turn);
 return h.map(p=>{const x=p.x-ref.x,y=p.y-ref.y,rx=x*c-y*s,ry=x*s+y*c;return {x:(1-mx)+rx*S,y:my+ry*S*aspect,z:p.z*S};});
}
const feed=(hands,ms=33)=>page.evaluate(([h,ms])=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>{window.__organ.hands(h);},ms);},[hands,ms]);
const quiet=async()=>{await page.evaluate(()=>clearInterval(window.testFeed));await page.waitForFunction(()=>window.__organ.frame.hands.length===0);};
const posed=(...want)=>page.waitForFunction(w=>{const p=window.__organ.frame.hands.map(h=>h.pose);return w.every(x=>p.includes(x));},want);
const read=(fn,arg)=>page.evaluate(fn,arg);
const shot=async name=>{if(shots)await page.screenshot({path:`${shots}/${name}.png`});};
const frames=n=>page.evaluate(n=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);}),n);
const until=(fn,arg,timeout=30000)=>page.waitForFunction(fn,arg,{timeout});
const check=m=>{checks.push(m);console.log('ok',m);};
/** Two-hand moves start with a short engage ring; a slow renderer needs longer to fill it. */
const engaged=glyph=>until(g=>window.__organ.frame.hands.length===2&&!window.__organ.scene.holds.some(h=>h.glyph===g),glyph);
/** A stage pixel back into mirror space, after two frames so the view has drawn the latest layout. */
const toMirror=expr=>page.evaluate(async expr=>{
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const o=window.__organ,p=eval(expr),v=document.querySelector('#organ-video'),a=v.videoWidth/v.videoHeight,{w,h}=o.view.size,stage=w/h,x=p.x/w,y=p.y/h;
 return a>stage?{x:(x-.5)*stage/a+.5,y}:{x,y:(y-.5)*a/stage+.5};
},expr);
const index=id=>read(id=>window.__organ.view.vials?window.__organ.view.vials.findIndex(v=>v.ing.id===id):-1,id);
const vialAt=async id=>toMirror(`o.view.vial(${await index(id)})`);
const flaskAt=()=>toMirror('o.view.flask()');
const dropsOf=id=>read(id=>window.__organ.doc.blend.items.filter(a=>a.id===id).reduce((n,a)=>n+a.drops,0),id);
/** Pinch a vial and draw it a fraction of the way to the flask, then let go. */
async function pull(id,frac=.6,steps=8){
 const from=await vialAt(id),to=await flaskAt(),before=await read(()=>window.__organ.doc.blend.items.length);
 await feed([place('pinch',from.x,from.y)]);await until(i=>window.__organ.scene.grab?.vial===i,await index(id));
 for(let i=1;i<=steps;i++){const k=frac*i/steps;await feed([place('pinch',from.x+(to.x-from.x)*k,from.y+(to.y-from.y)*k)]);await page.waitForTimeout(40);}
 await until(()=>window.__organ.scene.grab?.drops>0);await page.waitForTimeout(300);const drops=await read(()=>window.__organ.scene.grab?.drops??0);
 await feed([place('open',.08,.9)]);await until(n=>window.__organ.doc.blend.items.length>n&&!window.__organ.scene.grab,before);await quiet();
 return drops;
}
/** Time from a pose being recognised to its acknowledgement on screen, in ms. */
const ackLatency=(pose,glyph)=>page.evaluate(([pose,glyph])=>new Promise(r=>{let t0=0;const f=()=>{const o=window.__organ;if(!t0&&o.frame.hands.some(h=>h.pose===pose))t0=performance.now();if(t0&&[...document.querySelectorAll('.organ-ack')].some(a=>a.textContent.includes(glyph)))return r(performance.now()-t0);requestAnimationFrame(f);};f();}),[pose,glyph]);
const camera=()=>read(()=>JSON.stringify({m:window.__organ.view.cameraMatrix,z:window.__organ.view.cameraZoom,v:window.__organ.state.view}));
try{
 await page.goto(base+'/organ');await page.waitForFunction(()=>window.__organ?.ready&&window.__organ.owns,null,{timeout:60000});
 assert.equal(await page.title(),'The Organ — Spatial Studio');
 assert.equal(await page.locator('#organ-count').textContent(),'0');
 assert.equal(await read(()=>window.__organ.view.stats.visibleVials),20);
 await page.locator('#organ-camera').click();await page.waitForSelector('#organ-stage.is-live');
 aspect=await read(()=>{const v=document.querySelector('#organ-video');return v.videoWidth/v.videoHeight;});
 await shot('01-organ');

 // Rule 1: nothing moves the camera by itself.
 const cam0=await camera();await page.waitForTimeout(5000);assert.equal(await camera(),cam0);check('Camera projection, zoom and pose unchanged over 5 s idle');

 // ☝️ Read: a pointing finger names the vial, with volatility, words and allergens, acknowledged within 100 ms.
 const rose=await vialAt('rose');const lat=ackLatency('point','☝️');
 await feed([place('point',rose.x,rose.y+.02)]);const pointMs=await lat;assert.ok(pointMs<100,`point acknowledged in ${pointMs} ms`);
 await until(i=>window.__organ.scene.hover?.vial===i,await index('rose'));await page.locator('.organ-hover.is-on').waitFor();
 const card=await page.locator('.organ-hover').textContent();for(const w of ['Rose','Volatility','Half-life','Citronellol','Geraniol'])assert.ok(card.includes(w),w);
 await shot('02-read');check(`Pointing reads a vial: volatility, odour words and allergens (ack ${pointMs.toFixed(0)} ms)`);await quiet();

 // Rule 4: a pinch about to close shows a reticle, glows the vial it will take, and names it.
 await feed([place('near',rose.x+.01,rose.y+.01)]);await until(i=>window.__organ.scene.reticles.some(r=>r.vial===i&&r.close>.3),await index('rose'));
 await page.locator('.organ-reticle.is-on.has-target').waitFor();assert.ok(await page.locator('.organ-tag.is-hot').count()>=1);
 assert.equal(await read(()=>window.__organ.doc.fan),false,'an approaching open hand does not fan');
 await shot('03-approach');check('An approaching pinch shows the reticle and the candidate vial before it closes');

 // 🤏 Dose: pinch, pull toward the flask, the meter and ghost drops count up, and letting go pours it.
 const to=await flaskAt();await feed([place('pinch',rose.x,rose.y)]);await until(i=>window.__organ.scene.grab?.vial===i,await index('rose'));
 for(let i=1;i<=6;i++){await feed([place('pinch',rose.x+(to.x-rose.x)*i*.1,rose.y+(to.y-rose.y)*i*.1)]);await page.waitForTimeout(50);}
 await until(()=>window.__organ.scene.grab?.drops>=4);await page.locator('.organ-dose.is-on').waitFor();
 await page.waitForTimeout(400);const ghost=await read(()=>window.__organ.scene.grab.drops);await frames(3);await shot('04-dose');
 await feed([place('open',.08,.9)]);await until(()=>!window.__organ.scene.grab);await quiet();
 assert.equal(await dropsOf('rose'),ghost);assert.ok(await page.locator('.organ-label li[data-id=citronellol]').count(),'citronellol declared');
 check(`Pinch and pull doses by distance: ${ghost} drops of rose, and Citronellol is written on the label`);

 // Rule 5: a pinch that flickers open and closes again nearby keeps hold of the same vial.
 const items=await read(()=>window.__organ.doc.blend.items.length),berg=await vialAt('bergamot');
 await feed([place('pinch',berg.x,berg.y)]);await until(i=>window.__organ.scene.grab?.vial===i,await index('bergamot'));
 const mid={x:berg.x+(to.x-berg.x)*.3,y:berg.y+(to.y-berg.y)*.3};await feed([place('pinch',mid.x,mid.y)]);await page.waitForTimeout(120);
 await feed([place('near',mid.x,mid.y)]);await until(()=>window.__organ.scene.grab?.loose);
 await feed([place('pinch',mid.x+.01,mid.y)]);await until(()=>window.__organ.scene.grab&&!window.__organ.scene.grab.loose);
 assert.equal(await read(()=>window.__organ.doc.blend.items.length),items,'nothing poured during the flicker');
 for(let i=4;i<=7;i++){await feed([place('pinch',berg.x+(to.x-berg.x)*i*.1,berg.y+(to.y-berg.y)*i*.1)]);await page.waitForTimeout(50);}
 await feed([place('open',.08,.9)]);await until(n=>window.__organ.doc.blend.items.length===n+1,items);await quiet();
 check(`A flickering pinch re-attaches within the grace window: one addition, ${await dropsOf('bergamot')} drops of bergamot`);

 // A pinch on nothing is still answered.
 await feed([place('pinch',.06,.95)]);await until(()=>[...document.querySelectorAll('.organ-ack.is-miss')].some(a=>a.textContent.includes('Nothing in reach')));await quiet();check('A pinch on empty air is acknowledged as a miss');

 for(const [id,f] of [['clove',.65],['cinnamon',.25],['musk',.8],['sandalwood',.5]])await pull(id,f);
 const flagged=await page.locator('.organ-label li.is-flagged').count();assert.ok(flagged>=1,'something is over a ceiling');
 assert.equal(Number(await page.locator('#organ-count').textContent()),await read(()=>window.__organ.doc.blend.items.reduce((n,a)=>n+a.drops,0)));
 const liquid=await read(()=>window.__organ.view.stats.liquid);assert.notEqual(liquid,'#ffffff');
 await shot('05-blend');check(`Six materials by hand: liquid ${liquid}, ${await page.locator('.organ-label li').count()} label lines, ${flagged} over a ceiling`);

 // ✊ Spin: a turning fist turns the organ ring, never the camera.
 const ring0=await read(()=>window.__organ.scene.ring),camBefore=await camera();
 await feed([place('fist',.5,.85)]);await posed('fist');await page.waitForTimeout(300);
 for(let i=1;i<=8;i++){await feed([place('fist',.5,.85,i*.12)]);await page.waitForTimeout(40);}
 await until(r=>Math.abs(window.__organ.scene.ring-r)>.3,ring0);assert.equal(await camera(),camBefore,'the camera stays put');await shot('06-spin');await quiet();
 check(`A turning fist spins the organ (${(await read(()=>window.__organ.scene.ring)-ring0).toFixed(2)} rad), camera unchanged`);
 await page.locator('#organ-recenter').click();await until(()=>window.__organ.scene.ring===0);

 // 🖐 Fan: a still open hand held with a progress ring fans the vials by family. 👎 takes it back.
 const before=await read(()=>window.__organ.engine.history.size);
 await feed([place('open',.5,.88)]);await until(()=>window.__organ.scene.holds.some(h=>h.glyph==='🖐'&&h.progress>.2&&h.progress<1));
 assert.equal(await read(()=>window.__organ.doc.fan),false,'not yet: the hold is still filling');
 await until(()=>window.__organ.doc.fan);await quiet();await until(()=>window.__organ.scene.fan>.97);await page.locator('.organ-family.is-on').first().waitFor();await shot('07-fan');
 check('An open hand held still fills a ring, then fans the organ by family');
 await feed([place('thumbDown',.5,.88)]);await until(()=>!window.__organ.doc.fan);await quiet();assert.equal(await read(()=>window.__organ.engine.history.size),before);
 check('Thumbs down undoes the fan');
 const sandal=await dropsOf('sandalwood');assert.ok(sandal>0);
 await feed([place('thumbDown',.5,.88)]);await until(()=>!window.__organ.doc.blend.items.some(a=>a.id==='sandalwood'));await quiet();
 assert.ok(await page.locator('.organ-ack').filter({hasText:'Undid'}).count());check(`Thumbs down undoes the last addition (${sandal} drops of sandalwood)`);
 await pull('tonka',.5);

 // ✊✊ Strength: two fists spread to concentrate the blend, which lasts longer.
 const conc0=await read(()=>window.__organ.doc.blend.conc);
 await feed([place('fist',.44,.85),place('fist',.56,.85)]);await until(()=>window.__organ.frame.hands.filter(h=>h.pose==='fist').length===2);await engaged('✊✊');
 for(const g of [.1,.14,.18,.22]){await feed([place('fist',.5-g,.85),place('fist',.5+g,.85)]);await page.waitForTimeout(60);}
 await until(c=>window.__organ.scene.conc>c+.05,conc0);await page.locator('.organ-conc.is-on').waitFor();await shot('08-strength');await quiet();
 const conc1=await read(()=>window.__organ.doc.blend.conc);assert.ok(conc1>conc0+.05,`concentration ${conc0} → ${conc1}`);
 check(`Two fists spread raise the concentration ${Math.round(conc0*100)}% → ${Math.round(conc1*100)}%`);

 // 👍 Spray: the blend goes on the palm, and the dry-down runs.
 await feed([place('thumbUp',.86,.88)]);await until(()=>window.__organ.scene.holds.some(h=>h.glyph==='👍'));await until(()=>window.__organ.doc.mode==='drydown');await quiet();
 await until(()=>window.__organ.view.stats.cloud>200);
 await until(()=>window.__organ.scene.clock>.4&&window.__organ.view.stats.ribbons>10);await shot('09-spray');
 check(`Thumbs up sprays the palm: ${await read(()=>window.__organ.view.stats.cloud)} points, citrus peeling off in ribbons`);
 await until(()=>window.__organ.scene.clock>2.2);
 const lines=await read(()=>window.__organ.view.hud.labelLines);const lim=lines.find(l=>l.id==='limonene'),cit=lines.find(l=>l.id==='citronellol');
 assert.ok(lim&&cit&&lim.opacity<cit.opacity,`limonene dims first: ${JSON.stringify([lim,cit])}`);await shot('10-drydown-label');
 check(`On the palm the label dims as allergens evaporate: limonene ${lim.opacity} below citronellol ${cit.opacity}`);

 // ✊ Scrub: in the dry-down a turning fist moves the clock instead.
 await feed([place('fist',.5,.85)]);await posed('fist');await page.waitForTimeout(300);const c0=await read(()=>window.__organ.scene.clock);
 for(let i=1;i<=8;i++){await feed([place('fist',.5,.85,i*.15)]);await page.waitForTimeout(40);}
 await until(c=>Math.abs(window.__organ.scene.clock-c)>.6&&!window.__organ.scene.playing,c0);await quiet();
 const scrubbed=await read(()=>window.__organ.scene.clock);check(`A turning fist scrubs the dry-down clock ${c0.toFixed(1)} → ${scrubbed.toFixed(1)} h`);

 // ✌️ Slice: the cloud cut at this hour shows what is left.
 await feed([place('victory',.5,.85)]);await until(()=>window.__organ.scene.slice>.9);await page.locator('.organ-slice.is-on').waitFor();
 const at=await page.locator('.organ-slice').textContent();assert.match(at,/At \d+\.\d h/);assert.match(at,/White musk|Sandalwood|Tonka/);await shot('11-slice');await quiet();
 check(`Victory slices the cloud: ${at.replace(/\s+/g,' ').slice(0,70)}…`);

 // 🤟 Skin: warm skin lifts everything faster.
 const left0=await read(()=>window.__organ.view.composition(window.__organ.scene).left);
 await feed([place('love',.86,.88)],60);await until(()=>window.__organ.doc.skin==='warm');await quiet();
 const left1=await read(()=>window.__organ.view.composition(window.__organ.scene).left);assert.ok(left1<left0,`warm skin leaves less: ${left0} → ${left1}`);
 check(`Love sign changes the skin to warm: less is left at the same hour (${left0.toFixed(4)} → ${left1.toFixed(4)})`);

 // 👐 Comply: flagged materials are cut back or replaced, at a cost to character.
 for(let i=0;i<8&&!await read(()=>window.__organ.doc.compliance);i++){await feed([place('open',.15,.85),place('open',.85,.85)],60);await page.waitForTimeout(600);await feed([place('open',.45,.85),place('open',.55,.85)],60);await page.waitForTimeout(500);}
 await quiet();const comp=await read(()=>window.__organ.doc.compliance);
 assert.ok(comp.changes.length>0&&comp.flaggedAfter.length===0&&comp.kept<1,'compliant, at a cost');assert.equal(await page.locator('.organ-label li.is-flagged').count(),0);
 await page.locator('.organ-comply').waitFor();await shot('12-compliant');
 check(`Clap makes it compliant: ${comp.changes.map(c=>`${c.id} ${c.kind}`).join(', ')}, ${Math.round(comp.kept*100)}% character kept`);

 // 🤏🤏 Split: two pinches pulled apart lift out top, heart and base.
 await feed([place('pinch',.47,.9),place('pinch',.53,.9)]);await until(()=>window.__organ.frame.hands.filter(h=>h.pose==='pinch').length===2);await engaged('🤏🤏');
 for(const g of [.1,.16,.22,.28]){await feed([place('pinch',.5-g,.9),place('pinch',.5+g,.9)]);await page.waitForTimeout(60);}
 await until(()=>window.__organ.scene.split>.8);await page.locator('.organ-split.is-on').first().waitFor();await shot('13-split');
 check(`Two pinches apart split the blend: ${(await page.locator('.organ-split.is-on b').allTextContents()).join(' / ')}`);await quiet();
 // ... and pushed together they bottle it for layering.
 const bottleIt=async()=>{
  await feed([place('pinch',.3,.9),place('pinch',.7,.9)]);await until(()=>window.__organ.frame.hands.filter(h=>h.pose==='pinch').length===2);await engaged('🤏🤏');
  for(const g of [.15,.1,.06]){await feed([place('pinch',.5-g,.9),place('pinch',.5+g,.9)]);await page.waitForTimeout(60);}
 };
 await bottleIt();await until(()=>window.__organ.doc.stack.length===1);await quiet();
 assert.equal(await read(()=>window.__organ.doc.blend.items.length),0);
 await pull('lavender',.6);await pull('vanilla',.7);await pull('lemon',.5);
 await bottleIt();await until(()=>window.__organ.doc.stack.length===2&&window.__organ.doc.mode==='layering');await quiet();
 await until(()=>window.__organ.scene.clock>1.5);await page.locator('.organ-forearm.is-on').waitFor();
 const forearm=await page.locator('.organ-forearm').textContent();assert.match(forearm,/layered A \+ B/);await shot('14-layering');
 check(`Pushed together, pinches bottle blends; two layer on the forearm: ${forearm.replace(/\s+/g,' ').slice(0,90)}…`);
 await feed([place('thumbDown',.5,.88)]);await until(()=>window.__organ.doc.stack.length===1);await quiet();check('Thumbs down unbottles the last layer');

 // Mouse: drag a vial to the flask.
 const box=await page.locator('#organ-viewport').boundingBox(),vi=await read(i=>window.__organ.view.vial(i),await index('jasmine')),fl=await read(()=>window.__organ.view.flask());
 await page.mouse.move(box.x+vi.x,box.y+vi.y);await page.mouse.down();for(let i=1;i<=6;i++){await page.mouse.move(box.x+vi.x+(fl.x-vi.x)*i/7,box.y+vi.y+(fl.y-vi.y)*i/7);await page.waitForTimeout(30);}
 await page.mouse.up();await until(()=>window.__organ.doc.blend.items.some(a=>a.id==='jasmine'));check('Mouse drags a vial to the flask');
 await page.locator('[data-act=undo]').click();await until(()=>!window.__organ.doc.blend.items.some(a=>a.id==='jasmine'));check('The Undo button takes it back');

 // Copy and chrome.
 await page.locator('#organ-sources').click();const about=await page.locator('#organ-about').textContent();await page.locator('#organ-about-close').click();
 for(const word of ['Illustrative, not regulatory or formulation advice','vapour pressure','2023/1545','26 to about 80','0.001%','0.01%','31 July 2026'])assert.ok(about.includes(word),word);
 assert.equal(await page.locator('#organ-about a').count(),3);
 const gestures=await page.locator('#organ-gestures').textContent();for(const word of ['Spin','Fan','Dose','Read','Slice','Spray','Undo','Skin','Split','Strength','Comply'])assert.ok(gestures.includes(word),word);
 assert.equal(await camera(),cam0,'no hand gesture moved the camera all run');check('About cites the 2023 expansion and thresholds; every guide label is this page’s; camera never moved');
 assert.deepEqual(errors,[]);console.log(`Organ passed: ${checks.length} checks.`);
}catch(e){console.log('Done so far:',checks);console.log(await page.evaluate(()=>{const o=window.__organ;return o&&{tips:o.frame.hands.map(h=>o.view.stage(h.indexTip)),pinch:o.frame.hands.map(h=>o.view.stage(h.pinch)),rose:o.view.vial(7),hover:o.scene.hover,hands:o.frame.hands.map(h=>h.pose),doc:o.doc,grab:o.scene.grab,holds:o.scene.holds,acks:o.scene.acks.map(a=>a.text)};}).catch(()=>null));await shot('zz-failure');console.log(errors);throw e;}finally{await browser.close();}
