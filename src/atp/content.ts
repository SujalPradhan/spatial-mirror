import type {HandPose} from './contracts';

export const gestureGuide:{id:string;pose:HandPose|'both-pinch'|'both-fist'|'clap';glyph:string;label:string}[]=[
 {id:'fist',pose:'fist',glyph:'✊',label:'Hold'},
 {id:'open',pose:'open',glyph:'🖐',label:'Part'},
 {id:'pinch',pose:'pinch',glyph:'🤏',label:'Pluck'},
 {id:'point',pose:'point',glyph:'☝️',label:'Stir'},
 {id:'victory',pose:'victory',glyph:'✌️',label:'Slice'},
 {id:'thumbUp',pose:'thumbUp',glyph:'👍',label:'Make'},
 {id:'thumbDown',pose:'thumbDown',glyph:'👎',label:'Burn'},
 {id:'love',pose:'love',glyph:'🤟',label:'Skin'},
 {id:'both-pinch',pose:'both-pinch',glyph:'🤏🤏',label:'Tear'},
 {id:'both-fist',pose:'both-fist',glyph:'✊✊',label:'Scale'},
 {id:'clap',pose:'clap',glyph:'👐',label:'Shock'},
];

export const sources=[
 {label:'Structure 6OQR · E. coli ATP synthase, ADP state 1a',url:'https://www.rcsb.org/structure/6OQR'},
 {label:'Sobti et al. (2020) · Structural states and symmetry mismatch',url:'https://doi.org/10.1038/s41467-020-16387-2'},
 {label:'Boyer (1997) · Binding-change mechanism',url:'https://doi.org/10.1146/annurev.biochem.66.1.717'},
 {label:'Noji et al. (1997) · Direct observation of rotation',url:'https://doi.org/10.1038/386299a0'},
 {label:'Coordinate provenance and reproducible transform',url:'/models/atp-6oqr.README.md'},
];

export const scientificNote='Every point is a measured alpha-carbon position from 6OQR, a static snapshot of an inhibited ADP state. The motion is play, not simulation: chains move as rigid bodies, and no dynamics, kinetics or real speed are computed. The counts are this enzyme’s geometry: ten c subunits carry ten protons per turn, and three catalytic sites make three ATP. Thumbs down runs the motor in reverse, as the real enzyme can when it burns ATP to pump protons.';
