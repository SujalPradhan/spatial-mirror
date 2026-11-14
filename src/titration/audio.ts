import type {TitrationSound} from './contracts';

const GAP:Record<string,number>={drip:.12,step:.15,done:.4,alert:.4};
const NOTES:Record<string,[number,number]>={drip:[1400,700],step:[660,880],done:[523,784],alert:[330,247]};

/** Small glass sounds: a drip as each drop leaves, a rising note when a step is done, a low one for a warning. */
export class TitrationAudio {
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
 play(s:TitrationSound){
  const ctx=this.ctx,master=this.master,notes=NOTES[s.type];if(!ctx||!master||!notes||ctx.state!=='running')return;
  const now=ctx.currentTime;if(now-(this.last.get(s.type)??-Infinity)<(GAP[s.type]??.1))return;
  this.last.set(s.type,now);
  const osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type='sine';osc.frequency.setValueAtTime(notes[0],now);osc.frequency.exponentialRampToValueAtTime(notes[1],now+.12);
  gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(s.type==='drip'?.1:.16,now+.01);gain.gain.exponentialRampToValueAtTime(.0001,now+(s.type==='drip'?.14:.35));
  osc.connect(gain).connect(master);osc.start(now);osc.stop(now+.4);
 }
}
