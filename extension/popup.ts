import {COLOURS,DEFAULT_CONFIG,IDLE_STATUS,statusText,type InkConfig,type InkStatus} from './protocol';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let config:InkConfig=DEFAULT_CONFIG;
const save=(patch:Partial<InkConfig>)=>{config={...config,...patch};render();return chrome.storage.session.set({config});};
function render(){
 $<HTMLInputElement>('ink').checked=config.ink;$<HTMLInputElement>('keep').checked=config.keep;$<HTMLInputElement>('lightboard').checked=config.lightboard;
 for(const b of $('swatches').children)b.setAttribute('aria-checked',String((b as HTMLElement).dataset.colour===config.colour));
}
for(const colour of COLOURS){
 const b=document.createElement('button');b.type='button';b.dataset.colour=colour;b.style.background=colour;b.setAttribute('role','radio');b.setAttribute('aria-label',colour);
 b.onclick=()=>save({colour});$('swatches').appendChild(b);
}
$<HTMLInputElement>('ink').onchange=e=>save({ink:(e.target as HTMLInputElement).checked});
$<HTMLInputElement>('keep').onchange=e=>save({keep:(e.target as HTMLInputElement).checked});
$<HTMLInputElement>('lightboard').onchange=e=>save({lightboard:(e.target as HTMLInputElement).checked});
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
poll();setInterval(poll,500);
