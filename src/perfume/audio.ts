import type {MirrorAudio} from '../mirror/contracts';
import type {PerfumeSound} from './contracts';

const gaps:Record<PerfumeSound['type'],number>={pluck:.05,snap:.05,shock:.2,skin:.15,slice:.2,tear:.4,click:.05,clunk:.2,spray:.12};
/** Small and dry: a pump is clicks and air, with no drone behind it. */
export class PerfumeAudio implements MirrorAudio<PerfumeSound> {
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private noise:AudioBuffer|null=null;private last=new Map<string,number>();private muted=false;
 async start(){
  if(!this.ctx&&!this.build())return;
  if(this.ctx?.state==='suspended')await this.ctx.resume().catch(()=>{});
 }
 setMuted(m:boolean){this.muted=m;if(this.ctx&&this.master)this.master.gain.setTargetAtTime(m?0:.8,this.ctx.currentTime,.02);}
 stop(){void this.ctx?.close().catch(()=>{});this.ctx=this.master=this.noise=null;this.last.clear();}
 play(s:PerfumeSound){
  const ctx=this.ctx;if(!ctx||ctx.state!=='running')return;
  const now=ctx.currentTime;if(now-(this.last.get(s.type)??-Infinity)<gaps[s.type])return;
  this.last.set(s.type,now);
  if(s.type==='spray'){if(s.kind==='mist')this.air(now,.32,'highpass',3800,5200,.12);else if(s.kind==='jet')this.air(now,.3,'bandpass',1500,1100,.2);else if(s.kind==='sputter'){for(let i=0;i<4;i++)this.air(now+i*.05,.03,'bandpass',900,700,.16);}}
  else if(s.type==='click'){this.air(now,.018,'highpass',2600,2600,.2);}
  else if(s.type==='clunk'){this.tone('triangle',160,70,now,.14,.26);}
  else if(s.type==='pluck'){this.tone('triangle',330,220,now,.08,.12);}
  else if(s.type==='snap'){this.tone('sine',520,780,now,.09,.14);}
  else if(s.type==='tear'){this.air(now,.18,'bandpass',500,2000,.16);this.tone('sine',240,120,now,.2,.14);}
  else if(s.type==='shock'){this.tone('sine',80,28,now,.5,.46);this.air(now,.25,'lowpass',1600,160,.2);}
  else if(s.type==='skin'){this.tone('triangle',660,990,now,.14,.1);}
  else this.air(now,.2,'bandpass',900,5000,.09);
 }
 private build(){
  const Ctor=(globalThis as any).AudioContext??(globalThis as any).webkitAudioContext;if(!Ctor)return false;
  try{
   const ctx:AudioContext=new Ctor(),master=ctx.createGain(),noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate),data=noise.getChannelData(0);
   master.gain.value=this.muted?0:.8;master.connect(ctx.destination);
   for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
   this.ctx=ctx;this.master=master;this.noise=noise;return true;
  }catch{this.ctx=this.master=this.noise=null;return false;}
 }
 private envelope(at:number,peak:number,length:number){
  const gain=this.ctx!.createGain();
  gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(peak,at+Math.min(.01,length/3));gain.gain.exponentialRampToValueAtTime(.0001,at+length);
  gain.connect(this.master!);return gain;
 }
 private tone(type:OscillatorType,from:number,to:number,at:number,length:number,peak:number){
  const osc=this.ctx!.createOscillator();osc.type=type;osc.frequency.setValueAtTime(from,at);osc.frequency.exponentialRampToValueAtTime(to,at+length);
  osc.connect(this.envelope(at,peak,length));osc.onended=()=>osc.disconnect();osc.start(at);osc.stop(at+length+.02);
 }
 private air(at:number,length:number,kind:BiquadFilterType,from:number,to:number,peak:number){
  const ctx=this.ctx!,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter();
  source.buffer=this.noise;source.loop=true;filter.type=kind;filter.frequency.setValueAtTime(from,at);filter.frequency.exponentialRampToValueAtTime(to,at+length);
  source.connect(filter).connect(this.envelope(at,peak,length));source.onended=()=>source.disconnect();source.start(at);source.stop(at+length+.02);
 }
}
