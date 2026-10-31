import {TrackingCamera} from './camera';
import type {Packet} from '../types';
import type {ControlClient} from '../control';
export class PhoneTracking {
 private camera:TrackingCamera;private atp=false;private allowed=false;private scope='';private session='';private pauseTimer?:ReturnType<typeof setTimeout>;private wake:{release():Promise<void>}|null=null;private metrics:HTMLOutputElement;private toggle:HTMLButtonElement;private panel:HTMLElement;
 constructor(private client:()=>ControlClient){
 this.panel=document.createElement('section');this.panel.id='tracking-phone';this.panel.hidden=true;
 this.panel.innerHTML='<h2>Second camera</h2><p>Park the phone beside the laptop. Aim the selected camera at the same hand area.</p><label>Camera <select id="tracking-phone-facing"><option value="user">Front camera</option><option value="environment">Rear camera</option></select></label><button id="tracking-phone-start">Start front camera</button><div class="tracking-preview"><video playsinline muted></video><canvas></canvas></div><output></output><p>Hand tracking runs on this phone. Only landmarks are streamed. Capture board pair on the laptop also sends one photo for calibration.</p>';
 document.querySelector('#rate')!.after(this.panel);this.metrics=this.panel.querySelector('output')!;this.toggle=this.panel.querySelector('button')!;
 const preview=this.panel.querySelector<HTMLElement>('.tracking-preview')!;
 const previewLayout=()=>{const id=this.camera?.identity;preview.style.aspectRatio=id?`${id.width}/${id.height}`:'4/3';preview.classList.toggle('selfie',this.camera?.facing==='user');};
 this.camera=new TrackingCamera(this.panel.querySelector('video')!,this.panel.querySelector('canvas')!,true,(hands,meta)=>{
 const clock=this.client().clock;if(!this.allowed||document.hidden||!clock.ready||!this.camera.identity)return;
 // ATP treats every feed as a selfie mirror, so a rear camera is flipped to match.
 const sent=this.atp&&this.camera.facing==='environment'?hands.map(hand=>hand.map(p=>({...p,x:1-p.x}))):hands;
 this.client().send({type:'tracking-frame',...this.camera.identity,frameId:meta.frameId,hands:sent,frameAt:this.client().serverTime(meta.sourceTimeMs),dispatchAt:this.client().serverTime(meta.dispatchAt),videoTimeMs:meta.videoTimeMs,timestampSource:meta.timestampSource,clockRttMs:clock.rttMs,inferenceMs:meta.inferenceMs,processedHz:Number(this.camera.metrics.processedHz??0)});
 },message=>{this.metrics.textContent=message;this.toggle.textContent=this.camera?.stream?'Stop camera':`Start ${this.camera?.facing==='environment'?'rear':'front'} camera`;previewLayout();});
 this.panel.querySelector<HTMLSelectElement>('#tracking-phone-facing')!.onchange=e=>{this.stop();this.camera.facing=(e.target as HTMLSelectElement).value==='environment'?'environment':'user';this.metrics.textContent='Camera changed. Start it again; depth needs a fresh calibration.';this.toggle.textContent=`Start ${this.camera.facing==='environment'?'rear':'front'} camera`;};
 this.toggle.onclick=async()=>{if(this.camera.stream)this.stop();else if(this.allowed){await this.camera.start();try{if(this.camera.stream)this.wake=await navigator.wakeLock?.request('screen')??null;}catch{}}};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();});window.addEventListener('pagehide',()=>this.stop());
 }
 update(p:Packet|null){const allowed=(p?.workspace==='tracking'||p?.workspace==='atp'||p?.workspace==='pottery'&&p.stage==='shape')&&p.enabled===true&&p.captureEnabled===true;
 const pottery=p?.workspace==='pottery',atp=p?.workspace==='atp',hands=pottery||atp;this.atp=atp;this.camera.interactive=hands;
 const scope=allowed?[p?.epoch,p?.context,p?.documentId].join(':'):'';const session=String(p?.trackingSession??'');if(!allowed||session!==this.session)this.stop();clearTimeout(this.pauseTimer);this.scope=scope;this.session=session;this.allowed=allowed;this.panel.hidden=!allowed;
 const anchor=document.querySelector(hands?'#message':'#rate')!;if(anchor.nextElementSibling!==this.panel)anchor.after(this.panel);
 this.panel.classList.toggle('pottery-camera',hands);this.panel.querySelector('h2')!.textContent=atp?'Step into the mirror':pottery?'Shape with your hands':'Second camera';
 this.panel.querySelector('p')!.textContent=atp?'Stand the phone up facing you. Keep your hands inside the picture.':pottery?'Stand the phone upright. Keep both hands inside the picture.':'Park the phone beside the laptop. Aim the selected camera at the same hand area.';
 const note=this.panel.querySelector('p:last-child')!;note.textContent=atp?'Hand tracking runs on this phone. Only hand positions reach the laptop, never video.':pottery?'Open both hands to choose a height. Close both fists to shape; open either hand to stop.':'Hand tracking runs on this phone. Only landmarks are streamed. Capture board pair on the laptop also sends one photo for calibration.';if(allowed)this.camera.resume();}
 receive(p:Packet){if(p.type==='tracking-capture'&&this.allowed&&this.camera.stream){try{this.client().send({type:'tracking-photo',requestId:p.requestId,...this.camera.photo()});}catch(e){this.metrics.textContent=String(e);}}}
 pause(){this.allowed=false;this.camera.pause();clearTimeout(this.pauseTimer);this.pauseTimer=setTimeout(()=>this.stop(),5*60000);}
 stop(){void this.wake?.release();this.wake=null;clearTimeout(this.pauseTimer);const running=this.camera.stream||this.camera.starting;this.camera.stop();if(running)this.client().send({type:'tracking-stop'});}
}
