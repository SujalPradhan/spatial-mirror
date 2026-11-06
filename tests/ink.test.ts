import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InkBoard,InkController,type InkCursor,type InkFrame,type InkHand} from '../src/ink/ink';
import {renderInk} from '../src/ink/render';
import {StyleGestures,nextIn} from '../src/ink/style';
import {SwipeDetector} from '../src/ink/swipe';
import {SlideView} from '../src/ink/zoom';
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

test('victory held 0.5 s cycles colour once, repeats only after release',()=>{
 const s=new StyleGestures(),run=(at:number,...h:InkHand[])=>s.update(frame(at,...h),false);
 assert.deepEqual(run(0,hand('victory')),[]);assert.deepEqual(run(400,hand('victory')),[]);assert.deepEqual(run(500,hand('victory')),['colour']);
 assert.deepEqual(run(1500,hand('victory')),[]);assert.deepEqual(run(3000,hand('victory')),[]);
 assert.deepEqual(run(3100,hand('open')),[]);assert.deepEqual(run(3300,hand('open')),[]);
 assert.deepEqual(run(3400,hand('victory')),[]);assert.deepEqual(run(3900,hand('victory')),['colour']);
});
test('love held 1.0 s cycles background and not earlier',()=>{
 const s=new StyleGestures(),run=(at:number,...h:InkHand[])=>s.update(frame(at,...h),false);
 run(0,hand('love'));assert.deepEqual(run(900,hand('love')),[]);assert.deepEqual(run(1000,hand('love')),['background']);assert.deepEqual(run(2500,hand('love')),[]);
});
test('style gestures are ignored while drawing or pinching',()=>{
 const s=new StyleGestures();
 s.update(frame(0,hand('victory')),true);assert.deepEqual(s.update(frame(800,hand('victory')),true),[]);
 s.update(frame(900,hand('victory')),false);assert.deepEqual(s.update(frame(1200,hand('victory'),hand('pinch',.2,.2,.2,2)),false),[]);
 s.update(frame(1300,hand('victory')),false);assert.deepEqual(s.update(frame(1750,hand('victory')),false),[]);assert.deepEqual(s.update(frame(1800,hand('victory')),false),['colour']);
});
test('a tracking flicker under 150 ms keeps the hold; a longer gap restarts it',()=>{
 const s=new StyleGestures(),run=(at:number,...h:InkHand[])=>s.update(frame(at,...h),false);
 run(0,hand('victory'));run(300,hand('victory'));run(380);assert.deepEqual(run(520,hand('victory')),['colour']);
 assert.deepEqual(run(560),[]);assert.deepEqual(run(650,hand('victory')),[]);assert.deepEqual(run(1500,hand('victory')),[]);
 run(1600);assert.deepEqual(run(1800),[]);run(1900,hand('victory'));assert.deepEqual(run(2300,hand('victory')),[]);assert.deepEqual(run(2400,hand('victory')),['colour']);
});
test('nextIn cycles and wraps',()=>{assert.equal(nextIn(['a','b','c'],'b'),'c');assert.equal(nextIn(['a','b','c'],'c'),'a');});
test('the real GestureTracker drives colour and background changes',()=>{
 const tracker=new GestureTracker(),style=new StyleGestures(),seen:string[]=[];let at=0;
 const run=(pose:PoseName,ms:number)=>{for(const end=at+ms;at<end;at+=33)seen.push(...style.update(tracker.update([imagePose(pose,.5,.6)],at,[],[],1),false));};
 run('open',200);run('victory',900);run('open',400);run('love',1500);
 assert.deepEqual(seen,['colour','background']);
});

const sweep=(d:SwipeDetector,from:number,to:number,ms:number,y0=.5,y1=.5,t0=0,pose:InkHand['pose']='open')=>{let out:string|null=null;const n=Math.round(ms/33);for(let i=0;i<=n;i++){const k=i/n,r=d.update(frame(t0+i*33,hand(pose,from+(to-from)*k,y0+(y1-y0)*k,.2)));if(r)out=r;}return out;};
test('an open-hand sweep left is next and right is previous; the hand is in mirror space',()=>{
 assert.equal(sweep(new SwipeDetector(),.7,.3,300),'next');assert.equal(sweep(new SwipeDetector(),.3,.7,300),'prev');
});
test('slow, short, vertical and non-open movements are not swipes',()=>{
 assert.equal(sweep(new SwipeDetector(),.7,.3,1500),null);assert.equal(sweep(new SwipeDetector(),.5,.4,300),null);
 assert.equal(sweep(new SwipeDetector(),.5,.5,300,.2,.8),null);assert.equal(sweep(new SwipeDetector(),.7,.3,300,.5,.5,0,'fist'),null);
});
test('swipes have a cooldown',()=>{
 const d=new SwipeDetector();assert.equal(sweep(d,.7,.3,300),'next');assert.equal(sweep(d,.7,.3,300,.5,.5,330),null);assert.equal(sweep(d,.7,.3,300,.5,.5,1500),'next');
});
const two=(at:number,ax:number,bx:number,y=.5)=>frame(at,hand('pinch',ax,y,.2,1),hand('pinch',bx,y,.2,2));
test('two pinching hands zoom by their spread about the midpoint and pan together, clamped to 1x..4x',()=>{
 const v=new SlideView();v.update(two(0,.4,.6),true,false);v.update(two(33,.3,.7),true,false);
 assert.ok(Math.abs(v.zoom-2)<1e-6);assert.ok(Math.abs(v.x)<1e-6&&Math.abs(v.y)<1e-6);
 v.update(two(66,.35,.75),true,false);assert.ok(Math.abs(v.zoom-2)<1e-6);assert.ok(Math.abs(v.x-.05)<1e-6);
 v.update(two(99,-.5,1.5),true,false);assert.equal(v.zoom,4);assert.ok(Math.abs(v.x)<=1.5+1e-9);
 v.update(two(132,.5,.5),true,false);assert.equal(v.zoom,1);
 const w=new SlideView();w.update(two(0,.4,.6),false,false);w.update(two(33,.2,.8),false,false);assert.equal(w.zoom,1);
 const flip=new SlideView();flip.update(two(0,.4,.6),true,true);flip.update(two(33,.4,.8),true,true);assert.ok(flip.x<0);
});
test('slide view eases back to whole after reset',()=>{
 const v=new SlideView();v.update(two(0,.4,.6),true,false);v.update(two(33,.2,.8),true,false);const z=v.zoom;v.reset(1000);
 assert.ok(v.current(1150).zoom<z&&v.current(1150).zoom>1);assert.equal(v.current(1400).zoom,1);
});
test('a second pinching hand cancels the stroke in progress and blocks drawing until both release; off outside slides',()=>{
 const c=new InkController();c.options.twoHand=true;
 c.update(frame(0,hand('pinch',.2,.3,.2,1)));c.update(frame(33,hand('pinch',.3,.3,.2,1)));assert.equal(c.board.strokes.length,1);
 c.update(frame(66,hand('pinch',.3,.3,.2,1),hand('pinch',.7,.3,.2,2)));assert.equal(c.board.strokes.length,0);assert.equal(c.board.drawing,false);
 c.update(frame(99,hand('pinch',.3,.3,.2,1)));assert.equal(c.board.strokes.length,0);
 c.update(frame(132,hand('open',.3,.3,.2,1)));c.update(frame(165,hand('pinch',.3,.3,.2,1)));assert.equal(c.board.strokes.length,1);
 const d=new InkController();d.update(frame(0,hand('pinch',.2,.3,.2,1)));d.update(frame(33,hand('pinch',.2,.3,.2,1),hand('pinch',.7,.3,.2,2)));assert.equal(d.board.strokes.length,1);
});
