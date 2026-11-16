const VOICE_LIMIT=16;
const SCALE=[0,2,4,7,9];
const hz=(step:number)=>440*2**((SCALE[step%5]+12*Math.floor(step/5))/12);

/** Little arcade sounds for the big screen. Starts silent until a tap lets the browser play audio. */
export class PartyAudio {
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private step=0;private lastAt=0;private muted=false;private last=new Map<string,number>();private voices=0;
 async start(){
  if(!this.ctx){
   const Ctor=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Ctor)return;
   this.ctx=new Ctor();this.master=this.ctx.createGain();this.master.gain.value=this.muted?0:.5;this.master.connect(this.ctx.destination);
  }
  if(this.ctx.state==='suspended')await this.ctx.resume().catch(()=>{});
 }
 setMuted(m:boolean){this.muted=m;if(this.master&&this.ctx)this.master.gain.setTargetAtTime(m?0:.5,this.ctx.currentTime,.02);}
 get running(){return this.ctx?.state==='running';}
 private tone(freq:number,at:number,length:number,type:OscillatorType='sine',gain=.3,slideTo?:number){
  const ctx=this.ctx!,o=ctx.createOscillator(),g=ctx.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,at);if(slideTo)o.frequency.exponentialRampToValueAtTime(slideTo,at+length);
  g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+.012);g.gain.exponentialRampToValueAtTime(.001,at+length);
  o.connect(g).connect(this.master!);this.voices++;o.onended=()=>{this.voices--;};o.start(at);o.stop(at+length+.02);
 }
 private ready(){return this.ctx&&this.master&&this.ctx.state==='running';}
 // A crowd throws in bursts, so each cue has a minimum gap and a cap on live voices.
 private gate(cue:string,gap:number){
  const now=this.ctx!.currentTime;if(now-(this.last.get(cue)??-Infinity)<gap||this.voices>=VOICE_LIMIT)return false;this.last.set(cue,now);return true;
 }
 /** A proton thrown: each one a note higher up a happy scale, resetting after a quiet moment. */
 throwNote(){
  if(!this.ready()||!this.gate('throw',.06))return;const now=this.ctx!.currentTime;
  if(now-this.lastAt>1.2)this.step=0;this.lastAt=now;
  this.tone(hz(this.step++%10)*2,now,.16,'triangle',.22);
 }
 /** A proton lands in the ring. */
 plink(){if(this.ready()&&this.gate('plink',.05)){const now=this.ctx!.currentTime;this.tone(200,now,.1,'sine',.3,90);}}
 /** ATP made. */
 ding(){if(this.ready()&&this.gate('ding',.08)){const now=this.ctx!.currentTime;this.tone(1046,now,.4,'sine',.3);this.tone(1568,now+.07,.5,'sine',.22);}}
 burn(){if(this.ready()&&this.gate('burn',.08)){const now=this.ctx!.currentTime;this.tone(520,now,.28,'sawtooth',.14,120);}}
 tick(high=false){if(this.ready())this.tone(high?1320:660,this.ctx!.currentTime,.14,'square',.12);}
 fanfare(){
  if(!this.ready())return;const now=this.ctx!.currentTime;
  [0,4,7,12,16,19,24].forEach((n,i)=>this.tone(262*2**(n/12),now+i*.09,.5,'triangle',.28));
  [0,4,7,12].forEach(n=>this.tone(523*2**(n/12),now+.7,1.2,'sine',.2));
 }
 wah(){if(!this.ready())return;const now=this.ctx!.currentTime;[392,349,330,262].forEach((f,i)=>this.tone(f,now+i*.18,.3,'triangle',.22));}
 stop(){void this.ctx?.close().catch(()=>{});this.ctx=this.master=null;}
}
