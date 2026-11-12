import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.STUDIO_URL||'http://localhost:4175';
const pages=[
 {id:'atp',g:'__atpStudio',title:'ATP Synthase',rotor:true,play:true},
 {id:'perfume',g:'__perfumeStudio',title:'Perfume spray',rotor:true,play:true},
 {id:'machine',g:'__machineStudio',title:'Sewing machine',rotor:true,play:true},
 {id:'organ',g:'__organ',title:'The Accord',rotor:true,play:true},
 {id:'drivetrain',g:'__drivetrain',title:'Drivetrain',rotor:true,play:true},
 {id:'grasp',g:'__grasp',title:'Grasp',rotor:false,play:false},
 {id:'follow',g:'__follow',title:'Follow',rotor:false,play:false},
 {id:'atom',g:'__atomStudio',title:'Atom',rotor:false,play:true},
].filter(p=>!process.argv[2]||process.argv[2].split(',').includes(p.id));
const desktop=await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),mobile=await chromium.launch({channel:'chrome',headless:true});
const errors=[],checks=[];
try{
 for(const {id,g,title,rotor,play} of pages){
  const d=await (await desktop.newContext({viewport:{width:1440,height:900}})).newPage(),p=await (await mobile.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true})).newPage();
  for(const page of [d,p]){page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(`${id}: ${e.message}`));}
  await p.addInitScript(()=>{window.testDegrees=0;class Sensor extends EventTarget{quaternion=[0,0,0,1];timestamp=0;start(){this.timer=setInterval(()=>{const a=window.testDegrees*Math.PI/360;this.quaternion=[Math.sin(a),0,0,Math.cos(a)];this.timestamp=performance.now();this.dispatchEvent(new Event('reading'));},20);}stop(){clearInterval(this.timer);}}window.RelativeOrientationSensor=Sensor;});
  const cdp=await p.context().newCDPSession(p),S=fn=>d.evaluate(fn,g),btn=a=>p.locator(`[data-action=${a}]`);
  await d.goto(`${base}/${id}`);await d.waitForFunction(g=>window[g]?.ready&&window[g].owns,g,{timeout:90000});
  await d.locator(`#${id}-phone`).click();await d.waitForFunction(()=>/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(document.querySelector('#pairing-code')?.textContent||''));
  const code=(await d.locator('#pairing-code').textContent()).replace('-','');await d.locator('#pair-close').click();
  await p.goto(`${base}/phone#pair=${code}`);await p.waitForFunction(t=>document.querySelector('#workspace-title')?.textContent===t,title);
  assert.equal(await btn('atp-rotor').isVisible(),rotor,`${id}: rotor control shown only where the page has one`);
  assert.equal(await btn('atp-view').isVisible(),rotor,`${id}: view control paired with the rotor control`);
  assert.equal(await btn('atp-play').isVisible()||await btn('atp-pause').isVisible(),play,`${id}: play control shown only where it does something`);
  await p.locator('#start').click();await p.waitForFunction(()=>!document.querySelector('#clutch').disabled);await p.locator('#clutch').scrollIntoViewIfNeeded();
  const r=await p.locator('#clutch').boundingBox(),q=await S(g=>window[g].state.view.q);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2,id:1}]});await d.waitForFunction(g=>window[g].phoneHeld,g);
  await p.evaluate(()=>window.testDegrees=30);await d.waitForFunction(([g,q])=>JSON.stringify(window[g].state.view.q)!==JSON.stringify(q),[g,q]);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await d.waitForFunction(g=>!window[g].phoneHeld,g);await p.evaluate(()=>window.testDegrees=0);
  const z=await S(g=>window[g].state.view.zoom);await btn('atp-zoom-in').click();await d.waitForFunction(([g,z])=>window[g].state.view.zoom>z,[g,z]);
  if(play){await btn('atp-play').click();await d.waitForFunction(g=>window[g].playing,g);await btn('atp-pause').click();await d.waitForFunction(g=>!window[g].playing,g);}
  // Quick taps: each must land, even while the object keeps publishing its motion.
  if(rotor)for(let i=0;i<4;i++)for(const [a,t] of [['atp-rotor','rotor'],['atp-view','view']]){await btn(a).click();await d.waitForFunction(([g,t])=>window[g].state.tool===t,[g,t],{timeout:8000});}
  checks.push(`${id}: phone titled "${title}", tilt orbits, zoom${play?', play':''}${rotor?', 8 quick tool taps':''}`);
  await d.context().close();await p.context().close();
 }
 assert.deepEqual(errors,[]);console.log(checks.join('\n'));
}finally{await desktop.close();await mobile.close();}
