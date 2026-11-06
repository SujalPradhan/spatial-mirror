import * as T from 'three';
import {GhostHand,GraspView} from '../grasp/view';
import {forward,len,sub,tipOf,type V3} from '../grasp/kinematics';
import {displayWrist,type Wrist} from './model';
import type {FollowScene} from './contracts';

const AXIS_Y=new T.Vector3(0,1,0),AXIS_Z=new T.Vector3(0,0,1),qa=new T.Quaternion(),qb=new T.Quaternion(),ZERO=new Array(15).fill(0);
/** Tips this close read as touching. */
const TOUCH_CM=1.8;
const UP=new T.Vector3(0,1,0),vec=(p:V3)=>new T.Vector3(p[0],p[1],p[2]);
/** Thumb tip, fingertip and a line between them, in a hand's own frame. */
class Contact {
 private readonly dots=[0,1].map(()=>new T.Sprite(new T.SpriteMaterial({map:null,transparent:true,blending:T.AdditiveBlending,depthWrite:false,depthTest:false})));
 private readonly bar=new T.Mesh(new T.CylinderGeometry(.13,.13,1,8),new T.MeshBasicMaterial({transparent:true,opacity:.9,blending:T.AdditiveBlending,depthWrite:false,depthTest:false}));
 constructor(private readonly hand:GhostHand,glow:T.Texture){
  for(const d of this.dots){(d.material as T.SpriteMaterial).map=glow;d.renderOrder=7;d.visible=false;hand.hand.add(d);}
  this.bar.renderOrder=7;this.bar.visible=false;hand.hand.add(this.bar);
 }
 /** Distance between the two tips in cm, or Infinity. Shown when `show`. */
 set(q:ArrayLike<number>,finger:number|null,tint:(cm:number)=>string,show:(cm:number)=>boolean){
  if(finger===null){this.hide();return Infinity;}
  const links=forward(q,true),a=tipOf(links[2]),b=tipOf(links[3*finger+2]),cm=len(sub(a,b)),on=show(cm),color=tint(cm);
  this.dots.forEach((d,i)=>{d.visible=on;d.position.copy(vec(i?b:a));d.scale.setScalar(3);(d.material as T.SpriteMaterial).color.set(color);});
  const A=vec(a),B=vec(b);this.bar.visible=on;this.bar.position.copy(A).add(B).multiplyScalar(.5);this.bar.scale.set(1,Math.max(.01,cm),1);
  if(cm>1e-4)this.bar.quaternion.setFromUnitVectors(UP,B.sub(A).normalize());(this.bar.material as T.MeshBasicMaterial).color.set(color);
  return cm;
 }
 hide(){this.dots.forEach(d=>{d.visible=false;});this.bar.visible=false;}
}
/** Where each hand's wrist stands: same height and depth, one either side of the middle. */
const AT=2.1,BASE=new T.Vector3(0,-1.3,-.3);
/** The grasp stage with only its ghost hand kept as the teacher (cyan), and a second ghost hand, ivory, that is yours. No robot, stand or tendons. */
export class FollowView extends GraspView {
 private readonly you:GhostHand;private readonly teacherContact:Contact;private readonly youContact:Contact;
 constructor(host:HTMLElement){
  super(host);
  this.robot.visible=false;this.stand.visible=false;
  this.mats.ghost.opacity=.3;this.mats.ghostEdge.opacity=.6;
  this.you=new GhostHand(new T.MeshBasicMaterial({color:'#fff1dc',transparent:true,opacity:.3,blending:T.AdditiveBlending,depthWrite:false}),new T.MeshBasicMaterial({color:'#fffaf0',transparent:true,opacity:.6,blending:T.AdditiveBlending,depthWrite:false}),this.glowMap);
  this.root.add(this.you.group);
  this.ghostHand.group.position.copy(BASE).setX(-AT);this.you.group.position.copy(BASE).setX(AT);
  for(const s of this.ghostHand.residual)s.visible=false;
  this.teacherContact=new Contact(this.ghostHand,this.glowMap);this.youContact=new Contact(this.you,this.glowMap);
 }
 private place(group:T.Group,wrist:Wrist,mirrored:boolean){
  const w=displayWrist(wrist,mirrored?'left':'right');
  group.scale.x=mirrored?-1:1;
  group.quaternion.copy(qa.setFromAxisAngle(AXIS_Z,-w.tilt)).multiply(qb.setFromAxisAngle(AXIS_Y,w.roll));
 }
 draw(s:FollowScene,now:number){
  const f=s.follow;
  this.place(this.ghostHand.group,f.teacherWrist,f.mirrored);this.place(this.you.group,f.youWrist,f.mirrored);
  this.you.pose(s.free,[0,0,0,0],s.residual);
  this.teacherContact.set(s.user,f.touch,()=>'#ffc861',()=>true);
  this.youContact.set(s.free,f.touch,cm=>cm<=TOUCH_CM?'#8dffb0':'#ffc861',cm=>f.hand&&cm<4.5);
  super.draw({...s,residual:ZERO},now);
 }
 /** A hand-frame point (cm) of your hand on the stage, pixels. */
 youScreen(p:V3){const v=new T.Vector3(...p).applyMatrix4(this.you.hand.matrixWorld).project(this.camera);return {x:(v.x+1)/2*this.size.width,y:(1-v.y)/2*this.size.height};}
 /** How red a joint of your hand glows, by joint row. */
 youResidualOpacity(i:number){return (this.you.residual[i].material as T.SpriteMaterial).opacity;}
 get youHand(){return this.you;}
}
