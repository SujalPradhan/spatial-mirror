import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {imagePose} from './hand-fixtures.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),ext=path.join(root,'dist-extension');
const shots=process.env.SHOTS||'/private/tmp/claude-501/-Users-sujal-Mobile-Apps/5102d236-49d8-4b20-bc4c-0f6815aca7f0/scratchpad/agent3';
await mkdir(shots,{recursive:true});
const nonce='n0nce123',CSPS={strict:`script-src 'nonce-${nonce}'; require-trusted-types-for 'script'`,defaultself:`default-src 'self'; script-src 'nonce-${nonce}'; require-trusted-types-for 'script'`};
const page=`<!doctype html><meta charset=utf-8><title>test call</title><style>.mirror{transform:scaleX(-1)}</style><video id=v muted playsinline width=320></video><video id=self class=mirror muted playsinline width=160></video><video id=other class=mirror muted playsinline width=160></video>
<script nonce=${nonce}>
window.__smInkTest={helloTimeoutMs:1500,dropTracker:location.search.includes('drop')};
const v=document.getElementById('v');
window.go=async()=>{const s=await navigator.mediaDevices.getUserMedia({video:true,audio:true});window.stream=s;v.srcObject=s;await v.play();return {video:s.getVideoTracks().length,audio:s.getAudioTracks().length};};
window.showSelf=async()=>{const s=document.getElementById('self');s.srcObject=stream;await s.play();const c=document.createElement('canvas');c.width=64;c.height=48;c.getContext('2d').fillRect(0,0,9,9);const o=document.getElementById('other');o.srcObject=c.captureStream(10);await o.play();};
window.matrixA=id=>new DOMMatrix(getComputedStyle(document.getElementById(id)).transform).a;
window.corners=()=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const d=x.getImageData(0,24,c.width,64).data;let l=0,r=0;for(let k=0;k<d.length;k+=4){if(d[k]>40&&d[k+1]>200){if(((k/4)%c.width)<c.width/2)l++;else r++;}}return {l,r};};
window.second=async()=>{const s=await navigator.mediaDevices.getUserMedia({video:true});window.stream2=s;return s.getVideoTracks()[0].readyState;};
window.grab=(rgb)=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-rgb[0])+Math.abs(d[i+1]-rgb[1])+Math.abs(d[i+2]-rgb[2])<90)n++;return {n,w:c.width,h:c.height,png:c.toDataURL('image/png')};};
window.play=async(frames,ms=33)=>{for(const f of frames){window.__smInk.feed(f);await new Promise(r=>setTimeout(r,ms));}};
</script>`;
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://x');res.writeHead(200,{'content-type':'text/html','content-security-policy':CSPS[u.searchParams.get('csp')||'strict']});res.end(page);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://localhost:${server.address().port}/`;
const dir=await mkdtemp(path.join(tmpdir(),'sm-ink-'));
const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const results=[],ok=(name,detail='')=>{results.push(name);console.log('ok -',name,detail);};
try{
 let [worker]=context.serviceWorkers();worker??=await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;
 const RED=[255,59,48];
 const hands=(pose,x,y)=>[imagePose(pose,x,y)];
 const stroke=(n,from,to)=>Array.from({length:n},(_,i)=>hands('pinch',from[0]+(to[0]-from[0])*i/(n-1),from[1]+(to[1]-from[1])*i/(n-1)));

 // 1. main flow with the page CSP of a real call site, real tracker first
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto(base);
 const media=await p.evaluate(()=>go());assert.deepEqual(media,{video:1,audio:1});ok('audio track preserved, video returned',JSON.stringify(media));
 const state=()=>p.evaluate(()=>__smInk.state());
 assert.equal((await state()).pipes,1);
 await p.waitForFunction(()=>__smInk.state().tracker==='ready',null,{timeout:30000});const initMs=Math.round((await state()).readyMs);
 await p.waitForTimeout(3500);const live=await state();
 assert.ok(live.fps>5,'tracker fps '+live.fps);
 ok('real MediaPipe tracker ready inside extension iframe under strict CSP + trusted types',`init ${initMs} ms from first getUserMedia, ${live.fps.toFixed(1)} fps, ${live.ms.toFixed(1)} ms inference (hidden iframe, CPU delegate, 320 px frames)`);
 assert.ok(await p.evaluate(()=>{const s=stream.getVideoTracks()[0].getSettings();return s.width>0&&s.height>0;}));
 assert.equal(await p.evaluate(()=>stream.getVideoTracks()[0].applyConstraints({width:640}).then(()=>'ok',()=>'threw')),'ok');
 assert.ok(await p.evaluate(()=>{const s=stream.getVideoTracks()[0].getSettings(),src=__smInk.sources.at(-1).getSettings();return s.deviceId===src.deviceId&&s.groupId===src.groupId&&s.width===src.width;}),'processed track reports the real camera');
 ok('getSettings and applyConstraints do not throw');
 const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
 const statuses=pg=>pg.evaluate(async()=>{const out=[];for(const t of await chrome.tabs.query({})){try{out.push(await chrome.tabs.sendMessage(t.id,{type:'status'}));}catch{}}return out;});
 const tabStatus=async()=>(await statuses(popup)).find(x=>x.status.tracker==='ready');
 const st=await tabStatus();assert.ok(st);assert.equal(st.status.hand,false);ok('popup status channel reports tracker ready, no hand',JSON.stringify(st));

 await p.evaluate(h=>{for(let i=0;i<20;i++)window.postMessage({ns:'sm-ink',t:'result',token:'guess',landmarks:h,worldLandmarks:[],handedness:[],ms:1},'*');},hands('pinch',.5,.5));
 await p.waitForTimeout(300);assert.equal((await state()).strokes.length,0);ok('forged tracker results from the page are ignored');

 // 1b. lightboard: default on, mirrored output, self-view counter flip
 assert.equal((await state()).config.lightboard,true);ok('lightboard is on by default');
 const lbOn=await p.evaluate(()=>corners());
 const rightHeavy=c=>c.r>c.l*3&&c.r>50,leftHeavy=c=>c.l>c.r*3&&c.l>50;
 assert.ok(rightHeavy(lbOn),'lightboard on: timestamp text mirrored to the right '+JSON.stringify(lbOn));
 await p.evaluate(()=>showSelf());
 await p.waitForFunction(()=>document.getElementById('self').dataset.smInkFlip==='1',null,{timeout:5000});
 const net=id=>p.evaluate(id=>matrixA(id),id);
 assert.ok(await net('self')>0,'self view net flip');assert.ok(await net('other')<0,'other stream untouched');
 assert.equal(await p.evaluate(()=>document.getElementById('other').dataset.smInkFlip),undefined);
 await p.evaluate(()=>{document.getElementById('self').style.transform='scaleX(-1)';});
 await p.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.getElementById('self')).transform).a>0,null,{timeout:3000});
 ok('self-view of our track gets a counter flip (net no mirror), re-applied after the page rewrites it; a different stream is untouched');
 await popup.bringToFront();await popup.click('#lightboard');await p.bringToFront();
 await p.waitForFunction(()=>!__smInk.state().config.lightboard);await p.waitForTimeout(700);
 const lbOff=await p.evaluate(()=>corners());
 assert.ok(leftHeavy(lbOff)&&!rightHeavy(lbOff),'lightboard off: text stays on the left (control) '+JSON.stringify(lbOff));
 assert.ok(await net('self')<0,'self view restored');assert.equal(await p.evaluate(()=>document.getElementById('self').style.transform),'scaleX(-1)');
 assert.equal(await p.evaluate(()=>document.getElementById('self').dataset.smInkFlip),undefined);
 ok('lightboard off: output is the unmirrored camera (timestamp text is on the right when on, on the left when off), self-view original transform restored',`text pixels left/right: on ${lbOn.l}/${lbOn.r}, off ${lbOff.l}/${lbOff.r}`);
 await popup.bringToFront();await popup.click('#lightboard');await p.bringToFront();await p.waitForFunction(()=>__smInk.state().config.lightboard);await p.waitForTimeout(700);
 assert.ok(await net('self')>0);ok('popup lightboard toggle works end to end');

 // 2. synthetic landmarks through the real gesture path
 const before=await p.evaluate(rgb=>grab(rgb).n,RED);
 await p.evaluate(()=>__smInk.feed([]));
 await p.evaluate(f=>play(f),Array.from({length:8},()=>hands('open',.3,.6)));
 await p.evaluate(f=>play(f),stroke(30,[.3,.6],[.7,.55]));
 let s=await state();assert.equal(s.strokes.length,1);assert.ok(s.strokes[0].n>5);assert.ok(s.cursor?.drawing);
 await p.waitForTimeout(250);
 const shot=await p.evaluate(rgb=>grab(rgb),RED);
 assert.ok(shot.n>before+300,`ink pixels ${shot.n} vs ${before}`);
 await writeFile(path.join(shots,'outgoing-frame-with-ink.png'),Buffer.from(shot.png.split(',')[1],'base64'));
 const st2=await tabStatus();assert.equal(st2.status.hand,true);
 ok('pinch stroke appears in the outgoing video',`red pixels ${before} -> ${shot.n}, stroke points ${s.strokes[0].n}`);
 const y0=s.strokes[0].first.y;assert.ok(await p.evaluate(([rgb,y,w,h])=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.drawImage(document.getElementById('v'),0,0);const d=x.getImageData(0,Math.round(y*h)-6,w,12).data;let n=0;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-rgb[0])+Math.abs(d[i+1]-rgb[1])+Math.abs(d[i+2]-rgb[2])<90)n++;return n>20;},[RED,y0,shot.w,shot.h]));
 const raw=imagePose('pinch',.3,.6),rawX=(raw[4].x+raw[8].x)/2;
 assert.ok(Math.abs(s.strokes[0].first.x-(1-rawX))<.02,'stored x is mirrored '+s.strokes[0].first.x+' vs '+(1-rawX));
 const col=await p.evaluate(([rgb,x,y,w,h])=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.drawImage(document.getElementById('v'),0,0);const d=g.getImageData(Math.round(x*w)-8,Math.round(y*h)-8,16,16).data;let n=0;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-rgb[0])+Math.abs(d[i+1]-rgb[1])+Math.abs(d[i+2]-rgb[2])<90)n++;return n;},[RED,s.strokes[0].first.x,y0,shot.w,shot.h]);
 assert.ok(col>5,'ink under mirrored fingertip '+col);
 ok('ink starts under the mirrored fingertip in the outgoing frame (lightboard)');
 await p.evaluate(f=>play(f),Array.from({length:6},()=>hands('open',.5,.6)));
 await p.evaluate(f=>play(f),Array.from({length:24},()=>hands('thumbDown',.5,.6)));
 s=await state();assert.equal(s.strokes.length,0);await p.waitForTimeout(250);
 const after=await p.evaluate(rgb=>grab(rgb).n,RED);assert.ok(after<before+100,`after undo ${after}`);
 ok('thumbDown hold undoes the stroke',`red pixels ${after}`);

 // 3. popup relay: Ink off passes frames through, Clear, colour
 await popup.bringToFront();await popup.click('#ink');await p.bringToFront();
 await p.waitForFunction(()=>!__smInk.state().config.ink);
 await p.evaluate(f=>play(f),Array.from({length:6},()=>hands('open',.3,.6)));
 await p.evaluate(f=>play(f),stroke(30,[.3,.6],[.7,.55]));await p.waitForTimeout(250);
 const off=await p.evaluate(rgb=>grab(rgb).n,RED);assert.equal((await state()).strokes.length,0);assert.ok(off<before+100,`ink off pixels ${off}`);
 ok('Ink off passes the camera through untouched',`red pixels ${off}`);
 await popup.bringToFront();await popup.click('#ink');
 await popup.click('#swatches button:nth-child(4)');await popup.click('#keep');await p.bringToFront();
 await p.waitForFunction(()=>__smInk.state().config.ink&&__smInk.state().config.keep&&__smInk.state().config.colour==='#0a84ff');
 await p.evaluate(f=>play(f),Array.from({length:6},()=>hands('open',.3,.4)));
 await p.evaluate(f=>play(f),stroke(30,[.3,.4],[.7,.35]));await p.evaluate(f=>play(f),Array.from({length:10},()=>hands('open',.7,.35)));await p.waitForTimeout(250);
 s=await state();assert.equal(s.strokes.length,1);assert.equal(s.strokes[0].colour,'#0a84ff');
 const blue=await p.evaluate(()=>grab([10,132,255]).n);assert.ok(blue>300,'blue '+blue);
 ok('popup colour and Keep ink reach the page',`blue pixels ${blue}`);
 await popup.bringToFront();await popup.click('#clear');await p.bringToFront();await p.waitForFunction(()=>__smInk.state().strokes.length===0);
 ok('Clear removes ink');
 const png=await p.screenshot({path:path.join(shots,'call-page.png')});

 // 4. toggle camera: stop, ask again, concurrent streams
 const sources=await p.evaluate(()=>{const t=stream.getVideoTracks()[0];t.stop();return __smInk.sources.map(x=>x.readyState);});
 assert.deepEqual(sources,['ended']);assert.equal((await state()).pipes,0);
 ok('stopping the returned track stops the camera track');
 assert.equal(await p.evaluate(()=>go().then(r=>r.video)),1);assert.equal((await state()).pipes,1);
 assert.equal(await p.evaluate(()=>second()),'live');assert.equal((await state()).pipes,2);
 await p.evaluate(()=>stream.getVideoTracks()[0].stop());assert.equal((await state()).pipes,1);
 assert.equal(await p.evaluate(()=>stream2.getVideoTracks()[0].readyState),'live');
 const seq=await p.evaluate(async()=>{const a=document.getElementById('v');const t=a.currentTime;await new Promise(r=>setTimeout(r,500));return a.currentTime-t;});
 ok('asking again and two concurrent streams each get their own pipeline');
 assert.deepEqual(errors.filter(e=>!/Failed to load resource|^INFO:/.test(e)),[]);ok('no page errors');

 // 5. tracker iframe removed before it can answer: stream keeps working with the raw camera
 const q=await context.newPage();await q.goto(base+'?drop=1');
 await q.evaluate(()=>go());
 await q.waitForFunction(()=>__smInk.state().tracker==='failed',null,{timeout:10000});
 const a=await q.evaluate(()=>{const v=document.getElementById('v');return {t:v.currentTime,rs:v.readyState,w:v.videoWidth};});await q.waitForTimeout(600);
 const b=await q.evaluate(()=>document.getElementById('v').currentTime);assert.ok(b>a.t&&a.w>0);
 const failed=(await q.evaluate(()=>grab([0,0,0]))).png.length>2000;assert.ok(failed);
 await writeFile(path.join(shots,'tracker-failed-video.png'),Buffer.from((await q.evaluate(()=>grab([0,0,0]))).png.split(',')[1],'base64'));
 const fs=(await statuses(popup)).find(x=>x.status.tracker==='failed');assert.ok(fs);
 ok('tracker iframe never answers: status failed, outgoing video still plays the raw camera',JSON.stringify(fs.status));

 // 6. informational: a default-src 'self' page
 const r=await context.newPage();await r.goto(base+'?csp=defaultself');await r.evaluate(()=>go());
 const outcome=await r.waitForFunction(()=>['ready','failed'].includes(__smInk.state().tracker)&&__smInk.state().tracker,null,{timeout:30000}).then(h=>h.jsonValue());
 console.log('info - default-src self page: tracker',outcome);
 console.log('PASS',results.length,'checks; screenshots in',shots);
}finally{await context.close();server.close();}
