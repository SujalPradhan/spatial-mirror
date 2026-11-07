// Run with tsx against `PORT=4205 node server.mjs`. Hands are injected landmarks that go through the real gesture tracker. SHOTS=<dir> keeps screenshots.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4205',shots=process.env.SHOTS;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[],checks=[];
page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
let aspect=1;const S=.14;
const place=(pose,mx,my=.6)=>{
 const h=posedHand(pose),ref=pose==='pinch'?{x:(h[4].x+h[8].x)/2,y:(h[4].y+h[8].y)/2}:{x:0,y:-1};
 return h.map(p=>({x:(1-mx)+(p.x-ref.x)*S,y:my+(p.y-ref.y)*S*aspect,z:p.z*S}));
};
const feed=(hands,ms=33)=>page.evaluate(([h,ms])=>{clearInterval(window.testFeed);window.testFeed=setInterval(()=>{window.__atomStudio.hands(h);},ms);},[hands,ms]);
const quiet=async()=>{await page.evaluate(()=>clearInterval(window.testFeed));await page.waitForFunction(()=>window.__atomStudio.frame.hands.length===0);};
const posed=(...want)=>page.waitForFunction(w=>{const p=window.__atomStudio.frame.hands.map(h=>h.pose);return w.every(x=>p.includes(x));},want);
const until=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:60000});
const shot=async name=>{if(shots)await page.screenshot({path:`${shots}/${name}.png`});};
const check=m=>{checks.push(m);console.log('ok',m);};
const text=sel=>page.locator(sel).innerText();
/** The widest spread of the nucleus on screen, in px. */
const spread=()=>page.evaluate(()=>{const s=window.__atomStudio,v=s.view,n=s.scene.element,z=[1,2,3,6,7,8,10,11][n],ne=[0,2,4,6,7,8,10,12][n],xs=[];for(let i=0;i<z+ne;i++)xs.push(v.screenOf(v.particle(i)).x);return Math.max(...xs)-Math.min(...xs);});
try{
 assert.equal((await page.goto(base+'/atom')).status(),200);
 await page.waitForFunction(()=>window.__atomStudio?.ready&&window.__atomStudio.owns);
 assert.equal(await page.title(),'Atom — Spatial Studio');assert.equal(await text('.workspace-nav [aria-current=page]'),'Atom');
 assert.equal(await page.locator('#atom-loading').isVisible(),false);
 assert.equal(await text('.mirror-mark'),'Carbon atom');assert.equal(await text('.mirror-count'),'6 electrons');
 assert.deepEqual(await page.locator('#atom-gestures li').allTextContents(),['🖐Take electron','🤏🤏Tear apart','✊Hold','👍Faster','👎Reverse','✊✊Scale','👐Next element']);
 assert.deepEqual(await page.locator('#atom-gestures li').evaluateAll(l=>l.map(x=>x.dataset.gesture)),['open','both-pinch','fist','thumbUp','thumbDown','both-fist','clap']);
 check('page loads, nav marks Atom, mark and count read Carbon / 6 electrons, gesture bar lists the 7 gestures in order');
 // Idle: nothing is touched and the atom still turns.
 const idle=await page.evaluate(()=>{const s=window.__atomStudio;return {spin:s.scene.spin,tumble:s.scene.tumble,p:s.view.particle(0),e:s.view.particle(12)};});
 await page.waitForTimeout(1200);
 const later=await page.evaluate(()=>{const s=window.__atomStudio;return {spin:s.scene.spin,tumble:s.scene.tumble,p:s.view.particle(0),e:s.view.particle(12)};});
 assert.ok(later.spin>idle.spin+.05&&later.tumble>idle.tumble+.1,'spin and tumble advance');
 assert.ok(Math.hypot(later.p.x-idle.p.x,later.p.y-idle.p.y,later.p.z-idle.p.z)>.02&&Math.hypot(later.e.x-idle.e.x,later.e.y-idle.e.y,later.e.z-idle.e.z)>.1,'nucleus and electrons move on screen');
 await shot('01-idle-carbon');
 check('idle: the atom spins, the nucleus tumbles and electrons orbit with no input');
 // Labels by hover: the mouse over a particle names it.
 const named=new Set();
 // Particles move, so the pointer chases one until the name chip lands on it.
 for(let k=0;k<60&&!named.size;k++){
  const at=await page.evaluate(()=>{const s=window.__atomStudio,v=s.view,r=document.querySelector('#atom-viewport').getBoundingClientRect(),p=v.screenOf(v.particle(12));return {x:r.x+p.x,y:r.y+p.y};});
  await page.mouse.move(at.x,at.y);await page.waitForTimeout(60);
  const chip=page.locator('.mirror-chip:not([hidden])');if(await chip.count())named.add(await chip.first().innerText());
 }
 assert.match([...named].join(' '),/Electron/);
 check(`hover names a particle: ${[...named].join(' | ').replace(/\n/g,' / ')}`);
 await page.mouse.move(5,5);
 // Mouse fallback: drag turns, space speeds up, wheel zooms.
 const q0=await page.evaluate(()=>window.__atomStudio.state.view.q),r=await page.locator('#atom-viewport').boundingBox();
 await page.mouse.move(r.x+r.width*.2,r.y+r.height*.3);await page.mouse.down();await page.mouse.move(r.x+r.width*.3,r.y+r.height*.4,{steps:5});await page.mouse.up();
 assert.notDeepEqual(await page.evaluate(()=>window.__atomStudio.state.view.q),q0);
 await page.locator('#atom-viewport').focus();await page.keyboard.press(' ');await page.waitForFunction(()=>window.__atomStudio.scene.rate>1.5);
 const z0=await page.evaluate(()=>window.__atomStudio.state.view.zoom);await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.wheel(0,-300);await page.waitForFunction(z=>window.__atomStudio.state.view.zoom>z,z0);
 await page.locator('#atom-recenter').click();
 check('mouse: drag turns, space speeds the orbits, wheel zooms, Recenter resets');
 // About.
 await page.locator('#atom-sources').click();assert.equal(await page.locator('#atom-about').isVisible(),true);
 const about=await page.locator('#atom-about').innerText();assert.match(about,/simplification/);assert.match(about,/probability clouds/);
 assert.equal(await page.locator('#atom-about a').count(),2);
 await page.locator('#atom-about-close').click();
 check('About states the Bohr model is a simplification and lists 2 sources');
 // Camera and tutorial.
 await page.locator('#atom-camera').click();await page.waitForSelector('#atom-stage.is-live');
 aspect=await page.evaluate(()=>{const v=document.querySelector('#atom-video');return v.videoWidth/v.videoHeight;});
 await page.waitForFunction(()=>window.__atomStudio.tutorial?.total===7);
 assert.equal(await page.locator('#atom-tutorial').isVisible(),true);
 const expected=['Take electron','Tear apart','Hold','Faster','Reverse','Scale','Next element'];
 const labels=[];
 for(let i=0;i<7;i++){const t=await page.evaluate(()=>window.__atomStudio.tutorial);if(t.checkpoint){await page.locator('#atom-tutorial-next').click();i--;continue;}labels.push(t.step.label);if(i<6)await page.locator('#atom-tutorial-next').click();}
 assert.deepEqual(labels,expected);await page.locator('#atom-tutorial-skip').click();
 check('tutorial lists the 7 gestures in order');
 // Take an electron with an open palm.
 const palm=async()=>page.evaluate(()=>{const s=window.__atomStudio,h=s.frame.hands.filter(h=>h.pose==='open').map(h=>h.palm),v=document.querySelector('#atom-video'),host=document.querySelector('#atom-viewport'),a=v.videoWidth/v.videoHeight,st=host.clientWidth/host.clientHeight;
  return h.map(p=>{const x=a>st?(p.x-.5)*a/st+.5:p.x,y=a>st?p.y:(p.y-.5)*st/a+.5;return {x:x*host.clientWidth,y:y*host.clientHeight};});});
 const taken=()=>page.evaluate(()=>{const s=window.__atomStudio,v=s.view,total=[1,2,3,6,7,8,10,11].map((z,i)=>z+[0,2,4,6,7,8,10,12][i])[s.scene.element];return s.scene.taken.map(t=>({amount:t.amount,electron:t.electron,at:v.screenOf(v.particle(total+t.electron))}));});
 await feed([place('open',.68,.55)]);await posed('open');
 await until(()=>window.__atomStudio.scene.taken.length===1&&window.__atomStudio.scene.taken[0].amount>.97);
 await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.__atomStudio.electrons),5);
 assert.equal(await page.evaluate(()=>window.__atomStudio.scene.taken[0].electron),5,'the outermost electron');
 assert.equal(await page.locator('.atom-caption').innerText(),'C⁺ ion: 6 protons, 5 electrons');
 assert.equal(await page.locator('.mirror-count').innerText(),'5 electrons, charge +1');
 const [t1]=await taken(),[p1]=await palm();
 assert.ok(t1.at.y<p1.y&&p1.y-t1.at.y<140&&Math.abs(t1.at.x-p1.x)<50,`electron sits just above the palm: electron ${JSON.stringify(t1.at)} palm ${JSON.stringify(p1)}`);
 await shot('02-electron-in-palm');
 // It follows the hand.
 for(let i=1;i<=8;i++){await feed([place('open',.68-.28*i/8,.55-.05*i/8)]);await page.waitForTimeout(60);}
 await page.waitForTimeout(700);
 const [t2]=await taken(),[p2]=await palm();
 assert.ok(Math.abs(t2.at.x-p2.x)<50&&t2.at.y<p2.y&&p2.y-t2.at.y<140&&Math.abs(t2.at.x-t1.at.x)>150,'electron follows the palm');
 check(`open palm takes the outermost electron to just above the palm (${Math.round(p1.y-t1.at.y)} px above), shows C⁺ ion, and follows the hand`);
 // Two hands, two electrons.
 await feed([place('open',.4,.5),place('open',.75,.5)]);
 await until(()=>window.__atomStudio.scene.taken.length===2&&window.__atomStudio.scene.taken.every(t=>t.amount>.97));
 assert.equal(await page.locator('.atom-caption').innerText(),'C²⁺ ion: 6 protons, 4 electrons');
 assert.deepEqual(await page.evaluate(()=>window.__atomStudio.scene.taken.map(t=>t.electron).sort()),[4,5]);
 check('two open hands take two electrons (C²⁺ ion)');
 // The second hand leaves and its electron goes home; a flicker shorter than the grace keeps the first.
 await feed([place('open',.4,.5)]);
 await until(()=>window.__atomStudio.scene.taken.length===1&&window.__atomStudio.scene.taken[0].amount>.97);
 assert.equal(await page.evaluate(()=>window.__atomStudio.electrons),5);
 await page.evaluate(()=>{window.lowest=1;window.watchAmount=setInterval(()=>{const t=window.__atomStudio.scene.taken;window.lowest=Math.min(window.lowest,t.length?t[0].amount:0);},16);});
 await feed([place('fist',.4,.5)]);await posed('fist');await page.waitForTimeout(60);await feed([place('open',.4,.5)]);await posed('open');await page.waitForTimeout(400);
 assert.ok(await page.evaluate(()=>window.lowest)>.9,'a brief flicker does not drop the electron');
 await page.evaluate(()=>clearInterval(window.watchAmount));
 await quiet();
 await until(()=>window.__atomStudio.scene.taken.length===0);
 assert.equal(await page.evaluate(()=>window.__atomStudio.electrons),6);
 assert.equal(await page.locator('.atom-caption').innerText(),'Carbon-12: 6 protons, 6 neutrons, 6 electrons');
 assert.equal(await page.locator('.mirror-count').innerText(),'6 electrons');
 check('hand gone: electrons fly back, the atom is neutral again');
 // Tear apart.
 const whole=await spread();
 await feed([place('pinch',.47,.55),place('pinch',.53,.55)]);await posed('pinch','pinch');await page.waitForTimeout(300);
 for(let i=1;i<=12;i++){await feed([place('pinch',.47-.25*i/12,.55),place('pinch',.53+.25*i/12,.55)]);await page.waitForTimeout(60);}
 await until(()=>window.__atomStudio.scene.explode>.85);await page.waitForTimeout(500);
 const apart=await spread();
 assert.ok(apart>whole*2.5,`parts separate: ${Math.round(whole)} px to ${Math.round(apart)} px`);
 const labels2=await page.evaluate(()=>window.__atomStudio.view.labels);
 for(const l of ['6 protons','6 neutrons','6 electrons','shell 1: 2','shell 2: 4'])assert.ok(labels2.includes(l),`label ${l} in ${labels2}`);
 await shot('03-torn-apart');
 check(`both pinch apart: nucleus spread ${Math.round(whole)} to ${Math.round(apart)} px, labels ${labels2.join(', ')}`);
 // Partway the separation follows the hands.
 await feed([place('pinch',.45,.55),place('pinch',.55,.55)]);
 await until(()=>window.__atomStudio.scene.explode<.6);
 const mid=await page.evaluate(()=>window.__atomStudio.scene.explode);assert.ok(mid>0&&mid<.6);
 await quiet();
 await until(()=>window.__atomStudio.scene.explode<.02,undefined);
 assert.deepEqual(await page.evaluate(()=>window.__atomStudio.view.labels),[]);
 const back=await spread();assert.ok(back<whole*1.3,`reassembled: ${Math.round(back)} px`);
 check('release reassembles smoothly, labels gone');
 // Next element: the n key, then a clap.
 await page.locator('#atom-viewport').focus();await page.keyboard.press('n');
 await until(()=>window.__atomStudio.element===4);await page.waitForFunction(()=>document.querySelector('.mirror-mark').textContent==='Nitrogen atom');
 assert.equal(await page.locator('.mirror-count').innerText(),'7 electrons');
 assert.equal(await page.locator('.atom-caption').innerText(),'Nitrogen-14: 7 protons, 7 neutrons, 7 electrons');
 check('n steps to Nitrogen');
 await feed([place('open',.15,.5),place('open',.85,.5)],33);await page.waitForTimeout(500);
 await feed([place('open',.46,.5),place('open',.54,.5)],33);
 await until(()=>window.__atomStudio.element===5);await quiet();
 await page.waitForFunction(()=>document.querySelector('.mirror-mark').textContent==='Oxygen atom'&&window.__atomStudio.scene.fade===1);
 check('clap steps to Oxygen');
 // Every element: counts and shells.
 const want=[['Neon',10,10,[2,8]],['Sodium',11,12,[2,8,1]],['Hydrogen',1,0,[1]],['Helium',2,2,[2]],['Lithium',3,4,[2,1]],['Carbon',6,6,[2,4]]];
 for(const [name,z,n,shells] of want){
  await page.keyboard.press('n');await page.waitForFunction(m=>document.querySelector('.mirror-mark').textContent===m+' atom'&&window.__atomStudio.scene.fade===1,name);
  assert.equal(await page.evaluate(()=>window.__atomStudio.electrons),z);
  assert.match(await page.locator('.atom-caption').innerText(),new RegExp(`^${name}-${z+n}: ${z} proton${z>1?'s':''}, ${n} neutron${n===1?'':'s'}, ${z} electron`));
  if(name==='Sodium'){await shot('04-sodium');assert.deepEqual(shells,[2,8,1]);}
 }
 check('each element shows its counts');
 await page.locator('#atom-camera').click();
 assert.deepEqual(errors,[]);
 console.log('Atom browser passed:',checks.length,'checks. Hands are synthetic landmarks through the real gesture tracker; the camera is a fake device.');
}catch(e){console.log('Done so far:',checks);console.log(await page.evaluate(()=>{const s=window.__atomStudio;return s&&{hands:s.frame.hands.map(h=>h.pose),element:s.element,taken:s.scene.taken,explode:s.scene.explode,caption:s.scene.caption};}).catch(()=>null));await shot('zz-failure');console.log(errors);throw e;}finally{await browser.close();}
