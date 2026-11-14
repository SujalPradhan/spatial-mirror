import type {GestureFrame,HandPose,TrackedHand} from './contracts';

export type FeedbackCode='camera-off'|'no-hand'|'far'|'close'|'edge'|'one-hand'|'unclear'|`looks-${HandPose}`;
export type FeedbackPose=HandPose|'both-pinch'|'both-fist'|'clap';
export interface Feedback {code:FeedbackCode;text:string}

const FAR=.045,CLOSE=.42,EDGE=.03;
const NAMES:Record<HandPose,string>={none:'nothing I can name',open:'an open palm',fist:'a fist',pinch:'a pinch',point:'a pointing finger',victory:'a peace sign',thumbUp:'a thumbs up',thumbDown:'a thumbs down',love:'the 🤟 sign'};
const TIPS:Record<FeedbackPose,string>={
 open:'Spread your fingers wide, palm to the camera.',fist:'Curl all four fingers in.',pinch:'Touch your thumb and index fingertips together.',point:'Keep only your index finger out.',
 victory:'Raise your index and middle fingers and curl the others.',thumbUp:'Point your thumb up.',thumbDown:'Point your thumb down.',love:'Raise your thumb, index and little finger and curl the middle two.',
 none:'','both-pinch':'Pinch with both hands.','both-fist':'Make a fist with both hands.',clap:'Start with your hands wide apart, then bring them together fast.',
};
const single:Record<FeedbackPose,HandPose>={open:'open',fist:'fist',pinch:'pinch',point:'point',victory:'victory',thumbUp:'thumbUp',thumbDown:'thumbDown',love:'love',none:'none','both-pinch':'pinch','both-fist':'fist',clap:'none'};

/** Palm length in units of frame width, so a near hand reads large and a far hand small whatever the camera shape. */
export function palmSize(hand:TrackedHand,aspect:number){
 const a=hand.landmarks[0],b=hand.landmarks[9];if(!a||!b)return 0;
 return Math.hypot(b.x-a.x,(b.y-a.y)/Math.max(.1,aspect));
}
const nearEdge=(hand:TrackedHand)=>hand.landmarks.some(p=>p.x<EDGE||p.x>1-EDGE||p.y<EDGE||p.y>1-EDGE);

/** What is wrong with the hand right now for the pose being tried, most basic problem first; null when the view is fine. */
export function diagnoseHands(frame:GestureFrame,pose:FeedbackPose,aspect:number,cameraOn=true):Feedback|null{
 if(!cameraOn)return {code:'camera-off',text:'The camera is off. Press Step into the mirror to follow along, or use Next.'};
 const hands=frame.hands,two=pose==='both-pinch'||pose==='both-fist'||pose==='clap';
 if(!hands.length)return {code:'no-hand',text:two?'I cannot see your hands. Raise both in front of the camera.':'I cannot see your hand. Raise it in front of the camera.'};
 if(hands.some(h=>palmSize(h,aspect)<FAR))return {code:'far',text:'Your hand is too far away. Move it closer to the camera.'};
 if(hands.some(h=>palmSize(h,aspect)>CLOSE))return {code:'close',text:'Your hand is too close. Pull it back a little.'};
 if(hands.some(nearEdge))return {code:'edge',text:'Your hand is at the edge of the frame. Move it toward the middle.'};
 if(two&&hands.length<2)return {code:'one-hand',text:`This one needs both hands in view. ${TIPS[pose]}`};
 if(pose==='clap')return null;
 const want=single[pose],wrong=hands.filter(h=>h.pose!==want);
 if(wrong.length===hands.length||two&&wrong.length){
  const seen=wrong[0].pose;
  if(seen==='none')return {code:'unclear',text:`I cannot tell the shape. Hold it still. ${TIPS[pose]}`};
  return {code:`looks-${seen}`,text:`That looks like ${NAMES[seen]}. ${TIPS[pose]}`};
 }
 return null;
}

/** Shows a problem only once it has lasted, and drops it a moment after it clears, so the text does not flicker with tracking noise. */
export class FeedbackGate {
 private pending:FeedbackCode|null=null;private since=0;private shown:Feedback|null=null;private clearedAt:number|null=null;
 constructor(private readonly showAfter=900,private readonly clearAfter=400){}
 update(next:Feedback|null,now:number):Feedback|null{
  if(!next){
   this.pending=null;this.clearedAt??=now;
   if(this.shown&&now-this.clearedAt>=this.clearAfter)this.shown=null;
   return this.shown;
  }
  this.clearedAt=null;
  if(this.shown?.code===next.code){this.shown=next;return this.shown;}
  if(this.pending!==next.code){this.pending=next.code;this.since=now;}
  if(now-this.since>=this.showAfter)this.shown=next;
  return this.shown;
 }
 reset(){this.pending=null;this.shown=null;this.clearedAt=null;}
}
