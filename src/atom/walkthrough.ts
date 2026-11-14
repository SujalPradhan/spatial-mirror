import {torn,viewMoved,viewSnapshot,viewZoomed,type MirrorWalkthroughStep} from '../mirror/walkthrough-steps';
import type {AtomEngine} from './engine';
import {elements} from './model';

export const atomWalkthrough:readonly MirrorWalkthroughStep<AtomEngine>[]=[
 {gesture:'open',howTo:'Hold an open hand near the atom to lift an electron off it. Close your hand to send it back.',tip:'Keep your fingers spread and your palm toward the camera, beside the atom.',check:p=>p.engine.electrons<elements[p.engine.element].z},
 {gesture:'both-pinch',howTo:'Pinch with both hands, then pull your hands apart to tear the atom apart.',tip:'Keep both pinches closed while you move your hands away from each other.',check:torn},
 {gesture:'fist',howTo:'Close your fist over the atom, then move or twist your hand to turn it.',tip:'Keep the fist closed and drag it slowly across the screen.',snapshot:viewSnapshot,check:viewMoved},
 {gesture:'thumbUp',howTo:'Give a thumbs up to make the electrons orbit faster.',tip:'Keep the thumb pointing straight up and the other fingers curled.',check:p=>p.scene.rate>=2},
 {gesture:'thumbDown',howTo:'Give a thumbs down to make the electrons orbit backwards.',tip:'Keep the thumb pointing straight down and the other fingers curled.',check:p=>p.scene.rate<=-.3},
 {gesture:'both-fist',howTo:'Make a fist with both hands, then move them apart to zoom in or together to zoom out.',tip:'Keep both fists closed and change the distance between them.',snapshot:viewSnapshot,check:viewZoomed},
 {gesture:'clap',howTo:'Start with your hands wide apart, then clap them together fast to step to the next element.'},
];
