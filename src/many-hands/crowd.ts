export type HandKind='open'|'fist'|'pinch'|'none';
export interface HandTrack {
 id:string;name:string;color:string;
 /** Latest palm position in 0..1 and the pose the phone reported. */
 x:number;y:number;pose:HandKind;conf:number;
 /** When the last message arrived, and when the hand last held a real pose. */
 at:number;lastActive:number;
}
export interface Crowd {n:number;open:number;fist:number;pinch:number;openShare:number;gripShare:number;pullShare:number}

export const HOLD_MS=700,FADE_MS=1300,IDLE_SPEED=10,MAX_SPEED=650;
const PULL_ON=.5,PULL_OFF=.3,PULL_DWELL_MS=400;

export const newTrack=(id:string,name:string,color:string):HandTrack=>({id,name,color,x:.5,y:.5,pose:'none',conf:0,at:-Infinity,lastActive:-Infinity});

export function applyHand(t:HandTrack,m:{x:number;y:number;pose:HandKind;c?:number},now:number){
 t.at=now;t.pose=m.pose;t.conf=m.c??1;
 if(m.pose!=='none'){t.x=m.x;t.y=m.y;t.lastActive=now;}
}
/** Counts toward the crowd only while it keeps reporting a real pose. */
export const isActive=(t:HandTrack,now:number)=>t.pose!=='none'&&now-t.at<=HOLD_MS;
/** Full while active, then fades to nothing about two seconds after the last good pose. */
export function ghostAlpha(t:HandTrack,now:number){
 const idle=now-t.lastActive-HOLD_MS;
 return idle<=0?1:Math.max(0,1-idle/FADE_MS);
}

export function summarize(tracks:Iterable<HandTrack>,now:number):Crowd{
 let open=0,fist=0,pinch=0;
 for(const t of tracks){if(!isActive(t,now))continue;if(t.pose==='open')open++;else if(t.pose==='fist')fist++;else if(t.pose==='pinch')pinch++;}
 const n=open+fist+pinch,share=(k:number)=>n?k/n:0;
 return {n,open,fist,pinch,openShare:share(open),gripShare:share(fist),pullShare:share(pinch)};
}
/** Protons per second falling from all open hands together; it rises with every hand and never quite tops out. */
export const rainRate=(c:Crowd)=>100*(1-Math.exp(-c.open*.03));
/** Rotor degrees per second: a slow idle, a push from open hands, and a bigger one from the share of fists. */
export function rotorSpeed(c:Crowd){
 return Math.min(MAX_SPEED,IDLE_SPEED+300*(1-Math.exp(-c.open/4))+480*c.gripShare*(1-Math.exp(-c.fist/2)));
}
export const pullNeeded=(n:number,share:number)=>Math.max(1,Math.ceil(n*share-1e-9));

/** Parts the molecule when half of the active hands pinch, and keeps it apart until under a third still do. */
export class PullGate {
 torn=false;private changed=-Infinity;
 update(c:Crowd,now:number){
  if(now-this.changed<PULL_DWELL_MS)return this.torn;
  const next=this.torn?c.pinch>=pullNeeded(c.n,PULL_OFF):c.pinch>=pullNeeded(c.n,PULL_ON)&&c.n>0;
  if(next!==this.torn){this.torn=next;this.changed=now;}
  return this.torn;
 }
}
