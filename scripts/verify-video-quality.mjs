import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
const settingsSource=await readFile(new URL('../maker/video-settings.js',import.meta.url),'utf8');
const hostedSource=await readFile(new URL('../maker/hosted.js',import.meta.url),'utf8');
const sharedSource=await readFile(new URL('../maker/shared-saves.js',import.meta.url),'utf8');
function harness(){
 let clock=0,trackStopped=false,streamFps=null,sceneSize=null,recordOptions=null,frameCount=0;
 const classes=new Set(),canvas={captureStream(fps){streamFps=fps;return {getTracks:()=>[{stop(){trackStopped=true}}]}}};
 class Recorder{
  static isTypeSupported(type){return type==='video/mp4'}
  constructor(stream,options){recordOptions=options;this.mimeType=options.mimeType;this.state='inactive'}
  start(){this.state='recording';clock+=500;this.onstart()}
  stop(){this.state='inactive';this.ondataavailable({data:new Blob([new Uint8Array(128)],{type:this.mimeType})});this.onstop()}
 }
 const window={MediaRecorder:Recorder,LOM_HOSTED:{async scene(state,width,height){sceneSize={width,height};return {canvas,context:{},scene:{}}}}};
 const context=vm.createContext({window,MediaRecorder:Recorder,HTMLCanvasElement:{prototype:{captureStream(){}}},document:{querySelector(){return {}},addEventListener(){},documentElement:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}}},LOM:{renderFrame(){frameCount++;clock+=2}},Blob,DOMException,performance:{now:()=>clock},setTimeout(fn,delay){clock+=delay;queueMicrotask(fn)},console});
 vm.runInContext(settingsSource,context);vm.runInContext(sharedSource,context);vm.runInContext(hostedSource,context);
 return {window,summary:()=>({trackStopped,streamFps,sceneSize,recordOptions,frameCount,classes})};
}
await test('recording preserves saved 4K60, portrait, and fractional frame rate settings',async()=>{
 for(const [resolution,fps,width,height] of [['3840x2160',60,3840,2160],['1920x1080',59.94,1920,1080],['1080x1920',30,1080,1920]]){
  const h=harness(),state={resolution,fps,duration:2};const result=await h.window.LOM_MEDIA.record(state);const actual=h.summary();
  assert.deepEqual(actual.sceneSize,{width,height});assert.equal(actual.streamFps,fps);assert.equal(actual.recordOptions.mimeType,'video/mp4');assert.ok(actual.recordOptions.videoBitsPerSecond>=8e6);assert.ok(actual.frameCount>=fps*1.8);assert.equal(actual.trackStopped,true);assert.equal(actual.classes.size,0);assert.equal(result.blob.size,128);assert.equal(state.resolution,resolution);
  if(width===3840)assert.ok(actual.recordOptions.videoBitsPerSecond>50e6,'4K60 needs more than the old fixed 6 Mbps');
 }
});
await test('preview fills Retina display pixels without the old 1280-pixel cap',()=>{
 const {preview}=harness().window.LOM_VIDEO;
 const result=preview(3840,2160,1200,675,2);assert.equal(result.W,2400);assert.equal(result.H,1350);
 const native=preview(1920,1080,814,457.875,2);assert.equal(native.W,1628);assert.equal(native.H,916);
 const capped=preview(1280,720,1600,900,3);assert.equal(capped.W,1280);assert.equal(capped.H,720);
 const portrait=preview(1080,1920,360,640,3);assert.equal(portrait.W,1080);assert.equal(portrait.H,1920);
});
await test('cancelled recording releases its capture track and restores preview rendering',async()=>{
 const h=harness();await assert.rejects(h.window.LOM_MEDIA.record({resolution:'3840x2160',fps:60,duration:2},{cancelled:()=>h.summary().frameCount>2}),{name:'AbortError'});
 assert.equal(h.summary().trackStopped,true);assert.equal(h.summary().classes.size,0);
});
