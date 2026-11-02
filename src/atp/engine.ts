import {MirrorEngine,REV} from '../mirror/engine';
import type {GestureFrame,MirrorViewState} from '../mirror/contracts';
import {atpSkins,type AtpEngineOutput,type AtpSceneExtra,type AtpSkin,type AtpSound,type AtpWorld} from './contracts';
import {AtpBehaviour} from './behaviour';

export class AtpEngine extends MirrorEngine<AtpSkin,AtpSceneExtra,AtpSound> {
 private motor:AtpBehaviour;
 constructor(world:AtpWorld){const motor=new AtpBehaviour(world);super(world,motor,atpSkins);this.motor=motor;}
 get atp(){return this.motor.count;}
 get rotorDegrees(){return this.motor.angle*180/Math.PI;}
 setRotorDegrees(n:number){this.motor.setRotorDegrees(n);}
 override get idle(){return this.motor.idle;}
 override set idle(on:boolean){this.motor.idle=on;}
 override get position(){return this.rotorDegrees;}
 override get speed(){return this.motor.omega/REV;}
 override seek(degrees:number){this.setRotorDegrees(degrees);}
 override kick(direction:1|-1){if(!this.context.frozen)this.motor.kick(direction);}
 override step(frame:GestureFrame,dt:number,view:MirrorViewState,frozen:boolean):AtpEngineOutput{return {...super.step(frame,dt,view,frozen) as Omit<AtpEngineOutput,'atp'>,atp:this.motor.count};}
}
