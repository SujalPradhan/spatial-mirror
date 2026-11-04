import * as T from 'three';

/** Three original flacons, model millimetres, y up, base at y=0. Every one keeps the same round 50 ml bore, so the pump and the liquid model never change. */
export type Silhouette='tower'|'pebble'|'prism';
export const silhouettes:Silhouette[]=['tower','pebble','prism'];
/** r is the narrowest radius at height y; round 1 ignores the cross-section, so bores and necks stay circular. */
export type Row=readonly [r:number,y:number,round:number];
/** Radial multiplier, at least 1, at angle a and height y. */
type Section=(a:number,y:number)=>number;
export interface Form {rows:Row[];section:Section;
 /** Faces meeting at less than this many degrees share a normal: low keeps facets crisp, high reads as one smooth body. */
 crease:number}
export interface Note {name:string;line:string;color:string}
/** Each flacon holds its own juice. Notes are illustrative families, not a formula. */
export interface Fragrance {name:string;deep:string;light:string;tint:string;notes:[top:Note,heart:Note,base:Note]}
export const fragrances:Record<Silhouette,Fragrance>={
 tower:{name:'Amber',deep:'#8a3206',light:'#ffb43c',tint:'#fff0da',notes:[{name:'Top',line:'bergamot · lemon',color:'#ffe45c'},{name:'Heart',line:'iris · jasmine',color:'#f5a3dc'},{name:'Base',line:'amber · cedar',color:'#e08a34'}]},
 pebble:{name:'Rose',deep:'#8c1238',light:'#ff8fb0',tint:'#ffe8ef',notes:[{name:'Top',line:'mandarin · pink pepper',color:'#ffc04a'},{name:'Heart',line:'rose · peony',color:'#ff5f94'},{name:'Base',line:'musk · sandalwood',color:'#d6a07c'}]},
 prism:{name:'Vetiver',deep:'#1f5a36',light:'#c8ef7a',tint:'#eefcf2',notes:[{name:'Top',line:'yuzu · lime',color:'#d9ff52'},{name:'Heart',line:'neroli · orange blossom',color:'#fff3c4'},{name:'Base',line:'vetiver · oakmoss',color:'#86b06a'}]},
};

const TAU=Math.PI*2;
const polygon=(n:number,a:number)=>{const s=TAU/n,f=((a%s)+s)%s-s/2;return 1/Math.cos(f);};
const oval=(stretch:number)=>(a:number)=>1/Math.sqrt((Math.cos(a)/stretch)**2+Math.sin(a)**2);
/** Inserts points along the longest runs until there are n, keeping every given point, so differently drawn forms morph row for row. */
export function resample(rows:Row[],n:number):Row[] {
 if(rows.length>n)throw Error(`A form has ${rows.length} rows, more than ${n}.`);
 const seg=rows.slice(0,-1).map((p,i)=>Math.hypot(rows[i+1][0]-p[0],rows[i+1][1]-p[1])),extra=n-rows.length,total=seg.reduce((a,b)=>a+b,0)||1;
 const add=seg.map(l=>Math.floor(l/total*extra));
 seg.map((l,i)=>[l/total*extra-add[i],i]).sort((a,b)=>b[0]-a[0]).slice(0,extra-add.reduce((a,b)=>a+b,0)).forEach(([,i])=>add[i]++);
 const out:Row[]=[];
 rows.forEach((p,i)=>{out.push(p);const q=rows[i+1];if(q)for(let k=1;k<=add[i];k++){const t=k/(add[i]+1);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,p[2]+(q[2]-p[2])*t]);}});
 return out;
}

/** A closed loop of rows swept round the axis with a cross-section per form. Unindexed, so every face carries its own normals; forms after the first become morph targets. */
export function turned(forms:Form[],segments:number):T.BufferGeometry {
 const R=forms[0].rows.length,S=segments;
 if(forms.some(f=>f.rows.length!==R))throw Error('Forms must have the same number of rows.');
 const grids=forms.map(f=>{
  const g=new Float32Array(R*S*3);
  for(let i=0;i<R;i++){const [r,y,w]=f.rows[i];for(let j=0;j<S;j++){const a=j/S*TAU,k=r*(w>=1?1:1+(f.section(a,y)-1)*(1-w)),o=(i*S+j)*3;g[o]=Math.cos(a)*k;g[o+1]=y;g[o+2]=Math.sin(a)*k;}}
  return g;
 });
 const at=(g:Float32Array,i:number,j:number)=>(((i+R)%R)*S+((j+S)%S))*3;
 // Face normals: profile direction cross turning direction points out of the solid for a loop wound like a lathe profile.
 const faces=grids.map(g=>{
  const n=new Float32Array(R*S*3);
  for(let i=0;i<R;i++)for(let j=0;j<S;j++){
   const a=at(g,i,j),b=at(g,i,j+1),c=at(g,i+1,j+1),d=at(g,i+1,j);
   const ux=g[c]-g[a],uy=g[c+1]-g[a+1],uz=g[c+2]-g[a+2],vx=g[d]-g[b],vy=g[d+1]-g[b+1],vz=g[d+2]-g[b+2];
   let x=vy*uz-vz*uy,y=vz*ux-vx*uz,z=vx*uy-vy*ux;const l=Math.hypot(x,y,z);
   if(l>1e-9){x/=l;y/=l;z/=l;}else x=y=z=0;
   const o=(i*S+j)*3;n[o]=x;n[o+1]=y;n[o+2]=z;
  }
  return n;
 });
 const live:number[]=[];
 for(let i=0;i<R;i++)for(let j=0;j<S;j++)if(faces.some(n=>n[(i*S+j)*3]||n[(i*S+j)*3+1]||n[(i*S+j)*3+2]))live.push(i,j);
 const count=live.length/2*6,positions=grids.map(()=>new Float32Array(count*3)),normals=grids.map(()=>new Float32Array(count*3));
 grids.forEach((g,f)=>{
  const n=faces[f],cos=Math.cos(forms[f].crease*Math.PI/180),pos=positions[f],nor=normals[f];let v=0;
  const corner=(i:number,j:number,qi:number,qj:number)=>{
   const q=(qi*S+qj)*3,o=at(g,i,j);let x=0,y=0,z=0;
   for(const [di,dj] of [[-1,-1],[-1,0],[0,-1],[0,0]]){const p=at(n,i+di,j+dj);const d=n[p]*n[q]+n[p+1]*n[q+1]+n[p+2]*n[q+2];if(d>=cos){x+=n[p];y+=n[p+1];z+=n[p+2];}}
   const l=Math.hypot(x,y,z)||1;
   pos[v*3]=g[o];pos[v*3+1]=g[o+1];pos[v*3+2]=g[o+2];nor[v*3]=x/l;nor[v*3+1]=y/l;nor[v*3+2]=z/l;v++;
  };
  for(let k=0;k<live.length;k+=2){
   const i=live[k],j=live[k+1];
   // a, d, c then a, c, b: counter-clockwise seen from outside.
   corner(i,j,i,j);corner(i+1,j,i,j);corner(i+1,j+1,i,j);corner(i,j,i,j);corner(i+1,j+1,i,j);corner(i,j+1,i,j);
  }
 });
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.BufferAttribute(positions[0],3));geometry.setAttribute('normal',new T.BufferAttribute(normals[0],3));
 if(forms.length>1){geometry.morphAttributes.position=positions.map(p=>new T.BufferAttribute(p,3));geometry.morphAttributes.normal=normals.map(p=>new T.BufferAttribute(p,3));geometry.morphTargetsRelative=false;}
 geometry.computeBoundingBox();geometry.computeBoundingSphere();
 return geometry;
}

/** Neck and bore shared by every flacon: the neck is hidden by the collar, the bore holds the liquid. */
const neck:Row[]=[[7.1,71,1],[7.1,75,1],[7.9,75.6,1],[7.9,77,1],[7.4,78,1],[6,78,1]];
const bore:Row[]=[[5.6,77.4,1],[5.6,68.6,1],[7.5,67.6,1],[11,66.6,1],[14.5,65.4,1],[16.1,64.2,1],[16.6,63,1],[16.6,7,1],[15.6,5.5,1],[13,5,1],[0,5,1]];
const OUTER_ROWS=46;
/** The glass foot sits this far below the bore's floor at y=5, so a thick slab of clear crystal shows under the liquid. */
const BASE=-7;
const outer=(rows:Row[])=>resample(rows,OUTER_ROWS).concat(bore);
/** An Art Deco tower: chamfered octagon on a heavy clear base, closed by one clean bevel at the shoulder. */
const tower:Form={crease:22,section:a=>Math.min(polygon(8,a),1.05*polygon(8,a+Math.PI/8)),rows:outer([[0,BASE,0],[19.4,BASE,0],[21.4,BASE+2,0],[21.4,61.5,0],[10.5,68.8,0],[8.6,69.8,0],...neck])};
/** A sea-worn pebble: oval in plan, swelling low and closing softly onto the neck. */
const pebbleRows=():Row[]=>{
 const rows:Row[]=[[0,BASE,0],[13.5,BASE,0]];
 for(let k=1;k<=28;k++){const y=k/28*70,t=y<31?(31-y)/31:(y-31)/39.5,p=y<31?3.6:2.4;rows.push([Math.max(13.5,27*Math.pow(Math.max(0,1-Math.pow(t,p)),1/p)),y<35?BASE+y*(35-BASE)/35:y,0]);}
 return [...rows.slice(0,-1),[8.4,70,0],...neck];
};
const pebble:Form={crease:70,section:oval(1.17),rows:outer(pebbleRows())};
/** A truncated triangular prism: three broad faces, three narrow bevels, under a faceted roof. */
const prism:Form={crease:22,section:a=>Math.min(polygon(3,a+Math.PI/6),1.22*polygon(3,a-Math.PI/6)),rows:outer([[0,BASE,0],[19.6,BASE,0],[21,BASE+1.4,0],[21,62.4,0],[18.4,65.4,0],[11.6,67.8,0],[9.4,69.2,0],[8.6,69.8,0],...neck])};
export const bottleForms:Record<Silhouette,Form>={tower,pebble,prism};

/** Each cap fits over the actuator's 6.5 mm radius and sits on the collar. */
const cavity:Row[]=[[0,100.6,1],[6.9,100.6,1]];
const CAP_ROWS=34;
const capRows=(rows:Row[])=>resample(rows,CAP_ROWS).concat(cavity);
const orb=():Row[]=>{
 const rows:Row[]=[[6.9,83,1],[8.7,83,0]],c=95,R=13;
 const from=Math.asin(8.7/R);rows.push([8.7,c-R*Math.cos(from),0]);
 for(let k=1;k<=18;k++){const p=from+(Math.PI-from)*k/18;rows.push([Math.max(0,R*Math.sin(p)),c-R*Math.cos(p),0]);}
 return rows;
};
export const capForms:Record<Silhouette,Form>={
 tower:{crease:22,section:tower.section,rows:capRows([[6.9,83,1],[9.8,83,0],[11,84.2,0],[11,101.4,0],[9.4,103.6,0],[0,103.6,0]])},
 pebble:{crease:70,section:oval(1.08),rows:capRows(orb())},
 prism:{crease:22,section:prism.section,rows:capRows([[6.9,83,1],[9,83,0],[10.2,84.2,0],[10.2,101.4,0],[8.6,103.6,0],[0,103.6,0]])},
};

/** Heavy collar: polished bevels, a raised bead and two bands of straight knurling. */
const KNURLS=60;
export const collarForm:Form={crease:24,section:a=>1+.024*Math.abs(((a/TAU*KNURLS)%1)*2-1),rows:[
 [8.1,71.4,1],[9.3,71.4,1],[10,72.1,1],[10,74.4,1],[10,74.6,0],[10,76.7,0],[10,76.9,1],[10.5,77.1,1],[10.5,77.7,1],[10,77.9,1],[10,78.1,0],[10,80.2,0],[10,80.4,1],[10,81.1,1],[9.4,81.9,1],[3.6,81.9,1],[3.6,81.3,1],[8.1,81.3,1],
]};
export const KNURL_SEGMENTS=KNURLS*4;
/** Liquid in the bore with a meniscus that climbs the glass. */
export const liquidRows:Row[]=[[0,5.05,1],[13,5.05,1],[15.5,5.55,1],[16.52,7,1],[16.52,63.5,1],[16.2,63.15,1],[15.4,62.92,1],[13.8,62.8,1],[9,62.72,1],[0,62.7,1]];
