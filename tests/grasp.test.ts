import test from 'node:test';
import assert from 'node:assert/strict';
import realHands from './real-hands.json' with {type:'json'};
import {posedHand} from './hand-fixtures';
import {SHAPES,metricLandmarks,mix} from './grasp-hands';
import {JointReader,OneEuro,calibrate,defaultCalibration,normalise,rawJoints,type P} from '../src/grasp/joints';
import {COUPLINGS,MOTOR_COUNTS,WEIGHTS,explained,pose,project,residualGlow,synthesise} from '../src/grasp/synergy';
import {simulate} from '../src/grasp/tendon';
import {evaluate} from '../src/grasp/score';
import {OBJECTS,objectById} from '../src/grasp/objects';
import {GraspEngine,PRESETS} from '../src/grasp/engine';

const D=180/Math.PI;
const near=(a:number,b:number,e:number,msg='')=>assert.ok(Math.abs(a-b)<=e,`${msg} ${a} ≉ ${b} ±${e}`);
const normalised=(deg:number[])=>normalise(rawJoints(metricLandmarks(deg))!.angles,defaultCalibration());
/** Deterministic noise. */
function rng(seed:number){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};}

test('joint angles come back from landmarks, whatever the hand’s position, size or turn',()=>{
 for(const shape of Object.values(SHAPES)){
  const h=metricLandmarks(shape),r=rawJoints(h)!;
  r.angles.forEach((a,i)=>near(a*D,shape[i],.6,`joint ${i}`));
  // Rotate, scale and move the whole hand: bone angles do not change.
  const c=Math.cos(.7),s=Math.sin(.7),moved:P[]=h.map(p=>({x:(c*p.x-s*p.z)*3+1,y:p.y*3-2,z:(s*p.x+c*p.z)*3}));
  rawJoints(moved)!.angles.forEach((a,i)=>near(a,r.angles[i],1e-9));
 }
 assert.equal(rawJoints([]),null);assert.equal(rawJoints(Array(21).fill({x:NaN,y:0,z:0})),null);
});
test('recorded hands read sensibly: an open hand is near flat, and the fixture fist is far more bent than the fixture open hand',()=>{
 const open=realHands.filter(h=>h.pose==='open');assert.ok(open.length>0);
 for(const h of open){const r=rawJoints(h.world)!;const fingers=[3,4,6,7,9,10].reduce((a,i)=>a+r.angles[i]*D,0)/6;assert.ok(fingers<35,`open hand bends ${fingers.toFixed(1)}°`);}
 const flex=(pose:'open'|'fist')=>{const r=rawJoints(posedHand(pose))!;return [3,4,6,7,9,10,12,13].reduce((a,i)=>a+r.angles[i],0)/8*D;};
 assert.ok(flex('fist')-flex('open')>35,`${flex('fist')} vs ${flex('open')}`);
});
test('calibration makes the flat hand 0 and the fist 1 joint by joint; a joint that barely moved keeps a typical span',()=>{
 const flat=rawJoints(metricLandmarks(SHAPES.flat))!.angles,fist=rawJoints(metricLandmarks(SHAPES.fist))!.angles;
 const c=calibrate([flat,flat],[fist,fist]);
 normalise(flat,c).forEach(x=>near(x,0,1e-9));normalise(fist,c).forEach(x=>near(x,1,1e-9));
 const half=rawJoints(metricLandmarks(mix(SHAPES.flat,SHAPES.fist,.5)))!.angles;normalise(half,c).forEach((x,i)=>near(x,.5,.03,`joint ${i}`));
 // A thumb that did not move between the two poses: the fixture hands keep it still.
 const still=calibrate([flat],[Float64Array.from(fist).map((x,i)=>i<3?flat[i]:x)]);
 assert.ok(still.fist[0]-still.flat[0]>20/D,'fallback span');
 assert.equal(normalise(flat.map(x=>x-1),c).every(x=>x===0),true,'clamped at 0');
});
test('the One-Euro filter steadies a noisy still joint, and a hidden thumb holds its last good reading',()=>{
 const f=new OneEuro(),r=rng(3);let spread=0;for(let i=0;i<120;i++){const y=f.filter(.5+(r()-.5)*.2,i*33);if(i>30)spread=Math.max(spread,Math.abs(y-.5));}
 assert.ok(spread<.06,`spread ${spread}`);
 const reader=new JointReader(),good=metricLandmarks(SHAPES.pinch);reader.read(good,0);reader.read(good,33);
 const before=reader.read(good,66)!.raw.slice(0,3);
 // The thumb collapses toward its base, as when the palm hides it.
 const hidden=good.map((p,i)=>i>=2&&i<=4?{x:good[1].x+(p.x-good[1].x)*.3,y:good[1].y+(p.y-good[1].y)*.3+.01,z:good[1].z}:p);
 const out=reader.read(hidden,99)!;assert.equal(reader.thumbUncertain,true);[0,1,2].forEach(i=>near(out.raw[i],before[i],1e-9));
 reader.read(good,132);assert.equal(reader.thumbUncertain,false);
});
test('projection: poses a coupling can make come back exactly; bounded; residual is what no motor setting reaches',()=>{
 for(const k of MOTOR_COUNTS){const c=COUPLINGS[k];const m=c.motors.map((_,j)=>(.2+.13*j)%1);const q=synthesise(c,m),p=project(c,q);p.residual.forEach(r=>near(r,0,1e-6));p.m.forEach(x=>assert.ok(x>=0&&x<=1));}
 const pinch=normalised(SHAPES.pinch),one=project(COUPLINGS[1],pinch),two=project(COUPLINGS[2],pinch);
 // One motor: the thumb's rotation is fixed and the index cannot bend alone, so both glow.
 assert.ok(residualGlow(one.residual[0])>.5,`thumb rotation residual ${one.residual[0]}`);assert.ok(residualGlow(one.residual[3])>.3,`index ${one.residual[3]}`);
 assert.ok(residualGlow(two.residual[0])<.05&&residualGlow(two.residual[3])<.2,`two motors fit the pinch: ${two.residual.map(x=>x.toFixed(2))}`);
 // The fewer motors, the more is left over, for any pose.
 // Couplings are not nested (two motors' pinch tendon is not in three's span), but one motor always leaves the most and five never more than three.
 const err=(k:1|2|3|5)=>project(COUPLINGS[k],pinch).residual.reduce((a,r,i)=>a+WEIGHTS[i]*r*r,0);
 assert.ok(err(1)>Math.max(err(2),err(3),err(5))&&err(3)>=err(5)-1e-9);
 // Five motors cannot bend a DIP alone; the four-bar ties it to the PIP.
 const dipOnly=pose({fingers:0});dipOnly[5]=.8;assert.ok(project(COUPLINGS[5],dipOnly).residual[5]>.3);
 // Explained share of a mixed set of poses rises with motor count.
 const poses=Object.values(SHAPES).map(normalised),ex=MOTOR_COUNTS.map(k=>explained(COUPLINGS[k],poses));
 for(let i=1;i<ex.length;i++)assert.ok(ex[i]>=ex[i-1]-1e-9,`${ex}`);assert.ok(ex[1]>.8,`two motors explain ${ex[1]}`);
});
test('grading in synergy space shrugs off 15° of tracking noise',()=>{
 const r=rng(7),clean=project(COUPLINGS[2],normalised(SHAPES.pinch)).m;let held=0;
 for(let t=0;t<20;t++){
  const noisy=SHAPES.pinch.map(x=>x+(r()*2-1)*15),p=project(COUPLINGS[2],normalised(noisy));
  p.m.forEach((x,j)=>near(x,clean[j],.3,'motor'));
  // Each joint's own residual stays mostly dark: noise alone rarely lights a joint red.
  if(evaluate(simulate(COUPLINGS[2],p.m,objectById('pen')),objectById('pen')).stable)held++;
 }
 assert.ok(held>=14,`noisy pinches held ${held}/20`);
 const lit=SHAPES.flat.map(x=>x+7.5),flat=project(COUPLINGS[5],normalised(lit));assert.ok(flat.residual.every(x=>residualGlow(x)===0),'7.5° everywhere lights nothing');
});
test('tendons: in free air the robot lands on its synergy pose; contact stops a link and the pull flows to the rest',()=>{
 for(const k of MOTOR_COUNTS){const c=COUPLINGS[k],m=c.motors.map((_,j)=>.15+.1*j),free=simulate(c,m,null),target=synthesise(c,m);free.q.forEach((x,i)=>near(x,i>=3&&i%3===2?target[i-1]:target[i],.02,`k${k} joint ${i}`));assert.equal(free.contacts.length,0);}
 const mug=objectById('mug'),c=COUPLINGS[1],free=simulate(c,[.8],null),grip=simulate(c,[.8],mug);
 assert.ok(grip.blocked.some(Boolean),'something stopped');
 // Proximal stops first: MCPs blocked on the mug while the PIPs went on to wrap.
 for(const d of [1,2,3]){assert.ok(grip.blocked[3*d],`digit ${d} MCP stopped`);assert.ok(grip.q[3*d]<free.q[3*d]-.1,'MCP held short');}
 assert.ok(grip.motors[0].tension>free.motors[0].tension+.3,'stopped links raise the tension: the motor squeezes');
 // Differential: block only the index (a post in front of it) and the other fingers bend further than they would in free air.
 const post={...mug,id:'pen' as const,sdf:(p:number[])=>Math.hypot(p[1]-12.4,p[2]-2.2)-.4+Math.max(0,Math.abs(p[0]+2.85)-.9)*10};
 const blocked=simulate(c,[.6],post as never),open=simulate(c,[.6],null);
 assert.ok(blocked.blocked[3],'index stopped');for(const i of [6,9,12])assert.ok(blocked.q[i]>open.q[i]+.02,`finger row ${i} took the pull: ${blocked.q[i]} vs ${open.q[i]}`);
 const tree=blocked.motors[0].tree;assert.ok(!('digit' in tree),'one motor shares through a whiffletree');
 assert.ok(blocked.motors[0].tension>open.motors[0].tension,'stopped links raise the tension');
});
test('grasp score: one motor wraps the mug but cannot pinch the pen; two motors pinch it',()=>{
 const mug=objectById('mug'),pen=objectById('pen');
 const fist=project(COUPLINGS[1],normalised(SHAPES.fist)),wrap=evaluate(simulate(COUPLINGS[1],fist.m,mug),mug);
 assert.ok(wrap.stable,wrap.reason);assert.equal(wrap.kind,'power-wrap');assert.ok(wrap.score>=70);
 // Every pose we can think of: one motor never holds the pen.
 const shapes=[...Object.values(SHAPES),...Object.values(PRESETS).map(p=>p.q)];
 for(const s of shapes){const q=s.length===15&&s.some(x=>x>1.5)?normalised(s):s;for(let t=.1;t<=1.2;t+=.1){const m=[Math.min(1,project(COUPLINGS[1],q).m[0]*t)];const v=evaluate(simulate(COUPLINGS[1],m,pen),pen);assert.ok(!v.stable,`one motor held the pen at ${m}: ${v.kind}`);}}
 const pinch=project(COUPLINGS[2],normalised(SHAPES.pinch)),held=evaluate(simulate(COUPLINGS[2],pinch.m,pen),pen);
 assert.ok(held.stable,held.reason);assert.equal(held.kind,'pinch');
 const thumb=simulate(COUPLINGS[2],pinch.m,pen).contacts.find(x=>x.digit===0),index=simulate(COUPLINGS[2],pinch.m,pen).contacts.find(x=>x.digit===1);
 assert.ok(thumb&&index,'thumb and index both on the pen');
 // A lone push never counts, however hard.
 const push=evaluate({...simulate(COUPLINGS[1],[.3],pen),contacts:[{digit:1,k:2,point:[0,0,0],normal:[0,0,1],force:20,kind:'object'}]},pen);assert.equal(push.stable,false);
 const pair=evaluate({...simulate(COUPLINGS[1],[.3],pen),contacts:[{digit:1,k:2,point:[0,0,1],normal:[0,0,1],force:3,kind:'object'},{digit:0,k:2,point:[0,0,-1],normal:[0,0,-1],force:3,kind:'object'}]},pen);assert.ok(pair.stable&&pair.balance>.99);
});
test('every taxonomy entry is reachable on some object with some motor count',()=>{
 const found=new Set<string>();
 const poses=[...Object.values(PRESETS).map(p=>p.q),...Object.values(SHAPES).map(normalised)];
 for(const o of OBJECTS)for(const k of MOTOR_COUNTS)for(const q of poses){const p=project(COUPLINGS[k],q),v=evaluate(simulate(COUPLINGS[k],p.m,o),o);if(v.kind)found.add(v.kind);}
 for(const kind of ['power-wrap','power-sphere','pinch','tripod','lateral','precision-sphere'])assert.ok(found.has(kind),`${kind} never found: ${[...found]}`);
});
test('the engine starts at one motor and the mug, calibrates from a flat hand and a fist, and needs no hand for presets',()=>{
 const store=new Map<string,string>(),e=new GraspEngine({getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v);},removeItem:k=>{store.delete(k);}});
 assert.equal(e.motors,1);assert.equal(e.objectId,'mug');assert.equal(e.isCalibrated,false);
 const view={q:[0,0,0,1] as [number,number,number,number],zoom:1,x:0,y:0};
 const frame=(pts:P[],at:number)=>({at,events:[],hands:[{id:1,side:'right' as const,pose:'open' as const,landmarks:pts,palm:pts[9],indexTip:pts[8],pinch:pts[8],orientation:null,velocity:{x:0,y:0},poseAge:5,shape:{points:pts,metric:true}}]});
 let t=0;const run=(pts:P[],s:number)=>{for(let i=0;i<s*30;i++)e.step(frame(pts,t+=33),1/30,view,false);};
 run(metricLandmarks(SHAPES.flat),.3);assert.equal(e.calibrationPhase,'flat');
 run(metricLandmarks(SHAPES.flat),2);assert.equal(e.calibrationPhase,'fist');
 run(metricLandmarks(SHAPES.fist),2.5);assert.equal(e.calibrationPhase,'done');assert.ok(store.has('grasp-calibration-v1'));
 const out=e.step(frame(metricLandmarks(SHAPES.fist),t+=33),1/30,view,false);assert.ok(out.scene.user.slice(3).every(x=>x>.9),'fist reads as 1');
 run(metricLandmarks(SHAPES.fist),1.5);assert.ok(out.scene.verdict.stable||e.step(frame(metricLandmarks(SHAPES.fist),t+=33),1/30,view,false).scene.verdict.stable,'one-motor fist holds the mug');
 // No hand: the preset eases in.
 e.setPreset('pinch');e.setMotors(2);e.setObject('pen');for(let i=0;i<120;i++)e.step({at:t+=33,events:[],hands:[]},1/30,view,false);
 const last=e.step({at:t+=33,events:[],hands:[]},1/30,view,false).scene;assert.equal(last.source,'preset');assert.ok(last.verdict.stable,last.verdict.reason);
 assert.equal(last.taxonomy.pinch?.motors,2);
});
