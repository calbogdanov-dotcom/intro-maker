import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createApp } from '../server/app.mjs';
import { DiskBucket } from '../server/bucket.mjs';

const temporaryRoots = [];
after(async () => {
  await Promise.all(temporaryRoots.map(root => rm(root, { recursive: true, force: true })));
});
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'intro-maker-test-'));
  temporaryRoots.push(root);
  return root;
}

test('disk storage persists data and metadata across instances and supports seeking', async () => {
  const directory = join(await temporaryRoot(), 'data');
  const bucket = new DiskBucket(directory);
  const value = new TextEncoder().encode('0123456789');
  const saved = await bucket.put('media/example.mp4', value, {
    httpMetadata: { contentType: 'video/mp4', cacheControl: 'private, no-store' },
  });
  assert.ok(saved.etag);
  const reopened = new DiskBucket(directory);
  const head = await reopened.head('media/example.mp4');
  assert.equal(head.size, 10);
  assert.equal(head.etag, saved.etag);
  const headers = new Headers();
  head.writeHttpMetadata(headers);
  assert.equal(headers.get('content-type'), 'video/mp4');
  assert.equal(headers.get('cache-control'), 'private, no-store');
  assert.equal(await (await reopened.get('media/example.mp4')).text(), '0123456789');
  const middle = await reopened.get('media/example.mp4', { range: new Headers({ range: 'bytes=2-5' }) });
  assert.equal(await middle.text(), '2345');
  assert.deepEqual(middle.range, { offset: 2, length: 4 });
  assert.equal(await (await reopened.get('media/example.mp4', { range: new Headers({ range: 'bytes=-3' }) })).text(), '789');
  assert.equal(await (await reopened.get('media/example.mp4', { range: new Headers({ range: 'bytes=8-' }) })).text(), '89');
  await reopened.delete('media/example.mp4');
  assert.equal(await bucket.get('media/example.mp4'), null);
});

test('conditional writes reject stale revisions, including simultaneous initial saves', async () => {
  const bucket = new DiskBucket(join(await temporaryRoot(), 'data'));
  const initial = await bucket.put('private/library.json', JSON.stringify({ revision: 1 }), {
    onlyIf: { etagDoesNotMatch: '*' },
  });
  assert.ok(initial);
  assert.equal(await bucket.put('private/library.json', 'wrong', { onlyIf: { etagDoesNotMatch: '*' } }), null);
  const next = await bucket.put('private/library.json', JSON.stringify({ revision: 2 }), {
    onlyIf: { etagMatches: initial.etag },
  });
  assert.ok(next);
  assert.notEqual(next.etag, initial.etag);
  assert.equal(await bucket.put('private/library.json', 'stale', { onlyIf: { etagMatches: initial.etag } }), null);
  assert.deepEqual(await (await bucket.get('private/library.json')).json(), { revision: 2 });
  const saves = await Promise.all([
    bucket.put('published/board.json', 'one', { onlyIf: { etagDoesNotMatch: '*' } }),
    bucket.put('published/board.json', 'two', { onlyIf: { etagDoesNotMatch: '*' } }),
  ]);
  assert.equal(saves.filter(Boolean).length, 1);
});

test('interrupted streamed writes leave previous data intact and no partial object', async () => {
  const bucket = new DiskBucket(join(await temporaryRoot(), 'data'));
  await bucket.put('private/library.json', 'last complete save');
  const interrupted = () => new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('incomplete replacement'));
      controller.error(new Error('Upload interrupted'));
    },
  });
  await assert.rejects(bucket.put('private/library.json', interrupted()));
  assert.equal(await (await bucket.get('private/library.json')).text(), 'last complete save');
  await assert.rejects(bucket.put('media/partial.mp4', interrupted()));
  assert.equal(await bucket.get('media/partial.mp4'), null);
  assert.deepEqual((await bucket.list({ prefix: 'media/' })).objects, []);
});

test('storage listing has stable pagination and keys cannot escape the data directory', async () => {
  const root = await temporaryRoot();
  const bucket = new DiskBucket(join(root, 'data'));
  for (const key of ['comments/c.json', 'comments/a.json', 'comments/b.json', 'private/library.json']) {
    await bucket.put(key, key);
  }
  const first = await bucket.list({ prefix: 'comments/', limit: 2 });
  assert.deepEqual(first.objects.map(object => object.key), ['comments/a.json', 'comments/b.json']);
  assert.equal(first.truncated, true);
  assert.ok(first.cursor);
  const second = await bucket.list({ prefix: 'comments/', limit: 2, cursor: first.cursor });
  assert.deepEqual(second.objects.map(object => object.key), ['comments/c.json']);
  assert.equal(second.truncated, false);
  await writeFile(join(root, 'secret'), 'outside storage');
  let outside;
  try { outside = await bucket.get('../secret'); } catch { outside = null; }
  assert.equal(outside, null);
  try { await bucket.put('../escape', 'must stay inside'); } catch { /* Rejecting unsafe keys is valid. */ }
  await assert.rejects(stat(join(root, 'escape')), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'secret'), 'utf8'), 'outside storage');
});

const configuredOrigin = 'http://localhost:8787';
const configuredHost = 'localhost:8787';
const password = 'test-password-strong-123456';
const worker = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const status = env.authorizeOwner(request);
    if (path.startsWith('/api/maker/')) {
      return Response.json({ owner: status === 200 }, { status });
    }
    if (path === '/api/comments' && request.method === 'POST') {
      const value = await request.text();
      return Response.json({ length: value.length });
    }
    return Response.json({
      owner: status === 200,
      identityHeaders: [...request.headers.keys()].filter(name => name.startsWith('oai-')),
      forwardedHost: request.headers.get('x-forwarded-host'),
    });
  },
};

async function runningApp(selectedWorker = worker, options = {}) {
  const server = createApp({ worker: selectedWorker, dataDir: join(await temporaryRoot(), 'data'), password, username: 'owner', origin: configuredOrigin, ...options });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return {
    server,
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
    request(path, { method = 'GET', headers = {}, body, chunked = false } = {}) {
      return new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port, path, method, headers: { host: configuredHost, ...headers } }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            const bytes = Buffer.concat(chunks);
            resolve({ status: response.statusCode, headers: response.headers, text: bytes.toString('utf8'), bytes });
          });
        });
        request.on('error', reject);
        if (chunked) { request.write(body); request.end(); }
        else request.end(body);
      });
    },
  };
}

async function logIn(app, overrides = {}) {
  return app.request('/login', {
    method: 'POST',
    headers: { origin: configuredOrigin, 'content-type': 'application/x-www-form-urlencoded', ...overrides.headers },
    body: new URLSearchParams({ username: 'owner', password, ...overrides.credentials }).toString(),
  });
}

test('owner login protects APIs, ignores spoofed identity, and rejects tampered sessions', async t => {
  const app = await runningApp();
  t.after(() => app.close());
  const loginPage = await app.request('/login');
  assert.equal(loginPage.status, 200);
  assert.equal(loginPage.text.includes(password), false);
  assert.equal((await app.request('/api/maker/guard')).status, 401);
  const spoofed = await app.request('/api/maker/guard', {
    headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.com' },
  });
  assert.equal(spoofed.status, 401);
  const inspect = await app.request('/', { headers: { 'oai-authenticated-user-id': 'owner', 'oai-custom': 'forged' } });
  assert.deepEqual(JSON.parse(inspect.text).identityHeaders, []);
  const denied = await logIn(app, { credentials: { password: 'incorrect' } });
  assert.ok([400, 401, 403].includes(denied.status));
  assert.equal(denied.headers['set-cookie'], undefined);
  const result = await logIn(app);
  assert.ok([302, 303].includes(result.status));
  const setCookie = result.headers['set-cookie']?.find(value => value.startsWith('intro_maker_session='));
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);
  const cookie = setCookie.split(';')[0];
  assert.equal((await app.request('/api/maker/guard', { headers: { cookie } })).status, 200);
  const tampered = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a');
  assert.equal((await app.request('/api/maker/guard', { headers: { cookie: tampered } })).status, 401);
  assert.equal((await app.request('/api/maker/guard', { headers: { cookie: 'intro_maker_session=bad' } })).status, 401);
});

test('host and origin checks cannot be bypassed using proxy headers', async t => {
  const app = await runningApp();
  t.after(() => app.close());
  assert.equal((await app.request('/', { headers: { host: 'evil.example', 'x-forwarded-host': configuredHost } })).status, 421);
  const crossOrigin = await logIn(app, { headers: { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' } });
  assert.equal(crossOrigin.status, 403);
  const noOrigin = await app.request('/login', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'owner', password }).toString(),
  });
  assert.equal(noOrigin.status, 403);
  const login = await logIn(app);
  const cookie = login.headers['set-cookie'].find(value => value.startsWith('intro_maker_session=')).split(';')[0];
  assert.equal((await app.request('/api/maker/guard', { method: 'POST', headers: { cookie, origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await app.request('/logout', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } })).status, 403);
  const logout = await app.request('/logout', { method: 'POST', headers: { cookie, origin: configuredOrigin } });
  assert.ok([302, 303].includes(logout.status));
  assert.ok(logout.headers['set-cookie'].some(value => /intro_maker_session=.*Max-Age=0/i.test(value)));
});

test('server fails closed when owner credentials are missing or weak', async () => {
  const root = await temporaryRoot();
  for (const invalid of [undefined, '', 'short']) {
    assert.throws(() => createApp({ worker, dataDir: root, password: invalid, origin: configuredOrigin }));
  }
});

test('sign-in return paths preserve the uploader and cannot redirect to another site', async t => {
  const app = await runningApp();
  t.after(() => app.close());
  const uploaderLogin = await app.request('/login?return_to=%2Fjingles%2F');
  assert.equal(uploaderLogin.status, 200);
  assert.match(uploaderLogin.text, /name=["']return_to["'][^>]*value=["']\/jingles\//);
  const uploader = await logIn(app, { credentials: { return_to: '/jingles/' } });
  assert.equal(uploader.headers.location, '/jingles/');
  for (const return_to of ['https://evil.example', '//evil.example', '/api/maker/library', '/maker/?next=evil']) {
    const response = await logIn(app, { credentials: { return_to } });
    assert.equal(response.headers.location, '/maker/');
  }
});

test('public comment body limits apply to declared and chunked uploads', async t => {
  const app = await runningApp();
  t.after(() => app.close());
  const body = 'x'.repeat(32 * 1024 + 1);
  const headers = { origin: configuredOrigin, 'content-type': 'application/json' };
  const declared = await app.request('/api/comments', { method: 'POST', headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) }, body });
  assert.equal(declared.status, 413);
  const chunked = await app.request('/api/comments', { method: 'POST', headers, body, chunked: true });
  assert.equal(chunked.status, 413);
});

test('real application keeps uploads private until publication and serves video and jingle byte ranges', async t => {
  const { default: builtWorker } = await import('../dist/server/index.js');
  const app = await runningApp(builtWorker);
  t.after(() => app.close());
  assert.ok([302, 303].includes((await app.request('/maker/')).status));
  assert.equal((await app.request('/api/maker/library')).status, 401);
  assert.equal((await app.request('/maker/app.js', { headers: { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'owner@example.com' } })).status, 401);
  const login = await logIn(app);
  const cookie = login.headers['set-cookie'].find(value => value.startsWith('intro_maker_session=')).split(';')[0];
  const headers = { cookie, origin: configuredOrigin };
  const maker = await app.request('/maker/', { headers: { cookie } });
  assert.equal(maker.status, 200);
  const librarySave = await app.request('/api/maker/library', {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ library: { logos: [], fonts: [], presets: [{ name: 'Private preset', state: { company: 'Hidden company' } }], last: null }, revision: null }),
  });
  assert.equal(librarySave.status, 200);
  const publicPage = await app.request('/');
  assert.equal(publicPage.status, 200);
  assert.doesNotMatch(publicPage.text, /Hidden company|Private preset|href=["'][^"']*\/maker\//);
  const videoBytes = Buffer.alloc(128);
  videoBytes.set([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const upload = await app.request('/api/maker/media?iteration=1&slot=1', {
    method: 'POST', headers: { ...headers, 'content-type': 'video/mp4', 'x-upload-size': String(videoBytes.length), 'content-length': String(videoBytes.length) }, body: videoBytes,
  });
  assert.equal(upload.status, 200, upload.text);
  const video = JSON.parse(upload.text);
  assert.equal((await app.request(video.url)).status, 404);
  const publish = await app.request('/api/maker/publish', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ iteration: { number: 1, title: 'Iteration 1', items: [{ slot: 1, title: 'Example intro', key: video.key }] } }),
  });
  assert.equal(publish.status, 200, publish.text);
  const range = await app.request(video.url, { headers: { range: 'bytes=4-7' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers['content-range'], 'bytes 4-7/128');
  assert.deepEqual(range.bytes, videoBytes.subarray(4, 8));
  const audioBytes = Buffer.alloc(128);
  audioBytes.write('RIFF', 0); audioBytes.write('WAVEfmt ', 8);
  const audioUpload = await app.request('/api/maker/jingles/media?iteration=1&slot=1', {
    method: 'POST', headers: { ...headers, 'content-type': 'audio/wav', 'content-length': String(audioBytes.length) }, body: audioBytes,
  });
  assert.equal(audioUpload.status, 200, audioUpload.text);
  const audio = JSON.parse(audioUpload.text);
  const audioPath = '/api/audio/' + audio.key.slice('jingles/'.length);
  assert.equal((await app.request(audioPath)).status, 404);
  const audioPublish = await app.request('/api/maker/jingles/publish', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ iteration: { number: 1, title: 'Iteration 1', count: 2, items: [{ slot: 1, title: 'Jingle 1', key: audio.key }] } }),
  });
  assert.equal(audioPublish.status, 200, audioPublish.text);
  const audioRange = await app.request(audioPath, { headers: { range: 'bytes=0-3' } });
  assert.equal(audioRange.status, 206);
  assert.equal(audioRange.headers['content-type'], 'audio/wav');
  assert.equal(audioRange.text, 'RIFF');
  assert.equal(JSON.parse((await app.request('/api/board')).text).iterations[0].items[0].title, 'Example intro');
  assert.equal(JSON.parse((await app.request('/api/jingles/board')).text).iterations[0].items[0].title, 'Jingle 1');
});


test('shared editing opens workspace routes while preserving origin checks and owner-only moderation', async t => {
  const { default: builtWorker } = await import('../dist/server/index.js');
  const app = await runningApp(builtWorker, { sharedEditing: true });
  t.after(() => app.close());
  for (const path of ['/maker/', '/maker/app.js', '/maker/shared-saves.js', '/jingles/', '/api/maker/library']) {
    assert.equal((await app.request(path)).status, 200, path);
  }
  assert.match((await app.request('/')).text, /id="edit-workspace" href="\/maker\/"/);
  const library = { logos: [], fonts: [], presets: [{ name: 'Shared preset', state: { company: 'Shared' } }], last: null };
  const save = await app.request('/api/maker/library', { method: 'PUT', headers: { origin: configuredOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ library, revision: null }) });
  assert.equal(save.status, 200);
  assert.deepEqual(JSON.parse((await app.request('/api/maker/library')).text).library, library);
  const foreign = await app.request('/api/maker/library', { method: 'PUT', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403);
  const moderation = await app.request('/api/maker/comments/remove', { method: 'POST', headers: { origin: configuredOrigin, 'content-type': 'application/json', 'oai-authenticated-user-id': 'spoofed', 'oai-authenticated-user-email': 'owner@example.com' }, body: '{}' });
  assert.equal(moderation.status, 401);
  assert.equal(JSON.parse((await app.request('/api/comments?iteration=1&slot=1')).text).canRemove, false);
  const login = await logIn(app);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal(JSON.parse((await app.request('/api/comments?iteration=1&slot=1', { headers: { cookie } })).text).canRemove, true);
});
