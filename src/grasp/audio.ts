import type {MirrorAudio} from '../mirror/contracts';
import type {GraspSound} from './contracts';

type Cue=Exclude<GraspSound['type'],'motor'>;
const gaps:Partial<Record<Cue,number>>={touch:.06,step:.2};
/** A quiet servo whine that follows motor speed and load, and short cues: a tick on contact, a chime when held. */
export class GraspAudio implements MirrorAudio<GraspSound> {
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private whine:{gain:GainNode;osc:OscillatorNode;filter:BiquadFilterNode}|null=null;private muted=false;private last=new Map<Cue,number>();
 async start(){if(!this.ctx&&!this.build())return;if(this.ctx?.state==='suspended')await this.ctx.resume().catch(()=>{});}
 setMuted(m:boolean){this.muted=m;if(this.ctx&&this.master)this.master.gain.setTargetAtTime(m?0:.7,this.ctx.currentTime,.02);}
 stop(){try{this.whine?.osc.stop();}catch{/* already stopped */}void this.ctx?.close().catch(()=>{});this.ctx=this.master=this.whine=null;}
 play(s:GraspSound){
  const ctx=this.ctx;if(!ctx||ctx.state!=='running')return;const now=ctx.currentTime;
  if(s.type==='motor'){const w=this.whine;if(!w)return;w.gain.gain.setTargetAtTime(s.speed>.03?.012+s.speed*.03:0,now,.08);w.osc.frequency.setTargetAtTime(240+s.speed*520+s.load*90,now,.08);return;}
  if(now-(this.last.get(s.type)??-Infinity)<(gaps[s.type]??.12))return;this.last.set(s.type,now);
  const tones:Record<Cue,[number,number,number][]>={touch:[[1400,.035,.05]],held:[[660,.18,.08],[990,.3,.07]],drop:[[140,.25,.12]],motors:[[520,.06,.06],[780,.06,.05]],object:[[330,.12,.05]],calibrated:[[523,.15,.06],[784,.3,.06]],step:[[600,.12,.05]],found:[[784,.12,.07],[1175,.35,.07]]};
  tones[s.type].forEach(([hz,len,peak],i)=>this.tone(hz,now+i*.09,len,peak,s.type==='drop'?'triangle':'sine'));
 }
 private build(){
  const Ctor=(globalThis as any).AudioContext??(globalThis as any).webkitAudioContext;if(!Ctor)return false;
  try{const ctx:AudioContext=new Ctor(),master=ctx.createGain();master.gain.value=this.muted?0:.7;master.connect(ctx.destination);
   const gain=ctx.createGain(),osc=ctx.createOscillator(),filter=ctx.createBiquadFilter();gain.gain.value=0;osc.type='sawtooth';filter.type='lowpass';filter.frequency.value=1200;osc.connect(filter).connect(gain).connect(master);osc.start();
   this.ctx=ctx;this.master=master;this.whine={gain,osc,filter};return true;}catch{return false;}
 }
 private tone(hz:number,at:number,len:number,peak:number,type:OscillatorType){const ctx=this.ctx!,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.value=hz;g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(peak,at+.006);g.gain.exponentialRampToValueAtTime(.0001,at+len);o.connect(g).connect(this.master!);o.start(at);o.stop(at+len+.05);}
}
