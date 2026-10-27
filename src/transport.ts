import type {Packet} from './types';
import {ControlClient} from './control';
export class Transport {
 private solid='';private context=0;private owner=false;readonly client:ControlClient;rtt:number|null=null;
 get connected(){return this.client.connected;}
 constructor(role:'desktop'|'phone',token:string,receive:(p:Packet)=>void,state:(connected:boolean,reason?:string)=>void){
  this.client=new ControlClient(role,token,p=>{
   if(p.type==='connected'){state(true);return;}
   if(p.type==='disconnected'){this.owner=false;state(false);return;}
   if(p.type==='pong'){this.rtt=performance.now()-Number(p.t);return;}
   if(p.type==='status'){receive({type:'connection',connected:p.phoneConnected});if(role==='desktop'&&this.owner!==!!p.owner){this.owner=!!p.owner;receive({type:p.owner?'workspace-available':'workspace-paused'});}return;}
   if(['lost','local-release'].includes(p.type)){this.owner=false;receive({type:'workspace-paused'});return;}
   if(p.type==='phone-lost'){receive({type:'connection',connected:false});return;}
   if(p.type==='state'){if(role==='phone')this.client.send({type:'ack',documentId:p.documentId,context:p.context});receive({...p,type:'controller-state'});return;}
   receive(p);
  },{enabled:location.pathname==='/lab',frozen:false,depth:0,solid:location.pathname.slice(1)||'cone',context:0});
 }
 send(p:Packet){if(p.type==='controller-state'){if(this.solid&&this.solid!==p.solid)this.context++;this.solid=String(p.solid);p={...p,context:this.context};}return this.client.send(p);}
 ping(){this.send({type:'ping',t:performance.now()});}
 close(){this.client.close();}
}
