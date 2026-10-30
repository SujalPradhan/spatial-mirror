import { percentile } from './stats';

export type Landmark={x:number;y:number;z:number};
export interface HandFrameMeta {
 frameId:number;sourceTimeMs:number;dispatchAt:number;videoTimeMs:number;timestampSource:string;
 width:number;height:number;inferenceMs:number;
 handedness?:(string|null)[];
}
export interface HandProbeOptions {targetHz?:number;preferGPU?:boolean;reportIntervalMs?:number}
export class HandProbe {
  private suspended=false;
  private generation=0;
  private frameGeneration=0;
  private pausedAt:number|null=null;
  private pausedDuration=0;
  private inFlight=false;
  private ready=false;
  private lastReport=-Infinity;
  private delegate='CPU';
  private frameId=0;
  private frameMeta:HandFrameMeta|null=null;
  private videoCallback:number|null=null;
  private presented:{time:number;mediaTime:number}|null=null;
  private worker:Worker|null=null;
  private timer?:ReturnType<typeof setTimeout>;
  private stopped=false;
  private lastVideoTime=-1;
  private started=0;
  private samples:number[]=[];
  private workerSamples:number[]=[];
  private modelStarted=0;
  private modelStartupMs=0;
  private frames=0;
  private detectedFrames=0;
  private maxHands=0;
  private readyTimer?:ReturnType<typeof setTimeout>;
  constructor(private video:HTMLVideoElement,private canvas:HTMLCanvasElement,private report:(data:Record<string,unknown>,message:string)=>void,private onFrame?:(hands:Landmark[][],capturedAt:number,worldHands:Landmark[][],meta?:HandFrameMeta)=>void,private options:HandProbeOptions={}){}
  get paused(){return this.suspended;}
  start(){
    this.modelStarted=performance.now();
    if(this.video.requestVideoFrameCallback){
      const presented=(_now:number,meta:VideoFrameCallbackMetadata)=>{if(this.stopped)return;this.presented={time:meta.presentationTime,mediaTime:meta.mediaTime};this.videoCallback=this.video.requestVideoFrameCallback(presented);};
      this.videoCallback=this.video.requestVideoFrameCallback(presented);
    }
    this.worker=new Worker('/hand-worker.js?v=3');
    this.readyTimer=setTimeout(()=>this.fail('Hand model did not initialize within 30 seconds.'),30000);
    this.worker.onerror=e=>this.fail(e.message);
    this.worker.onmessage=({data})=>{
      if(this.stopped)return;
      if(data.type==='error'){this.fail(data.message);return;}
      if(data.type==='ready'){clearTimeout(this.readyTimer);this.ready=true;this.delegate=data.delegate??'CPU';this.started=performance.now();this.modelStartupMs=this.started-this.modelStarted;if(this.suspended)this.pausedAt=this.started;else void this.next();}
      if(data.type==='result'){
        this.inFlight=false;if(this.suspended)return;if(this.frameGeneration!==this.generation){void this.next();return;}this.delegate=data.delegate??this.delegate;
        this.frames++;this.samples.push(data.inferenceMs);if(this.samples.length>300)this.samples.shift();
        this.workerSamples.push(performance.now()-data.timestamp);if(this.workerSamples.length>300)this.workerSamples.shift();
        const hands=data.landmarks as Landmark[][];
        this.onFrame?.(hands,data.timestamp,data.worldLandmarks??[],this.frameMeta?{...this.frameMeta,inferenceMs:data.inferenceMs,handedness:data.handedness}:undefined);
        if(hands.length)this.detectedFrames++;this.maxHands=Math.max(this.maxHands,hands.length);
        const rate=this.frames/Math.max(.001,(performance.now()-this.started-this.pausedDuration)/1000);
        this.draw(hands);
        if(performance.now()-this.lastReport>=(this.options.reportIntervalMs??0)){
          this.lastReport=performance.now();
          const metrics={status:'running',delegate:this.delegate,frames:this.frames,detectedFrames:this.detectedFrames,maxHands:this.maxHands,handsNow:hands.length,processedHz:rate,modelStartupMs:this.modelStartupMs,inferenceP50Ms:percentile(this.samples,.5),inferenceP95Ms:percentile(this.samples,.95),workerP95Ms:percentile(this.workerSamples,.95)};
          this.report(metrics,`${hands.length} hand${hands.length===1?'':'s'} detected · ${rate.toFixed(1)} processed frames/s · inference p95 ${percentile(this.samples,.95)?.toFixed(1)} ms. ${hands.length?'Move slowly and check that the dots follow your fingers.':'Show an open hand to the camera.'}`);
          window.dispatchEvent(new CustomEvent('studio-hand-metrics',{detail:metrics}));
        }
        const delay=this.options.targetHz?Math.max(0,1000/this.options.targetHz-(performance.now()-data.timestamp)):30;
        this.timer=setTimeout(()=>void this.next(),delay);
      }
    };
    this.worker.postMessage({type:'init',preferGPU:this.options.preferGPU===true});
  }
  private async next(){
    if(this.stopped||this.suspended||this.inFlight||!this.ready)return;
    if(this.video.readyState<2||this.video.currentTime===this.lastVideoTime){this.timer=setTimeout(()=>void this.next(),30);return;}
    this.lastVideoTime=this.video.currentTime;
    const generation=this.generation;this.frameGeneration=generation;
    this.inFlight=true;
    try{
      const bitmapStarted=performance.now(),videoTimeMs=this.video.currentTime*1000;
      const presentation=this.presented&&Math.abs(this.presented.mediaTime*1000-videoTimeMs)<1?this.presented:null;
      const bitmap=await createImageBitmap(this.video);
      if(this.stopped||this.suspended||generation!==this.generation){this.inFlight=false;bitmap.close();if(!this.stopped&&!this.suspended)void this.next();return;}
      const dispatchAt=performance.now();
      this.frameMeta={frameId:++this.frameId,sourceTimeMs:presentation?.time??bitmapStarted,dispatchAt,videoTimeMs,timestampSource:presentation?'video-presentation-estimate':'bitmap-start-estimate',width:bitmap.width,height:bitmap.height,inferenceMs:0};
      this.worker?.postMessage({type:'frame',bitmap,timestamp:dispatchAt},[bitmap]);
    }catch(e){this.fail(String(e));}
  }
  private draw(hands:Landmark[][]){
    if(this.canvas.width!==this.video.videoWidth)this.canvas.width=this.video.videoWidth;
    if(this.canvas.height!==this.video.videoHeight)this.canvas.height=this.video.videoHeight;
    const c=this.canvas.getContext('2d')!;c.clearRect(0,0,this.canvas.width,this.canvas.height);
    for(const hand of hands)for(const p of hand){c.beginPath();c.arc(p.x*this.canvas.width,p.y*this.canvas.height,5,0,Math.PI*2);c.fillStyle='#d9ff83';c.fill();c.strokeStyle='#173b29';c.lineWidth=2;c.stroke();}
  }
  private fail(message:string){this.stop();this.report({status:'error',reason:message},`Hand tracking: ${message}`);window.dispatchEvent(new CustomEvent('studio-hand-metrics',{detail:{status:'error',reason:message}}));}
  pause(){if(!this.suspended){this.generation++;this.pausedAt=this.ready?performance.now():null;}this.suspended=true;clearTimeout(this.timer);}
  resume(){if(this.stopped||!this.suspended)return;this.suspended=false;if(this.pausedAt!==null)this.pausedDuration+=performance.now()-this.pausedAt;this.pausedAt=null;if(this.ready&&!this.inFlight)void this.next();}
  stop(){
    this.stopped=true;if(this.videoCallback!==null)this.video.cancelVideoFrameCallback?.(this.videoCallback);this.videoCallback=null;clearTimeout(this.timer);clearTimeout(this.readyTimer);this.worker?.terminate();this.worker=null;
    this.canvas.getContext('2d')?.clearRect(0,0,this.canvas.width,this.canvas.height);
    window.dispatchEvent(new CustomEvent('studio-hand-metrics',{detail:{status:'off'}}));
  }
}
