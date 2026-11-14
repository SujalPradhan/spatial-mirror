import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),ext=path.join(root,'dist-extension');
const shots=process.env.SHOTS||path.join(tmpdir(),'sm-ink-screen');
await mkdir(shots,{recursive:true});
const nonce='n0nce123',CSP=`script-src 'nonce-${nonce}'; require-trusted-types-for 'script'`;
const call=`<!doctype html><meta charset=utf-8><title>test call</title><video id=v muted playsinline width=320></video>
<script nonce=${nonce}>
window.__smInkTest={helloTimeoutMs:1500};
const v=document.getElementById('v');
window.go=async()=>{const s=await navigator.mediaDevices.getUserMedia({video:true,audio:true});window.stream=s;v.srcObject=s;await v.play();};
window.probe=(fx,fy)=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const d=x.getImageData(Math.round(fx*c.width)-2,Math.round(fy*c.height)-2,5,5).data;let r=0,g=0,b=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];}const n=d.length/4;return [r/n,g/n,b/n];};
window.png=()=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/png');};
window.magenta=()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');const s=c.captureStream(15);setInterval(()=>{x.fillStyle='#ff00ff';x.fillRect(0,0,640,360);x.fillStyle='#fff';x.fillRect(300,160,40,40);},60);return s;};
window.useMagenta=()=>__smInk.share(magenta());
</script>`;
const target=`<!doctype html><meta charset=utf-8><title>share target</title><body style="margin:0;background:#ff00ff;height:100vh"></body>`;
const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html','content-security-policy':CSP});res.end(req.url.startsWith('/target')?target:call);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://localhost:${server.address().port}/`;
const dir=await mkdtemp(path.join(tmpdir(),'sm-ink-screen-'));
const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--auto-select-tab-capture-source-by-title=share target']});
const results=[],ok=(name,detail='')=>{results.push(name);console.log('ok -',name,detail);};
try{
 let [worker]=context.serviceWorkers();worker??=await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;
 const shareTab=await context.newPage();await shareTab.goto(base+'target');
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);await p.evaluate(()=>go());
 await p.waitForFunction(()=>__smInk.state().tracker==='ready',null,{timeout:30000});
 const state=()=>p.evaluate(()=>__smInk.state());
 const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
 const pop=async sel=>{await popup.bringToFront();await popup.click(sel);await p.bringToFront();};
 const pill=p.locator('[data-sm-ink-pill] .pill');
 const green=c=>c[1]>100&&c[0]<90,pink=c=>c[0]>180&&c[2]>180&&c[1]<90;
 const at=(x,y)=>p.evaluate(([x,y])=>probe(x,y),[x,y]);
 const shot=async name=>writeFile(path.join(shots,name+'.png'),Buffer.from((await p.evaluate(()=>png())).split(',')[1],'base64'));

 assert.equal(await pill.isVisible(),false);
 await popup.bringToFront();assert.equal(await popup.isVisible('#layout-row'),false);
 await pop('#backgrounds button[data-background=screen]');
 await p.waitForFunction(()=>__smInk.state().config.background==='screen');
 await pill.waitFor({state:'visible'});
 let s=await state();assert.equal(s.effective,'off');assert.equal(s.share.live,false);
 await p.waitForTimeout(400);assert.ok(green(await at(.2,.2)),'before a share the previous background (camera) shows');
 await popup.bringToFront();assert.equal(await popup.isVisible('#layout-row'),true);await p.bringToFront();
 ok('Screen mode shows the in-page pill and the popup layouts; until a share plays, the previous background stays');

 await pill.getByRole('button',{name:'Share a tab or window'}).click();
 const real=await p.waitForFunction(()=>__smInk.state().share.live,null,{timeout:6000}).then(()=>true,()=>false);
 if(!real){console.log('info - real tab capture did not start in this browser, using a canvas share');await p.evaluate(()=>useMagenta());await p.waitForFunction(()=>__smInk.state().share.live,null,{timeout:5000});}
 await p.evaluate(()=>__smInk.mask(null));await p.waitForTimeout(600);
 s=await state();assert.equal(s.effective,'screen');assert.deepEqual(s.share.hint,['detail']);
 if(real){
  const bar=await at(.5,.04);assert.ok(Math.max(...bar)<40&&green(await at(.3,.3)),'16:9 share letterboxed into the 4:3 frame '+JSON.stringify(bar));await shot('screen-real');
  ok('real getDisplayMedia from the pill button plays behind, fitted with letterbox',s.share.label);
  await p.evaluate(()=>useMagenta());await p.waitForTimeout(600);s=await state();
 }
 assert.ok(pink(await at(.2,.2)),'shared content fills the frame '+JSON.stringify(await at(.2,.2)));
 assert.ok(green(await at(.86,.84)),'camera box in the corner without a mask '+JSON.stringify(await at(.86,.84)));
 assert.match(await pill.textContent(),/Behind you/);
 await shot('screen-pip');
 ok('shared content plays behind; no mask gives a framed camera box; track hinted for detail');

 const all=Array(12*16).fill(255);
 await p.evaluate(b=>__smInk.mask(b),all);await p.waitForTimeout(500);
 const layout=async l=>{await pill.getByRole('button',{name:{corner:'Corner',side:'Side',full:'Full'}[l],exact:true}).click();await p.waitForFunction(l=>__smInk.state().config.layout===l,l);await p.evaluate(b=>__smInk.mask(b),all);await p.waitForTimeout(500);};
 assert.ok(green(await at(.8,.85))&&pink(await at(.2,.2))&&pink(await at(.2,.85)),'corner');await shot('screen-corner');
 await layout('side');assert.ok(green(await at(.2,.85))&&pink(await at(.8,.2))&&pink(await at(.8,.85)),'side');await shot('screen-side');
 await layout('full');assert.ok(green(await at(.2,.2))&&green(await at(.8,.85)),'full');
 await popup.bringToFront();assert.equal(await popup.getAttribute('#layouts button[data-layout=full]','aria-checked'),'true');await p.bringToFront();
 await layout('corner');
 ok('the presenter cut-out moves between Corner, Side and Full from the pill; the popup follows');

 await pill.getByRole('button',{name:'Stop'}).click();
 await p.waitForFunction(()=>!__smInk.state().share.live);await p.evaluate(()=>__smInk.mask(null));await p.waitForTimeout(500);
 s=await state();assert.equal(s.config.background,'screen');assert.equal(s.effective,'off');assert.deepEqual(s.share.hint,['']);
 assert.ok(green(await at(.2,.2)),'camera returns after stop');assert.match(await pill.textContent(),/Share a tab or window/);
 ok('stopping the share returns to the previous background, never a black frame, and the pill offers to share again');

 await pop('#backgrounds button[data-background=slides]');await pop('#backgrounds button[data-background=screen]');
 await p.evaluate(()=>useMagenta());await p.waitForFunction(()=>__smInk.state().share.live);
 await p.evaluate(()=>__smInk.mask(null));await p.waitForTimeout(400);assert.ok(pink(await at(.2,.2)));
 await p.evaluate(()=>__smInk.share(null));await p.waitForTimeout(500);
 s=await state();assert.equal(s.effective,'slides');assert.equal(s.prevBackground,'slides');
 ok('a share that ends falls back to the background chosen before Screen (Slides)');

 await p.evaluate(()=>useMagenta());await p.waitForFunction(()=>__smInk.state().share.live);
 await pop('#backgrounds button[data-background=blur]');await p.waitForFunction(()=>__smInk.state().config.background==='blur');
 s=await state();assert.equal(s.share.live,false);await pill.waitFor({state:'hidden'});
 ok('choosing another background stops the share and hides the pill');

 await pop('#backgrounds button[data-background=screen]');await p.evaluate(()=>useMagenta());await p.waitForFunction(()=>__smInk.state().share.live);
 await pill.getByRole('button',{name:'Leave screen mode'}).click();
 await p.waitForFunction(()=>__smInk.state().config.background==='blur');
 s=await state();assert.equal(s.share.live,false);
 await popup.bringToFront();await popup.waitForFunction(()=>chrome.storage.session.get('config').then(r=>r.config.background==='blur'));await p.bringToFront();
 ok('the pill close button leaves screen mode, restores the earlier background and updates storage');

 assert.deepEqual(errors,[]);ok('no page errors');
 console.log('PASS',results.length,'checks; screenshots in',shots);
}finally{await context.close();server.close();}
