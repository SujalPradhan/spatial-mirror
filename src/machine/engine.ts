import {MirrorEngine} from '../mirror/engine';
import type {GestureFrame,MirrorViewState} from '../mirror/contracts';
import {MachineBehaviour} from './behaviour';
import {machineSkins,type MachineEngineOutput,type MachineSceneExtra,type MachineSkin,type MachineSound,type MachineWorld} from './contracts';

export class MachineEngine extends MirrorEngine<MachineSkin,MachineSceneExtra,MachineSound> {
 readonly machine:MachineBehaviour;
 constructor(world:MachineWorld){const machine=new MachineBehaviour(world);super(world,machine,machineSkins);this.machine=machine;}
 override get idle(){return this.machine.idle;}
 override set idle(on:boolean){this.machine.idle=on;}
 /** Unwrapped crank degrees; the shell wraps it to 0..360 for saving. */
 override get position(){return this.machine.crank;}
 override get speed(){return this.machine.omega/360;}
 override seek(degrees:number){this.machine.seek(degrees);}
 override kick(direction:1|-1){if(!this.context.frozen)this.machine.kick(direction);}
 /** What the browser test reads. */
 get live(){return this.context.scene;}
 get caption(){return this.machine.caption;}
 screenOf(id:string){return (this.world as MachineWorld).screenOf(id);}
 /** A point on the top thread, 0..1 on the stage, where a pinch would take hold. */
 threadScreen(rise=.5){return (this.world as MachineWorld&{threadScreen?(r:number):{x:number;y:number}}).threadScreen?.(rise)??{x:.5,y:.3};}
 restore(){this.letGo();this.machine.restore();}
 cycleTiming(){return this.context.frozen?null:this.machine.cycleTiming();}
 toggleFraming(){if(!this.context.frozen)this.machine.setClose(!this.machine.close);return this.machine.close;}
 override step(frame:GestureFrame,dt:number,view:MirrorViewState,frozen:boolean):MachineEngineOutput{return {...super.step(frame,dt,view,frozen) as Omit<MachineEngineOutput,'stitches'>,stitches:this.machine.count};}
}
