// Companion soundtrack for public intro reviews. Loaded before the review app
// so its audio can stay paired with the video instead of pausing it.
(() => {
  const video = document.querySelector('#large');
  const sheet = document.querySelector('#sheet');
  const videoPlayer = document.querySelector('#video-player');
  const notes = document.querySelector('#feedback-section');
  if (!video || !sheet || !notes || !document.createElement || typeof MutationObserver === 'undefined') return;

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const panel = document.createElement('section');
  panel.id = 'intro-jingle-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'intro-jingle-title');
  panel.innerHTML = '<h3 id="intro-jingle-title">Try a jingle</h3><p class="jingle-hint">Choose a soundtrack for this intro. Changes apply on the next play.</p><div id="intro-jingle-options" role="group" aria-label="Jingle for this intro"></div><div class="jingle-controls"><button type="button" id="intro-jingle-replay">Replay intro</button><button type="button" id="intro-jingle-sound" aria-pressed="true">Sound on</button></div><p id="intro-jingle-status" role="status" aria-live="polite"></p><audio id="intro-jingle-audio" preload="auto"></audio>';
  const columns = document.createElement('div');
  columns.className = 'intro-detail-columns';
  notes.parentNode.insertBefore(columns, notes);
  columns.append(notes, panel);
  const style = document.createElement('style');
  style.textContent = '.intro-detail-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,420px);gap:clamp(28px,5vw,80px);margin-top:24px;align-items:start}.intro-detail-columns>.comments{margin-top:0}.audio-sheet .intro-detail-columns{grid-template-columns:minmax(0,1fr)}#intro-jingle-panel{min-width:0;padding:22px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}#intro-jingle-panel h3{margin:0 0 12px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}#intro-jingle-panel p{font-size:13px;line-height:1.5}#intro-jingle-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:18px 0}#intro-jingle-options button{min-height:48px;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:white;text-align:left;overflow-wrap:anywhere}#intro-jingle-options button[aria-pressed=true]{background:#daf8eb;border-color:#008a61;box-shadow:0 0 0 1px #008a61}.jingle-controls{display:flex;gap:8px;flex-wrap:wrap}.jingle-controls button{min-height:44px;border:1px solid var(--line);border-radius:8px;padding:10px 13px;background:white}#intro-jingle-replay{background:var(--mint);border-color:var(--mint);font-weight:600}#intro-jingle-panel button:focus-visible{outline:3px solid #008a61;outline-offset:3px}#intro-jingle-panel button:disabled{opacity:.5;cursor:default}#intro-jingle-status{margin-top:14px;min-height:20px}#intro-jingle-audio{display:none}@media(max-width:900px){.intro-detail-columns{grid-template-columns:minmax(0,1fr);gap:24px}#intro-jingle-panel{width:100%}}';
  document.head.append(style);

  const audio = panel.querySelector('audio');
  const options = panel.querySelector('#intro-jingle-options');
  const status = panel.querySelector('#intro-jingle-status');
  const replay = panel.querySelector('#intro-jingle-replay');
  const sound = panel.querySelector('#intro-jingle-sound');
  let items = [], chosen = null, playing = null, source = null, generation = 0, attempt = 0;
  let ready = false, failed = false, soundOn = true, originalLoop = video.loop;
  const isIntro = () => sheet.classList.contains('open') && !videoPlayer.hidden && !!video.getAttribute('src');
  const title = item => item?.title || 'Jingle ' + item?.slot;

  function renderOptions() {
    options.innerHTML = items.map((item, index) => '<button type="button" data-jingle-index="' + index + '" aria-pressed="' + (item === chosen) + '">' + escapeHTML(title(item)) + '</button>').join('');
    replay.disabled = sound.disabled = !items.length;
  }
  function describe() {
    if (!ready) status.textContent = 'Loading jingles…';
    else if (failed) status.textContent = 'Jingles are temporarily unavailable. You can still watch the intro.';
    else if (!chosen) status.textContent = 'No jingles have been published yet.';
    else if (playing && playing !== chosen) status.textContent = title(chosen) + ' selected for the next play.';
    else status.textContent = title(chosen) + ' selected.';
  }
  function stopAudio(clear = false) {
    attempt++;
    audio.pause();
    if (clear) { audio.removeAttribute('src'); audio.load(); playing = null; }
  }
  function startAudio(restart = false) {
    if (!isIntro() || video.paused || !chosen) return;
    if (restart || !playing) {
      stopAudio();
      if (playing !== chosen) audio.src = chosen.url;
      playing = chosen;
      audio.currentTime = 0;
    }
    audio.muted = !soundOn || video.muted;
    audio.volume = video.volume;
    const currentGeneration = generation, currentAttempt = ++attempt;
    const started = audio.play();
    started?.catch?.(error => {
      if (generation !== currentGeneration || attempt !== currentAttempt || !isIntro() || video.paused || error?.name === 'AbortError') return;
      status.textContent = error?.name === 'NotAllowedError' ? 'Press Replay intro to hear the selected jingle.' : 'This jingle could not play. Try another jingle or replay.';
    });
    describe();
  }
  function replayIntro() {
    if (!isIntro()) return;
    stopAudio();
    playing = null;
    video.currentTime = 0;
    const currentGeneration = generation;
    const started = video.play();
    startAudio(true);
    started?.catch?.(() => { if (generation === currentGeneration && isIntro()) status.textContent = 'Press play on the video to start the intro.'; });
  }
  function refresh() {
    if (!isIntro()) {
      if (source !== null) { generation++; stopAudio(true); source = null; chosen = null; video.loop = originalLoop; }
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const nextSource = video.getAttribute('src');
    if (source !== nextSource) {
      generation++;
      stopAudio(true);
      if (source === null) originalLoop = video.loop;
      source = nextSource;
      chosen = items[0] || null;
      // Loop explicitly so the next pass can apply a queued choice. An
      // unchanged jingle can finish naturally across several video loops.
      video.loop = false;
      renderOptions();
      describe();
      if (!video.paused) startAudio(true);
    }
  }
  document.addEventListener('play', event => {
    if (event.target !== audio) return;
    event.stopImmediatePropagation();
    if (!isIntro() || video.paused) { stopAudio(); return; }
    document.querySelectorAll('audio,video').forEach(media => { if (media !== audio && media !== video) media.pause(); });
  }, true);
  video.addEventListener('play', () => { refresh(); startAudio(!playing || playing !== chosen || audio.ended); });
  video.addEventListener('pause', () => { if (video.paused) stopAudio(); });
  video.addEventListener('ended', () => {
    if (!isIntro()) return;
    video.currentTime = 0;
    const currentGeneration = generation;
    const started = video.play();
    started?.catch?.(() => { if (generation === currentGeneration && isIntro()) status.textContent = 'Press play on the video to continue.'; });
  });
  video.addEventListener('volumechange', () => { audio.volume = video.volume; audio.muted = !soundOn || video.muted; });
  video.addEventListener('error', () => stopAudio());
  options.onclick = event => {
    const button = event.target.closest('[data-jingle-index]');
    if (!button) return;
    chosen = items[Number(button.dataset.jingleIndex)];
    options.querySelectorAll('[data-jingle-index]').forEach(option => option.setAttribute('aria-pressed', String(items[Number(option.dataset.jingleIndex)] === chosen)));
    describe();
  };
  replay.onclick = replayIntro;
  sound.onclick = () => {
    soundOn = !soundOn;
    sound.setAttribute('aria-pressed', String(soundOn));
    sound.textContent = soundOn ? 'Sound on' : 'Sound off';
    audio.muted = !soundOn || video.muted;
    if (soundOn && audio.paused) startAudio();
  };
  new MutationObserver(refresh).observe(sheet, {attributes:true, attributeFilter:['class'], subtree:true});
  new MutationObserver(refresh).observe(video, {attributes:true, attributeFilter:['src']});
  const leave = () => { generation++; stopAudio(true); source = null; chosen = null; video.loop = originalLoop; panel.hidden = true; };
  window.addEventListener('popstate', leave);
  window.addEventListener('pagehide', leave);
  renderOptions();
  fetch('/api/jingles/board').then(response => {
    if (!response.ok) throw new Error('Jingles unavailable');
    return response.json();
  }).then(board => {
    const iteration = Array.isArray(board.iterations) ? board.iterations.find(iteration => iteration.items?.length) : null;
    items = (iteration?.items || []).filter(item => typeof item.url === 'string' && item.url.startsWith('/api/audio/')).slice().sort((a, b) => a.slot - b.slot);
  }).catch(() => { failed = true; }).finally(() => {
    ready = true;
    if (isIntro()) { refresh(); chosen ||= items[0] || null; renderOptions(); describe(); startAudio(true); }
  });
})();
