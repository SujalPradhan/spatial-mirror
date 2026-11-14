import test from 'node:test';
import assert from 'node:assert/strict';
import {AtpEngine} from '../src/atp/engine';
import {AtomEngine} from '../src/atom/engine';
import {HOLD_SCALE,defaultSettings,keyLabel,loadSettings,matchKey,motionReduced,saveSettings,textGate} from '../src/mirror/a11y';
import type {AtpViewState,AtpWorld,GestureFrame,MirrorPoint} from '../src/atp/contracts';

const key=(k:string,shift=false)=>({key:k,shiftKey:shift,ctrlKey:false,altKey:false,metaKey:false});
const DT=1/60,frame:GestureFrame={at:1,hands:[],events:[]};
function atp(){
 const world:AtpWorld={partCount:22,mirrorToWorld:(p:MirrorPoint)=>({x:(p.x-.5)*10,y:(.5-p.y)*10,z:0}),partAt:()=>-1,partInfo:i=>({id:'F',name:i<3?'ATP synthase subunit beta':'ATP synthase subunit c',component:'head',residues:458}),headPoint:()=>({x:0,y:2,z:0})};
 const engine=new AtpEngine(world),view:AtpViewState={q:[0,0,0,1],zoom:1,x:0,y:0};
 return {engine,view,step:(n=1)=>{let out=engine.step(frame,DT,view,false);for(let i=1;i<n;i++)out=engine.step(frame,DT,view,false);return out;}};
}

test('keys match with their modifiers, and shift is ignored only for punctuation',()=>{
 assert.equal(matchKey(key('n'),'n'),true);
 assert.equal(matchKey(key('N',true),'n'),false);
 assert.equal(matchKey(key('N',true),'shift+n'),true);
 assert.equal(matchKey(key('?',true),'?'),true);
 assert.equal(matchKey(key('='),'+|='),true);
 assert.equal(matchKey(key(' '),'space'),true);
 assert.equal(matchKey(key(' ',true),'space'),false);
 assert.equal(matchKey(key(' ',true),'shift+space'),true);
 assert.equal(matchKey({...key('n'),ctrlKey:true},'n'),false);
 assert.equal(matchKey({...key('ArrowLeft')},'arrowleft'),true);
 assert.equal(keyLabel('shift+n'),'Shift+N');assert.equal(keyLabel('+|='),'+ or =');assert.equal(keyLabel('arrowup'),'Up arrow');
});

test('settings default, round-trip and survive bad or missing storage',()=>{
 const data:Record<string,string>={},store={getItem:(k:string)=>data[k]??null,setItem:(k:string,v:string)=>{data[k]=v;}};
 assert.deepEqual(loadSettings(store),defaultSettings());
 const next={...defaultSettings(),oneHanded:true,hold:'long' as const,tracking:false,reducedMotion:true};
 saveSettings(store,next);assert.deepEqual(loadSettings(store),next);
 store.setItem('mirror-settings-v1','{"hold":"forever","oneHanded":"yes","tracking":3}');assert.deepEqual(loadSettings(store),defaultSettings());
 store.setItem('mirror-settings-v1','not json');assert.deepEqual(loadSettings(store),defaultSettings());
 assert.deepEqual(loadSettings(null),defaultSettings());
 assert.doesNotThrow(()=>saveSettings({getItem:()=>null,setItem:()=>{throw new Error('full');}},next));
 assert.equal(motionReduced(defaultSettings(),true),true);assert.equal(motionReduced({...defaultSettings(),reducedMotion:false},true),false);
 assert.ok(HOLD_SCALE.short<HOLD_SCALE.normal&&HOLD_SCALE.normal<HOLD_SCALE.long);
});

test('the summary gate lets a changed line through at most once per interval',()=>{
 const gate=textGate(1500);
 assert.equal(gate('a',0),'a');assert.equal(gate('a',2000),null);assert.equal(gate('b',500),null);assert.equal(gate('b',1600),'b');assert.equal(gate('c',3200),'c');
});

test('every ATP action changes the engine, and none does while frozen',()=>{
 const r=atp();r.step(5);const s=r.engine.liveScene;
 r.engine.stirBy(1);assert.ok(r.engine.speed>.5);
 r.engine.toggleSlice();r.step(30);assert.ok(s.slice.amount>.9);assert.equal(r.engine.slicing,true);r.engine.toggleSlice();r.step(30);assert.equal(s.slice.amount,0);
 r.engine.toggleParting();r.step(30);assert.equal(s.fields.length,1);assert.ok(s.fields[0].strength>.9);r.engine.toggleParting();r.step(60);assert.equal(s.fields.length,0);
 const skin=s.skin;r.engine.cycleSkin();assert.notEqual(s.skin,skin);
 r.engine.toggleTear();r.step(90);assert.ok(s.explode>.9);assert.equal(r.engine.tornApart,true);r.engine.toggleTear();r.step(150);assert.equal(s.explode,0);assert.equal(r.engine.tornApart,false);
 r.engine.shock();assert.equal(r.step().scene.shocks.length,1);
 r.engine.pluckNext();r.step(10);assert.ok(Math.max(...Array.from(s.partOffsets).map(Math.abs))>0);
 const frozen=atp();frozen.step();const fs=frozen.engine.liveScene,speed=frozen.engine.speed;
 frozen.engine.step(frame,DT,frozen.view,true);
 frozen.engine.toggleSlice();frozen.engine.toggleTear();frozen.engine.toggleParting();frozen.engine.shock();frozen.engine.pluckNext();frozen.engine.stirBy(1);
 for(let i=0;i<30;i++)frozen.engine.step(frame,DT,frozen.view,true);
 assert.equal(fs.slice.amount,0);assert.equal(fs.explode,0);assert.equal(fs.fields.length,0);assert.equal(fs.shocks.length,0);assert.equal(frozen.engine.speed,speed);
});

test('a manual tear is taken over by a two-pinch tear and reset clears the toggles',()=>{
 const r=atp(),s=r.engine.liveScene;r.engine.toggleTear();r.engine.toggleSlice();r.engine.toggleParting();r.step(30);assert.ok(s.explode>.5);
 r.engine.reset();r.step(60);
 assert.equal(s.explode,0);assert.equal(r.engine.slicing,false);assert.equal(r.engine.parting,false);assert.equal(s.slice.amount,0);assert.equal(s.fields.length,0);
});

test('the beta-chain glow flashes at most three times a second at any rotor speed',()=>{
 const r=atp();r.step(2);
 let flashes=0,prev=0;
 // Hold the rotor at its top speed for ten seconds and count rising edges of the brightest beta chain.
 for(let t=0;t<60*10;t++){
  r.engine.kick(1);r.engine.kick(1);r.engine.kick(1);
  const out=r.engine.step(frame,DT,r.view,false),peak=Math.max(...[0,1,2].map(i=>out.scene.partGlow[i]));
  if(peak>.85&&prev<=.85)flashes++;prev=peak;
 }
 assert.ok(r.engine.speed>.9,'rotor is fast');
 assert.ok(flashes>=15,`flashes happen (${flashes})`);
 assert.ok(flashes<=31,`${flashes} flashes in 10s`);
});

test('Atom actions take an electron, step elements and tear',()=>{
 const world={partCount:12,mirrorToWorld:(p:MirrorPoint)=>({x:p.x,y:p.y,z:0}),partAt:()=>-1},engine=new AtomEngine(world),view:AtpViewState={q:[0,0,0,1],zoom:1,x:0,y:0};
 const run=(n:number)=>{for(let i=0;i<n;i++)engine.step(frame,DT,view,false);};
 run(60);const start=engine.element,total=engine.electrons;
 engine.toggleTake();run(90);assert.equal(engine.electrons,total-1);assert.equal(engine.taking,true);
 engine.toggleTake();run(180);assert.equal(engine.electrons,total);
 engine.next(1);run(120);assert.equal(engine.element,start+1);engine.next(-1);run(120);assert.equal(engine.element,start);
 engine.toggleTear();run(90);assert.ok(engine.atomScene.explode>.9);
 engine.shock();run(120);assert.equal(engine.element,start+1);
});
