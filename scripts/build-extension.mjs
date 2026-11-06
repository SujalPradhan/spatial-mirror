import {build} from 'esbuild';
import {cp,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'dist-extension'),at=(...p)=>path.join(root,...p);
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await build({entryPoints:Object.fromEntries(['main-world','content','background','popup','tracker'].map(n=>[n,at('extension',`${n}.ts`)])),outdir:out,bundle:true,format:'iife',target:'chrome120',platform:'browser',minify:true,legalComments:'none',logLevel:'warning'});
for(const f of ['manifest.json','tracker.html','popup.html','popup.css'])await cp(at('extension',f),path.join(out,f));
await cp(at('public/models/hand_landmarker.task'),path.join(out,'hand_landmarker.task'));
await mkdir(path.join(out,'wasm'));
for(const f of ['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm'])await cp(at('public/vendor/mediapipe/wasm',f),path.join(out,'wasm',f));
await cp(at('public/vendor/mediapipe/LICENSE.txt'),path.join(out,'wasm','LICENSE.txt'));
console.log('built',out);
