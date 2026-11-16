// Exercise the built Worker against a small R2 stand-in. No live data is touched.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

globalThis.crypto ??= webcrypto;
// Cloudflare's native stream carries its fixed length to R2. The stand-in below
// verifies byte-count behavior while Node's MemoryBucket consumes the stream.
globalThis.FixedLengthStream ??= class FixedLengthStream extends TransformStream {
  constructor(length) {
    let written=0;
    super({
      transform(chunk,controller){written+=chunk.byteLength;if(written>length)throw new Error('Too many upload bytes');controller.enqueue(chunk)},
      flush(){if(written!==length)throw new Error('Not enough upload bytes')},
    });
  }
};
const source = await readFile(new URL('../dist/server/index.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const origin = 'https://intro-maker.example';
const owner = { 'x-test-owner': 'owner' };
const outsider = { 'x-test-owner': 'outsider' };
const jsonHeaders = { ...owner, origin, 'content-type': 'application/json' };
const anonymousJSON = { origin, 'content-type': 'application/json' };
const library = { logos: [], fonts: [], presets: [{ name: 'Private owner preset', state: { company: 'Unpublished owner company' } }], last: null };

class MemoryBucket {
  objects = new Map();
  next = 0;
  async put(key, value, options = {}) {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    const old = this.objects.get(key);
    const condition = options.onlyIf;
    const getCondition = (name, field) => condition instanceof Headers ? condition.get(name) : condition?.[field];
    const matches = getCondition('if-match', 'etagMatches');
    const differs = getCondition('if-none-match', 'etagDoesNotMatch');
    const tag = x => String(x).replaceAll('"', '');
    if (matches != null && (!old || (matches !== '*' && tag(matches) !== old.etag))) return null;
    if (differs != null && old && (differs === '*' || tag(differs) === old.etag)) return null;
    const item = { key, bytes, etag: `etag${++this.next}`, uploaded: new Date(), httpMetadata: options.httpMetadata || {} };
    this.objects.set(key, item);
    return this.object(item);
  }
  object(item, range) {
    const output = {
      key: item.key, size: item.bytes.byteLength, etag: item.etag, httpEtag: `"${item.etag}"`, uploaded: item.uploaded,
      httpMetadata: item.httpMetadata,
      writeHttpMetadata(headers) {
        if (item.httpMetadata.contentType) headers.set('content-type', item.httpMetadata.contentType);
        if (item.httpMetadata.cacheControl) headers.set('cache-control', item.httpMetadata.cacheControl);
      },
    };
    let bytes = item.bytes;
    if (range) {
      const offset = range.suffix != null ? Math.max(0, bytes.length - range.suffix) : range.offset || 0;
      const length = range.suffix != null ? Math.min(bytes.length, range.suffix) : range.length ?? bytes.length - offset;
      bytes = bytes.slice(offset, offset + length);
      output.range = { offset, length: bytes.length };
    }
    return { ...output, body: new Response(bytes).body,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => new TextDecoder().decode(bytes), json: async () => JSON.parse(new TextDecoder().decode(bytes)) };
  }
  async get(key, options = {}) {
    const item = this.objects.get(key);
    if (!item) return null;
    let range = options.range;
    if (range instanceof Headers) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.get('range') || '');
      range = match ? match[1] ? { offset: +match[1], ...(match[2] ? { length: +match[2] - +match[1] + 1 } : {}) } : { suffix: +match[2] } : undefined;
    }
    return this.object(item, range);
  }
  async head(key) { const item = this.objects.get(key); return item ? this.object(item) : null; }
  async delete(key) { this.objects.delete(key); }
  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const matching = [...this.objects.values()].filter(item => item.key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key));
    const offset = Number(cursor || 0), page = matching.slice(offset, offset + limit);
    return { objects: page.map(item => this.object(item)), truncated: offset + page.length < matching.length,
      cursor: offset + page.length < matching.length ? String(offset + page.length) : undefined };
  }
}

const fresh = () => ({ BUCKET: new MemoryBucket(), PUBLISH_TOKEN: 'only-in-test-fixture', SHARED_EDITING: true, authorizeOwner: r => r.headers.get('x-test-owner') === 'owner' ? 200 : r.headers.get('x-test-owner') === 'outsider' ? 403 : 401 });
const call = (env, path, options) => worker.fetch(new Request(new URL(path, origin), options), env);
const put = (env, path, value, headers = jsonHeaders) => call(env, path, { method: 'PUT', headers, body: JSON.stringify(value) });
const post = (env, path, value, headers = jsonHeaders) => call(env, path, { method: 'POST', headers, body: JSON.stringify(value) });
const good = response => assert.ok(response.ok, `Expected a successful response, received ${response.status}`);

async function upload(env, iteration = 1, slot = 1) {
  const bytes = new Uint8Array(128);
  bytes.set([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const response = await call(env, `/api/maker/media?iteration=${iteration}&slot=${slot}`, {
    method: 'POST', headers: { origin, 'content-type': 'video/mp4', 'content-length': String(bytes.length) }, body: bytes,
  });
  good(response); return response.json();
}

await test('public Intro Review exposes Edit without embedding workspace data', async () => {
  const env = fresh();
  await put(env, '/api/maker/library', { library, revision: null });
  const response = await call(env, '/'); good(response);
  const html = await response.text();
  assert.match(html, /Intro Review/i);
  assert.match(html, /<a\b[^>]*href=["']\/maker\/["'][^>]*>[\s\S]*?Edit[\s\S]*?<\/a>/i);
  assert.doesNotMatch(html, /presetSave|logoUpload|Private owner preset|Unpublished owner company/i);
  const board = await call(env, '/api/board'); good(board);
  assert.deepEqual((await board.json()).iterations, []);
  for (const path of ['/api/media/private/library.json', '/api/media/private/drafts.json', '/api/media/..%2Fprivate%2Flibrary.json']) {
    assert.equal((await call(env, path)).status, 404);
  }
});

await test('any visitor can open maker assets and shared workspace APIs without sign-in', async () => {
  const env = fresh();
  const entry = await call(env, '/maker');
  assert.equal(entry.status, 302);
  assert.equal(new URL(entry.headers.get('location'), origin).pathname, '/maker/');
  for (const headers of [{}, outsider]) {
    for (const path of ['/maker/', '/maker/app.js', '/maker/assets/fonts/Poppins-Bold.ttf', '/api/maker/library', '/api/maker/drafts']) {
      good(await call(env, path, { headers }));
    }
  }
  const saved = await put(env, '/api/maker/library', { library, revision: null }, anonymousJSON); good(saved);
  const result = await (await call(env, '/api/maker/library', { headers: outsider })).json();
  assert.deepEqual(result.library, library);
  const changed = { ...library, presets: [...library.presets, { name: 'SK preset', state: { company: 'Shared preset' } }] };
  good(await put(env, '/api/maker/library', { library: changed, revision: result.revision }, { ...outsider, ...anonymousJSON }));
  assert.deepEqual((await (await call(env, '/api/maker/library')).json()).library, changed);
});

await test('anonymous visitors can save animation drafts, upload, and explicitly publish', async () => {
  const env = fresh();
  const drafts = { iterations: [{ number: 1, title: 'Shared iteration', count: 2, items: [{ slot: 1, title: 'Intro 1', state: { company: 'Shared draft' } }] }] };
  const saved = await put(env, '/api/maker/drafts', { drafts, revision: null }, anonymousJSON); good(saved);
  const { revision } = await saved.json();
  assert.deepEqual((await (await call(env, '/api/maker/drafts')).json()).drafts, drafts);
  assert.equal((await put(env, '/api/maker/drafts', { drafts: { iterations: [] }, revision: null }, anonymousJSON)).status, 409);
  assert.equal((await (await call(env, '/api/maker/drafts')).json()).revision, revision);
  const uploaded = await upload(env);
  assert.deepEqual((await (await call(env, '/api/board')).json()).iterations, []);
  assert.equal((await call(env, uploaded.url)).status, 404);
  good(await post(env, '/api/maker/publish', { iteration: { number: 1, title: 'Shared iteration', items: [{ slot: 1, title: 'Intro 1', key: uploaded.key }] } }, anonymousJSON));
  const board = await (await call(env, '/api/board')).json();
  assert.equal(board.iterations[0].items[0].title, 'Intro 1');
  good(await call(env, board.iterations[0].items[0].url));
});

await test('workspace pages and records avoid shared caches for every visitor', async () => {
  const env = fresh();
  const response = await call(env, '/maker/'); good(response);
  assert.match(await response.text(), /Intro Maker/);
  assert.match(response.headers.get('cache-control') || '', /no-store|private/);
  const result = await call(env, '/api/maker/library'); good(result);
  assert.match(result.headers.get('cache-control') || '', /no-store|private/);
});

await test('library and iteration drafts persist independently; stale edits are rejected', async () => {
  const env = fresh();
  const initial = await (await call(env, '/api/maker/library', { headers: owner })).json();
  assert.equal(initial.library, null); assert.equal(initial.revision, null);
  const created = await put(env, '/api/maker/library', { library, revision: null }); good(created);
  const { revision } = await created.json(); assert.ok(revision);
  const reloaded = await (await call(env, '/api/maker/library', { headers: owner })).json();
  assert.deepEqual(reloaded.library, library); assert.equal(reloaded.revision, revision);
  const drafts = { iterations: [{ number: 1, title: 'First draft', count: 2, items: [{ slot: 1, title: 'First intro', state: { company: 'Private draft company' } }] }] };
  const savedDraft = await put(env, '/api/maker/drafts', { drafts, revision: null }); good(savedDraft);
  const loadedDraft = await (await call(env, '/api/maker/drafts', { headers: owner })).json();
  assert.deepEqual(loadedDraft.drafts, drafts);
  assert.equal((await put(env, '/api/maker/library', { library, revision: null })).status, 409);
  assert.equal((await put(env, '/api/maker/library', { library: { ...library, last: {} }, revision: 'stale-revision' })).status, 409);
  assert.deepEqual((await (await call(env, '/api/maker/library', { headers: owner })).json()).library, library);
  const board = await (await call(env, '/api/board')).json(); assert.deepEqual(board.iterations, []);
});

await test('concurrent first saves cannot silently overwrite each other', async () => {
  const env = fresh();
  const responses = await Promise.all([
    put(env, '/api/maker/library', { library, revision: null }),
    put(env, '/api/maker/library', { library: { ...library, presets: [] }, revision: null }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
});

await test('cross-origin and missing-origin requests cannot change shared records', async () => {
  const env = fresh();
  for (const requestOrigin of ['https://attacker.example', undefined]) {
    const headers = { 'content-type': 'application/json', ...(requestOrigin ? { origin: requestOrigin } : {}) };
    assert.equal((await put(env, '/api/maker/library', { library, revision: null }, headers)).status, 403);
    assert.equal((await put(env, '/api/maker/drafts', { drafts: { iterations: [] }, revision: null }, headers)).status, 403);
    assert.equal((await post(env, '/api/maker/publish', { iteration: { number: 1, title: 'Bad', items: [] } }, headers)).status, 403);
    assert.equal((await put(env, '/api/maker/jingles/drafts', { jingles: { iterations: [] }, revision: null }, headers)).status, 403);
    assert.equal((await post(env, '/api/maker/jingles/publish', { iteration: { number: 1, title: 'Bad', count: 2, items: [] } }, headers)).status, 403);
  }
  assert.equal(env.BUCKET.objects.size, 0);
});

await test('publishing requires valid uploaded media for the same iteration and slot', async () => {
  const env = fresh();
  const uploaded = await upload(env, 1, 1); assert.ok(uploaded.key);
  if (uploaded.url) assert.ok([401, 403, 404].includes((await call(env, uploaded.url)).status), 'Unpublished media should stay private');
  for (const item of [
    { slot: 1, title: 'Missing', key: 'media/iteration-1/nonexistent.mp4' },
    { slot: 2, title: 'Wrong slot', key: uploaded.key },
    { slot: 1, title: 'Private record', key: 'private/library.json' },
  ]) {
    const result = await post(env, '/api/maker/publish', { iteration: { number: 1, title: 'Iteration 1', items: [item] } });
    assert.ok(result.status >= 400 && result.status < 500, `Invalid publish returned ${result.status}`);
  }
  const wrongIteration = await post(env, '/api/maker/publish', { iteration: { number: 2, title: 'Wrong iteration', items: [{ slot: 1, title: 'Wrong', key: uploaded.key }] } });
  assert.ok(wrongIteration.status >= 400 && wrongIteration.status < 500);
  assert.deepEqual((await (await call(env, '/api/board')).json()).iterations, []);
});

await test('published reviews expose video and labels while retaining comments and other iterations', async () => {
  const env = fresh();
  const prior = { iterations: [
    { number: 1, title: 'Old version', items: [{ slot: 1, title: 'Old intro', url: '/api/media/iteration-1/logo-1.mov?v=old' }] },
    { number: 2, title: 'Keep this page', items: [] },
  ] };
  await env.BUCKET.put('published/board.json', JSON.stringify(prior), { httpMetadata: { contentType: 'application/json' } });
  const comment = { name: 'Client', message: 'Please keep this feedback.', createdAt: '2026-11-14T12:00:00.000Z' };
  await env.BUCKET.put('comments/1/1/old-comment.json', JSON.stringify(comment));
  const uploaded = await upload(env);
  const result = await post(env, '/api/maker/publish', { iteration: { number: 1, title: 'Published first page', privateField: 'private iteration data', items: [
    { slot: 1, title: 'Published intro', subtitle: 'Particles', key: uploaded.key, state: { company: 'Private setting' }, library },
  ] } }); good(result);
  const board = await (await call(env, '/api/board')).json();
  assert.equal(board.iterations.length, 2);
  assert.equal(board.iterations.find(i => i.number === 2).title, 'Keep this page');
  const item = board.iterations.find(i => i.number === 1).items[0];
  assert.equal(item.title, 'Published intro'); assert.equal(item.slot, 1); assert.equal(item.subtitle, 'Particles');
  assert.ok(item.url.startsWith('/api/media/'));
  assert.doesNotMatch(JSON.stringify(board), /Private setting|Private owner preset|private iteration data|"state"|"library"/);
  const media = await call(env, item.url); good(media); assert.match(media.headers.get('content-type'), /video\/mp4/);
  assert.equal((await media.arrayBuffer()).byteLength, 128);
  const range = await call(env, item.url, { headers: { range: 'bytes=0-9' } });
  assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 10);
  assert.match(range.headers.get('content-range') || '', /^bytes 0-9\/128$/);
  assert.deepEqual((await (await call(env, '/api/comments?iteration=1&slot=1')).json()).comments.map(({id,...entry})=>entry), [comment]);
  const newComment = await post(env, '/api/comments', { iteration: 1, slot: 1, name: 'Client two', message: 'This looks good.' }, { 'content-type': 'application/json' });
  assert.equal(newComment.status, 201);
  assert.equal((await (await call(env, '/api/comments?iteration=1&slot=1')).json()).comments.length, 2);
});

await test('unrecognized upload types and invalid slots are rejected', async () => {
  const env = fresh();
  for (const [path, type] of [
    ['/api/maker/media?iteration=1&slot=1', 'text/html'],
    ['/api/maker/media?iteration=1&slot=9', 'video/mp4'],
    ['/api/maker/media?iteration=0&slot=1', 'video/mp4'],
  ]) {
    const response = await call(env, path, { method: 'POST', headers: { ...owner, origin, 'content-type': type }, body: '<script>bad</script>' });
    assert.ok(response.status >= 400 && response.status < 500);
  }
  assert.equal(env.BUCKET.objects.size, 0);
});

await test('only the owner can remove and restore comments, with same-origin checks', async () => {
  const env=fresh();
  await post(env,'/api/comments',{iteration:1,slot:1,name:'Reviewer',message:'Keep the original comment.'},{'content-type':'application/json'});
  const before=await (await call(env,'/api/comments?iteration=1&slot=1')).json();
  assert.equal(before.canRemove,false);
  const id=before.comments[0].id,body={iteration:1,slot:1,id};
  assert.equal((await post(env,'/api/maker/comments/remove',body,anonymousJSON)).status,401);
  assert.equal((await post(env,'/api/maker/comments/remove',body,{...outsider,origin,'content-type':'application/json'})).status,403);
  assert.equal((await post(env,'/api/maker/comments/restore',body,anonymousJSON)).status,401);
  assert.equal((await post(env,'/api/maker/comments/restore',body,{...outsider,...anonymousJSON})).status,403);
  assert.equal((await post(env,'/api/maker/comments/remove',body,{...jsonHeaders,origin:'https://example.com'})).status,403);
  good(await post(env,'/api/maker/comments/remove',body));
  assert.equal((await (await call(env,'/api/comments?iteration=1&slot=1&removed=1')).json()).comments.length,0);
  const removed=await (await call(env,'/api/comments?iteration=1&slot=1&removed=1',{headers:owner})).json();
  assert.equal(removed.canRemove,true);assert.equal(removed.comments[0].removed,true);
  good(await post(env,'/api/maker/comments/restore',body));
  const after=await (await call(env,'/api/comments?iteration=1&slot=1')).json();assert.deepEqual(after,before);
  assert.equal((await post(env,'/api/maker/comments/remove',{...body,id:'../board.json'})).status,400);
  assert.equal((await post(env,'/api/maker/comments/remove',{...body,slot:2})).status,404);
});

await test('single iteration hides navigation; multiple iterations show it; individual reviews place details beside the player', async()=>{
  const html=await (await call(fresh(),'/')).text();
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes=new Map();
  const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',dataset:{},setAttribute(){},closest:()=>node('nav'),querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}},style:{}});return nodes.get(key)};
  const context=vm.createContext({URL,window:{},location:{href:origin},history:{replaceState(){}},document:{querySelector:node,addEventListener(){}},fetch:async()=>({json:async()=>({iterations:[]})})});
  new vm.Script(script).runInContext(context);
  vm.runInContext("board={iterations:[{number:1,title:'Iteration 1',items:[]}]};activeIteration=1;render()",context);
  assert.equal(node('nav').hidden,true);assert.equal(node('#pages').innerHTML,'');
  vm.runInContext("board.iterations.push({number:2,title:'Iteration 2',items:[]});render()",context);
  assert.equal(node('nav').hidden,false);assert.match(node('#pages').innerHTML,/Iteration 2/);
  assert.doesNotMatch(html,/detail-meta|show-removed|Show removed comments|Restore comment/);assert.match(html,/\.form\{[^}]*width:33\.333%/);assert.match(html,/class="player"[\s\S]*class="detail"[\s\S]*Notes &amp; comments/);
  assert.match(html,/\.review\{[^}]*display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(340px,400px\)/);
});

async function audioUpload(env,slot=1) {
  const bytes=new Uint8Array(128),view=new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'),0);view.setUint32(4,120,true);
  bytes.set(new TextEncoder().encode('WAVEfmt '),8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);bytes.set(new TextEncoder().encode('data'),36);view.setUint32(40,84,true);
  const r=await call(env,'/api/maker/jingles/media?iteration=1&slot='+slot,{method:'POST',headers:{origin,'content-type':'audio/wav'},body:bytes});good(r);return r.json();
}
await test('all visitors can open the jingle uploader while invalid and cross-origin uploads are rejected',async()=>{
  const env=fresh(),publicHTML=await (await call(env,'/')).text();
  assert.match(publicHTML,/<h1>Intro Review<\/h1>/);assert.match(publicHTML,/>Logo animation<\/button>/);assert.match(publicHTML,/>Jingle<\/button>/);
  const redirect=await call(env,'/jingles');assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'/jingles/');
  for(const headers of [{},outsider]){
    const page=await call(env,'/jingles/',{headers});good(page);const html=await page.text();assert.match(html,/Jingle uploader/);new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
    good(await call(env,'/api/maker/jingles/drafts',{headers}));
  }
  assert.equal((await call(env,'/api/maker/jingles/media?iteration=1&slot=1',{method:'POST',headers:{...outsider,origin},body:'bad'})).status,400);
  assert.equal((await call(env,'/api/maker/jingles/media?iteration=1&slot=1',{method:'POST',headers:{origin:'https://other.example'},body:'bad'})).status,403);
  const invalid=await call(env,'/api/maker/jingles/media?iteration=1&slot=1',{method:'POST',headers:{origin,'content-type':'audio/mpeg'},body:'<html>not audio</html>'});assert.equal(invalid.status,400);
  assert.equal(env.BUCKET.objects.size,0);
});
await test('anonymous audio drafts support 2/4/8 slots, preview and explicit publication with revision protection',async()=>{
  const env=fresh(),uploaded=await audioUpload(env),item={slot:1,title:'Jingle 1',key:uploaded.key,filename:'private-filename.wav'};
  let revision=null;
  for(const count of [2,4,8]){
    const result=await put(env,'/api/maker/jingles/drafts',{jingles:{iterations:[{number:1,title:'Iteration 1',count,items:[item]}]},revision},anonymousJSON);good(result);revision=(await result.json()).revision;
  }
  assert.equal((await put(env,'/api/maker/jingles/drafts',{jingles:{iterations:[]},revision:null},anonymousJSON)).status,409);
  assert.equal((await put(env,'/api/maker/jingles/drafts',{jingles:{iterations:[{number:1,title:'Iteration 1',count:3,items:[item]}]},revision},anonymousJSON)).status,400);
  const publicURL='/api/audio/'+uploaded.key.slice('jingles/'.length);
  assert.equal((await call(env,publicURL)).status,404);
  good(await call(env,'/api/maker/jingles/preview?key='+encodeURIComponent(uploaded.key)));
  good(await call(env,'/api/maker/jingles/preview?key='+encodeURIComponent(uploaded.key),{headers:owner}));
  assert.equal((await post(env,'/api/maker/jingles/publish',{iteration:{number:2,title:'Iteration 2',count:2,items:[item]}})).status,400);
  const iteration={number:1,title:'Iteration 1',count:8,items:[item]};
  assert.deepEqual((await (await call(env,'/api/jingles/board')).json()).iterations,[]);
  good(await post(env,'/api/maker/jingles/publish',{iteration},anonymousJSON));
  const board=await (await call(env,'/api/jingles/board')).json();assert.equal(board.iterations[0].items.length,1);assert.doesNotMatch(JSON.stringify(board),/private-filename|filename|"key"/);
  const media=await call(env,board.iterations[0].items[0].url,{headers:{range:'bytes=0-9'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,10);assert.equal(media.headers.get('content-type'),'audio/wav');
  assert.deepEqual((await (await call(env,'/api/board')).json()).iterations,[]);
});
await test('jingle and logo comments are independent and persist when audio is replaced',async()=>{
  const env=fresh();const first=await audioUpload(env);
  const iteration={number:1,title:'Iteration 1',count:2,items:[{slot:1,title:'Jingle 1',key:first.key}]};
  good(await post(env,'/api/maker/jingles/publish',{iteration}));
  good(await post(env,'/api/comments',{kind:'jingle',iteration:1,slot:1,name:'Audio client',message:'Jingle feedback'},{'content-type':'application/json'}));
  good(await post(env,'/api/comments',{iteration:1,slot:1,name:'Logo client',message:'Logo feedback'},{'content-type':'application/json'}));
  const audioComments=await (await call(env,'/api/comments?kind=jingle&iteration=1&slot=1')).json();assert.equal(audioComments.comments.length,1);assert.equal(audioComments.comments[0].message,'Jingle feedback');
  const second=await audioUpload(env);iteration.items[0].key=second.key;good(await post(env,'/api/maker/jingles/publish',{iteration}));
  assert.deepEqual(await (await call(env,'/api/comments?kind=jingle&iteration=1&slot=1')).json(),audioComments);
  good(await post(env,'/api/maker/comments/remove',{kind:'jingle',iteration:1,slot:1,id:audioComments.comments[0].id}));
  assert.equal((await (await call(env,'/api/comments?kind=jingle&iteration=1&slot=1')).json()).comments.length,0);
  const logo=await (await call(env,'/api/comments?iteration=1&slot=1')).json();assert.equal(logo.comments.length,1);assert.equal(logo.comments[0].message,'Logo feedback');
});

await test('thumb feedback is validated and stored with logo and jingle comments',async()=>{
  const env=fresh();
  for(const kind of ['logo','jingle']){
    for(const reaction of ['up','down']){
      const response=await post(env,'/api/comments',{kind,iteration:1,slot:1,name:'Reviewer',message:'The reason for my response.',reaction},{'content-type':'application/json'});assert.equal(response.status,201);assert.equal((await response.json()).comment.reaction,reaction);
    }
    const list=await (await call(env,'/api/comments?kind='+kind+'&iteration=1&slot=1')).json();assert.deepEqual(list.comments.map(c=>c.reaction).sort(),['down','up']);
  }
  for(const reaction of ['sideways',false,{},['up']]){
    assert.equal((await post(env,'/api/comments',{iteration:1,slot:1,name:'Reviewer',message:'Bad response',reaction},{'content-type':'application/json'})).status,400);
  }
  const legacy=await post(env,'/api/comments',{iteration:1,slot:2,name:'Reviewer',message:'A normal comment.'},{'content-type':'application/json'});assert.equal(legacy.status,201);assert.equal('reaction' in (await legacy.json()).comment,false);
});
await test('anonymous rating-only feedback persists for all choices and individual review URLs load',async()=>{
 const env=fresh();
 for(const kind of ['logo','jingle'])for(const reaction of ['up','down','chosen']){
 const response=await post(env,'/api/comments',{kind,iteration:2,slot:3,reaction},{'content-type':'application/json'});assert.equal(response.status,201);assert.equal((await response.json()).comment.reaction,reaction);
 }
 const saved=await (await call(env,'/api/comments?iteration=2&slot=3')).json();assert.equal(saved.comments.length,3);assert.deepEqual(saved.comments.map(c=>c.reaction).sort(),['chosen','down','up']);
 assert.equal((await post(env,'/api/comments',{iteration:2,slot:3},{'content-type':'application/json'})).status,400);
 for(const path of ['/intro/2/3','/jingle/2/3']){const response=await call(env,path);assert.equal(response.status,200);const html=await response.text();assert.match(html,/Submit Feedback/);assert.doesNotMatch(html,/name="name"/);assert.match(html,/This Is The One/);}
});

await test('gallery lifecycle synchronizes restart after details and tab visibility, and stops on navigation',async()=>{
  const script=await readFile(new URL('../review/app.js',import.meta.url),'utf8'),nodes=new Map(),listeners={};
  const previews=Array.from({length:8},()=>({paused:true,pause(){this.paused=true}}));
  let starts=0,stops=0,destroys=0;
  const createGalleryPlayback=()=>({start(){starts++;previews.forEach(v=>v.paused=false)},stop(){stops++;previews.forEach(v=>v.pause())},destroy(){destroys++;previews.forEach(v=>v.pause())}});
  const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',value:'',dataset:{},setAttribute(){},removeAttribute(){},load(){},close(){},pause(){},closest:()=>node('nav'),querySelectorAll:selector=>key==='#grid'&&selector==='video'?previews:[],classList:{add(){},remove(){},toggle(){}},style:{}});return nodes.get(key)};
  const document={hidden:false,querySelector:node,querySelectorAll:()=>previews,addEventListener(name,fn){listeners[name]=fn},body:{style:{}}};
  const context=vm.createContext({URL,location:{href:origin,pathname:'/'},history:{replaceState(){},pushState(){}},window:{matchMedia:()=>({matches:false})},document,createGalleryPlayback,fetch:async path=>({ok:true,json:async()=>path.includes('comments')?{comments:[]}:{iterations:[]}})});
  new vm.Script(script).runInContext(context);await new Promise(setImmediate);
  vm.runInContext("board={iterations:[{number:1,items:[{slot:1,title:'Intro 1',url:'/video.mov'}]}]};activeIteration=1;render()",context);
  assert.equal(previews.every(v=>!v.paused),true);
  await vm.runInContext('openItem(1)',context);assert.equal(previews.every(v=>v.paused),true);
  const before=starts;listeners.visibilitychange();assert.equal(starts,before);
  vm.runInContext('close()',context);assert.equal(starts,before+1);assert.equal(previews.every(v=>!v.paused),true);
  document.hidden=true;listeners.visibilitychange();assert.equal(previews.every(v=>v.paused),true);
  document.hidden=false;listeners.visibilitychange();assert.equal(starts,before+2);
  vm.runInContext("setKind('jingle')",context);await new Promise(setImmediate);assert.equal(previews.every(v=>v.paused),true);
  const jingleStarts=starts;listeners.visibilitychange();assert.equal(starts,jingleStarts);
  assert.ok(stops>0);assert.ok(destroys>0);
});

await test('visitors can remove only feedback covered by their private receipt; public lists reveal no receipts',async()=>{
 const env=fresh();
 for(const kind of ['logo','jingle']){
 const first=await (await post(env,'/api/comments',{kind,iteration:1,slot:1,reaction:'up'},{'content-type':'application/json'})).json();
 const other=await (await post(env,'/api/comments',{kind,iteration:1,slot:1,reaction:'down',message:'My feedback'},{'content-type':'application/json'})).json();
 const list=await (await call(env,'/api/comments?kind='+kind+'&iteration=1&slot=1')).json();assert.equal(list.comments.length,2);assert.equal(JSON.stringify(list).includes(first.token),false);assert.equal(JSON.stringify(list).includes('removalHash'),false);
 const headers={'content-type':'application/json',origin};
 const input={kind,iteration:1,slot:1,id:first.id,token:other.token};
 assert.equal((await post(env,'/api/comments/remove',input,headers)).status,403);
 input.token=first.token;assert.equal((await post(env,'/api/comments/remove',input,headers)).status,200);
 const remaining=await (await call(env,'/api/comments?kind='+kind+'&iteration=1&slot=1')).json();assert.equal(remaining.comments.length,1);assert.equal(remaining.comments[0].id,other.id);
 assert.equal((await post(env,'/api/comments/remove',{...input,id:other.id,token:other.token},{'content-type':'application/json',origin:'https://other.example'})).status,403);
 }
});

await test('anonymous visitors upload large recordings as exact-length streams while legacy uploads stay bounded',async()=>{
  const env=fresh(),body=new Uint8Array(25*1024*1024),path='/api/maker/media?iteration=1&slot=1';
  let streamed=false;const originalPut=env.BUCKET.put.bind(env.BUCKET);
  env.BUCKET.put=async(key,value,options)=>{streamed=value instanceof ReadableStream;return originalPut(key,value,options)};
  const response=await call(env,path,{method:'POST',headers:{origin,'content-type':'video/mp4','x-upload-size':String(body.byteLength),'content-length':String(body.byteLength)},body});
  assert.equal(response.status,200);assert.equal(streamed,true);
  const saved=await response.json();assert.equal((await env.BUCKET.head(saved.key)).size,body.byteLength);
  assert.equal((await call(env,saved.url)).status,404,'Unpublished uploads must stay private');
  const legacy=await call(fresh(),path,{method:'POST',headers:{...owner,origin,'content-type':'video/mp4','content-length':String(body.byteLength)},body});
  assert.equal(legacy.status,413);
});

await test('streaming uploads reject invalid sizes and cross-origin requests without storing media',async()=>{
  const path='/api/maker/media?iteration=1&slot=1',body=new Uint8Array(32),headers={...owner,origin,'content-type':'video/mp4','x-upload-size':'32'};
  for(const [overrides,status] of [
    [{'x-upload-size':'96000001'},413],
    [{'x-upload-size':'0'},400],
    [{'x-upload-size':'15'},400],
    [{'x-upload-size':'32.5'},400],
    [{'x-upload-size':'32oops'},400],
    [{'x-upload-size':''},400],
    [{'content-length':'31'},400],
    [{origin:'https://other.example'},403],
  ]){
    const env=fresh(),response=await call(env,path,{method:'POST',headers:{...headers,...overrides},body});
    assert.equal(response.status,status,JSON.stringify(overrides));assert.equal(env.BUCKET.objects.size,0);
  }
});

await test('incomplete or interrupted streamed recordings cannot leave partially stored media',async()=>{
  const path='/api/maker/media?iteration=1&slot=1',headers={...owner,origin,'content-type':'video/webm','x-upload-size':'32'};
  for(const length of [16,64]){
    const env=fresh(),response=await call(env,path,{method:'POST',headers,body:new Uint8Array(length)});
    assert.equal(response.status,400);assert.equal(env.BUCKET.objects.size,0);
  }
  const env=fresh();
  env.BUCKET.put=async(key)=>{env.BUCKET.objects.set(key,{partial:true});throw new Error('R2 stopped reading')};
  let cancelled=false;
  const source=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(16))},cancel(){cancelled=true}});
  const response=await call(env,path,{method:'POST',headers,body:source,duplex:'half'});
  assert.equal(response.status,400);assert.equal(cancelled,true);assert.equal(env.BUCKET.objects.size,0);
});

await test('Edit follows the selected review type on gallery, detail routes and history navigation', async () => {
  const script = await readFile(new URL('../review/app.js', import.meta.url), 'utf8');
  for (const [path, expected] of [['/', '/maker/'], ['/?section=jingle', '/jingles/'], ['/jingle/1/1', '/jingles/'], ['/intro/1/1?section=jingle', '/maker/']]) {
    const nodes = new Map();
    const node = key => {
      if (!nodes.has(key)) nodes.set(key, { innerHTML: '', value: '', dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute() {}, load() {}, close() {}, pause() {}, closest: () => node('nav'), querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} }, style: {} });
      return nodes.get(key);
    };
    const initial = new URL(path, origin), location = { href: initial.href, pathname: initial.pathname };
    const move = value => { const url = new URL(value, location.href); location.href = url.href; location.pathname = url.pathname; };
    const context = vm.createContext({ URL, location, history: { replaceState(_a, _b, url) { move(url); }, pushState(_a, _b, url) { move(url); } }, window: {}, document: { querySelector: node, querySelectorAll: () => [], addEventListener() {}, body: { style: {} } }, createGalleryPlayback: () => ({ start() {}, stop() {}, destroy() {} }), fetch: async () => ({ ok: true, json: async () => ({ iterations: [] }) }) });
    new vm.Script(script).runInContext(context);
    await new Promise(setImmediate);
    const links = ['#edit-workspace', '#edit-detail-workspace'];
    for (const id of links) assert.equal(node(id).attributes.href, expected, path + ' ' + id);
    vm.runInContext("setKind('jingle')", context);
    for (const id of links) assert.equal(node(id).attributes.href, '/jingles/');
    vm.runInContext("setKind('logo')", context);
    for (const id of links) assert.equal(node(id).attributes.href, '/maker/');
    move('/jingle/2/3'); vm.runInContext('window.onpopstate()', context);
    for (const id of links) assert.equal(node(id).attributes.href, '/jingles/');
    await new Promise(setImmediate);
  }
});

// Run the browser's save coordinator against the actual Worker and its atomic
// storage checks, with two independent anonymous editors sharing one record.
async function sharedEditorResource(env, path, key) {
  const helper = await readFile(new URL('../maker/shared-saves.js', import.meta.url), 'utf8');
  const context = vm.createContext({ window: {} });
  new vm.Script(helper).runInContext(context);
  return new context.window.LOM_SHARED.Resource(path, key, {
    async request(requestPath, options = {}) {
      const response = await call(env, requestPath, {
        ...options,
        headers: { origin, ...options.headers },
      });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || 'Save failed'), { status: response.status });
      return result;
    },
  });
}
const localCopy = value => JSON.parse(JSON.stringify(value));

await test('two anonymous editors can save settings and distinct presets without losing remote additions', async () => {
  const env = fresh(), path = '/api/maker/library';
  const initial = { logos: [], fonts: [], presets: [], last: { company: 'Original' } };
  good(await put(env, path, { library: initial, revision: null }, anonymousJSON));
  const first = await sharedEditorResource(env, path, 'library');
  const second = await sharedEditorResource(env, path, 'library');
  const firstView = await first.load(), secondView = await second.load();
  firstView.last.company = 'First editor';
  firstView.presets.push({ name: 'First editor preset', state: { company: 'First editor' } });
  await first.save(firstView);
  secondView.last.company = 'SK';
  secondView.presets.push({ name: 'SK preset', state: { company: 'SK' } });
  await second.save(secondView);
  let saved = (await (await call(env, path)).json()).library;
  assert.deepEqual(saved.presets.map(preset => preset.name).sort(), ['First editor preset', 'SK preset']);
  assert.equal(saved.last.company, 'SK');
  // The second editor's UI still has its own local snapshot. Another save from
  // that snapshot must not interpret the unseen first preset as a deletion.
  secondView.last.company = 'SK continued';
  secondView.presets.push({ name: 'SK second preset', state: { company: 'SK continued' } });
  await second.save(secondView);
  saved = (await (await call(env, path)).json()).library;
  assert.deepEqual(saved.presets.map(preset => preset.name).sort(), ['First editor preset', 'SK preset', 'SK second preset']);
  assert.equal(saved.last.company, 'SK continued');
  assert.equal(first.error, null); assert.equal(second.error, null);
});

for (const kind of ['drafts', 'jingles']) {
  await test(`two anonymous ${kind} editors merge independent slots and recover after a real same-slot conflict`, async () => {
    const env = fresh(), path = kind === 'drafts' ? '/api/maker/drafts' : '/api/maker/jingles/drafts';
    const item = (slot, title) => kind === 'drafts'
      ? { slot, title, state: { company: title } }
      : { slot, title, key: `jingles/iteration-1/jingle-${slot}-00000000-0000-4000-8000-00000000000${slot}.mp3` };
    const initial = { iterations: [{ number: 1, title: 'Iteration 1', count: 4, items: [item(1, 'Original')] }] };
    good(await put(env, path, { [kind]: initial, revision: null }, anonymousJSON));
    const first = await sharedEditorResource(env, path, kind);
    const second = await sharedEditorResource(env, path, kind);
    const firstView = await first.load(), secondView = await second.load();
    firstView.iterations[0].items.push(item(2, 'First editor slot'));
    await first.save(firstView);
    secondView.iterations[0].items.push(item(3, 'SK slot'));
    await second.save(secondView);
    let saved = (await (await call(env, path)).json())[kind];
    assert.deepEqual(saved.iterations[0].items.map(entry => entry.slot).sort(), [1, 2, 3]);
    secondView.iterations[0].items.push(item(4, 'SK next slot'));
    await second.save(secondView);
    saved = (await (await call(env, path)).json())[kind];
    assert.deepEqual(saved.iterations[0].items.map(entry => entry.slot).sort(), [1, 2, 3, 4]);

    const third = await sharedEditorResource(env, path, kind);
    const fourth = await sharedEditorResource(env, path, kind);
    const thirdView = await third.load(), fourthView = await fourth.load();
    const fourthBase = localCopy(fourthView);
    thirdView.iterations[0].items[0] = item(1, 'First editor changed slot');
    await third.save(thirdView);
    fourthView.iterations[0].items[0] = item(1, 'SK unsaved slot');
    await assert.rejects(fourth.save(fourthView), error => error.conflict === true);
    saved = (await (await call(env, path)).json())[kind];
    assert.equal(saved.iterations[0].items.find(entry => entry.slot === 1).title, 'First editor changed slot');
    assert.deepEqual(localCopy(fourth.latest), localCopy(fourthView), 'Unsaved work must remain available for retry or backup');
    assert.equal(fourth.pending, 0);

    // Correct the conflicting change while retaining a separate local edit.
    // The coordinator must not stay permanently locked by its previous 409.
    fourthBase.iterations[0].title = 'SK renamed the iteration';
    await fourth.save(fourthBase);
    await fourth.flush();
    saved = (await (await call(env, path)).json())[kind];
    assert.equal(saved.iterations[0].title, 'SK renamed the iteration');
    assert.equal(saved.iterations[0].items.find(entry => entry.slot === 1).title, 'First editor changed slot');
    assert.equal(fourth.error, null);
    assert.deepEqual((await (await call(env, kind === 'drafts' ? '/api/board' : '/api/jingles/board')).json()).iterations, [], 'Saving drafts must not publish them');
  });
}

await test('both editor pages load shared save recovery before their save handlers', async () => {
  const env = fresh();
  const makerHTML = await (await call(env, '/maker/')).text();
  assert.ok(makerHTML.indexOf('shared-saves.js') >= 0);
  assert.ok(makerHTML.indexOf('shared-saves.js') < makerHTML.indexOf('hosted.js'));
  const uploaderHTML = await (await call(env, '/jingles/')).text();
  assert.ok(uploaderHTML.indexOf('/maker/shared-saves.js') >= 0);
  assert.ok(uploaderHTML.indexOf('/maker/shared-saves.js') < uploaderHTML.indexOf('new window.LOM_SHARED.Resource'));
  assert.match(uploaderHTML, /id="retry-save"/);
  assert.match(uploaderHTML, /id="backup-drafts"/);
  good(await call(env, '/maker/shared-saves.js'));
});

await test('jingle uploader keeps unsaved changes and recovery controls after a same-slot collision', async () => {
  const env = fresh(), path = '/api/maker/jingles/drafts';
  const makeItem = title => ({ slot: 1, title, key: 'jingles/iteration-1/jingle-1-00000000-0000-4000-8000-000000000001.mp3' });
  const initial = { iterations: [{ number: 1, title: 'Iteration 1', count: 2, items: [makeItem('Original')] }] };
  good(await put(env, path, { jingles: initial, revision: null }, anonymousJSON));
  const html = await (await call(env, '/jingles/')).text();
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean).join('\n');
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', value: '', hidden: false, disabled: false, dataset: {}, files: [], pause() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {} },
    async fetch(requestPath, options = {}) {
      return call(env, requestPath, { ...options, headers: { origin, ...options.headers } });
    },
    Blob, URL, setTimeout,
  });
  const helper = await readFile(new URL('../maker/shared-saves.js', import.meta.url), 'utf8');
  new vm.Script(helper).runInContext(context);
  new vm.Script(inline).runInContext(context);
  for (let step = 0; step < 4; step++) await new Promise(setImmediate);
  assert.equal(node('#controls').disabled, false);
  const remote = await (await call(env, path)).json();
  remote.jingles.iterations[0].items[0] = makeItem('Other editor saved');
  good(await put(env, path, { jingles: remote.jingles, revision: remote.revision }, anonymousJSON));
  await vm.runInContext("action(async()=>{current().items[0].title='SK unsaved change';await save()})", context);
  assert.equal(vm.runInContext('current().items[0].title', context), 'SK unsaved change');
  assert.equal(node('#controls').disabled, false, 'A conflict must not disable all subsequent editing');
  assert.equal(node('#save-recovery').hidden, false);
  assert.equal(node('#retry-save').disabled, false);
  assert.match(node('#status').textContent, /draft changes are still here/i);
  assert.equal((await (await call(env, path)).json()).jingles.iterations[0].items[0].title, 'Other editor saved');
});

await test('private worker mode fails closed without trusted authorization and public feedback is bounded', async () => {
  const env = fresh(); delete env.SHARED_EDITING; delete env.authorizeOwner;
  assert.equal((await call(env, '/api/maker/library', { headers: { 'oai-authenticated-user-id': 'spoof', 'oai-authenticated-user-email': 'owner@example.com' } })).status, 401);
  const response = await call(env, '/api/comments', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(33000) }) });
  assert.equal(response.status, 413);
});
