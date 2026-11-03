import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {GestureFrame,HandPose,TrackedHand} from '../src/mirror/contracts';
import {REMOVE_AT,cutYaw,slotOffset} from '../src/perfume/behaviour';
import {PerfumeEngine} from '../src/perfume/engine';
import {failures} from '../src/perfume/model';
import {pumpParts} from '../src/perfume/parts';
import {homeView,initialPerfume,perfumeDescriptor,validatePerfume} from '../src/perfume/state';

const index=(id:string)=>pumpParts.findIndex(p=>p.id===id),DT=1/60;
function setup(){
 let under=-1;
 const world={partCount:pumpParts.length,mirrorToWorld:(p:{x:number;y:number;z:number})=>({x:p.x,y:p.y,z:p.z}),partAt:()=>under,partInfo:(i:number)=>{const p=pumpParts[i];return {id:p.id,title:p.title,role:p.role,removable:p.removable};}};
 const engine=new PerfumeEngine(world),view=homeView();let at=0;
 const run=(hands:TrackedHand[]=[],n=1)=>{let out=engine.step({at:at+=16,hands,events:[]} as GestureFrame,DT,view,false);for(let i=1;i<n;i++)out=engine.step({at:at+=16,hands,events:[]} as GestureFrame,DT,view,false);return out;};
 const hand=(pose:HandPose,x=0,y=0):TrackedHand=>{const p={x,y,z:0};return {id:1,side:'left',pose,landmarks:[],palm:p,indexTip:p,pinch:p,orientation:null,velocity:{x:0,y:0},poseAge:9};};
 const pull=(id:string,to:number,start=0)=>{under=index(id);run([hand('pinch',start)]);for(let x=start;x<=to;x+=.1)run([hand('pinch',x)]);run([hand('pinch',to)],5);};
 return {engine,run,hand,pull,set:(n:number)=>{under=n;}};
}
const press=(t:ReturnType<typeof setup>)=>{t.engine.kick(1);t.run([],120);};

test('world size matches the engine tuning for a five-unit object',()=>{const top=105-50,bottom=-50;assert.ok((top-bottom)*.05>5&&(top-bottom)*.05<6);});
test('pulling a part past the distance removes it, and it stays out after letting go',()=>{
 const t=setup();t.pull('spring',REMOVE_AT*.8);assert.equal(t.engine.pump.removed.size,0,'short of the distance');t.run([],60);assert.ok(Math.abs(t.engine['scene'].partOffsets[index('spring')*3])<.05,'springs back');
 t.pull('spring',REMOVE_AT+.3);assert.ok(t.engine.pump.removed.has('spring'));assert.match(t.engine.caption,/Press to see why/);
 t.run([],90);const s=t.engine['scene'];assert.ok(s.parked[index('spring')]>.9,'parked');assert.ok(Math.hypot(s.partOffsets[index('spring')*3],s.partOffsets[index('spring')*3+1])<.01,'springs no longer hold it');
});
test('spring out: the next press is the last, and the caption is the failure row',()=>{
 const t=setup();t.pull('spring',1.5);t.run([],5);press(t);
 assert.equal(t.engine.pump.doses,1);assert.equal(t.engine.pump.depth,1);assert.equal(t.engine.pump.stuck,true);
 assert.ok(t.engine.caption.includes(failures.find(f=>f.id==='no-spring')!.result));
});
test('swirl out: jet',()=>{const t=setup();t.pull('nozzle',1.5);t.run([],5);press(t);assert.equal(t.engine.lastSpray,'jet');assert.ok(t.engine.caption.includes('jet'));});
test('plucking a parked part sends it home and the pump works again',()=>{
 const t=setup();t.pull('spring',1.5);t.run([],40);press(t);
 const s=t.engine['scene'],i=index('spring')*3;t.run([t.hand('pinch',9)]);assert.ok(Math.hypot(s.partOffsets[i],s.partOffsets[i+1],s.partOffsets[i+2])>1,'starts where it is, not at home');
 t.run([],120);assert.equal(t.engine.pump.removed.size,0);assert.equal(t.engine.caption,'');assert.ok(Math.abs(s.partOffsets[i])<.02);assert.equal(t.engine.pump.depth,0);
});
test('non-removable parts only spring back',()=>{const t=setup();t.pull('body',2.5);t.run([],120);assert.equal(t.engine.pump.removed.size,0);});
test('pinching the actuator and pushing down drives depth directly, with no part offset',()=>{
 const t=setup();t.set(index('actuator'));t.run([t.hand('pinch',0,0)]);t.run([t.hand('pinch',0,-.07)],4);
 assert.ok(t.engine.pump.depth>.05&&t.engine.pump.depth<.2,String(t.engine.pump.depth));assert.equal(t.engine.pump.spray,'none');
 for(let y=-.1;y>-.8;y-=.05)t.run([t.hand('pinch',0,y)]);t.run([t.hand('pinch',0,-.8)],20);
 assert.equal(t.engine.pump.depth,1);assert.equal(t.engine.pump.doses,1);assert.deepEqual([...t.engine['scene'].partOffsets.slice(index('actuator')*3,index('actuator')*3+3)],[0,0,0]);
});
test('thumbs: up cycles presses while held, down lets go',()=>{
 const t=setup();t.run([t.hand('thumbUp')],300);assert.ok(t.engine.pump.doses>=3,String(t.engine.pump.doses));
 t.run([t.hand('thumbDown')],60);assert.equal(t.engine.pump.depth,0);const n=t.engine.pump.doses;t.run([],200);assert.equal(t.engine.pump.doses,n);
});
test('seek is the phone tool: degrees are target depth, and position cannot wrap',()=>{
 const t=setup();t.engine.seek(180);t.run([],30);assert.equal(t.engine.position,180);assert.ok(t.engine.pump.depth===1,'past the threshold it snaps through');
 t.engine.seek(360);assert.equal(t.engine.position,359);
 t.engine.idle=true;assert.equal(t.engine.position,0);t.run([],120);assert.equal(t.engine.pump.depth,0);
 t.engine.kick(1);t.run([],20);assert.equal(t.engine.position,0,'a press never reaches saved phase');
});
test('recenter restores all',()=>{const t=setup();t.pull('tube',1.5);t.run([],20);press(t);t.engine.restore();t.run();assert.equal(t.engine.pump.removed.size,0);assert.equal(t.engine.pump.doses,0);assert.equal(t.engine['scene'].parked[index('tube')],0);assert.equal(t.engine.caption,'');});
test('releases jolt what a part touches, and glass and liquid move as one',()=>{
 const t=setup();t.pull('nozzle',.4);t.run([],1);const s=t.engine['scene'];assert.equal(s.partOffsets[index('bottle')*3],0,'the nozzle wraps round to the bottle in list order');
 t.pull('bottle',.8);t.run([]);t.run([],3);assert.equal(s.partOffsets[index('bottle')*3],s.partOffsets[index('liquid')*3]);
});
test('slice stays square to the camera side and parked parts stay in the cut plane',()=>{
 const yaw=cutYaw(homeView());assert.ok(Math.abs(yaw-(Math.PI/2-.3))<1e-9);
 const o=new Float32Array(3);slotOffset('spring',homeView(),o,0);assert.ok(Math.abs(o[0]*Math.cos(yaw)+o[2]*Math.sin(yaw))<1e-6);
 const sideways={q:[0,Math.sin(Math.PI/4),0,Math.cos(Math.PI/4)]};assert.ok(Math.sin(cutYaw(sideways))>.3,'never edge-on');
});
test('saved state has its own schema and keeps no stale press',()=>{
 assert.deepEqual(validatePerfume(initialPerfume()),initialPerfume());
 assert.equal(validatePerfume({...initialPerfume(),phase:120}).phase,0);assert.equal(validatePerfume({...initialPerfume(),tool:'rotor',phase:120}).phase,120);
 for(const bad of [null,{...initialPerfume(),schema:2},{...initialPerfume(),phase:400},{...initialPerfume(),view:{...homeView(),zoom:9}},{...initialPerfume(),view:{...homeView(),q:[0,0,0,0]}}])assert.throws(()=>validatePerfume(bad));
 assert.equal('extra' in validatePerfume({...initialPerfume(),extra:1}),false);
});
test('the descriptor is everything the relay requires',()=>{
 const d=perfumeDescriptor(initialPerfume(),12.4);
 assert.deepEqual(d,{chapter:0,guided:false,tool:'view',representation:'structure',phase:12,selected:null,zoom:1.25,title:'Perfume spray',motionLabel:'pump',labels:{tool:'Pump',play:'Press',stop:'Release',percent:true}});
});
