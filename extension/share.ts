import {LAYOUTS,LAYOUT_LABELS,type Layout,type Presenter} from './protocol';
import {mixer} from './mix';

const originalDisplay=MediaDevices.prototype.getDisplayMedia;
const Controller=(window as any).CaptureController as (new()=>{setFocusBehavior?:(b:string)=>void})|undefined;

/** What plays behind the presenter: a shared tab, window or screen, or a local video file, both drawn from a hidden video. */
export class Share {
 video:HTMLVideoElement|null=null;
 track:MediaStreamTrack|null=null;
 stream:MediaStream|null=null;
 name='';
 private url:string|null=null;
 onChange=()=>{};
 get isFile(){return !!this.url;}
 get live(){
  if(!this.video||this.video.readyState<2||!this.video.videoWidth)return false;
  return this.url?true:!!this.track&&this.track.readyState==='live';
 }
 get label(){return this.url?this.name:this.track?.label??'';}
 get playing(){return !!this.video&&!this.video.paused&&!this.video.ended;}
 async start(){
  const controller=typeof Controller==='function'?new Controller():undefined;
  const stream=await originalDisplay.call(navigator.mediaDevices,{video:{frameRate:{ideal:15}},audio:true,systemAudio:'include',suppressLocalAudioPlayback:false,selfBrowserSurface:'exclude',surfaceSwitching:'include',...(controller?{controller}:{})} as DisplayMediaStreamOptions);
  try{controller?.setFocusBehavior?.('no-focus-change');}catch{}
  this.use(stream);
 }
 use(stream:MediaStream){
  const track=stream.getVideoTracks()[0];if(!track)return;
  this.stop(false);
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=new MediaStream([track]);
  video.onloadeddata=()=>this.onChange();video.play().catch(()=>{});
  this.video=video;this.track=track;this.stream=stream;
  track.addEventListener('ended',()=>{if(this.track===track)this.stop();});
  mixer.setBackground({stream});
  this.onChange();
 }
 playFile(file:File){
  this.stop(false);
  const url=URL.createObjectURL(file),video=document.createElement('video');
  video.loop=true;video.playsInline=true;video.src=url;
  for(const e of ['loadeddata','play','pause','seeked'])video.addEventListener(e,()=>this.onChange());
  this.video=video;this.url=url;this.name=file.name;
  mixer.setBackground({video});mixer.resume();
  video.play().catch(()=>{});
  this.onChange();
 }
 toggle(){const v=this.video;if(!v||!this.url)return;if(v.paused)v.play().catch(()=>{});else v.pause();mixer.resume();}
 seek(seconds:number){
  const v=this.video;if(!v||!this.url)return;
  const end=Number.isFinite(v.duration)?Math.max(0,v.duration-.1):Infinity;
  v.currentTime=Math.max(0,Math.min(end,v.currentTime+seconds));
 }
 stop(notify=true){
  this.stream?.getTracks().forEach(t=>t.stop());this.track?.stop();
  if(this.video){this.video.pause();this.video.srcObject=null;this.video.removeAttribute('src');this.video.load();}
  if(this.url)URL.revokeObjectURL(this.url);
  this.video=null;this.track=null;this.stream=null;this.url=null;this.name='';
  mixer.setBackground(null);
  if(notify)this.onChange();
 }
}

const CSS=`
:host{all:initial}
.pill{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;align-items:center;max-width:calc(100vw - 24px);padding:6px 8px 6px 12px;border-radius:18px;background:rgba(22,24,29,.94);color:#eee;font:13px system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.pill[hidden]{display:none}
.label{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bcc}
button{font:inherit;color:inherit;background:#2a2e36;border:1px solid #3a3f49;border-radius:999px;padding:4px 10px;cursor:pointer}
button:hover{background:#353a44}
button.primary{background:#0a84ff;border-color:#0a84ff;color:#fff}
button[aria-pressed=true]{background:#eee;color:#16181d;border-color:#eee}
button[hidden],.sep[hidden],.player[hidden]{display:none}
.player{display:flex;gap:6px}
.sep{width:1px;height:18px;background:#3a3f49}
`;

export interface PillState {visible:boolean;sharing:boolean;file:boolean;playing:boolean;label:string;layout:Layout;presenter:Presenter}

/** The presenter's own controls for the screen behind them, on the call page only and never in the video. */
export class Pill {
 onShare=()=>{};onFile=(_:File)=>{};onStop=()=>{};onLayout=(_:Layout)=>{};onClose=()=>{};onPresenter=()=>{};onToggle=()=>{};onSeek=(_:number)=>{};
 private root:HTMLDivElement;private label:HTMLSpanElement;private share:HTMLButtonElement;private file:HTMLButtonElement;private stop:HTMLButtonElement;private player:HTMLDivElement;private play:HTMLButtonElement;private you:HTMLButtonElement;private layouts=new Map<Layout,HTMLButtonElement>();
 constructor(){
  const host=document.createElement('div');host.dataset.smInkPill='1';
  const shadow=host.attachShadow({mode:'open'});
  try{const sheet=new CSSStyleSheet();sheet.replaceSync(CSS);shadow.adoptedStyleSheets=[sheet];}catch{}
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
  const button=(text:string,click:()=>void,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=click;return b;};
  this.root=el('div','pill');this.root.hidden=true;this.root.setAttribute('role','toolbar');this.root.setAttribute('aria-label','Screen behind you');
  this.label=el('span','label');
  this.share=button('',()=>this.onShare(),'primary');
  const picker=el('input');picker.type='file';picker.accept='video/*';picker.hidden=true;
  picker.onchange=()=>{const f=picker.files?.[0];picker.value='';if(f)this.onFile(f);};
  this.file=button('Play a video file',()=>picker.click());
  this.stop=button('Stop',()=>this.onStop());
  this.player=el('div','player');this.player.setAttribute('role','group');this.player.setAttribute('aria-label','Video controls');
  this.play=button('Pause',()=>this.onToggle());
  this.player.append(button('Back 10 s',()=>this.onSeek(-10)),this.play,button('Forward 10 s',()=>this.onSeek(10)));
  this.you=button('',()=>this.onPresenter());this.you.title='Alt+Shift+P';
  this.root.append(this.label,this.share,this.file,picker,this.stop,this.player,el('span','sep'),this.you);
  for(const l of LAYOUTS){const b=button(LAYOUT_LABELS[l],()=>this.onLayout(l));b.dataset.layout=l;this.layouts.set(l,b);this.root.append(b);}
  const close=button('×',()=>this.onClose());close.title='Leave screen mode';close.setAttribute('aria-label','Leave screen mode');
  this.root.append(el('span','sep'),close);
  shadow.append(this.root);
  const mount=()=>{if(!host.isConnected)(document.body??document.documentElement).appendChild(host);};
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
  setInterval(mount,2000);
 }
 render(s:PillState){
  this.root.hidden=!s.visible;
  this.label.textContent=s.sharing?`Behind you: ${s.label||'shared screen'}`:'Screen behind you';
  this.share.textContent=s.sharing&&!s.file?'Change':'Share a tab or window';
  this.share.className=s.sharing&&!s.file?'':'primary';
  this.file.textContent=s.file?'Change video':'Play a video file';
  this.stop.hidden=!s.sharing;
  this.player.hidden=!s.file;
  this.play.textContent=s.playing?'Pause':'Play';
  this.you.textContent=`You: ${s.presenter==='in'?'In':'Out'}`;
  this.you.setAttribute('aria-pressed',String(s.presenter==='in'));
  for(const [l,b] of this.layouts)b.setAttribute('aria-pressed',String(l===s.layout));
 }
}
