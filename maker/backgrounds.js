// Logo Opener Maker — background animations ("Logo + Background" direction).
// Each draw(ctx, t, S) paints the full frame. Colour 1 = base, colour 2 = glow / second tone,
// Accent = particles, lines and light.
'use strict';
(function () {
  const { clamp, lerp, smooth, Ease, hrand, fbm, TAU, frac, rgba, mixHex, makeCanvas } = LOM;
  const B = LOM.BACKGROUNDS;
  const I = S => S.st.bgIntensity;        // 0..2
  const SP = S => S.st.bgSpeed;           // 0..3
  const lightAccent = S => mixHex(S.colors.accent, S.dark ? '#ffffff' : S.colors.accent, 0.35);

  // 0 ─ Solid / soft gradient
  B.solid = {
    name: 'Solid glow', icon: '■',
    draw(ctx, t, S) { LOM.base(ctx, S, 0.55 * I(S)); },
  };

  // 1 ─ Gradient flow: big soft colour fields drifting on slow orbits
  B.gradient = {
    name: 'Gradient flow', icon: '◐',
    draw(ctx, t, S) {
      const { W, H, colors: c } = S, R = Math.max(W, H);
      ctx.fillStyle = c.bgA; ctx.fillRect(0, 0, W, H);
      const cols = [c.bgB, mixHex(c.bgB, c.accent, 0.45), c.bgB, mixHex(c.bgA, c.accent, 0.35), c.bgB];
      const sp = SP(S) * 0.22;
      for (let i = 0; i < 5; i++) {
        const ph = hrand(i, S.seed) * TAU, ph2 = hrand(i, S.seed + 1) * TAU;
        const x = W * (0.5 + 0.42 * Math.sin(t * sp * (0.7 + i * 0.13) + ph));
        const y = H * (0.5 + 0.38 * Math.cos(t * sp * (0.6 + i * 0.11) + ph2));
        const r = R * (0.38 + 0.18 * hrand(i, S.seed + 2));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const a = (i === 3 ? 0.35 : 0.6) * clamp(I(S), 0, 1.6);
        g.addColorStop(0, rgba(cols[i], a)); g.addColorStop(1, rgba(cols[i], 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
    },
  };

  // 2 ─ Floating particles / dust (like the Simple Profit opener)
  B.particles = {
    name: 'Floating particles', icon: '⋰',
    draw(ctx, t, S, o = {}) {
      const { W, H, u } = S;
      if (!o.noBase) LOM.base(ctx, S, 0.5);
      const n = Math.round(240 * (o.int != null ? o.int : I(S)) * (W * H) / (1920 * 1080) / (u * u));
      const col = lightAccent(S), sp = SP(S);
      ctx.save(); ctx.globalCompositeOperation = LOM.addOp(S);
      for (let i = 0; i < n; i++) {
        const r = k => hrand(i * 7 + k, S.seed + 11);
        const z = 0.2 + 0.8 * r(0);
        const x = frac(r(1) + (r(2) - 0.5) * 0.02 * z * t * sp) * W;
        const y = frac(r(3) - 0.012 * z * t * sp) * H;
        const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + r(4) * 1.8) + r(5) * TAU);
        const a = (0.22 + 0.78 * z * z) * tw;
        const big = r(6) < 0.07;
        const s = (0.8 + 2.4 * z * z) * u * (big ? 3 : 1);
        if (big) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, s * 3);
          g.addColorStop(0, rgba(col, a * 0.5)); g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g; ctx.fillRect(x - s * 3, y - s * 3, s * 6, s * 6);
        } else {
          ctx.fillStyle = rgba(col, a);
          ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    },
  };

  // 3 ─ Bokeh: large soft out-of-focus discs
  B.bokeh = {
    name: 'Bokeh', icon: '◌',
    draw(ctx, t, S) {
      const { W, H, colors: c } = S;
      LOM.base(ctx, S, 0.45);
      const n = Math.round(34 * I(S));
      ctx.save(); ctx.globalCompositeOperation = LOM.addOp(S);
      for (let i = 0; i < n; i++) {
        const r = k => hrand(i * 9 + k, S.seed + 21);
        const R = (0.025 + 0.085 * r(0) * r(0)) * H;
        const x = frac(r(1) + 0.012 * SP(S) * t * (r(2) - 0.5) * 2) * (W + 2 * R) - R;
        const y = frac(r(3) - 0.008 * SP(S) * t * (0.3 + r(4))) * (H + 2 * R) - R;
        const col = mixHex(c.bgB, c.accent, r(5)), lit = mixHex(col, '#ffffff', 0.35);
        const a = (0.07 + 0.16 * r(6)) * (0.7 + 0.3 * Math.sin(t * (0.5 + r(7)) + r(8) * TAU)) * (S.dark ? 1 : 1.6);
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, rgba(lit, a * 0.75)); g.addColorStop(0.82, rgba(lit, a)); g.addColorStop(0.92, rgba(lit, a * 1.2)); g.addColorStop(1, rgba(lit, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
  };

  // 4 ─ Plexus: drifting points joined by lines
  B.plexus = {
    name: 'Plexus network', icon: '⟁',
    draw(ctx, t, S) {
      const { W, H, u } = S;
      LOM.base(ctx, S, 0.45);
      const n = Math.round(80 * I(S)), sp = SP(S);
      const P = [];
      for (let i = 0; i < n; i++) {
        const r = k => hrand(i * 5 + k, S.seed + 31);
        const x = (-0.08 + 1.16 * r(0) + 0.06 * Math.sin(t * sp * (0.15 + 0.3 * r(1)) + r(2) * TAU)) * W;
        const y = (-0.08 + 1.16 * r(3) + 0.06 * Math.cos(t * sp * (0.12 + 0.3 * r(4)) + r(1) * TAU)) * H;
        P.push([x, y]);
      }
      const dmax = 0.17 * Math.max(W, H), col = lightAccent(S);
      ctx.save(); ctx.lineWidth = Math.max(1, 1.1 * u);
      const buckets = Array.from({ length: 6 }, () => new Path2D());
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], d = Math.hypot(dx, dy);
        if (d < dmax) { const b = Math.min(5, Math.floor((1 - d / dmax) * 6)); buckets[b].moveTo(P[i][0], P[i][1]); buckets[b].lineTo(P[j][0], P[j][1]); }
      }
      buckets.forEach((p, b) => { ctx.strokeStyle = rgba(col, ((b + 1) / 6) * 0.5); ctx.stroke(p); });
      ctx.fillStyle = rgba(col, 0.85);
      for (const [x, y] of P) { ctx.beginPath(); ctx.arc(x, y, 2.2 * u, 0, TAU); ctx.fill(); }
      ctx.restore();
    },
  };

  // 5 ─ Light rays: slow rotating god-rays from behind the logo
  B.rays = {
    name: 'Light rays', icon: '✺',
    draw(ctx, t, S) {
      const { W, H, colors: c } = S, R = Math.hypot(W, H);
      LOM.base(ctx, S, 0.5);
      const cx = S.cx, cy = S.cy, n = 26, col = mixHex(c.accent, '#ffffff', 0.45);
      const k = 0.25, lc = LOM.scratch('raysBG', W * k, H * k), x = lc.getContext('2d');
      x.scale(k, k); x.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU + t * 0.04 * SP(S) + hrand(i, S.seed + 41) * 0.3;
        const w = (0.008 + 0.03 * hrand(i, S.seed + 42)) * TAU / 2;
        const fl = 0.5 + 0.5 * Math.sin(t * (0.5 + hrand(i, S.seed + 43)) * SP(S) + i);
        const g = x.createRadialGradient(cx, cy, Math.min(W, H) * 0.04, cx, cy, R * (0.45 + 0.4 * hrand(i, S.seed + 44)));
        g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.15, rgba(col, 0.28 * (0.3 + 0.7 * fl))); g.addColorStop(1, rgba(col, 0));
        x.fillStyle = g;
        x.beginPath(); x.moveTo(cx, cy);
        x.lineTo(cx + Math.cos(a0 - w) * R, cy + Math.sin(a0 - w) * R);
        x.lineTo(cx + Math.cos(a0 + w) * R, cy + Math.sin(a0 + w) * R);
        x.closePath(); x.fill();
      }
      const g2 = x.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.5);
      g2.addColorStop(0, rgba(col, 0.25)); g2.addColorStop(1, rgba(col, 0));
      x.fillStyle = g2; x.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalCompositeOperation = LOM.addOp(S); ctx.globalAlpha = clamp(0.85 * I(S), 0, 1.5);
      ctx.imageSmoothingQuality = 'high'; ctx.drawImage(LOM.blurred(lc, 2, 'raysBGb'), 0, 0, W, H);
      ctx.restore();
    },
  };

  // 6 ─ Perspective grid floor (tech / retro)
  B.grid = {
    name: 'Perspective grid', icon: '▦',
    draw(ctx, t, S) {
      const { W, H, u, colors: c } = S;
      LOM.base(ctx, S, 0.4, 0.62);
      const hy = H * 0.64, col = lightAccent(S);
      ctx.save(); ctx.lineWidth = Math.max(1, 1.6 * u);
      const draw = (dir, alpha) => {
        const span = dir > 0 ? H - hy : hy;
        // converging lines
        const N = 26;
        for (let k = -N; k <= N; k++) {
          const xb = W / 2 + k * (W / 9);
          const g = ctx.createLinearGradient(0, hy, 0, hy + dir * span);
          g.addColorStop(0, rgba(col, 0.05 * alpha)); g.addColorStop(1, rgba(col, 0.5 * alpha * I(S)));
          ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(W / 2 + k * (W / 9) * 0.04, hy); ctx.lineTo(xb, hy + dir * span); ctx.stroke();
        }
        // moving horizontals
        const ph = frac(t * 0.5 * SP(S));
        for (let j = 0; j < 22; j++) {
          const z = 1 + (j + 1 - ph) * 0.55;
          const y = hy + dir * span / z;
          const a = (1 / z) * 0.9;
          ctx.strokeStyle = rgba(col, 0.55 * a * alpha * I(S));
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
      };
      draw(1, 1); draw(-1, 0.25);
      const g = ctx.createLinearGradient(0, hy - 60 * u, 0, hy + 60 * u);
      g.addColorStop(0, rgba(c.accent, 0)); g.addColorStop(0.5, rgba(c.accent, 0.25 * I(S))); g.addColorStop(1, rgba(c.accent, 0));
      ctx.fillStyle = g; ctx.fillRect(0, hy - 60 * u, W, 120 * u);
      ctx.restore();
    },
  };

  // 7 ─ Flowing wave lines (silk)
  B.waves = {
    name: 'Flowing waves', icon: '≋',
    draw(ctx, t, S) {
      const { W, H, u } = S;
      LOM.base(ctx, S, 0.45);
      const col = lightAccent(S), sp = SP(S);
      ctx.save(); ctx.globalCompositeOperation = LOM.addOp(S); ctx.lineWidth = Math.max(1, 1.2 * u);
      for (let b = 0; b < 3; b++) {
        const yb = H * (0.3 + b * 0.22), A = H * (0.07 + 0.04 * b), f = (1.6 + b * 0.5) * TAU / W;
        const lines = Math.round(24 * clamp(I(S), 0.3, 2));
        for (let k = 0; k < lines; k++) {
          ctx.strokeStyle = rgba(col, (0.05 + 0.14 * Math.sin((k / lines) * Math.PI)) * (S.dark ? 1 : 1.5));
          ctx.beginPath();
          for (let s = 0; s <= 64; s++) {
            const x = (s / 64) * W;
            const y = yb + A * Math.sin(x * f + t * sp * 0.6 + b * 2 + k * 0.07) * (0.8 + 0.3 * Math.sin(k * 0.15 + t * 0.4 * sp + b))
              + (k - lines / 2) * 2.4 * u + A * 0.4 * Math.sin(x * f * 0.37 - t * sp * 0.3 + b);
            s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  };

  // 8 ─ Smoke / fog: two layers of fractal noise drifting in opposite directions
  const fogCache = new Map();
  function fogTex(S) {
    const key = S.seed + S.colors.bgB + S.colors.accent + S.dark;
    if (fogCache.has(key)) return fogCache.get(key);
    const w = 320, h = 180, c = makeCanvas(w, h), x = c.getContext('2d'), d = x.createImageData(w, h);
    const col = LOM.hexToRgb(mixHex(S.colors.bgB, S.dark ? '#ffffff' : S.colors.bgB, 0.25));
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const n = fbm(i / 55, j / 55, S.seed + 77, 5);
      const v = smooth(0.38, 0.85, n);
      const p = (j * w + i) * 4;
      d.data[p] = col[0]; d.data[p + 1] = col[1]; d.data[p + 2] = col[2]; d.data[p + 3] = v * 255;
    }
    x.putImageData(d, 0, 0);
    fogCache.set(key, c); if (fogCache.size > 12) fogCache.delete(fogCache.keys().next().value);
    return c;
  }
  B.smoke = {
    name: 'Smoke & fog', icon: '☁',
    draw(ctx, t, S, o = {}) {
      const { W, H } = S;
      if (!o.noBase) LOM.base(ctx, S, 0.35);
      const tex = fogTex(S), sp = SP(S);
      ctx.save(); ctx.imageSmoothingQuality = 'high';
      for (let l = 0; l < 2; l++) {
        const sc = l ? 1.9 : 1.5, dir = l ? -1 : 1;
        const w = W * sc, h = H * sc;
        const x = (W - w) / 2 + dir * (t * 0.018 * sp * W) - dir * 0.05 * W;
        const y = (H - h) / 2 + (l ? 0.03 : -0.03) * H * Math.sin(t * 0.2 * sp);
        ctx.globalAlpha = clamp((l ? 0.45 : 0.6) * I(S) * (o.alpha || 1));
        if (l) { ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(tex, W - x - w, y, w, h); ctx.restore(); }
        else ctx.drawImage(tex, x, y, w, h);
      }
      ctx.restore();
    },
  };

  // 9 ─ Starfield warp: stars rush toward camera, then settle as the logo lands
  B.warp = {
    name: 'Starfield warp', icon: '✦',
    draw(ctx, t, S) {
      const { W, H, u, colors: c } = S;
      LOM.base(ctx, S, 0.35);
      const n = Math.round(420 * I(S)), sp = SP(S);
      const T = Math.max(0.3, S.timing.start + S.timing.D * 0.6) * 0.55, v0 = 2.2 * sp, v1 = 0.08 * sp;
      const F = tt => v1 * tt + (v0 - v1) * T * (1 - Math.exp(-tt / T));
      const f1 = F(t), f0 = F(Math.max(0, t - 1 / 30));
      const col = mixHex(c.accent, '#ffffff', S.dark ? 0.55 : 0);
      ctx.save(); ctx.globalCompositeOperation = LOM.addOp(S); ctx.lineCap = 'round';
      const R = Math.max(W, H) * 0.55;
      for (let i = 0; i < n; i++) {
        const r = k => hrand(i * 4 + k, S.seed + 51);
        const sx = r(0) * 2 - 1, sy = r(1) * 2 - 1;
        const z = frac(r(2) - f1 * 0.35), zp = frac(r(2) - f0 * 0.35);
        if (zp < z) continue; // wrapped this frame
        const zz = 0.04 + z, zzp = 0.04 + zp;
        const x = S.cx + (sx / zz) * R * 0.25, y = S.cy + (sy / zz) * R * 0.25;
        const xp = S.cx + (sx / zzp) * R * 0.25, yp = S.cy + (sy / zzp) * R * 0.25;
        const a = clamp((1 - z) * 1.2) * (0.4 + 0.6 * r(3));
        ctx.strokeStyle = rgba(col, Math.min(1, a * 1.3)); ctx.lineWidth = Math.max(1, (1 - z) * 3.2 * u);
        ctx.beginPath(); ctx.moveTo(xp, yp); ctx.lineTo(x + 0.01, y); ctx.stroke();
      }
      ctx.restore();
    },
  };

  // 10 ─ Liquid blobs (metaballs, soft-edged)
  B.liquid = {
    name: 'Liquid blobs', icon: '◍',
    draw(ctx, t, S) {
      const { W, H, colors: c } = S;
      LOM.base(ctx, S, 0.3);
      const w = 200, h = Math.max(2, Math.round((200 * H) / W));
      const cv = LOM.scratch('liquid', w, h), x = cv.getContext('2d'), d = x.createImageData(w, h);
      const sp = SP(S) * 0.35, nb = 7, balls = [];
      for (let i = 0; i < nb; i++) {
        const r = k => hrand(i * 6 + k, S.seed + 61);
        balls.push([
          w * (0.5 + 0.45 * Math.sin(t * sp * (0.5 + r(0)) + r(1) * TAU)),
          h * (0.5 + 0.42 * Math.cos(t * sp * (0.4 + r(2)) + r(3) * TAU)),
          (0.08 + 0.09 * r(4)) * h,
        ]);
      }
      const A = LOM.hexToRgb(mixHex(c.bgB, c.accent, 0.35)), Bc = LOM.hexToRgb(mixHex(c.accent, '#ffffff', S.dark ? 0.2 : 0));
      const k = clamp(I(S) * 0.5, 0, 1);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let f = 0;
        for (const [bx, by, br] of balls) { const dx = i - bx, dy = j - by; f += (br * br) / (dx * dx + dy * dy + 1); }
        const a = smooth(0.85, 1.15, f), core = smooth(1.6, 3.2, f);
        const p = (j * w + i) * 4;
        d.data[p] = lerp(A[0], Bc[0], core); d.data[p + 1] = lerp(A[1], Bc[1], core); d.data[p + 2] = lerp(A[2], Bc[2], core);
        d.data[p + 3] = a * 255 * k;
      }
      x.putImageData(d, 0, 0);
      ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.globalAlpha = 0.9;
      const b = LOM.blurred(cv, 1.5, 'liquidb');
      ctx.drawImage(b, 0, 0, W, H); ctx.restore();
    },
  };

  LOM.BG_ORDER = ['solid', 'gradient', 'particles', 'bokeh', 'plexus', 'rays', 'grid', 'waves', 'smoke', 'warp', 'liquid'];
})();
