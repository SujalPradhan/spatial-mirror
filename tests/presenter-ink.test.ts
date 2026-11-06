import test from 'node:test';
import assert from 'node:assert/strict';
import {AtpEngine} from '../src/atp/engine';
import type {AtpViewState,AtpWorld,GestureFrame,HandPose,MirrorPoint,TrackedHand} from '../src/atp/contracts';
import {inkSuppressed} from '../src/mirror/ink-mode';
import {InkBoard,InkController} from '../src/ink/ink';
import {decodeHand,encodeHand,applyInkOps,smoothHands,WatchViewer} from '../src/mirror/watch';
import type {Stroke} from '../src/ink/ink';

function world():AtpWorld{return {partCount:22,mirrorToWorld:(p:MirrorPoint)=>({x:(p.x-.5)*10,y:(.5-p.y)*10,z:0}),partAt:()=>2,partInfo:()=>({id:'F',name:'ATP synthase subunit beta',component:'head',residues:458}),headPoint:()=>({x:0,y:2,z:0})};}
function hand(id:number,pose:HandPose,x=.5,y=.5):TrackedHand{
 const p={x,y,z:0},landmarks=Array.from({length:21},(_,i)=>({x:x+i*.003,y:y+i*.002,z:0}));
 return {id,side:'right',pose,landmarks,palm:p,indexTip:p,pinch:p,orientation:[0,0,0,1],velocity:{x:0,y:0},poseAge:5};
}
const DT=1/60;

test('with ink on, pinch, fist and thumbs reach the engine as bare skeletons',()=>{
 const f:GestureFrame={at:1,hands:[hand(1,'pinch'),hand(2,'fist',.2)],events:[{type:'clap',x:.5,y:.5},{type:'pose',handId:1,pose:'pinch'}]};
 const s=inkSuppressed(f);
 assert.deepEqual(s.hands.map(h=>h.pose),['none','none']);assert.deepEqual(s.events,[]);assert.equal(s.hands[0].landmarks.length,21,'skeleton kept');
 assert.equal(f.hands[0].pose,'pinch','input untouched');
});
test('ink on: a pinch does not pluck, a fist does not hold, a clap does not shock; ink off restores all three',()=>{
 const view=():AtpViewState=>({q:[0,0,0,1],zoom:1,x:0,y:0});
 for(const [name,frame] of [['pluck',(at:number):GestureFrame=>({at,hands:[hand(1,'pinch')],events:[]})],['hold',(at:number):GestureFrame=>({at,hands:[hand(1,'fist')],events:[]})],['shock',(at:number):GestureFrame=>({at,hands:[],events:[{type:'clap',x:.5,y:.5}]})]] as const){
  const sounds=(suppress:boolean)=>{
   const e=new AtpEngine(world()),v=view();let held=false,types:string[]=[];
   for(let i=1;i<=20;i++){const f=frame(i),out=e.step(suppress?inkSuppressed(f):f,DT,v,false);held||=out.holding;types.push(...out.sounds.map(s=>s.type).filter(t=>t!=='motor'));}
   return {held,types,offsets:[...e.step({at:99,hands:[],events:[]},DT,v,false).scene.partOffsets].some(n=>n!==0)};
  };
  const on=sounds(true),off=sounds(false);
  assert.equal(on.held,false,name);assert.deepEqual(on.types,[],name);
  assert.ok(off.held||off.types.length>0,`${name} acts when ink is off`);
 }
});
test('the engine keeps animating and drawing hands while ink is on',()=>{
 const e=new AtpEngine(world()),v:AtpViewState={q:[0,0,0,1],zoom:1,x:0,y:0};
 const out=e.step(inkSuppressed({at:1,hands:[hand(1,'pinch')],events:[]}),DT,v,false);
 assert.equal(out.scene.hands.length,1);
});
test('ink controller draws on pinch and undoes on a held thumb down, in stage coordinates',()=>{
 const board=new InkBoard(),c=new InkController(board),h=(pose:HandPose,x:number)=>({id:1,pose,landmarks:Array.from({length:21},(_,i)=>({x:.5,y:i===9?.6:.8,z:0})),indexTip:{x,y:.5,z:0},pinch:{x,y:.5,z:0}});
 for(let i=0;i<5;i++)c.update({at:i*30,hands:[{...h('pinch',.3+i*.05)}]});
 assert.equal(board.strokes.length,1);assert.ok(board.strokes[0].points[0].x<.35);
 c.update({at:300,hands:[h('open',.5)]});
 for(let t=0;t<=600;t+=50)c.update({at:400+t,hands:[h('thumbDown',.5)]});
 assert.equal(board.strokes.length,0);
});

test('hand wire format round trips within a thousandth and keeps the shape',()=>{
 const h={...hand(3,'pinch',.4,.6),shape:{metric:true,points:Array.from({length:21},(_,i)=>({x:i*.0123,y:-i*.004,z:.001*i}))}};
 const w=encodeHand(h,p=>({x:p.x/2+.25,y:p.y})),d=decodeHand(w);
 assert.equal(d.pose,'pinch');assert.equal(d.landmarks.length,21);
 for(let i=0;i<21;i++){assert.ok(Math.abs(d.landmarks[i].x-(h.landmarks[i].x/2+.25))<.001);assert.ok(Math.abs(d.shape!.points[i].x-h.shape.points[i].x)<.0001);}
 assert.ok(Math.abs(d.pinch.x-(d.landmarks[4].x+d.landmarks[8].x)/2)<1e-9);
 assert.ok(JSON.stringify(w).length<1400);
});
test('ink ops rebuild strokes incrementally and removals drop them',()=>{
 const board=new InkBoard(),strokes=new Map<number,Stroke>();
 applyInkOps(board,strokes,{add:[{id:1,c:'#f00',w:.008,from:0,p:[100,100,200,200],d:0}]},10);
 applyInkOps(board,strokes,{add:[{id:1,c:'#f00',w:.008,from:2,p:[300,300],d:1}]},20);
 assert.equal(board.strokes.length,1);assert.equal(board.strokes[0].points.length,3);assert.equal(board.strokes[0].finishedAt,20);
 applyInkOps(board,strokes,{add:[{id:1,c:'#f00',w:.008,from:9,p:[1,1],d:0}]},30);assert.equal(board.strokes[0].points.length,3,'a gap is ignored');
 applyInkOps(board,strokes,{rm:[1]},40);assert.equal(board.strokes.length,0);
});
test('viewer applies a snapshot, treats silence as offline and ignores garbage',()=>{
 const board=new InkBoard(),v=new WatchViewer('ws://x',board);
 v.receive('not json',0);v.receive(JSON.stringify({v:2,type:'watch-presence',online:true}),0);
 v.receive(JSON.stringify({v:2,type:'watch',full:true,state:{tool:'view',phase:0,frozen:false,view:{q:[0,0,0,1],zoom:1,x:0,y:0}},eng:[10,0,0],hands:[],on:true,keep:false,ink:{add:[{id:1,c:'#fff',w:.01,from:0,p:[5,5],d:0}]}}),100);
 assert.equal(v.live(200),true);assert.equal(v.on,true);assert.equal(board.strokes.length,1);assert.equal(v.state!.phase,0);
 assert.equal(v.live(100+3600),false,'no message for 3.5 s means offline');
 v.receive(JSON.stringify({v:2,type:'watch-presence',online:false}),200);assert.equal(v.live(200),false);
});
test('hand smoothing glides toward the broadcast and forgets hands that left',()=>{
 const shown=new Map<number,TrackedHand>(),a=hand(1,'open',.2,.5),b=hand(1,'open',.6,.5);
 smoothHands(shown,[a],.016);const mid=smoothHands(shown,[b],.016)[0];
 assert.ok(mid.landmarks[0].x>.2&&mid.landmarks[0].x<.6);
 smoothHands(shown,[],.016);assert.equal(shown.size,0);
});
