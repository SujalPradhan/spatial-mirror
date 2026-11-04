import type {MirrorAudio} from '../mirror/contracts';
import type {OrganSound} from './contracts';

const gaps:Record<OrganSound['type'],number>={pick:.05,drop:.05,return:.1,spray:.3,undo:.2,skin:.2,fan:.3,shock:.4,slice:.2,bottle:.3,miss:.25,tick:.03,split:.2};
/** Glass and air: vials clink, drops fall in pitch as the flask fills, a spray is a breath of noise. */
export class OrganAudio implements MirrorAudio<OrganSound> {
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private noise:AudioBuffer|null=null;private last=new Map<string,number>();private muted=false;
 async start(){if(!this.ctx&&!this.build())return;if(this.ctx?.state==='suspended')await this.ctx.resume().catch(()=>{});}
 setMuted(m:boolean){this.muted=m;if(this.ctx&&this.master)this.master.gain.setTargetAtTime(m?0:.7,this.ctx.currentTime,.02);}
 stop(){void this.ctx?.close().catch(()=>{});this.ctx=this.master=this.noise=null;this.last.clear();}
 play(s:OrganSound){
  const ctx=this.ctx;if(!ctx||ctx.state!=='running')return;
  const now=ctx.currentTime;if(now-(this.last.get(s.type)??-Infinity)<gaps[s.type])return;this.last.set(s.type,now);
  switch(s.type){
   case 'pick':this.tone('sine',2300,2280,now,.25,.06);this.tone('sine',3460,3440,now,.18,.03);break;
   case 'tick':this.tone('sine',1800,1700,now,.04,.03);break;
   case 'drop':for(let i=0;i<3;i++)this.tone('sine',900-i*140,420-i*60,now+i*.07,.09,.08);break;
   case 'return':this.tone('sine',1600,1590,now,.2,.04);break;
   case 'spray':this.air(now,.55,'highpass',3600,5600,.12);break;
   case 'undo':this.tone('triangle',520,300,now,.18,.08);break;
   case 'skin':this.tone('sine',660,990,now,.2,.07);break;
   case 'fan':this.air(now,.4,'bandpass',600,2600,.08);break;
   case 'shock':this.tone('sine',110,50,now,.5,.2);this.tone('sine',1320,1310,now+.05,.8,.04);this.tone('sine',1980,1975,now+.1,.7,.03);break;
   case 'slice':this.air(now,.18,'highpass',5000,2000,.07);break;
   case 'bottle':this.tone('sine',1400,1380,now,.3,.06);this.tone('sine',700,690,now+.06,.3,.06);break;
   case 'split':this.air(now,.25,'bandpass',800,3000,.06);break;
   case 'miss':this.tone('triangle',220,180,now,.14,.07);break;
  }
 }
 private build(){
  const Ctor=(globalThis as any).AudioContext??(globalThis as any).webkitAudioContext;if(!Ctor)return false;
  try{const ctx:AudioContext=new Ctor(),master=ctx.createGain(),noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate),data=noise.getChannelData(0);
   master.gain.value=this.muted?0:.7;master.connect(ctx.destination);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
   this.ctx=ctx;this.master=master;this.noise=noise;return true;}catch{this.ctx=this.master=this.noise=null;return false;}
 }
 private envelope(at:number,peak:number,length:number){const g=this.ctx!.createGain();g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(peak,at+Math.min(.01,length/3));g.gain.exponentialRampToValueAtTime(.0001,at+length);g.connect(this.master!);return g;}
 private tone(type:OscillatorType,from:number,to:number,at:number,length:number,peak:number){const o=this.ctx!.createOscillator();o.type=type;o.frequency.setValueAtTime(from,at);o.frequency.exponentialRampToValueAtTime(to,at+length);o.connect(this.envelope(at,peak,length));o.onended=()=>o.disconnect();o.start(at);o.stop(at+length+.02);}
 private air(at:number,length:number,kind:BiquadFilterType,from:number,to:number,peak:number){const ctx=this.ctx!,src=ctx.createBufferSource(),f=ctx.createBiquadFilter();src.buffer=this.noise;src.loop=true;f.type=kind;f.frequency.setValueAtTime(from,at);f.frequency.exponentialRampToValueAtTime(to,at+length);src.connect(f).connect(this.envelope(at,peak,length));src.onended=()=>src.disconnect();src.start(at);src.stop(at+length+.02);}
}
