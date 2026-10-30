import type {AtpSound} from './contracts';

type Cue=Exclude<AtpSound['type'],'motor'>;
const VOICE_LIMIT=20,MOTOR_GLIDE=.12,MOTOR_MAX=3;
// Seconds between cues of one kind: bursts arrive in a single frame and would otherwise stack into clipping.
const gaps:Record<Cue,number>={atp:.06,pop:.04,pluck:.05,snap:.05,shock:.2,skin:.15,slice:.2,tear:.5};
const pentatonic=[0,2,4,7,9];
const RUN_RESET=1.6,RUN_NOTES=15;
const scaleHz=(step:number)=>880*2**((pentatonic[step%5]+12*Math.floor(step/5))/12);

export class AtpAudio {
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private noise:AudioBuffer|null=null;private motor:{gain:GainNode;filter:BiquadFilterNode;a:OscillatorNode;b:OscillatorNode}|null=null;
 private sources:AudioScheduledSourceNode[]=[];private last=new Map<Cue,number>();private voices=0;private muted=false;private run=0;private runAt=-Infinity;
 async start(){
  if(!this.ctx&&!this.build())return;
  if(this.ctx?.state==='suspended')await this.ctx.resume().catch(()=>{});
 }
 setMuted(m:boolean){this.muted=m;if(this.ctx&&this.master)this.master.gain.setTargetAtTime(m?0:.8,this.ctx.currentTime,.02);}
 stop(){
  for(const source of this.sources){try{source.stop();}catch{}}
  void this.ctx?.close().catch(()=>{});
  this.ctx=this.master=this.noise=this.motor=null;this.sources=[];this.last.clear();this.voices=0;this.run=0;this.runAt=-Infinity;
 }
 play(s:AtpSound){
  const ctx=this.ctx;if(!ctx||ctx.state!=='running')return;
  if(s.type==='motor'){this.drive(s.speed);return;}
  const now=ctx.currentTime;
  if(now-(this.last.get(s.type)??-Infinity)<gaps[s.type]||this.voices>=VOICE_LIMIT)return;
  this.last.set(s.type,now);this[s.type](now);
 }
 private build(){
  const Ctor=(globalThis as any).AudioContext??(globalThis as any).webkitAudioContext;if(!Ctor)return false;
  try{
   const ctx:AudioContext=new Ctor(),master=ctx.createGain(),limit=ctx.createDynamicsCompressor();
   master.gain.value=this.muted?0:.8;limit.threshold.value=-16;limit.ratio.value=8;limit.attack.value=.003;limit.release.value=.18;
   master.connect(limit).connect(ctx.destination);
   const noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate),data=noise.getChannelData(0);
   for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
   this.ctx=ctx;this.master=master;this.noise=noise;
   const gain=ctx.createGain(),filter=ctx.createBiquadFilter(),a=ctx.createOscillator(),b=ctx.createOscillator(),rumble=ctx.createBufferSource(),rumbleGain=ctx.createGain();
   gain.gain.value=0;filter.type='lowpass';filter.frequency.value=160;filter.Q.value=1.5;
   a.type='sawtooth';b.type='triangle';a.frequency.value=38;b.frequency.value=38;b.detune.value=11;
   rumble.buffer=noise;rumble.loop=true;rumbleGain.gain.value=.18;
   a.connect(filter);b.connect(filter);rumble.connect(rumbleGain).connect(filter);filter.connect(gain).connect(master);
   a.start();b.start();rumble.start();this.sources=[a,b,rumble];this.motor={gain,filter,a,b};
   return true;
  }catch{this.ctx=this.master=this.noise=this.motor=null;return false;}
 }
 private drive(speed:number){
  const ctx=this.ctx,m=this.motor;if(!ctx||!m||!Number.isFinite(speed))return;
  const t=ctx.currentTime,n=Math.min(1,Math.abs(speed)/MOTOR_MAX),pitch=38+n*92;
  m.gain.gain.setTargetAtTime(n<.003?0:.05+n*.2,t,MOTOR_GLIDE);m.filter.frequency.setTargetAtTime(160+n*1100,t,MOTOR_GLIDE);
  m.a.frequency.setTargetAtTime(pitch,t,MOTOR_GLIDE);m.b.frequency.setTargetAtTime(pitch*1.003,t,MOTOR_GLIDE);
 }
 private envelope(at:number,peak:number,attack:number,decay:number){
  const gain=this.ctx!.createGain();
  gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(peak,at+attack);gain.gain.exponentialRampToValueAtTime(.0001,at+attack+decay);
  gain.connect(this.master!);return gain;
 }
 private voice(source:AudioScheduledSourceNode,at:number,length:number){
  this.voices++;source.onended=()=>{this.voices--;source.disconnect();};source.start(at);source.stop(at+length);
 }
 private tone(type:OscillatorType,from:number,to:number,at:number,length:number,target:AudioNode){
  const osc=this.ctx!.createOscillator();osc.type=type;osc.frequency.setValueAtTime(from,at);
  if(to!==from)osc.frequency.exponentialRampToValueAtTime(to,at+length);
  osc.connect(target);this.voice(osc,at,length+.02);
 }
 private burst(at:number,length:number,kind:BiquadFilterType,from:number,to:number,target:AudioNode){
  const ctx=this.ctx!,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter();
  source.buffer=this.noise;source.loop=true;filter.type=kind;filter.frequency.setValueAtTime(from,at);filter.frequency.exponentialRampToValueAtTime(to,at+length);
  source.connect(filter).connect(target);this.voice(source,at,length+.02);
 }
 private atp(at:number){
  if(at-this.runAt>RUN_RESET)this.run=0;
  this.runAt=at;const hz=scaleHz(this.run);this.run=(this.run+1)%RUN_NOTES;
  this.tone('sine',hz,hz,at,.5,this.envelope(at,.16,.004,.5));this.tone('sine',hz*2.76,hz*2.76,at,.16,this.envelope(at,.05,.002,.16));
 }
 private pop(at:number){this.tone('sine',280,1100,at,.07,this.envelope(at,.2,.004,.08));}
 private string(at:number,hz:number,peak:number,length:number){
  const ctx=this.ctx!,filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.setValueAtTime(hz*9,at);filter.frequency.exponentialRampToValueAtTime(hz*1.6,at+length);
  filter.connect(this.envelope(at,peak,.003,length));this.tone('sawtooth',hz*1.02,hz,at,length,filter);
 }
 private pluck(at:number){this.string(at,110,.2,.32);}
 private snap(at:number){this.string(at,82.4,.26,.6);this.burst(at,.03,'highpass',2400,1800,this.envelope(at,.06,.001,.03));}
 private shock(at:number){this.tone('sine',80,26,at,.7,this.envelope(at,.55,.005,.7));this.burst(at,.35,'lowpass',1800,120,this.envelope(at,.22,.004,.35));}
 private skin(at:number){for(const [i,hz] of [660,990].entries())this.tone('triangle',hz,hz,at+i*.07,.2,this.envelope(at+i*.07,.1,.004,.2));}
 private slice(at:number){this.burst(at,.22,'bandpass',900,5200,this.envelope(at,.1,.02,.22));}
 private tear(at:number){this.burst(at,.5,'bandpass',260,1500,this.envelope(at,.18,.05,.5));this.tone('sawtooth',52,88,at,.5,this.envelope(at,.1,.05,.5));}
}
