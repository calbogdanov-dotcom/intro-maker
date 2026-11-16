const page = REVIEW_PAGE;

const json = (value, status=200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,x-studio-title,x-studio-subtitle,x-studio-meta" } });
const fail = (message, status=400) => json({ error: message }, status);
const key = "published/board.json";
async function getBoard(env,storageKey=key) { const object = await env.BUCKET.get(storageKey); if (!object) return { iterations: [] }; try { return await object.json(); } catch { return { iterations: [] }; } }
// Short version tag for a stored video (its etag), or null when nothing has been uploaded for that slot.
async function mediaVersion(env, objectKey) {
  if (typeof env.BUCKET.head !== "function") return String(Date.now());
  let head; try { head = await env.BUCKET.head(objectKey); } catch { return String(Date.now()); }
  if (!head) return null;
  const tag = String(head.etag || head.httpEtag || (head.uploaded && head.uploaded.getTime && head.uploaded.getTime()) || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
  return tag || String(Date.now());
}
// Resolve an R2 range (offset/length or suffix) against the object size.
function byteRange(range, size) {
  if (!range || typeof size !== "number") return null;
  let offset, length;
  if (range.suffix != null) { length = Math.min(range.suffix, size); offset = size - length; }
  else { offset = range.offset || 0; length = range.length != null ? range.length : size - offset; }
  if (offset < 0 || length <= 0 || offset + length > size) return null;
  return { offset, length };
}
function validInt(value, min, max) { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : null; }
async function receiptHash(token){const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function ipDigest(request) { const ip = request.headers.get("CF-Connecting-IP") || "unknown"; const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)); return [...new Uint8Array(hash)].slice(0,12).map(x=>x.toString(16).padStart(2,"0")).join(""); }

// Editing, presets, uploads and publishing are open to every visitor.
// Sites identity is used only for owner moderation of review comments.

const privateHeaders = { "cache-control": "private, no-store", "vary": "Cookie", "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-frame-options": "DENY" };
const privateJSON = (value, status=200) => new Response(JSON.stringify(value), {status,headers:{...privateHeaders,"content-type":"application/json; charset=utf-8"}});
function ownerAccess(request, env) {
  if (typeof env.authorizeOwner !== "function") return 401;
  const result = env.authorizeOwner(request);
  return result === 200 ? 200 : result === 403 ? 403 : 401;
}
function serviceAccess(request,env) { return !!env.PUBLISH_TOKEN && request.headers.get("authorization")===`Bearer ${env.PUBLISH_TOKEN}`; }
async function readLimited(request, limit) {
  if(Number(request.headers.get("content-length")||0)>limit) throw Object.assign(new Error("This file is too large."),{status:413});
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks=[];let size=0;
  try { while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Object.assign(new Error("This file is too large."),{status:413})}chunks.push(value)} }
  finally { reader.releaseLock(); }
  const out=new Uint8Array(size);let pos=0;for(const chunk of chunks){out.set(chunk,pos);pos+=chunk.length}return out;
}
async function storeRecording(request, env, key, type) {
  const options={httpMetadata:{contentType:type,cacheControl:"public, max-age=31536000, immutable"}};
  const declared=request.headers.get("x-upload-size");
  // Older clients keep the small, bounded buffering path. New recordings carry
  // their exact Blob size so R2 can consume them with backpressure, without a
  // second recording-sized allocation inside the Worker's 128 MB isolate.
  if(declared===null){
    const data=await readLimited(request,24*1024*1024);
    if(data.length<16)throw Object.assign(new Error("The recording is empty."),{status:400});
    await env.BUCKET.put(key,data,options);return;
  }
  const size=Number(declared);
  if(!/^[1-9]\d*$/.test(declared)||!Number.isSafeInteger(size)||size<16)throw Object.assign(new Error("Invalid recording size."),{status:400});
  if(size>96_000_000)throw Object.assign(new Error("The recording exceeds the 96 MB upload limit."),{status:413});
  const contentLength=request.headers.get("content-length");
  if(contentLength!==null&&(!/^\d+$/.test(contentLength)||Number(contentLength)!==size))throw Object.assign(new Error("The recording size does not match its upload."),{status:400});
  if(!request.body)throw Object.assign(new Error("The recording is empty."),{status:400});
  // R2 requires a known-length ReadableStream. FixedLengthStream preserves that
  // information and errors if the source sends fewer or more bytes than promised.
  const stream=new FixedLengthStream(size),cancel=new AbortController();
  const pumping=request.body.pipeTo(stream.writable,{signal:cancel.signal});
  const storing=Promise.resolve().then(()=>env.BUCKET.put(key,stream.readable,options));
  try {await Promise.all([pumping,storing]);}
  catch(error){
    cancel.abort(error);
    // If R2 rejects before acquiring a reader, a pending write can be waiting
    // for backpressure forever. Cancel the unclaimed readable to release it.
    try{await stream.readable.cancel(error)}catch{}
    await Promise.allSettled([pumping,storing]);
    try{await request.body.cancel(error)}catch{}
    // The generated key belongs only to this request. Failed or aborted uploads
    // must never leave an object that a later publish could reference.
    try{await env.BUCKET.delete(key)}catch{}
    throw Object.assign(new Error("The recording upload did not complete. Please try again."),{status:400});
  }
}
async function readInput(request,limit=1024*1024) {
  try { return JSON.parse(new TextDecoder().decode(await readLimited(request,limit))); }
  catch(e){if(e.status)throw e;throw Object.assign(new Error("Please check the submitted data."),{status:400})}
}
function validLibrary(value) { return value && typeof value==="object" && !Array.isArray(value) && ["logos","fonts","presets"].every(k=>Array.isArray(value[k])); }
function validDrafts(value) {
  if(!value||!Array.isArray(value.iterations)||value.iterations.length>99)return false;
  const numbers=new Set();
  return value.iterations.every(i=>{
    if(!validInt(i.number,1,99)||numbers.has(i.number)||![2,4,8].includes(i.count)||typeof i.title!=="string"||i.title.length>80||!Array.isArray(i.items)||i.items.length>i.count)return false;
    numbers.add(i.number);const slots=new Set();
    return i.items.every(x=>{if(!validInt(x.slot,1,i.count)||slots.has(x.slot)||typeof x.title!=="string"||x.title.length>120||!x.state||typeof x.state!=="object"||Array.isArray(x.state))return false;slots.add(x.slot);return true});
  });
}
async function privateRecord(request,env,name) {
  const objectKey=`private/maker/${name}.json`, object=await env.BUCKET.get(objectKey);
  let record=null;if(object)record=await object.json();
  if(request.method==="GET")return privateJSON({[name]:record?.value??null,revision:object?.etag??null});
  if(request.method!=="PUT")return privateJSON({error:"Method not allowed."},405);
  const input=await readInput(request,16*1024*1024),value=input[name];
  if(!(name==="library"?validLibrary(value):name==="jingles"?validJingleDrafts(value):validDrafts(value)))return privateJSON({error:"Please check the saved data."},400);
  if((input.revision??null)!==(object?.etag??null))return privateJSON({error:"Someone else changed this workspace. Reload before saving."},409);
  const result=await env.BUCKET.put(objectKey,JSON.stringify({value,updatedAt:new Date().toISOString()}),{httpMetadata:{contentType:"application/json",cacheControl:"private, no-store"},onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:"*"}});
  if(!result)return privateJSON({error:"Someone else changed this workspace. Reload before saving."},409);
  return privateJSON({ok:true,revision:result.etag});
}
async function mergePublished(env,iteration,storageKey=key) {
  for(let attempt=0;attempt<3;attempt++){
    const object=await env.BUCKET.get(storageKey),board=object?await object.json():{iterations:[]};
    const iterations=(board.iterations||[]).filter(i=>i.number!==iteration.number);iterations.push(iteration);iterations.sort((a,b)=>a.number-b.number);
    const result=await env.BUCKET.put(storageKey,JSON.stringify({iterations,updatedAt:new Date().toISOString()}),{httpMetadata:{contentType:"application/json"},onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:"*"}});
    if(result)return true;
  }return false;
}
async function makerRequest(request,env,url) {
  const path=url.pathname;
  if (env.SHARED_EDITING !== true && ownerAccess(request,env) !== 200) {
    const access=ownerAccess(request,env);
    if(access===401 && ["/maker","/maker/","/jingles","/jingles/"].includes(path))return new Response(null,{status:302,headers:{...privateHeaders,location:"/login?return_to="+encodeURIComponent(path.startsWith("/jingles")?"/jingles/":"/maker/")}});
    return privateJSON({error:"Sign in to continue."},access);
  }
  // The existing server-side publishing credential is also used for one-time
  // library migration. It is never delivered to the browser.
  const migration=path==="/api/maker/library"&&serviceAccess(request,env);
  if(!["GET","HEAD"].includes(request.method)&&!migration&&request.headers.get("origin")!==url.origin)return privateJSON({error:"This action must start from this workspace."},403);
  if(path==="/jingles"||path.startsWith("/jingles/")||path.startsWith("/api/maker/jingles/"))return jingleRequest(request,env,url);
  if((path==="/api/maker/comments/remove"||path==="/api/maker/comments/restore")&&request.method==="POST"){
    const access=ownerAccess(request,env);
    if(access!==200)return privateJSON({error:access===403?"Only the owner can moderate comments.":"Sign in as the owner to moderate comments."},access);
    const input=await readInput(request),iteration=validInt(input.iteration,1,99),slot=validInt(input.slot,1,8),id=input.id;
    if(!iteration||!slot||typeof id!=="string"||!/^[A-Za-z0-9_-]{1,160}\.json$/.test(id))return privateJSON({error:"Invalid comment."},400);
    const kind=input.kind??"logo";if(!["logo","jingle"].includes(kind))return privateJSON({error:"Invalid review type."},400);
    const objectKey=`${commentFolder(kind)}/${iteration}/${slot}/${id}`,removedKey=`${removedFolder(kind)}/${iteration}/${slot}/${id}`;
    if(!await env.BUCKET.head(objectKey))return privateJSON({error:"Comment not found."},404);
    if(path.endsWith("/restore"))await env.BUCKET.delete(removedKey);
    else await env.BUCKET.put(removedKey,JSON.stringify({removedAt:new Date().toISOString()}),{httpMetadata:{contentType:"application/json"}});
    return privateJSON({ok:true});
  }
  if(path==="/api/maker/library")return privateRecord(request,env,"library");
  if(path==="/api/maker/drafts")return privateRecord(request,env,"drafts");
  if(path==="/api/maker/media"&&request.method==="POST"){
    const iteration=validInt(url.searchParams.get("iteration"),1,99),slot=validInt(url.searchParams.get("slot"),1,8);
    const type=(request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase(),extension={"video/mp4":"mp4","video/webm":"webm"}[type];
    if(!iteration||!slot||!extension)return privateJSON({error:"Choose a valid video and review slot."},400);
    const key=`media/iteration-${iteration}/logo-${slot}-${crypto.randomUUID()}.${extension}`;
    await storeRecording(request,env,key,type);
    return privateJSON({ok:true,key,url:`/api/${key}`});
  }
  if(path==="/api/maker/publish"&&request.method==="POST"){
    const input=await readInput(request),i=input.iteration;
    if(!i||!validInt(i.number,1,99)||typeof i.title!=="string"||i.title.length>80||!Array.isArray(i.items)||!i.items.length||i.items.length>8)return privateJSON({error:"Save at least one intro before publishing."},400);
    const seen=new Set(),items=[];
    for(const item of i.items){
      if(!validInt(item.slot,1,8)||seen.has(item.slot)||typeof item.title!=="string"||!item.title.trim()||item.title.length>120||typeof item.key!=="string"||!new RegExp(`^media/iteration-${i.number}/logo-${item.slot}-[a-f0-9-]{36}\\.(mp4|webm)$`).test(item.key))return privateJSON({error:"Please check the selected review slots."},400);
      const head=await env.BUCKET.head(item.key);if(!head)return privateJSON({error:"Finish uploading every intro before publishing."},400);
      seen.add(item.slot);items.push({slot:Number(item.slot),title:item.title.trim(),subtitle:String(item.subtitle||"").slice(0,160),url:`/api/${item.key}`});
    }
    items.sort((a,b)=>a.slot-b.slot);
    if(!await mergePublished(env,{number:Number(i.number),title:i.title.trim()||`Iteration ${i.number}`,items}))return privateJSON({error:"Another publication is in progress. Please try again."},409);
    return privateJSON({ok:true,url:"/"});
  }
  if(path==="/maker")return new Response(null,{status:302,headers:{...privateHeaders,location:"/maker/"}});
  if(path.startsWith("/maker/")&&(request.method==="GET"||request.method==="HEAD")){
    const assetPath=path.slice("/maker/".length)||"index.html",asset=typeof MAKER_ASSETS!=="undefined"?MAKER_ASSETS[assetPath]:null;
    if(!asset)return privateJSON({error:"Not found."},404);
    const bytes=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));
    return new Response(request.method==="HEAD"?null:bytes,{headers:{...privateHeaders,"content-type":asset.type}});
  }
  return privateJSON({error:"Not found."},404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if(path==="/jingles"||path.startsWith("/jingles/")||path==="/maker"||path.startsWith("/maker/")||path==="/api/maker"||path.startsWith("/api/maker/")){
      try{return await makerRequest(request,env,url)}catch(e){return privateJSON({error:e.status?e.message:"Could not complete this action. Please try again."},e.status||500)}
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin":"*", "access-control-allow-methods":"GET,POST,PUT,OPTIONS", "access-control-allow-headers":"authorization,content-type,range,x-studio-title,x-studio-subtitle,x-studio-meta" } });
    if (path === "/" || /^\/(intro|jingle)\/([1-9]\d?)\/([1-8])\/?$/.test(path)) return new Response(env.SHARED_EDITING === true ? page : page.replace(/<a class="editor-link" id="(edit-workspace|edit-detail-workspace)"[^>]*>Edit<\/a>/g, '<span id="$1" hidden></span>'), { headers: { "content-type":"text/html; charset=utf-8", "cache-control":"no-store" } });
    if(path==="/api/jingles/board"&&request.method==="GET")return json(await getBoard(env,JINGLE_BOARD_KEY));
    if(path.startsWith("/api/audio/")&&["GET","HEAD"].includes(request.method))return publicAudio(request,env,url);
    if (path === "/api/board" && request.method === "GET") return json(await getBoard(env));
    if (path === "/api/publish/media" && request.method === "PUT") {
      if (!env.PUBLISH_TOKEN || request.headers.get("authorization") !== `Bearer ${env.PUBLISH_TOKEN}`) return fail("Publishing is not authorized.",401);
      const iteration=validInt(url.searchParams.get("iteration"),1,99), slot=validInt(url.searchParams.get("slot"),1,8), length=Number(request.headers.get("content-length")||0);
      if (!iteration || !slot || !request.body || length > 18*1024*1024) return fail("Invalid item or file too large.");
      const path=`media/iteration-${iteration}/logo-${slot}.mov`;
      await env.BUCKET.put(path,request.body,{httpMetadata:{contentType:"video/quicktime",cacheControl:"public, max-age=31536000, immutable"}});
      return json({ok:true,key:path});
    }
    if (path === "/api/publish" && request.method === "POST") {
      if (!env.PUBLISH_TOKEN || request.headers.get("authorization") !== `Bearer ${env.PUBLISH_TOKEN}`) return fail("Publishing is not authorized.",401);
      let input;try{input=await readInput(request,32*1024)}catch{return fail("Invalid publish data.")}
      const iter=input.iteration;if(!iter||!validInt(iter.number,1,99)||!Array.isArray(iter.items)||iter.items.length>8)return fail("Invalid iteration.");
      const seen=new Set(),items=[];for(const item of iter.items){const slot=validInt(item.slot,1,8);if(!slot||!item.title||String(item.title).length>120||seen.has(slot))return fail("Invalid logo slot.");seen.add(slot);
        // Versioned link: a re-uploaded video gets a new address, so viewers never see a cached old cut.
        const version=await mediaVersion(env,`media/iteration-${iter.number}/logo-${item.slot}.mov`);if(!version)return fail(`Upload the video for logo ${item.slot} before publishing.`);
        items.push({slot,url:`/api/media/iteration-${iter.number}/logo-${slot}.mov?v=${version}`,title:String(item.title).slice(0,120),subtitle:String(item.subtitle||"").slice(0,160)});}
      if(!await mergePublished(env,{number:Number(iter.number),title:String(iter.title||`Iteration ${iter.number}`).slice(0,80),items}))return fail("Another publication is in progress. Please try again.",409);
      return json({ok:true});
    }
    if(path.startsWith("/api/media/")&&(request.method==="GET"||request.method==="HEAD")){
      const objectKey=path.slice("/api/".length),legacy=/^media\/iteration-\d+\/logo-\d+\.mov$/.test(objectKey),modern=/^media\/iteration-\d+\/logo-\d+-[a-f0-9-]{36}\.(mp4|webm)$/.test(objectKey);if(!legacy&&!modern)return fail("Not found.",404);
      // Review playback exposes a recording only after its slot is published.
      if(modern){const board=await getBoard(env);if(!board.iterations.some(i=>i.items.some(x=>x.url?.split("?")[0]===`/api/${objectKey}`)))return fail("Not found.",404)}
      // Safari and iPhone ask for videos in byte ranges and won't play without 206 answers.
      const wantsRange=request.headers.has("range");let object=null;
      if(wantsRange){try{object=await env.BUCKET.get(objectKey,{range:request.headers})}catch{object=null}}
      if(!object)object=await env.BUCKET.get(objectKey);if(!object)return fail("Not found.",404);
      const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);headers.set("accept-ranges","bytes");headers.set("access-control-allow-origin","*");
      // Versioned links (?v=) never change, so they can be cached for good; bare links revalidate.
      headers.set("cache-control",url.searchParams.has("v")?"public, max-age=31536000, immutable":"public, max-age=0, must-revalidate");
      const body=request.method==="HEAD"?null:object.body,part=wantsRange?byteRange(object.range,object.size):null;
      if(part){headers.set("content-range",`bytes ${part.offset}-${part.offset+part.length-1}/${object.size}`);headers.set("content-length",String(part.length));return new Response(body,{status:206,headers})}
      if(typeof object.size==="number")headers.set("content-length",String(object.size));
      return new Response(body,{headers});
    }
    if(path==="/api/comments"&&request.method==="GET"){
      const iteration=validInt(url.searchParams.get("iteration"),1,99),slot=validInt(url.searchParams.get("slot"),1,8);if(!iteration||!slot)return fail("Invalid item.");
      const kind=url.searchParams.get("kind")||"logo";if(!["logo","jingle"].includes(kind))return fail("Invalid review type.");
      const prefix=`${commentFolder(kind)}/${iteration}/${slot}/`, comments=[];let cursor;
      do { const listing=await env.BUCKET.list({prefix,limit:1000,...(cursor?{cursor}:{})});
        for(const object of listing.objects){const id=object.key.slice(prefix.length),removed=!!await env.BUCKET.head(`${removedFolder(kind)}/${iteration}/${slot}/${id}`);if(removed&&!(ownerAccess(request,env)===200&&url.searchParams.get("removed")==="1"))continue;const file=await env.BUCKET.get(object.key);if(file){try{const {removalHash,...publicComment}=await file.json();comments.push({...publicComment,id,...(removed?{removed:true}:{})})}catch{}}}
        cursor=listing.truncated?listing.cursor:undefined;
      } while(cursor);
      comments.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));return privateJSON({comments,canRemove:ownerAccess(request,env)===200});
    }
    if(path==="/api/comments/remove"&&request.method==="POST"){
      if(request.headers.get("origin")!==url.origin)return fail("This action must start from the review site.",403);
      let input;try{input=await readInput(request)}catch(e){return fail("Invalid feedback.",e.status||400)}
      const iteration=validInt(input.iteration,1,99),slot=validInt(input.slot,1,8),kind=input.kind??"logo",id=input.id;
      if(!iteration||!slot||!["logo","jingle"].includes(kind)||typeof id!=="string"||!/^[A-Za-z0-9_-]{1,160}\.json$/.test(id)||typeof input.token!=="string"||input.token.length>160)return fail("Invalid feedback.");
      const object=await env.BUCKET.get(`${commentFolder(kind)}/${iteration}/${slot}/${id}`),record=object?await object.json():null;
      if(!record?.removalHash||record.removalHash!==await receiptHash(input.token))return fail("Only the person who submitted this feedback can remove it.",403);
      await env.BUCKET.put(`${removedFolder(kind)}/${iteration}/${slot}/${id}`,JSON.stringify({removedAt:new Date().toISOString()}),{httpMetadata:{contentType:"application/json"}});
      return privateJSON({ok:true});
    }
    if(path==="/api/comments"&&request.method==="POST"){
      const now=Date.now();let input;try{input=await readInput(request,32*1024)}catch(e){return fail("Please check your comment.",e.status||400)}const iteration=validInt(input.iteration,1,99),slot=validInt(input.slot,1,8);
      if(!iteration||!slot||!input||(input.message!=null&&typeof input.message!=="string")||(input.name!=null&&typeof input.name!=="string"))return fail("Please check your feedback.");
      const name=typeof input.name==="string"?input.name.trim().slice(0,60):"",message=(input.message??"").trim().slice(0,1000);
      const kind=input.kind??"logo";if(!["logo","jingle"].includes(kind))return fail("Invalid review type.");
      const reaction=input.reaction;if(reaction!=null&&reaction!==""&&!["up","down","chosen"].includes(reaction))return fail("Choose a valid response.");
      if(!reaction&&!message)return fail("Choose a response or leave a comment.");
      const ip=await ipDigest(request),limitKey=`limits/${ip}/${Math.floor(now/3600000)}.json`,prior=await env.BUCKET.get(limitKey);let count=0;if(prior){try{count=(await prior.json()).count||0}catch{}}if(count>=30)return fail("Please try again later.",429);
      await env.BUCKET.put(limitKey,JSON.stringify({count:count+1}),{httpMetadata:{contentType:"application/json"}});
      const comment={name,message,createdAt:new Date(now).toISOString(),...(["up","down","chosen"].includes(reaction)?{reaction}:{})};const id=`${now}-${crypto.randomUUID()}.json`,token=crypto.randomUUID()+crypto.randomUUID();await env.BUCKET.put(`${commentFolder(kind)}/${iteration}/${slot}/${id}`,JSON.stringify({...comment,removalHash:await receiptHash(token)}),{httpMetadata:{contentType:"application/json"}});return json({ok:true,comment,id,token},201);
    }
    return fail("Not found.",404);
  }
};
