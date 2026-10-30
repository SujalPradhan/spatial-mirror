import type {Packet} from '../types';

export const atpPhonePanel=`<section id="atp-phone-panel" hidden aria-label="ATP synthase controls"><p id="atp-phone-chapter"></p><div class="button-row"><button data-action="atp-view">View</button><button data-action="atp-rotor">Turn rotor</button></div><div class="button-row"><button data-action="atp-prev">Previous</button><button data-action="atp-next">Next</button><button data-action="atp-play">Play illustration</button><button data-action="atp-pause">Pause</button></div><div class="button-row"><button data-action="atp-recenter">Recenter</button><button data-action="atp-zoom-out" aria-label="Zoom out">−</button><button data-action="atp-zoom-in" aria-label="Zoom in">+</button></div><details><summary>Parts and checkpoints</summary><div class="button-row"><button data-action="atp-select-rotor">Rotor</button><button data-action="atp-select-stator">Stationary support</button><button data-action="atp-select-head">Catalytic head</button><button data-action="atp-select-membrane">Membrane</button></div><div class="button-row"><button data-action="atp-checkpoint" data-value="0">0°</button><button data-action="atp-checkpoint" data-value="120">120°</button><button data-action="atp-checkpoint" data-value="240">240°</button><button data-action="atp-checkpoint" data-value="360">360°</button></div><div class="button-row"><button data-action="atp-guided">Guided</button><button data-action="atp-explore">Explore</button></div></details></section>`;

/** Only the ATP workspace changes the shared pad/slider labels. */
export function updateAtpPhone(state:Packet|null,enabled:boolean,fine:boolean,hold:boolean){
 const panel=document.querySelector<HTMLElement>('#atp-phone-panel')!;panel.hidden=state?.workspace!=='atp';if(panel.hidden)return;
 const rotor=state!.tool==='rotor',input=document.querySelector<HTMLInputElement>('#fine')!;
 document.querySelector('#atp-phone-chapter')!.textContent=`Chapter ${Number(state!.chapter)+1} of 6 · ${state!.representation==='mechanism'?'Illustrative mechanism':'Structural snapshot'}`;
 document.querySelector('#pad-label')!.textContent=rotor?'Hold to turn the rotor':'Hold to turn the view';
 document.querySelector('#fine-label')!.textContent=rotor?'Illustrated phase':'Zoom';input.min=rotor?'0':'.65';input.max=rotor?'360':'2.5';input.step=rotor?'1':'.01';input.disabled=!enabled||hold;
 if(!fine)input.value=String(rotor?state!.phase:state!.zoom??1);
 document.querySelector('#fine-value')!.textContent=rotor?`${Math.round(Number(input.value))}°`:`${Number(input.value).toFixed(2)}×`;
 for(const button of panel.querySelectorAll<HTMLButtonElement>('[data-action]')){
  const action=button.dataset.action!;button.hidden=action==='atp-play'?state!.playing===true:action==='atp-pause'?state!.playing!==true:false;
  button.setAttribute('aria-pressed',String(action===`atp-${state!.tool}`||action===`atp-select-${state!.selected}`||action===(state!.guided?'atp-guided':'atp-explore')));
 }
}
