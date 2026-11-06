const open=()=>chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_AND_UNTRUSTED_CONTEXTS'});
open();
chrome.runtime.onInstalled.addListener(open);chrome.runtime.onStartup.addListener(open);
chrome.runtime.onMessage.addListener((m,_s,reply)=>{if(m?.type!=='access')return;open().then(()=>reply(true),()=>reply(false));return true;});
