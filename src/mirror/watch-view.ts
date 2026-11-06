import {Quaternion} from 'three';
import type {Quat} from '../types';
import type {GestureFrame,MirrorAudio,MirrorDriver,MirrorObject,MirrorState,MirrorView,MirrorViewState,TrackedHand} from './contracts';
import {InkMode,inkSuppressed} from './ink-mode';
import {WatchViewer,decodeHand,smoothHands} from './watch';
import {viewerUrl} from './watch-link';

const wrap=(a:number)=>((a+180)%360+360)%360-180;
/** Runs a mirror page read-only: the same object, driven by the presenter's broadcast. Local input, camera and corner actions are off. */
export function runWatchView<State extends MirrorState,V extends MirrorView,Engine extends MirrorDriver>(object:MirrorObject<State,V,Engine>,ctx:{code:string;part:<T extends HTMLElement=HTMLElement>(name:string)=>T;view:V;engine:Engine;audio:MirrorAudio}){
 const {part,view,engine,audio}=ctx,stage=part('stage'),page=stage.closest('.mirror-page')!;
 page.classList.add('mirror-watching');
 part('freeze').hidden=true;
 const badge=document.createElement('p');badge.className='mirror-watch is-offline';badge.setAttribute('role','status');badge.textContent='Connecting';stage.append(badge);
 const ink=new InkMode(stage);ink.set(true,performance.now());
 let ready=false,muted=false,lastBadge='',raw:MirrorState|null=null,state:State|null=null;
 const watch=new WatchViewer(viewerUrl(ctx.code),ink.board,()=>{});
 const shown=new Map<number,TrackedHand>(),current:MirrorViewState={...object.state.initial().view},seen={state:false};
 let frame:GestureFrame={at:0,hands:[],events:[]};
 view.setVideoAspect(0);
 view.ready.then(()=>{ready=true;part('loading').hidden=true;}).catch(error=>{const el=part('loading');el.classList.add(`${object.id}-error`,'mirror-error');el.textContent=object.copy.loadError+String(error);});
 part('sound').onclick=()=>{muted=!muted;audio.setMuted(muted);part('sound').setAttribute('aria-pressed',String(!muted));void audio.start();};
 part('sources').onclick=()=>part<HTMLDialogElement>('about').showModal();part('about-close').onclick=()=>part<HTMLDialogElement>('about').close();
 const allowed=(t:EventTarget|null)=>t instanceof Element&&!!t.closest(`dialog,#${object.id}-sound,#${object.id}-sources,.workspace-nav`);
 for(const type of ['keydown','keyup','keypress'])window.addEventListener(type,e=>{if(!allowed(e.target))e.stopImmediatePropagation();},true);
 for(const type of ['wheel','pointerdown','click','dblclick','contextmenu'])stage.addEventListener(type,e=>{if(!allowed(e.target)){e.stopImmediatePropagation();e.preventDefault();}},true);
 watch.start();
 let pageRev=-1,engRev=-1,checked=0,last=performance.now(),stopped=false,readout:string|number|null=null;
 const still=window.matchMedia('(prefers-reduced-motion: reduce)');
 function tick(now:number){
  if(stopped)return;
  const dt=Math.min(.05,(now-last)/1000);last=now;
  const live=watch.live(now),text=watch.error||(live?'Watching live':watch.state?'Presenter offline':watch.online?'Waiting for the presenter':'Presenter offline');
  if(text!==lastBadge){badge.textContent=lastBadge=text;badge.classList.toggle('is-offline',!live);}
  if(watch.state!==raw){raw=watch.state;state=raw?object.state.validate(raw) as State:null;}
  if(state&&ready){
   const k=1-Math.exp(-dt*18),target=state.view;
   if(!seen.state){Object.assign(current,structuredClone(target));seen.state=true;}
   else{
    current.q=new Quaternion().fromArray(current.q).slerp(new Quaternion().fromArray(target.q),k).normalize().toArray() as Quat;
    current.zoom+=(target.zoom-current.zoom)*k;current.x+=(target.x-current.x)*k;current.y+=(target.y-current.y)*k;
   }
   const [pos,speed,playing]=watch.eng,hook=object.watch;
   if(hook){
    if(watch.pageRev!==pageRev){pageRev=watch.pageRev;hook.apply(engine,watch.page,true);checked=now;}
    else if(now-checked>500){checked=now;hook.apply(engine,watch.page,false);}
   }
   engine.idle=!!object.idles?.(state)&&!still.matches;
   const gap=wrap(pos-engine.position);
   if(hook&&!hook.local){if(watch.engRev!==engRev){engRev=watch.engRev;if(Math.abs(gap)>.6)engine.seek(((pos%360)+360)%360);}}
   else if(Math.abs(gap)>(speed>.01||playing?35:.6))engine.seek(((pos%360)+360)%360);
   if(playing&&!state.frozen)engine.kick(1);
   const hands=live?smoothHands(shown,watch.hands.map(decodeHand),dt):smoothHands(shown,[],dt);
   frame={at:now,hands,events:watch.events.splice(0)};
   const out=engine.step(watch.on||hook&&!hook.local?inkSuppressed(frame):frame,dt,current,state.frozen);
   for(const sound of out.sounds)audio.play(sound);
   if(object.readout&&object.copy.readoutUnit){const value=object.readout(out as ReturnType<Engine['step']>);if(value!==readout)part('count').textContent=String(readout=value);}
   view.setPose(current);view.draw(out.scene,now);
  }
  ink.render(now);
  requestAnimationFrame(tick);
 }
 requestAnimationFrame(tick);
 window.addEventListener('pagehide',()=>{stopped=true;watch.stop();audio.stop();view.dispose();});
 return {engine,tutorial:null,get state(){return structuredClone(state??object.state.initial()) as State;},playing:false,get ready(){return ready;},owns:false,phoneHeld:false,owner:null,context:0,get frame(){return frame;},phoneFrames:0,phoneCamera:false,hands(){},watch,get ink(){return ink;},get live(){return watch.live();},get shownView(){return structuredClone(current);}};
}
