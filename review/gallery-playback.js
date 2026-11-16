/* One clock for the public logo gallery. Each recording keeps its natural speed. */
globalThis.createGalleryPlayback = function createGalleryPlayback(videos, {onBlocked = () => {}} = {}) {
  const media = [...videos], listeners = [], driftLimit = 0.12;
  let active = false, destroyed = false, generation = 0, phase = 'idle';
  let failed = new Set(), frame = null, queued = false, position = 0, startedAt = 0, launch = 0, resolveStart;
  const now = () => performance.now();
  const members = () => media.filter(video => !failed.has(video) && !video.error);
  const duration = () => Math.max(0, ...members().map(video => Number.isFinite(video.duration) ? video.duration : 0));
  const time = () => phase === 'playing' ? position + (now() - startedAt) / 1000 : position;
  const finishStart = result => { const resolve = resolveStart; resolveStart = undefined; resolve?.(result); };
  const cancelFrame = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; };
  const pause = () => media.forEach(video => video.pause());
  function queue() {
    if (queued || !active || destroyed) return;
    queued = true;
    Promise.resolve().then(() => { queued = false; reconcile(); });
  }
  function seek(video, target, tolerance) {
    if (video.seeking || Math.abs(video.currentTime - target) <= tolerance) return;
    try { video.currentTime = target; } catch { failed.add(video); video.pause(); }
  }
  function suspend() {
    if (!active || !['playing', 'starting'].includes(phase)) return;
    position = Math.min(time(), duration());
    launch++;
    phase = 'buffering';
    cancelFrame();
    pause();
    queue();
  }
  function restart() {
    if (!active) return;
    cancelFrame();
    phase = 'resetting';
    position = 0;
    pause();
    queue();
  }
  function scheduleFrame() {
    if (active && phase === 'playing' && frame === null) frame = requestAnimationFrame(tick);
  }
  function tick() {
    frame = null;
    if (!active || phase !== 'playing') return;
    const elapsed = time(), longest = duration();
    if (!longest || elapsed >= longest) { restart(); return; }
    for (const video of members()) {
      if (elapsed >= video.duration) {
        video.pause();
        seek(video, video.duration, driftLimit);
      } else if (!video.ended && video.readyState < 3) {
        suspend();
        return;
      } else if (!video.ended) {
        seek(video, elapsed, driftLimit);
      }
      if (!active || phase !== 'playing') return;
    }
    scheduleFrame();
  }
  async function begin(ready) {
    const run = generation, attempt = ++launch, initialPosition = position, launchTime = now();
    phase = 'starting';
    const results = await Promise.all(ready.map(async video => {
      if (!active || run !== generation || attempt !== launch || initialPosition >= video.duration) return {video};
      try { await video.play(); return {video}; } catch (error) { return {video, error}; }
    }));
    if (!active || destroyed || run !== generation || attempt !== launch || phase !== 'starting') return;
    for (const {video, error} of results) {
      if (error && (video.error || error.name === 'NotSupportedError')) { failed.add(video); video.pause(); }
    }
    const blocked = results.find(({video, error}) => error && !failed.has(video));
    if (blocked) {
      stop();
      try { onBlocked(blocked.error); } catch {}
      return;
    }
    if (!members().length) { stop(); return; }
    position = initialPosition;
    startedAt = launchTime;
    phase = 'playing';
    finishStart(true);
    scheduleFrame();
  }
  function reconcile() {
    if (!active || destroyed || !['resetting', 'buffering'].includes(phase)) return;
    const available = members();
    if (!available.length) { stop(); return; }
    for (const video of available) {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      seek(video, Math.min(position, video.duration), phase === 'resetting' ? 0.001 : driftLimit);
    }
    const ready = members();
    if (!ready.length) { stop(); return; }
    if (ready.some(video => !Number.isFinite(video.duration) || video.duration <= 0 || video.seeking || (position < video.duration && video.readyState < 3))) return;
    begin(ready);
  }
  function listen(video, event, callback) {
    video.addEventListener(event, callback);
    listeners.push(() => video.removeEventListener(event, callback));
  }
  for (const video of media) {
    video.autoplay = false;
    video.loop = false;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.pause();
    for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'seeked', 'durationchange']) listen(video, event, queue);
    listen(video, 'waiting', () => { if (position < video.duration && !video.ended) suspend(); });
    listen(video, 'stalled', () => { if (video.readyState < 3 && !video.ended) suspend(); });
    listen(video, 'ended', () => { if (active && phase === 'playing' && video.duration >= duration() - 0.001) restart(); });
    listen(video, 'error', () => {
      failed.add(video);
      video.pause();
      if (phase === 'playing' || phase === 'starting') suspend();
      queue();
    });
  }
  function stop() {
    active = false;
    generation++;
    phase = 'idle';
    cancelFrame();
    pause();
    finishStart(false);
  }
  function start() {
    stop();
    if (destroyed || !media.length) return Promise.resolve(false);
    failed = new Set(media.filter(video => video.error));
    active = true;
    phase = 'resetting';
    position = 0;
    const result = new Promise(resolve => { resolveStart = resolve; });
    queue();
    return result;
  }
  function destroy() {
    stop();
    destroyed = true;
    listeners.forEach(remove => remove());
  }
  return {start, stop, destroy};
};
