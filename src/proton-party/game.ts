export const RING=8,ATP_PER_TURN=3,STEP_DEGREES=360/RING,GOAL=100,ROUND_SECONDS=60,TUG_GOAL=30;
const RECENT_MS=5000,RECENT_WEIGHT=5,FORCE_WINDOW_MS=3000;
export type Phase='lobby'|'play'|'results';
export type Mode='make'|'tug';
export type Team='make'|'burn';
export interface PartyPlayer {id:string;name:string;color:string;on:boolean}
export interface Stats {threw:number;caught:number;burned:number;lastThrow:number}
export type GameEvent=
 |{type:'proton';from:string}
 |{type:'burn';from:string}
 |{type:'atp';delta:1|-1;to:string|null}
 |{type:'end';won:boolean};
export interface Results {atp:number;won:boolean;mode:Mode;mvp:{id:string;name:string;color:string;threw:number}|null;burnMvp:{id:string;name:string;color:string;burned:number}|null}
export interface GameOptions {now?:()=>number;rng?:()=>number;roundSeconds?:number;goal?:number;mode?:Mode}

/** ATP made by a net number of proton notches on a c8 ring: three per turn of eight. */
export const atpFor=(steps:number)=>Math.floor(Math.max(0,steps)*ATP_PER_TURN/RING);
export const degreesFor=(steps:number)=>steps*STEP_DEGREES;

/** The host's game: the room only relays, so every rule lives here. */
export class PartyGame {
 phase:Phase='lobby';mode:Mode;steps=0;startedAt=0;results:Results|null=null;
 readonly players=new Map<string,PartyPlayer>();readonly stats=new Map<string,Stats>();readonly teams=new Map<string,Team>();
 private now:()=>number;private rng:()=>number;
 readonly roundSeconds:number;readonly goal:number;
 private pushes:{at:number;team:Team}[]=[];
 constructor({now=()=>Date.now(),rng=Math.random,roundSeconds=ROUND_SECONDS,goal,mode='make'}:GameOptions={}){
  this.now=now;this.rng=rng;this.roundSeconds=roundSeconds;this.mode=mode;this.goal=goal??(mode==='tug'?TUG_GOAL:GOAL);
 }
 get atp(){return atpFor(this.steps);}
 get degrees(){return degreesFor(this.steps);}
 left(at=this.now()){return this.phase==='play'?Math.max(0,Math.ceil(this.roundSeconds-(at-this.startedAt)/1000)):this.phase==='lobby'?this.roundSeconds:0;}
 setRoster(list:readonly PartyPlayer[]){
  const seen=new Set<string>();
  for(const p of list){seen.add(p.id);this.players.set(p.id,{...p});if(!this.stats.has(p.id))this.stats.set(p.id,{threw:0,caught:0,burned:0,lastThrow:-Infinity});if(this.phase==='play'&&this.mode==='tug'&&!this.teams.has(p.id))this.teams.set(p.id,this.smallerTeam());}
  for(const id of [...this.players.keys()])if(!seen.has(id)&&!this.stats.get(id)?.threw&&!this.stats.get(id)?.burned){this.players.delete(id);this.stats.delete(id);this.teams.delete(id);}
 }
 private smallerTeam():Team{let make=0,burn=0;for(const t of this.teams.values())t==='make'?make++:burn++;return burn<make?'burn':'make';}
 start(mode:Mode=this.mode):void{
  this.mode=mode;this.phase='play';this.steps=0;this.startedAt=this.now();this.results=null;this.pushes=[];this.teams.clear();
  for(const s of this.stats.values())Object.assign(s,{threw:0,caught:0,burned:0,lastThrow:-Infinity});
  if(mode==='tug')for(const id of this.players.keys())this.teams.set(id,this.smallerTeam());
 }
 reset():void{this.phase='lobby';this.steps=0;this.results=null;this.pushes=[];}
 teamOf(id:string):Team{return this.mode==='tug'?this.teams.get(id)??'make':'make';}
 /** Who catches the next ATP: online players, weighted towards those who threw in the last few seconds. */
 pickCatcher():string|null{
  const at=this.now(),pool=[...this.players.values()].filter(p=>p.on&&this.teamOf(p.id)==='make'||p.on&&this.mode==='make');
  const online=pool.length?pool:[...this.players.values()].filter(p=>p.on);
  if(!online.length)return null;
  const weights=online.map(p=>at-(this.stats.get(p.id)?.lastThrow??-Infinity)<=RECENT_MS?RECENT_WEIGHT:1);
  let r=this.rng()*weights.reduce((a,b)=>a+b,0);
  for(let i=0;i<online.length;i++){r-=weights[i];if(r<0)return online[i].id;}
  return online[online.length-1].id;
 }
 private move(delta:1|-1):GameEvent[]{
  const before=this.atp;this.steps=Math.max(0,this.steps+delta);
  const events:GameEvent[]=[],now=this.atp;
  for(let n=before;n<now;n++){const to=this.pickCatcher();if(to){const s=this.stats.get(to);if(s)s.caught++;}events.push({type:'atp',delta:1,to});}
  for(let n=before;n>now;n--)events.push({type:'atp',delta:-1,to:null});
  if(this.atp>=this.goal)events.push(...this.finish(true));
  return events;
 }
 /** A proton thrown by a player at the rotor. */
 throw(id:string):GameEvent[]{
  const s=this.stats.get(id);
  if(this.phase!=='play'||!s||this.teamOf(id)!=='make')return [];
  const at=this.now();s.threw++;s.lastThrow=at;this.pushes.push({at,team:'make'});
  return [{type:'proton',from:id},...this.move(1)];
 }
 /** A shake from Team Burn, which spends a notch of progress in the tug of war. */
 shake(id:string):GameEvent[]{
  const s=this.stats.get(id);
  if(this.phase!=='play'||this.mode!=='tug'||!s||this.teamOf(id)!=='burn')return [];
  s.burned++;this.pushes.push({at:this.now(),team:'burn'});
  return [{type:'burn',from:id},...this.move(-1)];
 }
 /** Each side's share of the last few seconds of pushing, 0 to 100 each; both 0 when nobody pushed. */
 forces(at=this.now()):{make:number;burn:number}{
  this.pushes=this.pushes.filter(p=>at-p.at<=FORCE_WINDOW_MS);
  let make=0,burn=0;for(const p of this.pushes)p.team==='make'?make++:burn++;
  const total=make+burn;
  return total?{make:Math.round(make/total*100),burn:100-Math.round(make/total*100)}:{make:0,burn:0};
 }
 /** Which way the rotor is being pushed right now: 1 forward, -1 back, 0 level. */
 netDirection(at=this.now()):1|0|-1{const f=this.forces(at);return f.make>f.burn?1:f.burn>f.make?-1:0;}
 tick():GameEvent[]{
  if(this.phase==='play'&&this.now()-this.startedAt>=this.roundSeconds*1000)return this.finish(false);
  return [];
 }
 private finish(reached:boolean):GameEvent[]{
  if(this.phase!=='play')return [];
  this.phase='results';
  const won=this.mode==='tug'?this.atp>=this.goal:reached;
  let mvp:Results['mvp']=null,burnMvp:Results['burnMvp']=null;
  for(const [id,s] of this.stats){
   const p=this.players.get(id);if(!p)continue;
   if(s.threw>0&&(!mvp||s.threw>mvp.threw))mvp={id,name:p.name,color:p.color,threw:s.threw};
   if(s.burned>0&&(!burnMvp||s.burned>burnMvp.burned))burnMvp={id,name:p.name,color:p.color,burned:s.burned};
  }
  this.results={atp:this.atp,won,mode:this.mode,mvp,burnMvp};
  return [{type:'end',won}];
 }
}
