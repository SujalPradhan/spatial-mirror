// Pairing and the phone's pump tool against a hosted build: STUDIO_URL=<preview> node tests/perfume-phone-browser.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.STUDIO_URL||'http://localhost:4175';
const desktop=await chromium.launch({channel:'chrome',headless:true}),mobile=await chromium.launch({channel:'chrome',headless:true});
const d=await desktop.newPage({viewport:{width:1440,height:1000}}),p=await mobile.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
const errors=[],checks=[];for(const page of[d,p]){page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));}
await p.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw Error('This test must not open a camera.');};});
await d.addInitScript(()=>localStorage.setItem('mirror-tutorial-v1','1'));
const cdp=await p.context().newCDPSession(p);
async function slide(fraction){await p.waitForFunction(()=>!document.querySelector('#fine').disabled);await p.locator('#fine').scrollIntoViewIfNeeded();const r=await p.locator('#fine').boundingBox();const point=x=>({x:r.x+r.width*x,y:r.y+r.height/2,id:1});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(.02)]});await p.waitForTimeout(40);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(fraction)]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
try{
 await d.goto(base+'/perfume');await d.waitForFunction(()=>window.__perfumeStudio?.ready&&window.__perfumeStudio.owns);
 await d.locator('#perfume-phone').click();await d.waitForFunction(()=>/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(document.querySelector('#pairing-code')?.textContent||''));
 const code=(await d.locator('#pairing-code').textContent()).replace('-','');await d.locator('#pair-close').click();
 await p.goto(base+'/phone#pair='+code);await p.waitForFunction(()=>document.querySelector('#workspace-title')?.textContent==='Perfume spray');checks.push('Pairs, and the phone titles itself Perfume spray');
 await p.locator('[data-action=atp-rotor]').click();await d.waitForFunction(()=>window.__perfumeStudio.state.tool==='rotor');await p.waitForFunction(()=>document.querySelector('#fine').max==='360');
 assert.match(await p.locator('#pad-label').textContent(),/pump/);
 await slide(.15);await d.waitForFunction(()=>window.__perfumeStudio.state.phase>20);await d.waitForFunction(()=>window.__perfumeStudio.pump.depth>.05);
 const partial=await d.evaluate(()=>({depth:window.__perfumeStudio.pump.depth,doses:window.__perfumeStudio.pump.doses}));assert.ok(partial.depth<.28&&partial.doses===0,JSON.stringify(partial));
 await slide(.98);await d.waitForFunction(()=>window.__perfumeStudio.pump.depth===1&&window.__perfumeStudio.pump.doses===1);checks.push(`Pump tool sets the target depth: ${partial.depth.toFixed(2)} short of the threshold, then a full spray`);
 await p.waitForFunction(()=>document.querySelector('[data-action=atp-rotor]').textContent==='Pump'&&document.querySelector('[data-action=atp-play]').textContent==='Press'&&/%$/.test(document.querySelector('#fine-value').textContent));checks.push('Phone names the pump tool and shows the stroke as a percentage');
 await p.locator('[data-action=atp-view]').click();await d.waitForFunction(()=>window.__perfumeStudio.state.tool==='view');await d.waitForFunction(()=>window.__perfumeStudio.pump.depth===0);checks.push('Leaving the pump tool lets the actuator rise');
 await p.locator('[data-action=atp-recenter]').click();await d.waitForFunction(()=>window.__perfumeStudio.pump.doses===0);checks.push('Phone Recenter restores the object');
 if(process.env.SHOT)await p.screenshot({path:process.env.SHOT});
 assert.deepEqual(errors,[]);console.log(checks.join('\n'));
}catch(e){console.log('Completed:',checks,errors);throw e;}finally{await desktop.close();await mobile.close();}
