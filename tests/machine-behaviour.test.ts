import test from 'node:test';
import assert from 'node:assert/strict';
import {MachineBehaviour,STITCH_CAP,throwBeat} from '../src/machine/behaviour';
import {MachineEngine} from '../src/machine/engine';
import {initialMachine,validateMachine} from '../src/machine/state';
import {bodyParts,machineExtras,machineParts} from '../src/machine/parts';
import {PITCH} from '../src/machine/model';
import type {GestureFrame} from '../src/mirror/contracts';

const world={partCount:machineParts.length,mirrorToWorld:(p:{x:number;y:number;z:number})=>p,partAt:()=>-1,partInfo:(i:number)=>machineParts[i],screenOf:()=>({x:0,y:0})};
const frame:GestureFrame={at:0,hands:[],events:[]};
const fresh=()=>{const e=new MachineEngine(world),view=initialMachine().view;return {e,m:e.machine,view,step:(n=1)=>{let out;for(let i=0;i<n;i++)out=e.step(frame,.02,view,false);return out!;}};};
/** Sews by moving the crank in small jumps, as a stepping frame would. */
function sew(t:ReturnType<typeof fresh>,turns:number,step=30){for(let d=0;d<turns*360;d+=step){t.m.crank+=step;t.step();}}

test('the machine has 15 to 20 named parts, and exactly the three that can come out',()=>{
 assert.ok(machineParts.length>=15&&machineParts.length<=20);
 assert.deepEqual(machineParts.filter(p=>p.removable).map(p=>p.id),['takeUp','feedDog','bobbin']);
 assert.equal(new Set([...machineParts,...machineExtras].map(p=>p.id)).size,machineParts.length+machineExtras.length);
 for(const p of machineParts)assert.ok(p.title&&p.role,p.id);
 for(const id of bodyParts)assert.ok(machineParts.some(p=>p.id===id),id);
});
test('a stitch per turn, and the record stays capped however long it runs',()=>{
 const t=fresh();sew(t,5);assert.equal(t.m.count,5);assert.equal(t.m.stitches.length,5);
 t.m.stitches.forEach((s,i)=>{assert.ok(Math.abs(s.x-i*PITCH)<1e-9);assert.equal(s.index,i);});
 sew(t,STITCH_CAP*3);assert.equal(t.m.stitches.length,STITCH_CAP);assert.equal(t.m.count,5+STITCH_CAP*3);
 assert.equal(t.m.stitches.at(-1)!.index,t.m.count-1);
});
test('a pulled part changes only the stitches after it',()=>{
 const t=fresh();sew(t,3);t.m.remove('bobbin');sew(t,2);
 assert.deepEqual(t.m.stitches.map(s=>s.kind),['formed','formed','formed','single-thread','single-thread']);
 assert.equal(t.m.count,3,'a stitch with no lock is not a stitch');
 t.m.restore();sew(t,1);assert.equal(t.m.stitches.at(-1)!.kind,'formed');assert.equal(t.m.count,4);
});
test('without the feed dog the cloth stops where it is, not back at the start',()=>{
 const t=fresh();sew(t,4);const at=t.m.travel;assert.ok(at>2*PITCH);
 t.m.remove('feedDog');sew(t,3);assert.equal(t.m.travel,at);
 assert.deepEqual(t.m.stitches.slice(-3).map(s=>s.kind),['stationary','stationary','stationary']);
 assert.equal(new Set(t.m.stitches.slice(-3).map(s=>s.x)).size,1);
});
test('hook timing steps both miss, and Recenter puts it back',()=>{
 const t=fresh();sew(t,2);
 assert.equal(t.e.cycleTiming()!.offset>0,true);sew(t,2);assert.equal(t.m.stitches.at(-1)!.kind,'skipped');assert.equal(t.m.count,2);assert.ok(t.m.caption.includes('late'));
 assert.equal(t.e.cycleTiming()!.offset<0,true);sew(t,1);assert.equal(t.m.stitches.at(-1)!.kind,'skipped');assert.ok(t.m.caption.includes('early'));
 t.e.restore();sew(t,1);assert.equal(t.m.stitches.at(-1)!.kind,'formed');
});
test('running backwards unpicks, and a scrub wraps without unsewing',()=>{
 const t=fresh();sew(t,4);assert.equal(t.m.count,4);
 for(let d=0;d<720;d+=30){t.m.crank-=30;t.step();}
 assert.equal(t.m.count,2);assert.equal(t.m.stitches.length,2);
 const before=t.m.crank,count=t.m.count;t.e.seek(((before%360)+10)%360);t.step();
 assert.ok(Math.abs(t.m.crank-before-10)<1e-9,'shortest arc from the unwrapped crank');assert.equal(t.m.count,count);
 assert.ok(Math.abs(t.e.position-t.m.crank)<1e-9);
});
test('a saved phase restores silently before the first step',()=>{
 const t=fresh();t.e.seek(300);t.step();assert.equal(t.m.count,0);assert.equal(t.m.crank,300);
 t.m.crank=370;t.step();assert.equal(t.m.count,1);
});
test('stir turns the wheel directly, one circle to a stitch, and fades nothing into the flywheel',()=>{
 const t=fresh();t.m.omega=100;t.m.stir(Math.PI*2,.5);assert.equal(t.m.crank,180);assert.equal(t.m.omega,0);
});
test('idle runs slowly and lingers on the loop throw; off, it does not move',()=>{
 const t=fresh();t.step(50);assert.equal(t.m.crank,0);
 const u=fresh();u.e.idle=true;u.step(300);assert.ok(u.m.omega>40&&u.m.omega<70,String(u.m.omega));
 u.m.crank=210;const a=u.m.crank;u.step(10);const slow=u.m.crank-a;u.m.crank=30;u.step(10);assert.ok(slow<(u.m.crank-30)*.5);
 assert.equal(throwBeat(100),0);assert.equal(throwBeat(212),1);assert.equal(throwBeat(300),0);
});
test('zoom crosses into the close-up and back out, with a margin between',()=>{
 const t=fresh();t.e.idle=true;t.step();assert.equal(t.m.close,false);
 t.view.zoom=1.4;t.step();assert.equal(t.m.close,true);
 t.view.zoom=1;t.step();assert.equal(t.m.close,true);
 t.view.zoom=.8;t.step();assert.equal(t.m.close,false);
 t.view.zoom=1;t.step(200);assert.equal(t.m.close,false,'the opening move does not override the viewer');
});
test('a removal is hidden, and goes close to show the consequence',()=>{
 const t=fresh();t.e.idle=true;t.step();t.m.setClose(false);
 const i=machineParts.findIndex(p=>p.id==='takeUp'),out=t.step(),s=out.scene;
 s.partGlow[i]=1;s.partOffsets[i*3]=1;t.m.settle(.02,(t.e as any).context);
 assert.deepEqual(t.m.removed,['takeUp']);assert.equal(t.m.close,true);assert.ok(t.step().scene.hidden.has('takeUp'));
 t.m.remove('bobbin');const hidden=t.step().scene.hidden;assert.ok(hidden.has('bobbin')&&hidden.has('bobbinRims'),'its rims go with it');
});
test('saved state is validated and allow-listed',()=>{
 const good=initialMachine();assert.deepEqual(validateMachine({...good,extra:1}),good);
 assert.throws(()=>validateMachine({...good,phase:500}));assert.throws(()=>validateMachine({...good,schema:2}));
});
