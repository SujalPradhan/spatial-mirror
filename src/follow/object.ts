import './style.css';
import type {MirrorObject} from '../mirror/contracts';
import type {GraspSaved} from '../grasp/contracts';
import {Euler,Quaternion} from 'three';
import type {Quat} from '../types';
import {graspDescriptor,homeView,initialGrasp,validateGrasp} from '../grasp/state';
import {followHow,followNote,sources} from './content';
import {FollowAudio} from './audio';
import {FollowEngine} from './engine';
import {FollowView} from './view';
import type {FollowMode} from './contracts';
import type {Lesson,Step} from './model';

/** The shared view of both hands, tipped so the depth between a thumb and a fingertip shows. */
export const TILT=.52;
const tilted=()=>({...initialGrasp(),view:{...homeView(),q:new Quaternion().setFromEuler(new Euler(TILT,.5,0,'YXZ')).toArray() as Quat}});

export const followObject:MirrorObject<GraspSaved,FollowView,FollowEngine>&{liveView:FollowView|null}={
 liveView:null,
 id:'follow',documentKey:'follow:hands:mirror',title:'Follow my hands — Spatial Studio',skins:['metal'],
 motion:{run:'Next',reverse:'Back'},
 gestures:{clap:'Repeat step'},use:['clap'],
 copy:{mark:['Follow','my hands'],stageLabel:'A teacher hand shows a move step by step and waits for your hand to match it',viewportLabel:'A translucent teacher hand beside your tracked hand. Joints of yours that are off glow red. Drag to turn the view, scroll to zoom.',readoutUnit:'steps matched',loading:'Warming up the teacher…',loadError:'Could not build the hands. ',cameraFallback:'Camera unavailable. The teacher still plays, but your hands are the real input. '},
 about:{heading:'Follow my hands: a teacher that waits for you',note:followNote,privacy:followHow,sources},
 createView(host){return this.liveView=new FollowView(host);},
 createEngine:()=>new FollowEngine(),
 state:{initial:tilted,validate:validateGrasp},
 createAudio:()=>new FollowAudio(),
 descriptor:state=>({...graspDescriptor(state),title:'Follow',motionLabel:'step'}),
 readout:out=>out.scene.follow.matchedSteps,
 idles:()=>false,
 handShape:true,
 watch:{
  local:true,
  capture:e=>{const p=e as unknown as FollowPrivate;return {lesson:{mode:e.mode,lessonId:e.lessonId,index:e.index,results:e.results,summary:e.mode==='done'},hold:{seconds:Math.round(p.hold.seconds*10)/10},mine:{lesson:p.mine}};},
  apply(e,page,fresh){
   const p=e as unknown as FollowPrivate,l=page.lesson as {mode:FollowMode;lessonId:string;index:number;results:typeof e.results}|undefined,m=page.mine as {lesson:Lesson|null}|undefined,h=page.hold as {seconds:number}|undefined;
   if(m&&JSON.stringify(m.lesson)!==JSON.stringify(p.mine)){p.mine=m.lesson?structuredClone(m.lesson):null;p.rebuild();}
   if(l){
    if(l.lessonId!==e.lessonId&&e.lessons.some(x=>x.id===l.lessonId))e.lessonId=l.lessonId;
    if(l.index!==e.index||l.lessonId!==e.lessonId)p.goTo(Math.min(l.index,e.steps.length-1),p.shown);
    if(l.mode!==e.mode)e.mode=l.mode;
    if(JSON.stringify(l.results)!==JSON.stringify(e.results))e.results=structuredClone(l.results);
   }
   if(h&&fresh)p.hold.seconds=h.seconds;
  },
 },
};
interface FollowPrivate {hold:{seconds:number};mine:Lesson|null;shown:Step;rebuild():void;goTo(index:number,from:Step):void}
