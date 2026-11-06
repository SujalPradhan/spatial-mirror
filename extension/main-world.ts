import {GestureTracker} from '../src/mirror/gestures';
import {InkBoard,InkController} from '../src/ink/ink';
import {renderInk} from '../src/ink/render';
import {DEFAULT_CONFIG,IDLE_STATUS,NS,type InkConfig,type InkStatus,type TrackerState} from './protocol';

const FRAME_W=320,SEND_MS=50,STALL_MS=3000;
const testing=location.hostname==='localhost';
const board=new InkBoard(),ctl=new InkController(board),gestures=new GestureTracker();
let config:InkConfig=DEFAULT_CONFIG,clearSeen:number|null=null,synthetic=false;
interface Pipe {video:HTMLVideoElement;canvas:HTMLCanvasElement;ctx:CanvasRenderingContext2D;src:MediaStreamTrack;out:MediaStreamTrack;timer:number;dead:boolean}
const pipes=new Set<Pipe>();
const toContent=(msg:object)=>window.postMessage({ns:NS,...msg},location.origin);

// Tracker link: the iframe is found by element, its origin comes from its own src, and every frame is checked for source window, origin and a token only this script and the iframe know.
const link={state:'idle' as TrackerState,token:'',origin:'',frame:null as HTMLIFrameElement|null,inflight:0,lastSend:0,lastResult:0,sent:0,fps:0,ms:0,window:performance.now(),started:0,readyMs:0};
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
function setState(state:TrackerState){if(link.state!==state){link.state=state;if(state==='failed')ctl.reset(performance.now());publish();}}
function startTracker(){
 if(link.state!=='idle')return;
 setState('loading');link.started=performance.now();toContent({t:'need-tracker'});
 const wait=(testing&&(window as any).__smInkTest?.helloTimeoutMs)||20000;
 setTimeout(()=>{if(link.state==='loading'&&!link.token)setState('failed');},wait);
 setTimeout(()=>{if(link.state==='loading')setState('failed');},wait+25000);
}
function findFrame(){
 const frame=document.querySelector<HTMLIFrameElement>('iframe[data-sm-ink]');
 if(!frame||!frame.contentWindow)return null;
 try{const url=new URL(frame.src);if(url.protocol!=='chrome-extension:')return null;link.origin=url.origin;}catch{return null;}
 return frame;
}
window.addEventListener('message',e=>{
 const d=e.data;if(!d||d.ns!==NS)return;
 if(e.source===window){
  if(e.origin!==location.origin)return;
  if(d.t==='config')applyConfig(d.config);
  return;
 }
 if(!link.frame)link.frame=findFrame();
 const frame=link.frame;
 if(!frame||e.source!==frame.contentWindow||e.origin!==link.origin)return;
 if(d.t==='hello'){if(!link.token){link.token=randomToken();frame.contentWindow!.postMessage({ns:NS,t:'init',token:link.token},link.origin);}return;}
 if(!link.token||d.token!==link.token)return;
 if(d.t==='ready'){link.lastResult=performance.now();link.readyMs=link.lastResult-link.started;setState('ready');}
 else if(d.t==='error'){if(link.state!=='ready')setState('failed');link.inflight=0;}
 else if(d.t==='result'&&link.state==='ready'){
  link.inflight=0;const now=performance.now();link.lastResult=now;link.ms=link.ms*.8+d.ms*.2;
  if(now-link.window>=1000){link.fps=link.sent*1000/(now-link.window);link.sent=0;link.window=now;publish();}
  if(!synthetic)onLandmarks(d.landmarks??[],d.worldLandmarks??[],d.handedness??[]);
 }
});
window.addEventListener('message',e=>{if(e.source===window&&e.data?.ns===NS&&e.data.t==='tracker-added'&&link.state==='loading'){link.frame=findFrame();if(testing&&(window as any).__smInkTest?.dropTracker)link.frame?.remove();}});

let aspect=4/3;
function onLandmarks(landmarks:any[],world:any[],handedness:(string|null)[]){
 if(!config.ink)return;
 const now=performance.now();ctl.update(gestures.update(landmarks,now,world,handedness,aspect));publish();
}
let lastPublished='';
function publish(){
 const status:InkStatus={tracker:link.state,hand:ctl.cursor!==null,fps:Math.round(link.fps),ms:Math.round(link.ms)};
 const json=JSON.stringify(status);if(json===lastPublished)return;lastPublished=json;toContent({t:'status',status});
}
function applyConfig(next:InkConfig){
 const now=performance.now(),was=config.lightboard;config={...DEFAULT_CONFIG,...next};
 ctl.options.flipX=!config.lightboard;
 if(was!==config.lightboard){ctl.reset(now);gestures.reset();board.clear();}
 scanViews();
 ctl.options.colour=config.colour;board.setKeep(config.keep,now);
 if(clearSeen===null)clearSeen=config.clearAt;else if(config.clearAt!==clearSeen){clearSeen=config.clearAt;board.clear();}
 if(!config.ink){ctl.reset(now);gestures.reset();board.clear();}
 publish();
}

function drawFrame(p:Pipe){
 const {video,canvas,ctx}=p;
 if(video.readyState<2||!video.videoWidth)return;
 if(canvas.width!==video.videoWidth||canvas.height!==video.videoHeight){canvas.width=video.videoWidth;canvas.height=video.videoHeight;}
 if(config.lightboard){ctx.save();ctx.translate(canvas.width,0);ctx.scale(-1,1);ctx.drawImage(video,0,0,canvas.width,canvas.height);ctx.restore();}
 else ctx.drawImage(video,0,0,canvas.width,canvas.height);
 if(!config.ink)return;
 const now=performance.now();board.prune(now);
 renderInk(ctx,canvas.width,canvas.height,board,now,link.state==='ready'||synthetic?ctl.cursor:null,config.colour);
}
let feeder:Pipe|null=null;
function feed(p:Pipe){
 const now=performance.now();
 if(!config.ink||link.state!=='ready'||synthetic||p!==feeder||!link.frame?.contentWindow||p.video.readyState<2)return;
 if(link.inflight&&now-link.inflight<STALL_MS)return;
 if(link.inflight&&now-link.lastResult>STALL_MS){setState('failed');return;}
 if(now-link.lastSend<SEND_MS)return;
 link.lastSend=now;link.inflight=now;link.sent++;aspect=p.video.videoWidth/p.video.videoHeight;
 createImageBitmap(p.video,{resizeWidth:FRAME_W,resizeHeight:Math.max(1,Math.round(FRAME_W/aspect)),resizeQuality:'low'}).then(
  bitmap=>{try{link.frame!.contentWindow!.postMessage({ns:NS,t:'frame',token:link.token,bitmap},link.origin,[bitmap]);}catch{bitmap.close();link.inflight=0;}},
  ()=>{link.inflight=0;});
}
// The call page mirrors its preview of our track, which would undo the lightboard flip, so those elements get a counter flip composed on top of whatever transform they already have.
const ours=new Set<MediaStreamTrack>(),flipped=new Map<HTMLVideoElement,{inline:string;applied:string}>();
const isOurs=(v:HTMLVideoElement)=>v.srcObject instanceof MediaStream&&v.srcObject.getVideoTracks().some(t=>ours.has(t)&&t.readyState==='live');
function unflip(v:HTMLVideoElement){const f=flipped.get(v);if(!f)return;flipped.delete(v);v.style.transform=f.inline;v.removeAttribute('data-sm-ink-flip');}
function flip(v:HTMLVideoElement){
 let f=flipped.get(v);
 if(f&&v.style.transform===f.applied)return;
 if(f)f.inline=v.style.transform;else f={inline:v.style.transform,applied:''};
 const base=getComputedStyle(v).transform;f.applied=(base==='none'?'':base+' ')+'scaleX(-1)';
 flipped.set(v,f);v.style.transform=f.applied;v.setAttribute('data-sm-ink-flip','1');
}
function scanViews(){
 for(const v of [...flipped.keys()])if(!config.lightboard||!v.isConnected||!isOurs(v))unflip(v);
 if(!config.lightboard||!ours.size)return;
 for(const v of document.querySelectorAll('video'))if(isOurs(v))flip(v);
}
setInterval(scanViews,500);
let scanQueued=false;new MutationObserver(()=>{if(scanQueued)return;scanQueued=true;requestAnimationFrame(()=>{scanQueued=false;scanViews();});}).observe(document,{childList:true,subtree:true});
function teardown(p:Pipe){
 if(p.dead)return;p.dead=true;clearTimeout(p.timer);pipes.delete(p);p.video.srcObject=null;
 if(feeder===p)feeder=[...pipes].pop()??null;
 if(!pipes.size){ctl.reset(performance.now());gestures.reset();}
}

async function build(stream:MediaStream){
 const src=stream.getVideoTracks()[0];if(!src)return stream;
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=new MediaStream([src]);
 await Promise.race([new Promise<void>(r=>{video.onloadedmetadata=()=>r();}),new Promise<never>((_,j)=>setTimeout(()=>j(new Error('metadata')),4000))]);
 await video.play();
 const canvas=document.createElement('canvas');canvas.width=video.videoWidth||640;canvas.height=video.videoHeight||480;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas');
 ctx.drawImage(video,0,0,canvas.width,canvas.height);
 const out=canvas.captureStream(30).getVideoTracks()[0];if(!out)throw new Error('capture');
 const p:Pipe={video,canvas,ctx,src,out,timer:0,dead:false};
 const stopOut=out.stop.bind(out),getSettings=out.getSettings.bind(out);
 out.stop=()=>{stopOut();src.stop();teardown(p);};
 out.getSettings=()=>({...getSettings(),...src.getSettings()});out.getConstraints=()=>src.getConstraints();
 out.getCapabilities=()=>src.getCapabilities();
 out.applyConstraints=async c=>{try{await src.applyConstraints(c);}catch{}};
 Object.defineProperty(out,'label',{get:()=>src.label});
 ours.add(out);const clone=out.clone.bind(out);out.clone=()=>{const c=clone();ours.add(c);return c;};
 src.addEventListener('ended',()=>{if(!p.dead){stopOut();teardown(p);out.dispatchEvent(new Event('ended'));}});
 const loop=()=>{if(p.dead)return;try{drawFrame(p);feed(p);}catch{}p.timer=window.setTimeout(loop,1000/30);};
 if(testing)((window as any).__smInk.sources??=[]).push(src);
 pipes.add(p);feeder=p;loop();startTracker();
 return new MediaStream([out,...stream.getAudioTracks()]);
}

const proto=MediaDevices.prototype,original=proto.getUserMedia;
const wrapped={async getUserMedia(this:MediaDevices,constraints?:MediaStreamConstraints){
 const stream:MediaStream=await original.call(this,constraints);
 if(!constraints||!constraints.video)return stream;
 try{return await build(stream);}catch{return stream;}
}}.getUserMedia;
Object.defineProperty(proto,'getUserMedia',{value:wrapped,writable:true,configurable:true,enumerable:true});
setInterval(()=>{if(pipes.size)publish();},1000);
toContent({t:'need-config'});

if(testing)(window as any).__smInk={
 feed:(hands:any[],handedness:(string|null)[]=[])=>{synthetic=true;if(!config.ink)return;const now=performance.now();ctl.update(gestures.update(hands,now,[],handedness,aspect));publish();},
 live:()=>{synthetic=false;},
 state:()=>({strokes:board.strokes.map(s=>({n:s.points.length,first:s.points[0],last:s.points[s.points.length-1],colour:s.colour,finishedAt:s.finishedAt})),cursor:ctl.cursor,flipped:flipped.size,tracker:link.state,readyMs:link.readyMs,fps:link.fps,ms:link.ms,config,pipes:pipes.size,sent:link.sent}),
};
