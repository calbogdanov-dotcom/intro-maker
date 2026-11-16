import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const source = await readFile(new URL('../maker/shared-saves.js', import.meta.url), 'utf8');
const scope = { window: {} }; vm.runInNewContext(source, scope);
const { Resource, mergeRecords } = scope.window.LOM_SHARED;
const clone = value => JSON.parse(JSON.stringify(value));
const merge = (key, base, local, remote) => clone(mergeRecords(key, base, local, remote));
const library = () => ({ logos: [], fonts: [], presets: [], last: { company: 'Initial' } });
const preset = (name, company = name) => ({ name, state: { company } });
const option = (slot, company = `Intro ${slot}`) => ({ slot, title: `Intro ${slot}`, state: { company } });
const drafts = (items = [], count = 4) => ({ iterations: [{ number: 1, title: 'Iteration 1', count, items }] });
function backend(key, initial) {
  let value = clone(initial), revision = 1;
  const state = { gets: 0, puts: 0, writes: [], failNext: null, pause: null };
  state.read = () => clone(value);
  state.request = async (path, options = {}) => {
    if (options.method !== 'PUT') { state.gets++; return { [key]: clone(value), revision: String(revision) }; }
    state.puts++;
    if (state.pause) await state.pause;
    if (state.failNext) { const error = state.failNext; state.failNext = null; throw error; }
    const input = JSON.parse(options.body);
    if (input.revision !== String(revision)) throw Object.assign(new Error('Stale revision'), { status: 409 });
    value = clone(input[key]); revision++; state.writes.push(clone(value));
    return { revision: String(revision) };
  };
  return state;
}
async function clients(key, initial, options = {}) {
  const store = backend(key, initial), changes = [];
  const a = new Resource('/record', key, { ...options, request: store.request, onChange: resource => changes.push({ pending: resource.pending, error: resource.error }) });
  const b = new Resource('/record', key, { ...options, request: store.request });
  const [left, right] = await Promise.all([a.load(), b.load()]);
  return { store, a, b, left, right, changes };
}

await test('two visitors merge independent presets and preserve remote additions on later saves', async () => {
  const { store, a, b, left, right } = await clients('library', library());
  left.presets.push(preset('Alice')); right.presets.push(preset('SK'));
  await a.save(left); await b.save(right);
  assert.deepEqual(store.read().presets.map(p => p.name), ['Alice', 'SK']);
  right.last.company = 'SK changes preview'; await b.save(right);
  assert.deepEqual(store.read().presets.map(p => p.name), ['Alice', 'SK']);
  left.presets.push(preset('Alice second')); await a.save(left);
  assert.deepEqual(new Set(store.read().presets.map(p => p.name)), new Set(['Alice', 'SK', 'Alice second']));
});

await test('independent working settings do not block shared preset and asset saves', async () => {
  const initial = library(), local = clone(initial), remote = clone(initial);
  local.last.company = 'SK'; remote.last.company = 'Owner';
  local.fonts.push({ name: 'SK font', src: 'data:font/woff2;base64,AA==' });
  remote.logos.push({ id: 'owner-logo', name: 'Owner', src: 'data:image/svg+xml,a' });
  const result = merge('library', initial, local, remote);
  assert.equal(result.last.company, 'SK'); assert.equal(result.fonts[0].name, 'SK font'); assert.equal(result.logos[0].id, 'owner-logo');
});

await test('divergent changes to the same named preset conflict instead of overwriting', () => {
  const initial = { ...library(), presets: [preset('Shared')] }, local = clone(initial), remote = clone(initial);
  local.presets[0].state.company = 'SK'; remote.presets[0].state.company = 'Owner';
  assert.throws(() => merge('library', initial, local, remote), error => error.conflict && /presets.*Shared/.test(error.message));
});

await test('same-slot conflict preserves local changes and a corrected save recovers without reload', async () => {
  const { store, a, b, left, right } = await clients('drafts', drafts([option(1)]));
  left.iterations[0].items[0].state.company = 'Owner'; right.iterations[0].items[0].state.company = 'SK';
  await a.save(left);
  await assert.rejects(b.save(right), error => error.conflict && /items.*1/.test(error.message));
  assert.equal(b.latest.iterations[0].items[0].state.company, 'SK');
  assert.equal(store.read().iterations[0].items[0].state.company, 'Owner');
  right.iterations[0].items[0] = option(1); right.iterations[0].items.push(option(2, 'SK safe option'));
  await b.save(right); await b.flush();
  assert.equal(b.error, null); assert.equal(b.pending, 0);
  assert.equal(store.read().iterations[0].items[0].state.company, 'Owner');
  assert.equal(store.read().iterations[0].items[1].state.company, 'SK safe option');
});

await test('different slots, iteration metadata, and unknown fields merge independently', () => {
  const initial = drafts([option(1), option(2)]), local = clone(initial), remote = clone(initial);
  initial.extension = { kept: true }; local.extension = { kept: true, ours: 1 }; remote.extension = { kept: true, theirs: 2 };
  local.iterations[0].items[0].state.company = 'SK'; remote.iterations[0].items[1].state.company = 'Owner';
  remote.iterations[0].title = 'Owner title'; local.iterations[0].extra = 'Kept';
  const result = merge('drafts', initial, local, remote);
  assert.equal(result.iterations[0].items[0].state.company, 'SK'); assert.equal(result.iterations[0].items[1].state.company, 'Owner');
  assert.equal(result.iterations[0].title, 'Owner title'); assert.equal(result.iterations[0].extra, 'Kept');
  assert.deepEqual(result.extension, { kept: true, theirs: 2, ours: 1 });
});

await test('disjoint deletions are retained, while deletion against an edited entity conflicts', () => {
  const initial = { ...library(), presets: [preset('A'), preset('B'), preset('C')], extension: { a: 1, b: 2 } };
  const local = clone(initial), remote = clone(initial);
  local.presets = local.presets.filter(p => p.name !== 'A'); remote.presets = remote.presets.filter(p => p.name !== 'B');
  delete local.extension.a; remote.extension.c = 3;
  const result = merge('library', initial, local, remote);
  assert.deepEqual(result.presets.map(p => p.name), ['C']); assert.deepEqual(result.extension, { b: 2, c: 3 });
  remote.presets.find(p => p.name === 'A').state.company = 'Owner edit';
  assert.throws(() => merge('library', initial, local, remote), error => error.conflict && /presets.*A/.test(error.message));
  const before = drafts([option(1)]), ours = clone(before), theirs = clone(before);
  ours.iterations[0].items = []; theirs.iterations[0].items[0].state.company = 'Changed';
  assert.throws(() => merge('drafts', before, ours, theirs), error => error.conflict);
  ours.iterations = [];
  assert.throws(() => merge('drafts', before, ours, theirs), error => error.conflict && /iterations/.test(error.message));
});

await test('concurrent option-count changes cannot create out-of-bounds merged slots', () => {
  const initial = drafts([option(1)], 4), local = clone(initial), remote = clone(initial);
  local.iterations[0].count = 2; remote.iterations[0].items.push(option(4));
  assert.throws(() => merge('drafts', initial, local, remote), error => error.conflict && /option count/.test(error.message));
});

await test('jingle slots rebase separately and divergent replacement audio conflicts', () => {
  const initial = drafts([{ slot: 1, title: 'Jingle 1', key: 'original.wav' }]), local = clone(initial), remote = clone(initial);
  local.iterations[0].items.push({ slot: 2, title: 'Jingle 2', key: 'ours.wav' });
  remote.iterations[0].items[0].key = 'theirs.wav';
  const result = merge('jingles', initial, local, remote);
  assert.deepEqual(result.iterations[0].items.map(item => item.key), ['theirs.wav', 'ours.wav']);
  local.iterations[0].items[0].key = 'different.wav';
  assert.throws(() => merge('jingles', initial, local, remote), error => error.conflict);
});

await test('callers adopting merged drafts can deliberately delete a newly learned remote slot', async () => {
  const { store, a, b, left, right } = await clients('drafts', drafts([option(1)]), { acceptMerged: true });
  left.iterations[0].items.push(option(2, 'Owner addition')); await a.save(left);
  right.iterations[0].items[0].state.company = 'SK edit';
  const adopted = await b.save(right);
  assert.equal(adopted.iterations[0].items.length, 2);
  adopted.iterations[0].items = adopted.iterations[0].items.filter(item => item.slot !== 2);
  await b.save(adopted);
  assert.deepEqual(store.read().iterations[0].items.map(item => item.slot), [1]);
  assert.equal(store.read().iterations[0].items[0].state.company, 'SK edit');
});

await test('queued writes serialize revisions and notify pending changes on completion', async () => {
  const { store, a, left, changes } = await clients('library', library());
  let release; store.pause = new Promise(resolve => { release = resolve; });
  left.last.company = 'First'; const one = a.save(left);
  left.last.company = 'Second'; const two = a.save(left);
  assert.equal(a.pending, 2);
  await Promise.resolve(); await Promise.resolve(); assert.equal(store.puts, 1);
  release(); await Promise.all([one, two]); await a.flush();
  assert.deepEqual(store.writes.map(item => item.last.company), ['First', 'Second']);
  assert.equal(a.pending, 0); assert.equal(changes.at(-1).pending, 0); assert.equal(store.read().last.company, 'Second');
});

await test('transient failure remains visible to flush and retry safely persists the latest snapshot', async () => {
  const { store, a, left } = await clients('library', library());
  left.presets.push(preset('Keep unsaved work')); store.failNext = new Error('Offline');
  await assert.rejects(a.save(left), /Offline/); await assert.rejects(a.flush(), /Offline/);
  assert.equal(a.pending, 0); assert.equal(a.error.message, 'Offline'); assert.equal(a.latest.presets[0].name, 'Keep unsaved work');
  await a.retry(); await a.flush();
  assert.equal(a.error, null); assert.equal(store.read().presets[0].name, 'Keep unsaved work');
});

await test('missing initial record can merge two first library saves without losing either preset', () => {
  const local = { ...library(), presets: [preset('First')] }, remote = { ...library(), presets: [preset('Second')] };
  assert.deepEqual(merge('library', null, local, remote).presets.map(p => p.name), ['Second', 'First']);
});

await test('unchanged snapshots skip writes and preserve another visitor’s merged additions', async () => {
  const { store, a, b, left, right, changes } = await clients('library', library());
  const unchanged = await a.save(left); assert.deepEqual(clone(unchanged), clone(left));
  assert.equal(store.puts, 0); assert.equal(a.pending, 0); assert.equal(changes.at(-1).pending, 0);
  left.presets.push(preset('Owner')); await a.save(left);
  right.presets.push(preset('SK')); await b.save(right);
  const count = store.puts;
  const merged = await b.save(right);
  assert.equal(store.puts, count); assert.deepEqual(clone(merged).presets.map(p => p.name), ['Owner', 'SK']);
  right.last.company = 'Still editable'; await b.save(right);
  assert.deepEqual(store.read().presets.map(p => p.name), ['Owner', 'SK']);
});

await test('revision retry is bounded when another visitor keeps saving', async () => {
  let gets = 0, puts = 0;
  const initial = library();
  const resource = new Resource('/busy', 'library', { request: async (path, options = {}) => {
    if (options.method === 'PUT') { puts++; throw Object.assign(new Error('Stale'), { status: 412 }); }
    return { library: clone(initial), revision: String(++gets) };
  } });
  await resource.load(); const edited = clone(initial); edited.last.company = 'Kept';
  await assert.rejects(resource.save(edited), /busy/); assert.equal(puts, 4); assert.equal(resource.latest.last.company, 'Kept'); assert.equal(resource.pending, 0);
});
