import type {BufferGeometry} from 'three';
import {bottleForms,capForms,collarForm,KNURL_SEGMENTS,liquidRows,silhouettes,turned} from './flacon';
/** A generic push-pump fine-mist perfume spray as plain data, millimetres, y up, bottle base at y=0. Representative, not a drawing of any product; the flacons are original. */
export type PartId='bottle'|'cap'|'collar'|'actuator'|'nozzle'|'stem'|'piston'|'spring'|'body'|'ball'|'tube'|'liquid';
export type Profile=readonly (readonly [r:number,y:number])[];
export type Vec3=readonly [number,number,number];
export interface PartLook {color:string;metalness?:number;roughness?:number;opacity?:number;
 /** See-through outer skin: thin to the renderer, and picking prefers whatever is inside it. */
 shell?:boolean;
 /** Colour of the cut face under a slice. */
 cut?:string;
 /** Paint order among overlapping cut faces; higher wins. */
 layer?:number;
 /** Steady emissive share of the base colour. */
 selfLit?:number;
 /** Pick score offset; negative favours this part. */
 pickBias?:number}
export type PartShape=
 |{kind:'lathe';profile:Profile;
   /** Closed loop in (r,y). axis 'x' turns the profile's y onto +x, and `at` then moves it. */
   axis?:'x';at?:Vec3}
 |{kind:'helix';radius:number;wire:number;turns:number;y0:number;y1:number;
   /** Dead coils squared off at each end, as on a real compression spring. */
   endTurns:number}
 /** Faceted or morphing solids a lathe cannot turn. */
 |{kind:'geometry';build:()=>BufferGeometry};
export interface PartDef {id:string;title:string;role:string;shape:PartShape;look:PartLook;explode:Vec3;removable:boolean}

export const dims={
 baseY:5,innerR:16.6,fullY:62.7,neckTopY:78,
 tubeEndY:7,tubeTopY:53,tubeBoreR:.75,
 seatY:54.5,ballR:1.05,ballRestY:55.4,ballLiftMm:.9,
 chamberFloorY:58,barrelR:2.5,pistonBottomY:75,
 /** Full travel; swept volume after the threshold is the dose, see tests. */
 strokeMm:5.7,
 stemTopY:93,ductY:95.5,nozzleTipX:7.3,
} as const;

/** Half-disc for a lathe, bottom pole first, walked up the +r side. */
const ballProfile=(y:number,r:number,n=14):[number,number][]=>Array.from({length:n+1},(_,i)=>{const a=-Math.PI/2+Math.PI*i/n;return [Math.max(0,Math.cos(a)*r),y+Math.sin(a)*r];});

const plastic='#e9e6df';
export const pumpParts:PartDef[]=[
 {id:'bottle',title:'Crystal flacon',role:'Holds the liquid and the air that replaces each dose. Thick glass round a 50 ml bore.',removable:false,explode:[-40,0,0],
  look:{color:'#e9f3f5',opacity:.16,roughness:.04,shell:true,cut:'#cfe3e8',layer:1,pickBias:.2},
  shape:{kind:'geometry',build:()=>turned(silhouettes.map(s=>bottleForms[s]),96)}},
 {id:'liquid',title:'Liquid',role:'The perfume, pulled up the dip tube one dose at a time.',removable:false,explode:[-40,0,0],
  look:{color:'#e88208',opacity:.8,roughness:.12,shell:true,cut:'#e8a02c',layer:0,selfLit:.5},
  shape:{kind:'geometry',build:()=>turned([{rows:liquidRows,section:()=>1,crease:60}],72)}},
 {id:'cap',title:'Sculpted cap',role:'Keeps the actuator from being pressed in a bag. It lifts away while you work.',removable:true,explode:[-40,40,0],
  look:{color:'#f2d9a6',metalness:.6,roughness:.2,shell:true,cut:'#e7cf9c',layer:2,pickBias:.1},
  shape:{kind:'geometry',build:()=>turned(silhouettes.map(s=>capForms[s]),96)}},
 {id:'tube',title:'Dip tube',role:'Reaches the bottom so the pump drinks liquid, not air.',removable:true,explode:[44,-1,0],
  look:{color:'#f3efe6',roughness:.3,cut:'#d9d3c6',layer:2},
  shape:{kind:'lathe',profile:[[.75,7],[1.25,7],[1.25,53],[.75,53]]}},
 {id:'body',title:'Pump body',role:'The cylinder the piston seals against, and the valve seat at its foot.',removable:false,explode:[16,-35,0],
  look:{color:plastic,roughness:.42,cut:'#f4f0e7',layer:2},
  shape:{kind:'lathe',profile:[[1.3,50],[1.9,50],[1.9,54],[2.3,55.5],[2.6,57],[3.3,58.5],[3.3,75.6],[5.4,76.2],[5.4,77.9],[7.8,78.1],[7.9,81],[1.75,81],[1.75,79],[2.5,79],[2.5,58],[1.55,58],[1.55,55.5],[.7,54.5],[.7,53],[1.3,53]]}},
 {id:'ball',title:'Ball valve',role:'One-way door: shuts under pressure, lifts under suction.',removable:true,explode:[16,-52,0],
  look:{color:'#dfe4e8',metalness:1,roughness:.12,cut:'#f7fbff',layer:4,pickBias:-.4},
  shape:{kind:'lathe',profile:ballProfile(55.4,1.05)}},
 {id:'spring',title:'Spring',role:'Lifts the actuator, and that lift is what draws the next dose in.',removable:true,explode:[16,6,0],
  look:{color:'#d5dade',metalness:1,roughness:.26,cut:'#f7fbff',layer:4,pickBias:-.4},
  shape:{kind:'helix',radius:1.95,wire:.26,turns:9,y0:58.1,y1:74.9,endTurns:1}},
 {id:'piston',title:'Piston',role:'Seals the cylinder and turns finger travel into pressure.',removable:false,explode:[16,15,0],
  look:{color:'#7d8c99',roughness:.5,cut:'#5e7f9c',layer:4},
  shape:{kind:'lathe',profile:[[.6,75],[2,75],[2.48,74.5],[2.48,75.1],[2,75.9],[2,77.5],[2.48,78.2],[2.48,78.8],[1.7,78.8],[1.7,76.2],[.6,76.2]]}},
 {id:'stem',title:'Stem',role:'Hollow pipe carrying pressurised liquid up to the actuator.',removable:false,explode:[16,37,0],
  look:{color:plastic,roughness:.36,cut:'#a9c7d8',layer:3},
  shape:{kind:'lathe',profile:[[.6,76.2],[1.7,76.2],[1.7,93],[.6,93]]}},
 {id:'collar',title:'Knurled collar',role:'Heavy metal band, crimped under, that clamps the pump to the bottle neck.',removable:false,explode:[16,27,0],
  look:{color:'#e9c27a',metalness:1,roughness:.2,cut:'#f2d9a6',layer:3},
  shape:{kind:'geometry',build:()=>turned([collarForm],KNURL_SEGMENTS)}},
 {id:'actuator',title:'Actuator',role:'The button: finger force goes in, the sideways duct leads out.',removable:false,explode:[16,56,0],
  look:{color:'#e9c27a',metalness:1,roughness:.18,cut:'#d8b77a',layer:2},
  shape:{kind:'lathe',profile:[[5.4,87.9],[6.2,87.9],[6.5,88.4],[6.5,98.7],[6.1,99.5],[3,99.8],[0,99.9],[0,90.5],[5.4,90.5]]}},
 {id:'nozzle',title:'Nozzle insert',role:'Swirl chamber and orifice: spins the liquid so it leaves as a hollow cone of droplets.',removable:true,explode:[32,56,0],
  look:{color:'#3a3f46',roughness:.4,cut:'#59616b',layer:3,pickBias:-.4},
  shape:{kind:'lathe',axis:'x',at:[3.9,95.5,0],profile:[[1,0],[1.7,0],[1.7,3.1],[1.35,3.4],[.28,3.4],[.28,3],[1,2.4]]}},
];
const liquid='#e8a02c',liquidLook=(layer:number):PartLook=>({color:liquid,roughness:.2,cut:liquid,layer});
/** Liquid and voids inside the pump: drawn like parts so they cut cleanly, but not parts anyone can pick. */
export const pumpExtras:PartDef[]=[
 {id:'fluid-tube',title:'',role:'',removable:false,explode:[0,0,0],look:liquidLook(3),shape:{kind:'lathe',profile:[[0,7],[.72,7],[.72,54.3],[0,54.3]]}},
 {id:'fluid-cage',title:'',role:'',removable:false,explode:[0,0,0],look:liquidLook(3),shape:{kind:'lathe',profile:[[0,54.4],[.72,54.4],[1.53,55.5],[1.53,58],[0,58]]}},
 {id:'fluid-chamber',title:'',role:'',removable:false,explode:[0,0,0],look:liquidLook(3),shape:{kind:'lathe',profile:[[0,58],[2.48,58],[2.48,75],[0,75]]}},
 {id:'fluid-stem',title:'',role:'',removable:false,explode:[0,0,0],look:liquidLook(5),shape:{kind:'lathe',profile:[[0,74.9],[.58,74.9],[.58,96],[0,96]]}},
 {id:'fluid-duct',title:'',role:'',removable:false,explode:[0,0,0],look:liquidLook(5),shape:{kind:'lathe',axis:'x',at:[0,95.5,0],profile:[[0,0],[.55,0],[.55,4],[0,4]]}},
 {id:'fluid-swirl',title:'',role:'',removable:false,explode:[0,0,0],look:liquidLook(5),shape:{kind:'lathe',axis:'x',at:[3.9,95.5,0],profile:[[0,0],[.98,0],[.98,2.4],[.26,3],[.26,3.4],[0,3.4]]}},
 {id:'socket',title:'',role:'',removable:false,explode:[0,0,0],look:{color:'#0b0d10',roughness:.7,cut:'#15181c',layer:3},shape:{kind:'lathe',axis:'x',at:[3.9,95.5,0],profile:[[0,0],[1.7,0],[1.7,2.55],[0,2.55]]}},
];
export const partById=(id:string)=>pumpParts.find(p=>p.id===id);
