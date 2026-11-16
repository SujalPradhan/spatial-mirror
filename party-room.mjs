export const MAX_PLAYERS=300,MAX_MESSAGE=1024,MAX_NAME=18;
const ROSTER_GAP_MS=250,BUCKET_BURST=10,BUCKET_PER_SEC=12;
const PALETTE=['#ff4d6d','#ffb703','#2ee6a6','#3aa8ff','#c77dff','#ff7b00','#00e5ff','#b8f400','#ff5fd2','#ffe14d','#6c8cff','#ff8fa3'];
const ADJECTIVES=['Zippy','Fizzy','Turbo','Sunny','Bouncy','Spicy','Zappy','Mighty','Wiggly','Cosmic','Jolly','Speedy','Sparky','Funky','Giga','Peppy'];
const ANIMALS=['Otter','Panda','Gecko','Llama','Koala','Falcon','Narwhal','Tiger','Pigeon','Yak','Newt','Moose','Fox','Wombat','Dingo','Lemur'];
export const colourFor=n=>n<PALETTE.length?PALETTE[n]:`hsl(${Math.round((n*137.508)%360)} 90% 60%)`;
export const funName=n=>`${ADJECTIVES[n%ADJECTIVES.length]} ${ANIMALS[Math.floor(n/ADJECTIVES.length+n)%ANIMALS.length]}`;
export function cleanName(value,fallback){
 const name=String(value??'').replace(/[\u0000-\u001f\u007f<>&"]/g,'').replace(/\s+/g,' ').trim().slice(0,MAX_NAME);
 return name||fallback;
}
const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
const int=(n,a,b)=>Number.isInteger(n)&&n>=a&&n<=b;
const phases=new Set(['lobby','play','results']),modes=new Set(['make','tug']),teams=new Set(['make','burn']);
/** Allow-listed game state a host may send; anything else is dropped. */
export function cleanState(s){
 if(!isObject(s)||!phases.has(s.phase))return null;
 const out={phase:s.phase};
 for(const [key,max] of [['atp',99999],['goal',99999],['left',3600]])if(s[key]!==undefined){if(!int(s[key],0,max))return null;out[key]=s[key];}
 if(s.mode!==undefined){if(!modes.has(s.mode))return null;out.mode=s.mode;}
 if(s.team!==undefined){if(!teams.has(s.team))return null;out.team=s.team;}
 if(s.make!==undefined||s.burn!==undefined){if(!int(s.make,0,100)||!int(s.burn,0,100))return null;out.make=s.make;out.burn=s.burn;}
 return out;
}
const randomKey=()=>Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join('');

/**
 * Fan-out only: the host owns game state. The room assigns ids, names and colours,
 * relays throws to the host, and relays the host's catches and state to players.
 * Works with Node ws sockets and Cloudflare WebSockets.
 */
export function createPartyRoom({maxPlayers=MAX_PLAYERS,now=()=>Date.now()}={}){
 const players=new Map(),bySocket=new Map();
 let host=null,counter=0,lastState=null,rosterTimer=null,rosterAt=-Infinity,rosterDirty=false;
 const send=(ws,p)=>{if(ws?.readyState===1&&(ws.bufferedAmount??0)<256*1024)ws.send(JSON.stringify({v:1,...p}));};
 const roster=()=>({type:'roster',players:[...players.values()].map(p=>({id:p.id,name:p.name,color:p.color,on:!!p.ws}))});
 const pushRoster=()=>{
  rosterDirty=false;rosterAt=now();send(host,roster());
 };
 // Many joins in a burst collapse into one roster message.
 const touchRoster=()=>{
  if(!host)return;
  if(now()-rosterAt>=ROSTER_GAP_MS){pushRoster();return;}
  rosterDirty=true;
  if(!rosterTimer)rosterTimer=setTimeout(()=>{rosterTimer=null;if(rosterDirty)pushRoster();},ROSTER_GAP_MS);
 };
 const hostPresence=on=>{for(const p of players.values())send(p.ws,{type:'host',on});};
 const evictOffline=()=>{
  let oldest=null;for(const p of players.values())if(!p.ws&&(!oldest||p.seen<oldest.seen))oldest=p;
  if(oldest){players.delete(oldest.id);return true;}return false;
 };
 function parse(ws,raw){
  const text=String(raw);
  if(text.length>MAX_MESSAGE){ws.close(1009,'Message too large');return null;}
  let p;try{p=JSON.parse(text);}catch{ws.close(1007,'Invalid JSON');return null;}
  if(!isObject(p)||p.v!==1||typeof p.type!=='string')return null;
  return p;
 }
 function connectHost(ws){
  if(host&&host!==ws)host.close(4010,'Another host took over');
  host=ws;
  send(ws,{type:'hello',role:'host'});pushRoster();hostPresence(true);
  ws.addEventListener('message',({data})=>{
   if(host!==ws)return;
   const p=parse(ws,data);if(!p)return;
   if(p.type==='catch'){
    const to=players.get(String(p.to));if(!to?.ws)return;
    send(to.ws,{type:'catch',n:int(p.n,1,50)?p.n:1});
   }else if(p.type==='state'){
    const state=cleanState(p.state);if(!state)return;
    if(p.to===undefined){lastState=state;for(const player of players.values())send(player.ws,{type:'state',state});}
    else{const to=players.get(String(p.to));if(to?.ws)send(to.ws,{type:'state',state});}
   }
  });
  ws.addEventListener('close',()=>{if(host===ws){host=null;hostPresence(false);}});
  return true;
 }
 function connectPlayer(ws,{name,resume}={}){
  let player=null;
  if(typeof resume==='string'&&resume){for(const p of players.values())if(p.key===resume){player=p;break;}}
  if(player){if(player.ws&&player.ws!==ws){bySocket.delete(player.ws);player.ws.close(4010,'Joined from another tab');}}
  else{
   if(players.size>=maxPlayers&&!evictOffline()){ws.close(4008,'The room is full');return false;}
   const n=counter++;
   player={id:String(n+1),name:cleanName(name,funName(n)),color:colourFor(n),key:randomKey(),tokens:BUCKET_BURST,refill:now(),seen:now(),ws:null};
   players.set(player.id,player);
  }
  player.ws=ws;player.seen=now();bySocket.set(ws,player);
  send(ws,{type:'welcome',id:player.id,name:player.name,color:player.color,resume:player.key,host:!!host});
  if(lastState)send(ws,{type:'state',state:lastState});
  touchRoster();
  ws.addEventListener('message',({data})=>{
   if(bySocket.get(ws)!==player)return;
   const t=now();player.tokens=Math.min(BUCKET_BURST,player.tokens+(t-player.refill)/1000*BUCKET_PER_SEC);player.refill=t;
   const p=parse(ws,data);if(!p)return;
   if(p.type!=='throw'&&p.type!=='shake'&&p.type!=='ping')return;
   if(p.type==='ping'){send(ws,{type:'pong'});return;}
   if(player.tokens<1)return;player.tokens--;player.seen=t;
   if(p.type==='throw')send(host,{type:'throw',from:player.id});
   else send(host,{type:'shake',from:player.id,p:typeof p.p==='number'&&p.p>=0&&p.p<=1?Math.round(p.p*100)/100:1});
  });
  ws.addEventListener('close',()=>{
   if(bySocket.get(ws)===player){bySocket.delete(ws);player.ws=null;player.seen=now();touchRoster();}
  });
  return true;
 }
 function connect(ws,{role,name,resume}={}){
  if(role==='host')return connectHost(ws);
  if(role==='player')return connectPlayer(ws,{name,resume});
  ws.close(4001,'Invalid connection');return false;
 }
 return {
  connect,
  get status(){let online=0;for(const p of players.values())if(p.ws)online++;return {players:players.size,online,host:!!host,full:players.size>=maxPlayers};},
  close(code=1001,reason='Room closed'){
   if(rosterTimer){clearTimeout(rosterTimer);rosterTimer=null;}
   for(const ws of [host,...[...players.values()].map(p=>p.ws)])ws?.close(code,reason);
  },
 };
}

export const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normalPartyCode=value=>String(value??'').toUpperCase().replace(/[-\s]/g,'');
export const validPartyCode=value=>/^[A-HJ-NP-Z2-9]{5}$/.test(value);
export const partyCode=()=>Array.from(globalThis.crypto.getRandomValues(new Uint8Array(5)),n=>CODE_ALPHABET[n&31]).join('');
export const partySecret=()=>Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join('');
