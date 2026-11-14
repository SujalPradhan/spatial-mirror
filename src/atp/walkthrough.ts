import {mostPulled,torn,viewMoved,viewSnapshot,viewZoomed,type MirrorWalkthroughStep} from '../mirror/walkthrough-steps';
import type {AtpEngine} from './engine';

export const atpWalkthrough:readonly MirrorWalkthroughStep<AtpEngine>[]=[
 {gesture:'fist',howTo:'Close your fist over the molecule, then move or twist your hand to turn it.',tip:'Keep the fist closed and drag it slowly across the screen.',snapshot:viewSnapshot,check:viewMoved},
 {gesture:'open',howTo:'Hold a flat hand over the molecule to push its chains apart.',tip:'Bring your open palm over the middle of the molecule and keep your fingers spread.',check:p=>p.scene.fields.some((f:{strength:number;x:number;y:number;radius:number})=>f.strength>=.95&&Math.hypot(f.x-p.state.view.x,f.y-p.state.view.y)<f.radius+2.5)},
 {gesture:'pinch',howTo:'Pinch a chain between thumb and finger, then pull it away from the rest.',tip:'The pinch point sits between your thumb and finger. Put it on a chain, pinch, then move your hand.',check:p=>mostPulled(p)>=.9},
 {gesture:'point',howTo:'Circle one fingertip around the motor to spin it.',tip:'Draw big, quick circles around the centre of the molecule, not small ones on the spot.',snapshot:p=>p.engine.speed,check:(p,before:number)=>Math.abs(p.engine.speed)>=.8&&Math.abs(p.engine.speed)>=Math.abs(before)+.3},
 {gesture:'victory',howTo:'Hold up two fingers to cut a slice through the molecule and look inside.',tip:'Raise your index and middle fingers and keep them over the molecule.',check:p=>p.scene.slice.amount>=.9},
 {gesture:'thumbUp',howTo:'Give a thumbs up to run the motor forwards and make ATP.',tip:'Keep the thumb pointing straight up and the other fingers curled.',snapshot:p=>p.engine.atp,check:(p,before:number)=>p.engine.speed>=1&&p.engine.atp>before},
 {gesture:'thumbDown',howTo:'Give a thumbs down to run the motor backwards and burn ATP.',tip:'Keep the thumb pointing straight down and the other fingers curled.',check:p=>p.engine.speed<=-.5},
 {gesture:'love',howTo:'Make the 🤟 sign to change how the molecule is drawn. Drop your hand and make it again for the next look.',tip:'Thumb, index and little finger up, middle two curled.',snapshot:p=>p.scene.skin,check:(p,before:string)=>p.scene.skin!==before},
 {gesture:'both-pinch',howTo:'Pinch with both hands, then pull your hands apart to blow the molecule apart.',tip:'Keep both pinches closed while you move your hands away from each other.',check:torn},
 {gesture:'both-fist',howTo:'Make a fist with both hands, then move them apart to zoom in or together to zoom out.',tip:'Keep both fists closed and change the distance between them.',snapshot:viewSnapshot,check:viewZoomed},
 {gesture:'clap',howTo:'Start with your hands wide apart, then clap them together fast to send a shockwave through the chains.'},
];
