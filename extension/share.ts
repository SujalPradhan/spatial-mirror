import {LAYOUTS,LAYOUT_LABELS,type Layout} from './protocol';

const originalDisplay=MediaDevices.prototype.getDisplayMedia;
const Controller=(window as any).CaptureController as (new()=>{setFocusBehavior?:(b:string)=>void})|undefined;

/** A shared tab, window or screen, played into a hidden video so it can be drawn behind the presenter. */
export class Share {
 video:HTMLVideoElement|null=null;
 track:MediaStreamTrack|null=null;
 onChange=()=>{};
 get live(){return !!this.track&&this.track.readyState==='live'&&!!this.video&&this.video.readyState>=2&&this.video.videoWidth>0;}
 get label(){return this.track?.label??'';}
 async start(){
  const controller=typeof Controller==='function'?new Controller():undefined;
  const stream=await originalDisplay.call(navigator.mediaDevices,{video:{frameRate:{ideal:15}},audio:false,selfBrowserSurface:'exclude',surfaceSwitching:'include',...(controller?{controller}:{})} as DisplayMediaStreamOptions);
  try{controller?.setFocusBehavior?.('no-focus-change');}catch{}
  this.use(stream);
 }
 use(stream:MediaStream){
  const track=stream.getVideoTracks()[0];if(!track)return;
  this.stop(false);
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=new MediaStream([track]);
  video.onloadeddata=()=>this.onChange();video.play().catch(()=>{});
  this.video=video;this.track=track;
  track.addEventListener('ended',()=>{if(this.track===track)this.stop();});
  this.onChange();
 }
 stop(notify=true){
  this.track?.stop();if(this.video)this.video.srcObject=null;
  this.video=null;this.track=null;
  if(notify)this.onChange();
 }
}

const CSS=`
:host{all:initial}
.pill{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;gap:6px;align-items:center;padding:6px 8px 6px 12px;border-radius:999px;background:rgba(22,24,29,.94);color:#eee;font:13px system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.pill[hidden]{display:none}
.label{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bcc}
button{font:inherit;color:inherit;background:#2a2e36;border:1px solid #3a3f49;border-radius:999px;padding:4px 10px;cursor:pointer}
button:hover{background:#353a44}
button.primary{background:#0a84ff;border-color:#0a84ff;color:#fff}
button[aria-pressed=true]{background:#eee;color:#16181d;border-color:#eee}
.sep{width:1px;height:18px;background:#3a3f49}
`;

export interface PillState {visible:boolean;sharing:boolean;label:string;layout:Layout}

/** The presenter's own controls for the screen behind them, on the call page only and never in the video. */
export class Pill {
 onShare=()=>{};onStop=()=>{};onLayout=(_:Layout)=>{};onClose=()=>{};
 private root:HTMLDivElement;private label:HTMLSpanElement;private share:HTMLButtonElement;private stop:HTMLButtonElement;private layouts=new Map<Layout,HTMLButtonElement>();
 constructor(){
  const host=document.createElement('div');host.dataset.smInkPill='1';
  const shadow=host.attachShadow({mode:'open'});
  try{const sheet=new CSSStyleSheet();sheet.replaceSync(CSS);shadow.adoptedStyleSheets=[sheet];}catch{}
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
  this.root=el('div','pill');this.root.hidden=true;this.root.setAttribute('role','toolbar');this.root.setAttribute('aria-label','Screen behind you');
  this.label=el('span','label');
  this.share=el('button','primary');this.share.type='button';this.share.onclick=()=>this.onShare();
  this.stop=el('button','','Stop');this.stop.type='button';this.stop.onclick=()=>this.onStop();
  this.root.append(this.label,this.share,this.stop,el('span','sep'));
  for(const l of LAYOUTS){const b=el('button','',LAYOUT_LABELS[l]);b.type='button';b.dataset.layout=l;b.onclick=()=>this.onLayout(l);this.layouts.set(l,b);this.root.append(b);}
  const close=el('button','','×');close.type='button';close.title='Leave screen mode';close.setAttribute('aria-label','Leave screen mode');close.onclick=()=>this.onClose();
  this.root.append(el('span','sep'),close);
  shadow.append(this.root);
  const mount=()=>{if(!host.isConnected)(document.body??document.documentElement).appendChild(host);};
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
  setInterval(mount,2000);
 }
 render(s:PillState){
  this.root.hidden=!s.visible;
  this.label.textContent=s.sharing?`Behind you: ${s.label||'shared screen'}`:'Screen behind you';
  this.share.textContent=s.sharing?'Change':'Share a tab or window';
  this.share.className=s.sharing?'':'primary';
  this.stop.hidden=!s.sharing;
  for(const [l,b] of this.layouts)b.setAttribute('aria-pressed',String(l===s.layout));
 }
}
