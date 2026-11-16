import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';

const source = await readFile(new URL('../review/gallery-playback.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(durations) {
  let clock = 0, nextFrame = 0;
  const frames = new Map();
  class Video extends EventTarget {
    constructor(duration) {
      super();
      Object.assign(this, {duration, readyState: 3, paused: true, ended: false, seeking: false, error: null, playCalls: 0, playbackRate: 1, asyncSeek: false});
      this.position = 0;
    }
    get currentTime() { return this.position; }
    set currentTime(value) { this.position = value; this.ended = value >= this.duration; this.seeking = this.asyncSeek; }
    play() { this.playCalls++; if (this.playError) return Promise.reject(this.playError); this.paused = false; this.onPlay?.(); return this.pendingPlay || Promise.resolve(); }
    pause() { this.paused = true; }
    emit(name) { this.dispatchEvent(new Event(name)); }
    ready(value) { this.readyState = value; this.emit(value >= 3 ? 'canplay' : 'waiting'); }
    finishSeek() { this.seeking = false; this.emit('seeked'); }
    fail() { this.error = {code: 4}; this.emit('error'); }
  }
  const videos = durations.map(duration => new Video(duration));
  const context = vm.createContext({performance: {now: () => clock}, requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; }, cancelAnimationFrame(id) { frames.delete(id); }});
  vm.runInContext(source, context);
  return {
    videos,
    create: options => context.createGalleryPlayback(videos, options),
    async advance(seconds) {
      clock += seconds * 1000;
      const pending = [...frames];
      for (const video of videos) {
        if (video.paused) continue;
        video.position = Math.min(video.duration, video.position + seconds * video.playbackRate);
        if (video.position >= video.duration) { video.ended = true; video.paused = true; video.emit('ended'); }
      }
      for (const [id, callback] of pending) if (frames.delete(id)) callback(clock);
      await flush();
    },
    scheduled: () => frames.size,
  };
}

await test('waits for every clip, resets them, and configures muted inline playback', async () => {
  const h = harness([2, 3]), [a, b] = h.videos;
  a.position = 1; b.position = 2; b.readyState = 1;
  const player = h.create(), started = player.start();
  await flush();
  assert.equal(a.playCalls, 0); assert.equal(b.playCalls, 0);
  b.ready(3);
  assert.equal(await started, true);
  assert.equal(a.currentTime, 0); assert.equal(b.currentTime, 0);
  for (const video of h.videos) {
    assert.equal(video.autoplay, false); assert.equal(video.loop, false);
    assert.equal(video.muted, true); assert.equal(video.defaultMuted, true);
    assert.equal(video.playsInline, true); assert.equal(video.preload, 'auto');
  }
  player.destroy();
});

await test('short clips hold their final frame and restart only with the longest', async () => {
  const h = harness([1, 2]), [short, long] = h.videos, player = h.create();
  await player.start();
  await h.advance(1.1);
  assert.equal(short.currentTime, 1); assert.equal(short.paused, true);
  assert.equal(short.playCalls, 1); assert.equal(long.playCalls, 1);
  assert.equal(long.currentTime, 1.1); assert.equal(long.paused, false);
  await h.advance(0.9);
  assert.equal(short.currentTime, 0); assert.equal(long.currentTime, 0);
  assert.equal(short.playCalls, 2); assert.equal(long.playCalls, 2);
  assert.equal(short.playbackRate, 1); assert.equal(long.playbackRate, 1);
  player.destroy();
});

await test('buffering pauses the whole group and freezes its shared clock', async () => {
  const h = harness([2, 3]), [a, b] = h.videos, player = h.create();
  await player.start(); await h.advance(0.4);
  b.ready(2); await flush();
  assert.equal(a.paused, true); assert.equal(b.paused, true);
  await h.advance(5);
  assert.equal(a.currentTime, 0.4); assert.equal(b.currentTime, 0.4);
  b.ready(3); await flush(); await h.advance(0.2);
  assert.ok(Math.abs(a.currentTime - 0.6) < 0.0001);
  assert.ok(Math.abs(b.currentTime - 0.6) < 0.0001);
  player.destroy();
});

await test('corrects substantial playback drift against the shared timeline', async () => {
  const h = harness([2, 3]), [a, b] = h.videos, player = h.create();
  await player.start(); await h.advance(0.4);
  b.position = 0.1;
  await h.advance(0.1);
  assert.ok(Math.abs(a.currentTime - b.currentTime) < 0.0001);
  assert.ok(Math.abs(b.currentTime - 0.5) < 0.0001);
  player.destroy();
});

await test('failed clips cannot block readiness or subsequent group playback', async () => {
  const h = harness([2, 3, NaN]), [a, b, broken] = h.videos, player = h.create();
  const started = player.start(); await flush(); assert.equal(a.playCalls, 0);
  broken.fail(); assert.equal(await started, true);
  await h.advance(0.3); b.fail(); await flush();
  assert.equal(a.paused, false); assert.equal(b.paused, true); assert.equal(broken.paused, true);
  await h.advance(0.2);
  assert.ok(Math.abs(a.currentTime - 0.5) < 0.0001);
  player.destroy();
});

await test('stop cancels pending readiness and destroy removes event-driven restarts', async () => {
  const h = harness([2]), [video] = h.videos, player = h.create();
  video.readyState = 1;
  const started = player.start(); await flush(); player.stop();
  assert.equal(await started, false);
  video.ready(3); await flush(); assert.equal(video.playCalls, 0);
  await player.start(); assert.equal(video.playCalls, 1);
  player.destroy(); video.emit('ended'); video.ready(3); await flush();
  assert.equal(h.scheduled(), 0); assert.equal(video.paused, true);
  assert.equal(await player.start(), false);
});

await test('blocked autoplay pauses every clip and can retry through a user gesture', async () => {
  const h = harness([2, 3]), [a, b] = h.videos;
  const error = Object.assign(new Error('Autoplay blocked'), {name: 'NotAllowedError'});
  b.playError = error;
  const blocked = [], player = h.create({onBlocked: value => blocked.push(value)});
  assert.equal(await player.start(), false);
  assert.equal(blocked.length, 1); assert.equal(blocked[0], error);
  assert.equal(a.paused, true); assert.equal(b.paused, true); assert.equal(h.scheduled(), 0);
  delete b.playError;
  assert.equal(await player.start(), true);
  assert.equal(a.currentTime, 0); assert.equal(b.currentTime, 0);
  player.destroy();
});

await test('awaits seek completion before starting a replacement cycle', async () => {
  const h = harness([2, 3]), [a, b] = h.videos, player = h.create();
  a.position = 1; b.position = 2; a.asyncSeek = true; b.asyncSeek = true;
  const started = player.start(); await flush();
  assert.equal(a.playCalls, 0); assert.equal(b.playCalls, 0);
  a.finishSeek(); await flush(); assert.equal(a.playCalls, 0);
  b.finishSeek(); assert.equal(await started, true);
  player.destroy();
});

await test('late play promise completion cannot revive a stopped group', async () => {
  const h = harness([2]), [video] = h.videos;
  let resolvePlay;
  video.pendingPlay = new Promise(resolve => { resolvePlay = resolve; });
  const player = h.create(), started = player.start(); await flush();
  assert.equal(video.playCalls, 1);
  player.stop(); assert.equal(await started, false);
  resolvePlay(); await flush();
  assert.equal(video.paused, true); assert.equal(h.scheduled(), 0);
  player.destroy();
});

await test('buffering during startup pauses clips whose play promises already resolved', async () => {
  const h = harness([2, 3]), [a, b] = h.videos;
  let resolvePlay;
  b.pendingPlay = new Promise(resolve => { resolvePlay = resolve; });
  b.onPlay = () => b.ready(2);
  const player = h.create(), started = player.start(); await flush();
  assert.equal(a.paused, true); assert.equal(b.paused, true);
  delete b.onPlay; delete b.pendingPlay;
  resolvePlay(); b.ready(3);
  assert.equal(await started, true);
  assert.equal(a.paused, false); assert.equal(b.paused, false);
  player.destroy();
});
