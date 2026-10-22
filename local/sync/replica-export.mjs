import { randomUUID } from 'node:crypto';
import { mkdir, readdir, copyFile, open, rename, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { scanVault } from './scan.mjs';
import { syncDirectory } from './objects.mjs';
import { safePath } from './paths.mjs';

/** Called inside the replica's serialization queue. Export canonical JSON
 * metadata, not a live SQLite/WAL copy. Incomplete output stays visibly partial. */
export async function exportReplicaDirectory({ destination, privateRoot, workingRoot, objects, manifest }) {
  const fold = path => process.platform === 'win32' ? path.toLowerCase() : path;
  const target = resolve(destination), privatePath = resolve(privateRoot);
  if (fold(target) === fold(privatePath) || fold(target).startsWith(fold(privatePath + sep))) throw new Error('private-export-destination');
  const name = `PentaMark-replica-${randomUUID()}`;
  const partial = join(target, `.${name}.partial`), final = join(target, name);
  await mkdir(partial); await mkdir(join(partial, 'working')); await mkdir(join(partial, 'objects'));
  // Missing historical/prepared/conflict bytes must not silently disappear
  // from an otherwise successful backup of the current working tree.
  async function verifyReferences(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.blobHash === 'string' && Number.isSafeInteger(value.byteLength)) await objects.verify(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') await verifyReferences(child);
  }
  await verifyReferences(manifest);
  const observed = await scanVault(workingRoot, objects);
  if (observed.diagnostics.length) throw new Error('export-scan-incomplete');
  const observedWorking = observed.map(({ path, kind, blobHash, byteLength }) => ({ path, kind, blobHash, byteLength }));
  const retainedObjects = [];
  for (const entry of await readdir(objects.root, { withFileTypes: true })) {
    if (!/^[a-f0-9]{64}$/.test(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('invalid-export-object');
    const ref = { blobHash: entry.name, byteLength: (await stat(objects.path(entry.name))).size };
    await objects.verify(ref); await durableCopy(objects.path(entry.name), join(partial, 'objects', entry.name)); retainedObjects.push(ref);
  }
  for (const v of observedWorking) {
    const path = await safePath(join(partial, 'working'), v.path);
    if (v.kind === 'directory') await mkdir(path);
    else await durableCopy(objects.path(v.blobHash), path);
  }
  const data = { format: 'pentamark-replica-directory-v1', exportedAt: new Date().toISOString(), ...manifest, observedWorking, retainedObjects };
  const file = await open(join(partial, 'manifest.json'), 'wx');
  try { await file.writeFile(JSON.stringify(data, null, 2), 'utf8'); await file.sync(); } finally { await file.close(); }
  await syncDirectory(partial); await rename(partial, final); await syncDirectory(target);
  return { cancelled: false, format: 'directory', directoryName: name };
}
async function durableCopy(source, target) {
  await copyFile(source, target, 1); // COPYFILE_EXCL: never overwrite prior exports.
  const file = await open(target, 'r+'); try { await file.sync(); } finally { await file.close(); }
}
