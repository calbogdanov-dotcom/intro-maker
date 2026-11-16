// Cloudflare gives R2 exact-length upload streams. Preserve that validation when
// the same Worker runs on Node instead of silently accepting partial uploads.
globalThis.FixedLengthStream ??= class FixedLengthStream extends TransformStream {
  constructor(length) {
    let written = 0;
    super({
      transform(chunk, controller) { written += chunk.byteLength; if (written > length) throw new Error('Too many upload bytes'); controller.enqueue(chunk); },
      flush() { if (written !== length) throw new Error('Not enough upload bytes'); },
    });
  }
};
