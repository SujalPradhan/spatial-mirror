import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialAtp,validateAtp,clampPhase} from '../src/atp/model';
import {gestureGuide,scientificNote,sources} from '../src/atp/content';
import type {AtpStructureAsset} from '../src/atp/contracts';

const asset=JSON.parse(readFileSync(new URL('../public/models/atp-6oqr.json',import.meta.url),'utf8')) as AtpStructureAsset;
const readme=readFileSync(new URL('../public/models/atp-6oqr.README.md',import.meta.url),'utf8');
const provenance=JSON.parse(readme.match(/```json\n([\s\S]*?)\n```/)![1]) as {
  sourceSha256:string;assembly:number;assemblyOperation:string;originAngstrom:number[];rotationRows:number[][];
  chains:{authChain:string;labelChain:string;entity:string;component:string;alphaCarbons:number}[];
  sourceSamples:{chain:string;residue:string;source:number[];transformed:number[]}[];
};
const near=(actual:number,expected:number,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
const point=(id:string,index=0)=>asset.chains.find(c=>c.id===id)!.points.slice(index*3,index*3+3);
const dot=(a:number[],b:number[])=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const transform=(source:number[])=>provenance.rotationRows.map(row=>dot(row,source.map((n,i)=>n-provenance.originAngstrom[i])));

test('ATP starts paused at home with only pose and phase in its saved state',()=>{
  const state=initialAtp();
  assert.deepEqual(Object.keys(state).sort(),['frozen','phase','schema','tool','view']);
  assert.equal(state.schema,2);assert.equal(state.phase,0);assert.equal(state.tool,'view');
  state.view.q[0]=.3;assert.notEqual(initialAtp().view.q[0],.3);
});

test('phase stays bounded',()=>{
  for(const [input,expected] of [[-20,0],[0,0],[120,120],[360,360],[721,360],[NaN,0],[Infinity,0]])near(clampPhase(input),expected);
});

test('restoration allows only state fields and never resumes cameras, a held grab or playback',()=>{
  const source={...initialAtp(),playing:true,camera:true,held:true,inputOwner:'phone'};
  const restored=validateAtp(source);
  assert.deepEqual(Object.keys(restored).sort(),['frozen','phase','schema','tool','view']);
  restored.view.q[0]=.2;assert.notEqual(source.view.q[0],.2);
});

test('invalid imports cannot install malformed enums, phases or non-finite values',()=>{
  const invalid:Record<string,unknown>[]=[{schema:1},{tool:'spin'},{phase:-.1},{phase:360.1},{phase:NaN},{phase:Infinity},{frozen:1},{view:null}];
  for(const patch of invalid)assert.throws(()=>validateAtp({...initialAtp(),...patch}));
  for(const value of [null,[],3,'state',{}])assert.throws(()=>validateAtp(value));
});

test('view bounds and quaternion validation prevent invalid poses while preserving valid limits',()=>{
  for(const zoom of [.65,2.5])assert.equal(validateAtp({...initialAtp(),view:{...initialAtp().view,zoom}}).view.zoom,zoom);
  for(const patch of [{zoom:.64},{zoom:2.51},{x:6.01},{y:-6.01},{x:NaN},{q:[0,0,0,0]},{q:[0,0,0,8]},{q:[0,0,Infinity,1]},{q:[0,0,1]}]) {
    assert.throws(()=>validateAtp({...initialAtp(),view:{...initialAtp().view,...patch}}));
  }
  assert.deepEqual(validateAtp({...initialAtp(),view:{q:[0,0,0,1.01],zoom:1,x:6,y:-6}}).view.q,[0,0,0,1]);
});

test('the note keeps measured structure and playful motion apart, and the guide has no duplicates',()=>{
  assert.match(scientificNote,/static snapshot/);assert.match(scientificNote,/not simulation/);
  assert.match(scientificNote,/ten protons per turn/);assert.match(scientificNote,/three ATP/);
  assert.ok(sources.some(source=>source.url==='https://www.rcsb.org/structure/6OQR'));
  assert.equal(new Set(gestureGuide.map(g=>g.id)).size,gestureGuide.length);
});

test('the sourced asset contains the complete 22-chain CA selection, not fabricated residues',()=>{
  assert.equal(asset.schema,'atp-structure-v1');assert.equal(asset.pdb,'6OQR');assert.equal(asset.units,'angstrom');
  assert.equal(asset.source,'https://files.rcsb.org/download/6OQR.cif');
  assert.equal(asset.sha256,'f69f53bec1acc5a306ea45f30ce541b35a07a6fa0a4de25e45f56259110b4851');
  assert.equal(provenance.sourceSha256,asset.sha256);
  assert.equal(provenance.assembly,1);assert.equal(provenance.assemblyOperation,'identity');
  const expectedCounts:Record<string,number>={W:173,C:512,B:511,A:508,X:156,H:136,G:284,F:458,E:460,D:460,
    J:77,L:77,M:77,N:77,O:77,P:77,Q:77,R:76,Y:156,a:266,I:77,S:77};
  assert.equal(asset.chains.length,22);assert.equal(new Set(asset.chains.map(chain=>chain.id)).size,22);
  for(const chain of asset.chains) {
    assert.equal(chain.points.length,expectedCounts[chain.id]*3);
    assert.ok(chain.points.every(Number.isFinite));
  }
  assert.equal(asset.chains.reduce((sum,chain)=>sum+chain.points.length/3,0),4849);
  assert.match(readme,/No coordinates were interpolated or invented/);
  assert.match(readme,/ligands.*nucleotides\/ions/);
});

test('independent RCSB entity-to-author-chain mapping keeps head, ring and supports distinct',()=>{
  const expected:Record<string,string[]>={rotor:['G','H','I','J','L','M','N','O','P','Q','R','S'],
    stator:['W','X','Y','a'],head:['A','B','C','D','E','F']};
  for(const [component,ids] of Object.entries(expected))assert.deepEqual(asset.chains.filter(c=>c.component===component).map(c=>c.id).sort(),ids.sort());
  const ring=provenance.chains.filter(chain=>chain.entity==='7');assert.equal(ring.length,10);
  assert.equal(provenance.chains.find(chain=>chain.authChain==='a')!.labelChain,'T');
  assert.equal(provenance.chains.find(chain=>chain.authChain==='W')!.labelChain,'A');
  assert.ok(asset.chains.filter(chain=>chain.component==='head').every(chain=>/alpha|beta/.test(chain.name)));
});

test('documented orientation is rigid and right handed, with ring centered and head above',()=>{
  const r=provenance.rotationRows;
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)near(dot(r[i],r[j]),i===j?1:0,1e-12);
  const cross=[r[0][1]*r[1][2]-r[0][2]*r[1][1],r[0][2]*r[1][0]-r[0][0]*r[1][2],r[0][0]*r[1][1]-r[0][1]*r[1][0]];
  near(dot(cross,r[2]),1,1e-12);
  const ring=asset.chains.filter(chain=>/subunit c$/.test(chain.name));
  const centroids=ring.map(chain=>[0,1,2].map(axis=>chain.points.filter((_,i)=>i%3===axis).reduce((sum,n)=>sum+n,0)/(chain.points.length/3)));
  for(let axis=0;axis<3;axis++)near(centroids.reduce((sum,p)=>sum+p[axis],0)/10,0,.00002);
  assert.ok(asset.anchors.head[1]>100);assert.deepEqual(asset.anchors.membrane,[0,0,0]);
  assert.deepEqual(asset.anchors.rotor,[0,0,0]);
});

test('source coordinate samples independently checked against RCSB PDB map to stored points',()=>{
  // Original CA coordinates read separately from the fixed-width RCSB 6OQR.pdb file.
  // These expected values do not come from generated JSON/provenance.
  const original:Record<string,number[]>={W:[132.807,111.113,166.885],A:[114.466,91.046,165.874],
    G:[168.757,142.412,178.188],H:[181.335,215.335,210.832],I:[253.539,253.986,210.962],a:[246.633,265.286,174.387]};
  for(const [chain,source] of Object.entries(original)) {
    const expected=transform(source),actual=point(chain);
    actual.forEach((n,axis)=>near(n,expected[axis],.000051));
    assert.deepEqual(provenance.sourceSamples.find(sample=>sample.chain===chain)!.source,source);
  }
  const distance=(a:number[],b:number[])=>Math.hypot(...a.map((n,i)=>n-b[i]));
  near(distance(point('W'),point('I')),distance(original.W,original.I),.0002);
});
