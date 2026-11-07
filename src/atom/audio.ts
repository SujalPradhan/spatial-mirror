import type {AtomSound} from './contracts';

const GAP:Record<string,number>={take:.15,return:.15,next:.2,shock:.2,tear:.5,pluck:.05,snap:.05,skin:.2,slice:.2};
const NOTES:Record<string,[number,number]>={take:[880,1320],return:[1320,880],next:[523,784],shock:[196,196],tear:[330,165],pluck:[660,660],snap:[990,990],skin:[740,740],slice:[600,600]};

/** Soft glass pings: a rising one when an electron leaves, a falling one when it returns. */
export class AtomAudio {
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private muted=false;private last=new Map<string,number>();
 async start(){
  if(!this.ctx){
   const Ctor=(globalThis as any).AudioContext??(globalThis as any).webkitAudioContext;if(!Ctor)return;
   try{this.ctx=new Ctor();this.master=this.ctx!.createGain();this.master.gain.value=this.muted?0:.5;this.master.connect(this.ctx!.destination);}catch{this.ctx=this.master=null;return;}
  }
  if(this.ctx?.state==='suspended')await this.ctx.resume().catch(()=>{});
 }
 setMuted(m:boolean){this.muted=m;if(this.ctx&&this.master)this.master.gain.setTargetAtTime(m?0:.5,this.ctx.currentTime,.02);}
 stop(){void this.ctx?.close().catch(()=>{});this.ctx=this.master=null;this.last.clear();}
 play(s:AtomSound){
  const ctx=this.ctx,master=this.master,notes=NOTES[s.type];if(!ctx||!master||!notes||ctx.state!=='running')return;
  const now=ctx.currentTime;if(now-(this.last.get(s.type)??-Infinity)<(GAP[s.type]??.1))return;
  this.last.set(s.type,now);
  const osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type='sine';osc.frequency.setValueAtTime(notes[0],now);osc.frequency.exponentialRampToValueAtTime(notes[1],now+.18);
  gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.18,now+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+.38);
  osc.connect(gain).connect(master);osc.start(now);osc.stop(now+.4);
 }
}
