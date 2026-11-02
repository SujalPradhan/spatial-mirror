/** Where a mirror-space video point lands on an object-fit:cover stage, in 0..1 stage coords. */
export function mirrorToStage(x:number,y:number,videoAspect:number,stageAspect:number) {
 const video = videoAspect>0&&Number.isFinite(videoAspect)?videoAspect:stageAspect;
 // Cover crops the long axis symmetrically, so only the cropped axis stretches about its centre.
 return video>stageAspect
  ? {x:(x-.5)*video/stageAspect+.5,y}
  : {x,y:(y-.5)*stageAspect/video+.5};
}
