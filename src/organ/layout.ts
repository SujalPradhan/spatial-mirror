import {families,ingredientById,noteClass,organ} from './ingredients';
/** Everything you touch sits low and central, in stage pixels: the palm above the day ribbon, the vials in a shallow arc above it. */
export interface Px {x:number;y:number}
export interface Slot extends Px {id:string;
 /** Hit radius, never under 30 px, so every target is at least 60 px across. */
 r:number;
 /** Drawn vial height, px. */
 size:number}
/** Space the HUD keeps for the ribbon and the chrome under it. */
export const RIBBON_H=104,RIBBON_BOTTOM=88;
export const palmAt=(W:number,H:number):Px=>({x:W/2,y:Math.max(H*.5,Math.min(H*.7,H-RIBBON_H-RIBBON_BOTTOM-86))});
/** Where pouring lands: a wide band over the palm, so two hands side by side both reach it. */
export function inZone(p:Px,W:number,H:number){const c=palmAt(W,H),rx=Math.max(190,W*.19);return Math.abs(p.x-c.x)<rx&&p.y<c.y+40&&p.y>c.y-H*.5;}
export function slots(ids:string[],W:number,H:number):Slot[]{
 const palm=palmAt(W,H),n=ids.length;
 if(n<=6){
  const gap=Math.min(230,W*.78/Math.max(1,n)),y0=palm.y-Math.min(168,H*.23),size=Math.min(104,H*.14);
  return ids.map((id,k)=>{const d=k-(n-1)/2;return {id,x:palm.x+d*gap,y:y0+d*d*14,r:Math.max(30,Math.min(72,gap*.42)),size};});
 }
 // The full organ: two rows by family, front row lower.
 const per=Math.ceil(n/2),gap=Math.min(104,(W-140)/per),size=Math.min(84,H*.11),rows=[palm.y-Math.min(250,H*.34),palm.y-Math.min(150,H*.2)];
 return ids.map((id,k)=>{const row=k<per?0:1,i=row?k-per:k,m=row?n-per:per,d=i-(m-1)/2;return {id,x:palm.x+d*gap,y:rows[row]+d*d*2,r:Math.max(30,Math.min(60,gap*.46)),size};});
}
/** The full organ's order: by family, then by how long each lasts. */
export const byFamily=(ids:string[])=>[...ids].sort((a,b)=>{const x=ingredientById.get(a)!,y=ingredientById.get(b)!;return families.indexOf(x.family)-families.indexOf(y.family)||x.tau-y.tau;});
/** The dim organ behind: tiers by note, for atmosphere only. */
export const SPAN=136*Math.PI/180;
const byNote=(['top','heart','base'] as const).map(n=>organ.filter(i=>noteClass(i.tau)===n));
export function shelfPlace(i:number){
 const ing=organ[i],tier=['top','heart','base'].indexOf(noteClass(ing.tau)),row=byNote[tier],k=row.indexOf(ing),a=-SPAN/2+SPAN*(k+.5)/row.length,r=3.1+.8*tier;
 return {x:Math.sin(a)*r,y:-1.55+.5*tier,z:-Math.cos(a)*r*.82+.2};
}
