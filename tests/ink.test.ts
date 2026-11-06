import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InkBoard,InkController,type InkCursor,type InkFrame,type InkHand} from '../src/ink/ink';
import {renderInk} from '../src/ink/render';
import {GestureTracker} from '../src/mirror/gestures';
import {imagePose,type PoseName} from './hand-fixtures';

const hand=(pose:InkHand['pose'],x=.5,y=.5,palm=.2,id=1):InkHand=>({id,pose,pinch:{x,y,z:0},indexTip:{x,y:y-.02,z:0},landmarks:Array.from({length:21},(_,i)=>({x,y:i===9?y-palm:i===0?y:y,z:0}))});
const frame=(at:number,...hands:InkHand[]):InkFrame=>({at,hands});

test('a held pinch draws at the pinch point and release ends the stroke',()=>{
 const c=new InkController();
 c.update(frame(0,hand('pinch',.2,.3)));c.update(frame(33,hand('pinch',.3,.35)));c.update(frame(66,hand('pinch',.4,.4)));
 assert.equal(c.board.strokes.length,1);assert.equal(c.board.drawing,true);
 assert.deepEqual(c.board.strokes[0].points[0],{x:.2,y:.3});assert.ok(c.board.strokes[0].points.length>=3);assert.equal(c.board.strokes[0].finishedAt,null);
 c.update(frame(100,hand('open',.4,.4)));
 assert.equal(c.board.drawing,false);assert.equal(c.board.strokes[0].finishedAt,100);
 c.update(frame(133,hand('pinch',.7,.7)));assert.equal(c.board.strokes.length,2);
});
test('smoothing eases points toward the hand and drops jitter',()=>{
 const b=new InkBoard();b.begin(.5,.5,0,'#fff');b.add(.5001,.5);assert.equal(b.strokes[0].points.length,1);
 b.add(.6,.5);const p=b.strokes[0].points[1];assert.ok(p.x>.5&&p.x<.6);
});
test('finished strokes fade over 8 s and are pruned; keep ink holds them',()=>{
 const b=new InkBoard();const s=b.begin(.1,.1,0,'#f00');b.add(.5,.5);b.end(1000);
 assert.equal(b.alpha(s,500),1);assert.equal(b.alpha(s,1000),1);assert.ok(Math.abs(b.alpha(s,5000)-.5)<1e-9);assert.equal(b.alpha(s,9000),0);
 b.prune(5000);assert.equal(b.strokes.length,1);b.prune(9000);assert.equal(b.strokes.length,0);
 const k=new InkBoard();k.setKeep(true,0);const t=k.begin(.1,.1,0,'#f00');k.end(0);assert.equal(k.alpha(t,60000),1);k.prune(60000);assert.equal(k.strokes.length,1);
 k.setKeep(false,60000);assert.equal(k.alpha(t,60000),1);assert.ok(k.alpha(t,64000)<.6);k.prune(69000);assert.equal(k.strokes.length,0);
});
test('an active stroke does not fade while the pinch is held',()=>{
 const b=new InkBoard();const s=b.begin(.1,.1,0,'#f00');assert.equal(b.alpha(s,50000),1);b.prune(50000);assert.equal(b.strokes.length,1);
});
test('undo removes the last visible stroke and clear removes all',()=>{
 const b=new InkBoard();for(const t of [0,100,200]){b.begin(.1,.1,t,'#f00');b.end(t);}
 assert.equal(b.undo(300),true);assert.equal(b.strokes.length,2);
 b.begin(.2,.2,400,'#0f0');assert.equal(b.undo(410),true);assert.equal(b.drawing,false);assert.equal(b.strokes.length,2);
 b.clear();assert.equal(b.strokes.length,0);assert.equal(b.undo(500),false);
});
test('tracking lost under 150 ms keeps the stroke; longer ends it',()=>{
 const c=new InkController();
 c.update(frame(0,hand('pinch')));c.update(frame(33,hand('pinch',.52)));
 c.update(frame(60));c.update(frame(120));c.update(frame(150,hand('pinch',.55)));
 assert.equal(c.board.strokes.length,1);assert.equal(c.board.drawing,true);
 c.update(frame(200));c.update(frame(340));assert.equal(c.board.drawing,true);c.update(frame(360));
 assert.equal(c.board.drawing,false);assert.equal(c.board.strokes[0].finishedAt,360);
});
test('a small or far hand cannot start a stroke',()=>{
 const c=new InkController();c.update(frame(0,hand('pinch',.5,.5,.03)));assert.equal(c.board.strokes.length,0);
 c.update(frame(33,hand('pinch',.5,.5,.2)));assert.equal(c.board.strokes.length,1);
});
test('thumbDown held 0.5 s undoes once, and repeats after release',()=>{
 const c=new InkController();
 for(const t of [0,100,200]){c.update(frame(t*3,hand('pinch',.2+t/1000,.3)));c.update(frame(t*3+50,hand('open')));}
 assert.equal(c.board.strokes.length,3);
 c.update(frame(1000,hand('thumbDown')));c.update(frame(1400,hand('thumbDown')));assert.equal(c.board.strokes.length,3);
 c.update(frame(1500,hand('thumbDown')));assert.equal(c.board.strokes.length,2);
 c.update(frame(2200,hand('thumbDown')));assert.equal(c.board.strokes.length,2);
 c.update(frame(2300,hand('open')));c.update(frame(2400,hand('thumbDown')));c.update(frame(2900,hand('thumbDown')));assert.equal(c.board.strokes.length,1);
 c.update(frame(3000,hand('thumbDown')));c.update(frame(3100));c.update(frame(3200,hand('thumbDown')));c.update(frame(3600,hand('thumbDown')));assert.equal(c.board.strokes.length,1);
});
test('the cursor follows the fingertip while a hand is visible and flipX mirrors storage',()=>{
 const c=new InkController(new InkBoard(),{flipX:true});assert.equal(c.cursor,null);
 c.update(frame(0,hand('pinch',.25,.4)));assert.deepEqual(c.board.strokes[0].points[0],{x:.75,y:.4});
 const cur=c.cursor as InkCursor|null;assert.ok(cur&&cur.drawing&&Math.abs(cur.x-.75)<1e-9);c.reset(10);assert.equal(c.cursor,null);assert.equal(c.board.drawing,false);
});
test('the real GestureTracker drives a stroke and an undo',()=>{
 const tracker=new GestureTracker(),c=new InkController();let at=0;
 const run=(pose:PoseName,ms:number,x=.5)=>{for(const end=at+ms;at<end;at+=33)c.update(tracker.update([imagePose(pose,x,.6)],at,[],[],1));};
 run('open',200);run('pinch',400);assert.equal(c.board.strokes.length,1);assert.equal(c.board.drawing,true);
 run('open',300);assert.equal(c.board.drawing,false);
 run('thumbDown',800);assert.equal(c.board.strokes.length,0);
});
test('renderInk draws strokes with fade and the cursor',()=>{
 const calls:string[]=[],alphas:number[]=[];
 const ctx=new Proxy({},{get:(_,k)=>k==='globalAlpha'?1:(..._a:unknown[])=>{calls.push(String(k));},set:(_,k,v)=>{if(k==='globalAlpha')alphas.push(v);return true;}}) as unknown as CanvasRenderingContext2D;
 const b=new InkBoard();b.begin(.1,.1,0,'#f00');b.add(.5,.5);b.end(0);
 renderInk(ctx,640,480,b,4000,{x:.5,y:.5,drawing:false});
 assert.ok(calls.includes('stroke')&&calls.includes('arc'));assert.ok(Math.abs(alphas[0]-.5)<1e-9);
});
