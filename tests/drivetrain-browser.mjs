// Run with: PORT=4195 node server.mjs, then npx tsx tests/drivetrain-browser.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {posedHand} from './hand-fixtures.ts';
const base=process.env.STUDIO_URL||'http://localhost:4195';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'])]});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// Until src/control.ts lists /drivetrain among the shared mirror pages, the relay sees it as the shapes workspace and refuses ownership. A no-op once it does.
await page.addInitScript(()=>{const send=WebSocket.prototype.send;WebSocket.prototype.send=function(d){return send.call(this,typeof d==='string'&&location.pathname==='/drivetrain'?d.replace('"workspace":"shapes"','"workspace":"atp"'):d);};});
// The tracker divides y by the camera's aspect, so hands are drawn at it; with no video the stage maps 1:1.
const aspect=16/9,S=.14;
const avg=(h,ids)=>({x:ids.reduce((s,i)=>s+h[i].x,0)/ids.length,y:ids.reduce((s,i)=>s+h[i].y,0)/ids.length});
const features={pinch:[4,8],tip:[8],palm:[0,5,9,13,17]};
/** Raw landmarks for a pose whose pinch, fingertip or palm lands on a stage point (0..1), undoing the mirror. */
function hand(pose,sx,sy,feature='palm',edit){
 const h=posedHand(pose==='closing'?'open':pose);if(pose==='closing'){h[4]={x:-.2,y:-1.95,z:-.1};h[3]={x:-.6,y:-1.5,z:0};}edit?.(h);
 const o=avg(h,features[feature]),x=1-sx-o.x*S,y=sy-o.y*S*aspect;
 return h.map(p=>({x:x+p.x*S,y:y+p.y*S*aspect,z:p.z*S}));
}
/** One tracker update per rendered frame, so a pose event is never dropped under load. */
const feed=hands=>page.evaluate(h=>{window.testHands=h;if(window.testFeed)return;window.testFeed=true;const loop=()=>{if(!window.testFeed)return;if(window.testPath?.length)window.testHands=window.testPath.shift();window.__drivetrain.hands(window.testHands);requestAnimationFrame(loop);};loop();},hands);
const path=async frames=>{await page.evaluate(f=>{window.testPath=f;},frames.slice(1));await feed(frames[0]);await until(()=>!window.testPath.length,null,30000);};
const clear=async(ms=450)=>{await page.evaluate(()=>{window.testFeed=false;window.testPath=[];});await page.waitForTimeout(ms);};
const get=(fn,arg)=>page.evaluate(fn,arg);
const until=(fn,arg,timeout=12000)=>page.waitForFunction(fn,arg,{timeout}).catch(async e=>{console.error(await page.evaluate(()=>{const t=__drivetrain.train;return JSON.stringify({poses:__drivetrain.frame.hands.map(h=>h.pose),carry:t.carry&&{item:t.carry.item,snap:t.carry.snap},parts:t.build.parts,acks:t.acks.map(a=>a.text),mode:t.mode,rings:t.rings});}));throw e;});
const shots=process.env.SHOTS,shot=name=>shots?page.screenshot({path:`${shots}/drivetrain-${name}.png`}):null;
/** A board point (mm) as a stage fraction. */
const at=(x,y)=>page.evaluate(([x,y])=>{const v=__drivetrain.view,p=v.boardToScreen(x,y),s=v.size;return [p.x/s.width,p.y/s.height];},[x,y]);
const tile=id=>page.evaluate(i=>{const t=__drivetrain.train.tiles.find(x=>x.id===i);return [t.x,t.y];},id);
const shaftOf=id=>page.evaluate(i=>{const t=__drivetrain.train,p=t.build.parts.find(q=>q.id===i);const s=t.build.shafts.find(q=>q.id===p.shaft);return [s.x,s.y];},id);
const lerp=(a,b,n)=>Array.from({length:n+1},(_,i)=>[a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n]);
/** Pinch at one board point, carry along a line, let go. */
async function carry(from,to,steps=14){
 const a=await at(...from),b=await at(...to);
 await feed([hand('pinch',...a,'pinch')]);await until(()=>!!__drivetrain.train.carry,null,4000);
 await path(lerp(a,b,steps).map(p=>[hand('pinch',...p,'pinch')]));await page.waitForTimeout(120);
 const snap=await get(()=>__drivetrain.train.carry?.snap);
 await feed([hand('open',...b,'pinch')]);await until(()=>!__drivetrain.train.carry,null,4000);await clear(150);
 return snap;
}
const lastPart=()=>get(()=>__drivetrain.train.build.parts.at(-1).id);
/** A held pose, until the behaviour reports it fired. */
async function hold(pose,point,feature,done,arg){await feed([hand(pose,...point,feature)]);await until(done,arg,6000);await clear();}
async function clap(){await feed([hand('open',.2,.5),hand('open',.8,.5)]);await page.waitForTimeout(350);await feed([hand('open',.45,.5),hand('open',.55,.5)]);await until(()=>__drivetrain.engine.live.shocks.length>0,null,6000);await clear(300);}
const view=()=>get(()=>JSON.stringify({v:__drivetrain.state.view,zoom:__drivetrain.view.cameraZoom,cam:__drivetrain.view.camera.position.toArray(),root:__drivetrain.view.root.matrixWorld.elements.map(n=>+n.toFixed(6))}));
try{
 await page.goto(base+'/drivetrain');await until(()=>window.__drivetrain?.ready&&window.__drivetrain.owns&&document.querySelector('.dt-card h2'),null,30000);
 assert.match(await page.title(),/Drivetrain/);
 // UX 1: nothing moves the camera by itself. Five idle seconds, every frame the same.
 const idle=await view();for(let i=0;i<10;i++){await page.waitForTimeout(500);assert.equal(await view(),idle,'camera moved while idle');}
 const [ix,iy]=await get(()=>[-178,34]);
 // UX 4: fingers closing over a tray tile show a reticle and light the tile before the pinch closes.
 const t12=await tile('part0'),s12=await at(...t12);
 await feed([hand('closing',...s12,'pinch')]);await until(()=>__drivetrain.train.reticles.length>0&&__drivetrain.train.candidate==='tile:part0');
 assert.equal(await get(()=>__drivetrain.train.exploded),false,'a reaching open hand does not explode');await page.waitForTimeout(900);assert.equal(await get(()=>__drivetrain.train.exploded),false,'still not after a long reach');await clear();
 // 🤏 Pick the 12T, see its ghost on the input shaft, let go: it snaps on.
 const snap=await carry(t12,[ix+6,iy-5]);assert.ok(snap.ok&&snap.shaft===1,JSON.stringify(snap));
 assert.deepEqual(await get(()=>__drivetrain.train.build.parts.map(p=>[p.kind,p.z,p.shaft])),[['gear',12,1]]);
 // A miss is acknowledged at once.
 const empty=await at(150,120);await feed([hand('pinch',...empty,'pinch')]);await until(()=>__drivetrain.train.acks.some(a=>/Nothing to pick/.test(a.text)),null,2000);await clear();
 // UX 5: a pinch that flickers open for a moment keeps its part. Then the 36T lands at exactly (12+36)·2.5/2 from the input.
 const t36=await tile('part4'),a36=await at(...t36),mid=await at(ix+50,iy+40),b36=await at(ix+64,iy+10);
 await feed([hand('pinch',...a36,'pinch')]);await until(()=>!!__drivetrain.train.carry);await path(lerp(a36,mid,10).map(p=>[hand('pinch',...p,'pinch')]));
 await feed([hand('open',...mid,'pinch')]);await page.waitForTimeout(170);await feed([hand('pinch',...mid,'pinch')]);await page.waitForTimeout(150);
 assert.ok(await get(()=>!!__drivetrain.train.carry),'the flicker did not drop the gear');assert.equal(await get(()=>__drivetrain.train.build.parts.length),1);
 await path(lerp(mid,b36,6).map(p=>[hand('pinch',...p,'pinch')]));await page.waitForTimeout(100);
 assert.equal(await get(()=>__drivetrain.train.carry.snap.reason),'Meshed with the 12T');
 await feed([hand('open',...b36,'pinch')]);await until(()=>!__drivetrain.train.carry);await clear(150);
 const g36=await lastPart(),c36=await shaftOf(g36);assert.ok(Math.abs(Math.hypot(c36[0]-ix,c36[1]-iy)-60)<1e-6,`centre distance ${Math.hypot(c36[0]-ix,c36[1]-iy)}`);
 // The output hand on the 36T meets the first brief.
 await carry(await tile('part9'),[c36[0]+4,c36[1]-3]);
 await until(()=>__drivetrain.train.verdict.met);assert.equal(await page.locator('.dt-banner').isVisible(),true);assert.match(await page.locator('.dt-card').textContent(),/Met/);
 assert.ok(await get(()=>Math.abs(__drivetrain.train.sol.ratio(__drivetrain.train.build.parts.at(-1).id)+1/3)<1e-9));
 await feed([hand('thumbUp',.5,.45)]);await until(()=>__drivetrain.train.omega>5);await clear(150);await page.waitForTimeout(500);await shot('brief-met');await feed([hand('thumbUp',.5,.45)]);await until(()=>__drivetrain.train.motor===0);await clear();
 // ☝️ Inspect: teeth, speed and torque on the part, arrows along the power path.
 const on36=await at(c36[0]+20,c36[1]+20);await feed([hand('point',...on36,'tip')]);
 await until(()=>/36T/.test(__drivetrain.engine.live.label?.title??'')&&document.querySelectorAll('.dt-power').length>0);
 assert.match(await get(()=>__drivetrain.engine.live.label.detail),/rpm.*N·m.*tooth load/);await clear();
 // 👍 motor on, 👎 backwards, 👎 again off.
 const chest=[.5,.45];
 await feed([hand('thumbUp',...chest)]);await until(()=>__drivetrain.train.omega>5);await clear();
 await feed([hand('thumbDown',...chest)]);await until(()=>__drivetrain.train.omega<-3);await clear();
 await feed([hand('thumbDown',...chest)]);await until(()=>__drivetrain.train.motor===0);await clear();await until(()=>Math.abs(__drivetrain.train.omega)<.05);
 // ✊ on the crank turns the train with the hand, and the view stays where it was.
 const before=await view(),turn0=await get(()=>__drivetrain.train.theta),knob=[];
 for(let i=0;i<=24;i++){const a=i/24*Math.PI*1.5;knob.push(await at(ix+58*Math.cos(a),iy+58*Math.sin(a)));}
 await feed([hand('fist',...knob[0])]);await until(()=>__drivetrain.train.crankHand!==null);await path(knob.map(p=>[hand('fist',...p)]));
 const turned=await get(()=>__drivetrain.train.theta)-turn0;assert.ok(turned>3,`cranked ${turned}`);assert.equal(await view(),before,'cranking never moves the view');await clear();
 // ✊ off the train is the shared hold: the user turns the view, and only then does it move.
 await feed([hand('fist',.75,.5)]);await page.waitForTimeout(250);await feed([hand('fist',.8,.5)]);await page.waitForTimeout(300);await clear();
 assert.notEqual(await view(),before,'a fist off the train holds the view');await page.locator('#drivetrain-recenter').click();await page.waitForTimeout(100);
 // 🤟 held: the schematic, with the arithmetic on the mesh.
 await hold('love',chest,'palm',()=>__drivetrain.train.schematic);await until(()=>__drivetrain.train.schematicU>.95&&/12 : 36/.test(document.querySelector('.dt-labels').textContent));await shot('schematic');
 await hold('love',chest,'palm',()=>!__drivetrain.train.schematic);
 // 🖐 held: explode to the side and back.
 await hold('open',chest,'palm',()=>__drivetrain.train.exploded);await until(()=>__drivetrain.train.explodeU>.9);await hold('open',chest,'palm',()=>!__drivetrain.train.exploded);
 // Next brief through the tray, then the hour hand: a compound train, built by mouse for speed.
 const next=await at(...await tile('next'));await feed([hand('pinch',...next,'pinch')]);await until(()=>__drivetrain.train.brief===1);await clear();
 await page.evaluate(()=>__drivetrain.train.setBrief(2));
 const drop=(i,x,y)=>page.evaluate(([i,x,y])=>{const t=__drivetrain.train,tile=t.tiles.find(q=>q.id===`part${i}`);t.pointerDown([tile.x,tile.y],1);t.pointerMove([x,y]);t.pointerUp();return t.build.parts.at(-1);},[i,x,y]);
 await drop(0,ix,iy);const w48=await drop(5,ix+75,iy);const s48=await shaftOf(w48.id);await drop(0,...s48);
 const idl=await drop(1,s48[0],s48[1]+40);const sid=await shaftOf(idl.id);const o36=await drop(4,sid[0]+65,sid[1]);const so=await shaftOf(o36.id);await drop(9,...so);
 assert.ok(await get(i=>Math.abs(__drivetrain.train.sol.ratio(i)+1/12)<1e-9,o36.id),'hour hand ratio '+await get(()=>JSON.stringify(__drivetrain.train.build)));
 // ✌️ held on the compound shaft frees its pinion; 👎 undoes.
 const onc=await at(...s48);await feed([hand('victory',...onc,'tip')]);await until(i=>__drivetrain.train.build.parts.some(p=>p.kind==='gear'&&p.shaft===i&&!p.keyed),(await get(()=>__drivetrain.train.build.parts.find(p=>p.kind==='gear'&&p.layer===1).shaft)),6000);await clear();
 assert.equal(await get(i=>__drivetrain.train.sol.ratio(i),o36.id),0,'a freed pinion drives nothing');
 await feed([hand('thumbDown',...chest)]);await until(()=>__drivetrain.train.build.parts.every(p=>p.kind!=='gear'||p.keyed));await clear();
 // 👐 Overload: this train holds, which the brief needs.
 await clap();await until(()=>__drivetrain.train.verdict.met);assert.equal(await get(()=>__drivetrain.train.spike.broke),false);
 // ✊✊ on the output gear shrinks it to 18 teeth; its neighbour re-spaces and stays in mesh.
 const g=await at(...so),meshesBefore=await get(()=>__drivetrain.train.sol.meshes.length),gx=g[0],gy=g[1];
 await feed([hand('fist',gx-.07,gy),hand('fist',gx+.07,gy)]);await until(()=>!!__drivetrain.train.stretch);
 for(let i=1;i<=10;i++){await feed([hand('fist',gx-.07+i*.0035,gy),hand('fist',gx+.07-i*.0035,gy)]);await page.waitForTimeout(40);}
 await until(i=>__drivetrain.train.shown.parts.find(p=>p.id===i).z<=20,o36.id);await clear();
 const z=await get(i=>__drivetrain.train.build.parts.find(p=>p.id===i).z,o36.id);assert.ok(z<=20,`stretched to ${z}`);
 assert.equal(await get(()=>__drivetrain.train.sol.meshes.length),meshesBefore,'re-spaced, still meshed');
 // 👐 again: the small final gear cannot take it, the weakest tooth snaps.
 await clap();await until(()=>__drivetrain.train.sol.broken);assert.equal(await get(()=>__drivetrain.train.spike.broke),true);
 await page.waitForTimeout(250);await shot('overload-break');
 assert.match(await page.locator('.dt-toast').textContent(),/tooth broke/);
 await feed([hand('thumbDown',...chest)]);await until(()=>!__drivetrain.train.sol.broken);await clear();
 // 🤏🤏 pull the idler and the output apart; 👎 puts them back.
 const pIdler=await at(sid[0],sid[1]+8),pOut=await at(so[0]+6,so[1]);
 await feed([hand('pinch',...pIdler,'pinch'),hand('pinch',...pOut,'pinch')]);await until(()=>!!__drivetrain.train.pull);
 const dx=pOut[0]-pIdler[0],dy=pOut[1]-pIdler[1],dl=Math.hypot(dx,dy);
 for(let i=1;i<=10;i++){await feed([hand('pinch',...pIdler,'pinch'),hand('pinch',pOut[0]+dx/dl*.01*i,pOut[1]+dy/dl*.01*i,'pinch')]);await page.waitForTimeout(40);}
 const m0=await get(()=>__drivetrain.train.sol.meshes.length);await clear();await until(m=>__drivetrain.train.sol.meshes.length<m,m0);
 await feed([hand('thumbDown',...chest)]);await until(m=>__drivetrain.train.sol.meshes.length===m,m0);await clear();
 // Recenter repairs the last destructive change too.
 // Draw the motion: pinch the tray's draw tile.
 await page.evaluate(()=>__drivetrain.train.setBrief(4));const dt=await at(...await tile('draw'));await feed([hand('pinch',...dt,'pinch')]);await until(()=>__drivetrain.train.mode==='draw');await clear();
 // ☝️ trace a closed bean shape in the air.
 const loop=[];for(let i=0;i<=90;i++){const a=i/90*Math.PI*2,r=1+.28*Math.cos(2*a)+.12*Math.sin(a);loop.push(await at(40+95*r*Math.cos(a),20+55*r*Math.sin(a)));}
 await feed([hand('point',...loop[0],'tip')]);await until(()=>__drivetrain.train.drawing!==null);await path(loop.map(p=>[hand('point',...p,'tip')]));await clear();
 await until(()=>__drivetrain.train.closed);
 // 👍 held: a four-bar that redraws it.
 await hold('thumbUp',chest,'palm',()=>__drivetrain.train.matches.length===3,null);
 assert.ok(await get(()=>__drivetrain.train.match.err<.05),`fit ${await get(()=>__drivetrain.train.match.err)}`);
 await until(()=>__drivetrain.train.trace.length>120);await shot('drawn-linkage');
 // 🖐 held: the next match.
 await hold('open',chest,'palm',()=>__drivetrain.train.matchIndex===1);
 // 👐 a second linkage chained on: a walking leg.
 await clap();await until(()=>!!__drivetrain.train.leg&&__drivetrain.train.legU>.9);await shot('walking-leg');
 // ✌️ held clears; 👎 brings it back.
 await hold('victory',chest,'tip',()=>!__drivetrain.train.stroke.length);await feed([hand('thumbDown',...chest)]);await until(()=>__drivetrain.train.stroke.length>0&&__drivetrain.train.matches.length===3);await clear();
 // 🤏🤏 and ✊✊ in the drawing studio are acknowledged, not silently dropped.
 await feed([hand('pinch',.4,.5,'pinch'),hand('pinch',.6,.5,'pinch')]);await until(()=>__drivetrain.train.acks.some(a=>/Pinch is for building/.test(a.text)),null,3000);await clear();
 // ✊ on the linkage crank turns it by hand.
 const o2=await get(()=>__drivetrain.train.linkPose().O2),lt=await get(()=>__drivetrain.train.linkTheta),ring=[];
 const rr=await get(()=>{const m=__drivetrain.train.match;return m.linkage.a*Math.hypot(...m.fit.z);});
 for(let i=0;i<=16;i++){const a=i/16*Math.PI;ring.push(await at(o2[0]+rr*Math.cos(a),o2[1]+rr*Math.sin(a)));}
 await feed([hand('fist',...ring[0])]);await until(()=>__drivetrain.train.linkHand!==null);await path(ring.map(p=>[hand('fist',...p)]));
 assert.ok(Math.abs(await get(()=>__drivetrain.train.linkTheta)-lt)>1,'the linkage crank turned');await clear();
 // The view never zoomed by itself through all of that.
 assert.equal(await get(()=>__drivetrain.state.view.zoom),1);
 await page.locator('#drivetrain-sources').click();const about=await page.locator('#drivetrain-about').textContent();assert.match(about,/Lewis/);assert.match(about,/four-bar/);assert.match(about,/What is not/);await page.locator('#drivetrain-about-close').click();
 assert.deepEqual(errors,[]);
 console.log('Drivetrain passed: idle camera still 5 s, reticle, pick and snap, miss ack, flicker grace, meshing distance, brief met, inspect and power path, motor, reverse, crank by fist, view hold, schematic, explode, next brief, compound free and undo, overload held, stretch and re-space, overload break and repair, pull apart and undo, draw a loop, find linkage, cycle, walking leg, clear and undo, linkage crank, about.');
}finally{await browser.close();}
