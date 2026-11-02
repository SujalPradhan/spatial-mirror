import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const base=process.env.STUDIO_URL||'http://localhost:4174';
const desktop=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}),mobile=await chromium.launch({channel:'chrome',headless:true});
const page=await desktop.newPage({viewport:{width:1440,height:1080},acceptDownloads:true,permissions:['camera']}),phone=await mobile.newPage({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));phone.on('pageerror',e=>errors.push(String(e)));
await phone.addInitScript(()=>{window.testDegrees=0;class Sensor extends EventTarget {quaternion=[0,0,0,1];timestamp=0;start(){this.timer=setInterval(()=>{const a=window.testDegrees*Math.PI/360;this.quaternion=[Math.sin(a),0,0,Math.cos(a)];this.timestamp=performance.now();this.dispatchEvent(new Event('reading'));},20);}stop(){clearInterval(this.timer);}}window.RelativeOrientationSensor=Sensor;});
const waitReady=()=>page.waitForFunction(()=>window.__mathsStudio?.active);
const clickPhone=async selector=>{await phone.locator(selector).scrollIntoViewIfNeeded();await phone.locator(selector).click();};
const hold=async()=>{const box=await phone.locator('#clutch').boundingBox();await phone.mouse.move(box.x+box.width/2,box.y+box.height/2);await phone.mouse.down();};
try{
  await mkdir('reports',{recursive:true});
  const response=await page.goto(base+'/maths');assert.equal(response.status(),200);await waitReady();
  assert.equal(await page.locator('.workspace-nav [aria-current="page"]').innerText(),'Maths');
  assert.equal(await page.locator('#reveal').isVisible(),false);assert.equal(await page.locator('#error-value').innerText(),'4.000');
  const {token}=await fetch(base+'/api/session').then(r=>r.json());await phone.goto(base+'/phone?session='+token);
  await phone.waitForFunction(()=>document.querySelector('#workspace-title')?.textContent==='Spatial Maths');await clickPhone('#start');await phone.waitForFunction(()=>!document.querySelector('#clutch').disabled);await phone.evaluate(()=>window.instanceId='same phone page');
  await hold();await page.waitForFunction(()=>window.__mathsStudio.holding);await phone.evaluate(()=>window.testDegrees=35);
  await page.waitForFunction(()=>Math.abs(window.__mathsStudio.error-4)>.1);await phone.mouse.up();await page.waitForFunction(()=>!window.__mathsStudio.holding);
  const released=await page.evaluate(()=>window.__mathsStudio.state.q);await phone.evaluate(()=>window.testDegrees=75);await phone.waitForTimeout(180);assert.deepEqual(await page.evaluate(()=>window.__mathsStudio.state.q),released);
  await hold();await page.waitForFunction(()=>window.__mathsStudio.holding);assert.deepEqual(await page.evaluate(()=>window.__mathsStudio.state.q),released);await phone.mouse.up();
  await page.locator('[data-stage="cloud"]').click();await phone.waitForTimeout(180);await page.locator('#tilt-x').fill('0');await page.locator('#tilt-y').fill('0');
  await page.waitForFunction(()=>Math.abs(window.__mathsStudio.error-.25)<1e-8);await page.locator('#reveal').click();await page.waitForFunction(()=>window.__mathsStudio.state.reveal);assert.match(await page.locator('#pca-details').innerText(),/98\.1%/);
  const beforeView=await page.evaluate(()=>window.__mathsStudio.error);await page.locator('[data-tool="orbit"]').click();const canvas=await page.locator('#maths-view').boundingBox();await page.mouse.move(canvas.x+canvas.width*.6,canvas.y+canvas.height*.4);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.7,canvas.y+canvas.height*.5,{steps:8});await page.mouse.up();assert.equal(await page.evaluate(()=>window.__mathsStudio.error),beforeView);
  await page.locator('[data-tool="annotate"]').click();await phone.waitForFunction(()=>!document.querySelector('#art-panel').hidden);await phone.waitForTimeout(150);
  // Maths annotation also works with sensors stopped: the plane is already pinned.
  await clickPhone('#start');const pad=await phone.locator('#drawing-pad').boundingBox();await phone.mouse.move(pad.x+pad.width*.3,pad.y+pad.height*.45);await phone.mouse.down();for(let i=1;i<=12;i++)await phone.mouse.move(pad.x+pad.width*(.3+i*.03),pad.y+pad.height*(.45+Math.sin(i/3)*.08));await phone.mouse.up();
  await page.waitForFunction(()=>window.__mathsStudio.state.annotations[0]?.finished&&window.__mathsStudio.state.annotations[0]?.points.length>5);
  const annotation=await page.evaluate(()=>window.__mathsStudio.state.annotations[0]);
  await page.waitForTimeout(450);await page.reload();await waitReady();await phone.waitForFunction(()=>!document.querySelector('#art-panel').hidden);assert.equal(await page.locator('[data-tool="annotate"]').getAttribute('class'),'active');assert.equal(await page.locator('#tilt-x').isDisabled(),true);
  await page.locator('[data-save="0"]').click();await page.locator('[data-stage="challenge"]').click();await page.locator('[data-save="1"]').click();await page.locator('[data-load="0"]').click();
  await page.waitForFunction(()=>window.__mathsStudio.state.stage==='cloud');assert.deepEqual(await page.evaluate(()=>window.__mathsStudio.state.annotations[0]),annotation);
  // Desktop ink follows the actual rendered plane, independently of the phone stream.
  await page.locator('[data-tool="annotate"]').click();const host=await page.locator('#maths-view').boundingBox();await page.mouse.move(host.x+host.width*.48,host.y+host.height*.5);await page.mouse.down();await page.mouse.move(host.x+host.width*.55,host.y+host.height*.48,{steps:6});await page.mouse.up();await page.waitForFunction(()=>window.__mathsStudio.state.annotations.length===2);await page.locator('#undo').click();await page.waitForFunction(()=>window.__mathsStudio.state.annotations.length===1);
  const download=page.waitForEvent('download');await page.locator('#export-image').click();const bytes=await readFile(await (await download).path());assert.equal(bytes.subarray(1,4).toString(),'PNG');
  await page.locator('#camera-toggle').click();await page.waitForFunction(()=>document.querySelector('#hand-video').videoWidth>0);await page.locator('#camera-toggle').click();
  await page.locator('.workspace-nav a[href="/cone"]').click();await phone.waitForFunction(()=>document.querySelector('#workspace-title').textContent==='Cone');await page.locator('.workspace-nav a[href="/maths"]').click();await waitReady();await phone.waitForFunction(()=>document.querySelector('#workspace-title').textContent==='Spatial Maths');assert.equal(await phone.evaluate(()=>window.instanceId),'same phone page');assert.deepEqual(await page.evaluate(()=>window.__mathsStudio.state.annotations[0]),annotation);
  await clickPhone('[data-action="math-annotate"]');await phone.waitForFunction(()=>!document.querySelector('#art-panel').hidden);await phone.locator('#drawing-pad').scrollIntoViewIfNeeded();
  const startStroke=async()=>{const r=await phone.locator('#drawing-pad').boundingBox();await phone.mouse.move(r.x+r.width*.35,r.y+r.height*.45);await phone.mouse.down();await phone.mouse.move(r.x+r.width*.45,r.y+r.height*.5,{steps:5});};
  await startStroke();await page.waitForFunction(()=>window.__mathsStudio.state.annotations.length===2&&window.__mathsStudio.state.annotations[1].points.length>2);
  await phone.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>window.__mathsStudio.state.annotations[1].finished&&window.__mathsStudio.state.annotations[1].interrupted);await phone.mouse.up();
  await phone.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await phone.waitForTimeout(180);
  // A suspended controller cannot leave the desktop trapped in a held annotation.
  await phone.evaluate(()=>{const send=WebSocket.prototype.send;WebSocket.prototype.send=function(data){if(!window.suspendControllerTraffic)send.call(this,data);};});
  await startStroke();await page.waitForFunction(()=>window.__mathsStudio.state.annotations.length===3&&window.__mathsStudio.state.annotations[2].points.length>2);
  await phone.evaluate(()=>window.suspendControllerTraffic=true);await page.waitForFunction(()=>window.__mathsStudio.state.annotations[2].interrupted);
  const r=await phone.locator('#drawing-pad').boundingBox();await phone.mouse.move(r.x+r.width*.65,r.y+r.height*.55,{steps:5});await phone.mouse.up();await phone.evaluate(()=>window.suspendControllerTraffic=false);
  await phone.waitForFunction(()=>document.querySelector('#message').textContent.includes('saved part'));
  // The terminal rejection clears the failed tail, so another stroke can save normally.
  await startStroke();await phone.mouse.up();await page.waitForFunction(()=>window.__mathsStudio.state.annotations.length===4&&window.__mathsStudio.state.annotations[3].finished);
  await page.locator('[data-stage="challenge"]').click();await clickPhone('[data-action="math-reveal"]');await page.waitForFunction(()=>window.__mathsStudio.state.reveal);
  const beforeDemo=await page.evaluate(()=>window.__mathsStudio.state);await page.locator('#demo-launch').click();
  await phone.waitForFunction(()=>document.querySelector('[data-action="math-next"]').disabled&&document.querySelector('#message').textContent.includes('Projection demo'));
  await page.locator('#demo-close').click();await phone.waitForFunction(()=>!document.querySelector('[data-action="math-next"]').disabled);assert.deepEqual(await page.evaluate(()=>window.__mathsStudio.state),beforeDemo);
  await page.screenshot({path:'reports/maths-desktop.png',fullPage:true});await phone.screenshot({path:'reports/maths-phone.png',fullPage:true});
  await page.setViewportSize({width:393,height:852});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.deepEqual(errors,[]);
  const report={passed:true,checks:['built route and nav','phone workspace sync without reload','clutched rotation, release and neutral re-grab','known PCA error and retained variance','camera orbit independent of maths','phone annotation with sensors stopped','saved views and anchored annotations','mouse ink and undo','PNG export','camera startup','persistence across navigation','phone hide interrupts only its annotation','stale controller closes annotation','interrupted unsaved tail receives terminal rejection','fresh drawing after interruption','phone PCA reveal','mobile layout'],note:'Automated browser test uses synthetic orientation and webcam, not a physical usability result.'};
  await writeFile('reports/maths-check.json',JSON.stringify(report,null,2));console.log('Spatial Maths browser checks passed.');
}catch(e){await page.screenshot({path:'reports/maths-failure.png',fullPage:true}).catch(()=>{});console.error('Page errors:',errors);throw e;}
finally{await desktop.close();await mobile.close();}
