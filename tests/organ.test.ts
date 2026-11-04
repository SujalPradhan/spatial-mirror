import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {GestureEvent,GestureFrame,HandPose,MirrorPoint,TrackedHand} from '../src/mirror/contracts';
import {apply,emptyDoc,History} from '../src/organ/doc';
import {GRACE,HOLD,MAGNET,OrganEngine} from '../src/organ/engine';
import {allergens,ingredients,noteClass,organ} from '../src/organ/ingredients';
import {place,vialCount,vialIndex} from '../src/organ/layout';
import {THRESHOLD,composition,declared,dropCount,evaporationOrder,label,layering,layers,makeCompliant,mixColor,remaining,shares,stackLabel,type Blend} from '../src/organ/model';
import {initialOrgan,organDescriptor,validateOrgan} from '../src/organ/state';

const blend=(items:[string,number][],conc=.15):Blend=>({items:items.map(([id,drops])=>({id,drops})),conc});
const near=(a:number,b:number,e=1e-9)=>Math.abs(a-b)<e;

test('the organ holds about twenty generic materials in seven families, each with words and a volatility',()=>{
 assert.equal(organ.length,20);assert.equal(new Set(organ.map(i=>i.family)).size,7);
 for(const i of ingredients){assert.ok(i.tau>0&&i.words.length>0,i.id);for(const a of Object.keys(i.allergens))assert.ok(allergens.some(x=>x.id===a),`${i.id}: ${a}`);}
 assert.ok(allergens.some(a=>a.since===2023)&&allergens.some(a=>a.since===2003));
});
test('mixing: shares follow drops, repeats merge, and the colour is the drop-weighted mix',()=>{
 const b=blend([['rose',3],['musk',1],['rose',1]]),s=shares(b);
 assert.equal(dropCount(b),5);assert.ok(near(s.get('rose')!,.8));assert.ok(near(s.get('musk')!,.2));
 assert.deepEqual(mixColor(blend([])),[1,1,1]);
 const one=mixColor(blend([['lemon',2]])),lemon=0xfff07a;assert.ok(near(one[0],(lemon>>16&255)/255,1e-6)&&near(one[2],(lemon&255)/255,1e-6),'a single material is its own colour');
 const mixed=mixColor(blend([['lemon',1],['vetiver',1]]));assert.ok(mixed[2]>Math.min((0xfff07a&255),(0x8f9a5a&255))/255,'mixed in linear light, not darker than both');
});
test('evaporation: citrus first, florals next, musk last, and skin and strength change the pace',()=>{
 const b=blend([['musk',2],['rose',2],['bergamot',2],['sandalwood',2],['lemon',2]]),order=evaporationOrder(b,'normal').map(x=>x.id);
 assert.deepEqual(order,['lemon','bergamot','rose','sandalwood','musk']);
 const lemon=ingredients.find(i=>i.id==='lemon')!;
 assert.ok(remaining(lemon,1,'warm',.15)<remaining(lemon,1,'normal',.15),'warm lifts faster');
 assert.ok(remaining(lemon,1,'dry',.15)<remaining(lemon,1,'normal',.15),'dry holds less');
 assert.ok(remaining(lemon,1,'oily',.15)>remaining(lemon,1,'normal',.15),'oily holds more');
 assert.ok(remaining(lemon,1,'normal',.3)>remaining(lemon,1,'normal',.05),'stronger lasts longer');
 const late=composition(b,8,'normal');assert.equal(late.parts[0].id,'musk');assert.ok(composition(b,0,'normal').left>late.left);
 assert.deepEqual(layers(b).map(l=>l.note),['top','heart','base']);assert.ok(near(layers(b).reduce((t,l)=>t+l.share,0),1));
 assert.equal(noteClass(.3),'top');assert.equal(noteClass(2),'heart');assert.equal(noteClass(20),'base');
});
test('label: an allergen is declared once it crosses 0.001% leave-on or 0.01% rinse-off, and dims on skin as it evaporates',()=>{
 // Lavender is 35% linalool. At 3% oil, x drops of lavender in 1000 drops of musk gives 1.05*x/(1000+x) % linalool: about 0.95 drops crosses 0.001%, 9.6 crosses 0.01%.
 const at=(drops:number,product:'leave-on'|'rinse-off'='leave-on')=>label(blend([['musk',1000],['lavender',drops]],.03),product).find(l=>l.id==='linalool')!;
 assert.ok(at(.8).product<THRESHOLD['leave-on']&&!at(.8).declared,'just under leave-on');
 assert.ok(at(1.1).product>=THRESHOLD['leave-on']&&at(1.1).declared,'just over leave-on');
 assert.ok(!at(5,'rinse-off').declared,'a level over leave-on can be under rinse-off');
 assert.ok(at(11,'rinse-off').declared,'and crosses it with more');
 const b=blend([['bergamot',4],['rose',4],['musk',4]]),start=label(b,'leave-on',0),later=label(b,'leave-on',2);
 const lim=(l:typeof start)=>l.find(x=>x.id==='limonene')!,cit=(l:typeof start)=>l.find(x=>x.id==='citronellol')!;
 assert.ok(near(lim(start).strength,1)&&lim(later).strength<cit(later).strength,'citrus allergens leave first');
 assert.equal(lim(later).product,lim(start).product,'what is declared depends on the bottle, not the hour');
 assert.deepEqual(declared(blend([['musk',5]])),[],'musk here carries nothing to declare');
 assert.ok(declared(b).includes('Limonene')&&declared(b).includes('Citronellol'));
});
test('compliance: a carrier that must lose most of a flagged allergen is substituted, others are scaled, and the cost is reported',()=>{
 const b=blend([['clove',6],['rose',4],['tonka',6],['musk',4]],.2),before=label(b).filter(l=>l.flagged).map(l=>l.id);
 assert.ok(before.includes('eugenol')&&before.includes('coumarin'),before.join());
 const c=makeCompliant(b);
 assert.deepEqual(c.flaggedAfter,[]);assert.deepEqual(label(c.after).filter(l=>l.flagged),[]);
 const clove=c.changes.find(x=>x.id==='clove')!;assert.equal(clove.kind,'substituted');assert.equal(clove.by,'clove-accord');assert.ok(clove.because.includes('Eugenol'));
 const tonka=c.changes.find(x=>x.id==='tonka')!;assert.ok(tonka.kind==='reduced'&&tonka.to<tonka.from||tonka.kind==='substituted');
 assert.ok(c.kept>0&&c.kept<1,`character kept ${c.kept}`);assert.ok(c.losses.some(l=>l.family==='spicy'));
 assert.equal(c.before,b,'the original is kept for undo');assert.equal(b.items[0].id,'clove','and not mutated');
 const clean=makeCompliant(blend([['musk',3],['cedar',2]]));assert.equal(clean.changes.length,0);assert.ok(near(clean.kept,1,1e-9));
});
test('layering adds the layers on skin, and a base-heavy stack fixes lighter notes',()=>{
 const light=blend([['lemon',5],['bergamot',5]]),heavy=blend([['musk',8],['sandalwood',4]]);
 const alone=layering([light],2,'normal'),both=layering([light,heavy],2,'normal');
 assert.equal(alone.fix,0);assert.ok(both.fix>0);assert.ok(both.left[0]>alone.left[0],'the citrus layer lasts longer on top of musk');
 assert.equal(both.dominant,1);assert.ok(near(both.share[0]+both.share[1],1));
 const sum=stackLabel([light,light],0,'normal').find(l=>l.id==='limonene')!,one=label(light).find(l=>l.id==='limonene')!;
 assert.ok(near(sum.product,one.product*2,1e-9),'the stack label is the sum');
});
test('undo: every change is recorded, a no-op is not, and undo restores the exact state',()=>{
 const h=new History();let d=emptyDoc();
 d=apply(d,h,'rose',x=>{x.blend.items.push({id:'rose',drops:3});});
 d=apply(d,h,'fan',x=>{x.fan=true;});
 const same=apply(d,h,'nothing',x=>{x.fan=true;});assert.equal(same,d);assert.equal(h.size,2);
 const back=h.undo()!;assert.equal(back.what,'fan');assert.equal(back.doc.fan,false);assert.equal(back.doc.blend.items.length,1);
 assert.equal(h.undo()!.doc.blend.items.length,0);assert.equal(h.undo(),null);
});
test('layout: every vial sits on the arc in both arrangements, and the ring wraps rather than losing vials',()=>{
 for(const fan of [0,1])for(let i=0;i<vialCount;i++){const p=place(i,0,fan);assert.ok(p.shown>.99,`${i} shown`);assert.ok(p.z<2,'behind the flask');}
 const shown=(ring:number)=>Array.from({length:vialCount},(_,i)=>place(i,ring,0).shown).filter(x=>x>.5).length;
 assert.ok(shown(1.1)>=vialCount-4,'turning hides at most a few at the ends');assert.equal(vialIndex('rose'),organ.findIndex(i=>i.id==='rose'));
});
test('state round-trips and the phone dial is the dry-down clock',()=>{
 const s=initialOrgan();assert.deepEqual(validateOrgan(JSON.parse(JSON.stringify(s))),s);assert.throws(()=>validateOrgan({...s,schema:2}));
 assert.equal(organDescriptor(s,90).motionLabel,'dry-down');
});

// ---- The engine, against a flat fake world: vials on a row at y=100, the flask at (400,400).
function rig(){
 const vials=Array.from({length:vialCount},(_,i)=>({x:60+i*150,y:100,on:true}));
 const world={partCount:0,mirrorToWorld:(p:MirrorPoint)=>({x:p.x,y:p.y,z:0}),partAt:()=>-1,stage:(p:MirrorPoint)=>({x:p.x,y:p.y}),vial:(i:number)=>vials[i],flask:()=>({x:400,y:400}),palm:()=>({x:700,y:400})};
 const engine=new OrganEngine(world);let at=0;const view={q:[0,0,0,1] as [number,number,number,number],zoom:1,x:0,y:0};
 const hand=(pose:HandPose,x:number,y:number,id=1):TrackedHand=>{const p={x,y,z:0};return {id,side:'left',pose,landmarks:[],palm:p,indexTip:p,pinch:p,orientation:null,velocity:{x:0,y:0},poseAge:5};};
 const run=(hands:TrackedHand[],seconds=1/60,events:GestureEvent[]=[])=>{let out;const n=Math.max(1,Math.round(seconds*60));for(let i=0;i<n;i++)out=engine.step({at:at+=16,hands,events:i?[]:events} as GestureFrame,1/60,view,false);return out!;};
 return {engine,run,hand,vials};
}
test('a pinch takes the nearest vial within the magnet, and the pull toward the flask sets the dose',()=>{
 const {engine,run,hand,vials}=rig(),rose=vialIndex('rose'),v=vials[rose];
 run([hand('pinch',v.x+MAGNET*.8,v.y)]);assert.equal(engine.scene.grab?.vial,rose,'a generous hit volume');
 const to={x:400,y:400},step=(k:number)=>run([hand('pinch',v.x+(to.x-v.x)*k,v.y+(to.y-v.y)*k)]);
 step(.3);const some=engine.scene.grab!.drops;step(.8);assert.ok(engine.scene.grab!.drops>some,'further is more');
 const out=run([]);assert.equal(out.view,null,'never a camera patch');assert.ok(engine.scene.grab?.loose,'let go starts the grace window');
 run([],GRACE+.1);assert.equal(engine.scene.grab,null);assert.equal(engine.doc.blend.items[0].id,'rose');assert.ok(engine.doc.blend.items[0].drops>=8);
});
test('a flicker inside the grace window re-attaches to the same vial; a pinch on nothing is a miss',()=>{
 const {engine,run,hand,vials}=rig(),v=vials[vialIndex('lemon')];
 run([hand('pinch',v.x,v.y)]);run([hand('pinch',v.x+50,v.y+80)]);run([hand('open',v.x+50,v.y+80)],GRACE*.5);
 assert.ok(engine.scene.grab?.loose);run([hand('pinch',v.x+60,v.y+85,2)]);
 assert.ok(engine.scene.grab&&!engine.scene.grab.loose,'a new hand id close by picks it back up');assert.equal(engine.doc.blend.items.length,0,'nothing poured yet');
 run([],GRACE+.1);assert.equal(engine.doc.blend.items.length,1);
 run([hand('pinch',900,700,3)]);assert.ok(engine.scene.acks.some(a=>a.miss&&/Nothing in reach/.test(a.text)));
});
test('deliberate poses act only after their hold, show progress, and every action is undoable',()=>{
 const {engine,run,hand}=rig();
 run([hand('thumbUp',600,600)],(HOLD.thumbUp!)*.5);assert.ok(engine.scene.holds[0].progress>.3&&engine.scene.holds[0].progress<1);
 run([hand('thumbUp',600,600)],HOLD.thumbUp!);assert.ok(engine.scene.acks.some(a=>a.miss&&/nothing to spray/.test(a.text)),'an empty flask answers');
 engine.add('rose',4,{x:0,y:0});engine.add('clove',6,{x:0,y:0});
 run([hand('open',600,600)],HOLD.open!*.6);assert.equal(engine.doc.fan,false,'not before the hold');run([hand('open',600,600)],HOLD.open!*.6);assert.equal(engine.doc.fan,true);
 run([hand('love',600,600)],HOLD.love!+.1);assert.equal(engine.doc.skin,'warm');
 run([]);run([hand('thumbUp',600,600)],HOLD.thumbUp!+.1);assert.equal(engine.doc.mode,'drydown');assert.equal(engine.scene.sprays,1);
 run([],1);assert.ok(engine.scene.clock>.3,'the dry-down runs');
 run([hand('open',100,600,4),hand('open',300,600,5)],.1,[{type:'clap',x:200,y:600}]);assert.ok(engine.doc.compliance&&engine.doc.compliance.changes.length>0);
 assert.equal(engine.doc.fan,true,'two open hands on their way to a clap do not toggle the fan');
 const undos=[()=>engine.doc.compliance===null,()=>engine.doc.mode==='compose',()=>engine.doc.skin==='normal',()=>engine.doc.fan===false,()=>!engine.doc.blend.items.some(a=>a.id==='clove')];
 for(const ok of undos){run([]);run([hand('thumbDown',600,600)],HOLD.thumbDown!+.1);assert.ok(ok(),engine.scene.acks.map(a=>a.text).join('|'));}
});
test('two fists set strength on release; two pinches split apart and bottle when pushed together',()=>{
 const {engine,run,hand}=rig();engine.add('rose',5,{x:0,y:0});engine.add('musk',5,{x:0,y:0});
 run([hand('fist',400,600,1),hand('fist',500,600,2)],.3);run([hand('fist',300,600,1),hand('fist',600,600,2)],.1);
 assert.ok(engine.scene.conc!>.15);assert.equal(engine.doc.blend.conc,.15,'live until let go');run([]);assert.ok(engine.doc.blend.conc>.15);
 run([hand('pinch',380,650,3),hand('pinch',420,650,4)],.3);run([hand('pinch',150,650,3),hand('pinch',650,650,4)],.5);assert.ok(engine.scene.split>.8);
 run([]);run([hand('pinch',150,650,5),hand('pinch',650,650,6)],.3);run([hand('pinch',350,650,5),hand('pinch',450,650,6)],.1);
 assert.equal(engine.doc.stack.length,1);assert.equal(dropCount(engine.doc.blend),0);
});
