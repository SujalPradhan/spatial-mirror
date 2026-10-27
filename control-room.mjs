import {validTrackingFrame,validTrackingPhoto,validCaptureId} from './tracking-protocol.mjs';
const workspaces=new Set(['shapes','stand','box','art','lab','maths','tracking','pottery']);
const finiteQ=q=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.abs(Math.hypot(...q)-1)<.1;
const between=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
// Apply at relay ingress AND desktop receipt. Ink has reliable checkpoints and
// intentionally survives buffering; live pose/fine edits must be recent.
const discreteActions=new Set(['math-rotate','math-annotate','math-residuals','math-reveal','math-next','math-clear','draw-mode','position-mode','pin','recenter','stable','twist','undo','redo','select-lid','select-tray','save-pose','limit','record','play','marker','pottery-shape','pottery-decorate','pottery-inspect','pottery-phone','pottery-save','pottery-radius','pottery-band']);
export function freshInput(packet,now){
 // Button commands retain their workspace/context fence; give them a bounded
 // acknowledgement window instead of the continuous-pose deadline.
 const maxAge=packet.type==='action'&&discreteActions.has(packet.action)?1500:300;
 if(Number.isFinite(packet.at)&&now-packet.at<=maxAge&&packet.at-now<=100)return packet;
 if(packet.type==='frame'&&!packet.hold)return {...packet,stale:true,visibleAtCapture:packet.visible===true||packet.stale===true&&packet.visibleAtCapture===true,active:false,visible:false,depth:undefined,depthActive:false,q:null};
 if(packet.type==='action'&&['freeze','stop','fine-end'].includes(packet.action))return packet;
 return null;
}
function descriptor(workspace,state){
 if(!state||typeof state.enabled!=='boolean'||typeof state.frozen!=='boolean'||!Number.isSafeInteger(state.context)||state.context<0)return null;
 if(workspace==='tracking'&&(typeof state.captureEnabled!=='boolean'||!validCaptureId(state.trackingSession)))return null;
 if(workspace==='pottery'&&(!['shape','decorate','inspect'].includes(state.stage)||!validCaptureId(state.modelId)||!validCaptureId(state.trackingSession)||typeof state.captureEnabled!=='boolean'||state.captureEnabled&&state.stage!=='shape'||!Number.isInteger(state.band)||!between(state.band,0,32)||!between(state.height,80,300)||!between(state.radius,12,90)||!/^#[a-f0-9]{6}$/i.test(state.color)||!between(state.width,.005,.1)||!state.frame||!finiteQ(state.frame.q)||state.frame.aspect!==1))return null;
 const s={...state};for(const key of ['type','workspace','documentId','epoch','v','seq'])delete s[key];
 if(workspace==='shapes'&&(!['cone','cylinder','cube'].includes(s.solid)||!between(s.depth,-1.8,1.8)))return null;
 if(workspace==='stand'&&(s.fixture!=='folding-stand-v1'||s.selected!=='backrest'||!between(s.angle,0,80)||s.limit!==80))return null;
 if(workspace==='box'&&(!['lid','tray'].includes(s.selected)||!between(s.angle,0,120)||!between(s.lift,0,160)||!between(s.limit,0,120)))return null;
 if(workspace==='art'&&(!s.frame||!finiteQ(s.frame.q)||!Array.isArray(s.frame.origin)||s.frame.origin.length!==3||s.frame.origin.some(n=>!between(n,-50,50))||!['stable','twist'].includes(s.kind)||!/^#[a-f0-9]{6}$/i.test(s.color)||!between(s.width,.005,.1)))return null;
 if(workspace==='maths'&&(!['point','cloud','challenge'].includes(s.stage)||!['rotate','annotate'].includes(s.mode)||!s.frame||!finiteQ(s.frame.q)||!Array.isArray(s.frame.origin)||s.frame.origin.length!==3||s.frame.origin.some(n=>!between(n,-50,50))||s.frame.aspect!==1||typeof s.canDraw!=='boolean'))return null;
 return s;
}
// Shared protocol; works with Node and Cloudflare WebSocket implementations.
export function createControlRoom({initialEpoch=0,requireFresh=false}={}){
 const peers=new Map();let owner=null,phone=null,epoch=initialEpoch,acked=false,pendingPhoto=null;
 const send=(ws,p)=>{if(ws?.readyState===1&&(ws.bufferedAmount??0)<256*1024)ws.send(JSON.stringify({v:2,epoch,...p}));};
 const status=()=>{for(const [ws,p] of peers)send(ws,{type:'status',owner:owner===ws,claimed:!!owner,phoneConnected:!!phone,workspace:owner?peers.get(owner)?.workspace:null});};
 const pushState=()=>{if(owner&&phone){const p=peers.get(owner);send(phone,{type:'state',workspace:p.workspace,documentId:p.documentId,...p.state});}};
 const release=ws=>{if(owner!==ws)return;owner=null;acked=false;pendingPhoto=null;epoch++;send(phone,{type:'waiting'});status();};
 function connect(ws,role){
  if(!['desktop','phone'].includes(role)||role==='phone'&&phone){ws.close(4009,'A phone is already connected');return false;}
  peers.set(ws,{role,seq:-1,focused:false,workspace:null,state:null});if(role==='phone'){phone=ws;acked=false;pushState();}status();
  ws.addEventListener('message',({data:raw})=>{if(String(raw).length>128*1024)return ws.close(1009,'Message too large');let p;try{p=JSON.parse(String(raw));}catch{return ws.close(1007,'Invalid JSON');}if(!p||typeof p!=='object'||Array.isArray(p))return ws.close(1007,'Expected a message object');const peer=peers.get(ws);if(!peer)return;if(p.v!==2||!Number.isSafeInteger(p.seq)||p.seq<=peer.seq)return;peer.seq=p.seq;
   if(p.type==='ping'){send(ws,{type:'pong',t:p.t,serverNow:Date.now()});return;}
   if(role==='desktop'){
    if(p.type==='activate'){
     if(!workspaces.has(p.workspace)||typeof p.documentId!=='string'||p.documentId.length>120||!p.state||JSON.stringify(p.state).length>16000||p.focused!==true||p.visible!==true)return;
     const valid=descriptor(p.workspace,p.state);if(!valid)return;const previous=owner;if(previous!==ws){send(previous,{type:'lost'});epoch++;acked=false;pendingPhoto=null;}owner=ws;Object.assign(peer,{focused:true,workspace:p.workspace,documentId:p.documentId,state:valid});status();pushState();return;
    }
    if(owner!==ws||p.epoch!==epoch)return;
    if(p.type==='release'){release(ws);return;}
    if(p.type==='state'&&p.state&&JSON.stringify(p.state).length<16000){const valid=descriptor(peer.workspace,p.state);if(!valid)return;const oldContext=peer.state?.context;peer.state=valid;if(oldContext!==p.state.context){acked=false;pendingPhoto=null;}if(!valid.captureEnabled)pendingPhoto=null;pushState();return;}
    if(p.type==='ink-rejected'&&p.documentId===peer.documentId&&typeof p.strokeId==='string')send(phone,{type:'ink-rejected',documentId:p.documentId,strokeId:p.strokeId,index:p.index,reason:String(p.reason).slice(0,120)});
    if(p.type==='checkpoint'&&p.documentId===peer.documentId&&typeof p.strokeId==='string'&&Number.isSafeInteger(p.index))send(phone,{type:'checkpoint',documentId:p.documentId,strokeId:p.strokeId,index:p.index,finished:!!p.finished});
    if(p.type==='tracking-capture'&&peer.workspace==='tracking'&&peer.state.captureEnabled&&acked&&p.context===peer.state.context&&validCaptureId(p.requestId)&&(!pendingPhoto||pendingPhoto.expires<Date.now())){pendingPhoto={id:p.requestId,expires:Date.now()+10000};send(phone,{type:'tracking-capture',requestId:p.requestId,context:peer.state.context});}
    if(p.type==='cue')send(phone,{type:'cue',cue:p.cue,id:p.id,at:Date.now()});
    return;
   }
   if(!owner||p.epoch!==epoch)return;const target=peers.get(owner);
   if(p.type==='ack'){if(p.context===target.state.context&&p.documentId===target.documentId){acked=true;send(owner,{type:'phone-ready'});}return;}
   if(!acked||p.context!==target.state.context)return;
   if(requireFresh&&['frame','action'].includes(p.type)){p=freshInput(p,Date.now());if(!p)return;}
   if(p.type==='tracking-frame'){
    if(!['tracking','pottery'].includes(target.workspace)||!target.state.captureEnabled||!validTrackingFrame(p)||!Number.isFinite(p.at)||Date.now()-p.at>1500||p.at-Date.now()>100)return;
    send(owner,{type:'tracking-frame',captureId:p.captureId,width:p.width,height:p.height,frameId:p.frameId,hands:p.hands,frameAt:p.frameAt,dispatchAt:p.dispatchAt,videoTimeMs:p.videoTimeMs,timestampSource:p.timestampSource,clockRttMs:p.clockRttMs,inferenceMs:p.inferenceMs,processedHz:p.processedHz,at:p.at,context:p.context});return;
   }
   if(p.type==='tracking-photo'){
    if(target.workspace==='tracking'&&target.state.captureEnabled&&pendingPhoto?.id===p.requestId&&pendingPhoto.expires>Date.now()&&validTrackingPhoto(p)){pendingPhoto=null;send(owner,{type:'tracking-photo',requestId:p.requestId,jpeg:p.jpeg,captureId:p.captureId,width:p.width,height:p.height,context:p.context});}return;
   }
   if(p.type==='tracking-stop'&&['tracking','pottery'].includes(target.workspace)){pendingPhoto=null;send(owner,{type:'tracking-stop',context:p.context});return;}
   if(p.type==='frame'){
    if(typeof p.hold!=='boolean'||typeof p.active!=='boolean'||typeof p.visible!=='boolean'||!Number.isFinite(p.screenAngle)||typeof p.source!=='string'||p.source.length>120||p.hold&&!finiteQ(p.q))return;
    send(owner,{...p,epoch,seq:undefined,received:Date.now()});return;
   }
   if(p.type==='action'){
    if(typeof p.action!=='string'||p.action.length>60||p.value!==undefined&&(!Number.isFinite(p.value)||Math.abs(p.value)>(p.action==='color'?0xffffff:30000)))return;
    send(owner,{type:'action',action:p.action,value:p.value,at:p.at,epoch,context:p.context});return;
   }
   if(p.type==='ink'){
    if(!['art','maths','pottery'].includes(target.workspace)||p.documentId!==target.documentId||typeof p.strokeId!=='string'||p.strokeId.length>100||!Number.isSafeInteger(p.start)||p.start<0||!Array.isArray(p.points)||p.points.length>256||p.points.some(x=>!Array.isArray(x)||x.length!==7||!x.every(Number.isFinite)||Math.abs(x[0])>1||Math.abs(x[1])>1||Math.abs(Math.hypot(...x.slice(3))-1)>.1)||!Number.isFinite(p.aspect)||p.aspect<.2||p.aspect>5)return;
    if(target.workspace==='pottery'&&(target.state.stage!=='decorate'||p.modelId!==target.state.modelId)){send(phone,{type:'ink-rejected',documentId:p.documentId,strokeId:p.strokeId,index:-1,reason:'The vase changed. Begin a new stroke.'});return;}
    send(owner,{type:'ink',modelId:p.modelId,documentId:p.documentId,strokeId:p.strokeId,start:p.start,points:p.points,aspect:p.aspect,frame:p.frame,mode:p.mode==='position'?'position':'draw',finished:!!p.finished,interrupted:!!p.interrupted,epoch,context:p.context});return;
   }
   if(['telemetry','test','capability'].includes(p.type))send(owner,{...p,epoch,received:Date.now()});
  });
  ws.addEventListener('close',()=>{if(ws===phone){phone=null;acked=false;pendingPhoto=null;send(owner,{type:'phone-lost'});}release(ws);peers.delete(ws);status();});
  return true;
 }
 return {connect,get status(){return {phoneConnected:!!phone,clients:peers.size,workspace:peers.get(owner)?.workspace??null,epoch};},close(code=1001,reason='Room closed'){for(const ws of peers.keys())ws.close(code,reason);}};
}
