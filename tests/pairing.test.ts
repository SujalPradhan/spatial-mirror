import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore The deployed Worker is intentionally plain JavaScript.
import {ControllerRoom} from '../relay/worker.mjs';
// @ts-ignore Shared protocol implementation.
import {freshInput} from '../control-room.mjs';

function fixture(meta:Record<string,unknown>){
 const values=new Map<string,unknown>([['meta',meta]]);
 const storage={get:async(k:string)=>values.get(k),put:async(k:string,v:unknown)=>{values.set(k,v);},deleteAll:async()=>values.clear(),setAlarm:async()=>{},transaction:async(fn:(s:any)=>Promise<unknown>)=>fn(storage)};
 let ready:Promise<unknown>=Promise.resolve();
 const state={storage,blockConcurrencyWhile(fn:()=>Promise<unknown>){return ready=ready.then(fn);}};
 const room=new ControllerRoom(state);return {room,values,ready:()=>ready};
}
const meta=()=>({code:'ABCDEFGH',host:'host-secret',phone:'phone-secret',paired:false,joinExpiresAt:Date.now()+60000,expiresAt:Date.now()+3600000});
test('freshness at either network hop blocks delayed holds/fine edits while retaining release',()=>{
 const at=10000;
 assert.ok(freshInput({type:'frame',hold:true,at},at+20));
 assert.equal(freshInput({type:'frame',hold:true,at},at+1500),null);
 assert.equal(freshInput({type:'action',action:'fine',value:55,at},at+1500),null);
 assert.equal(freshInput({type:'frame',hold:true,at},NaN),null);
 const release=freshInput({type:'frame',hold:false,active:true,visible:true,depth:1.5,at},at+1500);
 assert.equal(release.active,false);assert.equal(release.depth,undefined);assert.equal(release.stale,true);assert.equal(release.visibleAtCapture,true);
 const secondHop=freshInput(release,at+1600);assert.equal(secondHop.visibleAtCapture,true);assert.equal(secondHop.visible,false);
 assert.equal(freshInput({type:'frame',hold:false,active:true,visible:false,at},at+1500).visibleAtCapture,false);
 assert.ok(freshInput({type:'action',action:'freeze',at},at+1500));
});
test('discrete controller commands tolerate a round trip while live edits remain fresh',()=>{
 const at=10000;
 assert.ok(freshInput({type:'action',action:'math-annotate',at},at+650));
 assert.ok(freshInput({type:'action',action:'pottery-inspect',at},at+650));
 assert.equal(freshInput({type:'action',action:'math-annotate',at},at+1501),null);
 for(const action of['fine','depth','width','scrub'])assert.equal(freshInput({type:'action',action,at},at+650),null);
 assert.equal(freshInput({type:'frame',hold:true,at},at+650),null);
 assert.equal(freshInput({type:'action',action:'math-annotate',at},at-101),null);
});
test('expired join code does not invalidate the laptop session; full room expiry does',async()=>{
 const f=fixture({...meta(),joinExpiresAt:Date.now()-1});await f.ready();
 assert.equal((await f.room.fetch(new Request('https://internal/join',{method:'POST'}))).status,410);
 assert.equal((await f.room.fetch(new Request('https://internal/status',{headers:{Authorization:'Bearer host-secret'}}))).status,200);
 f.room.meta.expiresAt=Date.now()-1;
 assert.equal((await f.room.fetch(new Request('https://internal/status',{headers:{Authorization:'Bearer host-secret'}}))).status,410);
});
test('phone join returns only its own capability and revocation requires the host',async()=>{
 const f=fixture(meta());await f.ready();
 const joined=await f.room.fetch(new Request('https://internal/join',{method:'POST'}));const session=await joined.json();
 assert.equal(session.token,'phone-secret');assert.ok(!JSON.stringify(session).includes('host-secret'));
 assert.equal((await f.room.fetch(new Request('https://internal/join',{method:'POST'}))).status,409);
 assert.equal((await f.room.fetch(new Request('https://internal/status',{method:'DELETE',headers:{Authorization:'Bearer phone-secret'}}))).status,403);
 assert.equal((await f.room.fetch(new Request('https://internal/status',{method:'DELETE',headers:{Authorization:'Bearer host-secret'}}))).status,200);
 assert.equal((await f.room.fetch(new Request('https://internal/status',{headers:{Authorization:'Bearer phone-secret'}}))).status,410);
 await f.room.alarm();assert.equal(f.values.size,0);
});
