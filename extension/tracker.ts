import {FilesetResolver,HandLandmarker,ImageSegmenter} from '@mediapipe/tasks-vision';
import {NS} from './protocol';

let token='',detector:HandLandmarker|null=null,segmenter:ImageSegmenter|null=null,segLoading=false,lastTs=0,files:Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>|null=null;
const post=(msg:object,transfer:Transferable[]=[])=>parent.postMessage({ns:NS,token,...msg},'*',transfer);
async function load(){
 try{
  files=await FilesetResolver.forVisionTasks(chrome.runtime.getURL('wasm'));
  detector=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:chrome.runtime.getURL('hand_landmarker.task'),delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6});
  post({t:'ready'});
 }catch(error){post({t:'error',message:String(error)});}
}
async function loadSegmenter(){
 if(segmenter||segLoading||!files)return;segLoading=true;
 try{segmenter=await ImageSegmenter.createFromOptions(files,{baseOptions:{modelAssetPath:chrome.runtime.getURL('models/selfie_segmenter.tflite'),delegate:'CPU'},runningMode:'VIDEO',outputConfidenceMasks:true,outputCategoryMask:false});}
 catch(error){post({t:'seg-error',message:String(error)});return;}
 segLoading=false;
}
/** The person confidence as bytes: the last of two masks, or the only one. */
function segment(bitmap:ImageBitmap,ts:number){
 const r=segmenter!.segmentForVideo(bitmap,ts),masks=r.confidenceMasks??[],mask=masks[masks.length-1];
 if(!mask){r.close();return null;}
 const f=mask.getAsFloat32Array(),bytes=new Uint8Array(f.length);for(let i=0;i<f.length;i++)bytes[i]=Math.max(0,Math.min(255,Math.round(f[i]*255)));
 const out={mask:bytes.buffer,mw:mask.width,mh:mask.height};r.close();return out;
}
window.addEventListener('message',e=>{
 if(e.source!==parent||e.data?.ns!==NS)return;
 const d=e.data;
 if(d.t==='init'&&!token){token=d.token;load();return;}
 if(!token||d.token!==token)return;
 if(d.t==='frame'){
  const bitmap:ImageBitmap=d.bitmap;
  try{
   if(!detector)return;
   const start=performance.now(),ts=Math.max(lastTs+1,Math.round(start));lastTs=ts;
   const r=detector.detectForVideo(bitmap,ts);
   let seg:{mask:ArrayBuffer;mw:number;mh:number}|null=null,segMs=0;
   if(d.segment==='fail'){post({t:'seg-error',message:'forced'});}
   else if(d.segment){
    if(!segmenter)void loadSegmenter();
    else try{const s0=performance.now();seg=segment(bitmap,ts+1);segMs=performance.now()-s0;lastTs=ts+1;}catch(error){segmenter=null;segLoading=true;post({t:'seg-error',message:String(error)});}
   }
   const handedness=(r.handedness??[]).map(h=>{const n=h?.[0]?.categoryName;return n==='Left'||n==='Right'?n:null;});
   post({t:'result',landmarks:r.landmarks,worldLandmarks:r.worldLandmarks,handedness,ms:performance.now()-start-segMs,segMs,...(seg?{mask:seg.mask,mw:seg.mw,mh:seg.mh}:{})},seg?[seg.mask]:[]);
  }catch(error){post({t:'error',message:String(error)});}
  finally{bitmap.close();}
 }
});
const hello=setInterval(()=>{if(token)clearInterval(hello);else parent.postMessage({ns:NS,t:'hello'},'*');},250);
parent.postMessage({ns:NS,t:'hello'},'*');
