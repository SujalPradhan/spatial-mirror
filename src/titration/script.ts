import type {MirrorGestureId} from '../mirror/contracts';

/** The ten steps of the practical, in order. */
export type StepId='safety'|'rinse'|'fill'|'bubble'|'pipette'|'indicator'|'initial'|'rough'|'accurate'|'calc';
export const steps:{id:StepId;title:string;checkpoint?:string}[]=[
 {id:'safety',title:'Put on your goggles'},
 {id:'rinse',title:'Rinse the burette'},
 {id:'fill',title:'Fill the burette'},
 {id:'bubble',title:'Clear the air from the tip',checkpoint:'Burette ready'},
 {id:'pipette',title:'Pipette the acid'},
 {id:'indicator',title:'Add the indicator',checkpoint:'Flask ready'},
 {id:'initial',title:'Read the start'},
 {id:'rough',title:'Rough titration'},
 {id:'accurate',title:'Accurate titrations',checkpoint:'Titres agree'},
 {id:'calc',title:'Work out the answer',checkpoint:'Done'},
];

/** What the card says and the bar shows for one moment of a step: a gesture glyph, the how-to, the mouse and key way, and the gestures in use. */
export interface Task {glyph:string;how:string;alt:string;bar:{id:MirrorGestureId;label?:string}[]}
const tapBar:Task['bar']=[{id:'open',label:'Turn the tap'},{id:'fist',label:'Swirl'},{id:'thumbUp',label:'End point'}];
const readBar:Task['bar']=[{id:'thumbUp',label:'Confirm'}];
const tasks:Record<string,Task>={
 'safety.wear':{glyph:'🤏',how:'Pinch the goggles and lift them to the top of the frame.',alt:'Drag them up, or press G.',bar:[{id:'pinch',label:'Pinch and lift'}]},
 'rinse.pour':{glyph:'🤏',how:'Pinch the bottle, hold it over the funnel and tilt your wrist to pour a little.',alt:'Hold the bottle over the funnel, or press R.',bar:[{id:'pinch',label:'Pinch, move, tilt'}]},
 'rinse.drain':{glyph:'🖐',how:'Turn your open hand like a tap key to drain the rinse into the waste beaker.',alt:'Hold the blue tap key and drag right, or press R.',bar:[{id:'open',label:'Turn the tap'}]},
 'fill.pour':{glyph:'🤏',how:'Pour until the liquid sits just below the 0.00 mark. Tilt less to slow down.',alt:'Hold the bottle over the funnel and let go to stop, or hold F.',bar:[{id:'pinch',label:'Pinch, move, tilt'}]},
 'fill.drain':{glyph:'🖐',how:'Turn the tap a little so the liquid falls to the 0.00 line.',alt:'Hold the blue tap key and drag right, or press ].',bar:[{id:'open',label:'Turn the tap'}]},
 'bubble.burst':{glyph:'🖐',how:'Open the tap in a short burst to push the air out of the tip.',alt:'Hold the blue tap key for a moment, or press B.',bar:[{id:'open',label:'Turn the tap'}]},
 'pipette.draw':{glyph:'🤏',how:'Pinch the pipette and lower its tip into the acid. It fills to the line while it stays there.',alt:'Drag it into the acid beaker, or press P.',bar:[{id:'pinch',label:'Pinch and lower'}]},
 'pipette.deliver':{glyph:'🖐',how:'Carry it over the flask and open your hand to let the acid run in.',alt:'Drag it over the flask and let go.',bar:[{id:'open',label:'Open to release'}]},
 'indicator.choose':{glyph:'🤏',how:'Pinch the dropper you want. Each pinch and release over the flask is one drop.',alt:'Drag a dropper over the flask and let go, or press 1, 2 or 3 then A.',bar:[{id:'pinch',label:'Pinch a dropper'}]},
 'indicator.drop':{glyph:'🤏',how:'Release over the flask for a drop. Two or three drops is plenty.',alt:'Let go over the flask, or press A.',bar:[{id:'pinch',label:'Pinch, release to drop'}]},
 'initial.read':{glyph:'👍',how:'Read the bottom of the curve. Set it with the buttons, then thumbs up.',alt:'Use + and - or type it, then press Enter.',bar:readBar},
 'rough.run':{glyph:'🖐',how:'Turn your hand to open the tap and circle a fist to swirl. Stop at the first colour that stays.',alt:'Drag the tap key, circle the flask, or press ] and S. Space shuts the tap.',bar:tapBar},
 'rough.final':{glyph:'👍',how:'Read the burette again at the bottom of the curve.',alt:'Use + and - or type it, then press Enter.',bar:readBar},
 'accurate.initial':{glyph:'👍',how:'A fresh flask is ready. Read the start of the burette.',alt:'Use + and - or type it, then press Enter.',bar:readBar},
 'accurate.run':{glyph:'🖐',how:'Run fast to just short of the rough end point, then drop by drop, swirling.',alt:'Drag the tap key, circle the flask, or press ] and S. Press D for one drop.',bar:tapBar},
 'accurate.final':{glyph:'👍',how:'Read the burette again at the bottom of the curve.',alt:'Use + and - or type it, then press Enter.',bar:readBar},
 'calc.nBase':{glyph:'⌨',how:'How many moles of sodium hydroxide ran in? Use your mean titre in dm3 times 0.100.',alt:'Type the number, then press Enter.',bar:[]},
 'calc.nAcid':{glyph:'⌨',how:'How many moles of hydrochloric acid were in the flask?',alt:'Type the number, then press Enter.',bar:[]},
 'calc.conc':{glyph:'⌨',how:'What was the concentration of the acid in mol/dm3? The flask held 0.0250 dm3.',alt:'Type the number, then press Enter.',bar:[]},
 'calc.done':{glyph:'📓',how:'Your answer is in. Open the Notebook for your report.',alt:'Press N.',bar:[]},
};
export const taskFor=(step:StepId,phase:string):Task=>tasks[`${step}.${phase}`]??tasks['calc.done'];

/** The first line the guide says on arriving at a step. */
export const intro:Record<StepId,string[]>={
 safety:['Hi, I am Pip. Together we will find out how strong an unknown acid is.','Goggles first. Always.'],
 rinse:['Rinse first. A splash of sodium hydroxide, so stray water cannot thin it.'],
 fill:['Now fill it. Stop just below the 0.00 line.'],
 bubble:['Look at the tip. Trapped air would count as liquid, so push it out.'],
 pipette:['The acid next. A pipette measures exactly 25.0 cm3.'],
 indicator:['An indicator shows the end point. Pick one.'],
 initial:['Take the first reading. Look at the bottom of the curve, not the edges.'],
 rough:['A rough run first. Go fast and find roughly where the colour turns.'],
 accurate:['Now the careful runs. Two titres within 0.10 cm3 of each other is the goal.'],
 calc:['Last part. Three short sums.'],
};
export const said={
 goggles:'Goggles on. Good habit.',
 goggleLow:'Higher. Bring them right up to the top of the frame.',
 wrongPlace:'Bring it over the funnel to pour.',
 rinsed:'That is the rinse. Now let it run out into the waste beaker.',
 drained:'Rinsed.',
 over:'Above the zero mark. You read down from zero, so the liquid should start at the line or just below. Open the tap and let it fall.',
 short:'A little more. Fill until the liquid sits just below the 0.00 mark.',
 filled:'Filled. The tip still looks odd.',
 tooFar:'Too far. Pour a little more, up to just below 0.00.',
 stillOver:'Still above the line. Open the tap a little more.',
 burst:'The air is out. Now the readings will be true.',
 notFull:'It is not at the line yet. Lower the tip into the acid and wait a moment.',
 delivered:'25.0 cm3 of acid in the flask.',
 stray:'Over the flask, please. Drops only count there.',
 universalNote:'Universal indicator changes colour slowly, so its end point will be vague. Notice that later.',
 cleanNote:'Good choice. This one changes sharply near the end point.',
 dropped:'One drop.',
 high:'A little high. Check the bottom of the curve against the marks.',
 low:'A little low. Check the bottom of the curve against the marks.',
 exact:(v:string)=>`The bottom of the curve is at ${v}. Set that.`,
 empty:'The burette is nearly empty. Top it up first.',
};
