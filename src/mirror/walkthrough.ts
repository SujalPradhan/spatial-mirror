import './walkthrough.css';
import type {GestureFrame,MirrorGestureId} from './contracts';
import type {MirrorGesture} from './guide';
import {FeedbackGate,diagnoseHands,type Feedback} from './hand-feedback';
import {Tutorial,markTutorialSeen,tutorialSeen,type TutorialStep,type TutorialStorage,type TutorialView} from './tutorial';
import {gestureHelp,twoHanded,type MirrorProbe,type MirrorWalkthroughStep} from './walkthrough-steps';

export interface WalkthroughOptions {
 /** Page id: its element ids are `${id}-…` and its seen flag is kept under it. */
 id:string;part:<T extends HTMLElement=HTMLElement>(name:string)=>T;gestures:MirrorGesture[];steps?:readonly MirrorWalkthroughStep[];
 frame():GestureFrame;aspect():number;cameraOn():boolean;storage:TutorialStorage;inkOn?():boolean;
 /** Leaves the two-handed gestures (both-pinch, both-fist, clap) out of the guided steps, for a viewer who has one hand free. */
 skipTwoHanded?:boolean|(()=>boolean);
 /** How long a pose must be held before a step counts, read when a walkthrough starts. */
 holdMs?:()=>number;
 /** Called with the gesture id when someone presses Try it in the cheat sheet. Wire this to the shell's action runner; without it Try it only starts a one-step practice. */
 tryAction?:(gestureId:string)=>void;
}
export interface Walkthrough {
 start():void;first():void;end():void;clap():void;
 /** Advances the active walkthrough one render; probe is read for the effect checks. */
 draw(now:number,probe:MirrorProbe):void;
 practice(gesture:string):void;
 readonly view:TutorialView|null;
}

const TWO=new Set<string>(twoHanded);
const hint=(step:TutorialStep)=>step.pose==='clap'?'Start with your hands apart, then bring them together.':step.id.startsWith('both')?'Show both hands to the camera.':'Hold your hand still, palm to the camera.';
const glyphs:Record<string,string[]>={'both-pinch':['🤏','🤏'],'both-fist':['✊','✊'],clap:['🤚','🤚']};
/** A small looping picture of the movement, built from the gesture's own emoji and animated by CSS. */
export function demoMarkup(gesture:string,glyph:string){
 const g=glyphs[gesture]??[glyph];
 return `<span class="wt-demo wt-demo-${gesture}" aria-hidden="true">${g.map((x,i)=>`<span class="wt-hand wt-hand-${i}"><i>${x}</i></span>`).join('')}</span>`;
}
const setText=(el:Element,text:string)=>{if(el.textContent!==text)el.textContent=text;};
const setAttr=(el:Element,name:string,value:string)=>{if(el.getAttribute(name)!==value)el.setAttribute(name,value);};
const setFlag=(el:HTMLElement&{disabled?:boolean},name:'hidden'|'disabled',on:boolean)=>{if(!!el[name]!==on)el[name]=on;};

export function createWalkthrough(o:WalkthroughOptions):Walkthrough {
 const {id,part}=o,box=part('tutorial'),text=box.querySelector('p')!,demoSlot=box.querySelector('i')!,bar=box.querySelector<HTMLElement>('.mirror-tutorial-bar span')!;
 const previousButton=part<HTMLButtonElement>('tutorial-previous'),nextButton=part<HTMLButtonElement>('tutorial-next'),skipButton=part<HTMLButtonElement>('tutorial-skip'),nav=box.querySelector('.mirror-tutorial-nav')!;
 const stage=part('stage'),gestureBar=part('gestures');
 const effects=new Map((o.steps??[]).map(s=>[s.gesture as string,s]));
 const byId=new Map(o.gestures.map(g=>[g.id as string,g]));
 const stepFor=(g:MirrorGesture):TutorialStep=>({...g,needsEffect:!!effects.get(g.id)?.check});
 text.innerHTML='<span class="wt-meta"><span class="wt-count"></span><span class="wt-phase"></span></span><b></b><span class="wt-how"></span><small></small><span class="wt-feedback"></span>';
 const [countEl,phaseEl,titleEl,howEl,statusEl,feedbackEl]=['.wt-count','.wt-phase','b','.wt-how','small','.wt-feedback'].map(s=>text.querySelector(s)!);
 const skipStep=document.createElement('button');skipStep.id=`${id}-tutorial-skip-step`;skipStep.type='button';skipStep.textContent='Skip step';skipStep.hidden=true;skipStep.setAttribute('aria-label','Skip this step');
 nav.insertBefore(skipStep,nextButton);

 let tutorial:Tutorial|null=null,practising=false,clapPending=false,doneAt=0,view:TutorialView|null=null,doKey=-1,before:unknown,barWidth='';
 const gate=new FeedbackGate();
 const skipTwo=()=>typeof o.skipTwoHanded==='function'?o.skipTwoHanded():!!o.skipTwoHanded;
 const steps=()=>o.gestures.filter(g=>!(skipTwo()&&TWO.has(g.id))).map(stepFor);

 function begin(list:TutorialStep[],practice:boolean){
  if(!list.length)return;
  const holdMs=o.holdMs?.();tutorial=new Tutorial(list,{...(practice?{basics:0}:{}),...(holdMs?{holdMs}:{})});practising=practice;clapPending=false;doneAt=0;doKey=-1;before=undefined;gate.reset();
  box.hidden=false;render(tutorial.current,performance.now());
 }
 function start(){begin(steps(),false);}
 function end(){tutorial=null;view=null;clapPending=false;doneAt=0;doKey=-1;gate.reset();box.hidden=true;}
 function first(){if(!tutorial&&!tutorialSeen(o.storage,id))start();}
 function practice(gesture:string){const g=byId.get(gesture);if(g)begin([stepFor(g)],true);}

 function render(v:TutorialView,now:number){
  view=v;
  setFlag(previousButton,'disabled',v.index===0||practising);setFlag(nextButton,'disabled',v.done);
  const last=v.index===v.total-1;
  setText(nextButton,v.done?'Finished':v.checkpoint?'More gestures':last?'Finish':'Next');setAttr(nextButton,'aria-label',v.done?'Tutorial finished':v.checkpoint?'More gestures':last?'Finish tutorial':'Next tutorial step');
  setText(skipButton,v.checkpoint?'Finish':'Skip');setAttr(skipButton,'aria-label',v.checkpoint?'Finish tutorial':'Skip tutorial');
  setFlag(skipStep,'hidden',!(v.phase==='do'&&!v.done));
  const set=(demo:string,count:string,phase:string,title:string,how:string,status:string,progress:number)=>{
   if(demoSlot.dataset.demo!==demo){demoSlot.dataset.demo=demo;demoSlot.innerHTML=demo;}
   setText(countEl,count);setText(phaseEl,phase);setFlag(phaseEl as HTMLElement,'hidden',!phase);setText(titleEl,title);setText(howEl,how);setText(statusEl,status);
   const width=`${Math.round(progress*50)*2}%`;if(width!==barWidth){barWidth=width;bar.style.width=width;}
  };
  if(v.done){
   if(!doneAt){doneAt=now;if(!practising)markTutorialSeen(o.storage,id);set('✓',practising?'Practice':'','', practising?'Nice, that worked':'Tutorial done','Replay it any time from Tutorial, or tap a gesture below for a reminder.','',1);setText(feedbackEl,'');}
   else if(now-doneAt>1800)end();
   return;
  }
  if(v.checkpoint){set('✓',`Basics`,'','Basics done','',`${v.index} of ${v.total} gestures. ${v.total-v.index} more to try.`,v.index/v.total);setText(feedbackEl,'');return;}
  const step=v.step!,w=effects.get(step.id),help=gestureHelp[step.id as MirrorGestureId];
  const doing=v.phase==='do',how=(doing||!step.needsEffect)&&w?w.howTo:help.pose;
  const status=doing?(v.hint?w?.tip??'Try a bigger movement and keep your hand in view.':'Do it, or use the buttons'):v.needsRelease?'Release the pose, then hold again or use the buttons':v.hint?hint(step):'Hold the pose or use the buttons';
  set(demoMarkup(step.id,step.glyph),practising?'Practice':`Step ${v.index+1} of ${v.total}`,step.needsEffect?doing?'Now do it':'Show me':'',step.label,how,status,doing?.5:step.needsEffect?v.progress*.5:v.progress);
 }
 function feedback(v:TutorialView,frame:GestureFrame,now:number){
  let next:Feedback|null=null;
  if(!v.done&&!v.checkpoint&&v.step)next=diagnoseHands(frame,v.step.pose,o.aspect()||16/9,o.cameraOn());
  setText(feedbackEl,gate.update(next,now)?.text??'');
 }
 function draw(now:number,probe:MirrorProbe){
  if(!tutorial)return;
  let effect=false;
  const current=view;
  if(current?.phase==='do'&&current.step&&doKey===current.index)effect=!!effects.get(current.step.id)?.check?.(probe,before);
  const frame=o.frame(),v=tutorial.update(clapPending?{...frame,events:[...frame.events,{type:'clap',x:0,y:0}]}:frame,now,effect);clapPending=false;
  if(v.phase==='do'&&v.step&&doKey!==v.index){doKey=v.index;before=effects.get(v.step.id)?.snapshot?.(probe);}
  else if(v.phase!=='do')doKey=-1;
  render(v,now);feedback(v,frame,now);
 }
 function navigate(direction:-1|1){
  if(!tutorial||direction<0&&view?.index===0||direction>0&&view?.done)return;
  clapPending=false;doneAt=0;doKey=-1;gate.reset();
  render(direction<0?tutorial.previous():tutorial.next(),performance.now());
 }
 previousButton.onclick=()=>navigate(-1);nextButton.onclick=()=>navigate(1);skipStep.onclick=()=>navigate(1);
 skipButton.onclick=()=>{if(!practising)markTutorialSeen(o.storage,id);end();};
 part('tutorial-replay').onclick=()=>{start();};
 document.addEventListener('keydown',e=>{
  if(!tutorial||box.hidden||!box.isConnected||e.defaultPrevented||e.repeat||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||document.querySelector('dialog[open]'))return;
  if(e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],[role="spinbutton"]'))return;
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();navigate(e.key==='ArrowLeft'?-1:1);}
 });

 // Cheat sheet: every item of the gesture bar is a button that opens a small description with the demo and a Try it.
 const pop=document.createElement('div');
 pop.id=`${id}-gesture-pop`;pop.className='wt-pop';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Gesture help');pop.hidden=true;
 pop.innerHTML='<div class="wt-pop-demo"></div><div class="wt-pop-text"><b></b><p class="wt-pop-pose"></p><p class="wt-pop-how"></p></div><div class="wt-pop-actions"><button type="button" class="wt-try">Try it</button><button type="button" class="wt-pop-close">Close</button></div>';
 stage.append(pop);
 const popTitle=pop.querySelector('b')!,popPose=pop.querySelector('.wt-pop-pose')!,popHow=pop.querySelector('.wt-pop-how')!,popDemo=pop.querySelector('.wt-pop-demo')!,tryButton=pop.querySelector<HTMLButtonElement>('.wt-try')!;
 let popFor:{gesture:string;button:HTMLElement}|null=null;
 function closePop(refocus=false){if(pop.hidden)return;const from=popFor?.button;pop.hidden=true;popFor=null;gestureBar.querySelectorAll('button[aria-expanded]').forEach(b=>b.setAttribute('aria-expanded','false'));if(refocus&&from?.isConnected)from.focus();}
 function openPop(gesture:string,button:HTMLElement){
  const g=byId.get(gesture);if(!g)return;
  popFor={gesture,button};
  popDemo.innerHTML=demoMarkup(g.id,g.glyph);setText(popTitle,g.label);setText(popPose,gestureHelp[g.id].pose);setText(popHow,effects.get(g.id)?.howTo??gestureHelp[g.id].what);
  gestureBar.querySelectorAll('button[aria-expanded]').forEach(b=>b.setAttribute('aria-expanded',String(b===button)));
  pop.hidden=false;
  const s=stage.getBoundingClientRect(),b=button.getBoundingClientRect(),w=pop.offsetWidth,left=Math.max(8+w/2,Math.min(s.width-8-w/2,b.left-s.left+b.width/2));
  pop.style.left=`${left}px`;pop.style.bottom=`${Math.max(8,s.bottom-b.top+8)}px`;
  tryButton.focus();
 }
 function wrapBar(){
  gestureBar.querySelectorAll('li').forEach(li=>{
   if(li.querySelector(':scope>button'))return;
   const button=document.createElement('button');button.type='button';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
   const name=byId.get((li as HTMLElement).dataset.gesture??'')?.label;if(name)button.title=`What does ${name} do?`;
   button.append(...li.childNodes);li.append(button);
  });
 }
 wrapBar();new MutationObserver(()=>{closePop();wrapBar();}).observe(gestureBar,{childList:true});
 gestureBar.addEventListener('click',e=>{
  const button=(e.target as Element).closest('button'),item=button?.closest('li');if(!button||!item||o.inkOn?.()||stage.classList.contains('is-inking'))return;
  if(popFor?.button===button)closePop(true);else openPop(item.dataset.gesture!,button);
 });
 tryButton.onclick=()=>{const gesture=popFor?.gesture;closePop();if(!gesture)return;o.tryAction?.(gesture);practice(gesture);};
 pop.querySelector<HTMLButtonElement>('.wt-pop-close')!.onclick=()=>closePop(true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pop.hidden){e.preventDefault();closePop(true);}});
 document.addEventListener('pointerdown',e=>{if(!pop.hidden&&e.target instanceof Node&&!pop.contains(e.target)&&!gestureBar.contains(e.target))closePop();});

 return {start,first,end,practice,clap(){clapPending=true;},draw,get view(){return view;}};
}
