import {DUCK_LEVEL} from './protocol';

export type BackgroundAudio={stream:MediaStream}|{video:HTMLVideoElement};
interface Mix {source:MediaStreamAudioSourceNode;dest:MediaStreamAudioDestinationNode}

/** The call's audio: the real microphone plus the sound of whatever plays behind the presenter, as one track per getUserMedia request. */
export class Mixer {
 private ctx:AudioContext|null=null;
 private bus:GainNode|null=null;
 private monitor:GainNode|null=null;
 private node:AudioNode|null=null;
 private mixes=new Set<Mix>();
 volume=.6;duck=true;presenterIn=true;hear=false;
 private context(){
  if(!this.ctx||this.ctx.state==='closed'){
   const ctx=this.ctx=new AudioContext();
   this.bus=ctx.createGain();this.monitor=ctx.createGain();this.monitor.connect(ctx.destination);
   for(const m of this.mixes)this.bus.connect(m.dest);
  }
  if(this.ctx.state==='suspended')void this.ctx.resume().catch(()=>{});
  return this.ctx;
 }
 resume(){if(this.ctx)void this.ctx.resume().catch(()=>{});}
 configure(volume:number,duck:boolean,presenterIn:boolean,hear:boolean){this.volume=volume;this.duck=duck;this.presenterIn=presenterIn;this.hear=hear;this.apply();}
 get target(){return this.volume*(this.duck&&this.presenterIn?DUCK_LEVEL:1);}
 private apply(){
  if(!this.ctx||!this.bus||!this.monitor)return;
  const t=this.ctx.currentTime;
  this.bus.gain.setTargetAtTime(this.target,t,.08);
  this.monitor.gain.setTargetAtTime(this.hear?1:0,t,.02);
 }
 /** A file's own sound reaches the speakers only when hearing it here is on; a shared tab is already audible locally. */
 setBackground(source:BackgroundAudio|null){
  this.node?.disconnect();this.node=null;
  if(source){
   const ctx=this.context();
   if('stream' in source){
    if(source.stream.getAudioTracks().length){this.node=ctx.createMediaStreamSource(source.stream);this.node.connect(this.bus!);}
   }else{
    try{this.node=ctx.createMediaElementSource(source.video);this.node.connect(this.bus!);this.node.connect(this.monitor!);}catch{}
   }
   this.apply();
  }
  this.release();
 }
 private release(){
  if(this.ctx&&!this.mixes.size&&!this.node){const ctx=this.ctx;this.ctx=this.bus=this.monitor=null;void ctx.close().catch(()=>{});}
 }
 mix(mic:MediaStreamTrack){
  const ctx=this.context(),source=ctx.createMediaStreamSource(new MediaStream([mic])),dest=ctx.createMediaStreamDestination();
  source.connect(dest);this.bus!.connect(dest);this.apply();
  const m:Mix={source,dest};this.mixes.add(m);
  const out=dest.stream.getAudioTracks()[0],stopOut=out.stop.bind(out),getSettings=out.getSettings.bind(out);
  let done=false;
  const end=()=>{if(done)return;done=true;source.disconnect();try{this.bus?.disconnect(dest);}catch{}this.mixes.delete(m);mic.stop();this.release();};
  out.stop=()=>{stopOut();end();};
  out.getSettings=()=>({...getSettings(),...mic.getSettings()});
  Object.defineProperty(out,'label',{get:()=>mic.label});
  mic.addEventListener('ended',()=>{stopOut();end();out.dispatchEvent(new Event('ended'));});
  return out;
 }
 state(){return {mixes:this.mixes.size,background:!!this.node,gain:this.bus?this.bus.gain.value:0,target:this.target,ctx:this.ctx?.state??'none'};}
}
export const mixer=new Mixer();
