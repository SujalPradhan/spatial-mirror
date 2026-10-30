import type {Landmark} from '../src/fist';
// Idealized joint poses for software regression, not recorded camera landmarks.
export function metricHand(closedFingers=0):Landmark[]{
 const h=Array.from({length:21},()=>({x:0,y:0,z:0}));
 h[1]={x:-.5,y:.3,z:0};h[2]={x:-.8,y:.6,z:0};h[3]={x:-.9,y:.9,z:0};h[4]={x:-1,y:1.1,z:0};
 for(const [i,mcp] of [5,9,13,17].entries()){
  const x=(i-1.5)*.3;h[mcp]={x,y:1,z:0};h[mcp+1]={x,y:1.6,z:0};
  h[mcp+2]={x,y:i<closedFingers?1.5:2,z:i<closedFingers?-.45:0};h[mcp+3]={x,y:i<closedFingers?1:2.4,z:i<closedFingers?-.45:0};
 }
 return h;
}
export function imageHand(closedFingers=0):Landmark[]{return metricHand(closedFingers).map(p=>({x:.5+p.x*.14,y:.75-p.y*.16,z:p.z*.14}));}
export type PoseName='open'|'fist'|'pinch'|'tightPinch'|'point'|'victory'|'thumbUp'|'thumbDown'|'love';
/** Y-down like real landmarks, unlike metricHand: thumb direction depends on it. */
export function posedHand(pose:PoseName):Landmark[]{
 const up=pose==='thumbUp'||pose==='thumbDown',open:Record<PoseName,boolean[]>={open:[true,true,true,true],fist:[false,false,false,false],pinch:[true,true,true,true],tightPinch:[true,false,false,false],point:[true,false,false,false],victory:[true,true,false,false],thumbUp:[false,false,false,false],thumbDown:[false,false,false,false],love:[true,false,false,true]};
 const h=Array.from({length:21},()=>({x:0,y:0,z:0}));
 h[1]={x:-.5,y:-.3,z:0};h[2]={x:-.8,y:-.6,z:0};
 if(up){h[3]={x:-.85,y:-1.2,z:0};h[4]={x:-.9,y:-1.8,z:0};}
 else if(pose==='love'){h[3]={x:-1.2,y:-.75,z:0};h[4]={x:-1.7,y:-.85,z:0};}
 else {h[3]={x:-.9,y:-.9,z:0};h[4]={x:-1,y:-1.1,z:0};}
 for(const [i,mcp] of [5,9,13,17].entries()){
  const x=(i-1.5)*.3,straight=open[pose][i];h[mcp]={x,y:-1,z:0};h[mcp+1]={x,y:-1.6,z:0};
  h[mcp+2]={x,y:straight?-2:-1.5,z:straight?0:-.45};h[mcp+3]={x,y:straight?-2.4:-1,z:straight?0:-.45};
 }
 if(pose==='pinch'||pose==='tightPinch'){h[7]={x:-.45,y:-1.75,z:-.25};h[8]={x:-.45,y:-1.7,z:-.5};h[3]={x:-.6,y:-1.2,z:-.2};h[4]={x:-.5,y:-1.7,z:-.45};}
 return pose==='thumbDown'?h.map(p=>({...p,y:-p.y})):h;
}
export const imagePose=(pose:PoseName,x=.5,y=.75)=>posedHand(pose).map(p=>({x:x+p.x*.14,y:y+p.y*.16,z:p.z*.14}));
