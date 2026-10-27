import{test}from'node:test';
import assert from'node:assert/strict';
import{SensorHub}from'../src/sensors';

test('motion fallback accepts tilt without heading and ignores invalid samples',async()=>{
 const target=Object.assign(new EventTarget(),{isSecureContext:true});
 const old=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:target});
 const hub=new SensorHub();
 const orientation=(alpha:number|null,beta:number|null,gamma:number|null)=>{const e=Object.assign(new Event('deviceorientation'),{alpha,beta,gamma});target.dispatchEvent(e);};
 try{await hub.start();orientation(null,30,0);assert.equal(hub.orientationReady,true);assert.equal(hub.orientationSource,'DeviceOrientationEvent (tilt only)');assert.ok(Math.abs(hub.quaternion![0]-.258819)<1e-5);const before=[...hub.quaternion!];orientation(0,null,0);orientation(NaN,20,0);assert.deepEqual(hub.quaternion,before);hub.stop();orientation(0,90,0);assert.equal(hub.quaternion,null);assert.equal(hub.orientationReady,false);}finally{hub.stop();if(old)Object.defineProperty(globalThis,'window',old);else Reflect.deleteProperty(globalThis,'window');}
});

test('queued readings from a stopped sensor cannot restore or override orientation',async()=>{
 const instances:Sensor[]=[];class Sensor extends EventTarget{quaternion=[0,0,0,1];timestamp=0;constructor(){super();instances.push(this);}start(){}stop(){}read(q:number[]){this.quaternion=q;this.dispatchEvent(new Event('reading'));}}
 const target=Object.assign(new EventTarget(),{isSecureContext:true,RelativeOrientationSensor:Sensor});
 const old=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:target});const hub=new SensorHub();
 try{await hub.start();instances[0].read([0,0,0,1]);assert.equal(hub.orientationReady,true);hub.stop();instances[0].read([1,0,0,0]);assert.equal(hub.quaternion,null);await hub.start();instances[1].read([0,0,0,1]);instances[0].read([1,0,0,0]);assert.deepEqual(hub.quaternion,[0,0,0,1]);hub.stop();}finally{hub.stop();if(old)Object.defineProperty(globalThis,'window',old);else Reflect.deleteProperty(globalThis,'window');}
});
