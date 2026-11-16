import {relayOrigin} from '../session';

export interface PartyInfo {code:string;token:string;expiresAt:number}
const origin=()=>relayOrigin||location.origin;
export async function createParty():Promise<PartyInfo>{
 const response=await fetch(origin()+'/parties',{method:'POST',signal:AbortSignal.timeout(10000)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Could not start a party. Try again.');return data;
}
export function streamUrl(code:string,params:Record<string,string>){
 const url=new URL(origin());url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname=`/parties/${code}/stream`;url.search=new URLSearchParams(params).toString();return url.href;
}
export const joinLink=(code:string)=>`${location.origin}/proton-party/join?code=${code}`;

export type Wire={v:1;type:string;[key:string]:unknown};
/** A WebSocket that reconnects by itself, so a phone that blinks offline drops back in. */
export class PartySocket {
 private ws:WebSocket|null=null;private tries=0;private timer?:ReturnType<typeof setTimeout>;private closed=false;private ping?:ReturnType<typeof setInterval>;
 online=false;
 constructor(private url:()=>string,private onMessage:(m:Wire)=>void,private onStatus:(online:boolean,final?:boolean)=>void=()=>{}){this.open();}
 private open(){
  if(this.closed)return;
  let ws:WebSocket;
  try{ws=new WebSocket(this.url());}catch{this.retry();return;}
  this.ws=ws;
  ws.onopen=()=>{this.tries=0;this.online=true;this.onStatus(true);clearInterval(this.ping);this.ping=setInterval(()=>this.send({type:'ping'}),20000);};
  ws.onmessage=({data})=>{try{const m=JSON.parse(String(data));if(m&&m.v===1&&typeof m.type==='string')this.onMessage(m);}catch{}};
  ws.onclose=e=>{
   clearInterval(this.ping);const was=this.online;this.online=false;
   if(e.code===4001){this.closed=true;this.onStatus(false,true);return;}
   if(was||this.tries===0)this.onStatus(false);
   this.retry();
  };
 }
 private retry(){if(this.closed)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.open(),Math.min(4000,400*2**this.tries++)+Math.random()*300);}
 send(message:{type:string;[key:string]:unknown}){if(this.ws?.readyState===1){this.ws.send(JSON.stringify({v:1,...message}));return true;}return false;}
 /** Cuts the line without giving up, so the next retry rejoins. */
 drop(){this.ws?.close();}
 close(){this.closed=true;clearTimeout(this.timer);clearInterval(this.ping);this.ws?.close();}
}
