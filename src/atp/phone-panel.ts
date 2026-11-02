import type {Packet} from '../types';

/** An intentional touch/key completion is a final seek, not another live sample. */
export function atpFineSeek(state:Packet|null,value:number,event:string){
 if(state?.workspace!=='atp'||!['pointerup','change','keyup'].includes(event)||!Number.isFinite(value))return null;
 const rotor=state.tool==='rotor',min=rotor?0:.65,max=rotor?360:2.5;
 return value<min||value>max?null:{action:rotor?'atp-checkpoint':'atp-set-zoom',value};
}

export const atpPhonePanel=`<section id="atp-phone-panel" hidden aria-label="ATP synthase controls"><div class="button-row"><button data-action="atp-view">View</button><button data-action="atp-rotor">Turn rotor</button></div><div class="button-row"><button data-action="atp-play">Spin</button><button data-action="atp-pause">Stop</button><button data-action="atp-recenter">Recenter</button><button data-action="atp-zoom-out" aria-label="Zoom out">−</button><button data-action="atp-zoom-in" aria-label="Zoom in">+</button></div></section>`;

/** Only the ATP workspace changes the shared pad/slider labels. */
export function updateAtpPhone(state:Packet|null,enabled:boolean,fine:boolean,hold:boolean){
 const panel=document.querySelector<HTMLElement>('#atp-phone-panel')!;panel.hidden=state?.workspace!=='atp';if(panel.hidden)return;
 const rotor=state!.tool==='rotor',input=document.querySelector<HTMLInputElement>('#fine')!;
 document.querySelector('#pad-label')!.textContent=rotor?`Hold to turn the ${state!.motionLabel??'rotor'}`:'Hold to turn the view';
 document.querySelector('#fine-label')!.textContent=rotor?`${String(state!.motionLabel??'rotor').replace(/^./,c=>c.toUpperCase())} angle`:'Zoom';input.min=rotor?'0':'.65';input.max=rotor?'360':'2.5';input.step=rotor?'1':'.01';input.disabled=!enabled||hold;
 if(!fine)input.value=String(rotor?state!.phase:state!.zoom??1);
 document.querySelector('#fine-value')!.textContent=rotor?`${Math.round(Number(input.value))}°`:`${Number(input.value).toFixed(2)}×`;
 for(const button of panel.querySelectorAll<HTMLButtonElement>('[data-action]')){
  const action=button.dataset.action!;button.hidden=action==='atp-play'?state!.playing===true:action==='atp-pause'?state!.playing!==true:false;
  button.setAttribute('aria-pressed',String(action===`atp-${state!.tool}`));
 }
}
