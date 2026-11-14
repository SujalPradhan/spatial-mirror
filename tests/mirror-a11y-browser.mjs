import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';

// Keyboard, single-pointer and screen-reader access to /atp and /atom, with no camera. Each check is recorded on its own so one failure does not hide the rest.
const root=fileURLToPath(new URL('..',import.meta.url));
const shots=process.env.SHOTS||'';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer().listen(0,()=>{const p=s.address().port;s.close(()=>r(p));});});
let base=process.env.STUDIO_URL,child=null;
if(!base){
 const port=await freePort();
 child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 base=`http://localhost:${port}`;
 for(let i=0;i<150;i++){try{if((await fetch(`${base}/api/session`)).ok)break;}catch{}await sleep(200);}
}
const gpu=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...gpu]});
const results=[];
const check=async(name,fn)=>{if(process.env.GREP&&!new RegExp(process.env.GREP).test(name))return;try{await fn();results.push({name,ok:true});console.log(`ok   ${name}`);}catch(e){results.push({name,ok:false,error:String(e.message||e).split('\n')[0]});console.log(`FAIL ${name}: ${String(e.message||e).split('\n')[0]}`);}};
const ok=(value,message)=>{if(!value)throw new Error(message);};
const surfaces=[{id:'atp',global:'__atpStudio',summary:/ATP synthase.*ATP made/},{id:'atom',global:'__atomStudio',summary:/electrons/}].filter(x=>!process.env.ONLY||process.env.ONLY.split(',').includes(x.id));

async function open(surface,{viewport={width:1280,height:800},reducedMotion,permissions=[],stub=false}={}){
 const context=await browser.newContext({viewport,reducedMotion,permissions}),page=await context.newPage();
 page.setDefaultTimeout(15000);page.errors=[];page.on('pageerror',e=>page.errors.push(e.message));
 if(stub)await page.route('**/hand-worker.js?*',route=>route.fulfill({contentType:'text/javascript',body:"self.onmessage=({data})=>{if(data.type==='init')self.postMessage({type:'ready',delegate:'synthetic-test-stub'});if(data.type==='frame')data.bitmap.close();};"}));
 await page.goto(`${base}/${surface.id}`);
 await page.waitForFunction(g=>window[g]?.ready&&window[g].owns,surface.global);
 return page;
}
const snap=(page,surface)=>page.evaluate(g=>{
 const d=window[g],s=d.engine.liveScene,state=d.state;
 return {q:state.view.q,zoom:state.view.zoom,frozen:state.frozen,rate:s.rate??d.engine.speed,slice:s.slice.amount,fields:s.fields.length,skin:s.skin,explode:s.explode,shocks:s.shocks.length,glow:Math.max(0,...s.partGlow),moved:Math.max(0,...Array.from(s.partOffsets).map(Math.abs)),element:d.engine.element??0,taken:s.taken?.length??0,electrons:d.engine.electrons??0,paused:d.paused};
},surface.global);
const settle=(page,surface,predicate,message,timeout=4000)=>page.waitForFunction(([g,body])=>{
 const d=window[g],s=d.engine.liveScene,state=d.state,v={q:state.view.q,zoom:state.view.zoom,frozen:state.frozen,rate:s.rate??d.engine.speed,slice:s.slice.amount,fields:s.fields.length,skin:s.skin,explode:s.explode,shocks:s.shocks.length,glow:Math.max(0,...s.partGlow),moved:Math.max(0,...Array.from(s.partOffsets).map(Math.abs)),element:d.engine.element??0,taken:s.taken?.length??0,electrons:d.engine.electrons??0,paused:d.paused};
 return new Function('v',`return (${body})(v)`)(v);
},[surface.global,predicate.toString()],{timeout}).catch(()=>{throw new Error(message);});
const focusView=(page,surface)=>page.locator(`#${surface.id}-viewport`).focus();
const lum=([r,g,b])=>{const f=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};

for(const surface of surfaces){
 const {id}=surface;
 let page=await open(surface);
 const view=page.locator(`#${id}-viewport`);

 await check(`${id}: Tab reaches the 3D view and it shows a focus ring`,async()=>{
  for(let i=0;i<40;i++){await page.keyboard.press('Tab');if(await page.evaluate(v=>document.activeElement?.id===v,`${id}-viewport`))break;}
  ok(await page.evaluate(v=>document.activeElement?.id===v,`${id}-viewport`),'view never took focus from Tab');
  const ring=await view.evaluate(e=>{const c=getComputedStyle(e);return {style:c.outlineStyle,width:parseFloat(c.outlineWidth),visible:e.matches(':focus-visible')};});
  ok(ring.visible&&ring.style!=='none'&&ring.width>=2,`no visible outline: ${JSON.stringify(ring)}`);
  if(shots){await mkdir(shots,{recursive:true});await page.screenshot({path:`${shots}/${id}-focus.png`});}
 });

 await check(`${id}: view is in the accessibility tree with a role and name`,async()=>{
  const tree=await page.locator('body').ariaSnapshot();
  ok(/application "3D /.test(tree),`no named application in tree: ${tree.split('\n').filter(l=>/application|3D/.test(l)).join(' | ')||'(none)'}`);
  ok(await view.getAttribute('aria-roledescription'),'no aria-roledescription');
 });

 await check(`${id}: view is described by a plain summary that follows the scene`,async()=>{
  const target=await view.getAttribute('aria-describedby');
  ok(target,'no aria-describedby');
  await page.waitForFunction(([t,re])=>new RegExp(re).test(document.getElementById(t)?.textContent||''),[target,surface.summary.source]);
 });

 await check(`${id}: summary changes at most once per 1.5s`,async()=>{
  const target=await view.getAttribute('aria-describedby');
  const times=await page.evaluate(async t=>{const el=document.getElementById(t),at=[];new MutationObserver(()=>at.push(performance.now())).observe(el,{childList:true,characterData:true,subtree:true});
   // A counter that ticks every frame must still not reach the summary more than once per interval.
   const d=window.__atpStudio||window.__atomStudio;for(let i=0;i<30;i++){d.engine.kick?.(1);await new Promise(r=>setTimeout(r,100));}return at;},target);
  for(let i=1;i<times.length;i++)ok(times[i]-times[i-1]>=1400,`two writes ${Math.round(times[i]-times[i-1])}ms apart`);
 });

 await check(`${id}: counter is not a live region`,async()=>{
  ok(await page.locator(`#${id}-count`).getAttribute('aria-live')==='off','output still announces every change');
 });

 await check(`${id}: dialogs have accessible names`,async()=>{
  const names=await page.evaluate(()=>[...document.querySelectorAll('dialog')].map(d=>({id:d.id,name:document.getElementById(d.getAttribute('aria-labelledby')||'')?.textContent?.trim()||''})));
  ok(names.length>=3,`only ${names.length} dialogs`);
  for(const n of names)ok(n.name,`dialog ${n.id} has no name`);
 });

 await check(`${id}: action keys only fire while the view has focus`,async()=>{
  const key=id==='atom'?'n':'k',read=()=>snap(page,surface);
  await page.locator(`#${id}-camera`).focus();
  const before=await read();
  await page.keyboard.press(key);await page.keyboard.press('ArrowRight');await page.keyboard.press('+');await page.waitForTimeout(700);
  const away=await read();
  ok(JSON.stringify(away.q)===JSON.stringify(before.q)&&away.zoom===before.zoom&&away.skin===before.skin&&away.element===before.element&&!away.shocks,'keys acted with the view unfocused');
  await focusView(page,surface);
  await page.keyboard.press('ArrowRight');await page.keyboard.press('+');await page.keyboard.press(key);
  await settle(page,surface,`v=>v.zoom>${before.zoom}&&JSON.stringify(v.q)!==${JSON.stringify(JSON.stringify(before.q))}&&(${id==='atom'?`v.element!==${before.element}`:`v.skin!==${JSON.stringify(before.skin)}`})`,'keys did nothing with the view focused');
 });

 await check(`${id}: ? and the Keys button open a named keys dialog listing every action`,async()=>{
  try{
  await focusView(page,surface);await page.keyboard.press('?');
  const dialog=page.locator(`#${id}-keys`);
  await dialog.waitFor({state:'visible'});
  const rows=await page.locator(`#${id}-keys-list tr`).count(),actions=await page.evaluate(g=>window[g].actions.length,surface.global);
  ok(rows>=actions,`${rows} rows for ${actions} actions`);
  ok(/arrow/i.test(await dialog.innerText()),'arrow keys not listed');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  await page.locator(`#${id}-keys-open`).click();await dialog.waitFor({state:'visible'});await page.locator(`#${id}-keys-close`).click();
  ok(await page.evaluate(v=>document.activeElement?.id===v,`${id}-keys-open`),'focus did not return to the Keys button');
  }finally{await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));}
 });

 await check(`${id}: every action has a button that changes the scene`,async()=>{
  await page.locator(`#${id}-actions-toggle`).click();
  ok(await page.locator(`#${id}-actions-toggle`).getAttribute('aria-expanded')==='true','toolbar did not expand');
  const actions=await page.evaluate(g=>window[g].actions,surface.global);
  const expected=id==='atp'?['stir','slice','part','skin','tear','shock','pluck']:['take','next','previous','tear'];
  for(const e of [...expected,'turn-left','turn-right','turn-up','turn-down','zoom-in','zoom-out','reset-view','run','reverse','pause','freeze','undo'])ok(actions.some(a=>a.id===e),`no action ${e}`);
  const button=a=>page.locator(`#${id}-actions button[data-action="${a}"]`);
  const run=async(a,predicate,message)=>{ok(await button(a).count()===1,`no button for ${a}`);await button(a).click();await settle(page,surface,predicate,`${a}: ${message}`);};
  const start=await snap(page,surface);
  if(id==='atp'){
   await run('stir','v=>v.rate>.5','rotor did not speed up');
   await run('slice','v=>v.slice>.5','no slice plane');await run('slice','v=>v.slice<.05','slice did not clear');
   await run('part','v=>v.fields>0','no field');await run('part','v=>v.fields===0','field did not clear');
   await run('skin',`v=>v.skin!==${JSON.stringify(start.skin)}`,'skin unchanged');
   await run('tear','v=>v.explode>.5','did not tear');await run('tear','v=>v.explode<.05','did not reassemble');
   await run('shock','v=>v.shocks>0&&v.glow>0','no shock');
   await run('pluck','v=>v.moved>.01','no part moved');
  }else{
   await run('take',`v=>v.taken>0&&v.electrons<${start.electrons}`,'no electron taken');await run('take',`v=>v.taken===0&&v.electrons===${start.electrons}`,'electron did not return');
   await run('next',`v=>v.element!==${start.element}`,'element unchanged');await run('previous',`v=>v.element===${start.element}`,'did not step back');
   await run('tear','v=>v.explode>.5','did not tear');await run('tear','v=>v.explode<.05','did not reassemble');
  }
  const differs=q=>`v=>JSON.stringify(v.q)!==${JSON.stringify(JSON.stringify(q))}`,quat=async()=>(await snap(page,surface)).q;
  await run('turn-left',differs(await quat()),'view did not turn');
  await run('turn-right',differs(await quat()),'view did not turn');
  await run('turn-up',differs(await quat()),'view did not tilt');
  await run('turn-down',differs(await quat()),'view did not tilt');
  const z=(await snap(page,surface)).zoom;
  await run('zoom-in',`v=>v.zoom>${z}`,'no zoom in');await run('zoom-out',`v=>v.zoom<=${z}+1e-6`,'no zoom out');
  await run('reset-view','v=>Math.abs(v.q[0])+Math.abs(v.q[2])<1e-6&&v.zoom===1','view not reset');
  const home=JSON.stringify(await quat());
  await run('turn-left',`v=>JSON.stringify(v.q)!==${JSON.stringify(home)}`,'view did not turn');
  await run('undo',`v=>JSON.stringify(v.q)===${JSON.stringify(home)}`,'undo did nothing');
  const r0=(await snap(page,surface)).rate;
  await run('run',`v=>v.rate>${r0}`,'no faster');
  const r1=(await snap(page,surface)).rate;
  await run('reverse',`v=>v.rate<${r1}`,'no slower');
  await run('pause','v=>v.paused===true','not paused');
  ok(await button('pause').getAttribute('aria-pressed')==='true','pause button not pressed');
  await run('pause','v=>v.paused===false','did not resume');
  await run('freeze','v=>v.frozen===true','not frozen');
  ok(await button('freeze').getAttribute('aria-pressed')==='true','freeze button not pressed');
  await button('turn-left').click();await page.waitForTimeout(200);
  await run('freeze','v=>v.frozen===false','did not unfreeze');
  if(shots)await page.screenshot({path:`${shots}/${id}-actions.png`});
 });

 await check(`${id}: Escape closes the expanded toolbar and returns focus`,async()=>{
  if(await page.locator(`#${id}-actions`).isHidden())await page.locator(`#${id}-actions-toggle`).click();
  await page.locator(`#${id}-actions button`).first().focus();await page.keyboard.press('Escape');
  ok(await page.locator(`#${id}-actions`).isHidden(),'toolbar still open');
  ok(await page.evaluate(v=>document.activeElement?.id===v,`${id}-actions-toggle`),'focus not on the toggle');
 });

 await check(`${id}: gesture bar text is at least 11px and 4.5:1`,async()=>{
  const items=await page.evaluate(()=>[...document.querySelectorAll('.mirror-gestures li')].map(li=>{
   const c=getComputedStyle(li),m=c.color.match(/[\d.]+/g).map(Number);let alpha=(m[3]??1),n=li;
   for(;n&&n!==document.body;n=n.parentElement)alpha*=Number(getComputedStyle(n).opacity);
   return {size:parseFloat(c.fontSize),rgb:m.slice(0,3),alpha};
  }));
  ok(items.length>0,'no gesture items');
  // The lightest stop of the stage gradient is the worst case behind the bar.
  const back=[0x14,0x22,0x31];
  for(const i of items){
   const mixed=i.rgb.map((c,k)=>c*i.alpha+back[k]*(1-i.alpha));
   ok(i.size>=11,`${i.size}px label`);
   ok(contrast(mixed,back)>=4.5,`contrast ${contrast(mixed,back).toFixed(2)}`);
  }
 });

 await check(`${id}: settings persist, and one-handed hides the two-hand gestures`,async()=>{
  await page.locator(`#${id}-settings-open`).click();
  const dialog=page.locator(`#${id}-settings`);await dialog.waitFor({state:'visible'});
  await page.locator(`#${id}-set-onehand`).check();await page.locator(`#${id}-set-hold`).selectOption('long');await page.locator(`#${id}-set-motion`).check();await page.locator(`#${id}-set-tracking`).uncheck();
  if(shots)await page.screenshot({path:`${shots}/${id}-settings.png`});
  await page.locator(`#${id}-settings-close`).click();
  const ids=await page.locator(`#${id}-gestures li`).evaluateAll(l=>l.map(x=>x.dataset.gesture));
  ok(!ids.some(g=>['both-pinch','both-fist','clap'].includes(g)),`two-hand gestures still listed: ${ids}`);
  ok(await page.locator(`#${id}-camera`).isDisabled(),'camera button still enabled with tracking off');
  await page.reload();await page.waitForFunction(g=>window[g]?.ready&&window[g].owns,surface.global);
  const s=await page.evaluate(g=>window[g].settings,surface.global);
  ok(s.oneHanded&&s.hold==='long'&&s.reducedMotion===true&&s.tracking===false,`not restored: ${JSON.stringify(s)}`);
  await page.locator(`#${id}-settings-open`).click();
  ok(await page.locator(`#${id}-set-onehand`).isChecked()&&await page.locator(`#${id}-set-hold`).inputValue()==='long'&&!await page.locator(`#${id}-set-tracking`).isChecked(),'dialog does not show the saved values');
  await page.locator(`#${id}-settings-close`).click();
  ok(await page.locator(`#${id}-camera`).isDisabled(),'camera enabled after reload');
 });
 await page.context().close();

 await check(`${id}: reduced motion (system) stops idle motion; the setting can turn it on without the system flag`,async()=>{
  // The speed the object settles to by itself: an ATP rotor in turns per second, the Atom's orbit rate.
  const speed=p=>p.evaluate(g=>{const d=window[g];return Math.abs(d.engine.liveScene.rate??d.engine.speed);},surface.global);
  const calm=await open(surface,{reducedMotion:'reduce'});await calm.waitForTimeout(3000);const still=await speed(calm);await calm.context().close();
  ok(still<.01,`reduced-motion page still moves (${still})`);
  const busy=await open(surface);
  await busy.waitForFunction(([g])=>Math.abs(window[g].engine.liveScene.rate??window[g].engine.speed)>.1,[surface.global]).catch(()=>{throw new Error('control page never moves by itself');});
  await busy.locator(`#${id}-settings-open`).click();await busy.locator(`#${id}-set-motion`).check();await busy.locator(`#${id}-settings-close`).click();
  await busy.waitForFunction(([g])=>Math.abs(window[g].engine.liveScene.rate??window[g].engine.speed)<.01,[surface.global],{timeout:30000}).catch(()=>{throw new Error('setting did not stop motion');});
  await busy.context().close();
 });
}

for(const surface of surfaces){
 const {id}=surface;
 for(const viewport of [{width:640,height:400},{width:640,height:800},{width:393,height:700}]){
  const find=()=>{
   const sel=['.workspace-nav','.mirror-mark','.mirror-count','.mirror-enter','.mirror-gestures','.mirror-status','.atom-caption','.mirror-tutorial','.mirror-actions','.mirror-corner button'];
   const els=[...document.querySelectorAll(sel.join(','))].filter(e=>{
    if(e.matches('.mirror-actions button')||e.closest('[hidden]'))return false;
    const r=e.getBoundingClientRect(),c=getComputedStyle(e);
    return r.width>0&&r.height>0&&c.visibility!=='hidden'&&c.display!=='none'&&(e.textContent.trim()||e.matches('.mirror-actions,.mirror-gestures'));
   });
   const name=e=>e.id||e.className||e.tagName,out=[];
   for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){
    const a=els[i],b=els[j];if(a.contains(b)||b.contains(a))continue;
    const p=a.getBoundingClientRect(),q=b.getBoundingClientRect(),w=Math.min(p.right,q.right)-Math.max(p.left,q.left),h=Math.min(p.bottom,q.bottom)-Math.max(p.top,q.top);
    if(w>1&&h>1)out.push(`${name(a)} x ${name(b)} (${Math.round(w)}x${Math.round(h)})`);
   }
   return out;
  };
  await check(`${id} ${viewport.width}x${viewport.height}: no visible element overlaps another`,async()=>{
   const page=await open(surface,{viewport});
   const bad=await page.evaluate(find);ok(!bad.length,bad.join('; '));
   if(shots)await page.screenshot({path:`${shots}/${id}-${viewport.width}x${viewport.height}.png`});
   await page.locator(`#${id}-actions-toggle`).click();await page.waitForTimeout(300);
   const open_=await page.evaluate(find);ok(!open_.length,`toolbar open: ${open_.join('; ')}`);
   if(shots)await page.screenshot({path:`${shots}/${id}-${viewport.width}x${viewport.height}-actions.png`});
   await page.context().close();
  });
  await check(`${id} ${viewport.width}x${viewport.height}: nothing overlaps while the tutorial is up`,async()=>{
   const page=await open(surface,{viewport,permissions:['camera'],stub:true});
   await page.locator(`#${id}-camera`).click();await page.locator(`#${id}-tutorial`).waitFor({state:'visible'});await page.waitForTimeout(300);
   const bad=await page.evaluate(find);ok(!bad.length,bad.join('; '));
   if(shots)await page.screenshot({path:`${shots}/${id}-${viewport.width}x${viewport.height}-tutorial.png`});
   await page.context().close();
  });
 }
 await check(`${id}: tutorial text is written only when it changes`,async()=>{
  const page=await open(surface,{permissions:['camera'],stub:true});
  await page.locator(`#${id}-camera`).click();await page.locator(`#${id}-tutorial`).waitFor({state:'visible'});
  const writes=await page.evaluate(async v=>{let n=0;const p=document.querySelector(`#${v}-tutorial p`);new MutationObserver(r=>{n+=r.length;}).observe(p,{childList:true,characterData:true,subtree:true});await new Promise(r=>setTimeout(r,1500));return n;},id);
  ok(writes<=2,`${writes} writes to the live text in 1.5s`);
  await page.context().close();
 });
}

await browser.close();child?.kill();
const failed=results.filter(r=>!r.ok);
console.log(`\n${results.length-failed.length}/${results.length} checks passed`);
if(failed.length){console.log(failed.map(f=>` - ${f.name}`).join('\n'));process.exit(1);}
