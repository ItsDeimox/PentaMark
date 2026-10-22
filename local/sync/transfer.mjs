import { createReadStream } from 'node:fs';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hashFile } from './objects.mjs';

export const CHUNK_BYTES = 1048576;
export const failure = (statusCode, errorCode) => Object.assign(new Error(errorCode), { statusCode, errorCode });
export function integer(value) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw failure(400, 'invalid-integer');
  return Number(value);
}
// Only JSON and individual transfer segments use a buffer, both with hard caps.
export async function readBounded(req, maximum) {
  if (req.headers['content-length'] !== undefined && integer(req.headers['content-length']) > maximum) throw failure(413, 'body-too-large');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maximum) throw failure(413, 'body-too-large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}
async function size(path) {
  try { return (await stat(path)).size; } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function equalSegment(path, offset, bytes) {
  const handle = await open(path, 'r');
  try {
    const previous = Buffer.alloc(bytes.length); let read = 0;
    while (read < previous.length) {
      const { bytesRead } = await handle.read(previous, read, previous.length - read, offset + read);
      if (!bytesRead) return false;
      read += bytesRead;
    }
    return previous.equals(bytes);
  } finally { await handle.close(); }
}

export async function createTransfers({ host, maxFileBytes, maxConcurrentUploads = 4 }) {
  if (!Number.isSafeInteger(maxConcurrentUploads) || maxConcurrentUploads < 1) throw new Error('invalid-transfer-capacity');
  const root = join(host.root, 'transfers');
  await mkdir(root, { recursive: true });
  let queue = Promise.resolve();
  let admitted = 0;
  return async function upload(req, hash, offsetValue) {
    // Reserve before any await or body read. The bounded queue leaves waiting
    // request streams paused; only its current request allocates a segment.
    if (admitted >= maxConcurrentUploads) throw failure(429, 'transfer-capacity');
    admitted++;
    const work = async () => {
      const offset = integer(offsetValue);
      const range = req.headers['content-range'];
      const match = range === undefined ? null : /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
      if (range !== undefined && !match && range !== 'bytes */0') throw failure(400, 'invalid-content-range');
      const total = range === undefined ? integer(req.headers['x-sync-byte-length']) : match ? integer(match[3]) : 0;
      if (range !== undefined && req.headers['x-sync-byte-length'] !== undefined && integer(req.headers['x-sync-byte-length']) !== total)
        throw failure(400, 'invalid-content-range');
      if (range !== undefined && (match ? integer(match[1]) !== offset || integer(match[2]) !== offset + Math.min(CHUNK_BYTES, total - offset) - 1 : offset !== 0))
        throw failure(400, 'invalid-content-range');
      if (total > await maxFileBytes()) throw failure(413, 'file-too-large');
      if (offset > total || offset % CHUNK_BYTES !== 0) throw failure(409, 'invalid-offset');
      const bytes = await readBounded(req, CHUNK_BYTES);
      if (bytes.length !== Math.min(CHUNK_BYTES, total - offset)) throw failure(400, 'invalid-length');
      if (total > await maxFileBytes()) throw failure(413, 'file-too-large');
      const published = host.objects.path(hash);
      const existing = await size(published);
      if (existing !== null) {
        if (existing !== total || !await equalSegment(published, offset, bytes)) throw failure(409, 'segment-mismatch');
        return { blobHash: hash, verifiedBytes: total, complete: true };
      }
      // Total is part of the staging name, so resumed metadata cannot change it.
      const path = join(root, `${hash}-${total}.part`);
      let stored = await size(path) ?? 0;
      // A crash can leave an unacknowledged short write. Full segments remain
      // resumable; final publication still requires hashing the entire object.
      if (stored !== total && stored % CHUNK_BYTES) {
        stored -= stored % CHUNK_BYTES;
        const handle = await open(path, 'r+');
        try { await handle.truncate(stored); await handle.sync(); }
        finally { await handle.close(); }
      }
      if (offset > stored) throw failure(409, 'invalid-offset');
      if (offset < stored) {
        if (offset + bytes.length > stored || !await equalSegment(path, offset, bytes)) throw failure(409, 'segment-mismatch');
      } else {
        const handle = await open(path, stored ? 'r+' : 'w');
        try {
          let written = 0;
          while (written < bytes.length) written += (await handle.write(bytes, written, bytes.length - written, offset + written)).bytesWritten;
          await handle.sync();
        } catch (error) { await handle.truncate(stored); throw error; }
        finally { await handle.close(); }
      }
      const verifiedBytes = Math.max(stored, offset + bytes.length);
      if (verifiedBytes === total) {
        const actual = await hashFile(path);
        if (actual.blobHash !== hash || actual.byteLength !== total) {
          await unlink(path);
          throw failure(422, 'hash-mismatch');
        }
        if (total > await maxFileBytes()) throw failure(413, 'file-too-large');
        // Verification precedes publication; put consumes a stream, never the full file.
        await host.objects.put(createReadStream(path));
        await unlink(path);
      }
      return { blobHash: hash, verifiedBytes, complete: verifiedBytes === total };
    };
    const next = queue.then(work);
    queue = next.catch(() => {});
    try { return await next; }
    finally { admitted--; }
  };
}
