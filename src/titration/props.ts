import {BENCH_Y,BURETTE,TILE_TOP} from './glassware';

/** Everything the student can pick up. x and y are the centre; half is half the height, and r how close a pinch must land. */
export interface PropDef {id:string;half:number;r:number;home:{x:number;y:number}}
const on=(half:number,x:number)=>({x,y:BENCH_Y+half});
export const props:PropDef[]=[
 {id:'goggles',half:.3,r:.8,home:on(.3,-4.1)},
 {id:'bottle',half:1.15,r:.8,home:on(1.15,3.7)},
 {id:'pipette',half:2.32,r:.6,home:on(2.32,4.35)},
 {id:'dropper-phenolphthalein',half:1,r:.5,home:on(1,-4.3)},
 {id:'dropper-methyl-orange',half:1,r:.5,home:on(1,-3.4)},
 {id:'dropper-universal',half:1,r:.5,home:on(1,-2.5)},
];
export const propById=(id:string)=>props.find(p=>p.id===id)!;
/** Fixed things on the bench the held items work against. */
export const ACID={x:2.7,y:BENCH_Y+.85},FLASK={x:0,y:TILE_TOP+1.5},FUNNEL={x:0,y:BURETTE.top+.5},TAP={x:0,y:1.2};
export const GOGGLES_TOP=4.6;
export const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
/** Distance from a point to the vertical middle line of a prop, so a tall pipette is caught anywhere along its body. */
export function reach(p:{x:number;y:number},def:PropDef,at:{x:number;y:number}){
 const span=Math.max(0,def.half-def.r),y=Math.max(at.y-span,Math.min(at.y+span,p.y));
 return Math.hypot(p.x-at.x,p.y-y);
}
