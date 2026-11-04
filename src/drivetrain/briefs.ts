import {SHOCK,fraction,partCount,partOf,type Build,type Crank,type OutHand,type Rod,type Slider,type Solution} from './gears';

export interface Brief {id:string;title:string;goal:string;parts:number;
 /** Output torque each hand carries, N·m, and the slider's push, N. */
 load:number;push:number;shock:boolean;hint:string;
 kind:'ratio'|'stroke'|'pair';ratio:number;stroke?:number}
export const briefs:Brief[]=[
 {id:'reverse',title:'Reverse it',goal:'Output: 1/3 speed, reversed',kind:'ratio',ratio:-1/3,parts:3,load:.5,push:0,shock:false,hint:'Put a gear on the input shaft, mesh a bigger one, put the hand on it.'},
 {id:'same',title:'Same way round',goal:'Output: 1/2 speed, the same direction',kind:'ratio',ratio:1/2,parts:4,load:.5,push:0,shock:false,hint:'Two gears in mesh turn opposite ways. An idler between them turns it back.'},
 {id:'clock',title:'Hour hand',goal:'Output: 1/12 speed, reversed',kind:'ratio',ratio:-1/12,parts:7,load:2,push:0,shock:true,hint:'No two gears give 12:1 here. Stack a pinion on a big gear to compound two stages. Big final gears spread the load.'},
 {id:'stroke',title:'Rotation to stroke',goal:'Turn rotation into a 40 mm stroke at 1/2 speed',kind:'stroke',ratio:1/2,stroke:40,parts:5,load:0,push:40,shock:false,hint:'Stroke is twice the crank throw. Stretch a crank with two fists.'},
 {id:'pair',title:'Two outputs',goal:'Drive two outputs in opposite directions at 2:1',kind:'pair',ratio:-2,parts:5,load:.4,push:0,shock:true,hint:'One hand can sit on the input shaft itself.'},
];
export interface Check {label:string;ok:boolean;now:string}
export interface Verdict {checks:Check[];met:boolean;output:number|null}
const close=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-3,Math.abs(b)*.01);
const way=(r:number)=>r>0?'same way':r<0?'reversed':'still';
/** What the brief asks against what is built. survived is whether the current build has taken a clap. */
export function judge(brief:Brief,b:Build,sol:Solution,survived:boolean):Verdict{
 const hands=b.parts.filter((p):p is OutHand=>p.kind==='hand'),running=!sol.jammed&&!sol.broken,checks:Check[]=[];
 let output:number|null=null;
 if(brief.kind==='ratio'){
  const r=hands.length?sol.ratio(hands[0].id):0;output=hands.length?r:null;
  checks.push({label:'Output hand on a shaft',ok:hands.length>0,now:hands.length?'placed':'none yet'});
  checks.push({label:`Speed ${fraction(brief.ratio)}`,ok:hands.length>0&&close(Math.abs(r),Math.abs(brief.ratio)),now:hands.length?fraction(r):'—'});
  checks.push({label:brief.ratio<0?'Reversed':'Same direction',ok:hands.length>0&&Math.sign(r)===Math.sign(brief.ratio),now:hands.length?way(r):'—'});
 }else if(brief.kind==='stroke'){
  const s=b.parts.find((p):p is Slider=>p.kind==='slider'),rod=s&&partOf(b,s.rod) as Rod|undefined,c=rod&&partOf(b,rod.crank) as Crank|undefined,r=c?sol.ratio(c.id):0;output=c?r:null;
  checks.push({label:'Crank, rod and slider joined',ok:!!(s&&c),now:s?'joined':c?'no slider':'no crank'});
  checks.push({label:`Stroke ${brief.stroke} mm`,ok:!!c&&close(2*c.throw,brief.stroke!),now:c?`${2*c.throw} mm`:'—'});
  checks.push({label:`Strokes at ${fraction(brief.ratio)}`,ok:!!c&&close(Math.abs(r),brief.ratio),now:c?fraction(Math.abs(r)):'—'});
 }else{
  const [h1,h2]=hands,r1=h1?sol.ratio(h1.id):0,r2=h2?sol.ratio(h2.id):0,q=Math.abs(r2)>1e-9&&Math.abs(r1)>1e-9?(Math.abs(r1)>Math.abs(r2)?r1/r2:r2/r1):0;output=h1?r1:null;
  checks.push({label:'Two output hands',ok:hands.length>=2,now:`${hands.length} placed`});
  checks.push({label:'Opposite directions',ok:hands.length>=2&&r1*r2<0,now:hands.length>=2?(r1*r2<0?'opposite':r1*r2>0?'same way':'one still'):'—'});
  checks.push({label:'Speeds 2:1',ok:hands.length>=2&&close(Math.abs(q),2),now:hands.length>=2?`${Math.abs(q).toFixed(2)}:1`:'—'});
 }
 checks.push({label:`At most ${brief.parts} parts`,ok:partCount(b)<=brief.parts,now:`${partCount(b)} used`});
 checks.push({label:'Turns freely',ok:running,now:sol.broken?'a tooth is broken':sol.jammed?'jammed':'free'});
 if(brief.shock)checks.push({label:`Survives a ${SHOCK}× shock`,ok:survived,now:survived?'held':'clap to test'});
 return {checks,met:checks.every(c=>c.ok),output};
}
