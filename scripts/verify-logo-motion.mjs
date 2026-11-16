import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';

const [engineSource, logoSource, emergeSource, appSource] = await Promise.all([
  'engine.js', 'logo-anims.js', 'emerge.js', 'app.js',
].map(name => readFile(new URL('../maker/' + name, import.meta.url), 'utf8')));

function canvas(width = 320, height = 180) {
  const gradient = {addColorStop() {}};
  const context = new Proxy({globalAlpha: 1, createLinearGradient: () => gradient,
    createRadialGradient: () => gradient, createPattern: () => ({}),
    getImageData: () => ({data: new Uint8ClampedArray(width * height * 4)}),
  }, {get(target, key) {return key in target ? target[key] : (() => {});}});
  return {width, height, getContext: () => context};
}

function harness() {
  const document = {createElement: () => canvas(), querySelector: () => ({getContext: () => ({})})};
  const context = vm.createContext({window: {}, document, console,
    Path2D: class {moveTo() {} arc() {} closePath() {} rect() {}},
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0,
  });
  for (const source of [engineSource, logoSource, emergeSource]) vm.runInContext(source, context);
  const LOM = context.window.LOM;
  LOM.blurred = source => source;
  LOM.tinted = source => source;
  return {context, LOM};
}

function scene(state = {}) {
  const part = (role, w, h) => ({role, canvas: canvas(w + 8, h + 8), w, h, pad: 4, x: 0, y: 0});
  const mark = part('mark', 64, 64), text = part('text', 96, 24), tag = part('tag', 72, 12);
  return {st: {mode: 'separate', logoAnim: 'fadeUp', emerge: 'blocks', textAnim: 'match',
    camera: 'none', transparent: true, glow: 0, vignette: 0, grain: 0, intro: 'none',
    outro: 'none', duration: 6, delay: 0.5, revealDur: 1.4, textDelay: 0.35,
    layout: 'horizontal', gap: 30, fps: 30, ...state},
    W: 320, H: 180, cx: 160, cy: 90, u: 1, fps: 30, seed: 7, dark: true,
    colors: {bgA: '#000000', bgB: '#111111', accent: '#00ff99'},
    timing: {start: 0.5, D: 1.4, textStart: 0.85, tagStart: 1.48},
    parts: {mark, text, tag}, partList: [mark, text, tag], lockup: part('lockup', 160, 72),
    cache: {'steps:mark': [{x0: 0, x1: 20, top: 0, bot: 64}, {x0: 20, x1: 40, top: 0, bot: 42}, {x0: 40, x1: 64, top: 0, bot: 20}]},
    layer: canvas(),
  };
}

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${message || 'time'}: expected ${expected}, received ${actual}`);

await test('old settings and neutral controls preserve exact original timestamps', () => {
  const {LOM} = harness();
  for (const mode of ['separate', 'emerge']) for (const logoAnim of LOM.LOGO_ORDER) {
    for (const controls of [{}, {logoEaseIn: 0, logoEaseOut: 0, logoSpeed: 1}]) {
      const S = scene({mode, logoAnim, ...controls});
      for (const t of [-1, 0, 0.1, 0.5, 0.87654321, 1.75, 5.99999, 30]) {
        assert.equal(LOM.logoTime(t, S), t, `${mode}/${logoAnim}: default timestamp changed`);
      }
    }
  }
});

await test('speed keeps the start delay and scales the complete logo sequence', () => {
  const {LOM} = harness();
  for (const speed of [0.25, 0.5, 1, 2, 3]) {
    const S = scene({logoSpeed: speed}), start = S.timing.start;
    assert.equal(LOM.logoTime(start - 0.1, S), start - 0.1);
    assert.equal(LOM.logoTime(start, S), start);
    for (const elapsed of [0.01, 0.5, 1.75, 12]) {
      close(LOM.logoTime(start + elapsed, S), start + elapsed * speed, 'speed');
    }
  }
});

await test('easing independently softens the beginning and end without changing completion', () => {
  const {LOM} = harness();
  const base = scene(), start = base.timing.start, span = LOM.logoRevealEnd(base) - start;
  const quarter = start + span * 0.25, threeQuarters = start + span * 0.75;
  assert.ok(LOM.logoTime(quarter, scene({logoEaseIn: 100})) < quarter);
  assert.ok(LOM.logoTime(threeQuarters, scene({logoEaseOut: 100})) > threeQuarters);
  for (const speed of [0.25, 1, 3]) for (const easeIn of [0, 25, 100]) for (const easeOut of [0, 25, 100]) {
    const S = scene({logoSpeed: speed, logoEaseIn: easeIn, logoEaseOut: easeOut});
    const end = start + span / speed;
    close(LOM.logoTime(start, S), start, 'start');
    close(LOM.logoTime(end, S), start + span, 'completion');
    close(LOM.logoTime(end + 1e-8, S), start + span + speed * 1e-8, 'continuous hold boundary');
    let previous = -Infinity;
    for (let i = 0; i <= 400; i++) {
      const value = LOM.logoTime(start + (span / speed + 1) * i / 400, S);
      assert.ok(Number.isFinite(value) && value >= previous, 'logo clock reversed or became invalid');
      previous = value;
    }
  }
});

await test('reveal endpoints cover late text, taglines, raw mark timers, and emerge formation', () => {
  const {LOM} = harness();
  for (const logoAnim of LOM.LOGO_ORDER) {
    const S = scene({logoAnim}), animation = LOM.LOGO_ANIMS[logoAnim];
    const T = animation.timing ? animation.timing(S.timing, S) : S.timing;
    const end = LOM.logoRevealEnd(S);
    assert.ok(end > S.timing.start, `${logoAnim} has no reveal span`);
    if (!animation.all) {
      assert.ok(end >= T.textStart + T.D - 1e-9, `${logoAnim} finishes before text`);
      assert.ok(end >= T.tagStart + T.D - 1e-9, `${logoAnim} finishes before tagline`);
    }
    if (logoAnim === 'backlit') assert.ok(end >= T.start + T.D * 2.4 - 1e-9);
    if (logoAnim === 'steps') assert.ok(end >= T.start + T.D * 1.6 - 1e-9);
  }
  for (const emerge of LOM.EMERGE_ORDER) {
    const S = scene({mode: 'emerge', emerge, logoSpeed: 2, logoEaseIn: 75, logoEaseOut: 60});
    const end = LOM.emergeDone(S), start = S.timing.start;
    close(LOM.logoTime(start + (end - start) / 2, S), end, emerge + ' completion');
  }
  for (const [logoAnim, multiplier] of [['backlit', 2.4], ['steps', 1.6]]) {
    const S = scene({logoAnim});
    S.parts.text = null; S.parts.tag = null;
    close(LOM.logoRevealEnd(S), S.timing.start + S.timing.D * multiplier, logoAnim + ' mark-only span');
  }
});

await test('every separate style receives the logo clock, including Slide, Backlit, and Steps', () => {
  const {LOM} = harness(), originalDraw = LOM.drawLogoAnim;
  const draws = [];
  LOM.drawPart = (ctx, S, part, options = {}) => draws.push([part.role, {...options}]);
  for (const logoAnim of LOM.LOGO_ORDER) {
    const S = scene({logoAnim, logoSpeed: 1.8, logoEaseIn: 55, logoEaseOut: 45});
    const t = S.timing.start + (LOM.logoRevealEnd(S) - S.timing.start) * 0.4;
    const expectedTime = LOM.logoTime(t, S);
    let receivedTime;
    LOM.drawLogoAnim = (ctx, time, currentScene) => {receivedTime = time; originalDraw(ctx, time, currentScene);};
    draws.length = 0;
    LOM.renderFrame(canvas().getContext('2d'), S, t);
    close(receivedTime, expectedTime, logoAnim + ' render clock');
    const rendered = draws.slice();
    draws.length = 0;
    originalDraw(canvas().getContext('2d'), expectedTime, S);
    assert.deepEqual(draws, rendered, logoAnim + ' rendered different logo operations');
  }
});

await test('independent text animations share the eased clock and keep their stagger', () => {
  const {LOM} = harness(), received = [];
  const S = scene({logoAnim: 'backlit', textAnim: 'fade', logoSpeed: 1.5, logoEaseIn: 30, logoEaseOut: 60});
  const t = 1.4, mapped = LOM.logoTime(t, S);
  const T = LOM.LOGO_ANIMS.backlit.timing(S.timing, S);
  LOM.drawPart = () => {};
  LOM.TEXT_ANIMS.fade.draw = (ctx, currentScene, part, p, time) => received.push([part.role, p, time]);
  LOM.renderFrame(canvas().getContext('2d'), S, t);
  assert.equal(received.length, 2);
  for (const [role, p, time] of received) {
    close(time, mapped, role + ' time');
    close(p, LOM.prog(mapped, role === 'text' ? T.textStart : T.tagStart, T.D), role + ' progress');
  }
});

await test('regular backgrounds keep real time and emerge background, foreground, and hold stay synchronized', () => {
  const {LOM} = harness(), calls = [];
  LOM.BACKGROUNDS.test = {draw(ctx, t) {calls.push(['background', t]);}};
  LOM.drawLogoAnim = (ctx, t) => calls.push(['logo', t]);
  let S = scene({bg: 'test', transparent: false, logoSpeed: 2, logoEaseIn: 80});
  LOM.renderFrame(canvas().getContext('2d'), S, 1.25);
  assert.deepEqual(calls, [['background', 1.25], ['logo', LOM.logoTime(1.25, S)]]);

  LOM.EMERGE.test = {done: 1.4, bg(ctx, t) {calls.push(['effect background', t]);},
    fg(ctx, t) {calls.push(['effect foreground', t]);}};
  LOM.HOLD.test = {pre(ctx, t, currentScene, amp) {calls.push(['hold pre', t, amp]);},
    post(ctx, t, currentScene, amp) {calls.push(['hold post', t, amp]);}};
  S = scene({mode: 'emerge', emerge: 'test', emergeHold: 'test', emergeBg: 'test',
    transparent: false, logoSpeed: 2, logoEaseIn: 40, logoEaseOut: 65});
  const done = LOM.emergeDone(S), t = S.timing.start + (done - S.timing.start + 0.2) / 2;
  const mapped = LOM.logoTime(t, S), amplitude = LOM.smooth(done - 0.1, done + 0.8, mapped);
  calls.length = 0;
  LOM.renderFrame(canvas().getContext('2d'), S, t);
  close(calls.find(c => c[0] === 'effect background')[1], mapped);
  close(calls.find(c => c[0] === 'effect foreground')[1], mapped);
  close(calls.find(c => c[0] === 'background')[1], t, 'selected background time');
  for (const name of ['hold pre', 'hold post']) {
    const call = calls.find(c => c[0] === name);
    assert.ok(call, name + ' was not rendered');
    close(call[1], mapped - done, name + ' clock');
    close(call[2], amplitude, name + ' amplitude');
  }
});

await test('defaults, presets, and draft restoration retain motion values and migrate older states', async () => {
  const {context} = harness();
  const persisted = [];
  context.window.LOM.BACKGROUNDS.particles = {name: 'Particles'};
  context.window.LOM_STORAGE = {async save(value) {persisted.push(JSON.parse(JSON.stringify(value)));}};
  const endOfApp = appSource.indexOf('  window.LOM_READY =');
  assert.ok(endOfApp > 0, 'could not isolate editor initialization');
  vm.runInContext(appSource.slice(0, endOfApp) + `
    syncAll = () => {}; changed = () => {}; rebuild = async () => {};
    saveLib = () => {}; syncPresets = () => {}; toast = () => {};
    window.__motionTest = {presets: lib.presets, applyPresetValue, savePreset,
      setState: value => { st = Object.assign(clone(DEFAULTS), value); },
      lookKeys: LOOK_KEYS};
  })();`, context);
  const editor = context.window.LOM_HOSTED, hooks = context.window.__motionTest;
  const controls = {logoEaseIn: 68, logoEaseOut: 42, logoSpeed: 1.75};
  const assertControls = expected => {
    const actual = editor.state();
    for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, key);
  };
  const defaults = {logoEaseIn: 0, logoEaseOut: 0, logoSpeed: 1};
  assertControls(defaults);
  for (const key of Object.keys(controls)) assert.ok(hooks.lookKeys.includes(key), key + ' omitted from logo look');
  await editor.apply({...controls, company: 'Saved draft'});
  assertControls(controls);
  context.prompt = () => 'Motion test preset';
  await hooks.savePreset();
  for (const [key, value] of Object.entries(controls)) assert.equal(hooks.presets[0].state[key], value);
  assert.equal(persisted.length, 1, 'saving a preset did not persist the shared library');
  for (const [key, value] of Object.entries(controls)) {
    assert.equal(persisted[0].presets[0].state[key], value, 'saved preset omitted ' + key);
    assert.equal(persisted[0].last[key], value, 'saved session omitted ' + key);
  }
  await editor.apply({company: 'Old draft'});
  assertControls(defaults);
  await editor.flushSave();
  for (const [key, value] of Object.entries(defaults)) assert.equal(persisted.at(-1).last[key], value);
  hooks.applyPresetValue('u0');
  assertControls(controls);
  hooks.presets.push({name: 'Old preset', state: {logoAnim: 'pop'}});
  hooks.applyPresetValue('u1');
  assertControls(defaults);
  assert.equal(editor.state().logoAnim, 'pop');
});
