import {randomBytes} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {createControlRoom} from './control-room.mjs';
export function attachControlRelay(server,{token,port}){
 const wss=new WebSocketServer({noServer:true,maxPayload:128*1024}),room=createControlRoom();
 room.watchCode=randomBytes(9).toString('hex');
 server.on('upgrade',(req,socket,head)=>{
  const url=new URL(req.url,`http://localhost:${port}`),role=url.searchParams.get('role');
  if(url.pathname!=='/control-stream')return;
  const allowed=url.searchParams.get(role==='viewer'?'watch':'session')===(role==='viewer'?room.watchCode:token);
  if(!allowed||![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin)){socket.destroy();return;}
  wss.handleUpgrade(req,socket,head,ws=>room.connect(ws,role));
 });
 return {get status(){return room.status;},close(){room.close();wss.close();}};
}
