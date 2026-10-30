import {currentDocument,showStorageError} from './documents';
import {hosted,pairing,pairingStatus,clearPairing,socketUrl} from './session';
import type {Packet} from './types';
// @ts-ignore Shared plain-JavaScript protocol is also used by the relay.
import {freshInput} from '../control-room.mjs';
export const workspace=()=>location.pathname.replace(/\/$/,'')==='/atp'?'atp':location.pathname==='/pottery'?'pottery':location.pathname==='/tracking'?'tracking':location.pathname==='/maths'?'maths':location.pathname==='/art'?'art':location.pathname==='/mechanism/box'?'box':location.pathname==='/mechanism'?'stand':location.pathname.startsWith('/lab')?'lab':'shapes';
export class ControlClient {
 private readonly roomCode=pairing?.code;
 socket:WebSocket|null=null;connected=false;active=false;epoch=0;context=0;private seq=0;private stopped=false;private blocked=false;private latest:Record<string,unknown>;private stopLease:(()=>void)|null=null;private acquiring=false;private cancelled:AbortController|null=null;private timer?:ReturnType<typeof setTimeout>;private heartbeat?:ReturnType<typeof setInterval>;private remotePhone=false;private clockOffset:number|null=null;private clockRttMs:number|null=null;private motionNeutral:unknown=null;private motionEngagement='';private startedEngagement='';private motionContext:number|null=null;
 get clock(){return {ready:this.clockOffset!==null,rttMs:this.clockRttMs};}
 serverTime(t=performance.now()){return this.clockOffset===null?null:t+this.clockOffset;}
 constructor(readonly role:'desktop'|'phone',private token:string,private receive:(p:Packet)=>void,initial:Record<string,unknown>={enabled:false,context:0}){this.latest=initial;this.connect();if(role==='desktop'){window.addEventListener('focus',()=>{this.blocked=false;void this.acquire();});window.addEventListener('blur',()=>this.release());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.release();else void this.acquire();});window.addEventListener('pagehide',()=>this.close());}}
 private connect(){
  if(hosted&&this.role==='desktop'&&!this.connected){queueMicrotask(()=>{if(this.stopped)return;this.connected=true;this.receive({type:'connected'});void this.acquire();});}
  if(hosted&&!this.token)return;
  const roomCode=this.roomCode;const ws=this.socket=new WebSocket(socketUrl(this.token,this.role,roomCode));
  ws.onopen=()=>{if(this.socket!==ws||this.stopped){ws.close();return;}this.seq=0;this.motionEngagement='';this.startedEngagement='';this.motionContext=null;this.clockOffset=null;this.clockRttMs=null;
   if(!hosted||this.role==='phone'){this.connected=true;this.receive({type:'connected'});}
   this.network({type:'ping',t:performance.now()});
   clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>this.network({type:'ping',t:performance.now()}),5000);
   if(this.role==='desktop'){if(hosted&&this.active)this.network({type:'activate',workspace:workspace(),documentId:currentDocument?.id??workspace(),state:this.latest,focused:true,visible:true});else void this.acquire();}
  };
  ws.onmessage=e=>{
   if(this.socket!==ws)return;let p;try{p=JSON.parse(e.data);}catch{return;}if(p.v!==2)return;
   let clockBecameReady=false;
   if(p.type==='pong'&&Number.isFinite(p.serverNow)&&Number.isFinite(p.t)){const now=performance.now();if(now-p.t<1000){clockBecameReady=this.clockOffset===null;this.clockOffset=p.serverNow+(now-p.t)/2-now;this.clockRttMs=now-p.t;}}
   if(Number.isSafeInteger(p.epoch)&&p.epoch>=this.epoch)this.epoch=p.epoch;
   if(clockBecameReady&&hosted&&this.role==='desktop'&&this.active&&this.usesMotion())this.network({type:'state',state:this.latest});
   if(p.type==='status'&&this.role==='desktop'){
    // The initial scene may be published before the relay grants its new epoch.
    // Re-send it after ownership is acknowledged, including clock readiness.
    if(hosted&&p.owner&&this.active&&this.usesMotion())this.network({type:'state',state:this.latest});
    this.remotePhone=!!p.phoneConnected;if(!hosted)this.active=!!p.owner;else {pairingStatus.connected=this.remotePhone;p.owner=this.active;if(pairing&&this.remotePhone&&!pairing.paired){pairing.paired=true;localStorage.setItem('spatial-pairing-v1:desktop',JSON.stringify(pairing));}window.dispatchEvent(new CustomEvent('studio-pair-status',{detail:{connected:this.remotePhone}}));}
   }
   if(p.type==='lost'){this.blocked=true;this.active=false;this.release();}
   if(p.type==='state'&&this.role==='phone')this.context=Number(p.context??0);
   if(this.role==='desktop'&&['frame','action','ink'].includes(p.type)&&(!this.active||document.hidden||!document.hasFocus()))return;
   if(hosted&&this.role==='desktop'&&['frame','action'].includes(p.type)){p=freshInput(p,this.clockOffset===null?NaN:performance.now()+this.clockOffset);if(!p)return;}
   // A fresh first pose completes this acknowledged grab even if the idle
   // heartbeat lease elapsed while its acknowledgment travelled to the phone.
   // Subsequent poses never re-arm a grab after interruption.
   if(hosted&&this.role==='desktop'&&this.usesMotion()&&p.type==='frame'&&p.hold&&p.active&&p.visible&&p.context===this.context&&p.engagement===this.motionEngagement&&this.motionEngagement&&this.startedEngagement!==this.motionEngagement){this.startedEngagement=this.motionEngagement;const neutral={...p,q:this.motionNeutral??p.q};this.receive({...neutral,hold:false});this.receive(neutral);}
   this.receive(p);
   if(hosted&&this.role==='desktop'&&this.usesMotion()&&p.type==='frame'&&p.context===this.context&&p.active&&p.visible&&!p.hold&&typeof p.engagement==='string'&&/^[a-f0-9-]{36}$/.test(p.engagement)&&p.engagement!==this.motionEngagement){this.motionEngagement=p.engagement;this.motionNeutral=Array.isArray(p.q)?[...p.q]:null;this.network({type:'state',state:this.latest});}
  };
  ws.onclose=event=>{
   if(this.socket!==ws)return;clearInterval(this.heartbeat);this.clockOffset=null;this.clockRttMs=null;this.remotePhone=false;
   if(hosted&&this.role==='desktop'){pairingStatus.connected=false;this.receive({type:'phone-lost'});this.receive({type:'status',owner:this.active,phoneConnected:false});window.dispatchEvent(new CustomEvent('studio-pair-status',{detail:{connected:false}}));}
   else{this.connected=false;this.active=false;this.release();this.receive({type:'disconnected'});}
   if(hosted&&event.code===4009){this.receive({type:'pairing-busy'});return;}
   if(hosted&&event.code===4001){clearPairing(roomCode);this.receive({type:'pairing-expired',reason:event.reason});window.dispatchEvent(new Event('studio-pairing-expired'));return;}
   if(!this.stopped)this.timer=setTimeout(()=>this.connect(),1200);
  };
  ws.onerror=()=>ws.close();
 }
 private async acquire(){if(this.role!=='desktop'||!this.connected||this.acquiring||this.stopLease||document.hidden||!document.hasFocus())return;this.acquiring=true;const abort=this.cancelled=new AbortController();const run=async()=>{if(abort.signal.aborted||document.hidden||!document.hasFocus())return;try{await currentDocument?.restoreLatest();}catch(e){showStorageError(String(e));return;}if(abort.signal.aborted||document.hidden||!document.hasFocus())return;currentDocument&&(currentDocument.writable=true);this.raw({type:'activate',workspace:workspace(),documentId:currentDocument?.id??workspace(),state:this.latest,focused:true,visible:true});await new Promise<void>(resolve=>{this.stopLease=resolve;});this.stopLease=null;currentDocument&&(currentDocument.writable=false);const epoch=this.epoch;await currentDocument?.flush().catch(()=>{});this.raw({type:'release',epoch});};try{if(navigator.locks)await navigator.locks.request('spatial-studio-controller',{signal:abort.signal},run);else await run();}catch(e){if(!abort.signal.aborted)showStorageError(String(e));}finally{this.acquiring=false;if(!this.blocked&&!this.stopped&&this.connected&&!document.hidden&&document.hasFocus())setTimeout(()=>void this.acquire(),50);}}
 release(){this.active=false;this.cancelled?.abort();this.stopLease?.();this.receive({type:'local-release'});}
 private usesMotion(){return workspace()!=='tracking'&&!(workspace()==='pottery'&&this.latest.stage==='shape');}
 private network(p:Packet){
  const ws=this.socket;if(ws?.readyState!==WebSocket.OPEN)return false;
  // Camera frames are replaceable: drop them before they build a delayed queue.
  if(p.type==='tracking-frame'&&ws.bufferedAmount>4*1024)return false;
  if(ws.bufferedAmount>16*1024){ws.close(1013,'Connection catching up');return false;}
  if(hosted&&p.type==='frame'&&p.hold&&this.clockOffset===null)return false;
  // Publish motion readiness separately: camera enablement and capture are unchanged.
  if(hosted&&this.role==='desktop'&&['activate','state'].includes(p.type)&&this.usesMotion()){const state=p.state as Record<string,unknown>;if(this.motionContext!==state.context){this.motionContext=Number(state.context);this.motionEngagement='';this.startedEngagement='';}p={...p,state:{...state,motionReady:this.clockOffset!==null,motionEngagement:this.motionEngagement}};}
  ws.send(JSON.stringify({v:2,seq:this.seq++,epoch:this.epoch,context:this.context,...p,...this.clockOffset===null?{}:{at:performance.now()+this.clockOffset}}));return true;
 }
 private raw(p:Packet){
  if(hosted&&this.role==='desktop'){
   if(p.type==='activate'){this.active=true;this.receive({type:'status',owner:true,claimed:true,phoneConnected:this.remotePhone,workspace:workspace()});this.network(p);return true;}
   if(p.type==='release'){this.active=false;this.receive({type:'status',owner:false,claimed:false,phoneConnected:this.remotePhone});this.network(p);return true;}
  }
  return this.network(p);
 }
 send(p:Packet){if(this.role==='desktop'&&(p.type==='state'||p.type==='controller-state')){const {type,...state}=p;this.latest={...state,context:Number(p.context??0)};this.context=Number(p.context??0);if(this.active)this.raw({type:'state',state:this.latest});return true;}if(this.role==='desktop'&&p.type==='claim'){void this.acquire();return true;}if(this.role==='desktop'&&p.type==='release'){this.release();return true;}if(this.role==='desktop'&&(!this.active||document.hidden||!document.hasFocus()))return false;return this.raw(p);}
 close(){this.stopped=true;clearTimeout(this.timer);clearInterval(this.heartbeat);this.release();this.socket?.close();}
}
