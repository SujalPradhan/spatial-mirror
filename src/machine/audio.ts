import type {MirrorAudio} from '../mirror/contracts';
import type {MachineSound} from './contracts';

type Cue=Exclude<MachineSound['type'],'motor'>;
const gaps:Record<Cue,number>={stitch:.06,fault:.12,pluck:.05,snap:.05,shock:.2,skin:.15,slice:.2,tear:.5};
const LIMIT=16,GLIDE=.1,MOTOR_MAX=800/60;

/** A motor hum that rises with speed, a tick per stitch, and short cues built from one noise buffer. */
export class MachineAudio implements MirrorAudio<MachineSound> {
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private noise:AudioBuffer|null=null;private motor:{gain:GainNode;filter:BiquadFilterNode;osc:OscillatorNode}|null=null;
 private muted=false;private voices=0;private last=new Map<Cue,number>();
 async start(){if(!this.ctx&&!this.build())return;if(this.ctx?.state==='suspended')await this.ctx.resume().catch(()=>{});}
 setMuted(m:boolean){this.muted=m;if(this.ctx&&this.master)this.master.gain.setTargetAtTime(m?0:.8,this.ctx.currentTime,.02);}
 stop(){try{this.motor?.osc.stop();}catch{}void this.ctx?.close().catch(()=>{});this.ctx=this.master=this.noise=this.motor=null;this.last.clear();this.voices=0;}
 play(s:MachineSound){
  const ctx=this.ctx;if(!ctx||ctx.state!=='running')return;
  if(s.type==='motor'){this.drive(s.speed);return;}
  const now=ctx.currentTime;if(now-(this.last.get(s.type)??-Infinity)<gaps[s.type]||this.voices>=LIMIT)return;
  this.last.set(s.type,now);this.cue(s.type,now);
 }
 private build(){
  const Ctor=(globalThis as any).AudioContext??(globalThis as any).webkitAudioContext;if(!Ctor)return false;
  try{
   const ctx:AudioContext=new Ctor(),master=ctx.createGain(),limit=ctx.createDynamicsCompressor(),noise=ctx.createBuffer(1,ctx.sampleRate/2,ctx.sampleRate),data=noise.getChannelData(0);
   for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
   master.gain.value=this.muted?0:.8;master.connect(limit).connect(ctx.destination);
   const gain=ctx.createGain(),filter=ctx.createBiquadFilter(),osc=ctx.createOscillator();
   gain.gain.value=0;filter.type='lowpass';filter.frequency.value=200;osc.type='sawtooth';osc.frequency.value=50;osc.connect(filter).connect(gain).connect(master);osc.start();
   this.ctx=ctx;this.master=master;this.noise=noise;this.motor={gain,filter,osc};return true;
  }catch{return false;}
 }
 private drive(speed:number){
  const ctx=this.ctx,m=this.motor;if(!ctx||!m||!Number.isFinite(speed))return;
  const t=ctx.currentTime,n=Math.min(1,Math.sqrt(Math.abs(speed)/MOTOR_MAX));
  m.gain.gain.setTargetAtTime(n<.01?0:.04+n*.16,t,GLIDE);m.filter.frequency.setTargetAtTime(200+n*1200,t,GLIDE);m.osc.frequency.setTargetAtTime(50+n*110,t,GLIDE);
 }
 private env(at:number,peak:number,length:number){
  const g=this.ctx!.createGain();g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(peak,at+.004);g.gain.exponentialRampToValueAtTime(.0001,at+length);g.connect(this.master!);return g;
 }
 private tone(type:OscillatorType,from:number,to:number,at:number,length:number,peak:number){
  const o=this.ctx!.createOscillator();o.type=type;o.frequency.setValueAtTime(from,at);o.frequency.exponentialRampToValueAtTime(to,at+length);o.connect(this.env(at,peak,length));this.run(o,at,length);
 }
 private hiss(at:number,length:number,hz:number,peak:number){
  const ctx=this.ctx!,s=ctx.createBufferSource(),f=ctx.createBiquadFilter();s.buffer=this.noise;s.loop=true;f.type='bandpass';f.frequency.value=hz;s.connect(f).connect(this.env(at,peak,length));this.run(s,at,length);
 }
 private run(source:AudioScheduledSourceNode,at:number,length:number){this.voices++;source.onended=()=>{this.voices--;source.disconnect();};source.start(at);source.stop(at+length+.02);}
 private cue(type:Cue,at:number){
  switch(type){
   case 'stitch':this.hiss(at,.03,3200,.12);this.tone('square',190,110,at,.045,.08);break;
   case 'fault':this.tone('sawtooth',130,86,at,.16,.12);break;
   case 'pluck':this.tone('triangle',220,180,at,.12,.14);break;
   case 'snap':this.tone('triangle',150,90,at,.16,.16);this.hiss(at,.03,2400,.06);break;
   case 'shock':this.tone('sine',80,28,at,.6,.45);this.hiss(at,.3,500,.18);break;
   case 'skin':this.tone('triangle',660,990,at,.2,.1);break;
   case 'slice':this.hiss(at,.22,2600,.1);break;
   case 'tear':this.hiss(at,.45,800,.16);break;
  }
 }
}
