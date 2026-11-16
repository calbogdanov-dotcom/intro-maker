import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';

// A small, single-process R2-compatible store. One atomic record contains both
// metadata and bytes, so interrupted writes cannot replace a complete object.
export class DiskBucket {
  constructor(directory) { this.directory = resolve(directory); this.pending = new Map(); }
  file(key) {
    if (typeof key !== 'string' || !key || key.length > 2048 || key.includes('\0')) throw new Error('Invalid storage key');
    return join(this.directory, createHash('sha256').update(key).digest('hex') + '.object');
  }
  async serial(key, operation) {
    const previous = this.pending.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.pending.set(key, next);
    try { return await next; } finally { if (this.pending.get(key) === next) this.pending.delete(key); }
  }
  async record(key, file = this.file(key)) {
    let handle;
    try {
      handle = await open(file, 'r');
      const buffer = Buffer.alloc(16 * 1024), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const end = buffer.subarray(0, bytesRead).indexOf(10);
      if (end < 0) throw new Error('Invalid storage metadata');
      const metadata = JSON.parse(buffer.subarray(0, end).toString('utf8'));
      if (key != null && metadata.key !== key) throw new Error('Invalid storage key');
      const size = (await handle.stat()).size - end - 1;
      return { ...metadata, size, offset: end + 1, file };
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    finally { await handle?.close(); }
  }
  object(record, range, withBody = true) {
    const { key, size, etag, uploaded, httpMetadata } = record;
    let part;
    if (range instanceof Headers) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.get('range') || '');
      range = match ? match[1] ? { offset: Number(match[1]), ...(match[2] ? { length: Number(match[2]) - Number(match[1]) + 1 } : {}) } : { suffix: Number(match[2]) } : undefined;
    }
    if (range) {
      const offset = range.suffix != null ? Math.max(0, size - range.suffix) : range.offset || 0;
      const length = range.suffix != null ? Math.min(size, range.suffix) : Math.min(range.length ?? size - offset, size - offset);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset >= size) throw new RangeError('Unsatisfiable range');
      part = { offset, length };
    }
    const body = () => {
      if (size === 0) return new ReadableStream({ start(controller) { controller.close(); } });
      const start = record.offset + (part?.offset || 0), length = part?.length ?? size;
      return Readable.toWeb(createReadStream(record.file, { start, end: start + length - 1 }));
    };
    const value = { key, size, etag, httpEtag: `"${etag}"`, uploaded: new Date(uploaded), httpMetadata,
      ...(part ? { range: part } : {}),
      writeHttpMetadata(headers) {
        if (httpMetadata.contentType) headers.set('content-type', httpMetadata.contentType);
        if (httpMetadata.cacheControl) headers.set('cache-control', httpMetadata.cacheControl);
      },
    };
    if (withBody) {
      let stream;
      Object.defineProperty(value, 'body', { enumerable: true, get() { return stream ??= body(); } });
      value.arrayBuffer = () => new Response(body()).arrayBuffer();
      value.text = () => new Response(body()).text();
      value.json = async () => JSON.parse(await value.text());
    }
    return value;
  }
  async get(key, options = {}) { const value = await this.record(key); return value ? this.object(value, options.range) : null; }
  async head(key) { const value = await this.record(key); return value ? this.object(value, null, false) : null; }
  async put(key, value, options = {}) {
    const file = this.file(key);
    return this.serial(key, async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const current = await this.record(key), condition = options.onlyIf;
      const wanted = (header, field) => condition instanceof Headers ? condition.get(header) : condition?.[field];
      const matches = wanted('if-match', 'etagMatches'), differs = wanted('if-none-match', 'etagDoesNotMatch');
      const tag = input => String(input).replaceAll('"', '');
      if (matches != null && (!current || (matches !== '*' && tag(matches) !== current.etag))) return null;
      if (differs != null && current && (differs === '*' || tag(differs) === current.etag)) return null;
      const metadata = { key, etag: randomUUID().replaceAll('-', ''), uploaded: new Date().toISOString(), httpMetadata: options.httpMetadata || {} };
      const header = Buffer.from(JSON.stringify(metadata) + '\n');
      if (header.length > 16 * 1024) throw new Error('Storage metadata is too large');
      const temporary = file + '.' + randomUUID() + '.tmp';
      let handle, reader;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(header);
        const response = new Response(value);
        if (response.body) {
          reader = response.body.getReader();
          while (true) { const { done, value: chunk } = await reader.read(); if (done) break; await handle.writeFile(chunk); }
        }
        await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, file);
        return this.object(await this.record(key), null, false);
      } catch (error) { try { await reader?.cancel(error); } catch {} throw error; }
      finally { reader?.releaseLock(); await handle?.close(); await rm(temporary, { force: true }); }
    });
  }
  async delete(key) { return this.serial(key, () => rm(this.file(key), { force: true })); }
  async list({ prefix = '', limit = 1000, cursor } = {}) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const records = [];
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.object$/.test(name)) continue;
      const record = await this.record(null, join(this.directory, name));
      if (record?.key.startsWith(prefix)) records.push(record);
    }
    records.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const start = cursor ? records.findIndex(record => record.key > Buffer.from(cursor, 'base64url').toString('utf8')) : 0;
    const offset = start < 0 ? records.length : start, count = Math.min(1000, Math.max(1, Number(limit) || 1000));
    const selected = records.slice(offset, offset + count), truncated = offset + selected.length < records.length;
    return { objects: selected.map(record => this.object(record, null, false)), truncated, ...(truncated ? { cursor: Buffer.from(selected.at(-1).key).toString('base64url') } : {}) };
  }
}
