// Classic worker: MediaPipe's WASM loader uses importScripts.
importScripts('/vendor/mediapipe/vision_bundle.js');
let detector,files,delegate='CPU';
async function createDetector(useGPU){
  const options={baseOptions:{modelAssetPath:'/models/hand_landmarker.task',delegate:useGPU?'GPU':'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6};
  if(useGPU)options.canvas=new OffscreenCanvas(1,1);
  const next=await Vision.HandLandmarker.createFromOptions(files,options);
  delegate=useGPU?'GPU':'CPU';return next;
}
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'init') {
      files = await Vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      if(data.preferGPU&&typeof OffscreenCanvas!=='undefined'){
        try{detector=await createDetector(true);}catch{detector=await createDetector(false);}
      }else detector=await createDetector(false);
      self.postMessage({type:'ready',delegate});
    } else if (data.type === 'frame') {
      try {
        const start = performance.now();
        let result;
        try{result=detector.detectForVideo(data.bitmap,data.timestamp);}
        catch(error){if(delegate!=='GPU')throw error;try{detector.close();}catch{}detector=await createDetector(false);result=detector.detectForVideo(data.bitmap,data.timestamp);}
        const handedness=(result.handedness??result.handednesses??[]).map(h=>{const name=h?.[0]?.categoryName;return name==='Left'||name==='Right'?name:null;});
        self.postMessage({type:'result',landmarks:result.landmarks,worldLandmarks:result.worldLandmarks,handedness,inferenceMs:performance.now()-start,timestamp:data.timestamp,delegate});
      } finally { data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({type:'error',message:String(error)}); }
};
