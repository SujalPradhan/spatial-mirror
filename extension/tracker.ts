import {FilesetResolver,HandLandmarker} from '@mediapipe/tasks-vision';
import {NS} from './protocol';

let token='',detector:HandLandmarker|null=null,lastTs=0;
const post=(msg:object)=>parent.postMessage({ns:NS,token,...msg},'*');
async function load(){
 try{
  const files=await FilesetResolver.forVisionTasks(chrome.runtime.getURL('wasm'));
  detector=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:chrome.runtime.getURL('hand_landmarker.task'),delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6});
  post({t:'ready'});
 }catch(error){post({t:'error',message:String(error)});}
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
   const handedness=(r.handedness??[]).map(h=>{const n=h?.[0]?.categoryName;return n==='Left'||n==='Right'?n:null;});
   post({t:'result',landmarks:r.landmarks,worldLandmarks:r.worldLandmarks,handedness,ms:performance.now()-start});
  }catch(error){post({t:'error',message:String(error)});}
  finally{bitmap.close();}
 }
});
const hello=setInterval(()=>{if(token)clearInterval(hello);else parent.postMessage({ns:NS,t:'hello'},'*');},250);
parent.postMessage({ns:NS,t:'hello'},'*');
