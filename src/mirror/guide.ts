import type {HandPose} from './contracts';

export interface MirrorGesture {id:string;pose:HandPose|'both-pinch'|'both-fist'|'clap';glyph:string;label:string}
const gestures:MirrorGesture[]=[
 {id:'fist',pose:'fist',glyph:'✊',label:'Hold'},
 {id:'open',pose:'open',glyph:'🖐',label:'Part'},
 {id:'pinch',pose:'pinch',glyph:'🤏',label:'Pluck'},
 {id:'point',pose:'point',glyph:'☝️',label:'Stir'},
 {id:'victory',pose:'victory',glyph:'✌️',label:'Slice'},
 {id:'thumbUp',pose:'thumbUp',glyph:'👍',label:'Run'},
 {id:'thumbDown',pose:'thumbDown',glyph:'👎',label:'Reverse'},
 {id:'love',pose:'love',glyph:'🤟',label:'Skin'},
 {id:'both-pinch',pose:'both-pinch',glyph:'🤏🤏',label:'Tear'},
 {id:'both-fist',pose:'both-fist',glyph:'✊✊',label:'Scale'},
 {id:'clap',pose:'clap',glyph:'👐',label:'Shock'},
];
export const mirrorGestures=(labels:Partial<Record<string,string>>={}):MirrorGesture[]=>gestures.map(g=>({...g,label:labels[g.id]??g.label}));
