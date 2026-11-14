export const sources=[
 {label:'Encyclopaedia entry · Titration',url:'https://www.britannica.com/science/titration'},
 {label:'Encyclopaedia entry · pH',url:'https://www.britannica.com/science/pH'},
];

export const scientificNote='This is a simulation of a school chemistry practical, simplified in several ways. Hydrochloric acid and sodium hydroxide are both strong, so the pH comes from a charge balance with water and no equilibrium tables. Temperature is fixed at 25 degrees Celsius and activity effects are ignored. Mixing is a single patch of liquid around each drop that blends into the flask at a rate that swirling speeds up; real flasks mix less tidily. A drop is exactly 0.05 cm3. The air bubble, a rinse skipped and the slightly dilute titrant are modelled as fixed effects (+0.3 cm3 on the first titre, about 2 percent dilution). Indicator colours are drawn from smooth curves, not measured spectra, and universal indicator is shown as a gradual change so its end point is vague. The burette is read from a magnified picture, not by eye at a real meniscus, so there is no parallax. Your calculation is marked against your own mean titre, then compared with the true concentration.';

export const story='Find the concentration of an unknown hydrochloric acid using 0.100 mol/dm3 sodium hydroxide.';

export const objectives=[
 {id:'prepare',text:'Prepare the burette: rinse it, fill it and clear the air from the tip.'},
 {id:'rough',text:'Find the approximate end point with a rough titration.'},
 {id:'accurate',text:'Run accurate titrations until two titres agree within 0.10 cm3.'},
 {id:'calculate',text:'Calculate the concentration of the acid from your mean titre.'},
 {id:'questions',text:'Answer the four checkpoint questions.'},
 {id:'judge',text:'Compare your answer with the true value and explain any difference.'},
];

export const theory=[
 'Hydrochloric acid and sodium hydroxide react 1:1: HCl + NaOH gives NaCl + H2O.',
 'At the end point the moles of base added equal the moles of acid in the flask.',
 'Moles = concentration (mol/dm3) times volume (dm3). Divide a volume in cm3 by 1000 to get dm3.',
 'The pH changes by about six units within a drop or two of the end point, so a sharp indicator marks it well.',
 'Each burette reading is good to about 0.05 cm3, so a titre (two readings) is good to about 0.10 cm3.',
];

/** One hint per step; each costs two points. */
export const hints:Record<string,string[]>={
 rinse:['A little water left in the burette would thin the sodium hydroxide. Rinse with the solution it will hold.'],
 fill:['Fill the burette with the sodium hydroxide, then look at the tip.'],
 bubble:['Air in the tip fills with liquid during the first run, so the burette reads more than the flask received. Run titrant through the tip first.'],
 pipette:['A pipette gives 25.0 cm3 more exactly than a measuring cylinder. Use it for the acid.'],
 indicator:['Pick an indicator whose colour change sits on the steep part of the curve. One of the three changes sharply there and is easy to see.'],
 rough:['Run the tap quickly and swirl. Stop at the first lasting colour change. Do not worry about overshooting: this run only tells you where to slow down.'],
 accurate:['Add titrant quickly until about 2 cm3 before the rough titre, then drop by drop, swirling after each drop. Stop at the first lasting change.'],
 calculate:['Step 1: titre in cm3 divided by 1000, times 0.100. Step 2: same number of moles, since the ratio is 1:1. Step 3: divide by 0.0250 dm3.'],
};

export interface Question {id:string;needs:'indicator'|'rough'|'accurate'|'calculate';text:string;options:string[];answer:number;why:string}
export const questions:Question[]=[
 {id:'q1',needs:'indicator',text:'Why do you choose an indicator whose colour change covers the steep part of the titration curve?',options:['Because it then changes colour with just a drop or two of titrant near the end point','Because it speeds up the reaction','Because it neutralises the acid itself','Because it makes the solution conduct electricity'],answer:0,why:'Near the end point the pH jumps by about six units in a single drop, so any indicator that changes in that range changes sharply.'},
 {id:'q2',needs:'rough',text:'Why run a rough titration before the accurate ones?',options:['To use up spare acid','To find the approximate end point so the accurate runs can slow down just before it','To check the burette is rinsed','To warm the flask'],answer:1,why:'The rough run can be fast and may overshoot. It tells you where to go drop by drop in the accurate runs.'},
 {id:'q3',needs:'accurate',text:'Why is the rough titre left out of the mean?',options:['It is always too small','It is not read to the same precision, because the tap was run fast and may have overshot','It uses a different acid','It was done with a different burette'],answer:1,why:'Only careful, concordant titres go into the mean. The rough one has a larger, unknown overshoot.'},
 {id:'q4',needs:'calculate',text:'Why are the moles of acid equal to the moles of base at the end point?',options:['The two solutions have equal concentrations','The acid and base react in a 1:1 ratio and the end point is where they have exactly reacted','The flask holds equal volumes of each','The indicator makes them equal'],answer:1,why:'HCl + NaOH gives NaCl + H2O: one mole of acid reacts with one mole of base.'},
];

export const keyHelp='Keys: R rinse, F fill, B clear tip, P pipette, A add indicator, [ and ] turn the stopcock, D one drop, S swirl, Space close tap, Z zoom to burette, H hint.';
