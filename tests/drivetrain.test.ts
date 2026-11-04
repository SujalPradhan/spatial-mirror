import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD,INPUT_AT,MODULE,SHOCK,anyClash,clash,crankPin,centreDistance,cloneBuild,emptyBuild,fraction,gearOutline,gearsOn,meshes,pitchR,place,remove,respace,sliderAt,snapGear,snapLink,solve,tipR,toothStrength,type Build,type Gear,type Item} from '../src/drivetrain/gears';
import {Atlas,align,chainLeg,couplerCurve,crossing,descriptor,grashofCrank,legPose,pose,resample,type FourBar,type V} from '../src/drivetrain/fourbar';
import {briefs,judge} from '../src/drivetrain/briefs';

const near=(a:number,b:number,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} ≉ ${b}`);
/** Drops a gear and asserts it snapped. */
function drop(b:Build,z:number,x:number,y:number){const s=snapGear(b,z,x,y);assert.ok(s.ok,s.reason);return place(b,{kind:'gear',z},s);}
const linkAt=(b:Build,item:Item,x:number,y:number)=>{const sol=solve(b),s=snapLink(b,item,x,y,20,sol,0);assert.ok(s.ok,s.reason);return place(b,item,s);};
const [ix,iy]=INPUT_AT;

test('centre distance is (z1+z2)·m/2 and the outline reaches the tip circle',()=>{
 assert.equal(centreDistance(12,36),(12+36)*MODULE/2);assert.equal(centreDistance(24,24),60);
 for(const z of [10,12,24,48]){
  const pts=gearOutline(z),r=pts.map(p=>Math.hypot(...p));
  near(Math.max(...r),tipR(z),1e-6);assert.ok(Math.min(...r)<pitchR(z)-MODULE);
  // Every tooth is there: count crossings of the pitch circle.
  let cross=0;for(let i=0;i<pts.length;i++){const a=Math.hypot(...pts[i])-pitchR(z),b=Math.hypot(...pts[(i+1)%pts.length])-pitchR(z);if(a*b<0)cross++;}
  assert.equal(cross,2*z);
 }
 const broken=gearOutline(12,MODULE,0).map(p=>Math.hypot(...p));assert.ok(Math.max(...broken)>pitchR(12));
});
test('a dropped gear snaps to the exact meshing distance from its neighbour, on the side it was dropped',()=>{
 const b=emptyBuild();drop(b,12,ix+2,iy-3);
 assert.deepEqual(gearsOn(b,1).map(g=>g.z),[12],'a gear dropped near the input shaft goes on it');
 drop(b,36,ix+60,iy+8);
 const g=b.parts[1] as Gear,s=b.shafts.find(x=>x.id===g.shaft)!;
 near(Math.hypot(s.x-ix,s.y-iy),centreDistance(12,36));assert.ok(s.x>ix&&s.y>iy);
 assert.equal(meshes(b).length,1);
});
test('ratio and direction: each mesh flips, magnitudes multiply, idlers only flip',()=>{
 const b=emptyBuild();const a=drop(b,12,ix,iy),c=drop(b,36,ix+60,iy);const sol=solve(b);
 near(sol.ratio(a),1);near(sol.ratio(c),-1/3);assert.equal(fraction(sol.ratio(c)),'×1/3');
 const idler=drop(b,16,ix+60+centreDistance(36,16),iy),out=drop(b,24,ix+60+centreDistance(36,16)+centreDistance(16,24),iy);
 const s2=solve(b);near(s2.ratio(idler),.75);near(s2.ratio(out),-.5,1e-9);
 // Without the idler the 24 would turn the input's way: the idler only flips it.
 near(-(36/24)*s2.ratio(c),.5);
});
test('teeth phase: at the contact point a tooth of one faces a gap of the other, at any angle',()=>{
 const b=emptyBuild();const a=drop(b,12,ix,iy),c=drop(b,30,ix+40,iy+30);const sol=solve(b),m=sol.meshes[0];
 for(const theta of [0,.3,1.7,4]){
  const ta=sol.angle(a,theta),tc=sol.angle(c,theta),psi=m.angle;
  // Angle of the nearest tooth to the line of centres, measured from each side.
  const off=(t:number,z:number,dir:number)=>{const u=((dir-t)%(2*Math.PI/z)+2*Math.PI/z)%(2*Math.PI/z);return Math.min(u,2*Math.PI/z-u)*z/(2*Math.PI);};
  near(off(ta,12,psi)+off(tc,30,psi+Math.PI),.5,1e-6);
 }
});
test('a third gear in a ring of three locks the train',()=>{
 const b=emptyBuild();drop(b,24,ix,iy);drop(b,24,ix+60,iy);
 // Both circles reach: it meshes with both, closing a loop of three.
 const s=snapGear(b,24,ix+30,iy+52);assert.ok(s.ok);assert.equal(s.meshes.length,2);place(b,{kind:'gear',z:24},s);
 assert.equal(solve(b).jammed,true);
});
test('clashes are refused and a stacked gear compounds on its shaft',()=>{
 const b=emptyBuild();drop(b,48,ix,iy);
 assert.ok(snapGear(b,24,ix+40,iy-90).ok,'pulled onto the meshing circle');
 assert.ok(clash(b,24,ix+50,iy,0),'overlapping teeth clash');assert.equal(clash(b,24,ix+90,iy,0),null,'meshing teeth do not');
 const top=drop(b,12,ix+1,iy+1);assert.equal((b.parts.find(p=>p.id===top) as Gear).layer,1);
 assert.equal(snapGear(b,12,ix,iy).ok,false,'only two layers');
 assert.equal(snapGear(b,24,BOARD.x1+40,0).ok,false,'off the board');
 assert.equal(snapGear(b,24,0,BOARD.tray-20).reason,'Back to the tray');
 const big=emptyBuild();drop(big,24,ix,iy);const p=snapGear(big,24,ix+40,iy);assert.ok(p.ok);assert.ok(Math.abs(Math.hypot(p.x-ix,p.y-iy)-60)<1e-6,'pushed out to mesh, not overlapping');
});
test('the hour-hand brief is met by a compound train, and its load is carried by the big gears',()=>{
 const b=emptyBuild(),brief=briefs.find(x=>x.id==='clock')!;
 drop(b,12,ix,iy);const g48=drop(b,48,ix+centreDistance(12,48),iy);
 const g48s=(b.parts.find(p=>p.id===g48) as Gear).shaft,s48=b.shafts.find(s=>s.id===g48s)!;
 drop(b,12,s48.x,s48.y);
 const idler=drop(b,16,s48.x,s48.y+centreDistance(12,16)+1);
 const is=b.shafts.find(s=>s.id===(b.parts.find(p=>p.id===idler) as Gear).shaft)!;
 const out=drop(b,36,is.x+centreDistance(16,36),is.y);
 const os=(b.parts.find(p=>p.id===out) as Gear).shaft,o=b.shafts.find(s=>s.id===os)!;
 linkAt(b,{kind:'hand'},o.x,o.y);
 const sol=solve(b,{hand:brief.load,slider:0});near(sol.ratio(out),-1/12);
 const v=judge(brief,b,sol,false);assert.equal(v.met,false,'needs the shock test');assert.ok(v.checks.filter(c=>!c.ok).every(c=>/shock/.test(c.label)),JSON.stringify(v.checks));
 const worst=Math.max(...sol.loads.map(l=>l.use));assert.ok(worst*SHOCK<1,`survives: ${worst*SHOCK}`);
 assert.equal(judge(brief,b,sol,true).met,true);
 // Torque grows as speed falls: power in equals power out.
 near(sol.inputTorque,brief.load/12,1e-9);
});
test('a small final gear breaks under the shock, a big one holds',()=>{
 const make=(zout:number)=>{const b=emptyBuild();drop(b,12,ix,iy);const g=drop(b,zout,ix+centreDistance(12,zout),iy);const s=b.shafts.find(x=>x.id===(b.parts.find(p=>p.id===g) as Gear).shaft)!;linkAt(b,{kind:'hand'},s.x,s.y);return Math.max(...solve(b,{hand:2,slider:0}).loads.map(l=>l.use))*SHOCK;};
 assert.ok(make(18)>1,'18T final breaks');assert.ok(make(48)<1,'48T final holds');
 assert.ok(toothStrength(12)<toothStrength(48));
});
test('slider-crank: stroke is twice the throw, and the rod length is kept',()=>{
 const b=emptyBuild();drop(b,12,ix,iy);const g=drop(b,24,ix+centreDistance(12,24),iy);const s=b.shafts.find(x=>x.id===(b.parts.find(p=>p.id===g) as Gear).shaft)!;
 const c=linkAt(b,{kind:'crank',throw:20},s.x,s.y);let sol=solve(b);
 const pin=crankPin(b,b.parts.find(p=>p.id===c) as any,sol.angle(c,0));linkAt(b,{kind:'rod'},pin[0]+3,pin[1]);sol=solve(b);
 const rod=b.parts.find(p=>p.kind==='rod')!;assert.ok(rod);
 const end=[pin[0]+100*Math.cos((rod as any).angle),pin[1]+100*Math.sin((rod as any).angle)];linkAt(b,{kind:'slider'},end[0]+4,end[1]-3);sol=solve(b);
 const slider=b.parts.find(p=>p.kind==='slider') as any;let lo=Infinity,hi=-Infinity;
 for(let t=0;t<Math.PI*4;t+=.01){const at=sliderAt(b,slider,sol,t);lo=Math.min(lo,at.along);hi=Math.max(hi,at.along);}
 near(hi-lo,40,.05);near(sol.ratio(c),-1/2);
 const v=judge(briefs.find(x=>x.id==='stroke')!,b,sol,false);assert.equal(v.met,true,JSON.stringify(v.checks));
});
test('two hands in opposite directions at 2:1, one on the input shaft',()=>{
 const b=emptyBuild();drop(b,24,ix,iy);const g=drop(b,12,ix+centreDistance(24,12),iy);const s=b.shafts.find(x=>x.id===(b.parts.find(p=>p.id===g) as Gear).shaft)!;
 linkAt(b,{kind:'hand'},ix,iy);linkAt(b,{kind:'hand'},s.x,s.y);
 const v=judge(briefs.find(x=>x.id==='pair')!,b,solve(b),true);assert.equal(v.met,true,JSON.stringify(v.checks));
});
test('removing a gear takes the hand on its shaft; stretching re-spaces the neighbours',()=>{
 const b=emptyBuild();drop(b,12,ix,iy);const g=drop(b,24,ix+45,iy+10);const s=b.shafts.find(x=>x.id===(b.parts.find(p=>p.id===g) as Gear).shaft)!;linkAt(b,{kind:'hand'},s.x,s.y);
 const copy=cloneBuild(b);assert.equal(remove(copy,g).length,2);assert.equal(copy.shafts.length,1);
 const before=Math.atan2(s.y-iy,s.x-ix),was=solve(b);(b.parts[0] as Gear).z=20;respace(b,was);
 const t=b.shafts.find(x=>x.id===s.id)!;near(Math.hypot(t.x-ix,t.y-iy),centreDistance(20,24));near(Math.atan2(t.y-iy,t.x-ix),before);
 assert.equal(solve(b).meshes.length,1);assert.equal(anyClash(b),false);
});
test('stretching a gear deep in the train re-spaces only what it drives',()=>{
 const b=emptyBuild();drop(b,12,ix,iy);const g48=drop(b,48,ix+75,iy);const s48=b.shafts.at(-1)!;drop(b,12,s48.x,s48.y);
 const idler=drop(b,16,s48.x,s48.y+40);const si=b.shafts.at(-1)!;const out=drop(b,36,si.x+65,si.y);const so=b.shafts.at(-1)!;
 const was=solve(b),n=was.meshes.length,idlerAt=[si.x,si.y];assert.equal(n,3);
 (b.parts.find(p=>p.id===out) as Gear).z=18;respace(b,was);
 assert.equal(solve(b).meshes.length,n,'every mesh kept');near(Math.hypot(so.x-si.x,so.y-si.y),centreDistance(16,18));
 assert.deepEqual([si.x,si.y],idlerAt,'the idler stays');void g48;void idler;
});

const crank:FourBar={g:1,a:.3,b:1.1,c:.9,p:.6,q:.4,branch:1};
test('four-bar closed form keeps every link its length',()=>{
 assert.ok(grashofCrank(crank));
 for(let t=0;t<Math.PI*2;t+=.1){
  const s=pose(crank,t)!;assert.ok(s);
  near(Math.hypot(...s.A),crank.a,1e-9);near(Math.hypot(s.B[0]-s.A[0],s.B[1]-s.A[1]),crank.b,1e-9);near(Math.hypot(s.B[0]-1,s.B[1]),crank.c,1e-9);
  near(Math.hypot(s.P[0]-s.A[0],s.P[1]-s.A[1]),Math.hypot(crank.p,crank.q),1e-9);
 }
 assert.equal(pose({...crank,b:.2,c:.2},2),null,'cannot close');
 assert.equal(crossing([0,0],1,[5,0],1,1),null);
});
test('descriptors ignore place, size, turn, start, direction and mirror',()=>{
 const C=resample(couplerCurve(crank)!),f=descriptor(C);
 const moved=C.map(([x,y]):V=>[3+2*(x*Math.cos(1)-y*Math.sin(1)),-1+2*(x*Math.sin(1)+y*Math.cos(1))]);
 const shifted=[...moved.slice(17),...moved.slice(0,17)],backwards=[...shifted].reverse(),mirrored=backwards.map(([x,y]):V=>[x,-y]);
 for(const g of [shifted,backwards,mirrored]){const h=descriptor(resample(g));for(let i=0;i<f.length;i++)near(h[i],f[i],3e-3);}
 const fit=align(resample(mirrored),C);assert.ok(fit.err<1e-3,`refit ${fit.err}`);assert.equal(fit.mirror,true);near(Math.hypot(...fit.z),2,1e-2);
});
test('the atlas finds a linkage that redraws a coupler curve it never saw, and a circle',()=>{
 const atlas=Atlas.build(2500);assert.ok(atlas.bytes<2e6,`${atlas.bytes} bytes`);
 const target=resample(couplerCurve({g:1,a:.27,b:1.35,c:1.05,p:.4,q:.65,branch:1})!).map(([x,y]):V=>[100+80*x,40+80*y]);
 const t0=performance.now(),m=atlas.match(target);assert.ok(performance.now()-t0<4000);
 assert.equal(m.length,3);assert.ok(m[0].err<.01,`best ${m[0].err}`);assert.ok(m[0].err<=m[2].err);
 const circle=Array.from({length:80},(_,i):V=>[60*Math.cos(i/80*Math.PI*2),40*Math.sin(i/80*Math.PI*2)]);
 assert.ok(atlas.match(circle,1)[0].err<.01,'an ellipse is easy');
});
test('a chained leg has a flat stance',()=>{
 const path=Array.from({length:64},(_,i)=>pose(crank,i/64*Math.PI*2)!.P).map(([x,y]):V=>[100*x,100*y]);
 const r=chainLeg(path)!;assert.ok(r,'found a leg');
 const ys=r.feet.map(p=>p[1]),low=Math.min(...ys),lift=Math.max(...ys)-low,stance=r.feet.filter(p=>p[1]<low+lift*.1);
 assert.ok(stance.length>=16,`${stance.length} stance samples`);
 for(const P of path){const s=legPose(P,r.leg)!;near(Math.hypot(s.knee[0]-P[0],s.knee[1]-P[1]),r.leg.thigh,1e-6);near(Math.hypot(s.knee[0]-r.leg.G[0],s.knee[1]-r.leg.G[1]),r.leg.shin,1e-6);}
});
