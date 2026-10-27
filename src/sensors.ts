import { Euler, Quaternion } from 'three';
import { finiteValues, motionGyroRadians, percentile, quaternionAngle, summarize } from './stats';
import type { Quat, Sample, SensorReading, TestResult } from './types';

interface BrowserSensor extends EventTarget {
  start():void; stop():void; timestamp:number|null;
  x?:number; y?:number; z?:number; quaternion?:number[]; illuminance?:number;
}
type SensorConstructor = new (options:{frequency:number; referenceFrame?:string})=>BrowserSensor;
const definitions = [
  ['accel','Accelerometer','Accelerometer','m/s²'],
  ['gyro','Gyroscope','Gyroscope','rad/s'],
  ['linear','Linear acceleration','LinearAccelerationSensor','m/s²'],
  ['gravity','Gravity','GravitySensor','m/s²'],
  ['relative','Fused orientation','RelativeOrientationSensor','quaternion'],
  ['absolute','Compass orientation','AbsoluteOrientationSensor','quaternion'],
  ['light','Ambient light','AmbientLightSensor','lux'],
  ['magnetic','Magnetic field','Magnetometer','µT'],
] as const;
export const testInstructions:Record<string,{title:string;instruction:string;duration:number}> = {
  rest:{title:'Resting stability',instruction:'Place the phone on a still surface. Leave it untouched for 30 seconds. This measures noise and relative drift, not calibrated absolute accuracy.',duration:30},
  tilt:{title:'Slow tilt',instruction:'Slowly tilt the phone forward, back, left and right. Pause between movements. Watch gravity change axes and the gyro respond during rotation.',duration:20},
  move:{title:'Translation',instruction:'Keep the phone facing the same way and gently move it sideways, then stop. Linear acceleration should respond most at the start and stop; orientation should stay similar.',duration:20},
  return:{title:'Return to pose',instruction:'Rest the phone against a repeatable support. Lift and turn it, then return it to that same support before the timer ends. Endpoint difference includes your placement error.',duration:20},
};

export class SensorHub {
  readings = new Map<string,SensorReading>();
  histories = new Map<string,Sample[]>();
  active=false; quaternion:Quat|null=null; orientationSource='None';
  results:TestResult[]=[];
  onReading:()=>void=()=>{};
  onOrientation:(q:Quat,t:number,source:string)=>void=()=>{};
  onTest:(result:TestResult)=>void=()=>{};
  private sensors:BrowserSensor[]=[];
  private generation=0;
  get orientationReady(){return this.active&&this.quaternion!==null;}
  get orientationIssue(){
    if(!this.active||this.orientationReady)return '';
    const reason=this.readings.get('relative')?.reason;
    return reason&&/denied|permission|not.allowed/i.test(reason)?'Motion access is blocked. Allow motion sensors in this site’s settings, then restart sensors.':'Waiting for motion readings. Check that motion sensors are allowed for this site.';
  }
  private capture:{kind:string;start:number;date:string;samples:Map<string,Sample[]>;orientations:Sample[]}|null=null;
  private testTimer?:ReturnType<typeof setTimeout>;
  constructor(){
    for(const [id,label,api,unit] of definitions) this.readings.set(id,{id,label,unit,source:`${api} API`,status:'idle',values:null,count:0,rate:0,gapP95:null,age:null,timestamp:null});
    for(const [id,label,unit] of [['eventAccel','Motion-event acceleration','m/s²'],['eventGyro','Motion-event gyro','rad/s'],['eventLinear','Motion-event linear acceleration','m/s²'],['eventOrientation','Orientation events','degrees']])
      this.readings.set(id,{id,label,unit,source:id==='eventOrientation'?'DeviceOrientationEvent':'DeviceMotionEvent',status:'idle',values:null,count:0,rate:0,gapP95:null,age:null,timestamp:null});
  }
  async start(){
    if(this.active)return;
    if(!window.isSecureContext)throw new Error('Open the controller using its HTTPS link or USB localhost link.');
    for(const name of ['DeviceMotionEvent','DeviceOrientationEvent']){
      const ctor=(window as unknown as Record<string,{requestPermission?:()=>Promise<string>}>)[name];
      if(typeof ctor?.requestPermission==='function' && await ctor.requestPermission()!=='granted')throw new Error('Motion permission was not granted.');
    }
    this.active=true;const generation=++this.generation;
    for(const r of this.readings.values()){r.status='waiting';r.reason=undefined;}
    window.addEventListener('deviceorientation',this.orientation);
    window.addEventListener('devicemotion',this.motion);
    for(const [id,,api] of definitions){
      const C=(window as unknown as Record<string,SensorConstructor>)[api];
      const reading=this.readings.get(id)!;
      if(!C){reading.status='unavailable';reading.reason='Not exposed by this browser; this does not mean the hardware is absent.';continue;}
      try{
        const s=new C({frequency:60,referenceFrame:'device'});
        s.addEventListener('reading',()=>{
          if(!this.active||generation!==this.generation)return;
          const values=id==='relative'||id==='absolute'?s.quaternion:id==='light'?[s.illuminance]:[s.x,s.y,s.z];
          if(values && finiteValues(values)){
            this.record(id,values,s.timestamp??performance.now());
            if(id==='relative')this.setQuaternion(values as Quat,'RelativeOrientationSensor',s.timestamp??performance.now());
          }
        });
        s.addEventListener('error',(e)=>{if(!this.active||generation!==this.generation)return;reading.status='error';reading.reason=(e as Event & {error:Error}).error?.message||'Sensor access failed';});
        s.start();this.sensors.push(s);
      }catch(e){reading.status='error';reading.reason=String(e);}
    }
  }
  stop(){
    this.active=false;this.generation++;
    window.removeEventListener('deviceorientation',this.orientation);
    window.removeEventListener('devicemotion',this.motion);
    for(const s of this.sensors)s.stop();this.sensors=[];
    for(const r of this.readings.values())if(r.status==='live'||r.status==='waiting')r.status='paused';
    this.quaternion=null;this.orientationSource='None';
    if(this.capture)this.finishTest(true);
  }
  private setQuaternion(q:Quat,source:string,t=performance.now()){
    const norm=Math.hypot(...q);if(norm<.001)return;
    if(this.capture && this.capture.orientations.length && source!==this.orientationSource)this.finishTest(true);
    this.quaternion=q.map(v=>v/norm) as Quat;this.orientationSource=source;
    if(this.capture)this.capture.orientations.push({t:performance.now()-this.capture.start,values:[...this.quaternion]});
    this.onOrientation(this.quaternion,t,source);this.onReading();
  }
  private orientation=(e:DeviceOrientationEvent)=>{
    if(!this.active||!finiteValues([e.beta,e.gamma])||e.alpha!==null&&!Number.isFinite(e.alpha))return;
    // Some browsers provide tilt without a heading. A zero heading still gives
    // useful clutched pitch/roll; never present it as a compass reading.
    const values=[e.alpha??0,e.beta!,e.gamma!];
    this.record('eventOrientation',values,performance.now());
    const rel=this.readings.get('relative')!;
    if(rel.status!=='live'||performance.now()-(rel.timestamp??0)>1000){
      const d=Math.PI/180;
      const q=new Quaternion().setFromEuler(new Euler(values[1]*d,values[2]*d,values[0]*d,'ZXY'));
      this.setQuaternion(q.toArray() as Quat,e.alpha===null?'DeviceOrientationEvent (tilt only)':'DeviceOrientationEvent',e.timeStamp);
    }
  };
  private motion=(e:DeviceMotionEvent)=>{
    for(const [id,v] of [['eventAccel',e.accelerationIncludingGravity],['eventLinear',e.acceleration]] as const){
      if(v&&finiteValues([v.x,v.y,v.z]))this.record(id,[v.x!,v.y!,v.z!],performance.now());
    }
    const g=e.rotationRate;
    const radians=g?motionGyroRadians(g):null;
    if(radians)this.record('eventGyro',radians,performance.now());
  };
  private record(id:string,values:number[],timestamp:number){
    const r=this.readings.get(id)!;
    const now=performance.now();
    r.values=[...values];r.count++;r.timestamp=now;r.status='live';
    const history=this.histories.get(id)??[];
    history.push({t:now,values:[...values]});
    while(history.length>600)history.shift();this.histories.set(id,history);
    if(this.capture){const samples=this.capture.samples.get(id)??[];samples.push({t:now-this.capture.start,values:[...values],sourceTimestamp:timestamp});this.capture.samples.set(id,samples);}
    // Hardware timestamps differ from browser arrival times. Retain them as metadata,
    // but use one browser clock for rate and jitter calculations.
  }
  snapshot():SensorReading[]{
    const now=performance.now();
    return [...this.readings.values()].map(r=>{
      const recent=(this.histories.get(r.id)??[]).filter(s=>now-s.t<2000);
      const stats=summarize(recent);
      return {...r,age:r.timestamp===null?null:now-r.timestamp,rate:stats.rate,gapP95:stats.gapP95};
    });
  }
  beginTest(kind:string){
    if(!this.active)throw new Error('Start sensors before beginning a test.');
    if(this.capture)throw new Error('A measurement is already running.');
    const config=testInstructions[kind];if(!config)throw new Error('Unknown test.');
    this.capture={kind,start:performance.now(),date:new Date().toISOString(),samples:new Map(),orientations:[]};
    this.testTimer=setTimeout(()=>this.finishTest(false),config.duration*1000);
  }
  get progress(){return this.capture?{kind:this.capture.kind,remaining:Math.max(0,testInstructions[this.capture.kind].duration-(performance.now()-this.capture.start)/1000)}:null;}
  finishTest(interrupted=false){
    const c=this.capture;if(!c)return;
    clearTimeout(this.testTimer);this.capture=null;
    const duration=(performance.now()-c.start)/1000;
    const sensors:TestResult['sensors']={};
    for(const [id,samples] of c.samples)sensors[id]={...summarize(samples),samples};
    const qs=c.orientations;const first=qs[0]?.values as Quat|undefined;
    const angles=first?qs.map(s=>quaternionAngle(first,s.values as Quat)):[];
    const orientation=first?{driftDegrees:quaternionAngle(first,qs[qs.length-1].values as Quat),p95Degrees:percentile(angles,.95)!,samples:qs.length}:null;
    const interpretation:string[]=[];
    if(interrupted)interpretation.push('Interrupted: do not treat this run as a completed physical test.');
    if(c.kind==='rest'){
      const a=sensors.accel??sensors.eventAccel;
      const g=sensors.gyro??sensors.eventGyro;
      if(a)interpretation.push(`Mean acceleration magnitude ${Math.hypot(...a.mean).toFixed(3)} m/s²; approximately 9.81 is expected at rest. This is a plausibility check, not calibration.`);
      if(g)interpretation.push(`Resting gyro mean magnitude ${Math.hypot(...g.mean).toFixed(4)} rad/s. Motion during the run invalidates a bias interpretation.`);
      if(orientation)interpretation.push(`Orientation endpoint change ${orientation.driftDegrees.toFixed(2)}°; p95 deviation ${orientation.p95Degrees.toFixed(2)}°. These measure relative orientation, not absolute accuracy or plane-normal error.`);
    }else if(c.kind==='return')interpretation.push('Endpoint change combines sensor drift and placement error. Use the same physical support for repeatable results.');
    else interpretation.push('Review axis response against the movement you performed. No automatic accuracy verdict is possible without a known physical reference.');
    const result:TestResult={id:crypto.randomUUID(),kind:c.kind,started:c.date,duration,interrupted,instruction:testInstructions[c.kind].instruction,sensors,orientation,interpretation};
    this.results.push(result);if(this.results.length>12)this.results.shift();this.onTest(result);
  }
}
