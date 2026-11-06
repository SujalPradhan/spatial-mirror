import {BACKGROUNDS,BACKGROUND_LABELS,COLOURS,SLIDE_COUNT,DEFAULT_CONFIG,IDLE_STATUS,statusText,type InkConfig,type InkStatus} from './protocol';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let config:InkConfig=DEFAULT_CONFIG;
const save=(patch:Partial<InkConfig>)=>{config={...config,...patch};render();return chrome.storage.session.set({config});};
function render(){
 $<HTMLInputElement>('ink').checked=config.ink;$<HTMLInputElement>('keep').checked=config.keep;$<HTMLInputElement>('lightboard').checked=config.lightboard;$<HTMLInputElement>('guide').checked=config.guide;$('slide').textContent=`Slide ${config.slide+1} of ${SLIDE_COUNT}`;
 for(const b of $('backgrounds').children)b.setAttribute('aria-checked',String((b as HTMLElement).dataset.background===config.background));
 for(const b of $('swatches').children)b.setAttribute('aria-checked',String((b as HTMLElement).dataset.colour===config.colour));
}
for(const colour of COLOURS){
 const b=document.createElement('button');b.type='button';b.dataset.colour=colour;b.style.background=colour;b.setAttribute('role','radio');b.setAttribute('aria-label',colour);
 b.onclick=()=>save({colour});$('swatches').appendChild(b);
}
const PREVIEW={off:'#2b2e36',slides:'linear-gradient(135deg,#0b1020,#26355f)',blur:'linear-gradient(135deg,#5b6b7a,#9db0bf)'};
for(const bg of BACKGROUNDS){
 const b=document.createElement('button');b.type='button';b.dataset.background=bg;b.style.background=PREVIEW[bg];b.title=BACKGROUND_LABELS[bg];b.textContent=bg==='off'?'Off':bg==='slides'?'Slides':'Blur';
 b.setAttribute('role','radio');b.setAttribute('aria-label',BACKGROUND_LABELS[bg]);b.onclick=()=>save({background:bg});$('backgrounds').appendChild(b);
}
$<HTMLInputElement>('ink').onchange=e=>save({ink:(e.target as HTMLInputElement).checked});
$<HTMLInputElement>('keep').onchange=e=>save({keep:(e.target as HTMLInputElement).checked});
$<HTMLInputElement>('lightboard').onchange=e=>save({lightboard:(e.target as HTMLInputElement).checked});
$<HTMLInputElement>('guide').onchange=e=>save({guide:(e.target as HTMLInputElement).checked});
const step=(d:number)=>save({slide:(config.slide+d+SLIDE_COUNT)%SLIDE_COUNT});
$('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);
$('clear').onclick=()=>save({clearAt:Date.now()});
async function poll(){
 let text='Open a call tab';
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const reply:{status:InkStatus;ink:boolean}|undefined=tab?.id===undefined?undefined:await chrome.tabs.sendMessage(tab.id,{type:'status'});
  if(reply)text=statusText(reply.status??IDLE_STATUS,config.ink);
 }catch{}
 $('status').textContent=text;
}
chrome.storage.session.get('config').then(s=>{config={...DEFAULT_CONFIG,...s.config};render();});
chrome.storage.onChanged.addListener((c,area)=>{if(area==='session'&&c.config){config={...DEFAULT_CONFIG,...c.config.newValue};render();}});
poll();setInterval(poll,500);
