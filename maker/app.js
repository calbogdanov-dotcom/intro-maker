// Logo Opener Maker — UI, presets, storage and export.
'use strict';
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = v => String(v == null ? "" : v).replace(/[&<>"\']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "\'":"&#39;"}[c]));
  const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native);
  const native = msg => window.webkit.messageHandlers.native.postMessage(msg);

  // ───────────── built-ins ─────────────
  // Each built-in logo belongs to a brand; picking it applies its look (text, font, layout, logo/text colours).
  // lockup = text drawn on top of the mark at a fixed spot (mark-height units; letters in em, one per non-space letter).
  const BUILTIN_LOGOS = [
    { id: 'sample-spark', brand: 'Your Brand', name: 'Spark', src: 'assets/sample-spark.svg', builtIn: true, tint: true,
      look: { layout: 'horizontal', company: 'Your\nBrand', font: 'Poppins', fontWeight: 700, tracking: -0.01, logoSize: 170, colors: { logo: '#00FF99', text: '#FFFFFF' } } },
    { id: 'sample-orbit', brand: 'Your Brand', name: 'Orbit', src: 'assets/sample-orbit.svg', builtIn: true, tint: true,
      look: { layout: 'stacked', company: 'Your Brand', tagline: '', font: 'Poppins', fontWeight: 700, tracking: 0, logoSize: 190, colors: { logo: '#00FF99', text: '#FFFFFF' } } },
  ];
  // Fonts that ship inside the app (logo fonts).
  const BUILTIN_FONTS = [500, 600, 700, 800, 900].map((w, i) => ({ family: 'Poppins', weight: w, src: `assets/fonts/Poppins-${['Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black'][i]}.ttf` }));
  const STYLES = [
    { id: 'black-mint', name: 'Black · Mint', c: { bgA: '#0A0A0A', bgB: '#0E3B2C', logo: '#00FF99', text: '#FFFFFF', accent: '#00FF99' }, glow: 0.35, vignette: 0.8 },
    { id: 'black-white', name: 'Black · White', c: { bgA: '#0A0A0A', bgB: '#1C1D20', logo: '#FFFFFF', text: '#FFFFFF', accent: '#00FF99' }, glow: 0.25, vignette: 0.8 },
    { id: 'mint', name: 'Mint', c: { bgA: '#00FF99', bgB: '#9BFFD6', logo: '#FFFFFF', text: '#0A0A0A', accent: '#FFFFFF' }, glow: 0, vignette: 0.25 },
    { id: 'light', name: 'Light', c: { bgA: '#F5F5F5', bgB: '#FFFFFF', logo: '#00FF99', text: '#0A0A0A', accent: '#00D17E' }, glow: 0, vignette: 0.3 },
    { id: 'teal', name: 'Deep teal', c: { bgA: '#03120D', bgB: '#017B64', logo: '#00FF99', text: '#FFFFFF', accent: '#00FF99' }, glow: 0.4, vignette: 0.9 },
    { id: 'navy-yellow', name: 'Navy · Yellow', c: { bgA: '#0A0F1E', bgB: '#1E2A55', logo: '#F2EE3B', text: '#FFFFFF', accent: '#F2EE3B' }, glow: 0.4, vignette: 0.9 },
  ];
  const COLOR_ROWS = [['bgA', 'Background 1'], ['bgB', 'Background 2'], ['logo', 'Logo'], ['text', 'Text'], ['accent', 'Accent / light']];
  const FONTS = ['Poppins', 'Avenir Next', 'Avenir', 'Helvetica Neue', 'Futura', 'Gill Sans', 'DIN Alternate', 'Optima', 'Arial Black', 'Trebuchet MS', 'Georgia', 'Baskerville', 'Didot', 'American Typewriter', 'Rockwell', 'Menlo'];

  const DEFAULTS = {
    mode: 'separate', bg: 'particles', logoAnim: 'backlit', textAnim: 'match', emerge: 'blocks', emergeBg: 'own', emergeHold: 'none',
    logoId: 'sample-spark', tintLogo: true, company: 'Your\nBrand', tagline: '', layout: 'horizontal', align: 'center',
    font: 'Poppins', fontWeight: 700, logoSize: 170, textSize: 108, gap: 30, lineHeight: 0.9, tracking: -0.01, tagSize: 30, tagColor: 'accent', offsetY: 0,
    styleId: 'black-mint', colors: clone(STYLES[0].c),
    duration: 6, delay: 0.5, revealDur: 1.4, textDelay: 0.35, bgIntensity: 1, bgSpeed: 1, camera: 'in', intro: 'fade', outro: 'none', seed: 7,
    glow: 0.35, vignette: 0.8, grain: 0.4,
    resolution: '1920x1080', fps: 30, codec: 'prores4444', transparent: false,
  };
  const LOOK_KEYS = ['mode', 'bg', 'logoAnim', 'textAnim', 'emerge', 'emergeBg', 'emergeHold', 'styleId', 'colors', 'duration', 'delay', 'revealDur', 'textDelay', 'bgIntensity', 'bgSpeed', 'camera', 'intro', 'outro', 'glow', 'vignette', 'grain'];
  const STARTERS = [
    { name: 'Backlit rise · particles', state: { mode: 'separate', bg: 'particles', logoAnim: 'backlit', textAnim: 'match', styleId: 'black-mint', colors: STYLES[0].c, camera: 'in', intro: 'fade', glow: 0.35, vignette: 0.8, grain: 0.4, delay: 0.5, revealDur: 1.4 } },
    { name: 'Clean slide · light', state: { mode: 'separate', bg: 'solid', logoAnim: 'slide', textAnim: 'match', styleId: 'light', colors: STYLES[3].c, camera: 'none', intro: 'none', glow: 0, vignette: 0.3, grain: 0, delay: 0.4, revealDur: 1.3 } },
    { name: 'Pop + letters · mint', state: { mode: 'separate', bg: 'gradient', logoAnim: 'pop', textAnim: 'stagger', styleId: 'mint', colors: STYLES[2].c, camera: 'in', intro: 'none', glow: 0, vignette: 0.25, grain: 0.2, delay: 0.4, revealDur: 0.9 } },
    { name: 'Pixel blocks build · black', state: { mode: 'emerge', emerge: 'blocks', emergeBg: 'own', emergeHold: 'shine', styleId: 'black-mint', colors: STYLES[0].c, camera: 'in', intro: 'none', glow: 0.3, vignette: 0.7, grain: 0.3, delay: 0.4, revealDur: 1.4 } },
    { name: 'Light sweep · deep teal', state: { mode: 'emerge', emerge: 'light', emergeBg: 'particles', emergeHold: 'none', styleId: 'teal', colors: STYLES[4].c, camera: 'in', intro: 'fade', glow: 0.45, vignette: 0.9, grain: 0.4, delay: 0.5, revealDur: 1.5 } },
    { name: 'Particle assemble · black & white', state: { mode: 'emerge', emerge: 'particles', emergeBg: 'own', emergeHold: 'float', styleId: 'black-white', colors: STYLES[1].c, camera: 'in', intro: 'fade', glow: 0.3, vignette: 0.8, grain: 0.3, delay: 0.3, revealDur: 1.6 } },
  ];

  // ───────────── storage ─────────────
  let lib = { logos: [], fonts: [], presets: [], last: null };
  async function loadLib() {
    try {
      const raw = window.LOM_STORAGE ? await window.LOM_STORAGE.load() : NATIVE ? await native({ cmd: 'load' }) : localStorage.getItem('lom.lib');
      if (raw) Object.assign(lib, typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch (e) { if (window.LOM_STORAGE) throw e; console.warn('load failed', e); }
  }
  let saveT = null;
  async function persistLib() {
    const raw = JSON.stringify(lib);
    if (window.LOM_STORAGE) await window.LOM_STORAGE.save(JSON.parse(raw));
    else if (NATIVE) await native({ cmd: 'save', data: raw });
    else localStorage.setItem('lom.lib', raw);
  }
  function saveLib() {
    if (window.__LOM_CLI) return;
    clearTimeout(saveT);
    saveT = setTimeout(() => { saveT = null; persistLib().catch(e => toast('Could not save: ' + (e.message || e))); }, 400);
  }
  async function flushSave() {
    clearTimeout(saveT); saveT = null;
    lib.last = clone(st);
    await persistLib();
  }

  let st = clone(DEFAULTS);
  const allLogos = () => [...BUILTIN_LOGOS, ...lib.logos];
  const currentLogo = () => allLogos().find(l => l.id === st.logoId) || allLogos()[0];
  LOM.logoInfo = id => allLogos().find(l => l.id === id) || null;
  const res = s => (s || st).resolution.split('x').map(Number);

  // ───────────── fonts ─────────────
  const loadedFonts = new Set();
  async function registerFont(f) {
    if (loadedFonts.has(f.name)) return;
    try { const ff = new FontFace(f.name, `url(${f.src})`); await ff.load(); document.fonts.add(ff); loadedFonts.add(f.name); }
    catch (e) { console.warn('font', f.name, e); }
  }
  async function registerBuiltinFonts() {
    for (const f of BUILTIN_FONTS) {
      try { const ff = new FontFace(f.family, `url(${f.src})`, { weight: String(f.weight) }); await ff.load(); document.fonts.add(ff); }
      catch (e) { console.warn('font', f.src, e); }
    }
  }
  async function fontsReady(s) {
    try { await document.fonts.load(`${s.fontWeight} 40px "${s.font}"`); } catch (e) { /* system font */ }
  }

  // ───────────── scene & preview ─────────────
  const cv = $('#preview'), ctx = cv.getContext('2d');
  let scene = null, logoImg = null, t = 0, playing = true, lastTs = null, dirty = true, buildId = 0;
  async function getLogoImg(s) {
    const L = allLogos().find(l => l.id === s.logoId) || allLogos()[0];
    if (!L) return null;
    try { return await LOM.loadImage(L.src); } catch (e) { return null; }
  }
  function previewSize() {
    const [W, H] = res();
    const vp = $('#viewport').getBoundingClientRect();
    const scale = Math.min((vp.width || 960) / W, (vp.height || 540) / H);
    const cssW = Math.max(160, W * scale), cssH = Math.max(90, H * scale);
    const pixels = window.LOM_VIDEO.preview(W, H, cssW, cssH, window.devicePixelRatio || 1);
    return { ...pixels, cssW, cssH };
  }
  async function rebuild() {
    const id = ++buildId;
    const img = await getLogoImg(st);
    await fontsReady(st);
    if (id !== buildId) return;
    logoImg = img;
    const P = previewSize();
    if (cv.width !== P.W || cv.height !== P.H) { cv.width = P.W; cv.height = P.H; }
    cv.style.width = P.cssW + 'px'; cv.style.height = P.cssH + 'px';
    const ck = $('#checker');
    ck.style.display = st.transparent ? 'block' : 'none';
    ck.style.width = P.cssW + 'px'; ck.style.height = P.cssH + 'px';
    scene = LOM.buildScene(st, P.W, P.H, logoImg);
    dirty = true;
    scheduleThumbs();
  }
  function draw() {
    if (!scene) return;
    try { LOM.renderFrame(ctx, scene, t); } catch (e) { console.error(e); }
    $('#timeLbl').textContent = `${t.toFixed(2)} / ${st.duration.toFixed(2)} s`;
    $('#scrub').value = Math.round((t / st.duration) * 1000);
  }
  function tick(ts) {
    // Give full-resolution recording the frame budget; resume the editor afterwards.
    if (document.documentElement.classList.contains('recording')) { lastTs = null; requestAnimationFrame(tick); return; }
    if (playing) {
      if (lastTs != null) {
        t += Math.min(0.1, (ts - lastTs) / 1000);
        if (t > st.duration) {
          if ($('#loopChk').checked) t = t % st.duration;
          else { t = st.duration; playing = false; updatePlay(); }
        }
      }
      lastTs = ts; dirty = true;
    } else lastTs = null;
    if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(tick);
  }
  function updatePlay() { $('#playBtn').textContent = playing ? '❚❚' : '▶'; }

  // ───────────── change handling ─────────────
  let rebuildQueued = false;
  function changed(opts = {}) {
    if (!rebuildQueued) { rebuildQueued = true; requestAnimationFrame(() => { rebuildQueued = false; rebuild(); }); }
    lib.last = st; saveLib();
    syncSummary();
    if (opts.restart) { t = Math.max(0, st.delay - 0.4); playing = true; updatePlay(); }
  }

  // ───────────── UI build ─────────────
  const NUMS = { logoSize: 0, textSize: 0, gap: 0, lineHeight: 2, tracking: 3, tagSize: 0, offsetY: 0, duration: 1, delay: 2, revealDur: 2, textDelay: 2, bgIntensity: 2, bgSpeed: 2, glow: 2, vignette: 2, grain: 2 };
  const SELECTS = ['font', 'fontWeight', 'textAnim', 'emergeBg', 'emergeHold', 'camera', 'intro', 'outro', 'resolution', 'fps', 'codec'];
  const NUMERIC_SELECT = { fontWeight: 1, fps: 1 };
  const CHECKS = ['tintLogo', 'transparent'];
  const SEGS = { modeSeg: 'mode', layoutSeg: 'layout', alignSeg: 'align', tagColorSeg: 'tagColor' };

  function buildStatic() {
    // text animation options
    $('#textAnim').innerHTML = LOM.TEXT_ORDER.map(k => `<option value="${k}">${k === 'match' ? 'Same as logo' : LOM.TEXT_ANIMS[k].name}</option>`).join('');
    $('#emergeBg').innerHTML = `<option value="own">Keep the effect's own</option>` + LOM.BG_ORDER.map(k => `<option value="${k}">${LOM.BACKGROUNDS[k].name}</option>`).join('');
    $('#emergeHold').innerHTML = LOM.HOLD_ORDER.map(k => `<option value="${k}">${LOM.HOLD[k].name}</option>`).join('');
    // sliders
    for (const k of Object.keys(NUMS)) {
      const el = $('#' + k);
      el.addEventListener('input', () => {
        st[k] = +el.value; el.nextElementSibling.textContent = (+el.value).toFixed(NUMS[k]);
        if (k === 'delay' || k === 'revealDur' || k === 'textDelay') { t = Math.min(st.duration, st.delay + st.revealDur * 0.6); playing = false; updatePlay(); }
        changed();
      });
    }
    for (const k of SELECTS) $('#' + k).addEventListener('change', e => {
      st[k] = NUMERIC_SELECT[k] ? +e.target.value : e.target.value;
      changed({ restart: k === 'textAnim' });
      if ((k === 'emergeBg' || k === 'emergeHold') && scene) { t = Math.max(0, LOM.emergeDone(scene) - 0.8); playing = true; updatePlay(); }
    });
    for (const k of CHECKS) $('#' + k).addEventListener('change', e => { st[k] = e.target.checked; changed(); });
    for (const [id, k] of Object.entries(SEGS)) {
      $('#' + id).addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        st[k] = b.dataset.v; syncSeg(id, k); changed({ restart: k === 'mode' });
        if (k === 'layout') $('#lockupHint').hidden = st.layout !== 'lockup';
        if (k === 'mode') document.body.className = 'mode-' + st.mode;
      });
    }
    $('#company').addEventListener('input', e => { st.company = e.target.value; changed(); });
    $('#tagline').addEventListener('input', e => { st.tagline = e.target.value; changed(); });
    $('#seed').addEventListener('input', e => { st.seed = +e.target.value | 0; changed(); });
    $('#shuffle').addEventListener('click', () => { st.seed = Math.floor(Math.random() * 9999); $('#seed').value = st.seed; changed({ restart: true }); });

    // colours
    $('#colorRows').innerHTML = COLOR_ROWS.map(([k, label]) =>
      `<div class="crow"><span>${label}</span><input type="color" data-k="${k}"><input type="text" data-k="${k}" maxlength="7" spellcheck="false"></div>`).join('');
    $$('#colorRows input').forEach(el => el.addEventListener('input', () => {
      let v = el.value.trim(); if (!v.startsWith('#')) v = '#' + v;
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
      st.colors[el.dataset.k] = v.toUpperCase(); st.styleId = null;
      syncColors(el); syncChips(); changed();
    }));
    // style chips
    $('#styleChips').innerHTML = STYLES.map(s =>
      `<button class="chip" data-id="${s.id}"><span class="sw"><i style="background:${s.c.bgA}"></i><i style="background:${s.c.logo}"></i><i style="background:${s.c.text}"></i></span>${s.name}</button>`).join('');
    $('#styleChips').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      const s = STYLES.find(x => x.id === b.dataset.id);
      st.styleId = s.id; st.colors = clone(s.c); st.glow = s.glow; st.vignette = s.vignette;
      syncAll(); changed();
    });
    // animation cards
    makeCards('#bgCards', LOM.BG_ORDER, LOM.BACKGROUNDS, 'bg');
    makeCards('#logoCards', LOM.LOGO_ORDER, LOM.LOGO_ANIMS, 'logoAnim');
    makeCards('#emergeCards', LOM.EMERGE_ORDER, LOM.EMERGE, 'emerge');

    // fonts
    syncFontList();
    $('#fontUpload').addEventListener('change', async e => { for (const f of e.target.files) await addFontFile(f); e.target.value = ''; });
    // logos
    $('#logoUpload').addEventListener('change', async e => { for (const f of e.target.files) await addLogoFile(f); e.target.value = ''; });
    document.addEventListener('dragover', e => { e.preventDefault(); });
    document.addEventListener('drop', async e => {
      e.preventDefault();
      for (const f of e.dataTransfer.files) {
        if (/\.(ttf|otf|woff2?)$/i.test(f.name)) await addFontFile(f);
        else if (/^image\//.test(f.type) || /\.svg$/i.test(f.name)) await addLogoFile(f);
      }
    });

    // transport
    $('#playBtn').addEventListener('click', () => { playing = !playing; if (playing && t >= st.duration) t = 0; updatePlay(); });
    $('#restartBtn').addEventListener('click', () => { t = 0; playing = true; updatePlay(); });
    $('#scrub').addEventListener('input', e => { t = (+e.target.value / 1000) * st.duration; playing = false; updatePlay(); dirty = true; });
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#playBtn').click(); }
    });
    window.addEventListener('resize', () => changed());

    // presets
    $('#presetSel').addEventListener('change', e => applyPresetValue(e.target.value));
    $('#presetSave').addEventListener('click', savePreset);
    $('#presetDel').addEventListener('click', deletePreset);
    // export
    $('#exportBtn').addEventListener('click', doExport);
    $('#exCancel').addEventListener('click', () => { exportCancel = true; if (exportDone) $('#exportModal').hidden = true; });
    $('#exReveal').addEventListener('click', () => { if (lastExportPath) native({ cmd: 'reveal', path: lastExportPath }); });
  }

  function makeCards(sel, order, reg, key) {
    const box = $(sel);
    box.innerHTML = order.map(k => `<button class="card" data-k="${k}">${reg[k].badge ? `<em class="badge">${reg[k].badge}</em>` : ''}<canvas width="240" height="135"></canvas><span><b>${reg[k].icon || ''}</b>${reg[k].name}</span></button>`).join('');
    box.addEventListener('click', e => {
      const b = e.target.closest('.card'); if (!b) return;
      st[key] = b.dataset.k; syncCards(); changed({ restart: true });
    });
    box.querySelectorAll('.card').forEach(card => {
      card.addEventListener('mouseenter', () => startThumbAnim(card, key));
      card.addEventListener('mouseleave', () => stopThumbAnim(card, key));
    });
  }

  // ───────────── thumbnails ─────────────
  let thumbScene = null, thumbT = null;
  const thumbTime = (key, S) => {
    const T = S.timing;
    if (key === 'bg') return T.start + T.D + 0.8;
    if (key === 'logoAnim') { const a = LOM.LOGO_ANIMS[S.st.logoAnim]; return T.start + T.D * ((a && a.thumbAt) || 0.55); }
    return T.start + T.D * 0.75;
  };
  function thumbState(key, k) {
    const s = { ...st, [key]: k, intro: 'none', outro: 'none', transparent: false, camera: 'none' };
    s.mode = key === 'emerge' ? 'emerge' : 'separate';
    return s;
  }
  function renderThumb(card, key, tt) {
    if (!thumbScene) return;
    const c = card.querySelector('canvas'), x = c.getContext('2d');
    const prev = thumbScene.st;
    thumbScene.st = thumbState(key, card.dataset.k);
    try { LOM.renderFrame(x, thumbScene, tt == null ? thumbTime(key, thumbScene) : tt); } catch (e) { console.error(e); }
    thumbScene.st = prev;
  }
  function scheduleThumbs() {
    clearTimeout(thumbT);
    thumbT = setTimeout(async () => {
      const s = { ...st, resolution: '1920x1080' };
      thumbScene = LOM.buildScene(s, 240, 135, logoImg);
      for (const [sel, key] of [['#bgCards', 'bg'], ['#logoCards', 'logoAnim'], ['#emergeCards', 'emerge']]) {
        for (const card of $(sel).querySelectorAll('.card')) { renderThumb(card, key); await new Promise(r => setTimeout(r, 0)); }
      }
    }, 350);
  }
  const anims = new Map();
  function startThumbAnim(card, key) {
    if (!thumbScene) return;
    const T = thumbScene.timing, t0 = performance.now();
    const span = T.start + T.D * 2.2 + 0.6;
    const loop = now => {
      if (!anims.has(card)) return;
      renderThumb(card, key, ((now - t0) / 1000) % span);
      anims.set(card, requestAnimationFrame(loop));
    };
    anims.set(card, requestAnimationFrame(loop));
  }
  function stopThumbAnim(card, key) { cancelAnimationFrame(anims.get(card)); anims.delete(card); renderThumb(card, key); }

  // ───────────── library: logos & fonts ─────────────
  const readURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  async function isMonochrome(src) {
    try {
      const img = await LOM.loadImage(src);
      const c = LOM.makeCanvas(64, 64), x = c.getContext('2d');
      x.drawImage(img, 0, 0, 64, 64);
      const d = x.getImageData(0, 0, 64, 64).data;
      let n = 0, sr = 0, sg = 0, sb = 0, s2 = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { n++; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; }
      if (n < 10) return false;
      const mr = sr / n, mg = sg / n, mb = sb / n;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) s2 += (d[i] - mr) ** 2 + (d[i + 1] - mg) ** 2 + (d[i + 2] - mb) ** 2;
      const hasTransparency = d.some((v, i) => i % 4 === 3 && v < 20);
      return hasTransparency && Math.sqrt(s2 / n) < 30;
    } catch (e) { return false; }
  }
  async function addLogoFile(f) {
    const src = await readURL(f);
    const id = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
    const tint = await isMonochrome(src);
    lib.logos.push({ id, name: f.name.replace(/\.[^.]+$/, ''), src, tint });
    rememberLook(); st.logoId = id; st.tintLogo = tint; if (st.layout === 'lockup') st.layout = 'horizontal';
    saveLib(); syncAll(); changed({ restart: true });
    toast(`Added “${f.name}”` + (tint ? ' — single colour, so it follows the Logo colour.' : ' — keeping its own colours.'));
  }
  async function addFontFile(f) {
    const src = await readURL(f);
    const name = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    lib.fonts = lib.fonts.filter(x => x.name !== name);
    lib.fonts.push({ name, src });
    await registerFont({ name, src });
    st.font = name; saveLib(); syncFontList(); syncAll(); changed();
    toast(`Font “${name}” added`);
  }
  function syncFontList() {
    const sel = $('#font');
    const user = lib.fonts.map(f => f.name);
    sel.innerHTML = (user.length ? `<optgroup label="Uploaded">${user.map(n => `<option>${esc(n)}</option>`).join('')}</optgroup>` : '') +
      `<optgroup label="Mac fonts">${FONTS.map(n => `<option>${esc(n)}</option>`).join('')}</optgroup>`;
    if (![...user, ...FONTS].includes(st.font)) { sel.insertAdjacentHTML('afterbegin', `<option>${esc(st.font)}</option>`); }
    sel.value = st.font;
  }
  // Each logo keeps its own text / font / layout / size / logo+text colours: switching away remembers them,
  // switching back restores them (first time: the logo's designed look).
  const LOOK_FIELDS = ['layout', 'company', 'tagline', 'font', 'fontWeight', 'tracking', 'logoSize'];
  function rememberLook() {
    lib.logoLooks = lib.logoLooks || {};
    const k = { colors: { logo: st.colors.logo, text: st.colors.text } };
    for (const f of LOOK_FIELDS) k[f] = st[f];
    lib.logoLooks[st.logoId] = k;
  }
  function applyLook(L) {
    const k = (lib.logoLooks && lib.logoLooks[L.id]) || L.look;
    if (k) {
      for (const f of LOOK_FIELDS) if (k[f] != null) st[f] = k[f];
      if (k.colors) { st.colors = Object.assign(clone(st.colors), k.colors); st.styleId = null; }
    }
    if (st.layout === 'lockup' && !L.lockup) st.layout = 'horizontal';
  }
  function renderLib() {
    const box = $('#logoLib');
    const tile = l => `<div class="item ${l.id === st.logoId ? 'on' : ''}" data-id="${esc(l.id)}" title="${esc((l.brand ? l.brand + ' · ' : '') + l.name)}">
      <img src="${esc(l.thumb || l.src)}" alt="">${l.builtIn ? '' : '<button class="x" title="Remove">✕</button>'}<span class="nm">${esc(l.name)}</span></div>`;
    const brands = [...new Set(BUILTIN_LOGOS.map(l => l.brand))];
    box.innerHTML = brands.map(b => `<div class="libhead">${b}</div>` + BUILTIN_LOGOS.filter(l => l.brand === b).map(tile).join('')).join('') +
      (lib.logos.length ? `<div class="libhead">Uploaded</div>` + lib.logos.map(tile).join('') : '');
    box.onclick = e => {
      const it = e.target.closest('.item'); if (!it) return;
      if (e.target.closest('.x')) {
        if (!confirm('Remove this logo from the library?')) return;
        lib.logos = lib.logos.filter(l => l.id !== it.dataset.id);
        if (st.logoId === it.dataset.id) st.logoId = allLogos()[0].id;
        saveLib(); syncAll(); changed(); return;
      }
      const L = allLogos().find(l => l.id === it.dataset.id);
      if (L.id !== st.logoId) { rememberLook(); st.logoId = L.id; st.tintLogo = !!L.tint; applyLook(L); saveLib(); }
      syncAll(); changed({ restart: true });
    };
  }

  // ───────────── presets ─────────────
  function syncPresets() {
    const sel = $('#presetSel');
    sel.innerHTML = `<option value="">Presets…</option>` +
      `<optgroup label="Starters">${STARTERS.map((p, i) => `<option value="s${i}">${esc(p.name)}</option>`).join('')}</optgroup>` +
      (lib.presets.length ? `<optgroup label="Saved">${lib.presets.map((p, i) => `<option value="u${i}">${esc(p.name)}</option>`).join('')}</optgroup>` : '');
    sel.value = '';
  }
  function applyPresetValue(v) {
    if (!v) return;
    const P = v[0] === 's' ? STARTERS[+v.slice(1)] : lib.presets[+v.slice(1)];
    if (!P) return;
    const next = Object.assign(clone(st), clone(P.state));
    if (!allLogos().some(l => l.id === next.logoId)) next.logoId = st.logoId;
    st = Object.assign(clone(DEFAULTS), next);
    syncAll(); changed({ restart: true });
    $('#presetSel').value = v;
    toast(`Preset: ${P.name}`);
  }
  function savePreset() {
    const name = prompt('Name this preset (saves everything: logo, text, colours, animation, export settings):', `${(st.company || 'Logo').split('\n').join(' ')} — ${describe()}`);
    if (!name) return;
    const i = lib.presets.findIndex(p => p.name === name);
    const P = { name, state: clone(st) };
    if (i >= 0) lib.presets[i] = P; else lib.presets.push(P);
    saveLib(); syncPresets();
    $('#presetSel').value = 'u' + (i >= 0 ? i : lib.presets.length - 1);
    toast('Preset saved');
  }
  function deletePreset() {
    const v = $('#presetSel').value;
    if (!v || v[0] !== 'u') { toast('Pick one of your saved presets to delete'); return; }
    const P = lib.presets[+v.slice(1)];
    if (!confirm(`Delete preset “${P.name}”?`)) return;
    lib.presets.splice(+v.slice(1), 1); saveLib(); syncPresets();
  }

  // ───────────── sync UI from state ─────────────
  function syncSeg(id, k) { $$(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === st[k])); }
  function syncColors(except) {
    $$('#colorRows input').forEach(el => { if (el !== except) el.value = el.type === 'color' ? st.colors[el.dataset.k].toLowerCase() : st.colors[el.dataset.k].toUpperCase(); });
  }
  function syncChips() {
    const match = STYLES.find(s => Object.keys(s.c).every(k => s.c[k].toUpperCase() === (st.colors[k] || '').toUpperCase()));
    $$('#styleChips .chip').forEach(b => b.classList.toggle('on', !!match && b.dataset.id === match.id));
  }
  function syncCards() {
    $$('#bgCards .card').forEach(c => c.classList.toggle('on', c.dataset.k === st.bg));
    $$('#logoCards .card').forEach(c => c.classList.toggle('on', c.dataset.k === st.logoAnim));
    $$('#emergeCards .card').forEach(c => c.classList.toggle('on', c.dataset.k === st.emerge));
  }
  function describe() {
    return st.mode === 'emerge' ? `Emerge · ${LOM.EMERGE[st.emerge].name}` +
      (st.emergeBg && st.emergeBg !== 'own' ? ` → ${LOM.BACKGROUNDS[st.emergeBg].name}` : '') +
      (st.emergeHold && st.emergeHold !== 'none' ? ` · logo ${LOM.HOLD[st.emergeHold].name.toLowerCase()}` : '') : `${LOM.BACKGROUNDS[st.bg].name} + ${LOM.LOGO_ANIMS[st.logoAnim].name}`;
  }
  function syncSummary() {
    const codec = NATIVE ? { prores4444: 'ProRes 4444', prores422hq: 'ProRes 422 HQ', h264: 'H.264' }[st.codec] : 'MP4 / WebM browser video';
    $('#summary').textContent = `${describe()}  ·  ${st.resolution.replace('x', '×')}  ·  ${st.fps} fps  ·  ${st.duration.toFixed(1)} s  ·  ${codec}${NATIVE && st.transparent ? ' with alpha' : ''}`;
    let hint = '';
    if (st.transparent && st.codec !== 'prores4444') hint = 'Transparency is only kept with ProRes 4444.';
    else if (st.transparent && st.mode === 'emerge') hint = 'Emerge effects paint their own background; with transparency on, only the logo part is exported.';
    else if (st.transparent) hint = 'Background is left out: drop the MOV over your footage.';
    if (!NATIVE) hint = (st.transparent ? 'The preview is transparent. ' : '') + 'Browser export saves an opaque MP4 or WebM, depending on your browser. Use the Mac app for ProRes MOV with transparency.';
    $('#exportHint').textContent = hint;
  }
  function syncAll() {
    document.body.className = 'mode-' + st.mode;
    for (const k of Object.keys(NUMS)) { const el = $('#' + k); el.value = st[k]; el.nextElementSibling.textContent = (+st[k]).toFixed(NUMS[k]); }
    for (const k of SELECTS) { const el = $('#' + k); if (k === 'font') syncFontList(); else el.value = String(st[k]); }
    for (const k of CHECKS) $('#' + k).checked = !!st[k];
    for (const [id, k] of Object.entries(SEGS)) syncSeg(id, k);
    $('#company').value = st.company; $('#tagline').value = st.tagline; $('#seed').value = st.seed;
    const hasLockup = !!currentLogo().lockup;
    $('#layoutSeg button[data-v="lockup"]').hidden = !hasLockup;
    $('#lockupHint').hidden = !(hasLockup && st.layout === 'lockup');
    syncColors(); syncChips(); syncCards(); renderLib(); syncSummary();
  }

  // ───────────── export ─────────────
  let exportCancel = false, exportDone = false, lastExportPath = null;
  function safeName(s) { return (String(s || 'logo').split('\n').join(' ').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'logo'); }
  async function renderAll(s, onFrame) {
    const [W, H] = res(s), fps = +s.fps, N = Math.max(1, Math.round(s.duration * fps));
    const img = await getLogoImg(s); await fontsReady(s);
    const ec = LOM.makeCanvas(W, H), ex = ec.getContext('2d');
    const S = LOM.buildScene(s, W, H, img);
    for (let i = 0; i < N; i++) {
      if (exportCancel) return false;
      LOM.renderFrame(ex, S, i / fps);
      const ok = await onFrame(ec, i, N);
      if (ok === false) return false;
    }
    return true;
  }
  function modal(title) {
    exportCancel = false; exportDone = false;
    $('#exTitle').textContent = title; $('#exBar').style.width = '0%'; $('#exInfo').textContent = '';
    $('#exReveal').hidden = true; $('#exCancel').textContent = 'Cancel'; $('#exportModal').hidden = false;
  }
  function finishModal(title, info, path) {
    exportDone = true; $('#exTitle').textContent = title; $('#exInfo').textContent = info || '';
    $('#exCancel').textContent = 'Close'; $('#exReveal').hidden = !path; $('#exBar').style.width = '100%';
  }
  async function exportNative(s, opts = {}) {
    const [W, H] = res(s);
    const begin = await native({ cmd: 'exportBegin', width: W, height: H, fps: +s.fps, codec: s.codec, alpha: !!(s.transparent && s.codec === 'prores4444'), name: safeName(s.company) + '_opener.mov' });
    if (!begin || !begin.ok) { if (begin && begin.error) throw new Error(begin.error); return null; }
    if (!opts.quiet) modal('Exporting ' + begin.name);
    const t0 = performance.now();
    const ok = await renderAll(s, async (ec, i, N) => {
      const url = ec.toDataURL('image/png');
      const r = await native({ cmd: 'exportFrame', index: i, data: url.slice(url.indexOf(',') + 1) });
      if (!r || !r.ok) throw new Error((r && r.error) || 'Frame write failed');
      if (!opts.quiet) {
        $('#exBar').style.width = ((i + 1) / N * 100).toFixed(1) + '%';
        const el = (performance.now() - t0) / 1000, eta = (el / (i + 1)) * (N - i - 1);
        $('#exInfo').textContent = `frame ${i + 1} / ${N}  ·  ${eta.toFixed(0)} s left`;
      }
    });
    if (!ok) { await native({ cmd: 'exportCancel' }); if (!opts.quiet) $('#exportModal').hidden = true; return null; }
    const end = await native({ cmd: 'exportEnd' });
    if (!end || !end.ok) throw new Error((end && end.error) || 'Could not finish the movie');
    lastExportPath = end.path;
    if (!opts.quiet) finishModal('Done ✓', `${end.path}\n${((performance.now() - t0) / 1000).toFixed(1)} s`, end.path);
    return end.path;
  }
  async function exportWebM(s) {
    s = clone(s); s.transparent = false;
    modal('Exporting video…');
    try {
      const result = await window.LOM_MEDIA.record(s, {
        width: res(s)[0], height: res(s)[1], fps: +s.fps,
        cancelled: () => exportCancel,
        onProgress: p => { $('#exBar').style.width = (p * 100).toFixed(1) + '%'; $('#exInfo').textContent = Math.round(p * 100) + '% · Keep this tab open while recording.'; }
      });
      const url = URL.createObjectURL(result.blob), a = document.createElement('a');
      a.href = url; a.download = safeName(s.company) + '_intro.' + result.extension; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      finishModal('Video exported', 'Downloaded ' + result.extension.toUpperCase() + '.');
    } catch (e) {
      if (e.name === 'AbortError') { $('#exportModal').hidden = true; return; }
      throw e;
    }
  }

  async function doExport() {
    const s = clone(st);
    try { if (NATIVE) await exportNative(s); else await exportWebM(s); }
    catch (e) { finishModal('Export failed', String(e.message || e)); }
  }

  // ───────────── misc ─────────────
  let toastT;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 2600); }

  // Hooks for the command-line renderer (used for tests and batch renders).
  window.LOM_CLI = {
    state: () => clone(st),
    async apply(partial) { st = Object.assign(clone(DEFAULTS), clone(st), partial || {}); syncAll(); await rebuild(); return true; },
    async sheet(partial, times, cols = 4, width = 480) {
      const s = Object.assign(clone(DEFAULTS), clone(st), partial || {});
      const [W, H] = res(s), w = width, h = Math.round((width * H) / W);
      const rows = Math.ceil(times.length / cols);
      const out = LOM.makeCanvas(w * cols, h * rows), ox = out.getContext('2d');
      const img = await getLogoImg(s); await fontsReady(s);
      const S = LOM.buildScene(s, W, H, img), fc = LOM.makeCanvas(W, H), fx = fc.getContext('2d');
      times.forEach((tt, i) => {
        LOM.renderFrame(fx, S, tt);
        ox.drawImage(fc, (i % cols) * w, Math.floor(i / cols) * h, w, h);
        ox.fillStyle = 'rgba(0,0,0,.6)'; ox.fillRect((i % cols) * w, Math.floor(i / cols) * h, 58, 18);
        ox.fillStyle = '#fff'; ox.font = '12px Menlo'; ox.fillText(tt.toFixed(2) + 's', (i % cols) * w + 5, Math.floor(i / cols) * h + 13);
      });
      const url = out.toDataURL('image/png'); return url.slice(url.indexOf(',') + 1);
    },
    async exportMov(partial) {
      const s = Object.assign(clone(DEFAULTS), clone(st), partial || {});
      return await exportNative(s, { quiet: true });
    },
  };

  // Hosted integration hooks keep the renderer and selected artwork shared with the editor.
  window.LOM_HOSTED = {
    state: () => clone(st),
    library: () => clone(lib),
    flushSave,
    async importLibrary(imported) {
      const counts = { logos: 0, fonts: 0, presets: 0 }, logoIds = new Map(), fontNames = new Map();
      const existingState = clone(st);
      // Validate the complete import before changing the in-memory library.
      for (const logo of imported.logos) if (!logo || typeof logo.id !== 'string' || typeof logo.name !== 'string' || typeof logo.src !== 'string' || !/^data:image\//i.test(logo.src)) throw new Error('The library contains an invalid uploaded logo.');
      for (const font of imported.fonts) if (!font || typeof font.name !== 'string' || typeof font.src !== 'string' || !/^data:/i.test(font.src)) throw new Error('The library contains an invalid uploaded font.');
      for (const preset of imported.presets) if (!preset || typeof preset.name !== 'string' || !preset.state || typeof preset.state !== 'object' || Array.isArray(preset.state)) throw new Error('The library contains an invalid preset.');
      for (const logo of imported.logos) {
        if (!logo || typeof logo.id !== 'string' || typeof logo.name !== 'string' || typeof logo.src !== 'string' || !/^data:image\//i.test(logo.src)) throw new Error('The library contains an invalid uploaded logo.');
        const copy = clone(logo), match = allLogos().find(item => item.id === copy.id);
        if (match && match.src === copy.src) { logoIds.set(logo.id, match.id); continue; }
        if (match) copy.id = 'uimport' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        logoIds.set(logo.id, copy.id); lib.logos.push(copy); counts.logos++;
      }
      for (const font of imported.fonts) {
        if (!font || typeof font.name !== 'string' || typeof font.src !== 'string' || !/^data:/i.test(font.src)) throw new Error('The library contains an invalid uploaded font.');
        const copy = clone(font), match = lib.fonts.find(item => item.name === copy.name);
        if (match && match.src === copy.src) { fontNames.set(font.name, match.name); continue; }
        if (match) { let number = 1; while (lib.fonts.some(item => item.name === font.name + ' (imported ' + number + ')')) number++; copy.name = font.name + ' (imported ' + number + ')'; }
        fontNames.set(font.name, copy.name); lib.fonts.push(copy); await registerFont(copy); counts.fonts++;
      }
      function mapState(value) {
        const copy = clone(value);
        if (logoIds.has(copy.logoId)) copy.logoId = logoIds.get(copy.logoId);
        if (fontNames.has(copy.font)) copy.font = fontNames.get(copy.font);
        return copy;
      }
      function addPreset(name, state) {
        const base = String(name || 'Imported preset').slice(0, 160); let candidate = base, number = 1;
        while (lib.presets.some(item => item.name === candidate)) candidate = base + ' (imported ' + number++ + ')';
        lib.presets.push({ name: candidate, state: mapState(state) }); counts.presets++;
      }
      for (const preset of imported.presets) {
        if (!preset || typeof preset.name !== 'string' || !preset.state || typeof preset.state !== 'object') throw new Error('The library contains an invalid preset.');
        addPreset(preset.name, preset.state);
      }
      lib.logoLooks = lib.logoLooks || {};
      for (const [id, look] of Object.entries(imported.logoLooks || {})) {
        const key = logoIds.get(id) || id;
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        if (!Object.prototype.hasOwnProperty.call(lib.logoLooks, key)) lib.logoLooks[key] = mapState(look);
      }
      if (imported.last && typeof imported.last === 'object') {
        addPreset('Before library import', existingState);
        addPreset('Imported last session', imported.last);
        const next = mapState(imported.last);
        st = Object.assign(clone(DEFAULTS), next, { colors: Object.assign(clone(DEFAULTS.colors), next.colors || {}) });
      }
      syncPresets(); syncFontList(); syncAll(); await rebuild(); await flushSave();
      return counts;
    },
    async apply(partial) {
      const next = clone(partial || {});
      st = Object.assign(clone(DEFAULTS), next, { colors: Object.assign(clone(DEFAULTS.colors), next.colors || {}) });
      syncAll(); changed({ restart: true }); await rebuild();
    },
    async scene(partial, width, height) {
      const s = Object.assign(clone(DEFAULTS), clone(partial || {}));
      s.colors = Object.assign(clone(DEFAULTS.colors), s.colors || {});
      if (!allLogos().some(logo => logo.id === s.logoId)) throw new Error('This option uses a logo that is no longer in the library. Restore the logo before rendering.');
      const img = await getLogoImg(s); await fontsReady(s);
      const canvas = LOM.makeCanvas(width, height), context = canvas.getContext('2d');
      return { canvas, context, scene: LOM.buildScene(s, width, height, img) };
    }
  };

  // ───────────── init ─────────────
  window.LOM_READY = (async () => {
    await loadLib();
    await registerBuiltinFonts();
    for (const f of lib.fonts) await registerFont(f);
    if (lib.last) st = Object.assign(clone(DEFAULTS), lib.last, { colors: Object.assign(clone(DEFAULTS.colors), lib.last.colors || {}) });
    buildStatic(); syncPresets(); syncAll();
    await rebuild();
    t = 0; requestAnimationFrame(tick);
    return true;
  })();
})();
