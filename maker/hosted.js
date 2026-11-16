// Shared hosted storage and review publishing for the version 1 renderer.
'use strict';
(function () {
  const $ = s => document.querySelector(s);
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let pendingWrites = 0, saveError = null;
  const resources = [];
  function cloudStatus() {
    const box = $('#cloudStatus'); if (!box) return;
    pendingWrites = resources.reduce((total, resource) => total + resource.pending, 0);
    const error = saveError || resources.find(resource => resource.error)?.error;
    box.textContent = error ? error.message : pendingWrites ? 'Saving to shared workspace…' : 'All changes saved to shared workspace';
    box.dataset.error = error ? 'true' : 'false';
    $('#cloudRetry').hidden = !error;
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
    let result; try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) {
      const error = new Error(result.error || 'The server could not save your changes.');
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function cloudResource(path, key) {
    const resource = new window.LOM_SHARED.Resource(path, key, { request: api, onChange: cloudStatus, acceptMerged: key === 'drafts' });
    resources.push(resource);
    return resource;
  }
  const libraryResource = cloudResource('/api/maker/library', 'library');
  const draftsResource = cloudResource('/api/maker/drafts', 'drafts');
  window.LOM_STORAGE = { load: () => libraryResource.load(), save: value => libraryResource.save(value) };

  function aborted() { return new DOMException('Recording cancelled.', 'AbortError'); }
  async function record(state, options = {}) {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('This browser cannot record video. Use a current version of Chrome or Safari.');
    const mime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('This browser does not support MP4 or WebM recording. Use Chrome or Safari.');
    const s = clone(state), cancelled = () => options.signal?.aborted || options.cancelled?.();
    const { width, height, fps, bitrate } = window.LOM_VIDEO.recording(s, options);
    const duration = Math.max(0.1, Math.min(30, Number(s.duration) || 6));
    if (cancelled()) throw aborted();
    const { canvas, context, scene } = await window.LOM_HOSTED.scene(s, width, height);
    LOM.renderFrame(context, scene, 0);
    const stream = canvas.captureStream(fps), chunks = [];
    let recorder = null, recorderError = null, stopped = false;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
      let resolveStopped, resolveStarted;
      const startPromise = new Promise(resolve => { resolveStarted = resolve; });
      const stopPromise = new Promise(resolve => { resolveStopped = resolve; });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstart = () => resolveStarted();
      recorder.onerror = event => { recorderError = event.error || new Error('Video recording failed.'); resolveStarted(); };
      recorder.onstop = () => { stopped = true; resolveStopped(); };
      document.documentElement.classList.add('recording');
      recorder.start(250);
      // Keep frame zero until the encoder is ready; startup can take hundreds of
      // milliseconds at 4K and must not consume the beginning of the animation.
      await startPromise;
      if (recorderError) throw recorderError;
      const start = performance.now(); let frame = 0;
      while (true) {
        if (cancelled()) throw aborted();
        if (recorderError) throw recorderError;
        const elapsed = Math.min(duration, (performance.now() - start) / 1000);
        LOM.renderFrame(context, scene, elapsed);
        options.onProgress?.(elapsed / duration);
        if (elapsed >= duration) break;
        // Render on frame deadlines, without adding render cost to each interval.
        frame = Math.max(frame + 1, Math.floor((performance.now() - start) * fps / 1000) + 1);
        await new Promise(resolve => setTimeout(resolve, Math.max(0, start + frame * 1000 / fps - performance.now())));
      }
      if (recorder.state !== 'inactive') recorder.stop();
      await stopPromise;
      if (recorderError) throw recorderError;
      if (cancelled()) throw aborted();
      const type = recorder.mimeType || mime, blob = new Blob(chunks, { type });
      if (!blob.size) throw new Error('The recording was empty. Try again in Chrome or Safari.');
      return { blob, extension: type.startsWith('video/mp4') ? 'mp4' : 'webm', mimeType: type };
    } finally {
      if (recorder && !stopped && recorder.state !== 'inactive') recorder.stop();
      document.documentElement.classList.remove('recording');
      stream.getTracks().forEach(track => track.stop());
    }
  }
  window.LOM_MEDIA = { record };

  let drafts = { iterations: [] }, selectedNumber = null, selectedSlot = 1, busy = false, publishController = null;
  const iteration = () => drafts.iterations.find(item => item.number === selectedNumber);
  const currentItem = () => iteration()?.items.find(item => item.slot === selectedSlot);
  function feedback(message, error = false) { const box = $('#reviewDraftStatus'); box.textContent = message; box.dataset.error = error ? 'true' : 'false'; }
  function renderReviews() {
    const iter = iteration();
    $('#reviewIteration').innerHTML = drafts.iterations.map(item => `<option value="${item.number}">${esc(item.title || 'Iteration ' + item.number)}</option>`).join('');
    $('#reviewIteration').value = String(selectedNumber ?? '');
    $('#reviewCount').value = String(iter?.count || 2);
    $('#reviewSlots').innerHTML = iter ? Array.from({ length: iter.count }, (_, index) => {
      const slot = index + 1, item = iter.items.find(value => value.slot === slot), on = slot === selectedSlot;
      if (!item) return `<button class="review-slot ${on ? 'on' : ''}" data-slot="${slot}" aria-pressed="${on}"><strong>Intro ${slot}</strong><span>Empty</span></button>`;
      return `<button class="review-slot saved ${on ? 'on' : ''}" data-slot="${slot}" aria-pressed="${on}"><strong>Intro ${slot}</strong><span>Saved</span>` +
        `<svg class="slot-tick" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10"/><path d="M5.6 10.3l2.9 2.9 5.9-6.2"/></svg></button>`;
    }).join('') : '';
    $('#reviewTitle').value = currentItem()?.title || 'Intro ' + selectedSlot;
    $('#reviewSave').textContent = 'Save to Intro ' + selectedSlot;
    $('#reviewRestore').disabled = !currentItem(); $('#reviewRemove').disabled = !currentItem();
    $('#reviewPublish').disabled = !iter?.items.length;
  }
  async function saveDrafts(message) {
    drafts = clone(await draftsResource.save(drafts));
    if (message) feedback(message);
  }
  async function restoreSlot() {
    const item = currentItem(); if (!item) return;
    await window.LOM_HOSTED.apply(item.state);
    feedback('Restored ' + item.title + '. Changes stay in the shared workspace until published.');
  }
  function handle(action) {
    return async event => {
      if (busy) return;
      busy = true;
      const button = event?.currentTarget; if (button?.tagName === 'BUTTON') button.disabled = true;
      try { await action(event); }
      catch (error) { feedback(error.message || String(error), true); }
      finally { busy = false; if (button?.tagName === 'BUTTON') button.disabled = false; renderReviews(); }
    };
  }
  async function publish() {
    const original = iteration(); if (!original?.items.length) return;
    const selected = clone(original), items = selected.items.slice().sort((a, b) => a.slot - b.slot), rendered = [];
    busy = true; publishController = new AbortController();
    $('#publishModal').hidden = false; $('#publishCancel').textContent = 'Cancel'; $('#publishCancel').disabled = false;
    $('#publishBar').style.width = '0%'; document.documentElement.classList.add('publishing');
    $('main').inert = true; $('.top').inert = true; $('#publishCancel').focus();
    try {
      await window.LOM_HOSTED.flushSave(); await draftsResource.flush();
      for (let index = 0; index < items.length; index++) {
        const item = items[index], state = clone(item.state); state.transparent = false;
        const quality = window.LOM_VIDEO.recording(state);
        $('#publishTitle').textContent = `Rendering ${index + 1} of ${items.length}`;
        $('#publishInfo').textContent = `${item.title} · ${quality.width}×${quality.height} · ${quality.fps} fps · Keep this tab open.`;
        const result = await record(state, { ...quality, signal: publishController.signal, onProgress: progress => { $('#publishBar').style.width = ((index + progress) / items.length * 100).toFixed(1) + '%'; } });
        if (result.blob.size > window.LOM_VIDEO.maxUploadBytes) throw new Error('This full-quality recording exceeds the 96 MB upload limit. Shorten the intro or select a smaller resolution before saving this slot again.');
        $('#publishTitle').textContent = `Uploading ${index + 1} of ${items.length}`;
        const upload = await api(`/api/maker/media?iteration=${selected.number}&slot=${item.slot}`, { method: 'POST', headers: { 'content-type': result.mimeType, 'x-upload-size': String(result.blob.size) }, body: result.blob, signal: publishController.signal });
        rendered.push({ slot: item.slot, title: item.title, subtitle: state.company || 'Intro animation', key: upload.key });
      }
      if (publishController.signal.aborted) throw aborted();
      $('#publishTitle').textContent = 'Publishing iteration…';
      // Once committed, the board should not be cancelled halfway through the update.
      $('#publishCancel').disabled = true;
      await api('/api/maker/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ iteration: { number: selected.number, title: selected.title, items: rendered } }) });
      $('#publishTitle').textContent = 'Published to Intro Review'; $('#publishBar').style.width = '100%';
      $('#publishInfo').textContent = `${items.length} ${items.length === 1 ? 'intro is' : 'intros are'} now visible to your client.`;
      feedback(selected.title + ' published. Client comments stay with each intro slot.');
    } catch (error) {
      const cancelled = error.name === 'AbortError';
      $('#publishTitle').textContent = cancelled ? 'Publishing cancelled' : 'Could not publish';
      $('#publishInfo').textContent = cancelled ? 'Your drafts are saved in the shared workspace. The public review was not changed.' : error.message || String(error);
      feedback(cancelled ? 'Publishing cancelled. Your drafts are saved in the shared workspace.' : error.message || String(error), !cancelled);
    } finally {
      busy = false; publishController = null; document.documentElement.classList.remove('publishing');
      $('main').inert = false; $('.top').inert = false;
      $('#publishCancel').textContent = 'Close'; $('#publishCancel').disabled = false; renderReviews();
    }
  }
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await window.LOM_READY;
      const loaded = await draftsResource.load();
      drafts = loaded && Array.isArray(loaded.iterations) ? loaded : { iterations: [] };
      if (!drafts.iterations.length) { drafts.iterations.push({ number: 1, title: 'Iteration 1', count: 2, items: [] }); await saveDrafts(); }
      selectedNumber = drafts.iterations[0].number; renderReviews(); cloudStatus();
      $('#cloudRetry').onclick = async () => {
        try { for (const resource of resources) if (resource.error && resource.latest) await resource.retry(); saveError = null; cloudStatus(); }
        catch { cloudStatus(); }
      };
      $('#libraryImport').onchange = async event => {
        const file = event.target.files?.[0]; if (!file) return;
        try {
          if (file.size > 16 * 1024 * 1024) throw new Error('Choose a library JSON smaller than 16 MB.');
          const imported = JSON.parse(await file.text());
          if (!imported || typeof imported !== 'object' || Array.isArray(imported) || !Array.isArray(imported.logos) || !Array.isArray(imported.fonts) || !Array.isArray(imported.presets)) throw new Error('Choose the Logo Opener Maker library.json file.');
          const result = await window.LOM_HOSTED.importLibrary(imported);
          feedback(`Imported ${result.logos} logos, ${result.fonts} fonts, and ${result.presets} presets. Existing saved items were kept.`);
        } catch (error) { feedback('Import failed: ' + (error.message || error), true); }
        finally { event.target.value = ''; }
      };
      $('#libraryBackup').onclick = () => {
        const blob = new Blob([JSON.stringify(window.LOM_HOSTED.library(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'intro-maker-library.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      };
      $('#reviewIteration').onchange = handle(async event => { selectedNumber = +event.target.value; selectedSlot = 1; renderReviews(); await restoreSlot(); });
      $('#reviewSlots').onclick = handle(async event => { const button = event.target.closest('[data-slot]'); if (!button) return; selectedSlot = +button.dataset.slot; renderReviews(); await restoreSlot(); });
      $('#reviewNew').onclick = handle(async () => {
        const number = Math.max(0, ...drafts.iterations.map(item => item.number)) + 1;
        if (number > 99) throw new Error('This workspace supports up to 99 iterations.');
        const title = prompt('Iteration name:', 'Iteration ' + number); if (!title?.trim()) return;
        drafts.iterations.push({ number, title: title.trim().slice(0, 80), count: 2, items: [] }); selectedNumber = number; selectedSlot = 1;
        await saveDrafts('New iteration saved to the shared workspace.');
      });
      $('#reviewRename').onclick = handle(async () => {
        const iter = iteration(), title = prompt('Iteration name:', iter.title); if (!title?.trim()) return;
        iter.title = title.trim().slice(0, 80); await saveDrafts('Iteration renamed in the shared workspace. Publish to update its public title.');
      });
      $('#reviewCount').onchange = handle(async event => {
        const iter = iteration(), count = +event.target.value;
        if (iter.items.some(item => item.slot > count) && !confirm('Remove the draft options outside these ' + count + ' slots? The published review changes only when you publish.')) return;
        iter.count = count; iter.items = iter.items.filter(item => item.slot <= count); selectedSlot = Math.min(selectedSlot, count);
        await saveDrafts('Option count saved to the shared workspace.');
      });
      $('#reviewSave').onclick = handle(async () => {
        const iter = iteration(), title = $('#reviewTitle').value.trim().slice(0, 120) || 'Intro ' + selectedSlot;
        await window.LOM_HOSTED.flushSave();
        iter.items = iter.items.filter(item => item.slot !== selectedSlot);
        iter.items.push({ slot: selectedSlot, title, state: window.LOM_HOSTED.state() }); iter.items.sort((a, b) => a.slot - b.slot);
        await saveDrafts(title + ' saved to the shared workspace. Publish the iteration when ready for review.');
      });
      $('#reviewRestore').onclick = handle(restoreSlot);
      $('#reviewRemove').onclick = handle(async () => {
        if (!confirm('Clear this saved draft slot? The published review changes only when you publish.')) return;
        iteration().items = iteration().items.filter(item => item.slot !== selectedSlot); await saveDrafts('Draft slot cleared.');
      });
      $('#reviewPublish').onclick = handle(publish);
      $('#publishCancel').onclick = () => { if (publishController) publishController.abort(); else $('#publishModal').hidden = true; };
      window.addEventListener('beforeunload', event => { if (pendingWrites || busy || resources.some(resource => resource.error)) { event.preventDefault(); event.returnValue = ''; } });
    } catch (error) {
      $('#workspaceErrorText').textContent = error.message || 'The shared workspace could not load. Please reload.';
      $('#workspaceError').hidden = false; saveError = error; cloudStatus();
    }
  });
})();
