import QRCode from 'qrcode';
import {phonePairingUrl} from './pairing-link';
import './hosted-preview.css';
import {webcamOnly,pairing,pairingStatus,createPairing,endPairing} from './session';
import {currentDocument} from './documents';

document.documentElement.classList.add('hosted-studio');if(webcamOnly)document.documentElement.classList.add('webcam-preview');
const bar=document.createElement('aside');
bar.className='hosted-preview';
bar.innerHTML=`<span>${webcamOnly?'Webcam preview · Phone control stays in the local build.':'Hand tracking stays on this laptop.'}</span>${webcamOnly?'':'<button id="pair-phone">Connect phone</button>'}<details><summary>Tracking timings</summary><div><output id="hosted-timings">Enable the webcam to measure this laptop.</output><p>Inference and worker timings exclude camera capture and display latency.</p><button id="save-timings" disabled>Save timings</button></div></details>`;
const nav=document.querySelector('.workspace-nav');
if(nav)nav.after(bar);else document.querySelector('#app')!.prepend(bar);
if(webcamOnly)for(const button of document.querySelectorAll<HTMLElement>('[data-mode="webcam"]'))button.textContent='Webcam';
let latest:Record<string,unknown>|null=null;
window.addEventListener('studio-hand-metrics',event=>{
 const metrics=(event as CustomEvent).detail;
 const out=bar.querySelector('output')!;
 if(metrics?.status!=='running'){out.textContent=metrics?.status==='error'?'Tracking failed. See the camera message.':'Camera stopped.';return;}
 latest=metrics;
 const number=(key:string)=>typeof latest?.[key]==='number'?(latest[key] as number).toFixed(1):'—';
 out.textContent=`Model ready: ${number('modelStartupMs')} ms · ${number('processedHz')} frames/s · Inference p50/p95: ${number('inferenceP50Ms')} / ${number('inferenceP95Ms')} ms · Worker round trip p95: ${number('workerP95Ms')} ms`;
 (bar.querySelector('#save-timings') as HTMLButtonElement).disabled=false;
});
bar.querySelector<HTMLElement>('#save-timings')!.onclick=()=>{
 if(!latest)return;
 const data={recordedAt:new Date().toISOString(),route:location.pathname,metrics:latest,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},notes:'Browser-local CPU hand tracking. Worker round trip includes dispatch, inference and result delivery. These are not physical motion-to-display measurements. No camera frames included.'};
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='webcam-timings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

if(!webcamOnly){
 const dialog=document.createElement('dialog');dialog.id='hosted-pair-dialog';
 dialog.innerHTML='<button id="pair-close" aria-label="Close">×</button><h2>Scan to connect</h2><p>Scan this QR code with your phone’s camera. It opens the controller and connects automatically.</p><canvas id="pairing-qr" width="260" height="260" aria-label="Scan this QR code to connect your phone" hidden></canvas><details id="pairing-fallback"><summary>Can’t scan?</summary><p>Open <a id="controller-address" href="/phone" target="_blank" rel="noopener"></a> and enter:</p><output id="pairing-code">—</output></details><p id="pairing-message" role="status"></p><div><button id="new-pair-code">Create code</button><button id="end-pairing" hidden>Disconnect phone</button></div>';
 document.body.append(dialog);dialog.querySelector('#controller-address')!.textContent=location.host+'/phone';
 let connected=pairingStatus.connected,busy=false,problem='',qrKey='';
 const qr=dialog.querySelector<HTMLCanvasElement>('#pairing-qr')!;
 const button=bar.querySelector<HTMLButtonElement>('#pair-phone')!,fresh=dialog.querySelector<HTMLButtonElement>('#new-pair-code')!,end=dialog.querySelector<HTMLButtonElement>('#end-pairing')!,close=dialog.querySelector<HTMLButtonElement>('#pair-close')!;
 const render=()=>{
  button.textContent=connected?'Phone connected':'Connect phone';
  const value=pairing?.code;dialog.querySelector('output')!.textContent=value?value.slice(0,4)+'-'+value.slice(4):'—';
  const ready=!!value&&!pairing?.paired&&!connected&&!busy&&Date.now()<pairing!.joinExpiresAt;
  qr.hidden=!ready;
  if(ready&&qrKey!==value){qrKey=value!;const link=phonePairingUrl(location.origin,value!);void QRCode.toCanvas(qr,link,{width:260,margin:4,errorCorrectionLevel:'M',color:{dark:'#142219',light:'#ffffff'}}).catch(()=>{qrKey='';qr.hidden=true;problem='Could not draw the QR code. Use the code under “Can’t scan?” or try a new connection.';dialog.querySelector('#pairing-message')!.textContent=problem;});}

  dialog.querySelector('#pairing-message')!.textContent=problem||(busy?'Preparing connection…':connected?'Connected. The phone follows your active workspace.':pairing?.paired?'This code has been used. Reopen the controller on the paired phone, or create a new code.':pairing&&Date.now()<pairing.joinExpiresAt?'Scan within 10 minutes.':pairing?'QR code expired. Create a new connection.':'Create a connection to pair one phone.');
  fresh.textContent=pairing?'New QR code':'Create QR code';fresh.disabled=end.disabled=close.disabled=busy;end.hidden=!pairing;
 };
 const reload=async()=>{await currentDocument?.flush();sessionStorage.setItem('show-pairing','1');location.reload();};
 const create=async()=>{busy=true;problem='';render();try{if(pairing)await endPairing();await createPairing();await reload();}catch(e){problem=e instanceof Error?e.message:String(e);busy=false;render();}};
 button.onclick=()=>{render();dialog.showModal();if(!pairing)void create();};
 fresh.onclick=()=>void create();end.onclick=async()=>{busy=true;problem='';render();try{await endPairing();await reload();}catch(e){problem=String(e);busy=false;render();}};
 close.onclick=()=>dialog.close();dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 window.addEventListener('studio-pair-status',event=>{connected=!!(event as CustomEvent).detail.connected;render();});
 window.addEventListener('studio-pairing-expired',()=>{connected=false;problem='The connection ended. Create a new code to reconnect.';render();});
 setInterval(()=>{if(dialog.open&&!busy)render();},1000);
 render();if(sessionStorage.getItem('show-pairing')){sessionStorage.removeItem('show-pairing');dialog.showModal();}
}
