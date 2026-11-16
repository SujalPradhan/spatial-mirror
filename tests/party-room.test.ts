import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Shared relay implementation is plain JavaScript for Node/Workers.
import {createPartyRoom,cleanState,cleanName,MAX_PLAYERS,validPartyCode,partyCode,normalPartyCode} from '../party-room.mjs';

class Sock {
 readyState=1;bufferedAmount=0;messages:any[]=[];closed:[number,string]|null=null;private handlers=new Map<string,Function[]>();
 send(raw:string){this.messages.push(JSON.parse(raw));}
 addEventListener(type:string,handler:Function){this.handlers.set(type,[...this.handlers.get(type)??[],handler]);}
 close(code=1000,reason=''){if(this.readyState===3)return;this.readyState=3;this.closed=[code,reason];for(const h of this.handlers.get('close')??[])h({});}
 raw(data:string){for(const h of this.handlers.get('message')??[])h({data});}
 say(p:Record<string,unknown>){this.raw(JSON.stringify({v:1,...p}));}
 of(type:string){return this.messages.filter(m=>m.type===type);}
 get last(){return this.messages.at(-1);}
}
let clock=0;
const fixture=(options={})=>{
 clock=1000;const room=createPartyRoom({now:()=>clock,...options}),host=new Sock();room.connect(host,{role:'host'});
 const join=(name?:string,resume?:string)=>{const s=new Sock();room.connect(s,{role:'player',name,resume});return s;};
 return {room,host,join};
};

test('a joining phone with no name gets an id, a fun name and a colour',()=>{
 const {host,join}=fixture(),a=join(),b=join();
 const wa=a.of('welcome')[0],wb=b.of('welcome')[0];clock+=300;join();
 assert.ok(wa.id&&wa.name.length>2&&/^#|^hsl/.test(wa.color)&&wa.resume);
 assert.notEqual(wa.id,wb.id);assert.notEqual(wa.color,wb.color);
 assert.equal(wa.host,true);
 assert.equal(host.of('hello').length,1);
 assert.deepEqual(host.last.players.map((p:any)=>p.id).slice(0,2),[wa.id,wb.id]);
});
test('names are trimmed, capped and stripped of markup characters',()=>{
 assert.equal(cleanName('  <b>Ada</b>   Lovelace  ','x'),'bAda/b Lovelace');
 assert.equal(cleanName('x'.repeat(80),'y').length,18);
 assert.equal(cleanName('\u0000\u0007',  'Fallback'),'Fallback');
 const {join}=fixture();assert.equal(join('  Zed  ').of('welcome')[0].name,'Zed');
});
test('no player limit below the safety cap: 60 phones join; the cap rejects the next',()=>{
 const {room,join}=fixture();const socks=Array.from({length:60},()=>join());
 assert.ok(socks.every(s=>s.of('welcome').length===1&&!s.closed));assert.equal(room.status.players,60);
 const small=fixture({maxPlayers:5}),five=Array.from({length:5},()=>small.join()),extra=small.join();
 assert.ok(five.every(s=>!s.closed));assert.deepEqual(extra.closed,[4008,'The room is full']);assert.equal(extra.of('welcome').length,0);
 assert.equal(MAX_PLAYERS,300);
});
test('a full room evicts an offline slot before refusing',()=>{
 const {join,room}=fixture({maxPlayers:2});const a=join(),b=join();a.close();
 const c=join();assert.equal(c.of('welcome').length,1);assert.equal(room.status.players,2);
 assert.equal(join().closed?.[0],4008);void b;
});
test('throws and shakes reach only the host, tagged with the server id',()=>{
 const {host,join}=fixture(),a=join(),b=join();
 a.say({type:'throw',from:'spoof'});b.say({type:'shake',p:.4});
 assert.deepEqual(host.of('throw').map(m=>m.from),[a.of('welcome')[0].id]);
 assert.deepEqual(host.of('shake').map(m=>({from:m.from,p:m.p})),[{from:b.of('welcome')[0].id,p:.4}]);
 assert.equal(a.of('throw').length+b.of('throw').length,0);
});
test('players cannot send catch or state, and unknown types are dropped',()=>{
 const {host,join}=fixture(),a=join(),b=join();
 a.say({type:'catch',to:b.of('welcome')[0].id,n:3});a.say({type:'state',state:{phase:'play'}});a.say({type:'roster',players:[]});a.say({type:'bogus'});
 assert.equal(b.of('catch').length,0);assert.equal(b.of('state').length,0);
 assert.equal(host.messages.filter(m=>!['hello','roster'].includes(m.type)).length,0);
 assert.equal(a.closed,null);
});
test('malformed messages: bad JSON and oversize close the socket; wrong version is ignored',()=>{
 const {host,join}=fixture(),a=join(),b=join(),c=join();
 a.raw('{nope');assert.equal(a.closed?.[0],1007);
 b.raw(JSON.stringify({v:1,type:'throw',pad:'x'.repeat(2000)}));assert.equal(b.closed?.[0],1009);
 c.raw(JSON.stringify({v:2,type:'throw'}));c.raw('[]');c.raw('null');c.raw(JSON.stringify({v:1}));assert.equal(c.closed,null);
 assert.equal(host.of('throw').length,0);
});
test('a throw flood is throttled per player',()=>{
 const {host,join}=fixture(),a=join(),b=join();
 for(let i=0;i<100;i++)a.say({type:'throw'});
 assert.ok(host.of('throw').length<=11,String(host.of('throw').length));
 b.say({type:'throw'});assert.equal(host.of('throw').filter(m=>m.from===b.of('welcome')[0].id).length,1);
 clock+=1000;a.say({type:'throw'});assert.ok(host.of('throw').length>=12);
});
test('catch and state fan out from the host only',()=>{
 const {host,join}=fixture(),a=join(),b=join(),ida=a.of('welcome')[0].id;
 host.say({type:'catch',to:ida,n:2});assert.deepEqual(a.of('catch'),[{v:1,type:'catch',n:2}]);assert.equal(b.of('catch').length,0);
 host.say({type:'catch',to:'nobody'});host.say({type:'catch',to:ida,n:9999});assert.equal(a.of('catch').length,2);assert.equal(a.of('catch')[1].n,1);
 host.say({type:'state',state:{phase:'play',atp:5,goal:100,left:42,extra:'x'}});
 for(const s of [a,b])assert.deepEqual(s.of('state').at(-1).state,{phase:'play',atp:5,goal:100,left:42});
 host.say({type:'state',to:ida,state:{phase:'play',team:'burn'}});assert.equal(a.of('state').at(-1).state.team,'burn');assert.notEqual(b.of('state').at(-1).state.team,'burn');
 host.say({type:'state',state:{phase:'hacked'}});host.say({type:'state',state:{phase:'play',atp:-1}});assert.equal(a.of('state').length,2);
 const late=join();assert.equal(late.of('state').at(-1).state.atp,5);
});
test('state validation allow-lists fields',()=>{
 assert.equal(cleanState({phase:'lobby'}).phase,'lobby');
 for(const bad of [null,[],{},{phase:'x'},{phase:'play',left:3601},{phase:'play',mode:'x'},{phase:'play',team:'red'},{phase:'play',make:5}])assert.equal(cleanState(bad),null,JSON.stringify(bad));
 assert.deepEqual(cleanState({phase:'play',mode:'tug',make:40,burn:60,evil:1}),{phase:'play',mode:'tug',make:40,burn:60});
});
test('an impostor socket cannot act as host once replaced',()=>{
 const {room,host,join}=fixture(),a=join();
 const next=new Sock();room.connect(next,{role:'host'});assert.equal(host.closed?.[0],4010);
 host.say({type:'catch',to:a.of('welcome')[0].id});assert.equal(a.of('catch').length,0);
 next.say({type:'catch',to:a.of('welcome')[0].id});assert.equal(a.of('catch').length,1);
 assert.equal(next.of('roster').at(-1).players.length,1);
});
test('host disconnect tells players; the host reconnecting restores the roster',()=>{
 const {room,host,join}=fixture(),a=join(),b=join();
 host.close();assert.equal(a.of('host').at(-1).on,false);assert.equal(room.status.host,false);
 const late=join();assert.equal(late.of('welcome')[0].host,false);
 const next=new Sock();room.connect(next,{role:'host'});assert.equal(a.of('host').at(-1).on,true);
 assert.equal(next.of('roster').at(-1).players.length,3);void b;
});
test('a player who reconnects keeps their id, name and colour',()=>{
 const {host,room,join}=fixture(),a=join(),w=a.of('welcome')[0];
 clock+=300;a.close();assert.equal(host.of('roster').at(-1).players[0].on,false);
 const again=join(undefined,w.resume),w2=again.of('welcome')[0];
 assert.deepEqual([w2.id,w2.name,w2.color],[w.id,w.name,w.color]);assert.equal(room.status.players,1);
 again.say({type:'throw'});assert.equal(host.of('throw').at(-1).from,w.id);
 const twin=join(undefined,w.resume);assert.equal(again.closed?.[0],4010);assert.equal(twin.of('welcome')[0].id,w.id);
 const stranger=join(undefined,'unknown-key');assert.notEqual(stranger.of('welcome')[0].id,w.id);
});
test('joins in a burst collapse roster updates',()=>{
 const {host,join}=fixture();const before=host.of('roster').length;
 for(let i=0;i<30;i++)join();
 assert.ok(host.of('roster').length-before<=2);
});
test('party codes: short, unambiguous and case-insensitive',()=>{
 for(let i=0;i<50;i++)assert.ok(validPartyCode(partyCode()));
 assert.equal(normalPartyCode('ab-c 23'),'ABC23');assert.equal(validPartyCode('ABCDO'),false);assert.equal(validPartyCode('ABCD'),false);
});
test('ping gets a pong',()=>{const {join}=fixture(),a=join();a.say({type:'ping'});assert.equal(a.of('pong').length,1);});
