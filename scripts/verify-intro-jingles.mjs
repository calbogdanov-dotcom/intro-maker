import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';

const source=await readFile(new URL('../review/intro-jingles.js', import.meta.url),'utf8');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate)};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const published={iterations:[{number:1,items:[3,1,2].map(slot=>({slot,title:`Jingle ${slot}`,url:`/api/audio/jingle-${slot}.wav`}))}]};

function setup({board=published,pending=false,error=false}={}){
  const observers=[],all=[],documentListeners=new Map(),windowListeners=new Map();
  const notify=(target,attributeName)=>{for(const observer of observers){if(!observer.target)continue;let member=target===observer.target;if(!member&&observer.config.subtree){for(let p=target.parentNode;p;p=p.parentNode)if(p===observer.target){member=true;break}}
    if(!member||!observer.config.attributeFilter.includes(attributeName)||observer.queued)continue;observer.queued=true;queueMicrotask(()=>{observer.queued=false;observer.callback()})}};
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.attributes=new Map();this.children=[];this.parentNode=null;this.hidden=false;this.dataset={};this.listeners=new Map();this._innerHTML='';this.textContent='';this.classSet=new Set();this.classList={contains:x=>this.classSet.has(x),add:x=>{this.classSet.add(x);notify(this,'class')},remove:x=>{this.classSet.delete(x);notify(this,'class')}};all.push(this)}
    set id(value){this.setAttribute('id',value)}get id(){return this.getAttribute('id')||''}
    set className(value){this.classSet=new Set(value.split(/\s+/).filter(Boolean));notify(this,'class')}get className(){return [...this.classSet].join(' ')}
    set innerHTML(value){this._innerHTML=value;this.children=[];
      if(this.id==='intro-jingle-panel')for(const [tag,id] of [['div','intro-jingle-options'],['button','intro-jingle-replay'],['button','intro-jingle-sound'],['p','intro-jingle-status'],['audio','intro-jingle-audio']]){const child=tag==='audio'?new Media(tag):new Element(tag);child.id=id;this.append(child)}
      if(this.id==='intro-jingle-options')for(const match of value.matchAll(/data-jingle-index="(\d+)" aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)){const button=new Element('button');button.dataset.jingleIndex=match[1];button.setAttribute('aria-pressed',match[2]);button.textContent=match[3];this.append(button)}
    }get innerHTML(){return this._innerHTML}
    append(...nodes){for(const node of nodes){node.parentNode?.removeChild(node);this.children.push(node);node.parentNode=this}}
    removeChild(node){this.children=this.children.filter(x=>x!==node);node.parentNode=null}
    insertBefore(node,before){node.parentNode?.removeChild(node);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);node.parentNode=this}
    setAttribute(name,value){this.attributes.set(name,String(value));notify(this,name)}getAttribute(name){return this.attributes.get(name)??null}removeAttribute(name){this.attributes.delete(name);notify(this,name)}
    querySelector(selector){return this.querySelectorAll(selector)[0]??null}querySelectorAll(selector){const match=element=>selector[0]==='#'?element.id===selector.slice(1):selector==='[data-jingle-index]'?element.dataset.jingleIndex!==undefined:element.tagName.toLowerCase()===selector;return this.children.flatMap(child=>[...(match(child)?[child]:[]),...child.querySelectorAll(selector)])}
    closest(selector){if(selector==='[data-jingle-index]'&&this.dataset.jingleIndex!==undefined)return this;return this.parentNode?.closest(selector)??null}
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn)}
    emit(type){const event={type,target:this,stopped:false,stopImmediatePropagation(){this.stopped=true}};for(const fn of documentListeners.get(type)||[]){fn(event);if(event.stopped)return event}for(const fn of this.listeners.get(type)||[]){fn(event);if(event.stopped)break}return event}
    click(){this.parentNode?.onclick?.({target:this})}
  }
  class Media extends Element{
    constructor(tag){super(tag);this.paused=true;this.loop=false;this.muted=false;this.volume=1;this.currentTime=0;this.plays=0;this.pauses=0;this.loads=0;this.rejectNext=null;this.pendingNext=null}
    set src(value){this.setAttribute('src',value);this.currentTime=0}get src(){return this.getAttribute('src')||''}
    play(){this.plays++;const failure=this.rejectNext;this.rejectNext=null;if(failure)return Promise.reject(failure);this.paused=false;queueMicrotask(()=>this.emit('play'));return this.pendingNext||Promise.resolve()}
    pause(){this.pauses++;if(!this.paused){this.paused=true;queueMicrotask(()=>this.emit('pause'))}}
    load(){this.loads++;this.currentTime=0;this.paused=true}
    finish(){this.paused=true;this.emit('pause');this.emit('ended')}
  }
  const head=new Element('head'),sheet=new Element('section'),videoPlayer=new Element('div'),video=new Media('video'),detail=new Element('aside'),notes=new Element('div'),otherAudio=new Media('audio'),otherVideo=new Media('video');
  sheet.id='sheet';videoPlayer.id='video-player';video.id='large';notes.id='feedback-section';video.loop=true;sheet.append(videoPlayer,detail);videoPlayer.append(video);detail.append(notes);
  const find=id=>all.find(node=>node.id===id);
  const document={head,querySelector:selector=>find(selector.slice(1)),querySelectorAll:selector=>selector==='audio,video'?all.filter(node=>['AUDIO','VIDEO'].includes(node.tagName)):[],createElement:tag=>tag==='audio'||tag==='video'?new Media(tag):new Element(tag),addEventListener(type,fn){if(!documentListeners.has(type))documentListeners.set(type,[]);documentListeners.get(type).push(fn)}};
  const window={addEventListener(type,fn){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(fn)}};
  class MutationObserver{constructor(callback){this.callback=callback;observers.push(this)}observe(target,config){this.target=target;this.config=config}}
  const request=deferred();if(!pending){if(error)request.reject(new Error('offline'));else request.resolve({ok:true,json:async()=>board})}
  vm.runInNewContext(source,{document,window,MutationObserver,fetch:()=>request.promise,Promise});
  // Preserve production ordering: this legacy listener is installed by app.js later.
  let legacyAudioPlays=0;
  document.addEventListener('play',event=>{if(event.target.tagName==='AUDIO'){legacyAudioPlays++;document.querySelectorAll('audio,video').forEach(media=>{if(media!==event.target)media.pause()})}},true);
  return {document,window,sheet,videoPlayer,video,otherAudio,otherVideo,request,find,get audio(){return find('intro-jingle-audio')},get panel(){return find('intro-jingle-panel')},get status(){return find('intro-jingle-status').textContent},get legacyAudioPlays(){return legacyAudioPlays},async open(src='/intro-1.mp4'){videoPlayer.hidden=false;video.src=src;sheet.classList.add('open');await settle()},async play(){await video.play();await settle()},choose(index){find('intro-jingle-options').children[index].click()},async close(){sheet.classList.remove('open');video.pause();video.removeAttribute('src');video.load();await settle()},event(type){for(const fn of windowListeners.get(type)||[])fn({type})}};
}

await test('first published slot is default, sounds with video, and is exempt from legacy audio singleton listener',async()=>{
  const h=setup();await h.open();assert.equal(h.panel.hidden,false);assert.match(h.status,/Jingle 1 selected/);assert.equal(h.video.loop,false);
  h.otherAudio.paused=false;h.otherVideo.paused=false;await h.play();assert.equal(h.audio.src,'/api/audio/jingle-1.wav');assert.equal(h.audio.paused,false);assert.equal(h.video.paused,false);assert.equal(h.otherAudio.paused,true);assert.equal(h.otherVideo.paused,true);assert.equal(h.legacyAudioPlays,0);
  // Ordinary jingle playback retains the app's previous singleton behavior.
  await h.otherAudio.play();await settle();assert.equal(h.video.paused,true);assert.equal(h.audio.paused,true);assert.equal(h.legacyAudioPlays,1);
});
await test('choice is queued until ended restart then plays from zero',async()=>{
  const h=setup();await h.open();await h.play();h.audio.currentTime=1.25;h.choose(1);assert.equal(h.audio.src,'/api/audio/jingle-1.wav');assert.equal(h.audio.currentTime,1.25);assert.match(h.status,/Jingle 2 selected for the next play/);
  h.video.currentTime=3;h.video.finish();await settle();assert.equal(h.video.currentTime,0);assert.equal(h.video.paused,false);assert.equal(h.audio.src,'/api/audio/jingle-2.wav');assert.equal(h.audio.currentTime,0);assert.equal(h.audio.paused,false);
});
await test('unchanged jingle continues its cursor across animation loops',async()=>{
  const h=setup();await h.open();await h.play();h.audio.currentTime=5.85;h.video.currentTime=6;h.video.finish();await settle();assert.equal(h.video.currentTime,0);assert.equal(h.video.paused,false);assert.equal(h.audio.currentTime,5.85);assert.equal(h.audio.src,'/api/audio/jingle-1.wav');assert.equal(h.audio.paused,false);
});
await test('unchanged choice resumes its cursor after manual pause and play',async()=>{
  const h=setup();await h.open();await h.play();h.audio.currentTime=1.25;h.video.pause();await settle();assert.equal(h.audio.paused,true);await h.play();assert.equal(h.audio.currentTime,1.25);assert.equal(h.audio.src,'/api/audio/jingle-1.wav');assert.equal(h.audio.paused,false);
});
await test('queued choice applies on the next manual play',async()=>{
  const h=setup();await h.open();await h.play();h.choose(1);h.video.pause();await settle();await h.play();assert.equal(h.audio.src,'/api/audio/jingle-2.wav');assert.equal(h.audio.currentTime,0);
});
await test('close clears companion audio and restoring another intro resets the first choice',async()=>{
  const h=setup();await h.open();await h.play();h.choose(2);await h.close();assert.equal(h.panel.hidden,true);assert.equal(h.audio.paused,true);assert.equal(h.audio.src,'');assert.equal(h.video.loop,true);
  await h.open('/intro-2.mp4');await h.play();assert.equal(h.audio.src,'/api/audio/jingle-1.wav');
});
await test('source replacement clears prior audio and preserves original loop on close',async()=>{
  const h=setup();await h.open();await h.play();h.choose(2);h.video.src='/intro-2.mp4';await settle();assert.equal(h.audio.src,'/api/audio/jingle-1.wav');await h.close();assert.equal(h.video.loop,true);
});
await test('navigation and page exit stop sound',async()=>{
  const h=setup();await h.open();await h.play();h.event('popstate');assert.equal(h.audio.paused,true);assert.equal(h.audio.src,'');await h.close();await h.open('/intro-3.mp4');await h.play();h.event('pagehide');assert.equal(h.audio.paused,true);assert.equal(h.audio.src,'');
});
await test('late board fetch starts sound if video is already playing',async()=>{
  const h=setup({pending:true});await h.open();await h.play();assert.match(h.status,/Loading jingles/);assert.equal(h.audio.src,'');h.request.resolve({ok:true,json:async()=>published});await settle();assert.equal(h.audio.src,'/api/audio/jingle-1.wav');assert.equal(h.audio.paused,false);
});
await test('late fetch after close cannot revive sound',async()=>{
  const h=setup({pending:true});await h.open();await h.play();await h.close();h.request.resolve({ok:true,json:async()=>published});await settle();assert.equal(h.audio.src,'');assert.equal(h.audio.paused,true);assert.equal(h.panel.hidden,true);
});
await test('failed or empty boards leave intro playable with informative status',async()=>{
  for(const config of [{error:true},{board:{iterations:[]}}]){const h=setup(config);await h.open();await h.play();assert.equal(h.video.paused,false);assert.equal(h.audio.src,'');assert.equal(h.find('intro-jingle-replay').disabled,true);assert.match(h.status,config.error?/temporarily unavailable/:/No jingles/)}
});
await test('dedicated jingle detail does not mount soundtrack or change video looping',async()=>{
  const h=setup();h.videoPlayer.hidden=true;h.sheet.classList.add('open');await settle();assert.equal(h.panel.hidden,true);assert.equal(h.audio.src,'');assert.equal(h.video.loop,true);
});
await test('blocked companion playback exposes replay recovery and can retry',async()=>{
  const h=setup();await h.open();h.audio.rejectNext=Object.assign(new Error('Gesture required'),{name:'NotAllowedError'});await h.play();assert.match(h.status,/Press Replay intro/);assert.equal(h.video.paused,false);h.find('intro-jingle-replay').onclick();await settle();assert.equal(h.audio.paused,false);assert.equal(h.audio.src,'/api/audio/jingle-1.wav');assert.doesNotMatch(h.status,/Press Replay/);
});
await test('old rejected audio play cannot overwrite a later intro status',async()=>{
  const h=setup();await h.open();const old=deferred();h.audio.pendingNext=old.promise;await h.play();await h.close();h.audio.pendingNext=null;await h.open('/intro-2.mp4');await h.play();old.reject(Object.assign(new Error('old request'),{name:'NotAllowedError'}));await settle();assert.match(h.status,/Jingle 1 selected/);assert.doesNotMatch(h.status,/Press Replay/);
});
await test('sound toggle and video volume/mute update companion',async()=>{
  const h=setup();await h.open();await h.play();h.find('intro-jingle-sound').onclick();assert.equal(h.audio.muted,true);h.find('intro-jingle-sound').onclick();assert.equal(h.audio.muted,false);h.video.volume=.35;h.video.muted=true;h.video.emit('volumechange');assert.equal(h.audio.volume,.35);assert.equal(h.audio.muted,true);
});
