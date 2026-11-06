import type {InkBoard,Stroke} from '../ink/ink';
import type {GestureEvent,HandPose,HandSide,MirrorPoint,MirrorState,TrackedHand} from './contracts';

/** Hands cross the relay as flat 1/1000 integers in stage coordinates, so every viewer lands them where the presenter saw them. */
export interface WireHand {id:number;side:string;pose:string;l:number[];o:number[]|null;v:number[];a:number;s?:{m:boolean;p:number[]}}
export interface WireEvent {t:'pose'|'lost'|'clap';h?:number;p?:string;x?:number;y?:number}
export interface WireStroke {id:number;c:string;w:number;from:number;p:number[];d:0|1}
export interface WireInk {add?:WireStroke[];rm?:number[];clear?:1}
export interface WatchDelta {type:'watch';full?:boolean;state?:MirrorState;eng?:number[];hands?:WireHand[];page?:Record<string,unknown>;ev?:WireEvent[];on?:boolean;keep?:boolean;ink?:WireInk;hb?:1}
export type Stage=(p:{x:number;y:number})=>{x:number;y:number};
export const WATCH_HZ=15,POINT_BUDGET=2400;
const q=(n:number,k=1000)=>Math.round(n*k),round=(n:number,d=4)=>Math.round(n*10**d)/10**d;

export function encodeHand(h:TrackedHand,stage:Stage):WireHand{
 const l=h.landmarks.flatMap(p=>{const s=stage(p);return [q(s.x),q(s.y),q(p.z)];});
 return {id:h.id,side:h.side,pose:h.pose,l,o:h.orientation?h.orientation.map(n=>round(n)):null,v:[round(h.velocity.x,2),round(h.velocity.y,2)],a:Math.min(h.poseAge,1000),...h.shape?{s:{m:h.shape.metric,p:h.shape.points.flatMap(p=>[q(p.x,1e4),q(p.y,1e4),q(p.z,1e4)])}}:{}};
}
const average=(points:MirrorPoint[],ids:number[])=>({x:ids.reduce((n,i)=>n+points[i].x,0)/ids.length,y:ids.reduce((n,i)=>n+points[i].y,0)/ids.length,z:ids.reduce((n,i)=>n+points[i].z,0)/ids.length});
export function decodeHand(w:WireHand):TrackedHand{
 const landmarks=Array.from({length:21},(_,i)=>({x:w.l[i*3]/1000,y:w.l[i*3+1]/1000,z:w.l[i*3+2]/1000}));
 return {id:w.id,side:w.side as HandSide,pose:w.pose as HandPose,landmarks,palm:average(landmarks,[0,5,9,13,17]),indexTip:{...landmarks[8]},pinch:average(landmarks,[4,8]),orientation:w.o as TrackedHand['orientation'],velocity:{x:w.v[0],y:w.v[1]},poseAge:w.a,...w.s?{shape:{metric:w.s.m,points:Array.from({length:21},(_,i)=>({x:w.s!.p[i*3]/1e4,y:w.s!.p[i*3+1]/1e4,z:w.s!.p[i*3+2]/1e4}))}}:{}};
}
export function encodeEvent(e:GestureEvent,stage:Stage):WireEvent{
 if(e.type==='clap'){const s=stage(e);return {t:'clap',x:round(s.x),y:round(s.y)};}
 return e.type==='pose'?{t:'pose',h:e.handId,p:e.pose}:{t:'lost',h:e.handId};
}
export function decodeEvent(e:WireEvent):GestureEvent|null{
 if(e.t==='clap')return Number.isFinite(e.x)&&Number.isFinite(e.y)?{type:'clap',x:e.x!,y:e.y!}:null;
 if(e.h===undefined)return null;
 return e.t==='pose'?{type:'pose',handId:e.h,pose:(e.p??'none') as HandPose}:{type:'lost',handId:e.h};
}
export function decodeStrokePoints(p:number[]){const out=[];for(let i=0;i+1<p.length;i+=2)out.push({x:p[i]/1000,y:p[i+1]/1000});return out;}

/** Applies ink operations from the wire to a board; the stroke map is the viewer's id lookup. */
export function applyInkOps(board:InkBoard,strokes:Map<number,Stroke>,ink:WireInk,now:number){
 if(ink.clear){board.clear();strokes.clear();}
 for(const id of ink.rm??[]){const s=strokes.get(id);if(s){board.strokes=board.strokes.filter(x=>x!==s);strokes.delete(id);}}
 for(const a of ink.add??[]){
  let s=strokes.get(a.id);
  if(!s){s={points:[],colour:a.c,width:a.w,createdAt:now,finishedAt:null};strokes.set(a.id,s);board.strokes.push(s);}
  if(a.from>s.points.length)continue;
  s.points.length=a.from;s.points.push(...decodeStrokePoints(a.p));
  if(a.d&&s.finishedAt===null)s.finishedAt=now;
 }
}

export interface WatchSample {state:MirrorState;pos:number;speed:number;playing:boolean;hands:TrackedHand[];stage:Stage;inkOn:boolean;keep:boolean;strokes:Stroke[];page:Record<string,unknown>}

/** The presenting page: sends a delta of what changed at most WATCH_HZ times a second, and a full snapshot after every (re)connection. */
export class WatchPresenter {
 code='';viewers=0;error='';
 private ws:WebSocket|null=null;private seq=0;private stopped=false;private full=true;private lastSend=0;private timer?:ReturnType<typeof setInterval>;private heartbeat?:ReturnType<typeof setInterval>;private retry?:ReturnType<typeof setTimeout>;
 private last={state:'',eng:'',hands:'',on:false,keep:false};private lastPage=new Map<string,string>();private events:WireEvent[]=[];
 private ids=new Map<Stroke,{id:number;sent:number;done:boolean}>();private nextId=1;
 constructor(private readonly address:()=>Promise<string>,private readonly read:()=>WatchSample,private readonly changed:()=>void,private readonly expired:()=>void=()=>{}){}
 get open(){return this.ws?.readyState===WebSocket.OPEN;}
 async start(){
  this.stopped=false;this.error='';
  try{
   const ws=this.ws=new WebSocket(await this.address());
   ws.onopen=()=>{if(this.ws!==ws)return;this.seq=0;this.full=true;this.ids.clear();this.lastPage.clear();this.send({type:'share'});clearInterval(this.timer);clearInterval(this.heartbeat);this.timer=setInterval(()=>this.tick(),1000/WATCH_HZ);this.heartbeat=setInterval(()=>this.send({type:'ping',t:performance.now()}),5000);this.tick();};
   ws.onmessage=e=>{
    if(this.ws!==ws)return;let p;try{p=JSON.parse(e.data);}catch{return;}if(p.v!==2)return;
    if(p.type==='watch-code'&&typeof p.code==='string'){this.code=p.code;this.viewers=Number(p.viewers)||0;this.changed();}
    if(p.type==='viewers'){this.viewers=Number(p.count)||0;this.changed();}
   };
   ws.onclose=ev=>{
    if(this.ws!==ws)return;clearInterval(this.timer);clearInterval(this.heartbeat);this.ws=null;this.viewers=0;
    if(ev.code===4001){this.expired();this.error='This room expired. Start sharing again.';this.stopped=true;}
    else if(ev.code===4010)this.stopped=true;
    this.changed();if(!this.stopped)this.retry=setTimeout(()=>void this.start(),1500);
   };
   ws.onerror=()=>ws.close();
  }catch(e){this.error=e instanceof Error?e.message:String(e);this.changed();}
 }
 stop(){this.stopped=true;clearTimeout(this.retry);clearInterval(this.timer);clearInterval(this.heartbeat);const ws=this.ws;this.ws=null;ws?.close();this.code='';this.viewers=0;this.changed();}
 /** Pose, lost and clap events are one-shots, so they are queued until the next send. */
 queue(list:GestureEvent[],stage:Stage){for(const e of list)this.events.push(encodeEvent(e,stage));if(this.events.length>20)this.events.splice(0,this.events.length-20);}
 private send(p:Record<string,unknown>){const ws=this.ws;if(ws?.readyState!==WebSocket.OPEN)return false;ws.send(JSON.stringify({v:2,seq:this.seq++,...p}));return true;}
 private tick(){
  const ws=this.ws;if(!this.open||ws!.bufferedAmount>64*1024)return;
  const s=this.read(),full=this.full,msg:Record<string,unknown>={type:'broadcast'};let changed=false;
  const state=JSON.stringify(s.state);if(full||state!==this.last.state){msg.state=s.state;changed=true;}
  const eng=[round(s.pos,1),round(s.speed,3),s.playing?1:0],engKey=eng.join();if(full||engKey!==this.last.eng){msg.eng=eng;changed=true;}
  const hands=s.hands.slice(0,2).map(h=>encodeHand(h,s.stage)),handsKey=JSON.stringify(hands);if(full||handsKey!==this.last.hands){msg.hands=hands;changed=true;}
  const page:Record<string,unknown>={},pageKeys:[string,string][]=[];
  for(const [k,v] of Object.entries(s.page)){const j=JSON.stringify(v);if(j.length>10000)continue;if(this.lastPage.get(k)!==j){page[k]=v;pageKeys.push([k,j]);}}
  if(pageKeys.length){msg.page=page;changed=true;}
  if(full||s.inkOn!==this.last.on){msg.on=s.inkOn;changed=true;}
  if(full||s.keep!==this.last.keep){msg.keep=s.keep;changed=true;}
  if(this.events.length){msg.ev=this.events.slice(0,20);changed=true;}
  const ink=this.inkOps(s.strokes);if(ink){msg.ink=ink;changed=true;}
  const now=performance.now();if(!changed){if(now-this.lastSend<1000)return;msg.hb=1;}
  if(full)msg.full=true;
  if(!this.send(msg))return;
  this.lastSend=now;this.full=false;for(const [k,j] of pageKeys)this.lastPage.set(k,j);this.last={state,eng:engKey,hands:handsKey,on:s.inkOn,keep:s.keep};this.events.splice(0,(msg.ev as unknown[]|undefined)?.length??0);
 }
 /** Strokes only ever grow, so each message carries the new points since the last one. */
 private inkOps(strokes:Stroke[]):WireInk|null{
  const live=new Set(strokes),rm:number[]=[],add:WireStroke[]=[];let budget=POINT_BUDGET;
  for(const [stroke,e] of this.ids)if(!live.has(stroke)){rm.push(e.id);this.ids.delete(stroke);}
  for(const stroke of strokes){
   let e=this.ids.get(stroke);if(!e){e={id:this.nextId++,sent:0,done:false};this.ids.set(stroke,e);}
   const finished=stroke.finishedAt!==null,more=stroke.points.length-e.sent;
   if(!more&&finished===e.done&&e.sent>0)continue;
   if(budget<=0)break;
   const n=Math.min(Math.max(more,0),budget),from=e.sent;budget-=Math.max(n,1);
   add.push({id:e.id,c:stroke.colour,w:round(stroke.width),from,p:stroke.points.slice(from,from+n).flatMap(p=>[q(p.x),q(p.y)]),d:finished&&n===more?1:0});
   e.sent+=n;e.done=finished&&e.sent===stroke.points.length;
  }
  if(!rm.length&&!add.length)return null;
  return {...rm.length?{rm}:{},...add.length?{add}:{}};
 }
}

/** The viewing page's receiver: keeps the latest broadcast and tells whether the presenter is still sending. */
export class WatchViewer {
 state:MirrorState|null=null;eng=[0,0,0];hands:WireHand[]=[];page:Record<string,unknown>={};pageRev=0;engRev=0;on=false;keep=false;events:GestureEvent[]=[];
 online=false;lastAt=-Infinity;error='';ended=false;
 private ws:WebSocket|null=null;private seq=0;private stopped=false;private heartbeat?:ReturnType<typeof setInterval>;private retry?:ReturnType<typeof setTimeout>;
 private readonly strokes=new Map<number,Stroke>();
 constructor(private readonly url:string|null,private readonly board:InkBoard,private readonly changed:()=>void=()=>{}){}
 /** True while the presenter is connected and has sent something recently. */
 live(now=performance.now()){return this.online&&now-this.lastAt<3500;}
 start(){
  if(!this.url){this.error='This watch link is not valid.';this.ended=true;this.changed();return;}
  const ws=this.ws=new WebSocket(this.url);
  ws.onopen=()=>{if(this.ws!==ws)return;this.seq=0;clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>this.ping(),5000);this.ping();};
  ws.onmessage=e=>{if(this.ws===ws)this.receive(e.data);};
  ws.onclose=ev=>{
   if(this.ws!==ws)return;clearInterval(this.heartbeat);this.online=false;
   if(ev.code===4001){this.error='This watch link has expired.';this.ended=true;}
   else if(ev.code===4008){this.error='This stream is full. Try again soon.';this.ended=true;}
   this.changed();if(!this.stopped&&!this.ended)this.retry=setTimeout(()=>this.start(),1500);
  };
  ws.onerror=()=>ws.close();
 }
 stop(){this.stopped=true;clearTimeout(this.retry);clearInterval(this.heartbeat);const ws=this.ws;this.ws=null;ws?.close();}
 private ping(){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({v:2,seq:this.seq++,type:'ping',t:performance.now()}));}
 receive(raw:string,now=performance.now()){
  let p:any;try{p=JSON.parse(raw);}catch{return;}if(p?.v!==2)return;
  if(p.type==='watch-presence'){this.online=!!p.online;if(this.online)this.lastAt=now;this.changed();return;}
  if(p.type!=='watch')return;
  this.apply(p,now);
 }
 apply(p:WatchDelta,now=performance.now()){
  this.lastAt=now;
  if(p.full){this.board.clear();this.strokes.clear();}
  if(p.state)this.state=p.state;
  if(p.eng){this.eng=p.eng;this.engRev++;}
  if(p.hands)this.hands=p.hands;
  if(p.full)this.page={};
  if(p.page){Object.assign(this.page,p.page);this.pageRev++;}
  if(p.ev)for(const e of p.ev){const d=decodeEvent(e);if(d)this.events.push(d);}
  if(this.events.length>20)this.events.splice(0,this.events.length-20);
  if(p.on!==undefined)this.on=p.on;
  if(p.keep!==undefined){this.keep=p.keep;this.board.setKeep(p.keep,now);}
  if(p.ink)applyInkOps(this.board,this.strokes,p.ink,now);
  this.changed();
 }
}

/** Moves toward the broadcast between messages, so 15 updates a second read as continuous motion. */
export function smoothHands(shown:Map<number,TrackedHand>,targets:TrackedHand[],dt:number){
 const k=1-Math.exp(-dt*28),out:TrackedHand[]=[];
 for(const id of [...shown.keys()])if(!targets.some(t=>t.id===id))shown.delete(id);
 for(const t of targets){
  const old=shown.get(t.id);
  if(!old||old.landmarks.length!==t.landmarks.length){shown.set(t.id,t);out.push(t);continue;}
  const landmarks=t.landmarks.map((p,i)=>({x:old.landmarks[i].x+(p.x-old.landmarks[i].x)*k,y:old.landmarks[i].y+(p.y-old.landmarks[i].y)*k,z:old.landmarks[i].z+(p.z-old.landmarks[i].z)*k}));
  const mean=(ids:number[])=>({x:ids.reduce((n,i)=>n+landmarks[i].x,0)/ids.length,y:ids.reduce((n,i)=>n+landmarks[i].y,0)/ids.length,z:ids.reduce((n,i)=>n+landmarks[i].z,0)/ids.length});
  const next:TrackedHand={...t,landmarks,palm:mean([0,5,9,13,17]),indexTip:{...landmarks[8]},pinch:mean([4,8])};
  shown.set(t.id,next);out.push(next);
 }
 return out;
}
