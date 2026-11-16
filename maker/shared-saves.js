// Rebase a caller's changes onto the shared record without discarding other edits.
'use strict';
(function () {
  const missing = Symbol('missing');
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const copy = value => value === missing || value === undefined ? value : JSON.parse(JSON.stringify(value));
  function equal(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equal(value, b[i]));
    if (!object(a) || !object(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]));
  }
  function conflict(label) {
    const error = new Error(`Someone else changed ${label}. Your changes are kept here. Resolve that change before saving again.`);
    error.conflict = true;
    return error;
  }
  function atomic(base, local, remote, label) {
    if (equal(local, base)) return copy(remote);
    if (equal(remote, base) || equal(local, remote)) return copy(local);
    throw conflict(label);
  }
  function keyed(base, local, remote, field, label, mergeEntry = atomic) {
    if (!Array.isArray(local) || !Array.isArray(remote) || !(Array.isArray(base) || base === missing || base == null)) return atomic(base, local, remote, label);
    function index(values) {
      const result = new Map();
      for (const value of values || []) {
        if (!object(value) || !own(value, field) || !['string', 'number'].includes(typeof value[field])) throw conflict(label);
        const key = `${typeof value[field]}:${value[field]}`;
        if (result.has(key)) throw conflict(`${label} with duplicate ${field}`);
        result.set(key, value);
      }
      return result;
    }
    const before = index(base === missing ? [] : base), ours = index(local), theirs = index(remote);
    const keys = new Set([...theirs.keys(), ...ours.keys(), ...before.keys()]);
    const result = [];
    for (const key of keys) {
      const value = ours.get(key) || theirs.get(key) || before.get(key);
      const entry = mergeEntry(before.has(key) ? before.get(key) : missing, ours.has(key) ? ours.get(key) : missing, theirs.has(key) ? theirs.get(key) : missing, `${label} “${value[field]}”`);
      if (entry !== missing) result.push(entry);
    }
    return result;
  }
  function fields(base, local, remote, label, special = {}) {
    if (equal(local, base)) return copy(remote);
    if (equal(remote, base) || equal(local, remote)) return copy(local);
    if (!object(local) || !object(remote) || !(object(base) || base === missing || base == null)) return atomic(base, local, remote, label);
    const before = object(base) ? base : {}, result = {};
    for (const key of new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(before)])) {
      const a = own(before, key) ? before[key] : missing, b = own(local, key) ? local[key] : missing, c = own(remote, key) ? remote[key] : missing;
      const value = own(special, key) ? special[key](a, b, c, `${label}.${key}`) : fields(a, b, c, `${label}.${key}`);
      if (value !== missing) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  function mergeRecords(key, base, local, remote) {
    const named = field => (a, b, c, label) => keyed(a, b, c, field, label);
    const iteration = (a, b, c, label) => fields(a, b, c, label, { items: named('slot') });
    const special = key === 'library' ? {
      logos: named('id'), fonts: named('name'), presets: named('name'),
      // Working preview settings are independent of the shared saved options.
      last: (a, b, c) => copy(equal(a, b) ? c : b),
    } : { iterations: (a, b, c, label) => keyed(a, b, c, 'number', label, iteration) };
    const result = fields(base, local, remote, key, special);
    if ((key === 'drafts' || key === 'jingles') && result != null) {
      if (!Array.isArray(result.iterations)) throw conflict(`${key} iterations`);
      const numbers = new Set();
      for (const item of result.iterations) {
        if (!item || !Number.isInteger(item.number) || item.number < 1 || item.number > 99 || numbers.has(item.number) || ![2, 4, 8].includes(item.count) || !Array.isArray(item.items) || item.items.length > item.count) throw conflict('the iteration option count');
        numbers.add(item.number);
        const slots = new Set();
        for (const saved of item.items) {
          if (!saved || !Number.isInteger(saved.slot) || saved.slot < 1 || saved.slot > item.count || slots.has(saved.slot)) throw conflict(`the option count and saved slots in iteration ${item.number}`);
          slots.add(saved.slot);
        }
      }
    }
    return result;
  }
  class Resource {
    constructor(path, key, { request, onChange = () => {}, acceptMerged = false }) {
      this.path = path; this.key = key; this.request = request; this.onChange = onChange;
      this.acceptMerged = acceptMerged;
      this.latest = null; this.pending = 0; this.error = null; this.loaded = false; this.queue = Promise.resolve();
      this.base = null; this.remote = null; this.revision = null;
    }
    changed() { this.onChange(this); }
    async load() {
      const result = await this.request(this.path);
      this.revision = result.revision ?? null;
      this.base = copy(result[this.key] ?? null); this.remote = copy(this.base); this.latest = copy(this.base);
      this.loaded = true; this.error = null; this.changed();
      return copy(this.base);
    }
    save(value) {
      if (!this.loaded) return Promise.reject(new Error('The workspace has not loaded yet.'));
      const snapshot = copy(value); this.latest = copy(value); this.pending++; this.changed();
      this.queue = this.queue.catch(() => {}).then(async () => {
        try {
          for (let attempt = 0; attempt < 4; attempt++) {
            const merged = mergeRecords(this.key, this.base, snapshot, this.remote);
            if (equal(merged, this.remote)) {
              this.base = copy(this.acceptMerged ? merged : snapshot); this.error = null;
              return copy(merged);
            }
            try {
              const result = await this.request(this.path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [this.key]: merged, revision: this.revision }) });
              this.revision = result.revision ?? null; this.remote = copy(merged); this.base = copy(this.acceptMerged ? merged : snapshot); this.error = null;
              return copy(merged);
            } catch (error) {
              if (error.status !== 409 && error.status !== 412) throw error;
              const fresh = await this.request(this.path);
              this.revision = fresh.revision ?? null; this.remote = copy(fresh[this.key] ?? null);
            }
          }
          // Check once more so divergent edits still get their specific message.
          mergeRecords(this.key, this.base, snapshot, this.remote);
          throw new Error('The shared workspace is busy. Your changes are kept here; try saving again.');
        } catch (error) { this.error = error; throw error; }
        finally { this.pending--; this.changed(); }
      });
      this.queue.catch(() => {});
      return this.queue;
    }
    async flush() { await this.queue; if (this.error) throw this.error; }
    retry() { return this.save(this.latest); }
  }
  window.LOM_SHARED = { Resource, mergeRecords };
})();
