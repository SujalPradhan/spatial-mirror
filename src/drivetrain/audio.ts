import type {MirrorAudio} from '../mirror/contracts';
import type {DrivetrainSound} from './contracts';

type Cue=Exclude<DrivetrainSound['type'],'motor'>;
const gaps:Partial<Record<Cue,number>>={tooth:.04,clink:.05,miss:.12,pick:.05};
const LIMIT=16,GLIDE=.12;

/** A gear whine that rises with speed and load, and short metallic cues built from one noise buffer. */
export class DrivetrainAudio implements MirrorAudio<DrivetrainSound> {
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private noise:AudioBuffer|null=null;private motor:{gain:GainNode;filter:BiquadFilterNode;osc:OscillatorNode;sub:OscillatorNode}|null=null;
 private muted=false;private voices=0;private last=new Map<Cue,number>();
 async start(){if(!this.ctx&&!this.build())return;if(this.ctx?.state==='suspended')await this.ctx.resume().catch(()=>{});}
 setMuted(m:boolean){this.muted=m;if(this.ctx&&this.master)this.master.gain.setTargetAtTime(m?0:.8,this.ctx.currentTime,.02);}
 stop(){try{this.motor?.osc.stop();this.motor?.sub.stop();}catch{}void this.ctx?.close().catch(()=>{});this.ctx=this.master=this.noise=this.motor=null;this.last.clear();this.voices=0;}
 play(s:DrivetrainSound){
  const ctx=this.ctx;if(!ctx||ctx.state!=='running')return;
  if(s.type==='motor'){this.drive(s.speed,s.load);return;}
  const now=ctx.currentTime;if(now-(this.last.get(s.type)??-Infinity)<(gaps[s.type]??.08)||this.voices>=LIMIT)return;
  this.last.set(s.type,now);this.cue(s.type,now);
 }
 private build(){
  const Ctor=(globalThis as any).AudioContext??(globalThis as any).webkitAudioContext;if(!Ctor)return false;
  try{
   const ctx:AudioContext=new Ctor(),master=ctx.createGain(),limit=ctx.createDynamicsCompressor(),noise=ctx.createBuffer(1,ctx.sampleRate/2,ctx.sampleRate),data=noise.getChannelData(0);
   for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
   master.gain.value=this.muted?0:.8;master.connect(limit).connect(ctx.destination);
   const gain=ctx.createGain(),filter=ctx.createBiquadFilter(),osc=ctx.createOscillator(),sub=ctx.createOscillator();
   gain.gain.value=0;filter.type='bandpass';filter.Q.value=4;filter.frequency.value=600;osc.type='sawtooth';sub.type='triangle';osc.frequency.value=180;sub.frequency.value=60;
   osc.connect(filter);sub.connect(filter);filter.connect(gain).connect(master);osc.start();sub.start();
   this.ctx=ctx;this.master=master;this.noise=noise;this.motor={gain,filter,osc,sub};return true;
  }catch{return false;}
 }
 private drive(speed:number,load:number){
  const ctx=this.ctx,m=this.motor;if(!ctx||!m||!Number.isFinite(speed))return;
  const t=ctx.currentTime,n=Math.min(1.5,speed);
  m.gain.gain.setTargetAtTime(n<.02?0:.025+n*.05+Math.min(.04,load*.02),t,GLIDE);m.filter.frequency.setTargetAtTime(400+n*900,t,GLIDE);m.osc.frequency.setTargetAtTime(120+n*260,t,GLIDE);m.sub.frequency.setTargetAtTime(40+n*40,t,GLIDE);
 }
 private env(at:number,peak:number,length:number){const g=this.ctx!.createGain();g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(peak,at+.004);g.gain.exponentialRampToValueAtTime(.0001,at+length);g.connect(this.master!);return g;}
 private tone(type:OscillatorType,from:number,to:number,at:number,length:number,peak:number){const o=this.ctx!.createOscillator();o.type=type;o.frequency.setValueAtTime(from,at);o.frequency.exponentialRampToValueAtTime(to,at+length);o.connect(this.env(at,peak,length));this.run(o,at,length);}
 private hiss(at:number,length:number,hz:number,peak:number){const ctx=this.ctx!,s=ctx.createBufferSource(),f=ctx.createBiquadFilter();s.buffer=this.noise;s.loop=true;f.type='bandpass';f.frequency.value=hz;s.connect(f).connect(this.env(at,peak,length));this.run(s,at,length);}
 private run(source:AudioScheduledSourceNode,at:number,length:number){this.voices++;source.onended=()=>{this.voices--;source.disconnect();};source.start(at);source.stop(at+length+.02);}
 /** A struck metal plate: a few inharmonic partials decaying at different rates. */
 private ring(at:number,base:number,peak:number,length=.5){for(const [k,g] of [[1,1],[2.76,.5],[5.4,.25]] as const)this.tone('sine',base*k,base*k*.995,at,length/k**.3,peak*g);}
 private cue(type:Cue,at:number){
  switch(type){
   case 'clink':this.ring(at,1320,.08,.35);this.hiss(at,.02,6000,.05);break;
   case 'pick':this.tone('triangle',520,700,at,.07,.07);break;
   case 'miss':this.tone('sine',330,250,at,.12,.06);break;
   case 'break':this.hiss(at,.08,3200,.3);this.ring(at,900,.12,.4);this.tone('sawtooth',160,60,at+.02,.35,.12);for(let i=1;i<5;i++)this.ring(at+.12*i+Math.random()*.05,1500+Math.random()*900,.05/i,.2);break;
   case 'held':this.tone('sine',90,60,at,.4,.2);this.ring(at+.05,600,.05,.4);break;
   case 'met':[523.25,659.25,783.99,1046.5].forEach((f,i)=>this.ring(at+i*.11,f,.09,.9));break;
   case 'tooth':this.tone('square',1800,1700,at,.02,.03);break;
   case 'free':this.hiss(at,.25,2600,.1);this.ring(at,980,.05,.3);break;
   case 'match':this.ring(at,740,.07,.6);this.ring(at+.09,1110,.06,.6);break;
   case 'draw':this.tone('sine',440,880,at,.15,.05);break;
   case 'undo':this.tone('triangle',700,420,at,.16,.08);break;
   case 'mode':this.tone('triangle',600,900,at,.1,.06);break;
   case 'pluck':this.tone('triangle',220,180,at,.12,.1);break;
   case 'snap':this.ring(at,1100,.06,.25);break;
   case 'shock':this.tone('sine',80,28,at,.6,.4);this.hiss(at,.3,500,.15);break;
   case 'skin':this.tone('triangle',660,990,at,.2,.08);break;
   case 'slice':this.hiss(at,.22,2600,.1);break;
   case 'tear':this.hiss(at,.35,900,.14);this.ring(at,500,.05,.3);break;
  }
 }
}
