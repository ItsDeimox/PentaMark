import { copyFile, mkdir, open, rename, rmdir, link, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { exists, safePath } from './paths.mjs';
import { hashFile, syncDirectory } from './objects.mjs';

export async function matches(path, version) {
  if (!await exists(path)) return !version || version.deleted;
  if (!version || version.deleted) return false;
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('symlink');
  if (version.kind === 'directory') return info.isDirectory();
  if (!info.isFile()) return false;
  const ref = await hashFile(path);
  return ref.blobHash === version.blobHash && ref.byteLength === version.byteLength;
}

async function sameFile(a, b) {
  if (!await exists(a) || !await exists(b)) return false;
  const [left, right] = await Promise.all([lstat(a, { bigint: true }), lstat(b, { bigint: true })]);
  return left.ino === right.ino && left.dev === right.dev;
}

/** Filesystem half of a recoverable transaction. Old files stay in the journal trash.
 * Publishing uses a no-replace hard link of a synced same-volume staging file.
 * This avoids clobbering an external writer racing between validation and publication.
 */
export async function applyFileIntent({ vaultRoot, objects, intent, interrupt = async () => {} }) {
  const { before, desired, intentId } = intent;
  const workRoot = join(vaultRoot, '.pentamark-sync');
  if (await exists(workRoot) && (await lstat(workRoot)).isSymbolicLink()) throw new Error('symlink');
  const work = join(workRoot, intentId);
  await mkdir(work, { recursive: true });
  const old = join(work, 'previous');
  const prepared = join(work, 'desired');
  const source = before && !before.deleted ? await safePath(vaultRoot, before.path) : null;
  const target = await safePath(vaultRoot, desired.path);
  const moving = source && source !== target;
  if (desired.kind === 'directory') {
    await interrupt('before-rename');
    if (desired.deleted) {
      if (await exists(target)) await rmdir(target); // ENOTEMPTY is a conflict, never recursive.
    } else if (moving) {
      // Directory moves are accepted only empty; callers decompose children first.
      if (!await exists(old) && await sameFile(source, target)) {
        // Windows casing aliases resolve to the same directory. Preserve it under
        // the journal name before creating the requested spelling.
        await rename(source, old);
        await syncDirectory(work);
      }
      if (!await exists(target)) await mkdir(target);
      if (await exists(source) && !await sameFile(source, target)) await rmdir(source);
    } else if (!await exists(target)) await mkdir(target);
    await syncDirectory(dirname(target));
    await interrupt('after-rename');
    return;
  }
  if (!desired.deleted && !await exists(prepared)) {
    await copyFile(objects.path(desired.blobHash), prepared);
    const handle = await open(prepared, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(work);
  }
  // A durable captured file proves that the old working entry was removed by us.
  if (!await exists(old) && source) {
    if (!await matches(source, before)) throw new Error('external-change');
    await interrupt('before-rename');
    await rename(source, old);
    await syncDirectory(dirname(source));
    await syncDirectory(work);
    // Preserve a writer that raced the preflight hash. Never overwrite its bytes.
    if (!await matches(old, before)) {
      await objects.capture(old);
      try { await link(old, source); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      throw new Error('external-change');
    }
  } else if (!source) await interrupt('before-rename');
  if (desired.deleted) {
    if (await exists(target)) throw new Error('external-change');
  } else if (!await exists(target)) {
    await link(prepared, target); // atomic, fails on any unexpected native destination
    await syncDirectory(dirname(target));
  } else if (!await sameFile(prepared, target) || !await matches(target, desired)) throw new Error('external-change');
  if (moving && await exists(source) && !await sameFile(source, target)) throw new Error('external-change');
  await interrupt('after-rename');
}
