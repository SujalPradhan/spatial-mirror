import test from 'node:test';
import assert from 'node:assert/strict';
import {mirrorToStage} from '../src/atp/view';

const close=(a:{x:number;y:number},x:number,y:number)=>{assert.ok(Math.abs(a.x-x)<1e-9,`x ${a.x} != ${x}`);assert.ok(Math.abs(a.y-y)<1e-9,`y ${a.y} != ${y}`);};

test('view module loads without a DOM',()=>assert.equal(typeof (globalThis as {window?:unknown}).window,'undefined'));
test('matching aspects map 1:1',()=>{close(mirrorToStage(.2,.7,1.6,1.6),.2,.7);});
test('unknown video aspect behaves as the stage aspect',()=>{for(const a of [0,NaN,Infinity,-1])close(mirrorToStage(.2,.7,a,1.6),.2,.7);});
test('wide video on a narrower stage crops the sides',()=>{
 const video=16/9,stage=1,visible=stage/video,left=(1-visible)/2;
 close(mirrorToStage(left,.3,video,stage),0,.3);
 close(mirrorToStage(1-left,.3,video,stage),1,.3);
 close(mirrorToStage(.5,.5,video,stage),.5,.5);
 assert.ok(mirrorToStage(0,0,video,stage).x<0,'cropped points fall off stage');
});
test('tall video on a wider stage crops top and bottom',()=>{
 const video=3/4,stage=1.6,visible=video/stage,top=(1-visible)/2;
 close(mirrorToStage(.8,top,video,stage),.8,0);
 close(mirrorToStage(.8,1-top,video,stage),.8,1);
 close(mirrorToStage(.5,.5,video,stage),.5,.5);
});
test('a 16:9 camera on a 1440x900 stage',()=>{
 const stage=1440/900,video=16/9,x=.5+.25*stage/video;
 close(mirrorToStage(x,.5,video,stage),.75,.5);
});
