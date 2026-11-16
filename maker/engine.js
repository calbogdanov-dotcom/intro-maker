// Logo Opener Maker — render core.
// Everything is a pure function of time t (seconds), so the preview, scrubbing and the
// frame-by-frame MOV export all show exactly the same picture.
'use strict';
const LOM = (window.LOM = window.LOM || {});

// ───────────────────────── math ─────────────────────────
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const prog = (t, start, dur) => (dur <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / dur));
const TAU = Math.PI * 2;
const frac = x => x - Math.floor(x);

const Ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: t => t * t * t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: t => 1 - Math.pow(1 - t, 4),
  outQuint: t => 1 - Math.pow(1 - t, 5),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  outSine: t => Math.sin((t * Math.PI) / 2),
  inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: t => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outElastic: t => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * TAU) / 3) + 1),
  outBounce: t => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

// Stateless hash random in [0,1): same (i, seed) → same number, in preview and export.
function hrand(i, s = 0) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((s | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// 2D value noise + fbm, for smoke and dissolves.
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => hrand(a * 374761 + b * 668265 + 17, s);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
function fbm(x, y, s = 0, oct = 5) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { sum += a * vnoise(x * f, y * f, s + o * 31); norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}

// ───────────────────────── colour ─────────────────────────
function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
function rgba(hex, a = 1) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${clamp(a)})`; }
function mixHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)); }
function luminance(hex) {
  const c = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// ───────────────────────── canvas helpers ─────────────────────────
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
// Reusable scratch canvases (avoids allocating every frame).
const _scratch = new Map();
function scratch(key, w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  let c = _scratch.get(key);
  if (!c) { c = makeCanvas(w, h); _scratch.set(key, c); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  return c;
}
// Fast blur: progressive half-size downscales, then a final fractional step so the radius
// animates smoothly. The result is a small canvas; draw it at the source's size.
function blurred(src, radius, key = 'blur') {
  if (radius < 0.6) return src;
  const f = Math.min(64, Math.max(1, radius * 0.9));
  let cur = src, w = src.width, h = src.height, lvl = 0;
  while (w / 2 >= src.width / f && w > 2 && h > 2) {
    const c = scratch(key + ':h' + lvl++, w / 2, h / 2);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, c.width, c.height);
    cur = c; w = c.width; h = c.height;
  }
  const tw = Math.max(1, Math.round(src.width / f)), th = Math.max(1, Math.round(src.height / f));
  if (tw === cur.width && th === cur.height) return cur;
  const c = scratch(key + ':f', tw, th);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, tw, th);
  return c;
}
function tinted(src, color, key = 'tint') {
  const c = scratch(key, src.width, src.height), x = c.getContext('2d');
  x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ───────────────────────── images & fonts ─────────────────────────
const _images = new Map();
LOM.loadImage = function (src) {
  if (_images.has(src)) return _images.get(src);
  const p = new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not load image'));
    img.src = src;
  });
  _images.set(src, p);
  return p;
};
LOM.fontStack = fam => `"${fam}", "Avenir Next", "Helvetica Neue", Arial, sans-serif`;

// ───────────────────────── scene (layout) ─────────────────────────
// Builds everything that depends on settings + resolution but not on time:
// colours, the logo / text / tagline parts pre-rendered at the exact pixel size, timing.
LOM.buildScene = function (st, W, H, logoImg) {
  const u = Math.min(W, H) / 1080;
  const c = st.colors;
  const S = {
    st, W, H, u, cx: W / 2, cy: H / 2 + (st.offsetY || 0) * u, colors: c, seed: st.seed | 0,
    dark: luminance(c.bgA) < 0.35, fps: st.fps, cache: {},
    parts: {},
  };
  const pad = Math.ceil(60 * u);
  const parts = [];

  // Logo mark (optionally recoloured, optionally inside an app-icon tile).
  let mark = null;
  if (logoImg && st.layout !== 'text') {
    const iw = logoImg.naturalWidth || logoImg.width || 1, ih = logoImg.naturalHeight || logoImg.height || 1;
    const ar = iw / ih;
    if (st.layout === 'icon') {
      const T = st.logoSize * 1.25 * u;
      const cv = makeCanvas(T + pad * 2, T + pad * 2), x = cv.getContext('2d');
      x.fillStyle = c.accent; roundRect(x, pad, pad, T, T, T * 0.22); x.fill();
      let mw = T * 0.6, mh = mw / ar; if (mh > T * 0.6) { mh = T * 0.6; mw = mh * ar; }
      const m = makeCanvas(mw, mh), mx = m.getContext('2d'); mx.imageSmoothingQuality = 'high';
      mx.drawImage(logoImg, 0, 0, m.width, m.height);
      if (st.tintLogo) { mx.globalCompositeOperation = 'source-in'; mx.fillStyle = c.logo; mx.fillRect(0, 0, m.width, m.height); }
      x.drawImage(m, pad + (T - m.width) / 2, pad + (T - m.height) / 2);
      mark = { role: 'mark', canvas: cv, w: T, h: T, pad };
    } else {
      let mh = st.logoSize * u, mw = mh * ar;
      const cv = makeCanvas(mw + pad * 2, mh + pad * 2), x = cv.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(logoImg, pad, pad, mw, mh);
      if (st.tintLogo) { x.globalCompositeOperation = 'source-in'; x.fillStyle = c.logo; x.fillRect(0, 0, cv.width, cv.height); }
      mark = { role: 'mark', canvas: cv, w: mw, h: mh, pad };
    }
  }

  // Text block and tagline: per-character positions are kept so letters can animate.
  const mctx = makeCanvas(4, 4).getContext('2d');
  // letters: optional designed letter positions (em, one per non-space character) for a single line,
  // used when a logo specifies exactly where its own text sits.
  function textPart(role, str, size, weight, tracking, lineH, color, align, upper, letters) {
    const lines = String(str || '').split('\n').map(s => (upper ? s.toUpperCase() : s).replace(/\s+$/, '')).filter((s, i, a) => s.length || a.length === 1);
    if (!lines.length || !lines.join('').trim()) return null;
    const font = `${weight} ${size}px ${LOM.fontStack(st.font)}`;
    mctx.font = font;
    const capH = mctx.measureText('H').actualBoundingBoxAscent || size * 0.72;
    const tr = tracking * size;
    const fixed = letters && lines.length === 1 && lines[0].replace(/ /g, '').length === letters.length;
    const L = lines.map((text, li) => {
      const chars = [];
      let k = 0;
      for (let i = 0; i < text.length; i++) {
        const cw = mctx.measureText(text[i]).width;
        let x0;
        if (fixed) x0 = text[i] === ' ' ? (chars.length ? chars[i - 1].x + chars[i - 1].w : 0) : letters[k++] * size + i * tr;
        // Position = width up to and including this letter, minus its own width, so the kerning
        // with the previous letter (T→e, A→V, …) moves this letter, not the one after it.
        else x0 = mctx.measureText(text.slice(0, i + 1)).width - cw + i * tr;
        chars.push({ ch: text[i], x: x0, w: cw });
      }
      const width = fixed ? chars[chars.length - 1].x + chars[chars.length - 1].w : mctx.measureText(text).width + Math.max(0, text.length - 1) * tr;
      const m = mctx.measureText(text);
      return { text, chars, width, baseline: capH + li * size * lineH, desc: m.actualBoundingBoxDescent || 0 };
    });
    const w = Math.max(...L.map(l => l.width));
    L.forEach(l => (l.x = align === 'center' ? (w - l.width) / 2 : align === 'right' ? w - l.width : 0));
    const last = L[L.length - 1];
    const visH = last.baseline;                       // cap top → last baseline (used for alignment)
    const h = last.baseline + Math.max(last.desc, size * 0.04);
    const cv = makeCanvas(w + pad * 2, h + pad * 2), x = cv.getContext('2d');
    x.font = font; x.fillStyle = color; x.textBaseline = 'alphabetic';
    for (const l of L) {
      if (tr === 0 && !fixed) x.fillText(l.text, pad + l.x, pad + l.baseline);
      else for (const ch of l.chars) x.fillText(ch.ch, pad + l.x + ch.x, pad + l.baseline);
    }
    let n = 0; L.forEach(l => l.chars.forEach(ch => (ch.i = ch.ch === ' ' ? -1 : n++)));
    return { role, canvas: cv, w, h, visH, pad, lines: L, font, color, size, count: n, capH };
  }

  // "As designed": the logo says where its text sits on top of the mark (in mark-height units).
  const info = LOM.logoInfo ? LOM.logoInfo(st.logoId) : null;
  const dz = st.layout === 'lockup' && mark && info && info.lockup ? info.lockup : null;
  const align = st.layout === 'horizontal' || dz ? 'left' : st.align;
  let text = null, tag = null;
  if (st.layout !== 'logo' && st.layout !== 'icon') {
    if (dz) {
      const exact = st.font === dz.font && +st.fontWeight === dz.weight && st.company === dz.text;
      text = textPart('text', st.company, dz.size * mark.h, st.fontWeight, st.tracking, st.lineHeight, c.text, 'left', false, exact ? dz.letters : null);
    } else text = textPart('text', st.company, st.textSize * u, st.fontWeight, st.tracking, st.lineHeight, c.text, align, false);
  }
  if (st.tagline && st.tagline.trim()) {
    tag = textPart('tag', st.tagline, st.tagSize * u, Math.min(700, st.fontWeight), 0.28, 1.2, st.tagColor === 'text' ? c.text : c.accent,
      st.layout === 'horizontal' ? 'left' : st.align, true);
  }

  // Arrange parts (positions = top-left of each visual box, relative to the lockup origin).
  const gap = st.gap * u;
  if (dz) {
    mark.x = 0; mark.y = 0;
    if (text) { text.x = dz.x * mark.h; text.y = dz.baseline * mark.h - text.capH; }
    if (tag) { tag.y = mark.h + st.tagSize * u * 0.9; tag.x = st.align === 'left' ? 0 : (mark.w - tag.w) / 2; }
  } else if (st.layout === 'horizontal' && mark && text) {
    const midText = text.visH / 2;
    mark.x = 0; mark.y = midText - mark.h / 2;
    text.x = mark.w + gap; text.y = 0;
    if (tag) { tag.x = text.x; tag.y = text.h + st.tagSize * u * 0.9; }
  } else {
    // stacked / logo / text / icon: vertical stack
    let y = 0;
    const stack = [mark, text, tag].filter(Boolean);
    const maxW = Math.max(...stack.map(p => p.w));
    stack.forEach((p, i) => {
      p.y = y;
      p.x = st.layout === 'horizontal' || align === 'center' ? (maxW - p.w) / 2 : 0;
      const next = stack[i + 1];
      y += p.h + (next === tag ? st.tagSize * u * 0.9 : gap * 0.9);
    });
  }
  [mark, text, tag].forEach(p => p && parts.push(p));
  if (!parts.length) {
    // nothing to show: keep an empty lockup so effects still run
    const cv = makeCanvas(pad * 2 + 2, pad * 2 + 2);
    parts.push({ role: 'none', canvas: cv, w: 2, h: 2, pad, x: 0, y: 0 });
  }
  // Centre the group on the canvas (an "as designed" logo is centred on its own artwork, not the text's metrics box).
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of dz ? [mark, tag].filter(Boolean) : parts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
  for (const p of parts) { p.x -= (x0 + x1) / 2; p.y -= (y0 + y1) / 2; }
  // the lockup canvas has to hold every part, even ones that poke out of the centring box
  x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
  for (const p of parts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
  const gw = x1 - x0, gh = y1 - y0;
  S.parts = { mark, text, tag };
  S.partList = parts.filter(p => p.role !== 'none');

  // The whole lockup on one canvas (used by emerge effects and whole-logo animations).
  const lk = makeCanvas(gw + pad * 2, gh + pad * 2), lx = lk.getContext('2d');
  for (const p of parts) lx.drawImage(p.canvas, p.x - x0 + pad - p.pad, p.y - y0 + pad - p.pad);
  S.lockup = { role: 'lockup', canvas: lk, x: x0, y: y0, w: gw, h: gh, pad };

  // Timing
  const start = st.delay, D = Math.max(0.2, st.revealDur);
  const hasMark = !!mark;
  S.timing = {
    start, D,
    textStart: hasMark ? start + st.textDelay : start,
    tagStart: (hasMark ? start + st.textDelay : start) + Math.max(0.15, st.textDelay * 0.8) + D * 0.25,
  };
  S.layer = makeCanvas(W, H);
  return S;
};

// Lockup pixels (lazy, cached): alpha / colour lookups and point samples for emerge effects.
LOM.lockupData = function (S) {
  if (S.cache.lkData) return S.cache.lkData;
  const c = S.lockup.canvas;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  return (S.cache.lkData = { w: c.width, h: c.height, px: d.data, ox: S.cx + S.lockup.x - S.lockup.pad, oy: S.cy + S.lockup.y - S.lockup.pad });
};
LOM.lockupAt = function (S, X, Y) { // absolute canvas coords → [r,g,b,a]
  const L = LOM.lockupData(S);
  const x = Math.round(X - L.ox), y = Math.round(Y - L.oy);
  if (x < 0 || y < 0 || x >= L.w || y >= L.h) return null;
  const i = (y * L.w + x) * 4;
  return L.px[i + 3] ? [L.px[i], L.px[i + 1], L.px[i + 2], L.px[i + 3]] : null;
};
LOM.samples = function (S, step) {
  step = Math.max(2, Math.round(step));
  const key = 'smp' + step;
  if (S.cache[key]) return S.cache[key];
  const L = LOM.lockupData(S), out = [];
  for (let y = Math.floor(step / 2); y < L.h; y += step) {
    for (let x = Math.floor(step / 2); x < L.w; x += step) {
      const i = (y * L.w + x) * 4, a = L.px[i + 3];
      if (a > 110) out.push({ x: L.ox + x, y: L.oy + y, col: `rgb(${L.px[i]},${L.px[i + 1]},${L.px[i + 2]})` });
    }
  }
  return (S.cache[key] = out);
};
// Group points by colour so drawing needs few fillStyle changes.
LOM.byColor = function (pts) {
  const m = new Map();
  pts.forEach((p, i) => { if (!m.has(p.col)) m.set(p.col, []); m.get(p.col).push(i); });
  return m;
};
// Outline ring of a part (for the line-draw animation).
LOM.outline = function (S, part, thick) {
  const key = 'ol:' + part.role;
  if (S.cache[key]) return S.cache[key];
  const src = part.canvas, c = makeCanvas(src.width, src.height), x = c.getContext('2d');
  const r = thick;
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; x.drawImage(src, Math.cos(a) * r, Math.sin(a) * r); }
  x.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; x.drawImage(src, Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25); }
  x.drawImage(src, 0, 0);
  return (S.cache[key] = c);
};

// Draw a part with a transform. Options: alpha, dx, dy, s, sx, sy, rot, skx, blur, ax, ay (anchor 0..1), src
LOM.drawPart = function (ctx, S, part, o = {}) {
  const a = o.alpha == null ? 1 : o.alpha;
  if (a <= 0.003) return;
  let src = o.src || part.canvas;
  if (o.blur > 0.6) src = blurred(src, o.blur, 'pb:' + part.role);
  const ax = o.ax == null ? 0.5 : o.ax, ay = o.ay == null ? 0.5 : o.ay;
  ctx.save();
  ctx.globalAlpha *= clamp(a);
  if (o.op) ctx.globalCompositeOperation = o.op;
  ctx.translate(S.cx + part.x + part.w * ax + (o.dx || 0), S.cy + part.y + part.h * ay + (o.dy || 0));
  if (o.rot) ctx.rotate(o.rot);
  if (o.skx) ctx.transform(1, 0, o.skx, 1, 0, 0);
  if (o.sky) ctx.transform(1, o.sky, 0, 1, 0, 0);
  const s = o.s == null ? 1 : o.s;
  const sx = (o.sx == null ? 1 : o.sx) * s, sy = (o.sy == null ? 1 : o.sy) * s;
  if (Math.abs(sx) < 1e-4 || Math.abs(sy) < 1e-4) { ctx.restore(); return; }
  ctx.scale(sx, sy);
  ctx.drawImage(src, -part.w * ax - part.pad, -part.h * ay - part.pad, part.canvas.width, part.canvas.height);
  ctx.restore();
};
// Per-character drawing for text parts. fn(char, index, count, line) → {alpha, dx, dy, s, rot, ch} | null
LOM.drawChars = function (ctx, S, part, fn) {
  ctx.save();
  ctx.font = part.font; ctx.fillStyle = part.color; ctx.textBaseline = 'alphabetic';
  const ox = S.cx + part.x, oy = S.cy + part.y;
  const base = ctx.globalAlpha;
  for (const l of part.lines) {
    for (const c of l.chars) {
      if (c.i < 0) continue;
      const o = fn(c, c.i, part.count, l);
      if (!o || (o.alpha != null && o.alpha <= 0.003)) continue;
      ctx.globalAlpha = base * clamp(o.alpha == null ? 1 : o.alpha);
      const px = ox + l.x + c.x + c.w / 2 + (o.dx || 0), py = oy + l.baseline + (o.dy || 0);
      if (o.s != null || o.rot) {
        ctx.save(); ctx.translate(px, py - part.capH / 2);
        if (o.rot) ctx.rotate(o.rot);
        if (o.s != null) ctx.scale(Math.max(1e-4, o.sx || o.s), Math.max(1e-4, o.s));
        ctx.fillText(o.ch || c.ch, -c.w / 2, part.capH / 2);
        ctx.restore();
      } else ctx.fillText(o.ch || c.ch, px - c.w / 2, py);
    }
  }
  ctx.restore();
};

// Shared background base: colour 1 fill with a soft colour 2 glow.
LOM.base = function (ctx, S, glow = 0.6, cyf = 0.48, radius = 0.75) {
  const { W, H, colors: c } = S;
  ctx.fillStyle = c.bgA; ctx.fillRect(0, 0, W, H);
  if (glow <= 0) return;
  const R = Math.max(W, H) * radius;
  const g = ctx.createRadialGradient(W / 2, H * cyf, 0, W / 2, H * cyf, R);
  g.addColorStop(0, rgba(c.bgB, glow)); g.addColorStop(0.55, rgba(c.bgB, glow * 0.35)); g.addColorStop(1, rgba(c.bgB, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
};
LOM.addOp = S => (S.dark ? 'lighter' : 'source-over');

// Grain textures (generated once).
let _grain = null;
function grainTex() {
  if (_grain) return _grain;
  _grain = [];
  for (let k = 0; k < 4; k++) {
    const c = makeCanvas(256, 256), x = c.getContext('2d'), d = x.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = Math.floor(hrand(i, 900 + k) * 255);
      d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255;
    }
    x.putImageData(d, 0, 0); _grain.push(c);
  }
  return _grain;
}

// ───────────────────────── frame ─────────────────────────
LOM.renderFrame = function (ctx, S, t) {
  const st = S.st, { W, H } = S;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  const L = S.layer.getContext('2d');
  L.setTransform(1, 0, 0, 1, 0, 0); L.globalAlpha = 1; L.globalCompositeOperation = 'source-over';
  L.clearRect(0, 0, W, H);

  // camera drift on the logo layer
  const cam = st.camera === 'in' ? 1 + 0.07 * Ease.inOutSine(clamp(t / st.duration)) :
    st.camera === 'out' ? 1.07 - 0.07 * Ease.outCubic(clamp(t / st.duration)) : 1;
  if (cam !== 1) { L.translate(S.cx, S.cy); L.scale(cam, cam); L.translate(-S.cx, -S.cy); }

  if (st.mode === 'emerge') {
    const fx = LOM.EMERGE[st.emerge] || Object.values(LOM.EMERGE)[0];
    const doneT = LOM.emergeDone(S, fx);
    // background: the effect's own, cross-fading into the chosen background once the logo has formed
    if (!st.transparent) {
      const nb = st.emergeBg && st.emergeBg !== 'own' ? LOM.BACKGROUNDS[st.emergeBg] : null;
      const k = nb ? smooth(doneT - 0.3, doneT + 0.9, t) : 0;
      if (k < 1) fx.bg(ctx, t, S);
      if (k >= 1) nb.draw(ctx, t, S);
      else if (k > 0) {
        const c = scratch('emergeBg', W, H);
        nb.draw(c.getContext('2d'), t, S);
        ctx.globalAlpha = k; ctx.drawImage(c, 0, 0); ctx.globalAlpha = 1;
      }
    }
    // logo: the chosen hold motion eases in after the reveal
    const hold = LOM.HOLD && LOM.HOLD[st.emergeHold];
    const amp = hold ? smooth(doneT - 0.1, doneT + 0.8, t) : 0;
    if (amp > 0 && hold.pre) hold.pre(L, t - doneT, S, amp);
    fx.fg(L, t, S, ctx);
    if (amp > 0 && hold.post) { L.save(); hold.post(L, t - doneT, S, amp); L.restore(); }
  } else {
    if (!st.transparent) (LOM.BACKGROUNDS[st.bg] || LOM.BACKGROUNDS.solid).draw(ctx, t, S);
    LOM.drawLogoAnim(L, t, S);
  }

  // outro: fade the logo out
  let layerAlpha = 1;
  const outT = Math.min(0.8, st.duration * 0.15);
  if (st.outro === 'logo') layerAlpha = 1 - Ease.inOutCubic(prog(t, st.duration - outT, outT));

  // bloom / glow
  if (st.glow > 0 && layerAlpha > 0) {
    const b = blurred(S.layer, 22 * S.u * (0.6 + st.glow), 'glow');
    ctx.save();
    ctx.globalCompositeOperation = S.dark || st.transparent ? 'lighter' : 'source-over';
    ctx.globalAlpha = clamp(st.glow * 0.9 * layerAlpha);
    ctx.drawImage(b, 0, 0, W, H);
    const b2 = blurred(S.layer, 70 * S.u, 'glow2');
    ctx.globalAlpha = clamp(st.glow * 0.6 * layerAlpha);
    ctx.drawImage(b2, 0, 0, W, H);
    ctx.restore();
  }
  ctx.globalAlpha = layerAlpha;
  ctx.drawImage(S.layer, 0, 0);
  ctx.globalAlpha = 1;

  if (!st.transparent) {
    if (st.vignette > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${(S.dark ? 0.75 : 0.18) * st.vignette})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (st.grain > 0) {
      const f = Math.floor(t * st.fps), tex = grainTex()[f % 4];
      ctx.save();
      ctx.globalAlpha = 0.09 * st.grain; ctx.globalCompositeOperation = S.dark ? 'screen' : 'multiply';
      const sc = Math.max(1, S.u * 1.2);
      ctx.translate(-hrand(f, 3) * 256 * sc, -hrand(f, 4) * 256 * sc); ctx.scale(sc, sc);
      ctx.fillStyle = ctx.createPattern(tex, 'repeat'); ctx.fillRect(0, 0, W / sc + 512, H / sc + 512);
      ctx.restore();
    }
    if (st.intro === 'fade') {
      const a = 1 - Ease.outQuad(prog(t, 0, Math.min(0.9, st.delay + 0.3)));
      if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H); }
    }
    if (st.outro === 'black') {
      const a = Ease.inOutCubic(prog(t, st.duration - outT, outT));
      if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H); }
    }
  }
};

Object.assign(LOM, { clamp, lerp, smooth, prog, Ease, hrand, vnoise, fbm, TAU, frac, hexToRgb, rgbToHex, rgba, mixHex, luminance,
  makeCanvas, scratch, blurred, tinted, roundRect });
LOM.BACKGROUNDS = LOM.BACKGROUNDS || {};
LOM.LOGO_ANIMS = LOM.LOGO_ANIMS || {};
LOM.TEXT_ANIMS = LOM.TEXT_ANIMS || {};
LOM.EMERGE = LOM.EMERGE || {};
