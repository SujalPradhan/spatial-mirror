import test from 'node:test';
import assert from 'node:assert/strict';
import {PartyGame,atpFor,degreesFor,RING,GOAL,ROUND_SECONDS,type PartyPlayer} from '../src/proton-party/game';
import {FlickDetector,SHAKE,motionSample,type MotionSample} from '../src/proton-party/flick';
import {HandThrow} from '../src/proton-party/hand-throw';
import {AtpEngine} from '../src/atp/engine';
import type {AtpWorld,MirrorPoint,GestureFrame,AtpViewState} from '../src/atp/contracts';
import {posedHand,type PoseName} from './hand-fixtures';

const people=(n:number,on=true):PartyPlayer[]=>Array.from({length:n},(_,i)=>({id:String(i+1),name:'P'+(i+1),color:'#fff',on}));
function rig(options:{rng?:()=>number;mode?:'make'|'tug';roundSeconds?:number;goal?:number}={},n=3){
 let t=1000;const game=new PartyGame({now:()=>t,...options});game.setRoster(people(n));
 return {game,advance:(ms:number)=>{t+=ms;},get t(){return t;}};
}

test('a c8 ring: 8 throws make one full turn and 3 ATP',()=>{
 const {game}=rig();game.start();
 const events=Array.from({length:8},()=>game.throw('1')).flat();
 assert.equal(game.steps,8);assert.equal(game.degrees,360);assert.equal(game.atp,3);
 assert.equal(events.filter(e=>e.type==='atp').length,3);
 assert.equal(RING,8);assert.deepEqual([0,1,2,3,4,8,16].map(atpFor),[0,0,0,1,1,3,6]);assert.equal(degreesFor(2),90);
});
test('the first ATP lands on the third throw, the second on the sixth',()=>{
 const {game}=rig();game.start();
 const at:number[]=[];for(let i=1;i<=8;i++)if(game.throw('1').some(e=>e.type==='atp'))at.push(i);
 assert.deepEqual(at,[3,6,8]);
});
test('throws only count while a round is running, and only from known players',()=>{
 const {game}=rig();assert.deepEqual(game.throw('1'),[]);game.start();assert.deepEqual(game.throw('999'),[]);assert.equal(game.steps,0);
 game.throw('1');assert.equal(game.stats.get('1')!.threw,1);
});
test('catch distribution favours recent throwers and skips offline players',()=>{
 const r=rig({rng:()=>0},3);r.game.start();
 const counts:Record<string,number>={1:0,2:0,3:0};let seed=7;const rng=()=>(seed=(seed*16807)%2147483647)/2147483647;
 const w=rig({rng},3);w.game.start();w.game.throw('1');
 for(let i=0;i<3000;i++)counts[w.game.pickCatcher()!]++;
 assert.ok(counts['1']>counts['2']*3&&counts['1']>counts['3']*3,JSON.stringify(counts));
 assert.ok(counts['2']>300&&counts['3']>300,'everyone still catches sometimes');
 w.advance(6000);const cold={1:0,2:0,3:0} as Record<string,number>;for(let i=0;i<3000;i++)cold[w.game.pickCatcher()!]++;
 assert.ok(Math.max(...Object.values(cold))<1300,'after the window nobody is favoured: '+JSON.stringify(cold));
 const off=rig({},3);off.game.setRoster([{...people(3)[0],on:false},{...people(3)[1],on:false},people(3)[2]]);
 for(let i=0;i<50;i++)assert.equal(off.game.pickCatcher(),'3');
 off.game.setRoster(people(3,false));assert.equal(off.game.pickCatcher(),null);
});
test('every ATP is caught by someone and counted',()=>{
 const {game}=rig({},4);game.start();for(let i=0;i<16;i++)game.throw(String(i%4+1));
 assert.equal(game.atp,6);assert.equal([...game.stats.values()].reduce((s,x)=>s+x.caught,0),6);
 const nobody=rig({},2);nobody.game.setRoster(people(2,false));nobody.game.start();assert.equal(nobody.game.throw('1').filter(e=>e.type==='atp').length,0+nobody.game.atp);
});
test('the round lasts 60 s then shows results with total ATP and the MVP',()=>{
 assert.equal(ROUND_SECONDS,60);
 const r=rig();r.game.start();assert.equal(r.game.left(),60);
 for(let i=0;i<5;i++)r.game.throw('2');for(let i=0;i<2;i++)r.game.throw('1');
 r.advance(59900);assert.deepEqual(r.game.tick(),[]);assert.equal(r.game.phase,'play');assert.equal(r.game.left(),1);
 r.advance(200);assert.deepEqual(r.game.tick(),[{type:'end',won:false}]);assert.equal(r.game.phase,'results');
 assert.equal(r.game.results!.atp,2);assert.equal(r.game.results!.mvp!.id,'2');assert.equal(r.game.results!.mvp!.threw,5);
 assert.deepEqual(r.game.throw('1'),[]);assert.deepEqual(r.game.tick(),[]);
 r.game.reset();r.game.start();assert.equal(r.game.steps,0);assert.equal(r.game.stats.get('2')!.threw,0);assert.equal(r.game.left(),60);
});
test('reaching 100 ATP ends the round early as a win',()=>{
 const {game}=rig();game.start();let end:any=null;
 for(let i=0;i<400&&!end;i++)end=game.throw('1').find(e=>e.type==='end');
 assert.equal(game.atp,GOAL);assert.deepEqual(end,{type:'end',won:true});assert.equal(game.phase,'results');assert.equal(game.results!.won,true);
});
test('a late joiner is added to the roster mid-round; a drop-out who never played leaves',()=>{
 const {game}=rig({},2);game.start();game.throw('1');
 game.setRoster([...people(2),{id:'9',name:'New',color:'#0f0',on:true}]);assert.ok(game.stats.has('9'));
 game.setRoster([people(2)[0]]);assert.ok(game.stats.has('1'));assert.equal(game.stats.has('9'),false);assert.ok(game.players.has('1'));
});

test('tug of war: teams are balanced and only Make throws, only Burn shakes',()=>{
 const {game}=rig({mode:'tug'},6);game.start('tug');
 const teams=[...game.teams.values()];assert.equal(teams.filter(t=>t==='make').length,3);assert.equal(teams.filter(t=>t==='burn').length,3);
 const make=[...game.teams].find(([,t])=>t==='make')![0],burn=[...game.teams].find(([,t])=>t==='burn')![0];
 assert.deepEqual(game.shake(make),[]);assert.deepEqual(game.throw(burn),[]);
 game.throw(make);assert.equal(game.steps,1);game.shake(burn);assert.equal(game.steps,0);
});
test('tug of war: the rotor goes whichever way the net force wins, and never below zero',()=>{
 const r=rig({mode:'tug'},4);r.game.start('tug');
 const make=[...r.game.teams].filter(([,t])=>t==='make').map(([id])=>id),burn=[...r.game.teams].filter(([,t])=>t==='burn').map(([id])=>id);
 for(let i=0;i<6;i++){r.game.throw(make[0]);r.advance(100);}
 for(let i=0;i<2;i++){r.game.shake(burn[0]);r.advance(100);}
 assert.equal(r.game.netDirection(),1);assert.ok(r.game.forces().make>r.game.forces().burn);assert.equal(r.game.steps,4);
 r.advance(4000);assert.deepEqual(r.game.forces(),{make:0,burn:0});assert.equal(r.game.netDirection(),0);
 for(let i=0;i<6;i++){r.game.shake(burn[1]);r.advance(100);}
 assert.equal(r.game.netDirection(),-1);assert.equal(r.game.steps,0,'burn spent all of the progress');assert.equal(r.game.atp,0);
 const back=rig({mode:'tug'},2);back.game.start('tug');const [m,b]=['make','burn'].map(t=>[...back.game.teams].find(([,x])=>x===t)![0]);
 for(let i=0;i<8;i++)back.game.throw(m);const peak=back.game.atp;for(let i=0;i<4;i++)back.game.shake(b);
 assert.equal(peak,3);assert.equal(back.game.steps,4);assert.equal(back.game.atp,1);
});
test('tug of war: burning ATP yields a negative ATP event; make wins by reaching the goal, burn by holding it off',()=>{
 const r=rig({mode:'tug',goal:3,roundSeconds:10},2);r.game.start('tug');
 const [m,b]=['make','burn'].map(t=>[...r.game.teams].find(([,x])=>x===t)![0]);
 for(let i=0;i<3;i++)r.game.throw(m);const ev=r.game.shake(b);assert.deepEqual(ev.filter(e=>e.type==='atp'),[{type:'atp',delta:-1,to:null}]);
 r.advance(10001);r.game.tick();assert.equal(r.game.results!.won,false);assert.equal(r.game.results!.burnMvp!.id,b);
 const w=rig({mode:'tug',goal:3},2);w.game.start('tug');const mk=[...w.game.teams].find(([,x])=>x==='make')![0];
 for(let i=0;i<8;i++)w.game.throw(mk);assert.equal(w.game.results!.won,true);
});
test('the engine really makes 3 ATP for 8 notches of 45 degrees, in step with the counter',()=>{
 const w:AtpWorld={partCount:22,mirrorToWorld:(p:MirrorPoint)=>({x:p.x,y:p.y,z:0}),partAt:()=>-1,partInfo:i=>({id:'F',name:i===2?'ATP synthase subunit beta':'ATP synthase subunit c',component:'head',residues:458}),headPoint:()=>({x:0,y:2,z:0})};
 const engine=new AtpEngine(w),view:AtpViewState={q:[0,0,0,1],zoom:1,x:0,y:0},frame:GestureFrame={at:1,hands:[],events:[]};
 engine.step(frame,1/60,view,false);
 const game=new PartyGame();game.setRoster(people(1));game.start();const seen:number[]=[];
 for(let i=1;i<=8;i++){game.throw('1');engine.seek(game.degrees);engine.step({...frame,at:i+1},1/60,view,false);seen.push(engine.atp-game.atp);}
 assert.deepEqual(seen,Array(8).fill(0));assert.equal(engine.atp,3);
 for(let i=0;i<4;i++){game.shake('1');}
});

const idle:MotionSample={t:0,rot:[0,0,0]};
const spin=(t:number,deg:number):MotionSample=>({t,rot:[deg,0,0]});
const fire=(d:FlickDetector,samples:MotionSample[])=>samples.filter(s=>d.feed(s)).map(s=>s.t);
test('flick: a quick wrist rotation fires once; rest and slow turns do not',()=>{
 const d=new FlickDetector();
 assert.deepEqual(fire(d,[idle,spin(16,30),spin(32,90),spin(48,150),spin(64,200),spin(80,60),spin(96,0)]),[]);
 assert.deepEqual(fire(d,[spin(200,100),spin(216,320),spin(232,480),spin(248,300),spin(264,40)]),[216]);
 assert.equal(d.source,'gyro');
});
test('flick: no double fire inside the 250 ms refractory period, even if the signal dips and spikes again',()=>{
 const d=new FlickDetector();
 assert.deepEqual(fire(d,[spin(0,400),spin(16,10),spin(100,420),spin(116,0),spin(200,500)]),[0]);
 assert.deepEqual(fire(d,[spin(260,10),spin(300,400)]),[300],'after the refractory period and a rest it arms again');
});
test('flick: a long continuous shake does not machine-gun',()=>{
 const d=new FlickDetector(),shots=fire(d,Array.from({length:120},(_,i)=>spin(i*16,300+Math.sin(i)*40)));
 assert.equal(shots.length,1);
});
test('flick: the rotation axis does not matter and the gyro beats the accelerometer',()=>{
 for(const rot of [[0,350,0],[0,0,350],[200,200,200]] as const)assert.equal(fire(new FlickDetector(),[{t:0,rot:[0,0,0]},{t:16,rot:rot}]).length,1);
 const both:MotionSample={t:16,rot:[10,0,0],lin:[40,0,0]};assert.equal(new FlickDetector().feed(both),false);
});
test('flick: falls back to acceleration, with or without gravity, and ignores missing or broken data',()=>{
 const lin=fire(new FlickDetector(),[{t:0,lin:[0,0,0]},{t:16,lin:[0,25,0]}]);assert.equal(lin.length,1);
 const grav=new FlickDetector();assert.equal(grav.feed({t:0,grav:[0,9.81,0]}),false);assert.equal(grav.feed({t:16,grav:[0,30,5]}),true);assert.equal(grav.source,'accel');
 const d=new FlickDetector();for(const bad of [{t:0},{t:1,rot:[NaN,0,0]},{t:2,rot:null,lin:null},{t:NaN,rot:[900,0,0]}] as MotionSample[])assert.equal(d.feed(bad),false);
 assert.deepEqual(motionSample({rotationRate:{alpha:null,beta:null,gamma:null},acceleration:{x:1,y:2,z:3}},5),{t:5,rot:null,lin:[1,2,3],grav:null});
 assert.deepEqual(motionSample({rotationRate:{alpha:1,beta:2,gamma:3}},5).rot,[1,2,3]);
});
test('shake detector reacts to gentler, quicker motion than a flick',()=>{
 const flick=new FlickDetector(),shake=new FlickDetector(SHAKE);
 assert.equal(flick.feed(spin(0,170)),false);assert.equal(shake.feed(spin(0,170)),true);
 assert.deepEqual(fire(shake,[spin(10,0),spin(200,200),spin(210,0),spin(400,200)]),[200,400]);
});

const handAt=(pose:PoseName,x=.5,y=.6)=>posedHand(pose).map(p=>({x:x+p.x*.14*.75,y:y+p.y*.14,z:p.z*.14}));
test('hand throw: squeeze into a fist, then open, throws exactly once',()=>{
 const h=new HandThrow();const out:boolean[]=[];let t=0;
 for(const pose of ['open','open','fist','fist','fist','fist','open','open','open'] as PoseName[]){out.push(h.feed([handAt(pose)],t));t+=60;}
 assert.deepEqual(out,[false,false,false,false,false,false,true,false,false]);
});
test('hand throw: an open hand alone, a flicker of fist, a lost hand and a double open do not throw',()=>{
 const h=new HandThrow();let t=0;const f=(hands:any,gap=60)=>{const r=h.feed(hands,t);t+=gap;return r;};
 assert.equal(f([handAt('open')]),false);assert.equal(f([handAt('fist')]),false);assert.equal(f([handAt('open')]),false,'a single fist frame is not a squeeze');
 f([handAt('fist')]);f([handAt('fist')]);f([handAt('fist')]);assert.equal(f([],700),false);assert.equal(f([handAt('open')]),false,'the fist was forgotten while the hand was gone');
 f([handAt('fist')]);f([handAt('fist')]);f([handAt('fist')]);assert.equal(f([handAt('open')]),true);
 f([handAt('fist')]);f([handAt('fist')]);f([handAt('fist')],30);assert.equal(f([handAt('open')]),false,'inside the refractory period');
 assert.equal(h.feed([[]],t),false);
});
test('hand throw: only fist to open works; a pinch alone and a held fist do not',()=>{
 const h=new HandThrow();let t=0;const out:boolean[]=[];
 for(const pose of ['pinch','pinch','point','victory','thumbUp'] as PoseName[]){out.push(h.feed([handAt(pose)],t));t+=60;}
 for(let i=0;i<30;i++){out.push(h.feed([handAt('fist')],t));t+=60;}
 assert.equal(out.some(Boolean),false);
});
test('hand throw: one loose finger during the squeeze is not a release',()=>{
 const h=new HandThrow();let t=0;const out:boolean[]=[];
 for(const pose of ['fist','fist','fist','point','fist','open'] as PoseName[]){out.push(h.feed([handAt(pose)],t));t+=60;}
 assert.deepEqual(out,[false,false,false,false,false,true]);
});
test('hand throw: works on a portrait frame when given its real aspect',()=>{
 const portrait=.75,at=(pose:PoseName)=>posedHand(pose).map(p=>({x:.5+p.x*.14/portrait,y:.6+p.y*.14,z:p.z*.14}));
 const h=new HandThrow();let t=0;const out:boolean[]=[];
 for(const pose of ['open','fist','fist','fist','open'] as PoseName[]){out.push(h.feed([at(pose)],t,portrait));t+=60;}
 assert.deepEqual(out,[false,false,false,false,true]);
 const wide=new HandThrow(),w=(pose:PoseName)=>posedHand(pose).map(p=>({x:.5+p.x*.14*.75,y:.6+p.y*.14,z:p.z*.14}));
 const seq:boolean[]=[];t=0;for(const pose of ['fist','fist','fist','open'] as PoseName[]){seq.push(wide.feed([w(pose)],t,4/3));t+=60;}
 assert.deepEqual(seq,[false,false,false,true]);
});
