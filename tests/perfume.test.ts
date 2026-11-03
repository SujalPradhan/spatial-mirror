import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeFailures,createPump,DOSE_ML,DOSE_RANGE_ML,failures,liquidY,setRemoved,stepPump,THRESHOLD_DEPTH,TUBE_END_ML,type PumpOptions,type PumpPhase,type PumpState,type Spray} from '../src/perfume/model';
import {dims,partById,pumpParts} from '../src/perfume/parts';
const DT=1/60;
interface Run {phases:PumpPhase[];sprays:Set<Spray>;peak:number}
function press(s:PumpState,o:{down?:number;peak?:number;hold?:number;settle?:number}={}):Run {
 const down=o.down??.08,peak=o.peak??1,hold=o.hold??.2,settle=o.settle??1.2,run:Run={phases:[],sprays:new Set(),peak:0};
 const frame=(target:number)=>{stepPump(s,target,DT);if(run.phases.at(-1)!==s.phase)run.phases.push(s.phase);run.sprays.add(s.spray);run.peak=Math.max(run.peak,s.pressureBar);};
 for(let t=0;t<down;t+=DT)frame(peak*Math.min(1,(t+DT)/down));
 for(let t=0;t<hold;t+=DT)frame(peak);
 for(let t=0;t<settle;t+=DT)frame(0);
 run.sprays.delete('none');
 return run;
}
const pump=(o?:PumpOptions)=>createPump(o);
const near=(a:number,b:number,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);

test('one press is one full cycle in order, and ends where it began',()=>{
 const s=pump(),r=press(s);
 assert.deepEqual(r.phases,['compress','threshold','spray','return','refill','rest']);
 assert.deepEqual([...r.sprays],['mist']);
 assert.equal(s.doses,1);near(s.dispensedMl,DOSE_ML,1e-3);near(s.depth,0);near(s.chamberFill,1,1e-3);near(s.pressureBar,0,.02);
});
test('the dose is inside the quoted range and the geometry sweeps it',()=>{
 assert.ok(DOSE_ML>=DOSE_RANGE_ML[0]&&DOSE_ML<=DOSE_RANGE_ML[1]);
 const swept=Math.PI*dims.barrelR**2*dims.strokeMm*(1-THRESHOLD_DEPTH)/1000;
 assert.ok(Math.abs(swept-DOSE_ML)/DOSE_ML<.08,`swept ${swept}`);
});
test('pressure rises with travel and nothing leaves before the threshold',()=>{
 const s=pump();let last=0;
 for(const d of [.05,.1,.15,.2,.25]){stepPump(s,d,.1);assert.ok(s.pressureBar>last);last=s.pressureBar;assert.equal(s.spray,'none');assert.equal(s.dispensedMl,0);assert.equal(s.phase,'compress');}
 const r=press(s,{down:.016,peak:.25,hold:.1});
 assert.equal(s.dispensedMl,0);assert.equal(r.sprays.size,0);assert.equal(s.chamberFill,1);assert.equal(s.doses,0);assert.equal(s.phase,'rest');
});
test('with pre-compression soft and hard presses spray alike',()=>{
 const hard=pump(),soft=pump(),a=press(hard,{down:.07}),b=press(soft,{down:1.4,peak:.45,hold:.4});
 assert.deepEqual([...a.sprays],['mist']);assert.deepEqual([...b.sprays],['mist']);
 near(hard.dispensedMl,soft.dispensedMl,1e-3);assert.equal(soft.doses,1);near(a.peak,b.peak,1e-6);
});
test('without pre-compression a soft or partial press dribbles and a hard one sprays',()=>{
 const hard=pump({precompression:false}),soft=pump({precompression:false}),part=pump({precompression:false});
 assert.ok(press(hard,{down:.08}).sprays.has('mist'));
 assert.deepEqual([...press(soft,{down:1.5}).sprays],['dribble']);
 assert.deepEqual([...press(part,{down:.6,peak:.4}).sprays],['dribble']);
 assert.ok(part.dispensedMl<DOSE_ML*.6);assert.equal(part.doses,0);
 near(part.chamberFill,1,1e-3);
});
test('failure: swirl insert removed gives a jet, and putting it back restores mist',()=>{
 const s=pump({removed:['nozzle']});
 assert.deepEqual([...press(s).sprays],['jet']);
 setRemoved(s,'nozzle',false);
 assert.deepEqual([...press(s).sprays],['mist']);
});
test('failure: ball valve removed, chamber does not refill and liquid falls back',()=>{
 const s=pump(),start=s.liquidMl;setRemoved(s,'ball',true);
 const r=press(s);
 assert.equal(r.sprays.size,0);assert.equal(s.doses,0);assert.equal(s.dispensedMl,0);
 for(let i=0;i<300;i++)stepPump(s,0,DT);
 near(s.chamberFill,0);assert.ok(s.tubeFill<.5);near(s.liquidMl,start+DOSE_ML,1e-6);
 const peak=(()=>{const q=pump({removed:['ball']});let top=0,fill=0;for(let i=0;i<30;i++)stepPump(q,Math.min(1,i/5),DT);for(let i=0;i<40;i++){stepPump(q,0,DT);top=Math.max(top,q.chamberFill);fill=top;}return fill;})();
 assert.ok(peak<=.31,`refilled to ${peak}`);
 setRemoved(s,'ball',false);
 press(s);press(s);near(s.chamberFill,1,1e-3);assert.ok(s.tubeFill>.5);assert.deepEqual([...press(s).sprays],['mist']);
});
test('failure: ball valve removed without pre-compression can only dribble',()=>{
 const s=pump({removed:['ball'],precompression:false});
 assert.deepEqual([...press(s,{down:.08}).sprays],['dribble']);
 assert.ok(s.dispensedMl<DOSE_ML*.5);assert.equal(s.doses,0);
});
test('failure: spring removed, actuator stays down with no refill',()=>{
 const s=pump({removed:['spring']}),r=press(s);
 assert.deepEqual([...r.sprays],['mist']);assert.equal(s.doses,1);
 near(s.depth,1);assert.ok(s.stuck);near(s.chamberFill,0);
 const again=press(s);
 assert.equal(again.sprays.size,0);assert.equal(s.doses,1);near(s.depth,1);
 setRemoved(s,'spring',false);
 for(let i=0;i<120;i++)stepPump(s,0,DT);
 near(s.depth,0);assert.equal(s.stuck,false);near(s.chamberFill,1,1e-3);
});
test('failure: liquid below the dip-tube end sputters once the primed dose is gone',()=>{
 const s=pump({liquidMl:TUBE_END_ML-.2});
 assert.deepEqual([...press(s).sprays],['mist']);
 assert.deepEqual([...press(s).sprays],['sputter']);
 assert.equal(s.doses,1);
 assert.ok(activeFailures(s).some(f=>f.id==='low-liquid'&&f.basis==='illustrative'));
});
test('failure: dip tube removed draws only air',()=>{
 const s=pump({removed:['tube']}),before=s.liquidMl;
 press(s);
 assert.deepEqual([...press(s).sprays],['sputter']);
 near(s.liquidMl,before);
 for(let i=0;i<300;i++)stepPump(s,0,DT);
 assert.ok(s.tubeFill<.5);
});
test('failure: pre-compression off is reported',()=>{assert.deepEqual(activeFailures(pump({precompression:false})).map(f=>f.id),['no-precompression']);});
test('every failure row names what it does, and removal maps to a real removable part',()=>{
 assert.equal(failures.length,6);
 for(const f of failures){assert.ok(f.when&&f.result);if(f.part&&f.part!=='liquid')assert.equal(partById(f.part)?.removable,true,f.id);}
 assert.deepEqual(activeFailures(pump()),[]);
});
test('refill happens through a lifted valve, lagging the piston',()=>{
 const s=pump();for(let i=0;i<30;i++)stepPump(s,1,DT);
 near(s.chamberFill,0);assert.equal(s.valveLift,0);
 let lifted=0,low=0,topLag=false;
 for(let i=0;i<90;i++){stepPump(s,0,DT);lifted=Math.max(lifted,s.valveLift);low=Math.min(low,s.pressureBar);if(s.depth===0&&s.chamberFill<.999)topLag=true;}
 assert.ok(lifted>0);assert.ok(low<0);assert.ok(topLag,'liquid should still be arriving when the actuator is home');near(s.valveLift,0);near(s.chamberFill,1,1e-3);
});
test('liquid falls dose by dose, is conserved, and the surface follows',()=>{
 const s=pump(),start=s.liquidMl,y=liquidY(start);
 for(let i=0;i<25;i++)press(s);
 assert.equal(s.doses,25);near(s.liquidMl,start-25*DOSE_ML,1e-2);
 near(s.liquidMl+s.chamberFill*DOSE_ML+s.dispensedMl,start+DOSE_ML,1e-6);
 assert.ok(liquidY(s.liquidMl)<y);near(liquidY(start),dims.fullY,.1);
 assert.ok(TUBE_END_ML>0&&liquidY(TUBE_END_ML)===dims.tubeEndY||Math.abs(liquidY(TUBE_END_ML)-dims.tubeEndY)<1e-9);
});
test('the step size does not change the result',()=>{
 const run=(dt:number)=>{const s=pump();for(let t=0;t<.4;t+=dt)stepPump(s,1,dt);for(let t=0;t<1.2;t+=dt)stepPump(s,0,dt);return s;};
 const a=run(1/60),b=run(1/15);near(a.dispensedMl,b.dispensedMl,1e-3);assert.equal(a.doses,b.doses);near(a.chamberFill,b.chamberFill,1e-2);
});
test('a dozen parts, each described, with sound lathe profiles and explode offsets',()=>{
 assert.equal(pumpParts.length,12);assert.equal(new Set(pumpParts.map(p=>p.id)).size,12);
 for(const p of pumpParts){
  assert.ok(p.title&&p.role&&p.explode.length===3&&typeof p.removable==='boolean',p.id);
  if(p.shape.kind==='lathe'){assert.ok(p.shape.profile.length>=3,p.id);for(const [r,y] of p.shape.profile)assert.ok(r>=0&&Number.isFinite(y),p.id);}
 }
 assert.equal(partById('spring')!.shape.kind,'helix');
 assert.deepEqual(pumpParts.filter(p=>p.removable).map(p=>p.id).sort(),['ball','cap','nozzle','spring','tube']);
});
