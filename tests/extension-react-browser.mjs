import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {imagePose} from './hand-fixtures.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),ext=path.join(root,'dist-extension'),fixture=path.join(root,'tests/fixtures/backdrop.webm');
const shots=process.env.SHOTS||path.join(tmpdir(),'sm-ink-react');
await mkdir(shots,{recursive:true});
const nonce='n0nce123',CSP=`script-src 'nonce-${nonce}'; require-trusted-types-for 'script'`;
const call=`<!doctype html><meta charset=utf-8><title>test call</title><video id=v muted playsinline width=320></video><input id=chat>
<script nonce=${nonce}>
window.__smInkTest={helloTimeoutMs:1500};
const v=document.getElementById('v');
window.revoked=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=u=>{revoked.push(u);revoke(u);};
window.go=async()=>{const s=await navigator.mediaDevices.getUserMedia({video:true,audio:true});window.stream=s;v.srcObject=s;await v.play();return {video:s.getVideoTracks().length,audio:s.getAudioTracks().length};};
window.probe=(fx,fy)=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const d=x.getImageData(Math.round(fx*c.width)-2,Math.round(fy*c.height)-2,5,5).data;let r=0,g=0,b=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];}const n=d.length/4;return [r/n,g/n,b/n];};
window.png=()=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/png');};
window.tone=(hz)=>{const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');const s=c.captureStream(15);setInterval(()=>{x.fillStyle='#ff00ff';x.fillRect(0,0,640,360);x.fillStyle='#fff';x.fillRect(300,160,40,40);},60);const a=new AudioContext(),o=a.createOscillator(),g=a.createGain(),d=a.createMediaStreamDestination();o.frequency.value=hz;g.gain.value=.6;o.connect(g).connect(d);o.start();s.addTrack(d.stream.getAudioTracks()[0]);return s;};
window.useTone=hz=>__smInk.share(tone(hz));
window.meter=null;
window.level=async(hz,ms=900)=>{
 if(!meter){const a=new AudioContext(),an=a.createAnalyser();an.fftSize=8192;an.smoothingTimeConstant=0;a.createMediaStreamSource(new MediaStream([stream.getAudioTracks()[0]])).connect(an);meter={a,an,f:new Float32Array(an.frequencyBinCount),t:new Float32Array(an.fftSize)};}
 await meter.a.resume();
 const bin=Math.round(hz*meter.an.fftSize/meter.a.sampleRate);let tone=0,rms=0;const end=performance.now()+ms;
 while(performance.now()<end){
  await new Promise(r=>setTimeout(r,60));
  meter.an.getFloatFrequencyData(meter.f);let m=0;for(let k=bin-2;k<=bin+2;k++)m=Math.max(m,Math.pow(10,meter.f[k]/20));tone=Math.max(tone,m);
  meter.an.getFloatTimeDomainData(meter.t);let s=0;for(const x of meter.t)s+=x*x;rms=Math.max(rms,Math.sqrt(s/meter.t.length));
 }
 return {tone,rms};
};
window.keyOn=(el,init)=>{(el||window).dispatchEvent(new KeyboardEvent('keydown',{code:'KeyP',key:'P',altKey:true,shiftKey:true,bubbles:true,composed:true,cancelable:true,...init}));};
window.sampleAmount=async(ms=420)=>{const out=[];const end=performance.now()+ms;while(performance.now()<end){out.push(__smInk.state().presenter);await new Promise(r=>setTimeout(r,16));}return out;};
</script>`;
const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html','content-security-policy':CSP});res.end(call);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://localhost:${server.address().port}/`;
const dir=await mkdtemp(path.join(tmpdir(),'sm-ink-react-'));
const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const results=[],ok=(name,detail='')=>{results.push(name);console.log('ok -',name,detail);};
try{
 let [worker]=context.serviceWorkers();worker??=await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);await p.evaluate(()=>go());
 await p.waitForFunction(()=>__smInk.state().tracker==='ready',null,{timeout:30000});
 const state=()=>p.evaluate(()=>__smInk.state());
 const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
 const pop=async fn=>{await popup.bringToFront();await fn();await p.bringToFront();};
 const pill=p.locator('[data-sm-ink-pill] .pill');
 const green=c=>c[1]>100&&c[0]<90&&c[2]<120,pink=c=>c[0]>180&&c[2]>180&&c[1]<90,blue=c=>c[2]>180&&c[0]<90&&c[1]<120&&c[1]>20;
 const at=(x,y)=>p.evaluate(([x,y])=>probe(x,y),[x,y]);
 const shot=async name=>writeFile(path.join(shots,name+'.png'),Buffer.from((await p.evaluate(()=>png())).split(',')[1],'base64'));
 const presenterIs=async v=>p.waitForFunction(v=>__smInk.state().config.presenter===v&&__smInk.state().presenter===(v==='in'?1:0),v,{timeout:3000});
 const all=Array(12*16).fill(255);
 const mask=async()=>{await p.evaluate(b=>__smInk.mask(b),all);await p.waitForTimeout(500);};
 const press=()=>p.keyboard.press('Alt+Shift+P');

 await pop(()=>popup.click('#backgrounds button[data-background=screen]'));
 await pill.waitFor({state:'visible'});
 await p.evaluate(()=>useTone(880));await p.waitForFunction(()=>__smInk.state().share.live);await mask();
 assert.equal(await pill.getByRole('button',{name:'You: In'}).getAttribute('aria-pressed'),'true');
 assert.ok(pink(await at(.2,.2))&&green(await at(.8,.85)),'presenter is in by default');
 await shot('in-default');
 ok('Screen mode starts with the presenter in, over the background');

 await pill.getByRole('button',{name:'You: In'}).click();await presenterIs('out');await p.waitForTimeout(150);
 for(const [x,y] of [[.8,.85],[.7,.8],[.2,.2],[.6,.7]])assert.ok(pink(await at(x,y)),'out shows only background at '+x+','+y+' '+JSON.stringify(await at(x,y)));
 assert.match(await pill.textContent(),/You: Out/);await shot('out');
 ok('pop out from the pill leaves only the background pixels where the presenter was');
 await pill.getByRole('button',{name:'You: Out'}).click();await presenterIs('in');await p.waitForTimeout(150);
 assert.ok(green(await at(.8,.85))&&pink(await at(.2,.2)));await shot('in');
 ok('pop in brings the presenter back in the current layout');

 await p.evaluate(()=>keyOn());
 const sample=await p.evaluate(()=>sampleAmount());
 assert.ok(sample.some(a=>a>.05&&a<.95),'eases through intermediate values '+sample.map(a=>a.toFixed(2)).join(' '));assert.equal(sample.at(-1),0);
 for(let i=1;i<sample.length;i++)assert.ok(sample[i]<=sample[i-1]+1e-6,'monotone out');
 await p.evaluate(()=>keyOn());const back=await p.evaluate(()=>sampleAmount());
 assert.ok(back.some(a=>a>.05&&a<.95)&&back.at(-1)===1);
 await p.waitForFunction(()=>__smInk.state().config.presenter==='in');
 ok('the transition eases over about 250 ms in both directions',`out ${sample.length} samples, ends ${sample.at(-1)}`);
 await p.emulateMedia({reducedMotion:'reduce'});
 await p.evaluate(()=>keyOn());const instant=await p.evaluate(()=>__smInk.state().presenter);assert.equal(instant,0);
 await p.evaluate(()=>keyOn());assert.equal(await p.evaluate(()=>__smInk.state().presenter),1);
 await p.emulateMedia({reducedMotion:'no-preference'});await presenterIs('in');
 ok('reduced motion makes the change instant');

 await p.focus('#chat');await press();await p.waitForTimeout(200);
 assert.equal((await state()).config.presenter,'in');
 await p.evaluate(()=>keyOn(document.getElementById('chat')));await p.waitForTimeout(200);assert.equal((await state()).config.presenter,'in');
 await p.evaluate(()=>document.getElementById('chat').blur());
 await press();await presenterIs('out');await press();await presenterIs('in');
 ok('Alt+Shift+P toggles on the call page and is ignored while typing in an input');
 await pop(()=>popup.click('#backgrounds button[data-background=blur]'));await p.waitForFunction(()=>__smInk.state().config.background==='blur');
 await press();await p.waitForTimeout(200);assert.equal((await state()).config.presenter,'in');
 await pop(()=>popup.click('#backgrounds button[data-background=screen]'));await p.waitForFunction(()=>__smInk.state().config.background==='screen');
 ok('the shortcut does nothing outside Screen mode');

 await p.evaluate(()=>useTone(880));await p.waitForFunction(()=>__smInk.state().share.live);await mask();
 await pop(()=>popup.click('#presenter'));await presenterIs('out');
 assert.equal(await pill.getByRole('button',{name:'You: Out'}).getAttribute('aria-pressed'),'false');
 await pill.getByRole('button',{name:'You: Out'}).click();await presenterIs('in');
 await popup.bringToFront();await popup.waitForFunction(()=>document.getElementById('presenter').textContent==='You: In');
 assert.equal(await popup.getAttribute('#presenter','aria-pressed'),'true');
 await press();await presenterIs('out');
 await popup.waitForFunction(()=>document.getElementById('presenter').textContent==='You: Out');
 await press();await presenterIs('in');await p.bringToFront();
 ok('the popup, the pill and the shortcut stay in sync through config');

 const hand=pose=>[imagePose(pose,.5,.5)];
 const feedFor=async(frames,ms)=>{for(let t=0;t<ms;t+=33){await p.evaluate(f=>__smInk.feed(f),frames);await p.waitForTimeout(33);}};
 await feedFor(hand('open'),1500);assert.equal((await state()).config.presenter,'in','palm is off by default');
 await pop(()=>popup.check('#palm'));await p.waitForFunction(()=>__smInk.state().config.palm);
 await feedFor(hand('open'),600);assert.equal((await state()).config.presenter,'in','palm held under a second');
 await feedFor([],300);
 await feedFor(hand('open'),2200);await presenterIs('out');
 await feedFor(hand('open'),1000);assert.equal((await state()).config.presenter,'out','one toggle per hold');
 await feedFor([],400);await feedFor(hand('open'),2200);await presenterIs('in');
 await pop(()=>popup.uncheck('#palm'));await p.waitForFunction(()=>!__smInk.state().config.palm);await feedFor([],200);
 ok('an open palm held for about a second toggles once per hold, only when turned on');

 const chooser=p.waitForEvent('filechooser');
 await pill.getByRole('button',{name:'Play a video file'}).click();
 await (await chooser).setFiles(fixture);
 await p.waitForFunction(()=>__smInk.state().share.file&&__smInk.state().share.live,null,{timeout:8000});await mask();
 let s=await state();assert.equal(s.effective,'screen');assert.equal(s.share.label,'backdrop.webm');
 assert.ok(blue(await at(.2,.2))&&green(await at(.8,.85)),'file behind, presenter in '+JSON.stringify(await at(.2,.2)));await shot('file-in');
 await pill.getByRole('button',{name:'You: In'}).click();await presenterIs('out');await p.waitForTimeout(150);
 assert.ok(blue(await at(.8,.85))&&blue(await at(.2,.2)));await shot('file-out');
 await pill.getByRole('button',{name:'You: Out'}).click();await presenterIs('in');
 assert.match(await pill.textContent(),/Behind you: backdrop.webm/);
 ok('a local video file plays behind the presenter through the same backdrop path',`duration ${s.share.duration.toFixed(1)} s`);

 const t0=(await state()).share.time;await p.waitForTimeout(700);const t1=(await state()).share.time;assert.ok(t1>t0+.4,'time advances '+t0+' '+t1);
 await pill.getByRole('button',{name:'Pause',exact:true}).click();await p.waitForFunction(()=>!__smInk.state().share.playing);
 const tp=(await state()).share.time;await p.waitForTimeout(500);assert.equal((await state()).share.time,tp);
 assert.ok(blue(await at(.2,.2)),'paused frame still drawn');
 await pill.getByRole('button',{name:'Play',exact:true}).click();await p.waitForFunction(()=>__smInk.state().share.playing);
 ok('play and pause from the pill');
 await pill.getByRole('button',{name:'Pause',exact:true}).click();await p.waitForFunction(()=>!__smInk.state().share.playing);
 const before=(await state()).share.time;
 await pill.getByRole('button',{name:'Forward 10 s'}).click();await p.waitForFunction(b=>__smInk.state().share.time>=b+9.9||__smInk.state().share.time>=__smInk.state().share.duration-.2,before);
 const fwd=(await state()).share.time;assert.ok(fwd>before+5,'forward '+before+' to '+fwd);
 await pill.getByRole('button',{name:'Back 10 s'}).click();await p.waitForFunction(f=>__smInk.state().share.time<=f-5,fwd);
 const back2=(await state()).share.time;assert.ok(back2>=0&&back2<fwd);
 await pill.getByRole('button',{name:'Back 10 s'}).click();await pill.getByRole('button',{name:'Back 10 s'}).click();await p.waitForFunction(()=>__smInk.state().share.time===0);
 await pill.getByRole('button',{name:'Forward 10 s'}).click();await pill.getByRole('button',{name:'Forward 10 s'}).click();await pill.getByRole('button',{name:'Forward 10 s'}).click();
 await pill.getByRole('button',{name:'Play',exact:true}).click();
 await p.waitForFunction(()=>{const s=__smInk.state().share;return s.playing&&s.time<8&&s.time>0;},null,{timeout:6000});
 ok('back and forward 10 s seek and clamp, and the file loops at the end',`forward ${before.toFixed(1)} to ${fwd.toFixed(1)}, back to ${back2.toFixed(1)}`);

 const baseline=await p.evaluate(()=>level(440,1200));
 await pop(()=>popup.fill('#volume','0'));await p.waitForFunction(()=>Math.abs(__smInk.state().config.videoVolume)<.001);await p.waitForTimeout(400);
 await pop(()=>popup.uncheck('#duck'));await p.waitForFunction(()=>!__smInk.state().config.duck);
 const v0=await p.evaluate(()=>level(440,900));
 await pop(()=>popup.fill('#volume','60'));await p.waitForFunction(()=>Math.abs(__smInk.state().config.videoVolume-.6)<.001);await p.waitForTimeout(500);
 const v60=await p.evaluate(()=>level(440,900));
 assert.ok(v60.tone>v0.tone*4&&v60.tone>.03,'file audio is in the outgoing track at 60% and not at 0: '+JSON.stringify({v0,v60}));
 await pop(()=>popup.fill('#volume','30'));await p.waitForFunction(()=>Math.abs(__smInk.state().config.videoVolume-.3)<.001);await p.waitForTimeout(500);
 const v30=await p.evaluate(()=>level(440,900));assert.ok(v30.tone<v60.tone*.75&&v30.tone>v0.tone*2,'30% is quieter than 60%: '+JSON.stringify({v30,v60}));
 await pop(()=>popup.fill('#volume','60'));await p.waitForTimeout(500);
 ok('the file audio mixes into the outgoing audio track and follows the video volume slider',`440 Hz level at 0%: ${v0.tone.toExponential(2)}, 30%: ${v30.tone.toExponential(2)}, 60%: ${v60.tone.toExponential(2)}`);

 await pop(()=>popup.check('#duck'));await p.waitForFunction(()=>__smInk.state().config.duck);await p.waitForTimeout(600);
 await presenterIs('in');const ducked=await p.evaluate(()=>level(440,900));
 await pill.getByRole('button',{name:'You: In'}).click();await presenterIs('out');await p.waitForTimeout(600);
 const open=await p.evaluate(()=>level(440,900));
 assert.ok(ducked.tone<open.tone*.6&&ducked.tone>0,'ducked '+JSON.stringify({ducked,open}));
 assert.equal((await state()).audio.target,.6);
 await pill.getByRole('button',{name:'You: Out'}).click();await presenterIs('in');
 assert.ok(Math.abs((await state()).audio.target-.18)<1e-6);
 ok('the video is lowered while the presenter is in and returns when out',`in ${ducked.tone.toExponential(2)}, out ${open.tone.toExponential(2)}`);
 await pop(()=>popup.uncheck('#duck'));await p.waitForTimeout(600);
 const noduck=await p.evaluate(()=>level(440,900));assert.ok(noduck.tone>ducked.tone*1.5,'duck off keeps the level '+JSON.stringify({noduck,ducked}));
 ok('turning ducking off keeps the video at its set volume while in');

 await p.evaluate(()=>{window.__t=stream.getAudioTracks()[0];__t.enabled=false;});await p.waitForTimeout(400);
 const muted=await p.evaluate(()=>level(440,800));
 assert.ok(muted.rms<1e-4&&muted.tone<1e-5,'disabled track is silent: '+JSON.stringify(muted));
 await p.evaluate(()=>{__t.enabled=true;});await p.waitForTimeout(300);
 const live=await p.evaluate(()=>level(440,900));assert.ok(live.tone>noduck.tone*.5);
 ok('disabling the returned audio track (what a call app mic mute does) silences the microphone and the background together');

 const hearBefore=await state();assert.equal(hearBefore.config.hear,false);
 await pop(()=>popup.check('#hear'));await p.waitForFunction(()=>__smInk.state().config.hear);
 ok('Hear video here is off by default and can be turned on from the popup');
 await pop(()=>popup.uncheck('#hear'));

 await pill.getByRole('button',{name:'Stop'}).click();
 await p.waitForFunction(()=>!__smInk.state().share.live);await p.evaluate(()=>__smInk.mask(null));await p.waitForTimeout(500);
 s=await state();assert.equal(s.config.background,'screen');assert.equal(s.effective,'blur');assert.equal(s.prevBackground,'blur');assert.equal(s.audio.background,false);
 assert.ok(green(await at(.2,.2)),'camera returns after stop');
 assert.equal(await p.evaluate(()=>revoked.length),1);
 const off=await p.evaluate(()=>level(440,900));assert.ok(off.tone<v60.tone*.35,'no background audio after stop '+JSON.stringify(off));
 ok('stop restores the previous background, drops the background audio and revokes the file URL');

 await p.evaluate(()=>useTone(880));await p.waitForFunction(()=>__smInk.state().share.live&&__smInk.state().audio.background);
 await pop(()=>popup.fill('#volume','60'));await pop(()=>popup.uncheck('#duck'));await p.waitForTimeout(700);
 const shared=await p.evaluate(()=>level(880,900));
 await p.evaluate(()=>__smInk.share(null));await p.waitForTimeout(500);
 const unshared=await p.evaluate(()=>level(880,900));
 assert.ok(shared.tone>unshared.tone*8&&shared.tone>.01,'tab audio rides the track: '+JSON.stringify({shared,unshared}));
 ok('audio from a shared tab (a tone stream standing in for getDisplayMedia) is mixed in and removed when the share ends');

 const mic=await p.evaluate(()=>level(440,2600));assert.ok(mic.rms>.003,'the microphone still comes through with no background '+JSON.stringify(mic));
 ok('with nothing playing the microphone passes through the mix',`peak rms ${mic.rms.toFixed(4)}`);

 assert.equal((await state()).audio.mixes,1);
 await p.evaluate(()=>stream.getAudioTracks()[0].stop());await p.waitForTimeout(300);
 const down=(await state()).audio;assert.deepEqual([down.mixes,down.ctx],[0,'none']);
 ok('stopping the returned audio track tears the audio graph down');

 assert.deepEqual(errors,[]);ok('no page errors');
 console.log('PASS',results.length,'checks; screenshots in',shots);
}finally{await context.close();server.close();}
