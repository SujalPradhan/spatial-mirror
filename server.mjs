import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {attachControlRelay} from './control-relay.mjs';

const port = Number(process.env.PORT || 4173);
const production = process.argv.includes('--production');
const dist = fileURLToPath(new URL('./dist/',import.meta.url));
const token = randomBytes(18).toString('hex');
const started = Date.now();
let vite = null;
const server = http.createServer((req, res) => {
  res.setHeader('Permissions-Policy', 'accelerometer=(self), gyroscope=(self), magnetometer=(self), camera=(self), microphone=(self)');
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/api/session' || req.url === '/api/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/session'
      ? { token, port, phoneUrl: `http://localhost:${port}/phone?session=${token}` }
      : { started, ...coordinator.status }));
    return;
  }
  if(vite) vite.middlewares(req,res);
  else void serveBuilt(req,res);
});
if(!production) vite=await createServer({cacheDir:`node_modules/.vite-${port}`,server:{middlewareMode:true,port,hmr:false,forwardConsole:false,ws:{server,clientPort:port}},appType:'spa'});
async function serveBuilt(req,res){
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const route=['/','/cone','/cylinder','/cube','/lab','/phone','/mechanism','/mechanism/phone','/mechanism/box','/mechanism/box/phone','/art','/maths','/phone/lab','/tracking','/atp','/atp/','/pottery'].includes(path)?'index.html':path.slice(1);
    const file=resolve(dist,route);
    if(!file.startsWith(resolve(dist)+sep)||(req.method!=='GET'&&req.method!=='HEAD')){res.writeHead(404);res.end();return;}
    const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.ttf':'font/ttf','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.wav':'audio/wav','.webm':'video/webm'};
    res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Content-Length',info.size);
    if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }catch{res.writeHead(404);res.end('Not found. Run npm run build before npm start.');}
}
const coordinator=attachControlRelay(server,{token,port});
server.listen(port, '127.0.0.1', () => {
  console.log(`\nSection Studio: http://localhost:${port}\nPhone: npm run phone\nLocal-only diagnostic server.\n`);
});
async function shutdown() {
  coordinator.close(); await vite?.close(); server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
