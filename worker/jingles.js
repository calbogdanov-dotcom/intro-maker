const JINGLE_BOARD_KEY='published/jingles.json';
const commentFolder=kind=>kind==='jingle'?'jingle-comments':'comments';
const removedFolder=kind=>kind==='jingle'?'private/removed-jingle-comments':'private/removed-comments';
const jingleKeyPattern=/^jingles\/iteration-(\d+)\/jingle-(\d+)-[a-f0-9-]{36}\.(mp3|wav|m4a|aac|ogg|flac|webm)$/;
function validJingleKey(key,iteration,slot){const m=typeof key==='string'&&key.match(jingleKeyPattern);return !!m&&Number(m[1])===Number(iteration)&&Number(m[2])===Number(slot);}
function validJingleDrafts(value){
  if(!value||!Array.isArray(value.iterations)||value.iterations.length>99)return false;
  const numbers=new Set();return value.iterations.every(i=>{
    if(!i||!validInt(i.number,1,99)||numbers.has(i.number)||![2,4,8].includes(i.count)||typeof i.title!=='string'||i.title.length>80||!Array.isArray(i.items)||i.items.length>i.count)return false;
    numbers.add(i.number);const slots=new Set();return i.items.every(x=>{if(!validInt(x.slot,1,i.count)||slots.has(x.slot)||typeof x.title!=='string'||!x.title.trim()||x.title.length>120||!validJingleKey(x.key,i.number,x.slot))return false;slots.add(x.slot);return true});
  });
}
function audioFormat(bytes){
  const text=(a,b)=>new TextDecoder().decode(bytes.slice(a,b));
  if(text(0,4)==='RIFF'&&text(8,12)==='WAVE')return ['wav','audio/wav'];
  if(text(0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224&&(bytes[1]&6)!==0))return ['mp3','audio/mpeg'];
  if(text(4,8)==='ftyp')return ['m4a','audio/mp4'];
  if(text(0,4)==='OggS')return ['ogg','audio/ogg'];
  if(text(0,4)==='fLaC')return ['flac','audio/flac'];
  if(bytes[0]===255&&(bytes[1]&246)===240)return ['aac','audio/aac'];
  if(bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163)return ['webm','audio/webm'];
  return null;
}
async function serveAudio(request,env,objectKey,isPrivate=false){
  const wantsRange=request.headers.has('range');let object=null;
  if(wantsRange){try{object=await env.BUCKET.get(objectKey,{range:request.headers})}catch{}}
  if(!object)object=await env.BUCKET.get(objectKey);if(!object)return fail('Audio not found.',404);
  const headers=new Headers(isPrivate?privateHeaders:{});object.writeHttpMetadata(headers);
  headers.set('cache-control',isPrivate?'private, no-store':'public, max-age=31536000, immutable');headers.set('accept-ranges','bytes');headers.set('etag',object.httpEtag);headers.set('x-content-type-options','nosniff');
  const part=wantsRange?byteRange(object.range,object.size):null;
  if(part){headers.set('content-range',`bytes ${part.offset}-${part.offset+part.length-1}/${object.size}`);headers.set('content-length',String(part.length));}
  else headers.set('content-length',String(object.size));
  return new Response(request.method==='HEAD'?null:object.body,{status:part?206:200,headers});
}
async function publicAudio(request,env,url){
  const key='jingles/'+url.pathname.slice('/api/audio/'.length);
  if(!jingleKeyPattern.test(key))return fail('Not found.',404);
  const board=await getBoard(env,JINGLE_BOARD_KEY),expected='/api/audio/'+key.slice('jingles/'.length);
  if(!board.iterations.some(i=>i.items.some(x=>x.url===expected)))return fail('Not found.',404);
  return serveAudio(request,env,key);
}
async function jingleRequest(request,env,url){
  const path=url.pathname;
  if(path==='/jingles')return new Response(null,{status:302,headers:{...privateHeaders,location:'/jingles/'}});
  if(path==='/jingles/'&&request.method==='GET')return new Response(JINGLE_UPLOADER,{headers:{...privateHeaders,'content-type':'text/html; charset=utf-8'}});
  if(path==='/api/maker/jingles/drafts')return privateRecord(request,env,'jingles');
  if(path==='/api/maker/jingles/media'&&request.method==='POST'){
    const iteration=validInt(url.searchParams.get('iteration'),1,99),slot=validInt(url.searchParams.get('slot'),1,8);
    if(!iteration||!slot)return privateJSON({error:'Choose a valid iteration and slot.'},400);
    const data=await readLimited(request,40*1024*1024),format=audioFormat(data);
    if(!format)return privateJSON({error:'Choose an MP3, WAV, M4A, AAC, OGG, FLAC, or WebM audio file.'},400);
    const key=`jingles/iteration-${iteration}/jingle-${slot}-${crypto.randomUUID()}.${format[0]}`;
    await env.BUCKET.put(key,data,{httpMetadata:{contentType:format[1]}});
    return privateJSON({ok:true,key});
  }
  if(path==='/api/maker/jingles/preview'&&['GET','HEAD'].includes(request.method)){
    const key=url.searchParams.get('key');if(!key||!jingleKeyPattern.test(key))return privateJSON({error:'Not found.'},404);
    return serveAudio(request,env,key,true);
  }
  if(path==='/api/maker/jingles/publish'&&request.method==='POST'){
    const input=await readInput(request),i=input.iteration;
    if(!validJingleDrafts({iterations:[i]})||!i.items.length)return privateJSON({error:'Upload at least one jingle before publishing.'},400);
    const items=[];for(const item of i.items){if(!await env.BUCKET.head(item.key))return privateJSON({error:'An uploaded jingle is missing. Upload it again.'},400);items.push({slot:Number(item.slot),title:item.title.trim(),url:'/api/audio/'+item.key.slice('jingles/'.length)})}
    items.sort((a,b)=>a.slot-b.slot);
    if(!await mergePublished(env,{number:Number(i.number),title:i.title.trim()||'Iteration '+i.number,items},JINGLE_BOARD_KEY))return privateJSON({error:'Another publication is in progress. Please try again.'},409);
    return privateJSON({ok:true,url:'/?section=jingle'});
  }
  return privateJSON({error:'Not found.'},404);
}
