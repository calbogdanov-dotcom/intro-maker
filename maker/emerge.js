// Logo Opener Maker — "Emerge from background" direction.
// The background and the logo are one effect: bg(ctx,t,S) paints the scene, fg(L,t,S) paints the
// part of the effect that becomes the logo (on the glow layer).
'use strict';
(function () {
  const { clamp, lerp, smooth, prog, Ease, hrand, TAU, frac, rgba, mixHex } = LOM;
  const E = LOM.EMERGE;
  const lk = S => S.lockup;
  const drawLockup = (ctx, S, o) => LOM.drawPart(ctx, S, S.lockup, o);
  const maxR = S => Math.hypot(S.W, S.H) / 2;
  const accentLight = S => mixHex(S.colors.accent, S.dark ? '#ffffff' : S.colors.accent, 0.35);
  // Final "lock-in": the real, crisp logo fades over the effect.
  function settle(ctx, S, t, at, dur, flash = true) {
    const p = prog(t, at, dur);
    if (p <= 0) return 0;
    drawLockup(ctx, S, { alpha: Ease.outQuad(p) });
    if (flash && p < 1 && S.dark) {
      const w = LOM.tinted(lk(S).canvas, '#ffffff', 'settleflash');
      drawLockup(ctx, S, { src: w, alpha: 0.5 * Math.sin(p * Math.PI), op: 'lighter' });
    }
    return p;
  }

  // 1 ─ Particle assemble: drifting particles fly in and become the logo
  E.particles = {
    name: 'Particle assemble', icon: '⁘',
    bg(ctx, t, S) { LOM.BACKGROUNDS.particles.draw(ctx, t, S, { int: 0.6 * S.st.bgIntensity }); },
    fg(ctx, t, S) {
      const { start, D } = S.timing, u = S.u;
      const step = Math.max(3, Math.round(5 * u));
      const pts = LOM.samples(S, step), groups = S.cache.ptGroups || (S.cache.ptGroups = LOM.byColor(pts));
      const L = lk(S), lx0 = S.cx + L.x, R = Math.max(S.W, S.H);
      const endAt = start + D * 1.35, pEnd = prog(t, endAt, D * 0.35);
      if (pEnd < 1) {
        ctx.save(); ctx.globalAlpha = 1 - pEnd;
        for (const [col, idx] of groups) {
          ctx.fillStyle = col;
          for (const i of idx) {
            const pt = pts[i], r = k => hrand(i * 5 + k, S.seed + 201);
            const ang = r(0) * TAU, dist = (0.25 + 0.75 * r(1)) * R * 0.6;
            const sx = S.cx + Math.cos(ang) * dist + Math.sin(t * 0.7 + r(2) * TAU) * 30 * u;
            const sy = S.cy + Math.sin(ang) * dist * 0.75 + Math.cos(t * 0.6 + r(3) * TAU) * 30 * u;
            const delay = ((pt.x - lx0) / Math.max(1, L.w)) * 0.35 * D + r(4) * 0.3 * D;
            const pi = prog(t, start + delay, D * 0.7), e = Ease.inOutCubic(pi);
            const sw = Math.sin(pi * Math.PI) * (r(2) - 0.5) * 260 * u;
            const x = lerp(sx, pt.x, e) - Math.sin(ang) * sw, y = lerp(sy, pt.y, e) + Math.cos(ang) * sw;
            const s = step * lerp(0.7, 0.95, e);
            ctx.globalAlpha = (1 - pEnd) * (0.45 + 0.55 * e);
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
          }
        }
        ctx.restore();
      }
      settle(ctx, S, t, endAt, D * 0.35);
    },
  };

  // 2 ─ Halftone dots: a dot grid ripples out from the centre, dots inside the logo swell into it
  E.halftone = {
    name: 'Halftone dots', icon: '⠿',
    bg(ctx, t, S) {
      LOM.base(ctx, S, 0.45);
      this._grid(ctx, t, S, false);
    },
    fg(ctx, t, S) { this._grid(ctx, t, S, true); settle(ctx, S, t, S.timing.start + S.timing.D * 0.95, S.timing.D * 0.4, false); },
    _grid(ctx, t, S, inside) {
      const { start, D } = S.timing, u = S.u, g = 16 * u, mR = maxR(S);
      const R = Ease.inOutCubic(prog(t, start, D * 1.2)) * (mR + 300 * u);
      const pF = prog(t, start + D * 0.95, D * 0.4);
      const cols = Math.ceil(S.W / g / 2) + 1, rows = Math.ceil(S.H / g / 2) + 1;
      const col = accentLight(S), band = 240 * u;
      const paths = inside ? new Map() : Array.from({ length: 6 }, () => new Path2D());
      for (let j = -rows; j <= rows; j++) for (let i = -cols; i <= cols; i++) {
        const x = S.cx + i * g, y = S.cy + j * g, d = Math.hypot(x - S.cx, y - S.cy);
        const k = clamp((R - d) / band);
        const px = LOM.lockupAt(S, x, y);
        const inLogo = px && px[3] > 120;
        if (inside) {
          if (!inLogo || k <= 0 || pF >= 1) continue;
          const r = lerp(g * 0.1, g * 0.72, Ease.outBack(k, 1.6)) * (1 - pF * 0.15);
          const key = `rgb(${px[0]},${px[1]},${px[2]})`;
          if (!paths.has(key)) paths.set(key, new Path2D());
          const p = paths.get(key); p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU);
        } else {
          if (inLogo && k > 0.05) continue;
          const pulse = Math.sin(k * Math.PI);
          const shimmer = 0.5 + 0.5 * Math.sin(t * 1.4 - d * 0.012 / u);
          const r = g * (0.08 + 0.2 * pulse);
          const a = 0.12 + 0.45 * pulse + 0.08 * shimmer * (k >= 1 ? 1 : 0);
          const b = Math.min(5, Math.floor(a * 6));
          paths[b].moveTo(x + r, y); paths[b].arc(x, y, r, 0, TAU);
        }
      }
      if (inside) { ctx.save(); ctx.globalAlpha = 1 - pF; for (const [k, p] of paths) { ctx.fillStyle = k; ctx.fill(p); } ctx.restore(); }
      else paths.forEach((p, b) => { ctx.fillStyle = rgba(col, (b + 0.5) / 6 * (S.dark ? 0.8 : 0.6)); ctx.fill(p); });
    },
  };

  // 3 ─ Pixel blocks: the logo is built from the background's own tile grid
  E.blocks = {
    name: 'Pixel blocks', icon: '▞',
    cells(S) {
      if (S.cache.blocks) return S.cache.blocks;
      const L = lk(S), b = Math.max(5 * S.u, Math.min(L.h / 15, 28 * S.u));
      const D = LOM.lockupData(S), out = [];
      const x0 = S.cx + L.x, y0 = S.cy + L.y;
      for (let y = y0; y < y0 + L.h; y += b) for (let x = x0; x < x0 + L.w; x += b) {
        let a = 0, n = 0, rgb = [0, 0, 0], m = 0;
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
          const px = LOM.lockupAt(S, x + (sx + 0.5) * b / 3, y + (sy + 0.5) * b / 3); n++;
          if (px) { a += px[3] / 255; rgb[0] += px[0]; rgb[1] += px[1]; rgb[2] += px[2]; m++; }
        }
        if (a / n > 0.3) out.push({ x, y, col: `rgb(${(rgb[0] / m) | 0},${(rgb[1] / m) | 0},${(rgb[2] / m) | 0})` });
      }
      return (S.cache.blocks = { b, cells: out, ox: x0, oy: y0 });
    },
    bg(ctx, t, S) {
      LOM.base(ctx, S, 0.4);
      const { b, ox, oy } = this.cells(S), col = accentLight(S);
      ctx.save();
      // faint grid lines aligned to the logo's blocks
      ctx.strokeStyle = rgba(col, S.dark ? 0.06 : 0.1); ctx.lineWidth = Math.max(1, S.u);
      ctx.beginPath();
      for (let x = ox - Math.ceil(ox / b) * b; x < S.W; x += b) { ctx.moveTo(x, 0); ctx.lineTo(x, S.H); }
      for (let y = oy - Math.ceil(oy / b) * b; y < S.H; y += b) { ctx.moveTo(0, y); ctx.lineTo(S.W, y); }
      ctx.stroke();
      // tiles blinking in the background
      const nx = Math.ceil(S.W / b) + 1, ny = Math.ceil(S.H / b) + 1, x0 = ox - Math.ceil(ox / b) * b, y0 = oy - Math.ceil(oy / b) * b;
      const n = Math.round(nx * ny * 0.05 * S.st.bgIntensity);
      for (let i = 0; i < n; i++) {
        const cx = Math.floor(hrand(i, S.seed + 301) * nx), cy = Math.floor(hrand(i, S.seed + 302) * ny);
        const a = Math.max(0, Math.sin(t * (0.8 + hrand(i, S.seed + 303) * 1.5) * S.st.bgSpeed + hrand(i, S.seed + 304) * TAU));
        ctx.fillStyle = rgba(col, a * (S.dark ? 0.16 : 0.22));
        ctx.fillRect(x0 + cx * b + 1, y0 + cy * b + 1, b - 2, b - 2);
      }
      ctx.restore();
    },
    fg(ctx, t, S) {
      const { start, D } = S.timing, { b, cells, ox } = this.cells(S), L = lk(S);
      const pF = prog(t, start + D * 1.05, D * 0.4);
      if (pF < 1) {
        ctx.save(); ctx.globalAlpha = 1 - pF;
        cells.forEach((c, i) => {
          const delay = ((c.x - ox) / Math.max(1, L.w)) * 0.55 * D + hrand(i, S.seed + 305) * 0.3 * D;
          const p = prog(t, start + delay, D * 0.3);
          if (p <= 0) return;
          const s = Math.max(0, Ease.outBack(p, 2.4)) * b * lerp(0.86, 1.02, pF);
          ctx.fillStyle = c.col; ctx.fillRect(c.x + (b - s) / 2, c.y + (b - s) / 2, s, s);
        });
        ctx.restore();
      }
      settle(ctx, S, t, start + D * 1.05, D * 0.4, false);
    },
  };

  // 4 ─ Ink bleed: organic ink spreads out, the logo blooms with it
  function blob(ctx, cx, cy, R, seed, t, wob = 0.1) {
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * TAU;
      let r = 1;
      for (let k = 2; k <= 7; k++) r += (wob / k) * Math.sin(k * a + hrand(k, seed) * TAU + t * (0.4 + hrand(k, seed + 1)));
      const x = cx + Math.cos(a) * R * r, y = cy + Math.sin(a) * R * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  E.ink = {
    name: 'Ink bleed', icon: '❂',
    bg(ctx, t, S) {
      const { start, D } = S.timing, c = S.colors, M = maxR(S) * 1.25;
      ctx.fillStyle = mixHex(c.bgA, '#000000', S.dark ? 0.3 : 0.06); ctx.fillRect(0, 0, S.W, S.H);
      const r1 = Ease.outCubic(prog(t, start - D * 0.15, D * 1.3)) * M;
      const r2 = Ease.outCubic(prog(t, start - D * 0.04, D * 1.3)) * M;
      if (r1 > 0) {
        ctx.fillStyle = c.accent; blob(ctx, S.cx, S.cy, r1, S.seed + 401, t, 0.14); ctx.fill();
        // droplets thrown out at the edge
        for (let i = 0; i < 16; i++) {
          const a = hrand(i, S.seed + 402) * TAU, d = r1 * (1.05 + 0.25 * hrand(i, S.seed + 403));
          const s = (6 + 22 * hrand(i, S.seed + 404)) * S.u * smooth(0, 0.3, r1 / M) * (1 - smooth(0.7, 1, r1 / M));
          if (s > 0.5) { blob(ctx, S.cx + Math.cos(a) * d, S.cy + Math.sin(a) * d, s, S.seed + 410 + i, t, 0.3); ctx.fill(); }
        }
      }
      if (r2 > 0) {
        ctx.save(); blob(ctx, S.cx, S.cy, r2, S.seed + 405, t, 0.12); ctx.clip();
        LOM.base(ctx, S, 0.55); ctx.restore();
      }
    },
    fg(ctx, t, S) {
      const { start, D } = S.timing, L = lk(S);
      const r = Ease.outCubic(prog(t, start + D * 0.25, D * 1.1)) * Math.hypot(L.w, L.h) * 0.62;
      if (r <= 0) return;
      ctx.save(); blob(ctx, S.cx, S.cy, r, S.seed + 406, t, 0.22); ctx.clip();
      drawLockup(ctx, S, { s: lerp(1.06, 1, Ease.outCubic(prog(t, start + D * 0.25, D * 1.3))) });
      ctx.restore();
    },
  };

  // 5 ─ Smoke dissolve: fog drifts, the logo condenses out of it with glowing edges
  E.smoke = {
    name: 'Smoke dissolve', icon: '≈',
    noise(S) {
      if (S.cache.smokeNoise) return S.cache.smokeNoise;
      const c = lk(S).canvas, w = c.width, h = c.height, f = 3;
      const lw = Math.ceil(w / f) + 2, lh = Math.ceil(h / f) + 2, low = new Float32Array(lw * lh);
      const sc = 90 * S.u / f;
      for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) low[j * lw + i] = LOM.fbm(i / sc, j / sc, S.seed + 501, 4) * 0.85 + 0.15 * (1 - Math.abs(i / lw - 0.5) * 2);
      const n = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const fx = x / f, fy = y / f, ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy;
        const a = low[iy * lw + ix], b = low[iy * lw + ix + 1], c2 = low[(iy + 1) * lw + ix], d = low[(iy + 1) * lw + ix + 1];
        n[y * w + x] = lerp(lerp(a, b, ax), lerp(c2, d, ax), ay);
      }
      let lo = 1, hi = 0; for (const v of n) { if (v < lo) lo = v; if (v > hi) hi = v; }
      for (let i = 0; i < n.length; i++) n[i] = (n[i] - lo) / (hi - lo || 1);
      return (S.cache.smokeNoise = n);
    },
    bg(ctx, t, S) { LOM.BACKGROUNDS.smoke.draw(ctx, t, S); },
    fg(ctx, t, S) {
      const { start, D } = S.timing, p = prog(t, start, D * 1.5);
      if (p <= 0) return;
      const L = lk(S), src = L.canvas, w = src.width, h = src.height;
      if (p >= 1) { drawLockup(ctx, S); return; }
      const Ld = LOM.lockupData(S), N = this.noise(S);
      const th = lerp(1.08, -0.1, Ease.inOutSine(p)), e = 0.07;
      const out = LOM.scratch('smokeOut', w, h), ox = out.getContext('2d');
      const id = ox.createImageData(w, h), d = id.data, px = Ld.px;
      const acc = LOM.hexToRgb(mixHex(S.colors.accent, '#ffffff', 0.5));
      for (let i = 0, n = w * h; i < n; i++) {
        const a = px[i * 4 + 3]; if (!a) continue;
        const v = N[i], m = clamp((v - th + e) / (2 * e));
        const edge = clamp(1 - Math.abs(v - th) / (e * 1.6)) * (1 - m * 0.5);
        const q = i * 4;
        d[q] = lerp(px[q], acc[0], edge); d[q + 1] = lerp(px[q + 1], acc[1], edge); d[q + 2] = lerp(px[q + 2], acc[2], edge);
        d[q + 3] = a * Math.max(m * m * (3 - 2 * m), edge * 0.9);
      }
      ox.putImageData(id, 0, 0);
      drawLockup(ctx, S, { src: out, dy: (1 - Ease.outCubic(p)) * 14 * S.u });
      // wisps of smoke rising off the forming letters
      LOM.drawPart(ctx, S, L, { src: out, alpha: 0.35 * (1 - p), blur: 18 * S.u, dy: -20 * S.u * p, s: 1.03 });
    },
  };

  // 6 ─ Light sweep: a beam passes across the frame and leaves the logo lit behind it
  E.light = {
    name: 'Light sweep', icon: '⟋',
    beam(t, S) {
      const { start, D } = S.timing;
      const p = Ease.inOutCubic(prog(t, start, D * 1.4));
      return { p, x: lerp(-0.35 * S.W, 1.35 * S.W, p), slope: 0.35 };
    },
    bg(ctx, t, S) {
      LOM.base(ctx, S, 0.35);
      const { x, p, slope } = this.beam(t, S), c = S.colors, light = mixHex(c.accent, '#ffffff', 0.55);
      if (p <= 0 || p >= 1) return;
      ctx.save(); ctx.globalCompositeOperation = LOM.addOp(S);
      ctx.translate(x, S.H / 2); ctx.transform(1, 0, -slope, 1, 0, 0);
      const w = S.W * 0.28;
      const g = ctx.createLinearGradient(-w, 0, w, 0);
      g.addColorStop(0, rgba(light, 0)); g.addColorStop(0.5, rgba(light, 0.22)); g.addColorStop(1, rgba(light, 0));
      ctx.fillStyle = g; ctx.fillRect(-w, -S.H, w * 2, S.H * 2);
      const g2 = ctx.createLinearGradient(-w * 0.12, 0, w * 0.12, 0);
      g2.addColorStop(0, rgba(light, 0)); g2.addColorStop(0.5, rgba(light, 0.35)); g2.addColorStop(1, rgba(light, 0));
      ctx.fillStyle = g2; ctx.fillRect(-w * 0.12, -S.H, w * 0.24, S.H * 2);
      ctx.restore();
    },
    fg(ctx, t, S) {
      const { x, p, slope } = this.beam(t, S), L = lk(S), u = S.u;
      if (p <= 0) return;
      const src = L.canvas, w = src.width, h = src.height;
      const ox = S.cx + L.x - L.pad, oy = S.cy + L.y - L.pad;
      // revealed part: everything the beam has passed (soft edge)
      const m = LOM.scratch('lsMask', w, h), mx = m.getContext('2d');
      mx.drawImage(src, 0, 0);
      mx.globalCompositeOperation = 'destination-in';
      mx.translate(x - ox, S.H / 2 - oy); mx.transform(1, 0, -slope, 1, 0, 0);
      const f = 90 * u, g = mx.createLinearGradient(-f, 0, f * 0.3, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      mx.fillStyle = g; mx.fillRect(-S.W * 4, -S.H * 3, S.W * 8, S.H * 6);
      drawLockup(ctx, S, { src: m });
      // hot highlight where the beam crosses the logo
      if (p < 1) {
        const hl = LOM.scratch('lsHL', w, h), hx = hl.getContext('2d');
        hx.drawImage(LOM.tinted(src, '#ffffff', 'lsW'), 0, 0);
        hx.globalCompositeOperation = 'destination-in';
        hx.translate(x - ox, S.H / 2 - oy); hx.transform(1, 0, -slope, 1, 0, 0);
        const bw = 120 * u, g2 = hx.createLinearGradient(-bw, 0, bw, 0);
        g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(0.5, 'rgba(0,0,0,1)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
        hx.fillStyle = g2; hx.fillRect(-S.W * 4, -S.H * 3, S.W * 8, S.H * 6);
        drawLockup(ctx, S, { src: hl, alpha: 0.9, op: S.dark ? 'lighter' : 'source-over' });
        // anamorphic flare
        const lx0 = S.cx + L.x, lx1 = lx0 + L.w;
        const over = smooth(lx0 - 200 * u, lx0, x) * (1 - smooth(lx1, lx1 + 200 * u, x));
        if (over > 0) {
          const light = mixHex(S.colors.accent, '#ffffff', 0.6);
          ctx.save(); ctx.globalCompositeOperation = S.dark ? 'lighter' : 'source-over';
          ctx.translate(x - slope * 0, S.cy); ctx.scale(1, 0.035);
          const r = S.W * 0.45, gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
          gr.addColorStop(0, rgba(light, 0.85 * over)); gr.addColorStop(1, rgba(light, 0));
          ctx.fillStyle = gr; ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore();
        }
      }
    },
  };

  // 7 ─ Glitch decode: digital noise resolves into the logo
  E.glitch = {
    name: 'Glitch decode', icon: '▓',
    level(t, S) {
      const { start, D } = S.timing;
      const settleI = 1 - smooth(start + D * 0.5, start + D * 1.4, t);
      const f = Math.floor(t * S.fps);
      const burst = hrand(Math.floor(t * 3), S.seed + 601) < 0.08 && t > start + D * 1.6 ? 0.5 : 0;
      return { I: Math.max(settleI, burst), f };
    },
    bg(ctx, t, S) {
      LOM.base(ctx, S, 0.35);
      const { I, f } = this.level(t, S), u = S.u, col = accentLight(S);
      ctx.save();
      // scanlines
      ctx.fillStyle = S.dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)';
      for (let y = (f * 2) % Math.max(3, Math.round(4 * u)); y < S.H; y += Math.max(3, Math.round(4 * u))) ctx.fillRect(0, y, S.W, Math.max(1, u));
      // digital blocks
      const n = Math.round((4 + 34 * I) * S.st.bgIntensity);
      for (let i = 0; i < n; i++) {
        const r = k => hrand(i * 7 + k + f * 131, S.seed + 602);
        ctx.fillStyle = rgba(r(0) < 0.5 ? col : S.colors.bgB, (0.05 + 0.3 * r(1)) * (0.3 + I));
        ctx.fillRect(r(2) * S.W, r(3) * S.H, (20 + 360 * r(4) * r(4)) * u, (2 + 26 * r(5) * r(5)) * u);
      }
      ctx.restore();
    },
    fg(ctx, t, S) {
      const { start, D } = S.timing, { I, f } = this.level(t, S), u = S.u;
      const p = prog(t, start, D * 1.1);
      if (p <= 0) return;
      const L = lk(S), src = L.canvas, n = 22, h = src.height / n;
      const X = S.cx + L.x - L.pad, Y = S.cy + L.y - L.pad;
      const split = (3 + 26 * I) * u;
      if (I > 0.02) {
        const op = S.dark ? 'lighter' : 'multiply';
        drawLockup(ctx, S, { src: LOM.tinted(src, S.dark ? '#00e5ff' : '#00b8d4', 'egc'), dx: -split, alpha: 0.7 * Math.min(1, I * 2) * p, op });
        drawLockup(ctx, S, { src: LOM.tinted(src, S.dark ? '#ff2bd6' : '#ff1fb4', 'egm'), dx: split, alpha: 0.7 * Math.min(1, I * 2) * p, op });
      }
      for (let i = 0; i < n; i++) {
        const r = k => hrand(i * 11 + k + f * 97, S.seed + 603);
        if (r(0) > p * 1.3) continue;
        const off = r(1) < 0.4 ? (r(2) - 0.5) * 160 * u * I : 0;
        ctx.drawImage(src, 0, i * h, src.width, h + 1, X + off, Y + i * h, src.width, h + 1);
      }
    },
  };

  // 8 ─ Shatter assemble: shards fly in and lock together into the logo
  E.shatter = {
    name: 'Shatter assemble', icon: '◆',
    tris(S) {
      if (S.cache.tris) return S.cache.tris;
      const L = lk(S), m = 14 * S.u;
      const x0 = S.cx + L.x - m, y0 = S.cy + L.y - m, w = L.w + 2 * m, h = L.h + 2 * m;
      const nx = 14, ny = Math.max(3, Math.round((nx * h) / w));
      const V = [];
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const edge = i === 0 || j === 0 || i === nx || j === ny;
        const jx = edge ? 0 : (hrand(i * 31 + j, S.seed + 701) - 0.5) * 0.7, jy = edge ? 0 : (hrand(i * 17 + j, S.seed + 702) - 0.5) * 0.7;
        V.push([x0 + ((i + jx) / nx) * w, y0 + ((j + jy) / ny) * h]);
      }
      const T = [];
      const v = (i, j) => V[j * (nx + 1) + i];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const flip = hrand(i * 7 + j, S.seed + 703) < 0.5;
        const q = [v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)];
        (flip ? [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] : [[q[0], q[1], q[3]], [q[1], q[2], q[3]]]).forEach(tri => {
          const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          // skip shards with no logo pixels inside
          let hit = false;
          for (const [a, b] of [[0.33, 0.33], [0.6, 0.2], [0.2, 0.6], [0.1, 0.1], [0.45, 0.45]]) {
            const px = tri[0][0] + (tri[1][0] - tri[0][0]) * a + (tri[2][0] - tri[0][0]) * b;
            const py = tri[0][1] + (tri[1][1] - tri[0][1]) * a + (tri[2][1] - tri[0][1]) * b;
            const c = LOM.lockupAt(S, px, py); if (c && c[3] > 20) { hit = true; break; }
          }
          if (hit) T.push({ tri, cx, cy });
        });
      }
      return (S.cache.tris = T);
    },
    bg(ctx, t, S) {
      LOM.base(ctx, S, 0.45);
      const col = accentLight(S), u = S.u;
      ctx.save(); ctx.lineWidth = Math.max(1, u);
      for (let i = 0; i < Math.round(22 * S.st.bgIntensity); i++) {
        const r = k => hrand(i * 9 + k, S.seed + 704);
        const x = frac(r(0) + 0.01 * t * (r(1) - 0.5) * S.st.bgSpeed) * S.W, y = frac(r(2) + 0.012 * t * (r(3) - 0.5) * S.st.bgSpeed) * S.H;
        const s = (20 + 70 * r(4)) * u, a = r(5) * TAU + t * (r(6) - 0.5) * 0.6 * S.st.bgSpeed;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) { const aa = a + k * (TAU / 3) + (r(7 + k) - 0.5); const px = x + Math.cos(aa) * s, py = y + Math.sin(aa) * s * 0.7; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.closePath();
        ctx.fillStyle = rgba(col, S.dark ? 0.035 : 0.06); ctx.fill();
        ctx.strokeStyle = rgba(col, S.dark ? 0.14 : 0.2); ctx.stroke();
      }
      ctx.restore();
    },
    fg(ctx, t, S) {
      const { start, D } = S.timing, L = lk(S), u = S.u;
      const done = start + D * 1.15;
      if (t >= done) { settle(ctx, S, t, done, 0.25); return; }
      const T = this.tris(S), Rn = Math.hypot(L.w, L.h) / 2, col = accentLight(S);
      const lx = S.cx + L.x - L.pad, ly = S.cy + L.y - L.pad;
      T.forEach((s, i) => {
        const r = k => hrand(i * 7 + k, S.seed + 705);
        const dn = Math.hypot(s.cx - S.cx, s.cy - S.cy) / Rn;
        const delay = dn * 0.35 * D + r(0) * 0.15 * D;
        const p = prog(t, start + delay, D * 0.6);
        if (p <= 0) return;
        const e = Ease.outCubic(p);
        const ang = Math.atan2(s.cy - S.cy, s.cx - S.cx) + (r(1) - 0.5) * 1.2;
        const dist = (300 + 700 * r(2)) * u;
        const ox = Math.cos(ang) * dist * (1 - e), oy = Math.sin(ang) * dist * (1 - e);
        const rot = (r(3) - 0.5) * 4 * (1 - e), sc = lerp(0.3 + 1.4 * r(4), 1, e);
        ctx.save();
        ctx.globalAlpha = clamp(p * 3);
        ctx.translate(s.cx + ox, s.cy + oy); ctx.rotate(rot); ctx.scale(sc, sc); ctx.translate(-s.cx, -s.cy);
        ctx.beginPath(); ctx.moveTo(...s.tri[0]); ctx.lineTo(...s.tri[1]); ctx.lineTo(...s.tri[2]); ctx.closePath();
        ctx.save(); ctx.clip(); ctx.drawImage(L.canvas, lx, ly); ctx.restore();
        if (e < 1) { ctx.strokeStyle = rgba(col, 0.55 * (1 - e)); ctx.lineWidth = Math.max(1, 1.2 * u); ctx.stroke(); }
        ctx.restore();
      });
    },
  };

  // 9 ─ Ripple: a drop hits the surface, the shockwave reveals the logo
  E.ripple = {
    name: 'Ripple reveal', icon: '◉',
    bg(ctx, t, S) {
      LOM.base(ctx, S, 0.45);
      const { start, D } = S.timing, u = S.u, M = maxR(S), col = accentLight(S);
      ctx.save(); ctx.globalCompositeOperation = LOM.addOp(S);
      // the drop
      const pd = prog(t, start - 0.35, 0.35);
      if (pd > 0 && pd < 1) {
        const r = 10 * u * Ease.outBack(pd);
        const g = ctx.createRadialGradient(S.cx, S.cy, 0, S.cx, S.cy, r * 4);
        g.addColorStop(0, rgba(col, 0.9)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(S.cx - r * 4, S.cy - r * 4, r * 8, r * 8);
      }
      const speed = M / (D * 1.2);
      for (let k = 0; k < 7; k++) {
        const t0 = start + k * D * 0.16;
        if (t < t0) continue;
        const r = (t - t0) * speed * (1 - k * 0.06);
        const f = clamp(1 - r / M);
        if (f <= 0) continue;
        ctx.strokeStyle = rgba(col, 0.55 * f * (k === 0 ? 1 : 0.5));
        ctx.lineWidth = Math.max(1, (k === 0 ? 4 : 2) * u * f + 0.5);
        ctx.beginPath(); ctx.ellipse(S.cx, S.cy, r, r * 0.92, 0, 0, TAU); ctx.stroke();
      }
      // gentle ambient rings afterwards
      const amb = smooth(start + D, start + D * 2, t);
      for (let k = 0; k < 4; k++) {
        const r = frac(t * 0.12 * S.st.bgSpeed + k / 4) * M;
        ctx.strokeStyle = rgba(col, 0.07 * amb * (1 - r / M)); ctx.lineWidth = Math.max(1, u);
        ctx.beginPath(); ctx.arc(S.cx, S.cy, r, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    },
    fg(ctx, t, S) {
      const { start, D } = S.timing, u = S.u, L = lk(S), src = L.canvas, M = maxR(S);
      const R = (t - start) * (M / (D * 1.2));
      if (R <= 0) return;
      const w = src.width, h = src.height, X = S.cx + L.x - L.pad, Y = S.cy + L.y - L.pad;
      const wob = 1 - Ease.outCubic(prog(t, start, D * 1.6));
      const c = LOM.scratch('ripple', w, h), x = c.getContext('2d');
      const strip = Math.max(2, Math.round(3 * u));
      for (let y = 0; y < h; y += strip) {
        const dx = Math.sin(y * 0.05 / u + t * 14) * 16 * u * wob;
        x.drawImage(src, 0, y, w, strip, dx, y, w, strip);
      }
      // circular soft-edged mask
      x.globalCompositeOperation = 'destination-in';
      const cx = S.cx - X, cy = S.cy - Y, f = 70 * u;
      const g = x.createRadialGradient(cx, cy, Math.max(0, R - f), cx, cy, R);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      LOM.drawPart(ctx, S, L, { src: c, s: 1 + 0.04 * wob * Math.sin(t * 9) });
    },
  };

  // 10 ─ Light streaks converge into the logo
  E.streaks = {
    name: 'Streak converge', icon: '⇉',
    rows(S) {
      if (S.cache.rows) return S.cache.rows;
      const Ld = LOM.lockupData(S), step = Math.max(3, Math.round(7 * S.u)), out = [];
      for (let y = 0; y < Ld.h; y += step) {
        let x0 = -1, x1 = -1, col = null;
        for (let x = 0; x < Ld.w; x++) {
          const i = (y * Ld.w + x) * 4;
          if (Ld.px[i + 3] > 120) { if (x0 < 0) { x0 = x; col = `${Ld.px[i]},${Ld.px[i + 1]},${Ld.px[i + 2]}`; } x1 = x; }
        }
        if (x0 >= 0) out.push({ y: Ld.oy + y, x0: Ld.ox + x0, x1: Ld.ox + x1, col });
      }
      return (S.cache.rows = out);
    },
    bg(ctx, t, S) {
      LOM.base(ctx, S, 0.4);
      const { start, D } = S.timing, u = S.u, col = accentLight(S);
      const speed = lerp(1, 0.08, smooth(start, start + D * 1.4, t)) * S.st.bgSpeed;
      ctx.save(); ctx.globalCompositeOperation = LOM.addOp(S);
      const n = Math.round(50 * S.st.bgIntensity);
      for (let i = 0; i < n; i++) {
        const r = k => hrand(i * 5 + k, S.seed + 801);
        const dir = r(0) < 0.5 ? 1 : -1, len = (100 + 500 * r(1)) * u * (0.3 + speed);
        const x = frac(r(2) + dir * t * (0.15 + 0.5 * r(3)) * speed) * (S.W + len * 2) - len;
        const y = r(4) * S.H;
        const g = ctx.createLinearGradient(x - dir * len, 0, x, 0);
        g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, (0.08 + 0.2 * r(5)) * (0.4 + speed)));
        ctx.fillStyle = g; ctx.fillRect(Math.min(x, x - dir * len), y, len, Math.max(1, 1.5 * u));
      }
      ctx.restore();
    },
    fg(ctx, t, S) {
      const { start, D } = S.timing, u = S.u, rows = this.rows(S);
      ctx.save(); ctx.globalCompositeOperation = S.dark ? 'lighter' : 'source-over';
      rows.forEach((r, i) => {
        for (const side of [-1, 1]) {
          const rr = k => hrand(i * 4 + k + (side > 0 ? 1000 : 0), S.seed + 802);
          const p = prog(t, start + rr(0) * D * 0.45, D * 0.5);
          if (p <= 0 || p >= 1) continue;
          const e = Ease.outExpo(p);
          const target = side < 0 ? r.x0 : r.x1;
          const from = side < 0 ? -0.2 * S.W : 1.2 * S.W;
          const head = lerp(from, target, e);
          const len = lerp(0.5 * S.W, 10 * u, e);
          const a = (1 - smooth(0.7, 1, p)) * 0.9;
          const g = ctx.createLinearGradient(head - side * len, 0, head, 0);
          g.addColorStop(0, `rgba(${r.col},0)`); g.addColorStop(1, `rgba(${r.col},${a})`);
          ctx.fillStyle = g;
          ctx.fillRect(Math.min(head, head - side * len), r.y - 1.2 * u, len, 2.4 * u);
        }
      });
      ctx.restore();
      const p = prog(t, start + D * 0.4, D * 0.55);
      if (p <= 0) return;
      const e = Ease.outExpo(p);
      const sx = lerp(2.6, 1, e);
      if (p < 1) for (let k = -2; k <= 2; k++) drawLockup(ctx, S, { sx, alpha: 0.18 * p, dx: k * 40 * u * (1 - e) });
      drawLockup(ctx, S, { sx, alpha: Ease.outQuad(p) });
      if (p < 1 && S.dark) drawLockup(ctx, S, { sx, src: LOM.tinted(lk(S).canvas, '#ffffff', 'stw'), alpha: 0.6 * (1 - e), op: 'lighter' });
    },
  };

  // 11 ─ From one point: background and logo burst out of the same spot together
  E.burst = {
    name: 'From one point', icon: '✹',
    disc(t, S) {
      const { start, D } = S.timing;
      const p = prog(t, start, D * 1.15);
      return { p, R: Ease.outExpo(p) * maxR(S) * 1.08, ox: S.cx, oy: S.cy };
    },
    bg(ctx, t, S) {
      const { start, D } = S.timing, u = S.u, c = S.colors, col = accentLight(S);
      const { p, R, ox, oy } = this.disc(t, S), M = maxR(S);
      // the void before the scene opens
      ctx.fillStyle = mixHex(c.bgA, '#000000', 0.8); ctx.fillRect(0, 0, S.W, S.H);
      if (R <= 0.5) return;
      ctx.save();
      ctx.beginPath(); ctx.arc(ox, oy, R, 0, TAU); ctx.clip();
      ctx.fillStyle = c.bgA; ctx.fillRect(0, 0, S.W, S.H);
      // glow grows out with the disc
      const gR = Math.max(1, Math.min(R * 1.1, M * 0.8));
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, gR);
      g.addColorStop(0, rgba(c.bgB, 0.85)); g.addColorStop(0.5, rgba(c.bgB, 0.3)); g.addColorStop(1, rgba(c.bgB, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, S.W, S.H);
      // particles streaming out of the same spot
      ctx.globalCompositeOperation = LOM.addOp(S);
      const n = Math.round(140 * S.st.bgIntensity), sp = S.st.bgSpeed;
      for (let i = 0; i < n; i++) {
        const r = k => hrand(i * 6 + k, S.seed + 901);
        const a = r(0) * TAU, z = 0.3 + 0.7 * r(1);
        // a fast burst while the scene opens, then a slow outward drift
        const d = (frac(r(2) + (t - start) * 0.035 * sp * z) * 0.9 + Ease.outExpo(p) * 0.25 * r(3)) * M;
        if (d > R) continue;
        const x = ox + Math.cos(a) * d, y = oy + Math.sin(a) * d * 0.9;
        const al = (0.15 + 0.6 * z) * smooth(0, 0.15 * M, d) * (0.6 + 0.4 * Math.sin(t * 2 + r(4) * TAU));
        ctx.fillStyle = rgba(col, al);
        ctx.beginPath(); ctx.arc(x, y, (0.8 + 2 * z) * u, 0, TAU); ctx.fill();
      }
      ctx.restore();
      // the opening edge: a bright rim plus a faster shockwave ahead of it
      if (p < 1) {
        ctx.save(); ctx.globalCompositeOperation = LOM.addOp(S);
        const fade = 1 - smooth(0.35, 1, p);
        ctx.strokeStyle = rgba(col, 0.25 * fade); ctx.lineWidth = 26 * u;
        ctx.beginPath(); ctx.arc(ox, oy, R, 0, TAU); ctx.stroke();
        ctx.strokeStyle = rgba(col, 0.9 * fade); ctx.lineWidth = Math.max(1, 3 * u);
        ctx.beginPath(); ctx.arc(ox, oy, R, 0, TAU); ctx.stroke();
        const R2 = Ease.outCubic(prog(t, start, D * 0.85)) * M * 1.25;
        ctx.strokeStyle = rgba(col, 0.35 * (1 - smooth(0.2, 1, R2 / (M * 1.25)))); ctx.lineWidth = Math.max(1, 1.5 * u);
        ctx.beginPath(); ctx.arc(ox, oy, R2, 0, TAU); ctx.stroke();
        ctx.restore();
      }
    },
    fg(ctx, t, S) {
      const { start, D } = S.timing, u = S.u, col = mixHex(S.colors.accent, '#ffffff', 0.5);
      const ox = S.cx, oy = S.cy;
      // the spark: a point of light that gathers just before, then flashes as everything opens
      const pre = prog(t, start - 0.35, 0.35), post = 1 - Ease.outCubic(prog(t, start, 0.6));
      const spark = t < start ? Ease.inQuad(pre) : post;
      if (spark > 0.01) {
        const r = (8 + 60 * (t < start ? pre * 0.3 : 1 - post * 0.3)) * u;
        ctx.save(); ctx.globalCompositeOperation = S.dark ? 'lighter' : 'source-over';
        const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * 3);
        g.addColorStop(0, rgba('#ffffff', spark)); g.addColorStop(0.15, rgba(col, 0.8 * spark)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(ox - r * 3, oy - r * 3, r * 6, r * 6);
        ctx.translate(ox, oy); ctx.scale(1, 0.04);
        const f = ctx.createRadialGradient(0, 0, 0, 0, 0, S.W * 0.4);
        f.addColorStop(0, rgba(col, 0.7 * spark)); f.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = f; ctx.fillRect(-S.W * 0.4, -S.W * 0.4, S.W * 0.8, S.W * 0.8);
        ctx.restore();
      }
      // the logo grows out of the same point, in step with the background
      const pl = prog(t, start + D * 0.04, D * 0.95);
      if (pl <= 0) return;
      const e = Ease.outCubic(pl), s = pl >= 1 ? 1 : Math.max(0.001, Ease.outBack(pl, 1.3));
      const rot = (1 - e) * -0.25;
      const ax = (ox - (S.cx + lk(S).x)) / lk(S).w, ay = (oy - (S.cy + lk(S).y)) / lk(S).h;
      if (pl < 1) for (let k = 1; k <= 4; k++) {
        drawLockup(ctx, S, { ax, ay, s: s * (1 + k * 0.14 * (1 - e)), rot, alpha: 0.16 * (1 - e) });
      }
      drawLockup(ctx, S, { ax, ay, s, rot, alpha: clamp(pl * 4), blur: (1 - e) * 16 * u });
    },
  };

  LOM.EMERGE_ORDER = ['particles', 'halftone', 'blocks', 'ink', 'smoke', 'light', 'glitch', 'shatter', 'ripple', 'streaks', 'burst'];

  // When each effect has finished forming the logo, in multiples of the reveal length after the start.
  const DONE = { particles: 1.7, halftone: 1.35, blocks: 1.45, ink: 1.35, smoke: 1.5, light: 1.4, glitch: 1.4, shatter: 1.4, ripple: 1.6, streaks: 1.4, burst: 1.15 };
  for (const k in DONE) E[k].done = DONE[k];
  LOM.emergeDone = (S, fx) => S.timing.start + S.timing.D * ((fx || E[S.st.emerge] || {}).done || 1.4);

  // ─────────── What the logo does once it has emerged (tt = seconds since it formed, a = 0→1 ease-in) ───────────
  const H = (LOM.HOLD = {});
  H.none = { name: 'Still' };
  H.float = { name: 'Float', pre(L, tt, S, a) { L.translate(0, -Math.sin((tt * TAU) / 3.2) * 12 * S.u * a); } };
  H.breathe = {
    name: 'Breathe',
    pre(L, tt, S, a) { const s = 1 + 0.035 * a * (0.5 - 0.5 * Math.cos((tt * TAU) / 2.8)); L.translate(S.cx, S.cy); L.scale(s, s); L.translate(-S.cx, -S.cy); },
  };
  H.sway = { name: 'Sway', pre(L, tt, S, a) { L.translate(S.cx, S.cy); L.rotate(0.035 * a * Math.sin((tt * TAU) / 3.6)); L.translate(-S.cx, -S.cy); } };
  H.glow = {
    name: 'Glow pulse',
    post(L, tt, S, a) {
      const k = a * (0.5 - 0.5 * Math.cos((tt * TAU) / 2.4));
      if (k < 0.01) return;
      const halo = LOM.tinted(S.lockup.canvas, S.colors.accent, 'holdHalo');
      LOM.drawPart(L, S, S.lockup, { src: halo, blur: 26 * S.u, alpha: k, s: 1.02, op: 'destination-over' });
      LOM.drawPart(L, S, S.lockup, { src: halo, blur: 10 * S.u, alpha: 0.7 * k, op: 'destination-over' });
    },
  };
  H.shine = {
    name: 'Shine sweep',
    post(L, tt, S, a) {
      const period = 3, ph = frac((tt + period - 0.3) / period), p = ph / 0.45;
      if (p >= 1 || tt < 0.3) return;
      const lk = S.lockup, x = lerp(S.cx + lk.x - lk.h, S.cx + lk.x + lk.w + lk.h, Ease.inOutSine(p));
      const w = Math.max(30 * S.u, lk.h * 0.35);
      L.globalCompositeOperation = 'source-atop';
      L.translate(x, S.cy); L.transform(1, 0, -0.45, 1, 0, 0);
      const g = L.createLinearGradient(-w, 0, w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${0.8 * a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      L.fillStyle = g; L.fillRect(-w, -S.H, 2 * w, 2 * S.H);
    },
  };
  H.glitch = {
    name: 'Glitch blips',
    blip(tt, S) {
      const slot = Math.floor(tt * 8);
      if (slot < 4 || hrand(slot, S.seed + 990) > 0.1) return null;
      return Math.floor(tt * S.fps);
    },
    pre(L, tt, S, a) { const f = this.blip(tt, S); if (f != null) L.translate((hrand(f, S.seed + 991) - 0.5) * 28 * S.u * a, 0); },
    post(L, tt, S, a) {
      const f = this.blip(tt, S);
      if (f == null) return;
      const split = (5 + 12 * hrand(f, S.seed + 992)) * S.u * a, src = S.lockup.canvas;
      LOM.drawPart(L, S, S.lockup, { src: LOM.tinted(src, S.dark ? '#00e5ff' : '#00b8d4', 'hgc'), dx: -split, alpha: 0.8, op: 'destination-over' });
      LOM.drawPart(L, S, S.lockup, { src: LOM.tinted(src, S.dark ? '#ff2bd6' : '#ff1fb4', 'hgm'), dx: split, alpha: 0.8, op: 'destination-over' });
    },
  };
  LOM.HOLD_ORDER = ['none', 'float', 'breathe', 'sway', 'glow', 'shine', 'glitch'];
})();
