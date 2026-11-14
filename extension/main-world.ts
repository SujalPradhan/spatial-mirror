import {GestureTracker} from '../src/mirror/gestures';
import {InkBoard,InkController,type InkFrame} from '../src/ink/ink';
import {SCREEN_GUIDE_LINES,renderChip,renderGuide,renderInk} from '../src/ink/render';
import {StyleGestures,nextIn} from '../src/ink/style';
import {SwipeDetector} from '../src/ink/swipe';
import {SlideView} from '../src/ink/zoom';
import {drawSlide} from './slides';
import {Pill,Share} from './share';
import {BACKGROUNDS,BACKGROUND_LABELS,COLOURS,DEFAULT_CONFIG,NS,SLIDE_COUNT,type Background,type InkConfig,type Layout,type InkStatus,type SegState,type TrackerState} from './protocol';

const FRAME_W=320,SEND_MS=50,STALL_MS=3000;
const testing=location.hostname==='localhost';
const board=new InkBoard(),ctl=new InkController(board),gestures=new GestureTracker(),style=new StyleGestures(),swipe=new SwipeDetector(),view=new SlideView();
let config:InkConfig=DEFAULT_CONFIG,clearSeen:number|null=null,synthetic=false,noComposite=false;
interface Pipe {tmp?:HTMLCanvasElement;video:HTMLVideoElement;canvas:HTMLCanvasElement;ctx:CanvasRenderingContext2D;src:MediaStreamTrack;out:MediaStreamTrack;timer:number;dead:boolean}
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
  if(typeof d.segMs==='number'&&d.segMs>0)seg.ms=seg.ms*.8+d.segMs*.2;
  if(d.mask&&!synthetic&&effective()!=='off'){seg.state='ok';setMask(new Uint8Array(d.mask),d.mw,d.mh);}
  if(!synthetic)onLandmarks(d.landmarks??[],d.worldLandmarks??[],d.handedness??[]);
 }
 else if(d.t==='seg-error'){segFailed();}
});
window.addEventListener('message',e=>{if(e.source===window&&e.data?.ns===NS&&e.data.t==='tracker-added'&&link.state==='loading'){link.frame=findFrame();if(testing&&(window as any).__smInkTest?.dropTracker)link.frame?.remove();}});

const share=new Share(),pill=new Pill();
let prevBackground:Background='off';
/** What is drawn: screen mode shows the previous background until a share is actually playing. */
const effective=():Background=>config.background==='screen'&&!share.live?prevBackground:config.background;
let aspect=4/3;
function step(frame:InkFrame){
 const bg=effective(),slides=bg==='slides',zoomable=slides||bg==='screen',now=performance.now();
 ctl.options.twoHand=zoomable;ctl.update(frame);view.update(frame,zoomable,ctl.options.flipX);
 const dir=slides?swipe.update(frame):null;
 if(dir){
  const slide=(config.slide+(dir==='next'?1:SLIDE_COUNT-1))%SLIDE_COUNT;config={...config,slide};view.reset(now);
  chip={at:now,pos:ctl.cursor??{x:.5,y:.3},text:`Slide ${slide+1} of ${SLIDE_COUNT}`};patchConfig({slide});
 }
 for(const e of style.update(frame,board.drawing)){
  const pos=ctl.cursor??{x:.5,y:.3};
  if(e==='colour'){const colour=nextIn(COLOURS,config.colour);config={...config,colour};ctl.options.colour=colour;chip={at:now,pos,colour};patchConfig({colour});}
  else{let background=nextIn(share.live?BACKGROUNDS:BACKGROUNDS.filter(b=>b!=='screen'),config.background);if(seg.state==='failed'&&background!=='screen')background='off';setBackground(background);chip={at:now,pos,text:BACKGROUND_LABELS[background]};patchConfig({background});}
 }
}
function onLandmarks(landmarks:any[],world:any[],handedness:(string|null)[]){
 if(!config.ink)return;
 step(gestures.update(landmarks,performance.now(),world,handedness,aspect));publish();
}
const patchConfig=(patch:Partial<InkConfig>)=>toContent({t:'patch',patch});
let chip:{at:number;pos:{x:number;y:number};colour?:string;text?:string}|null=null;
const seg={state:'idle' as SegState,ms:0,count:0};
let maskCanvas:HTMLCanvasElement|null=null,maskPrev:Float32Array|null=null,maskImage:ImageData|null=null;
function setBackground(background:Background){remember(background);config={...config,background};if(effective()==='off')clearMask();syncShare();}
function remember(next:Background){if(next==='screen'&&config.background!=='screen')prevBackground=config.background;if(next!==config.background)view.reset(performance.now());}
function clearMask(){maskCanvas=null;maskPrev=null;maskImage=null;}
function segFailed(){seg.state='failed';clearMask();if(config.background==='screen'){prevBackground='off';syncShare();}else if(config.background!=='off'){setBackground('off');patchConfig({background:'off'});}publish();}
/** Person confidence bytes become a small alpha canvas, eased over time and sharpened so the edge does not shimmer. */
function setMask(bytes:Uint8Array,mw:number,mh:number){
 if(!maskCanvas||maskCanvas.width!==mw||maskCanvas.height!==mh||!maskPrev||!maskImage){maskCanvas=document.createElement('canvas');maskCanvas.width=mw;maskCanvas.height=mh;maskPrev=null;maskImage=new ImageData(mw,mh);}
 const first=!maskPrev;maskPrev??=new Float32Array(mw*mh);const d=maskImage.data;
 for(let i=0;i<bytes.length&&i<maskPrev.length;i++){
  const v=bytes[i]/255,s=maskPrev[i]=first?v:maskPrev[i]*.5+v*.5,a=Math.max(0,Math.min(1,(s-.3)/.4));
  d[i*4+3]=a*255;
 }
 maskCanvas.getContext('2d')!.putImageData(maskImage,0,0);seg.count++;
}
let lastPublished='';
function publish(){
 const status:InkStatus={tracker:link.state,hand:ctl.cursor!==null,fps:Math.round(link.fps),ms:Math.round(link.ms),seg:seg.state,segMs:Math.round(seg.ms),share:share.live};
 const json=JSON.stringify(status);if(json===lastPublished)return;lastPublished=json;toContent({t:'status',status});
}
function applyConfig(next:InkConfig){
 const now=performance.now(),was=config.lightboard,slide=config.slide,merged={...DEFAULT_CONFIG,...next};remember(merged.background);config=merged;
 if(config.slide!==slide)view.reset(now);
 ctl.options.flipX=!config.lightboard;
 if(effective()==='off')clearMask();else if(seg.state==='failed'&&config.background!=='screen'){config.background='off';patchConfig({background:'off'});}
 if(config.background!=='screen'&&share.track)share.stop(false);
 syncShare();
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
 const w=canvas.width,h=canvas.height,now=performance.now();
 const bg=effective();
 if(bg==='screen')screenFrame(p,w,h);
 else if(bg!=='off'&&maskCanvas&&!noComposite)composite(p,w,h);
 else camera(ctx,video,w,h);
 if(!config.ink)return;
 board.prune(now);
 renderInk(ctx,w,h,board,now,link.state==='ready'||synthetic?ctl.cursor:null,config.colour);
 if(chip)renderChip(ctx,w,h,chip.pos,now-chip.at,chip);
 if(config.guide)bg==='screen'?renderGuide(ctx,w,h,SCREEN_GUIDE_LINES,config.layout==='side'):renderGuide(ctx,w,h);
}
/** The camera, mirrored when the lightboard is on; the mask and the person layer use the same transform so they always agree. */
function camera(c:CanvasRenderingContext2D,source:CanvasImageSource,w:number,h:number,inset=0){
 c.save();if(config.lightboard){c.translate(w,0);c.scale(-1,1);}
 c.drawImage(source,-w*inset,-h*inset,w*(1+2*inset),h*(1+2*inset));c.restore();
}
function backdrop(c:CanvasRenderingContext2D,video:HTMLVideoElement,w:number,h:number,now:number){
 if(effective()==='blur'){c.filter='blur(14px)';camera(c,video,w,h,.04);c.filter='none';return;}
 const v=view.current(now);c.save();c.translate(w/2+v.x*w,h/2+v.y*h);c.scale(v.zoom,v.zoom);c.translate(-w/2,-h/2);
 drawSlide(c,w,h,config.slide);c.restore();
}
/** The presenter cut out of the camera on a transparent canvas the size of the frame. */
function person(p:Pipe,w:number,h:number){
 if(!p.tmp||p.tmp.width!==w||p.tmp.height!==h){p.tmp=document.createElement('canvas');p.tmp.width=w;p.tmp.height=h;}
 const t=p.tmp.getContext('2d')!;
 t.globalCompositeOperation='source-over';t.clearRect(0,0,w,h);camera(t,p.video,w,h);
 t.globalCompositeOperation='destination-in';t.filter='blur(3px)';camera(t,maskCanvas!,w,h);t.filter='none';t.globalCompositeOperation='source-over';
 return p.tmp;
}
function composite(p:Pipe,w:number,h:number){
 backdrop(p.ctx,p.video,w,h,performance.now());
 p.ctx.drawImage(person(p,w,h),0,0);
}
const LAYOUT_SCALE:Record<Layout,number>={corner:.42,side:.62,full:1};
/** Where the presenter sits over the shared screen, anchored to the bottom edge. */
function placement(layout:Layout,w:number,h:number){
 const s=LAYOUT_SCALE[layout],dw=w*s,dh=h*s;
 return {x:layout==='corner'?w-dw-w*.02:layout==='side'?-w*.06:0,y:h-dh,w:dw,h:dh};
}
function fit(c:CanvasRenderingContext2D,v:HTMLVideoElement,w:number,h:number){
 const k=Math.min(w/v.videoWidth,h/v.videoHeight),dw=v.videoWidth*k,dh=v.videoHeight*k;
 c.drawImage(v,(w-dw)/2,(h-dh)/2,dw,dh);
}
function screenFrame(p:Pipe,w:number,h:number){
 const {ctx}=p,v=view.current(performance.now());
 ctx.fillStyle='#0d1017';ctx.fillRect(0,0,w,h);
 ctx.save();ctx.translate(w/2+v.x*w,h/2+v.y*h);ctx.scale(v.zoom,v.zoom);ctx.translate(-w/2,-h/2);fit(ctx,share.video!,w,h);ctx.restore();
 if(maskCanvas&&!noComposite){const r=placement(config.layout,w,h);ctx.drawImage(person(p,w,h),r.x,r.y,r.w,r.h);return;}
 // Without a person mask the camera sits in a framed box in the corner.
 const s=.3,bw=w*s,bh=h*s,bx=w-bw-w*.025,by=h-bh-h*.04,rad=Math.min(bw,bh)*.08;
 ctx.save();ctx.beginPath();ctx.roundRect(bx,by,bw,bh,rad);ctx.clip();ctx.translate(bx,by);ctx.scale(s,s);camera(ctx,p.video,w,h);ctx.restore();
 ctx.save();ctx.beginPath();ctx.roundRect(bx,by,bw,bh,rad);ctx.lineWidth=Math.max(2,w*.003);ctx.strokeStyle='rgba(255,255,255,.85)';ctx.stroke();ctx.restore();
}
/** Screen content asks the encoder to keep detail over motion; the pill shows only while a camera is in use. */
function syncShare(){
 const sharing=share.live&&config.background==='screen';
 for(const p of pipes)try{p.out.contentHint=sharing?'detail':'';}catch{}
 pill.render({visible:config.background==='screen'&&pipes.size>0,sharing:share.live,label:share.label,layout:config.layout});
 publish();
}
share.onChange=()=>{if(!share.live)view.reset(performance.now());syncShare();};
pill.onShare=()=>{share.start().catch(()=>{});};
pill.onStop=()=>share.stop();
pill.onLayout=layout=>{config={...config,layout};patchConfig({layout});syncShare();};
pill.onClose=()=>{share.stop(false);const background=prevBackground;setBackground(background);patchConfig({background});};
let feeder:Pipe|null=null;
function feed(p:Pipe){
 const now=performance.now();
 if((!config.ink&&effective()==='off')||link.state!=='ready'||synthetic||p!==feeder||!link.frame?.contentWindow||p.video.readyState<2)return;
 if(link.inflight&&now-link.inflight<STALL_MS)return;
 if(link.inflight&&now-link.lastResult>STALL_MS){setState('failed');return;}
 if(now-link.lastSend<SEND_MS)return;
 link.lastSend=now;link.inflight=now;link.sent++;
 const segment=effective()!=='off'&&seg.state!=='failed'?(testing&&(window as any).__smInkTest?.failSegmenter?'fail':link.sent%2===0):false;aspect=p.video.videoWidth/p.video.videoHeight;
 createImageBitmap(p.video,{resizeWidth:FRAME_W,resizeHeight:Math.max(1,Math.round(FRAME_W/aspect)),resizeQuality:'low'}).then(
  bitmap=>{try{link.frame!.contentWindow!.postMessage({ns:NS,t:'frame',token:link.token,bitmap,segment},link.origin,[bitmap]);}catch{bitmap.close();link.inflight=0;}},
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
 syncShare();
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
 pipes.add(p);feeder=p;loop();startTracker();syncShare();
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
 feed:(hands:any[],handedness:(string|null)[]=[])=>{synthetic=true;if(!config.ink)return;step(gestures.update(hands,performance.now(),[],handedness,aspect));publish();},
 mask:(bytes:number[]|null,mw=16,mh=12)=>{synthetic=true;if(bytes){maskPrev=null;setMask(Uint8Array.from(bytes),mw,mh);}else clearMask();},
 noComposite:(on:boolean)=>{noComposite=on;},
 share:(stream:MediaStream|null)=>{if(stream)share.use(stream);else share.stop();},
 pill:()=>document.querySelector('[data-sm-ink-pill]')!==null,
 live:()=>{synthetic=false;},
 state:()=>({view:{...view.current(performance.now())},strokes:board.strokes.map(s=>({n:s.points.length,first:s.points[0],last:s.points[s.points.length-1],colour:s.colour,finishedAt:s.finishedAt})),cursor:ctl.cursor,chip,seg:{...seg},hasMask:!!maskCanvas,flipped:flipped.size,share:{live:share.live,label:share.label,hint:[...pipes].map(p=>p.out.contentHint)},prevBackground,effective:effective(),tracker:link.state,readyMs:link.readyMs,fps:link.fps,ms:link.ms,config,pipes:pipes.size,sent:link.sent}),
};
