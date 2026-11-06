import {DEFAULT_CONFIG,IDLE_STATUS,NS,type InkConfig,type InkStatus} from './protocol';

let config:InkConfig=DEFAULT_CONFIG,status:InkStatus=IDLE_STATUS;
const push=()=>window.postMessage({ns:NS,t:'config',config},location.origin);
function ensureTracker(){
 if(!document.querySelector('iframe[data-sm-ink]')){
  const frame=document.createElement('iframe');frame.dataset.smInk='1';frame.src=chrome.runtime.getURL('tracker.html');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
  Object.assign(frame.style,{position:'fixed',width:'1px',height:'1px',left:'0',top:'0',border:'0',opacity:'0',pointerEvents:'none'});
  (document.body??document.documentElement).appendChild(frame);
 }
 window.postMessage({ns:NS,t:'tracker-added'},location.origin);
}
window.addEventListener('message',e=>{
 if(e.source!==window||e.data?.ns!==NS)return;
 if(e.data.t==='need-config')push();else if(e.data.t==='need-tracker')ensureTracker();else if(e.data.t==='status')status=e.data.status;
 else if(e.data.t==='patch'){config={...config,...e.data.patch};chrome.storage.session.set({config}).catch(()=>{});}
});
chrome.runtime.onMessage.addListener((m,_s,reply)=>{if(m?.type==='status')reply({status,ink:config.ink});});
(async()=>{
 try{await chrome.runtime.sendMessage({type:'access'});}catch{}
 try{config={...DEFAULT_CONFIG,...(await chrome.storage.session.get('config')).config};}catch{}
 push();
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes.config){config={...DEFAULT_CONFIG,...changes.config.newValue};push();}});
})();
