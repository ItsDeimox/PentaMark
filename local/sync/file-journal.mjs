import { copyFile, mkdir, open, rename, rmdir, link, lstat, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { exists, safeNativePath } from './paths.mjs';
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

export async function directoryIdentity(path) {
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('external-change');
  return { dev: String(info.dev), ino: String(info.ino), birth: String(info.birthtimeNs) };
}
async function ownsDirectory(path, identity) {
  if (!identity || !await exists(path)) return false;
  return JSON.stringify(await directoryIdentity(path)) === JSON.stringify(identity);
}
async function saveEvidence(work, value) {
  const temporary = join(work, `evidence-${randomUUID()}`);
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, join(work, 'directory.json'));
  await syncDirectory(work);
}
async function evidence(work) {
  try { return JSON.parse(await readFile(join(work, 'directory.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Recheck after hooks and immediately before metadata confirmation. */
export async function verifyFileIntent({ vaultRoot, intent }) {
  const target = await safeNativePath(vaultRoot, intent.desiredNativePath ?? intent.desired.path);
  if (intent.desired.deleted) {
    if (await exists(target)) throw new Error('external-change');
  } else if (intent.desired.kind === 'directory') {
    const state = await evidence(join(vaultRoot, '.pentamark-sync', intent.intentId));
    if (!await ownsDirectory(target, state?.target)) throw new Error('external-change');
  } else if (!await matches(target, intent.desired)) throw new Error('external-change');
}

/** Filesystem half of a recoverable transaction. Old files stay in the journal trash.
 * Publishing uses a no-replace hard link of a synced same-volume staging file.
 * This avoids clobbering an external writer racing between validation and publication.
 */
export async function applyFileIntent({ vaultRoot, objects, intent, interrupt = async () => {}, beforeTransition = async () => {} }) {
  const { before, desired, intentId } = intent;
  const workRoot = join(vaultRoot, '.pentamark-sync');
  if (await exists(workRoot) && (await lstat(workRoot)).isSymbolicLink()) throw new Error('symlink');
  const work = join(workRoot, intentId);
  await mkdir(work, { recursive: true });
  const old = join(work, 'previous');
  const prepared = join(work, 'desired');
  const source = before && !before.deleted ? await safeNativePath(vaultRoot, intent.beforeNativePath ?? before.path) : null;
  const target = await safeNativePath(vaultRoot, intent.desiredNativePath ?? desired.path);
  const moving = source && source !== target;
  if (desired.kind === 'directory') {
    let state = await evidence(work);
    if (!state) {
      state = { source: source ? (intent.directorySource ?? await directoryIdentity(source)) : null, target: intent.scaffoldIdentity ?? null };
      await saveEvidence(work, state);
    }
    await interrupt('before-rename');
    await beforeTransition();
    if (desired.deleted) {
      if (await exists(target)) {
        if (!await ownsDirectory(target, state.source)) throw new Error('external-change');
        await rmdir(target);
      }
    } else {
      if (moving && !state.target && await ownsDirectory(target, state.source) && await sameFile(source, target)) {
        await rename(source, old); await syncDirectory(work);
      }
      if (await exists(target)) {
        if (!await ownsDirectory(target, state.target)) throw new Error('external-change');
      } else {
        if (state.target) throw new Error('external-change');
        await mkdir(target); // EEXIST never grants ownership.
        await interrupt('after-directory-create');
        state.target = await directoryIdentity(target);
        await saveEvidence(work, state);
      }
      if (moving && await exists(source) && !await sameFile(source, target)) {
        if (!await ownsDirectory(source, state.source)) throw new Error('external-change');
        await rmdir(source);
      }
    }
    await syncDirectory(dirname(target));
    await interrupt('after-rename');
    await verifyFileIntent({ vaultRoot, intent });
    return;
  }
  if (!desired.deleted) {
    await objects.verify(desired);
    if (await exists(prepared) && !await matches(prepared, desired)) {
      // Never repair a stage in place: it may already be linked to an externally
      // edited working file. Keep the encountered bytes and surface that conflict.
      if (await sameFile(prepared, target)) throw new Error('external-change');
      await rename(prepared, join(work, `incomplete-${randomUUID()}`));
    }
    if (!await exists(prepared)) await copyFile(objects.path(desired.blobHash), prepared);
    const handle = await open(prepared, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(work);
    if (!await matches(prepared, desired)) throw new Error('invalid-staging');
  }
  // A durable captured file proves that the old working entry was removed by us.
  if (!await exists(old) && source) {
    if (!await matches(source, before)) throw new Error('external-change');
    await interrupt('before-rename');
    await beforeTransition();
    await rename(source, old);
    await syncDirectory(dirname(source));
    await syncDirectory(work);
    // Preserve a writer that raced the preflight hash. Never overwrite its bytes.
    if (!await matches(old, before)) {
      await objects.capture(old);
      try { await link(old, source); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      throw new Error('external-change');
    }
    await interrupt('after-preserve');
  } else if (!source) { await interrupt('before-rename'); await beforeTransition(); }
  if (desired.deleted) {
    if (await exists(target)) throw new Error('external-change');
  } else if (!await exists(target)) {
    await link(prepared, target); // atomic, fails on any unexpected native destination
    await syncDirectory(dirname(target));
  } else if (!await sameFile(prepared, target) || !await matches(target, desired)) throw new Error('external-change');
  if (moving && await exists(source) && !await sameFile(source, target)) throw new Error('external-change');
  await interrupt('after-rename');
  await verifyFileIntent({ vaultRoot, intent });
}
