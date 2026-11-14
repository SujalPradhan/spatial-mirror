import {MirrorEngine} from '../mirror/engine';
import type {GestureFrame,MirrorViewState,WorldPoint} from '../mirror/contracts';
import {atomSkins,type AtomEngineOutput,type AtomSceneExtra,type AtomSkin,type AtomSound,type AtomWorld} from './contracts';
import {AtomBehaviour} from './behaviour';

export class AtomEngine extends MirrorEngine<AtomSkin,AtomSceneExtra,AtomSound> {
 private atom:AtomBehaviour;
 constructor(world:AtomWorld){
  const atom=new AtomBehaviour();super(world,atom,atomSkins);this.atom=atom;
 }
 get element(){return this.atom.element;}
 get electrons(){return this.atom.electrons;}
 get atomScene(){return this.scene;}
 /** Steps to the next element, or back with -1. */
 next(step=1){this.atom.next(step);}
 get stepping(){return this.atom.busy;}
 get taking(){return this.atom.manualTake;}
 toggleTake(){if(!this.context.frozen)this.atom.manualTake=!this.atom.manualTake;}
 override get idle(){return this.atom.idle;}
 override set idle(on:boolean){this.atom.idle=on;}
 override kick(direction:1|-1){if(!this.context.frozen)this.atom.kick(direction);}
 // Dragging turns the atom; plucking a particle by mouse would fight that.
 override pointerDown(_:WorldPoint){return false;}
 override step(frame:GestureFrame,dt:number,view:MirrorViewState,frozen:boolean):AtomEngineOutput{return {...super.step(frame,dt,view,frozen) as Omit<AtomEngineOutput,'electrons'>,electrons:this.atom.electrons};}
}
