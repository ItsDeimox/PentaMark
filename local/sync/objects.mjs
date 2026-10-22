import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export async function syncDirectory(path) {
  let handle;
  try { handle = await open(path, 'r'); await handle.sync(); }
  catch (e) { if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EISDIR', 'EINVAL'].includes(e.code)) throw e; }
  finally { await handle?.close(); }
}
export async function hashFile(path) {
  const hash = createHash('sha256'); let byteLength = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); byteLength += chunk.length; }
  return { blobHash: hash.digest('hex'), byteLength };
}
export async function createObjectStore(root) {
  await mkdir(root, { recursive: true });
  const path = hash => { if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid-hash'); return join(root, hash); };
  async function put(source) {
    const temporary = join(root, `.incoming-${randomUUID()}`);
    const handle = await open(temporary, 'wx');
    const hash = createHash('sha256'); let byteLength = 0;
    try {
      const chunks = typeof source === 'string' || Buffer.isBuffer(source) ? [Buffer.from(source)] : source;
      for await (const chunk of chunks) {
        const bytes = Buffer.from(chunk); hash.update(bytes); byteLength += bytes.length;
        if (!Number.isSafeInteger(byteLength)) throw new Error('file-too-large');
        let offset = 0;
        while (offset < bytes.length) offset += (await handle.write(bytes, offset, bytes.length - offset)).bytesWritten;
      }
      await handle.sync();
    } finally { await handle.close(); }
    const blobHash = hash.digest('hex');
    try { await link(temporary, path(blobHash)); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    await syncDirectory(root);
    await unlink(temporary);
    return { blobHash, byteLength };
  }
  async function verify(ref) {
    const actual = await hashFile(path(ref.blobHash));
    if (actual.blobHash !== ref.blobHash || actual.byteLength !== ref.byteLength) throw new Error('invalid-blob');
  }
  async function* fileChunks(file) {
    // Open only when put is ready to consume; sharing errors must reject the
    // coordinator promise, never escape as an unhandled stream error.
    yield* createReadStream(file);
  }
  return { root, path, put, verify, capture: file => put(fileChunks(file)) };
}
