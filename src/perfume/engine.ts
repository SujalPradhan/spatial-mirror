import {MirrorEngine} from '../mirror/engine';
import type {GestureFrame,MirrorViewState} from '../mirror/contracts';
import {meshSkins,type MeshSkin} from '../mirror/parts-view';
import {PerfumeBehaviour} from './behaviour';
import type {PerfumeOutput,PerfumeSceneExtra,PerfumeSound,PerfumeWorld} from './contracts';

/** position is the phone's pump setting, not the live stem, so a hand press never leaks into saved phase. 360 would wrap to 0 in the shell. */
export class PerfumeEngine extends MirrorEngine<MeshSkin,PerfumeSceneExtra,PerfumeSound> {
 private mechanism:PerfumeBehaviour;
 constructor(world:PerfumeWorld){const mechanism=new PerfumeBehaviour(world);super(world,mechanism,meshSkins);this.mechanism=mechanism;}
 get pump(){return this.mechanism.pump;}
 get lastSpray(){return this.mechanism.lastSpray;}
 get caption(){return this.scene.caption;}
 restore(){this.mechanism.restore(this.scene);}
 override get idle(){return this.mechanism.idle;}
 // Idle here means the phone is not holding the pump, so leaving its pump tool lets go.
 override set idle(on:boolean){if(on&&!this.mechanism.idle)this.mechanism.seekDegrees=0;this.mechanism.idle=on;}
 override get position(){return Math.min(359,this.mechanism.seekDegrees);}
 override seek(degrees:number){this.mechanism.seek(degrees);}
 override kick(direction:1|-1){if(!this.context.frozen)this.mechanism.kick(direction);}
 override step(frame:GestureFrame,dt:number,view:MirrorViewState,frozen:boolean):PerfumeOutput{return {...super.step(frame,dt,view,frozen) as Omit<PerfumeOutput,'doses'>,doses:this.mechanism.pump.doses};}
}
