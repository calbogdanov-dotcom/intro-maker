// Logo Opener Maker — logo reveal animations ("Logo + Background" direction) and text reveals.
// A logo animation either animates each part (mark, text, tagline) with part(ctx,S,part,p,t),
// p = 0→1 over the reveal, or the whole lockup with all(ctx,t,S).
'use strict';
(function () {
  const { clamp, lerp, smooth, prog, Ease, hrand, TAU, rgba, mixHex } = LOM;
  const A = LOM.LOGO_ANIMS, TX = LOM.TEXT_ANIMS;

  LOM.drawLogoAnim = function (ctx, t, S) {
    const st = S.st, anim = A[st.logoAnim] || A.fadeUp;
    if (anim.all) return anim.all(ctx, t, S);
    const T = anim.timing ? anim.timing(S.timing, S) : S.timing;
    const { mark, text, tag } = S.parts;
    if (mark) anim.part(ctx, S, mark, prog(t, T.start, T.D), t);
    for (const [part, s0] of [[text, T.textStart], [tag, T.tagStart]]) {
      if (!part) continue;
      const p = prog(t, s0, T.D);
      const m = st.textAnim;
      if (m !== 'match' && TX[m]) TX[m].draw(ctx, S, part, p, t);
      else anim.part(ctx, S, part, p, t);
    }
  };
  const U = S => S.u;

  // 1 ─ Fade up
  A.fadeUp = {
    name: 'Fade up', icon: '↑',
    part(ctx, S, part, p) {
      const e = Ease.outCubic(p);
      LOM.drawPart(ctx, S, part, { alpha: Ease.outQuad(p), dy: (1 - e) * 46 * U(S) });
    },
  };

  // 2 ─ Scale pop (overshoot)
  A.pop = {
    name: 'Scale pop', icon: '⊕',
    part(ctx, S, part, p) {
      const e = p >= 1 ? 1 : Ease.outBack(p, 2.2);
      LOM.drawPart(ctx, S, part, { alpha: clamp(p * 5), s: Math.max(0, e) });
    },
  };

  // 3 ─ Cinematic zoom (from big & blurred)
  A.zoom = {
    name: 'Cinematic zoom', icon: '⤡',
    part(ctx, S, part, p) {
      const e = Ease.outExpo(p);
      LOM.drawPart(ctx, S, part, { alpha: Ease.outCubic(clamp(p * 1.6)), s: lerp(2.4, 1, e), blur: (1 - e) * 40 * U(S) });
    },
  };

  // 4 ─ Slide reveal: mark pops in at centre, slides to its place, text slides out from behind it
  A.slide = {
    name: 'Slide reveal', icon: '⇥',
    all(ctx, t, S) {
      const { mark, text, tag } = S.parts, T = S.timing;
      if (!mark || !text) { // nothing to slide from: fall back to a clean fade-up
        for (const [pt, s0] of [[mark, T.start], [text, T.textStart], [tag, T.tagStart]]) if (pt) A.fadeUp.part(ctx, S, pt, prog(t, s0, T.D), t);
        return;
      }
      if (S.st.layout === 'lockup') { // text sits on the mark: the mark grows in from its left edge, then the text slides out of its own left edge
        const p1 = prog(t, T.start, T.D * 0.5), p2 = prog(t, T.start + T.D * 0.3 + S.st.textDelay * 0.3, T.D * 0.7);
        const e1 = Ease.outExpo(p1), e2 = Ease.outCubic(p2);
        if (p1 > 0) LOM.drawPart(ctx, S, mark, { alpha: clamp(p1 * 4), sx: Math.max(0.001, e1), ax: 0 });
        for (const pt of [text, tag]) {
          if (!pt || p2 <= 0) continue;
          ctx.save(); ctx.beginPath();
          const edge = S.cx + pt.x - 2 * S.u; ctx.rect(edge, 0, S.W - edge, S.H); ctx.clip();
          LOM.drawPart(ctx, S, pt, { dx: -(1 - e2) * pt.w * 0.6, alpha: clamp(p2 * 3) });
          ctx.restore();
        }
        return;
      }
      const horiz = S.st.layout === 'horizontal';
      const p1 = prog(t, T.start, T.D * 0.38), p2 = prog(t, T.start + T.D * 0.32 + S.st.textDelay * 0.2, T.D * 0.68);
      const e2 = Ease.inOutCubic(p2);
      // where the mark sits when centred on screen
      const dxC = -(mark.x + mark.w / 2), dyC = -(mark.y + mark.h / 2);
      const mdx = horiz ? lerp(dxC, 0, e2) : 0, mdy = horiz ? 0 : lerp(dyC, 0, e2);
      const s = p1 >= 1 ? 1 : Math.max(0, Ease.outBack(p1, 2));
      // text: clipped to the area beyond the mark's moving edge
      if (p2 > 0) {
        ctx.save();
        ctx.beginPath();
        if (horiz) { const edge = S.cx + mark.x + mark.w + mdx + 4 * S.u; ctx.rect(edge, 0, S.W - edge, S.H); }
        else { const edge = S.cy + mark.y + mark.h + mdy + 4 * S.u; ctx.rect(0, edge, S.W, S.H - edge); }
        ctx.clip();
        const off = (1 - e2);
        LOM.drawPart(ctx, S, text, horiz ? { dx: -off * (text.w + S.st.gap * S.u) } : { dy: -off * (text.h + S.st.gap * S.u) });
        if (tag) LOM.drawPart(ctx, S, tag, horiz ? { dx: -off * (tag.w + S.st.gap * S.u * 2) } : { dy: -off * (tag.y - mark.y) });
        ctx.restore();
      }
      LOM.drawPart(ctx, S, mark, { alpha: clamp(p1 * 4), s, dx: mdx, dy: mdy });
    },
  };

  // 5 ─ Mask wipe with a sweeping accent bar
  A.wipe = {
    name: 'Mask wipe', icon: '▥',
    part(ctx, S, part, p) {
      if (p <= 0) return;
      const u = S.u;
      const lead = Ease.inOutCubic(prog(p, 0, 0.55)), trail = Ease.inOutCubic(prog(p, 0.3, 0.7));
      const x0 = S.cx + part.x - 8 * u, w = part.w + 16 * u, y0 = S.cy + part.y - part.pad * 0.5, h = part.h + part.pad;
      // the logo is uncovered behind the bar's trailing edge
      if (trail > 0) {
        ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w * trail, h); ctx.clip();
        LOM.drawPart(ctx, S, part, { dx: (1 - trail) * -24 * u });
        ctx.restore();
      }
      const bx = x0 + w * trail, bw = w * (lead - trail);
      if (bw > 0.5) { ctx.fillStyle = S.colors.accent; ctx.fillRect(bx, S.cy + part.y - 6 * u, bw, part.h + 12 * u); }
    },
  };

  // 6 ─ Blur to focus
  A.blur = {
    name: 'Blur focus', icon: '◎',
    part(ctx, S, part, p) {
      const e = Ease.outCubic(p);
      LOM.drawPart(ctx, S, part, { alpha: Ease.outQuad(clamp(p * 1.4)), s: lerp(1.18, 1, e), blur: (1 - e) * 36 * S.u });
    },
  };

  // 7 ─ Bounce drop with squash
  A.bounce = {
    name: 'Bounce drop', icon: '⤓',
    part(ctx, S, part, p) {
      if (p <= 0) return;
      const e = Ease.outBounce(p);
      const fall = (1 - e) * (S.H * 0.55);
      // squash on contact: strongest when the bounce is at the floor
      const contact = Math.max(0, 1 - fall / (S.H * 0.06)) * (1 - p) * 0.6;
      LOM.drawPart(ctx, S, part, { dy: -fall, sx: 1 + contact * 0.35, sy: 1 - contact * 0.3, ay: 1 });
    },
  };

  // 8 ─ 3D flip
  A.flip = {
    name: '3D flip', icon: '⟲',
    part(ctx, S, part, p) {
      if (p <= 0) return;
      const ang = lerp(-Math.PI * 0.5, 0, Ease.outBack(p, 1.4));
      const c = Math.cos(ang), sk = Math.sin(ang) * 0.18;
      LOM.drawPart(ctx, S, part, { sx: Math.max(0.001, c), sky: sk, alpha: clamp(p * 4), s: lerp(0.85, 1, Ease.outCubic(p)) });
    },
  };

  // 9 ─ Glitch
  A.glitch = {
    name: 'Glitch', icon: '▚',
    part(ctx, S, part, p, t) {
      if (p <= 0) return;
      const f = Math.floor(t * S.fps), u = S.u, k = Math.pow(1 - p, 1.5);
      const flick = p < 1 && hrand(f, S.seed + 101) < 0.25 * (1 - p) ? 0.25 : 1;
      if (p >= 1) { LOM.drawPart(ctx, S, part); return; }
      const split = (6 + 30 * k) * u * (hrand(f, 7) < 0.3 ? 2 : 1);
      ctx.save(); ctx.globalAlpha *= clamp(p * 3) * flick;
      const op = S.dark ? 'lighter' : 'multiply';
      const cyan = S.dark ? '#00e5ff' : '#00b8d4', mag = S.dark ? '#ff2bd6' : '#ff1fb4';
      const tc = LOM.tinted(part.canvas, cyan, 'g1'), tm = LOM.tinted(part.canvas, mag, 'g2');
      LOM.drawPart(ctx, S, part, { src: tc, dx: -split, alpha: 0.75, op });
      LOM.drawPart(ctx, S, part, { src: tm, dx: split, alpha: 0.75, op });
      // sliced main copy
      const n = 14, h = part.canvas.height / n;
      const X = S.cx + part.x - part.pad, Y = S.cy + part.y - part.pad;
      for (let i = 0; i < n; i++) {
        const r = hrand(i * 13 + f, S.seed + 103);
        const off = r < 0.35 ? (hrand(i + f * 7, 9) - 0.5) * 120 * u * k : 0;
        if (hrand(i * 3 + f, S.seed + 104) > 0.25 + p) continue;
        ctx.drawImage(part.canvas, 0, i * h, part.canvas.width, h + 1, X + off, Y + i * h, part.canvas.width, h + 1);
      }
      ctx.restore();
    },
  };

  // 10 ─ Line draw: outline traces around, then the fill comes in
  A.draw = {
    name: 'Line draw', icon: '✎',
    part(ctx, S, part, p) {
      if (p <= 0) return;
      const ring = LOM.outline(S, part, Math.max(1.5, 2.6 * S.u));
      const pd = Ease.inOutCubic(clamp(p / 0.7)), pf = Ease.outCubic(prog(p, 0.55, 0.45));
      const cx = S.cx + part.x + part.w / 2, cy = S.cy + part.y + part.h / 2, R = Math.hypot(part.w, part.h);
      if (pf < 1) {
        ctx.save();
        if (pd < 1) {
          ctx.beginPath(); ctx.moveTo(cx, cy);
          const a0 = -Math.PI / 2; ctx.arc(cx, cy, R, a0, a0 + TAU * pd); ctx.closePath(); ctx.clip();
        }
        LOM.drawPart(ctx, S, part, { src: ring, alpha: 1 - pf * 0.9 });
        ctx.restore();
      }
      LOM.drawPart(ctx, S, part, { alpha: pf });
    },
  };

  // 11 ─ Backlit rise (the Simple Profit opener style): mark swings up from flat, backlit, then lights up
  A.backlit = {
    name: 'Backlit rise', icon: '☀', badge: 'Backlit reveal',
    timing: T => ({ ...T, textStart: T.start + T.D * 1.25 + (T.textStart - T.start) * 0.5, tagStart: T.start + T.D * 1.25 + (T.tagStart - T.start) * 0.6 }),
    part(ctx, S, part, p, t) {
      if (part.role !== 'mark') { // text: soft rise out of blur
        const e = Ease.outCubic(p);
        LOM.drawPart(ctx, S, part, { alpha: Ease.outQuad(p), dy: (1 - e) * 18 * S.u, blur: (1 - e) * 10 * S.u });
        return;
      }
      const T = S.timing, D = T.D * 1.6;
      const q = prog(t, T.start, D);
      if (q <= 0) return;
      const rise = Ease.outCubic(clamp(q / 0.72));
      const tilt = (1 - rise) * Math.PI * 0.46;           // lying back → facing camera
      const sy = Math.max(0.02, Math.cos(tilt)), sk = (1 - rise) * -0.5;
      const flash = smooth(0.66, 0.8, q) * (1 - smooth(0.8, 1.0, q)), lit = smooth(0.7, 0.86, q);
      const s = lerp(1.35, 1, Ease.outCubic(q)), rot = (1 - rise) * -0.3;
      const o = { sy, s, rot, skx: sk, alpha: clamp(q * 6) };
      // backlight: soft rays & glow behind the mark, drawn at quarter size so the edges are soft
      const c = S.colors, light = mixHex(c.accent, '#ffffff', 0.6);
      const cx = S.cx + part.x + part.w / 2, cy = S.cy + part.y + part.h / 2;
      const glowA = clamp(q * 3) * (1 - 0.8 * lit) * (1 - smooth(T.start + D * 0.8, T.start + D * 1.5, t));
      if (glowA > 0.003) {
        const k = 0.25, lc = LOM.scratch('blRays', S.W * k, S.H * k), lx = lc.getContext('2d');
        lx.scale(k, k); lx.globalCompositeOperation = 'lighter';
        const R = Math.max(part.w, part.h) * 1.5;
        const g = lx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, rgba(light, 0.85)); g.addColorStop(0.35, rgba(light, 0.3)); g.addColorStop(1, rgba(light, 0));
        lx.fillStyle = g; lx.fillRect(cx - R, cy - R, R * 2, R * 2);
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * TAU + hrand(i, S.seed + 120) * 0.5 + t * 0.12, w = 0.012 + 0.035 * hrand(i, S.seed + 121);
          const L = R * (1.8 + 2.2 * hrand(i, S.seed + 122));
          const gr = lx.createRadialGradient(cx, cy, 0, cx, cy, L);
          gr.addColorStop(0, rgba(light, 0.4 * (0.4 + 0.6 * hrand(i, S.seed + 123)))); gr.addColorStop(1, rgba(light, 0));
          lx.fillStyle = gr; lx.beginPath(); lx.moveTo(cx, cy);
          lx.lineTo(cx + Math.cos(a - w) * L, cy + Math.sin(a - w) * L); lx.lineTo(cx + Math.cos(a + w) * L, cy + Math.sin(a + w) * L); lx.fill();
        }
        ctx.save(); ctx.globalCompositeOperation = S.dark ? 'lighter' : 'source-over'; ctx.globalAlpha = glowA;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(LOM.blurred(lc, 2.5, 'blRaysB'), 0, 0, S.W, S.H);
        // rim light: a bright, slightly larger copy behind the silhouette
        const rim = LOM.tinted(part.canvas, light, 'rim');
        LOM.drawPart(ctx, S, part, { ...o, src: rim, s: s * 1.05, alpha: 1, blur: 8 * S.u });
        LOM.drawPart(ctx, S, part, { ...o, src: rim, s: s * 1.018, alpha: 1 });
        ctx.restore();
      }
      // silhouette (dark) cross-fading to the lit logo colour
      const dark = LOM.tinted(part.canvas, mixHex(c.bgA, '#000000', 0.3), 'sil');
      LOM.drawPart(ctx, S, part, { ...o, src: dark, alpha: o.alpha * (1 - lit) });
      LOM.drawPart(ctx, S, part, { ...o, alpha: o.alpha * lit });
      if (flash > 0) {
        const wht = LOM.tinted(part.canvas, '#ffffff', 'flash');
        LOM.drawPart(ctx, S, part, { ...o, src: wht, alpha: flash * 0.7, op: S.dark ? 'lighter' : 'source-over' });
      }
    },
  };

  // Steps of a mark: runs of pixel columns where the artwork's top and bottom edges stay level, such as the
  // three bars of a stepped logo. Returned lowest step first, in part pixels from its top-left.
  // A logo without clear steps is split into three equal columns, filled left to right.
  function markSteps(S, part) {
    const key = 'steps:' + part.role;
    if (S.cache[key]) return S.cache[key];
    const cv = part.canvas, W = cv.width, H = cv.height, pad = part.pad;
    const px = cv.getContext('2d').getImageData(0, 0, W, H).data;
    const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H && px[(y * W + x) * 4 + 3] <= 24) y++;
      if (y === H) continue;
      top[x] = y;
      y = H - 1;
      while (px[(y * W + x) * 4 + 3] <= 24) y--;
      bot[x] = y + 1;
    }
    const tol = Math.max(1.5, part.h * 0.04), minW = Math.max(2, part.w * 0.03);
    // 1. runs of columns with level edges (a run is compared with its first column)
    let runs = [], cur = null;
    for (let x = 0; x < W; x++) {
      if (top[x] < 0) { cur = null; continue; }
      if (cur && cur.x1 === x && Math.abs(top[x] - cur.t) <= tol && Math.abs(bot[x] - cur.b) <= tol) {
        cur.x1 = x + 1; cur.top = Math.min(cur.top, top[x]); cur.bot = Math.max(cur.bot, bot[x]);
      } else runs.push(cur = { x0: x, x1: x + 1, t: top[x], b: bot[x], top: top[x], bot: bot[x] });
    }
    // 2. sliver runs (antialiased edges where two steps meet) are shared out to the runs beside them
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (r.x1 - r.x0 >= minW || runs.length === 1) continue;
      const L = runs[i - 1], R = runs[i + 1];
      const okL = L && L.x1 === r.x0 && L.x1 - L.x0 >= minW, okR = R && R.x0 === r.x1 && R.x1 - R.x0 >= minW;
      if (okL && okR) { const mid = Math.round((r.x0 + r.x1) / 2); L.x1 = mid; R.x0 = mid; }
      else if (okL) L.x1 = r.x1;
      else if (okR) R.x0 = r.x0;
      else continue;
      runs.splice(i--, 1);
    }
    runs = runs.filter(r => r.x1 - r.x0 >= minW);
    // real steps: 2–6 broad, level runs that make up nearly all of the artwork (rounded or curved shapes don't)
    let x0 = W, x1 = 0, inked = 0;
    for (let x = 0; x < W; x++) if (top[x] >= 0) { x0 = Math.min(x0, x); x1 = x + 1; inked++; }
    const covered = runs.reduce((n, r) => n + r.x1 - r.x0, 0);
    let steps;
    if (runs.length >= 2 && runs.length <= 6 && covered >= inked * 0.9 && runs.every(r => r.x1 - r.x0 >= (x1 - x0) * 0.12)) {
      const band = Math.max(tol, part.h * 0.1); // lowest step first; level ones left to right
      steps = runs.sort((a, b) => (Math.abs(a.bot - b.bot) > band ? b.bot - a.bot : a.x0 - b.x0));
    } else { // no clear steps: three equal columns of the artwork, each filling between its own top and bottom
      steps = [];
      for (let k = 0; k < 3 && x1 > x0; k++) {
        const a = Math.round(x0 + (x1 - x0) * k / 3), b = Math.round(x0 + (x1 - x0) * (k + 1) / 3);
        let t = H, bt = 0;
        for (let x = a; x < b; x++) if (top[x] >= 0) { t = Math.min(t, top[x]); bt = Math.max(bt, bot[x]); }
        if (bt > t) steps.push({ x0: a, x1: b, top: t, bot: bt });
      }
    }
    return (S.cache[key] = steps.map(s => ({ x0: s.x0 - pad, x1: s.x1 - pad, top: s.top - pad, bot: s.bot - pad })));
  }
  LOM.markSteps = markSteps;

  // 12 ─ Step fill: the lowest step fills up from nothing like a bar (nothing of it shows before that),
  // then the next step, then the next: climbing the steps. Text fills up from below once the last step is filling.
  A.steps = {
    name: 'Step fill', icon: '▟', thumbAt: 1.15, // card preview: two steps full, the third partly filled
    span: D => D * 1.6, // the mark's own length
    timing: (T, S) => (S.parts.mark ? { ...T, textStart: T.start + T.D * 1.28 + (T.textStart - T.start) * 0.5, tagStart: T.start + T.D * 1.28 + (T.tagStart - T.start) * 0.6 } : T),
    part(ctx, S, part, p, t) {
      if (part.role !== 'mark') {
        if (p <= 0) return;
        const e = Ease.outCubic(p), full = part.h + part.pad, y1 = S.cy + part.y + part.h + part.pad * 0.5;
        ctx.save(); ctx.beginPath(); ctx.rect(0, y1 - full * e, S.W, full * e); ctx.clip();
        LOM.drawPart(ctx, S, part, { dy: (1 - e) * part.h * 0.12, alpha: clamp(p * 2.5) });
        ctx.restore();
        return;
      }
      const T = S.timing, steps = markSteps(S, part), n = steps.length, Dm = A.steps.span(T.D);
      const F = Dm / n; // one step filling; the steps fill back to back
      const q = t - T.start;
      if (q <= 0 || !n) return;
      if (q >= Dm) { LOM.drawPart(ctx, S, part); return; } // finished: the untouched artwork
      const X = S.cx + part.x, Y = S.cy + part.y, m = 2; // m: room for antialiased edges
      steps.forEach((s, i) => {
        const f = Ease.outCubic(clamp((q - i * F) / F)); // quick start, settles full as the next step starts
        if (f <= 0) return; // not started: nothing of this step is drawn
        // 1px overlap at the sides keeps the antialiased column where two steps meet
        const x0 = X + s.x0 - 1, w = s.x1 - s.x0 + 2, top = Y + s.top - m, h = s.bot - s.top + m * 2, fh = h * f;
        ctx.save(); ctx.beginPath(); ctx.rect(x0, top + h - fh, w, fh); ctx.clip();
        LOM.drawPart(ctx, S, part);
        ctx.restore();
      });
    },
  };

  LOM.LOGO_ORDER = ['fadeUp', 'pop', 'zoom', 'slide', 'wipe', 'blur', 'bounce', 'flip', 'glitch', 'draw', 'backlit', 'steps'];

  // ─────────────── Text reveals (used when "Text animation" ≠ "Same as logo") ───────────────
  TX.fade = { name: 'Fade', draw(ctx, S, part, p) { LOM.drawPart(ctx, S, part, { alpha: Ease.outQuad(p) }); } };
  TX.rise = { name: 'Rise', draw(ctx, S, part, p) { const e = Ease.outCubic(p); LOM.drawPart(ctx, S, part, { alpha: Ease.outQuad(p), dy: (1 - e) * 30 * S.u }); } };
  TX.stagger = {
    name: 'Letter by letter',
    draw(ctx, S, part, p) {
      if (p <= 0) return;
      if (p >= 1) return LOM.drawPart(ctx, S, part);
      LOM.drawChars(ctx, S, part, (c, i, n) => {
        const q = clamp((p * 1.6 - (i / Math.max(1, n)) * 0.6) / 1.0);
        if (q <= 0) return null;
        return { alpha: Ease.outQuad(clamp(q * 1.5)), dy: (1 - Ease.outBack(q, 1.8)) * part.size * 0.45 };
      });
    },
  };
  TX.typewriter = {
    name: 'Typewriter',
    draw(ctx, S, part, p, t) {
      if (p <= 0) return;
      const shown = Math.floor(p * part.count + 0.0001);
      if (p >= 1) LOM.drawPart(ctx, S, part);
      else LOM.drawChars(ctx, S, part, (c, i) => (i < shown ? {} : null));
      // cursor: blinks a few times after typing, then goes away
      const after = t - (S.timing.textStart + S.timing.D);
      if (p >= 1 && after > 1.2) return;
      if (p >= 1 && Math.floor(after * 3) % 2 === 1) return;
      let cx = 0, line = part.lines[0];
      for (const l of part.lines) for (const c of l.chars) if (c.i >= 0 && c.i < Math.max(1, shown)) { cx = l.x + c.x + c.w; line = l; }
      if (shown === 0) cx = part.lines[0].x;
      ctx.fillStyle = S.colors.accent;
      ctx.fillRect(S.cx + part.x + cx + part.size * 0.06, S.cy + part.y + line.baseline - part.capH, Math.max(2, part.size * 0.07), part.capH * 1.1);
    },
  };
  TX.mask = {
    name: 'Mask rise',
    draw(ctx, S, part, p) {
      if (p <= 0) return;
      part.lines.forEach((l, li) => {
        const q = Ease.outExpo(clamp(p * 1.25 - li * 0.18));
        const top = S.cy + part.y + l.baseline - part.capH - part.size * 0.12, h = part.size * 1.15;
        ctx.save(); ctx.beginPath(); ctx.rect(0, top, S.W, h); ctx.clip();
        LOM.drawChars(ctx, S, part, (c, i, n, ln) => (ln === l ? { dy: (1 - q) * h } : null));
        ctx.restore();
      });
    },
  };
  TX.tracking = {
    name: 'Tracking in',
    draw(ctx, S, part, p) {
      if (p <= 0) return;
      if (p >= 1) return LOM.drawPart(ctx, S, part);
      const e = Ease.outCubic(p);
      LOM.drawChars(ctx, S, part, (c, i, n, l) => {
        const mid = l.width / 2, off = (l.x + c.x + c.w / 2 - l.x - mid) * 0.5 * (1 - e);
        return { alpha: Ease.outQuad(p), dx: off };
      });
    },
  };
  TX.blur = { name: 'Blur in', draw(ctx, S, part, p) { const e = Ease.outCubic(p); LOM.drawPart(ctx, S, part, { alpha: Ease.outQuad(p), blur: (1 - e) * 22 * S.u }); } };
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=<>/';
  TX.scramble = {
    name: 'Decode',
    draw(ctx, S, part, p, t) {
      if (p <= 0) return;
      if (p >= 1) return LOM.drawPart(ctx, S, part);
      const f = Math.floor(t * S.fps / 2);
      LOM.drawChars(ctx, S, part, (c, i, n) => {
        const lock = (i + 1) / (n + 1);
        const vis = p * 1.4 > lock * 0.6;
        if (!vis) return null;
        const done = p > lock;
        return { ch: done ? c.ch : GLYPHS[Math.floor(hrand(i * 31 + f, S.seed) * GLYPHS.length)], alpha: done ? 1 : 0.7 };
      });
    },
  };
  LOM.TEXT_ORDER = ['match', 'fade', 'rise', 'stagger', 'typewriter', 'mask', 'tracking', 'blur', 'scramble'];
})();
