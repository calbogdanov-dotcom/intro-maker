import './streams.mjs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DiskBucket } from './bucket.mjs';

const DAY = 24 * 60 * 60;
const privatePath = pathname => pathname === '/maker' || pathname.startsWith('/maker/') || pathname === '/jingles' || pathname.startsWith('/jingles/') || pathname === '/api/maker' || pathname.startsWith('/api/maker/');
const returnPath = value => value === '/jingles/' ? '/jingles/' : '/maker/';
const requestLimit = pathname => pathname === '/login' ? 8192 : pathname === '/api/comments' || pathname === '/api/comments/remove' ? 32 * 1024 : pathname === '/api/maker/media' ? 96_000_000 : pathname === '/api/maker/jingles/media' ? 40 * 1024 * 1024 : ['/api/maker/library', '/api/maker/drafts', '/api/maker/jingles/drafts'].includes(pathname) ? 16 * 1024 * 1024 : 1024 * 1024;
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(a, b);
const htmlEscape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function formPage(title, body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Intro Maker</title><style>body{margin:0;background:#f4f6f4;color:#17251d;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100svh}main{width:min(360px,calc(100% - 72px));padding:28px;background:white;border:1px solid #dce2dd;border-radius:16px}h1{font-size:25px;margin-top:0}label{display:grid;gap:8px;margin:18px 0}input,button{font:inherit;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #c4cec6;width:100%}button{background:#174e39;color:white;border:0;cursor:pointer}p{line-height:1.5}a{color:#174e39}</style><main><h1>${title}</h1>${body}</main></html>`;
}
function pageResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", ...headers } });
}
function redirect(location, headers = {}) { return new Response(null, { status: 303, headers: { 'cache-control': 'private, no-store', location, ...headers } }); }

export function createApp({ worker, dataDir, password, username = 'owner', origin = 'http://localhost:8787', sharedEditing = false } = {}) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('INTRO_MAKER_PASSWORD must contain at least 12 characters. Run npm run setup.');
  if (typeof username !== 'string' || !username || username.length > 100) throw new Error('Choose an owner username with 1–100 characters.');
  if (!worker || typeof worker.fetch !== 'function') throw new Error('Build the application before starting the server.');
  const site = new URL(origin);
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error('INTRO_MAKER_ORIGIN must be an http(s) origin without a path.');
  if (!dataDir) throw new Error('A private data directory is required.');
  const canonicalOrigin = site.origin, secure = site.protocol === 'https:';
  const cookieName = secure ? '__Host-intro_maker_session' : 'intro_maker_session';
  const secret = scryptSync(password, `intro-maker/session/v1/${username}`, 32);
  const passwordHash = scryptSync(password, 'intro-maker/password/v1', 32);
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  const cookie = (value, maxAge = DAY) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const authorizeOwner = request => {
    const value = (request.headers.get('cookie') || '').split(';').map(piece => piece.trim()).find(piece => piece.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!value || value.length > 512) return 401;
    const parts = value.split('.'); if (parts.length !== 2 || !safeEqual(Buffer.from(sign(parts[0])), Buffer.from(parts[1]))) return 401;
    try { const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); return Number.isSafeInteger(data.exp) && data.exp > Math.floor(Date.now() / 1000) && data.exp <= Math.floor(Date.now() / 1000) + DAY && typeof data.nonce === 'string' ? 200 : 401; } catch { return 401; }
  };
  const bucket = new DiskBucket(dataDir), env = { BUCKET: bucket, authorizeOwner, SIGN_IN_PATH: '/login', SHARED_EDITING: sharedEditing === true }, failures = new Map();
  const loginPage = (error = '', target = '/maker/') => pageResponse(formPage('Owner sign in', `<p>Sign in to create intros and upload jingles.</p>${error ? `<p role="alert">${htmlEscape(error)}</p>` : ''}<form method="post" action="/login"><input type="hidden" name="return_to" value="${returnPath(target)}"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button></form>`), error ? 401 : 200);
  async function handle(request, ip) {
    const url = new URL(request.url), method = request.method;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && request.headers.get('origin') !== canonicalOrigin) return new Response('This action must start from this site.', { status: 403 });
    if (url.pathname === '/login') {
      if (method === 'GET' || method === 'HEAD') return loginPage('', url.searchParams.get('return_to'));
      if (method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
      const now = Date.now(), prior = failures.get(ip);
      if (prior && prior.until > now && prior.count >= 10) return new Response('Too many sign-in attempts. Try again in 15 minutes.', { status: 429, headers: { 'retry-after': '900', 'cache-control': 'no-store' } });
      let bytes = 0, chunks = [];
      for await (const chunk of request.body || []) { bytes += chunk.byteLength; if (bytes > 8192) return new Response('Sign-in form is too large.', { status: 413 }); chunks.push(Buffer.from(chunk)); }
      if (!(request.headers.get('content-type') || '').startsWith('application/x-www-form-urlencoded')) return new Response('Use the sign-in form.', { status: 415 });
      const input = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const candidate = input.get('password') || '', submittedUser = input.get('username') || '';
      const valid = safeEqual(scryptSync(candidate, 'intro-maker/password/v1', 32), passwordHash) && safeEqual(Buffer.from(submittedUser), Buffer.from(username));
      if (!valid) {
        if (failures.size > 1000) for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
        failures.set(ip, { count: prior?.until > now ? prior.count + 1 : 1, until: prior?.until > now ? prior.until : now + 15 * 60 * 1000 });
        return loginPage('The username or password is incorrect.', input.get('return_to'));
      }
      failures.delete(ip);
      const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + DAY, nonce: randomBytes(18).toString('base64url') })).toString('base64url');
      return redirect(returnPath(input.get('return_to')), { 'set-cookie': cookie(payload + '.' + sign(payload)) });
    }
    if (url.pathname === '/logout') {
      if (method === 'GET') return pageResponse(formPage('Sign out', '<form method="post" action="/logout"><p>Sign out of your owner workspace on this browser.</p><button>Sign out</button></form>'));
      if (method === 'POST') return redirect('/login', { 'set-cookie': cookie('', 0) });
      return new Response('Method not allowed', { status: 405 });
    }
    // Gate every private path before dispatch as well as inside the Worker.
    if (!sharedEditing && privatePath(url.pathname) && authorizeOwner(request) !== 200) {
      if (['/maker', '/maker/', '/jingles', '/jingles/'].includes(url.pathname) && ['GET', 'HEAD'].includes(method)) return redirect('/login?return_to=' + encodeURIComponent(returnPath(url.pathname.startsWith('/jingles') ? '/jingles/' : '/maker/')));
      return new Response(JSON.stringify({ error: 'Sign in to continue.' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
    }
    return worker.fetch(request, env);
  }
  const server = createServer(async (incoming, outgoing) => {
    let oversized = false;
    try {
      if (incoming.headers.host?.toLowerCase() !== site.host.toLowerCase()) { outgoing.writeHead(421, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); outgoing.end('This host is not configured.'); return; }
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(400); outgoing.end('Invalid request target.'); return; }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (/^(oai-|x-forwarded-|cf-connecting-ip$|forwarded$)/i.test(name) || value == null) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const ip = incoming.socket.remoteAddress || 'unknown'; headers.set('cf-connecting-ip', ip);
      const method = incoming.method || 'GET';
      const limit = requestLimit(new URL(canonicalOrigin + incoming.url).pathname);
      if (Number(incoming.headers['content-length'] || 0) > limit) { outgoing.writeHead(413, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); outgoing.end('This request is too large.'); incoming.resume(); return; }
      let size = 0;
      const body = !['GET', 'HEAD'].includes(method) ? Readable.toWeb(incoming).pipeThrough(new TransformStream({
        transform(chunk, controller) { size += chunk.byteLength; if (size > limit) { oversized = true; throw Object.assign(new Error('This request is too large.'), { status: 413 }); } controller.enqueue(chunk); },
      })) : null;
      const request = new Request(canonicalOrigin + incoming.url, { method, headers, ...(body ? { body, duplex: 'half' } : {}) });
      let response = await handle(request, ip);
      if (oversized) response = new Response('This request is too large.', { status: 413, headers: { 'cache-control': 'no-store' } });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (method === 'HEAD' || !response.body) { await response.body?.cancel(); outgoing.end(); }
      else await pipeline(Readable.fromWeb(response.body), outgoing);
    } catch (error) {
      if (!outgoing.headersSent) { outgoing.writeHead(oversized ? 413 : 500, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); outgoing.end(oversized ? 'This request is too large.' : 'Could not complete this action.'); }
      else outgoing.destroy();
      // Never print request headers, body, passwords, or session cookies.
      if (!oversized) console.error('Request failed:', error.name || 'Error');
    }
  });
  server.requestTimeout = 5 * 60 * 1000; server.headersTimeout = 60 * 1000;
  return server;
}
