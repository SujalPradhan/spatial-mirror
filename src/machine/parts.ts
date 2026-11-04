import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {MeshLook,MeshPartSpec} from '../mirror/parts-view';
import {PITCH} from './model';

/** All sizes are model units, about 0.7 mm under the plate. The body is compressed and illustrative; the mechanism's order and timing are not. */
export type P=[number,number,number];
export const dims={hook:[0,-28,0] as P,caseR:12.8,caseW:5.5,hookOut:18,hookIn:15.2,clothTop:1.6,clothUnder:-1.6,plate:1.2,needleZ:.9,shaftY:104,lowerY:-28,lowerZ:-24,linkDrop:60,wheelX:187,clothMark:PITCH*2,pivot:[46,100,27] as P,takeUp:[8,94,27] as P} as const;
export const UNIT=.03,CENTER:P=[64,46,0];
export type PartId='bed'|'arm'|'handwheel'|'upperShaft'|'link'|'needleBar'|'needle'|'presserFoot'|'takeUp'|'guides'|'spool'|'tension'|'plate'|'feedDog'|'hook'|'bobbinCase'|'bobbin'|'cloth'|'lowerShaft'|'belt';
/** Drawn only in the whole-machine framing: the close-up looks through where these stand. */
export const bodyParts:PartId[]=['bed','arm','handwheel','upperShaft','link','takeUp','guides','spool','tension','belt'];

const {hook:H,caseR,caseW,hookOut,hookIn,shaftY,lowerY,lowerZ,linkDrop,wheelX,pivot,takeUp,clothMark}=dims;
const smooth=(n:number)=>{const u=Math.max(0,Math.min(1,n));return u*u*(3-2*u);};
const mix=(a:number,b:number,u:number)=>a+(b-a)*u;
type G=T.BufferGeometry;
const merge=(...list:G[]):G=>{
 const flat=list.map(g=>{const f=g.index?g.toNonIndexed():g;for(const n of ['uv','uv1'])f.deleteAttribute(n);return f;});
 return mergeGeometries(flat,false)!;
};
const at=(g:G,x=0,y=0,z=0)=>g.translate(x,y,z);
const box=(w:number,h:number,d:number,x=0,y=0,z=0)=>at(new T.BoxGeometry(w,h,d),x,y,z);
/** Cylinder along y, or along another axis, centred on the point. */
const rod=(r0:number,r1:number,len:number,axis:'x'|'y'|'z',x=0,y=0,z=0,seg=28)=>{
 const g=new T.CylinderGeometry(r0,r1,len,seg);
 if(axis==='x')g.rotateZ(-Math.PI/2);if(axis==='z')g.rotateX(Math.PI/2);
 return at(g,x,y,z);
};
const ring=(r:number,tube:number,x=0,y=0,z=0,turn:'x'|'y'|'z'='z')=>{
 const g=new T.TorusGeometry(r,tube,12,48);
 if(turn==='y')g.rotateY(Math.PI/2);if(turn==='x')g.rotateX(Math.PI/2);
 return at(g,x,y,z);
};
const extrude=(shape:T.Shape,depth:number,bevel=0)=>new T.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelOffset:-bevel,bevelSegments:3,curveSegments:14});

/** The cast body as one silhouette: pillar on the right, arm across the top, head over the needle. */
function armGeometry() {
 const s=new T.Shape(),r=14;
 s.moveTo(-14,34);s.quadraticCurveTo(-24,34,-24,44);s.lineTo(-24,128-r);s.quadraticCurveTo(-24,128,-24+r,128);
 s.lineTo(160,128);s.quadraticCurveTo(178,128,178,110);s.lineTo(178,-4);s.lineTo(126,-4);s.lineTo(126,72);s.quadraticCurveTo(126,82,116,82);
 s.lineTo(36,82);s.quadraticCurveTo(24,82,24,70);s.lineTo(24,44);s.quadraticCurveTo(24,34,14,34);s.closePath();
 return at(extrude(s,40,3),0,0,-20);
}
function wheelGeometry() {
 const R=30,s=new T.Shape();s.absarc(0,0,R,0,Math.PI*2,false);
 for(let i=0;i<5;i++){
  const a=i*Math.PI*.4,w=.46,hole=new T.Path();
  hole.moveTo(Math.cos(a-w)*9,Math.sin(a-w)*9);hole.absarc(0,0,R-6,a-w,a+w,false);hole.lineTo(Math.cos(a+w)*9,Math.sin(a+w)*9);hole.closePath();s.holes.push(hole);
 }
 return merge(at(extrude(s,11,1.2).rotateY(Math.PI/2),-5.5),rod(7,7,20,'x'),...Array.from({length:40},(_,i)=>box(10,1.1,1.1,0,Math.cos(i*Math.PI/20)*(R-.1),Math.sin(i*Math.PI/20)*(R-.1))));
}
function plateGeometry() {
 const s=new T.Shape(),w=46,d=34;
 s.moveTo(-w,-d);s.lineTo(w,-d);s.lineTo(w,d);s.lineTo(-w,d);s.closePath();
 const slot=(z0:number,z1:number)=>{const h=new T.Path();h.moveTo(-13,z0);h.lineTo(-13,z1);h.lineTo(13,z1);h.lineTo(13,z0);h.closePath();s.holes.push(h);};
 slot(3.6,6.4);slot(-6.4,-3.6);
 const hole=new T.Path();hole.absarc(0,.9,1.9,0,Math.PI*2,true);s.holes.push(hole);
 return at(extrude(s,dims.plate).rotateX(Math.PI/2),0,dims.clothUnder,0);
}
function feedGeometry() {
 const t=new T.Shape();t.moveTo(-9,-3.4);
 for(let i=0;i<7;i++){const x=-9+i*2.6;t.lineTo(x,0);t.lineTo(x+1.1,0);t.lineTo(x+2.6,-.9);}
 t.lineTo(9.2,-3.4);t.closePath();
 // Two rows only: a bar between them would hide the loop as it is thrown.
 return merge(at(extrude(t,1.6),0,0,4.2),at(extrude(t,1.6),0,0,-5.8));
}
function hookGeometry() {
 const s=new T.Shape(),polar=(a:number,r:number):[number,number]=>[r*Math.sin(a*Math.PI/180),r*Math.cos(a*Math.PI/180)],sweep=-285;
 s.moveTo(...polar(0,hookOut));
 for(let a=-6;a>=sweep;a-=6)s.lineTo(...polar(a,hookOut));
 for(let a=sweep;a<=0;a+=6)s.lineTo(...polar(a,mix(hookIn,hookOut-.02,smooth((a+62)/62))));
 const arm=(a:number)=>{const g=box(1.1,hookIn+1,1.2);g.translate(0,(hookIn+1)/2,-4.5);return g.rotateZ(a);};
 return merge(at(new T.ExtrudeGeometry(s,{depth:3.7,bevelEnabled:false,curveSegments:4}),0,0,-3.6),rod(3.1,3.1,lowerZ*-1-5,'z',0,0,lowerZ/2-2.5),arm(1.2),arm(3.3),arm(5.4),rod(6,3.4,3.4,'x',0,0,0).rotateX(0).translate(0,0,lowerZ+1));
}
function caseGeometry() {
 return merge(ring(caseR,.24,0,0,caseW),ring(caseR,.24,0,0,-caseW),box(2.2,9.6,.7,0,-1,caseW+.1),box(3,5,3,-7.4,14.6,-5.8));
}
function linkGeometry(){return merge(rod(1.5,1.5,linkDrop*.7,'y',0,-linkDrop*.35,0),rod(2.6,2.6,4,'x'),rod(2.2,2.2,4,'x',0,-linkDrop*.7,0));}
function needleBarGeometry(){return merge(rod(2.1,2.1,linkDrop-32,'y',0,(linkDrop+32)/2,0),box(5.4,3.2,4.6,0,31,0),ring(1,.3,0,23.6,2.2,'y'));}
function needleGeometry(){return merge(rod(.62,.3,24,'y',0,12,0,14),rod(.3,.02,2,'y',0,-1,0,12),rod(1.05,1.05,8,'y',0,28,0,16));}
function footGeometry() {
 const sole=(z:number)=>new RoundedBoxGeometry(17,.7,2.2,2,.3).translate(1.5,dims.clothTop+.36,z);
 return merge(sole(4.1),sole(-3.4),box(3,8,9.6,3,6,-.0).translate(0,0,-.8),box(3,4,9.6,3,10,-5),rod(1.5,1.5,60,'y',3,38,-9,18));
}
function lever() {
 const L=Math.hypot(pivot[0]-takeUp[0],pivot[1]-takeUp[1]);
 return merge(new RoundedBoxGeometry(L+1,2,1.5,2,.5).translate(-L/2,0,0),rod(3,3,3,'z'),ring(1.3,.42,-L,0,0));
}
export const leverLength=Math.hypot(pivot[0]-takeUp[0],pivot[1]-takeUp[1]);
/** Oval through the two pulleys, in the pillar. Closed, so it needs no end caps for the slice. */
function beltGeometry() {
 const a=new T.Vector3(150,shaftY,0),b=new T.Vector3(150,lowerY,lowerZ),r=9,points:T.Vector3[]=[],up=b.clone().sub(a).normalize();
 const side=new T.Vector3(1,0,0).cross(up).normalize();
 for(let i=0;i<=16;i++){const t=i/16*Math.PI;points.push(a.clone().addScaledVector(side,Math.cos(t)*r).addScaledVector(up,-Math.sin(t)*r));}
 for(let i=0;i<=16;i++){const t=i/16*Math.PI;points.push(b.clone().addScaledVector(side,-Math.cos(t)*r).addScaledVector(up,Math.sin(t)*r));}
 return new T.TubeGeometry(new T.CatmullRomCurve3(points,true),120,1.1,8,true);
}
const upperGeometry=()=>merge(rod(3.4,3.4,wheelX,'x',wheelX/2-8,0,0),rod(11,11,4,'x',-5,0,0,36),rod(2.2,2.2,6,'x',-1,17,0),box(4,6,10,20,-2,0),rod(9,9,8,'x',150,0,0,36));
const lowerGeometry=()=>merge(rod(3,3,152,'x',76,0,0),rod(9,9,8,'x',150,0,0,36),rod(3.4,7,4,'x',2.5,0,0),box(10,8,1.6,90,0,0),box(10,1.6,8,90,0,0));
const spoolGeometry=():T.BufferGeometry=>merge(rod(7,7,3,'y',92,132,0,36),rod(12,12,2,'y',92,133,0,48),rod(10,10,26,'y',92,146,0,48),rod(12,12,2,'y',92,159,0,48));
const tensionGeometry=()=>merge(rod(8,8,1.2,'z',34,86,24.4,40),rod(8,6,1.4,'z',34,86,25.8,40),rod(6,8,1.4,'z',34,86,27.6,40),rod(2,2,10,'z',34,86,27,20),rod(3.4,3.4,2,'z',34,86,31,6));
const guideGeometry=()=>merge(rod(1.2,1.2,36,'y',92,146,0,10),rod(1,1,8,'y',62,132,0,10),ring(1.4,.36,62,137,0),ring(1.4,.36,34,118,24),ring(1.4,.36,27,69,25.5),ring(1.2,.34,4,58,25),ring(1.2,.34,3,41,21),box(3,1.2,17,3,36.5,13));
/** Deep enough for a free-motion drawing in its hoop. */
const clothGeometry=()=>merge(box(306,1.5,120,-30,.82,0),box(306,1.5,120,-30,-.82,0));
const marksGeometry=()=>merge(...Array.from({length:21},(_,i)=>box(5,.14,.9,-182+i*clothMark+.0,dims.clothTop+.07,9.8)),...Array.from({length:21},(_,i)=>box(5,.14,.9,-175+i*clothMark,dims.clothTop+.07,-9.8)));
const bobbinCore=()=>rod(9.4,9.4,6.2,'z',H[0],H[1],0,48);
const bobbinRims=()=>merge(ring(10.5,.42,H[0],H[1],3.4),ring(10.5,.42,H[0],H[1],-3.4),rod(10.5,10.5,.5,'z',H[0],H[1],-3.4,48),rod(2,2,7.4,'z',H[0],H[1],0,20));

/** The plate and cloth are see-through, so they give way to what is seen through them, as a shell does. */
const enamel:MeshLook={color:'#2d4750',metalness:.25,roughness:.32};
const steel=(color='#c9d3dc',roughness=.34):MeshLook=>({color,metalness:.75,roughness});
const part=(id:PartId,title:string,role:string,build:()=>G,look:MeshLook,explode:P,removable=false):MeshPartSpec=>({id,title,role,shape:{kind:'geometry',build},look,explode,removable});
export const machineParts:MeshPartSpec[]=[
 part('bed','Bed','Holds the throat plate level and hides the shafts',()=>new RoundedBoxGeometry(272,53,84,4,3).translate(64,-29.4,0),enamel,[0,-110,0]),
 part('arm','Arm and head','Carries the upper shaft out over the work',armGeometry,enamel,[20,70,-70]),
 part('handwheel','Handwheel','Turns the upper shaft, by hand or by motor',wheelGeometry,{...steel('#d5c7a0',.3),pickBias:-.2},[80,0,0]),
 part('upperShaft','Upper shaft','One turn makes one stitch',upperGeometry,steel('#a9b4bd'),[0,40,60]),
 part('link','Needle bar link','Turns the shaft’s rotation into up and down',linkGeometry,steel('#8f9ba5'),[-50,40,40]),
 part('needleBar','Needle bar','Drives the needle down through the cloth',needleBarGeometry,steel('#7f8d9a'),[-20,50,20]),
 part('needle','Needle','Carries the top thread through the cloth and leaves a loop',needleGeometry,{...steel('#e3e9ee',.24),pickBias:-.25},[-34,26,26]),
 part('presserFoot','Presser foot','Pins the cloth down while the needle pulls out',footGeometry,{...steel('#6d7a86'),pickBias:-.1},[24,30,32]),
 part('takeUp','Take-up lever','Feeds slack on the way down, then jerks the stitch tight',lever,{...steel('#e4d9c0',.3),pickBias:-.5},[-10,50,50],true),
 part('guides','Thread guides','Keep the top thread on its route',guideGeometry,steel('#d9dfe4'),[0,50,34]),
 part('spool','Spool','Holds the top thread',spoolGeometry,{color:'#c8352c',metalness:0,roughness:.62,pickBias:-.1},[0,70,0]),
 part('tension','Tension discs','Squeeze the thread so it pays out evenly',tensionGeometry,steel('#aab7c2',.28),[40,0,60]),
 part('plate','Throat plate','Slotted for the feed dog, drilled for the needle',plateGeometry,{color:'#8c9aa6',metalness:.45,roughness:.38,opacity:.34,layer:3,pickBias:.9},[0,18,-14]),
 part('feedDog','Feed dog','Rises through the plate, grips the cloth and walks it one stitch',feedGeometry,{...steel('#7c8a97'),pickBias:-.6},[0,-24,36],true),
 part('hook','Rotary hook','Takes the loop off the needle and carries it round the case',hookGeometry,{color:'#d9a65a',metalness:.6,roughness:.32,pickBias:-.1},[0,-8,-46]),
 part('bobbinCase','Bobbin case','Stays still while the loop passes right round it',caseGeometry,steel('#b5c4d2'),[-34,-16,22]),
 part('bobbin','Bobbin','Holds the second thread. The loop locks around it',bobbinCore,{color:'#0f4c63',metalness:.1,roughness:.8,pickBias:-.6},[0,-12,58],true),
 part('cloth','Cloth','Two plies, held between the threads',clothGeometry,{color:'#e9dcc4',metalness:0,roughness:.95,opacity:.46,layer:4,selfLit:.22,pickBias:.9},[0,46,0]),
 part('lowerShaft','Lower shaft','Geared 2:1, so the hook turns twice for each stitch',lowerGeometry,steel('#5f6b76',.45),[0,-60,-40]),
 part('belt','Timing belt','Keeps the hook in step with the needle',beltGeometry,{color:'#3b3f46',metalness:0,roughness:.7},[60,0,-50]),
];
/** Extras shadow a part: same explode, and the view copies its live offset across. */
export const followers:Record<string,PartId>={caseShell:'bobbinCase',bobbinRims:'bobbin'};
export const machineExtras:MeshPartSpec[]=[
 {id:'caseShell',title:'',role:'',shape:{kind:'geometry',build:()=>rod(caseR,caseR,caseW*2,'z',0,0,0,56)},look:{color:'#8fa3b5',metalness:.2,roughness:.36,opacity:.2,shell:true,layer:1},explode:[-34,-16,22],removable:false},
 {id:'bobbinRims',title:'',role:'',shape:{kind:'geometry',build:bobbinRims},look:steel('#5c6a78'),explode:[0,-12,58],removable:false},
 {id:'clothMarks',title:'',role:'',shape:{kind:'geometry',build:marksGeometry},look:{color:'#5d7fa8',roughness:.9},explode:[0,46,0],removable:false},
];
