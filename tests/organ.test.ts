import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {GestureFrame,HandPose,MirrorPoint,TrackedHand} from '../src/mirror/contracts';
import {CHYPRE,DAY,FOUGERE,LOCK,MAX_RATE,TILT_DEAD,TILT_FULL,balance,diagnose,handRoll,matchScore,pourRate,ribbon,smellAt,total} from '../src/organ/accord';
import {GRACE,UNDO_HOLD,OrganEngine} from '../src/organ/engine';
import {allergens,ingredients,noteClass,organ} from '../src/organ/ingredients';
import {inZone,palmAt,slots} from '../src/organ/layout';
import {THRESHOLD,composition,declared,dropCount,evaporationOrder,label,layering,layers,makeCompliant,mixColor,remaining,shares,stackLabel,type Blend} from '../src/organ/model';
import {initialOrgan,organDescriptor,validateOrgan} from '../src/organ/state';
import {Story,type Facts} from '../src/organ/story';

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

// ---- The Accord.
test('pour rate follows wrist tilt: nothing while level, continuous, either way, full past the top of the range',()=>{
 assert.equal(pourRate(0),0);assert.equal(pourRate(TILT_DEAD*.9),0,'a slight wobble pours nothing');assert.equal(pourRate(NaN),0);
 let last=0;for(let a=TILT_DEAD;a<=TILT_FULL;a+=.02){const r=pourRate(a);assert.ok(r>=last,`monotone at ${a}`);assert.ok(r-last<.35,`continuous at ${a}`);last=r;}
 assert.ok(near(pourRate(TILT_FULL),MAX_RATE)&&near(pourRate(1.4),MAX_RATE));assert.ok(near(pourRate(-.6),pourRate(.6)),'tips either way');
 assert.ok(pourRate(.4)<pourRate(.8)/2,'a slight tilt is a trickle');
});
/** Landmarks of an upright hand pinching at (x,y), rolled by `turn` about the pinch. */
function handAt(x:number,y:number,turn=0,size=60):MirrorPoint[]{
 const base:[number,number][]=Array.from({length:21},()=>[0,0]);
 base[0]=[0,2.6];base[5]=[-.45,1];base[9]=[-.15,1];base[13]=[.15,1];base[17]=[.45,1];base[4]=[0,0];base[8]=[0,0];
 for(const m of [5,9,13,17])for(let k=1;k<=3;k++)base[m+k]=[base[m][0],base[m][1]-k*.5];base[8]=[0,0];base[1]=[-.4,2.2];base[2]=[-.6,1.6];base[3]=[-.4,.6];
 const c=Math.cos(turn),s=Math.sin(turn);return base.map(([bx,by])=>({x:x+(bx*c-by*s)*size,y:y+(bx*s+by*c)*size,z:0}));
}
test('wrist roll is read from the landmarks: turning the hand turns the reading by the same angle',()=>{
 const r0=handRoll(handAt(300,300))!,r1=handRoll(handAt(300,300,.5))!;assert.ok(near(r1-r0,.5,1e-6),`${r1-r0}`);
 assert.equal(handRoll([]),null);
});
test('ribbon: lavender alone is bright at 9:00, thin by 11:00 and gone by noon; base notes carry the evening',()=>{
 const r=ribbon({lavender:8}),at=(h:number)=>r.total[Math.round(h/DAY*(r.t.length-1))]/r.total[0];
 assert.ok(at(2)<.25,`11:00 ${at(2)}`);assert.ok(at(3)<.1,`noon ${at(3)}`);
 const f=ribbon(FOUGERE.items);assert.ok(f.total.at(-1)!/f.total[0]>.2,'the fougère still smells at 18:00');
 assert.deepEqual(f.bands.map(b=>b.id),['tonka','oakmoss','lavender'],'longest-lasting at the bottom');
 assert.ok(near(total(FOUGERE.items),16));
 const scaled=ribbon({lavender:1,tonka:.75,oakmoss:.25},'normal',16);assert.ok(near(scaled.total[5],f.total[5],1e-9),'resized to the outline, only proportions matter');
 assert.ok(ribbon(FOUGERE.items,'warm').total.at(-1)!<f.total.at(-1)!,'warm skin squeezes the day left');
});
test('match: the outline itself is full, its ratio at any size is full, and the misses are named',()=>{
 assert.ok(near(matchScore(FOUGERE.items,FOUGERE.items).score,1,1e-9));
 assert.ok(near(matchScore({lavender:16,tonka:12,oakmoss:4},FOUGERE.items).score,1,1e-9),'twice as much, same ratio');
 assert.ok(matchScore({lavender:8},FOUGERE.items).score<.5,'lavender alone leaves the evening empty');
 assert.ok(matchScore({lavender:4,tonka:2,oakmoss:1},FOUGERE.items).score>=LOCK,'close enough locks');
 const muddy={lavender:4,tonka:3,oakmoss:3};assert.ok(matchScore(muddy,FOUGERE.items).score<LOCK);
 const d=diagnose(muddy,FOUGERE.items);assert.equal(d.kind,'less');assert.equal(d.id,'oakmoss');assert.match(d.text,/damp and heavy/);
 const thin=diagnose({lavender:8,tonka:2,oakmoss:1},FOUGERE.items);assert.equal(thin.kind,'more');assert.equal(thin.id,'tonka');
 assert.ok(matchScore({...FOUGERE.items,rose:4},FOUGERE.items).score<1,'a stranger costs');
 assert.ok(matchScore({bergamot:6,rose:5,oakmoss:3},CHYPRE.items).score>.99);assert.equal(matchScore({},FOUGERE.items).score,0);
});
test('balance: the pair bar is one material’s share of the two, and the fougère’s notch is 3 : 1',()=>{
 assert.ok(near(balance(FOUGERE.items,'tonka','oakmoss'),.75));assert.equal(balance({},'tonka','oakmoss'),.5);assert.equal(balance({tonka:2},'tonka','oakmoss'),1);
});
test('smell words come before chemistry: plain at 9:00, damp when the moss is heavy, almost nothing when it is gone',()=>{
 assert.deepEqual(smellAt({lavender:8},0),['fresh','herbal']);
 assert.deepEqual(smellAt({lavender:2,tonka:1,oakmoss:6},0),['damp','heavy']);
 const peak=ribbon({lavender:8},'normal',null,2).total[0];assert.deepEqual(smellAt({lavender:8},8,'normal',peak),['almost nothing']);
 assert.ok(smellAt(FOUGERE.items,6).includes('sweet'));
});
const facts=(f:Partial<Facts>={}):Facts=>({items:{},held:[],wafts:0,scrubbed:0,score:0,diagnosis:'',swapped:false,kept:1,pair:.5,clock:0,words:[],poked:false,...f});
test('chapters advance on what the hands did, and the text earns each term after it is seen',()=>{
 const s=new Story(),run=(f:Partial<Facts>,secs=.1)=>{let out=null;for(let t=0;t<secs;t+=.05)out=s.update(facts(f),.05)??out;return out;};
 assert.equal(s.beat,'intro');assert.deepEqual(s.view(facts()).vials,['tonka','lavender','oakmoss']);assert.equal(s.view(facts()).labelOn,false);
 run({poked:true});assert.equal(s.beat,'lavender');assert.deepEqual(s.view(facts()).active,['lavender']);
 run({items:{lavender:3}},1);assert.equal(s.beat,'lavender','not enough yet');
 run({items:{lavender:6},held:[{id:'lavender',inZone:true,rate:2}]},1);assert.equal(s.beat,'lavender','still pouring');
 run({items:{lavender:6}},.7);assert.equal(s.beat,'waft');assert.equal(s.view(facts()).ribbonLive,false,'the ribbon waits for the first smell');
 run({items:{lavender:6},wafts:1});assert.equal(s.beat,'top');assert.ok(s.view(facts()).ribbonLive);assert.match(s.view(facts()).text,/top note/);
 run({items:{lavender:6},wafts:1},5);assert.equal(s.beat,'carry');assert.ok(s.view(facts()).gestures.includes('both'));
 const muddy=s.view(facts({items:{lavender:6,oakmoss:3,tonka:1},pair:.25,held:[{id:'oakmoss',inZone:true,rate:2}]}));assert.match(muddy.sub,/damp and heavy/);
 run({items:{lavender:6,tonka:4.5,oakmoss:1.5}},1);assert.equal(s.beat,'scrub');
 run({items:{lavender:6,tonka:4.5,oakmoss:1.5},scrubbed:6,score:.5,diagnosis:'The evening is thin: pour a little more tonka.'});assert.equal(s.beat,'adjust');assert.match(s.view(facts({diagnosis:'The evening is thin: pour a little more tonka.'})).text,/evening is thin/);
 assert.equal(run({scrubbed:6,score:.9},1),'locked');assert.equal(s.beat,'reveal');
 const reveal=s.view(facts());assert.match(reveal.text,/fougère/);assert.match(reveal.sub,/coumarin \(tonka\)/);assert.ok(reveal.offer&&reveal.locked>=0);
 s.original={...FOUGERE.items};s.next();assert.equal(s.chapter,2);assert.equal(s.beat,'rule');assert.ok(s.view(facts()).labelOn);assert.deepEqual(s.ghost,FOUGERE.items);
 assert.ok(!s.view(facts()).active.includes('oakmoss'),'oakmoss is restricted');
 run({swapped:true},1.2);assert.equal(s.beat,'insight');assert.match(s.view(facts({kept:.7})).text,/70% of the character/);
 s.next();assert.equal(s.beat,'chypre');assert.deepEqual(s.ghost,CHYPRE.items);
 assert.equal(run({score:.85},1),'locked');assert.equal(s.beat,'chypreReveal');s.next();assert.equal(s.beat,'free');assert.equal(s.view(facts()).vials.length,21);assert.equal(s.ghost,null);
 s.goto(1);assert.equal(s.beat,'intro');
});

// ---- The engine, against a flat fake world 1000×800 where mirror points are stage pixels.
function rig(){
 const world={partCount:0,size:{w:1000,h:800},mirrorToWorld:(p:MirrorPoint)=>({x:p.x,y:p.y,z:0}),partAt:()=>-1,stage:(p:MirrorPoint)=>({x:p.x,y:p.y})};
 const engine=new OrganEngine(world);let at=0;const view={q:[0,0,0,1] as [number,number,number,number],zoom:1,x:0,y:0};
 const hand=(pose:HandPose,x:number,y:number,id=1,turn=0):TrackedHand=>{const l=handAt(x,y,turn);if(pose==='open'){l[4]={x:x-110,y:y+40,z:0};}const palm={x,y:y+80,z:0};return {id,side:'left',pose,landmarks:l,palm,indexTip:{x,y,z:0},pinch:{x,y,z:0},orientation:null,velocity:{x:0,y:0},poseAge:5};};
 const run=(hands:TrackedHand[],seconds=1/60)=>{let out;const n=Math.max(1,Math.round(seconds*60));for(let i=0;i<n;i++)out=engine.step({at:at+=16,hands,events:[]} as GestureFrame,1/60,view,false);return out!;};
 run([]);const slot=(id:string)=>engine.scene.slots.find(s=>s.id===id)!;
 return {engine,run,hand,slot,palm:palmAt(1000,800)};
}
test('pick up, carry level (nothing pours), tilt to pour over the palm, and one undo takes the whole pour back',()=>{
 const {engine,run,hand,slot,palm}=rig();run([],4);assert.equal(engine.story.beat,'lavender');
 const v=slot('lavender');run([hand('pinch',v.x+v.r*.8,v.y)]);assert.equal(engine.scene.held[0]?.id,'lavender','a generous hit circle');
 assert.ok(engine.scene.acks.some(a=>/tilt your wrist/.test(a.text)),'acknowledged at once');
 const over={x:palm.x,y:palm.y-120};assert.ok(inZone(over,1000,800));
 run([hand('pinch',over.x,over.y)],1);assert.equal(total(engine.doc.items),0,'level: nothing pours');
 run([hand('pinch',over.x,over.y,1,.9)],1);const poured=engine.doc.items.lavender;assert.ok(poured>2.5&&poured<5.5,`${poured} drops in a second at 0.9 rad`);
 run([hand('pinch',over.x,over.y,1,0)],.5);const level=engine.doc.items.lavender;run([hand('pinch',over.x,over.y,1,0)],.5);assert.ok(near(engine.doc.items.lavender,level,1e-9),'level stops it');
 run([hand('pinch',60,100,1,.9)],.5);assert.ok(near(engine.doc.items.lavender,level,1e-9),'away from the palm nothing lands');assert.ok(engine.scene.acks.some(a=>a.miss&&/over your palm/.test(a.text)));
 run([],GRACE+.1);assert.equal(engine.scene.held.length,0);assert.equal(engine.history.size,1,'one pour, one undo step');
 run([hand('thumbDown',500,600)],UNDO_HOLD+.1);assert.equal(total(engine.doc.items),0);
});
test('a flickering pinch re-attaches inside the grace window; a pinch on nothing is acknowledged as a miss',()=>{
 const {engine,run,hand,slot,palm}=rig();run([],4);const v=slot('lavender');
 run([hand('pinch',v.x,v.y)]);run([hand('pinch',palm.x,palm.y-120)]);run([hand('open',palm.x,palm.y-120)],GRACE*.5);
 assert.ok(engine.scene.held[0]?.loose);run([hand('pinch',palm.x+20,palm.y-110,2)]);assert.ok(engine.scene.held[0]&&!engine.scene.held[0].loose);
 run([],GRACE+.1);run([hand('pinch',40,760,3)]);assert.ok(engine.scene.acks.some(a=>a.miss&&/Nothing in reach/.test(a.text)));
});
test('a waft is an up stroke and a turn back with an open hand; a reach that ends at a vial is not',()=>{
 const {engine,run,hand,slot}=rig();engine.doc.items={lavender:6};
 const stroke=(x:number,ys:number[])=>{for(const y of ys)run([hand('open',x,y)],.06);};
 stroke(900,[700,660,620,580,540,520,540,560]);assert.ok(engine.scene.puffs.length===1,'wafted');assert.deepEqual(engine.scene.puffs[0].words,['fresh','herbal']);
 const v=slot('tonka');run([],1.5);stroke(v.x,[v.y+300,v.y+240,v.y+180,v.y+120,v.y+60,v.y+20,v.y+30,v.y+40]);assert.equal(engine.scene.puffs.length,1,'reaching to a vial is inert');
});
test('chapter 2: pouring the stand-in swaps out the oakmoss, the evening shrinks, the label names it, and undo brings it back',()=>{
 const {engine,run,hand,slot,palm}=rig();engine.goto(2);run([]);
 assert.deepEqual(engine.doc.items,FOUGERE.items,'skipping here starts from the reference accord');
 const l=label({items:Object.entries(engine.doc.items).map(([id,drops])=>({id,drops})),conc:.08}).find(x=>x.id==='oakmoss')!;assert.ok(l.declared&&l.flagged);
 const o=slot('oakmoss');run([hand('pinch',o.x,o.y)]);assert.equal(engine.scene.held.length,0,'oakmoss is restricted now');run([],GRACE+.1);
 const m=slot('moss-accord');run([hand('pinch',m.x,m.y)]);run([hand('pinch',palm.x,palm.y-120)],.3);run([hand('pinch',palm.x,palm.y-120,1,.8)],.6);
 const swap=engine.doc.swap!;assert.ok(swap&&swap.kept<1&&swap.kept>.3,`kept ${swap?.kept}`);assert.equal(engine.doc.items.oakmoss,undefined);assert.ok(engine.doc.items['moss-accord']>2);
 const late=(it:Record<string,number>)=>ribbon(it,'normal',16).total.at(-1)!;assert.ok(late(engine.doc.items)<late(FOUGERE.items),'the evening shrinks');
 assert.ok(label({items:Object.entries(engine.doc.items).map(([id,drops])=>({id,drops})),conc:.08}).every(x=>!x.flagged),'under every limit');
 run([],GRACE+.1);run([hand('thumbDown',500,600)],UNDO_HOLD+.1);assert.ok(engine.doc.swap,'first undo: the extra pour');run([]);run([hand('thumbDown',500,600,2)],UNDO_HOLD+.1);
 assert.equal(engine.doc.swap,null);assert.deepEqual(engine.doc.items,FOUGERE.items,'second undo: the swap');
 assert.deepEqual(makeCompliant({items:[{id:'lavender',drops:8},{id:'tonka',drops:6},{id:'oakmoss',drops:2}],conc:.08}).changes.map(c=>c.id),['oakmoss'],'at this strength only the oakmoss must change');
});
test('a turning fist moves through the day once the ribbon is live; the mouse wheel tilts a clicked vial, never the camera',()=>{
 const {engine,run,hand,slot,palm}=rig();engine.goto(3);run([]);
 const f=(turn:number)=>hand('fist',500,600,1,turn);run([f(0)],.3);for(let i=1;i<=10;i++)run([f(i*.1)],.05);assert.ok(engine.scene.clock>2.5,`${engine.scene.clock} h`);
 run([],.1);const b=slot('bergamot');assert.ok(engine.pointerDown({x:b.x,y:b.y,z:0}));engine.pointerUp();assert.ok(engine.mouseHolding,'a click holds it');
 engine.hover({x:palm.x,y:palm.y-120,z:0});assert.equal(engine.wheel(400),true);const out=run([],1);assert.ok(engine.doc.items.bergamot>2);assert.equal(out.view,null,'never a camera patch');
 engine.wheel(-400);engine.pointerDown({x:palm.x,y:palm.y-120,z:0});assert.ok(!engine.mouseHolding);assert.equal(engine.wheel(100),false,'with nothing held the wheel zooms as usual');
});
test('layout: every target is at least 60 px across, low and central, above the ribbon',()=>{
 for(const ids of [['tonka','lavender','oakmoss'],organ.map(i=>i.id)]){const sl=slots(ids,1280,760),p=palmAt(1280,760);for(const s of sl){assert.ok(s.r>=30);assert.ok(s.y<p.y&&s.y>760*.25,`${s.id} ${s.y}`);}}
});
test('state round-trips and the phone dial is the day',()=>{
 const s=initialOrgan();assert.deepEqual(validateOrgan(JSON.parse(JSON.stringify(s))),s);assert.throws(()=>validateOrgan({...s,schema:2}));
 assert.equal(organDescriptor(s,90).motionLabel,'day');
});
