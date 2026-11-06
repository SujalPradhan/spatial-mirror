import type {MirrorAudio} from '../mirror/contracts';
import type {FollowSound} from './contracts';

const tones:Record<FollowSound['type'],[number,number,number][]>={step:[[660,.14,.07],[880,.2,.06]],done:[[523,.16,.07],[659,.16,.07],[784,.4,.07]],tick:[[440,.08,.05]],go:[[880,.18,.06]],miss:[[200,.12,.04]]};
/** Short cues: a rising pair when a step is matched, a chord when the lesson is done, ticks for the count. */
export class FollowAudio implements MirrorAudio<FollowSound> {
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private muted=false;
 async start(){
  if(!this.ctx){const Ctor=(globalThis as any).AudioContext??(globalThis as any).webkitAudioContext;if(!Ctor)return;try{this.ctx=new Ctor();this.master=this.ctx!.createGain();this.master.gain.value=this.muted?0:.7;this.master.connect(this.ctx!.destination);}catch{return;}}
  if(this.ctx?.state==='suspended')await this.ctx.resume().catch(()=>{});
 }
 setMuted(m:boolean){this.muted=m;if(this.ctx&&this.master)this.master.gain.setTargetAtTime(m?0:.7,this.ctx.currentTime,.02);}
 stop(){void this.ctx?.close().catch(()=>{});this.ctx=this.master=null;}
 play(s:FollowSound){
  const ctx=this.ctx;if(!ctx||!this.master||ctx.state!=='running')return;const now=ctx.currentTime;
  tones[s.type].forEach(([hz,len,peak],i)=>{const o=ctx.createOscillator(),g=ctx.createGain(),at=now+i*.09;o.type='sine';o.frequency.value=hz;g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(peak,at+.006);g.gain.exponentialRampToValueAtTime(.0001,at+len);o.connect(g).connect(this.master!);o.start(at);o.stop(at+len+.02);});
 }
}
