import test from 'node:test';
import assert from 'node:assert/strict';
import {AtomEngine} from '../src/atom/engine';
import type {AtomWorld,GestureEvent,GestureFrame,HandPose,MirrorPoint,MirrorViewState,TrackedHand} from '../src/atom/contracts';
import {DEFAULT_ELEMENT,TEAR_GAP,TEAR_ROW,TEAR_SPREAD,chargeMark,describeAtom,elements,ionSymbol,nucleons,outermostFree,plural,shellOfElectron,shellsOf,stepElement,tearLayout,validateAtom,initialAtom} from '../src/atom/model';

const DT=1/60;
test('every element has the most common isotope and filled shells',()=>{
 const want:Record<string,[number,number,number[]]>={H:[1,0,[1]],He:[2,2,[2]],Li:[3,4,[2,1]],C:[6,6,[2,4]],N:[7,7,[2,5]],O:[8,8,[2,6]],Ne:[10,10,[2,8]],Na:[11,12,[2,8,1]]};
 assert.deepEqual(elements.map(e=>e.symbol),Object.keys(want));
 for(const e of elements){const [z,n,shells]=want[e.symbol];assert.equal(e.z,z,e.symbol);assert.equal(e.neutrons,n,e.symbol);assert.deepEqual(shellsOf(e.z),shells,e.symbol);assert.equal(shellsOf(e.z).reduce((a,b)=>a+b,0),e.z);}
 assert.equal(elements[DEFAULT_ELEMENT].symbol,'C');
 assert.deepEqual(elements.map(e=>e.z+e.neutrons),[1,4,7,12,14,16,20,23]);
});
test('nucleons are the right mix and every particle has a spot in both layouts',()=>{
 for(const e of elements){
  const n=nucleons(e.z,e.neutrons);
  assert.equal(n.filter(x=>x.kind==='proton').length,e.z);assert.equal(n.filter(x=>x.kind==='neutron').length,e.neutrons);
  for(const x of n)for(const p of [x.packed,x.grouped])assert.ok(p.every(Number.isFinite));
 }
 const packed=nucleons(11,12).map(x=>Math.hypot(...x.packed));assert.ok(Math.max(...packed)<1.1,'the nucleus stays a small ball');
});
test('electrons are numbered inner to outer, and the outermost free one is taken first',()=>{
 const na=shellsOf(11);
 assert.deepEqual([0,1,2,9,10].map(i=>shellOfElectron(na,i).shell),[0,0,1,1,2]);
 assert.equal(outermostFree(6,new Set()),5);assert.equal(outermostFree(6,new Set([5])),4);assert.equal(outermostFree(1,new Set([0])),-1);
});
test('names and charges read as written',()=>{
 assert.equal(chargeMark(0),'');assert.equal(chargeMark(1),'⁺');assert.equal(chargeMark(2),'²⁺');assert.equal(chargeMark(-1),'⁻');assert.equal(ionSymbol('Na',1),'Na⁺');
 assert.equal(plural(1,'proton'),'1 proton');assert.equal(plural(6,'proton'),'6 protons');
 const c=elements[DEFAULT_ELEMENT];
 assert.equal(describeAtom(c,6),'Carbon-12: 6 protons, 6 neutrons, 6 electrons');
 assert.equal(describeAtom(c,5),'C⁺ ion: 6 protons, 5 electrons');
 assert.equal(describeAtom(c,4),'C²⁺ ion: 6 protons, 4 electrons');
 assert.equal(describeAtom(elements[0],0),'H⁺ ion: 1 proton, 0 electrons');
 assert.equal(describeAtom(elements[0],1),'Hydrogen-1: 1 proton, 0 neutrons, 1 electron');
});
test('stepping wraps round the list both ways',()=>{
 assert.equal(stepElement(elements.length-1),0);assert.equal(stepElement(0,-1),elements.length-1);assert.equal(stepElement(3),4);
});
test('tear: whole at 0, fully apart at 1, never backwards, labels only once clear',()=>{
 const whole=tearLayout(0),apart=tearLayout(1);
 assert.deepEqual([whole.loosen,whole.group,whole.flat,whole.labels,whole.protons[0],whole.neutrons[0],whole.ringY,whole.gap].map(x=>x+0),[0,0,0,0,0,0,0,0]);
 assert.equal(whole.ringScale,1);
 assert.deepEqual([apart.loosen,apart.group,apart.flat,apart.labels],[1,1,1,1]);
 assert.equal(apart.protons[0],-TEAR_SPREAD);assert.equal(apart.neutrons[0],TEAR_SPREAD);assert.equal(apart.ringY,TEAR_ROW);assert.equal(apart.gap,TEAR_GAP);assert.equal(apart.ringScale,.5);
 let last=tearLayout(0);
 for(let e=.01;e<=1.0001;e+=.01){
  const t=tearLayout(e);
  assert.ok(t.loosen>=last.loosen&&t.group>=last.group&&t.flat>=last.flat&&t.labels>=last.labels&&t.neutrons[0]>=last.neutrons[0]&&t.protons[0]<=last.protons[0]&&t.ringY<=last.ringY&&t.ringScale<=last.ringScale,`monotonic at ${e}`);
  last=t;
 }
 assert.equal(tearLayout(.3).labels,0);assert.ok(tearLayout(.6).labels>0&&tearLayout(.6).labels<1);
 assert.deepEqual(tearLayout(2),apart);assert.deepEqual(tearLayout(-1),whole);
});
test('saved state keeps only the pose',()=>{
 const s=initialAtom();assert.deepEqual(validateAtom(JSON.parse(JSON.stringify(s))),s);
 assert.throws(()=>validateAtom({...s,schema:2}));assert.throws(()=>validateAtom({...s,view:{...s.view,zoom:9}}));assert.throws(()=>validateAtom(null));
});

function world():AtomWorld{return {partCount:30,mirrorToWorld:(p:MirrorPoint)=>({x:(p.x-.5)*10,y:(.5-p.y)*10,z:0}),partAt:()=>-1};}
function hand(id:number,pose:HandPose,x=.3,y=.5):TrackedHand{const p={x,y,z:0};return {id,side:'right',pose,landmarks:Array.from({length:21},()=>p),palm:p,indexTip:p,pinch:p,orientation:null,velocity:{x:0,y:0},poseAge:5};}
function rig(){
 const engine=new AtomEngine(world()),view:MirrorViewState={q:[0,0,0,1],zoom:1,x:0,y:0};let at=1;
 const run=(seconds:number,hands:TrackedHand[]=[],events:GestureEvent[]=[])=>{
  let out=engine.step({at:at++,hands,events} as GestureFrame,DT,view,false);
  for(let t=DT;t<seconds;t+=DT)out=engine.step({at:at++,hands,events:[]},DT,view,false);
  return out;
 };
 return {engine,run};
}
test('an open palm takes the outermost electron and the atom becomes an ion; leaving sends it home',()=>{
 const r=rig();let out=r.run(.2);
 assert.equal(out.electrons,6);assert.equal(out.scene.caption,'Carbon-12: 6 protons, 6 neutrons, 6 electrons');
 out=r.run(1.5,[hand(1,'open',.3,.5)]);
 assert.equal(out.scene.taken.length,1);assert.equal(out.scene.taken[0].electron,5);assert.ok(out.scene.taken[0].amount>.95);
 assert.equal(out.electrons,5);assert.equal(out.scene.caption,'C⁺ ion: 6 protons, 5 electrons');
 const palm={x:-2,y:0};assert.ok(Math.abs(out.scene.taken[0].x-palm.x)<.1&&out.scene.taken[0].y>palm.y,'above the palm');
 out=r.run(.2);assert.equal(out.scene.taken.length,1,'a flicker shorter than the grace keeps it');assert.equal(out.electrons,5);
 out=r.run(2);assert.equal(out.scene.taken.length,0);assert.equal(out.electrons,6);assert.equal(out.scene.caption,'Carbon-12: 6 protons, 6 neutrons, 6 electrons');
});
test('it follows the hand, one electron per hand, two hands take two',()=>{
 const r=rig();
 let out=r.run(1,[hand(1,'open',.3,.5)]);const x0=out.scene.taken[0].x;
 out=r.run(1,[hand(1,'open',.6,.4)]);assert.ok(out.scene.taken[0].x>x0+2,'moved with the palm');assert.equal(out.scene.taken.length,1);
 out=r.run(1,[hand(1,'open',.6,.4),hand(2,'open',.2,.5)]);
 assert.deepEqual(out.scene.taken.map(t=>t.electron).sort(),[4,5]);assert.equal(out.electrons,4);assert.equal(out.scene.caption,'C²⁺ ion: 6 protons, 4 electrons');
 out=r.run(2);assert.equal(out.electrons,6);
});
test('a fist or a pinch takes nothing, and hydrogen has only one electron to give',()=>{
 const r=rig();
 assert.equal(r.run(1,[hand(1,'fist'),hand(2,'pinch',.7)]).scene.taken.length,0);
 let out=r.run(.1);for(let i=0;i<3;i++){r.engine.next(-1);out=r.run(1.5);}
 assert.equal(r.engine.element,0);assert.equal(out.scene.caption.startsWith('Hydrogen-1'),true);
 const two=r.run(1,[hand(1,'open',.3),hand(2,'open',.7)]);assert.equal(two.scene.taken.length,1);assert.equal(two.electrons,0);assert.equal(two.scene.caption,'H⁺ ion: 1 proton, 0 electrons');
});
test('a clap steps to the next element through a fade, and taken electrons do not carry over',()=>{
 const r=rig();r.run(.5,[hand(1,'open')]);
 let out=r.run(.1,[],[{type:'clap',x:.5,y:.5}]);
 assert.ok(out.scene.fade<1,'fading out');
 out=r.run(1.5);assert.equal(r.engine.element,4);assert.equal(out.scene.fade,1);assert.equal(out.scene.angles.length,7);assert.equal(out.electrons,7);assert.equal(out.scene.taken.length,0);
 out=r.run(1,[],[{type:'clap',x:.5,y:.5}]);out=r.run(1.5);assert.equal(r.engine.element,5);
 const frozen=new AtomEngine(world());frozen.step({at:1,hands:[],events:[{type:'clap',x:.5,y:.5}]},DT,{q:[0,0,0,1],zoom:1,x:0,y:0},true);
 for(let i=0;i<120;i++)frozen.step({at:2+i,hands:[],events:[]},DT,{q:[0,0,0,1],zoom:1,x:0,y:0},true);
 assert.equal(frozen.element,DEFAULT_ELEMENT,'a frozen page ignores a clap');
});
test('thumbs speed the orbits up or reverse them, and the atom turns by itself',()=>{
 const r=rig();let out=r.run(2);const spin=out.scene.spin;
 assert.ok(Math.abs(out.scene.rate-1)<.05);assert.ok(spin>.3&&out.scene.tumble>.8,'idle motion');
 const before=out.scene.angles[0];out=r.run(.5);assert.ok(out.scene.angles[0]>before,'orbits advance');
 out=r.run(2,[hand(1,'thumbUp')]);assert.ok(out.scene.rate>2.5,'faster');
 out=r.run(2,[hand(1,'thumbDown')]);assert.ok(out.scene.rate<-1,'reversed');
 const a=out.scene.angles[0];out=r.run(.3,[hand(1,'thumbDown')]);assert.ok(out.scene.angles[0]<a,'angles run backwards');
 out=r.run(3);assert.ok(Math.abs(out.scene.rate-1)<.05,'back to the pace');
 r.engine.idle=false;out=r.run(3);assert.ok(Math.abs(out.scene.rate)<.05,'reduced motion: orbits settle');const s=out.scene.spin;out=r.run(1);assert.equal(out.scene.spin,s);
});
test('two pinches pulling apart tear the atom in proportion to their distance, and release puts it back',()=>{
 const r=rig(),pair=(gap:number)=>[hand(1,'pinch',.5-gap/2,.5),hand(2,'pinch',.5+gap/2,.5)];
 r.run(.3,pair(.1));
 const mid=r.run(1,pair(.1+.35*.5)).scene.explode,full=r.run(1,pair(.1+.35)).scene.explode;
 assert.ok(Math.abs(mid-.5)<.05&&full>.97,`explode follows distance: ${mid}, ${full}`);
 let out=r.run(.5);assert.ok(out.scene.explode>0&&out.scene.explode<full,'releasing eases back');
 out=r.run(2);assert.equal(out.scene.explode,0);
});
