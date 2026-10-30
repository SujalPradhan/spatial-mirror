import type {AtpChapter, AtpViewState} from './contracts';
import type {Quat} from '../types';

// Data-only lesson views. Rotations change the view, never the mechanism phase.
function view(yaw:number, tilt:number, zoom=1):AtpViewState {
  const sy=Math.sin(yaw/2), cy=Math.cos(yaw/2), sx=Math.sin(tilt/2), cx=Math.cos(tilt/2);
  return {q:[sx*cy,cx*sy,-sx*sy,cx*cy] as Quat,zoom,x:0,y:0};
}

export const chapters:AtpChapter[] = [
  {
    title:'Meet a molecular motor',kicker:'01 · Look around',
    text:'This ATP synthase comes from E. coli bacteria. The ring sits in the cell membrane; the head faces the cytoplasm. Each dot marks a modeled protein backbone position in a real structural snapshot.',
    hint:'Drag to look around. Find the ring in the gray membrane.',
    focus:['rotor','stator','head','membrane'],representation:'structure',tool:'view',view:view(-.45,.14),
  },
  {
    title:'A gradient supplies the energy',kicker:'02 · Follow the energy',
    text:'A difference in proton concentration and electrical potential across the membrane stores energy. During ATP synthesis, proton flow from the periplasm toward the cytoplasm drives the membrane motor.',
    hint:'The arrows are a diagram of proton flow, not tracked particles.',
    focus:['membrane','rotor','stator'],representation:'mechanism',tool:'view',view:view(-.35,.12),
  },
  {
    title:'What turns? What stays?',kicker:'03 · Compare the parts',
    text:'The c ring and central gamma/epsilon shaft form the rotor. The a, b and delta subunits support the stationary assembly. The alpha/beta head is held against rotation while its catalytic sites change shape.',
    hint:'Select Rotor, then Stator. Their roles differ even though both are proteins.',
    focus:['rotor','stator','head'],representation:'structure',tool:'view',view:view(.62,.1,1.08),
  },
  {
    title:'Turn the rotor yourself',kicker:'04 · Try the mechanism',
    text:'Use the phase control to turn this simplified rotor relative to its supports. Looking around changes your viewpoint; turning the rotor changes the illustration. Your input stands in for the energy-driven motion.',
    hint:'Choose Turn rotor. Hold the phone pad and tilt, or use the slider. Release to stop.',
    focus:['rotor','stator'],representation:'mechanism',tool:'rotor',view:view(-.4,.18),
  },
  {
    title:'One turn, changing sites',kicker:'05 · Follow the cycle',
    text:'The three beta catalytic sites take turns in a simplified open → loose → tight cycle: exchange/release, bind ADP + phosphate, then form and hold ATP. Rotation couples these changing shapes. This diagram uses three 120° teaching steps.',
    hint:'Step to 120°, 240° and 360°. Site A returns to its starting state after one cycle.',
    focus:['head','rotor'],representation:'mechanism',tool:'rotor',view:view(-.22,.32,1.03),
  },
  {
    title:'Explain it with your hands',kicker:'06 · Make it yours',
    text:'Select a stationary part, advance one rotor checkpoint, then explain the energy source. The phone and webcam control the illustration; inside the bacterium, the proton electrochemical gradient powers synthesis.',
    hint:'What would be missing if both sides of the membrane had no electrochemical difference?',
    focus:['rotor','stator','head','membrane'],representation:'mechanism',tool:'view',view:view(-.45,.14),
  },
];

export const sources = [
  {label:'Structure 6OQR · E. coli ATP synthase, ADP state 1a',url:'https://www.rcsb.org/structure/6OQR'},
  {label:'Sobti et al. (2020) · Structural states and symmetry mismatch',url:'https://doi.org/10.1038/s41467-020-16387-2'},
  {label:'Boyer (1997) · Binding-change mechanism',url:'https://doi.org/10.1146/annurev.biochem.66.1.717'},
  {label:'PDB-101 · ATP synthase educational background',url:'https://pdb101.rcsb.org/motm/72'},
  {label:'Coordinate provenance and reproducible transform',url:'/models/atp-6oqr.README.md'},
];

export const scientificNote = 'The structure is a static, inhibited ADP-state snapshot (6OQR), shown with alpha-carbon points. The separate mechanism is a teaching diagram: no atomistic dynamics, measured proton path, chemical kinetics or universal proton-to-ATP ratio are simulated. Site labels A–C belong to the diagram, not PDB chain IDs. Rewinding the illustration does not represent a physical reverse reaction.';

export const energyQuestion = {
  prompt:'What supplies the energy for ATP synthesis in this example?',
  choices:['The proton electrochemical gradient across the membrane','The webcam detecting your hand','The head spinning freely with the rotor'],
  correct:0,
  explanation:'The gradient drives proton flow through the membrane motor. Its rotation couples to changes at catalytic sites. Your hand is a way to explore that idea.',
};
