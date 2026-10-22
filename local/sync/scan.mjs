import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { safeNativePath, publicPath } from './paths.mjs';
import { directoryIdentity } from './file-journal.mjs';

export async function scanVault(vaultRoot, objects) {
  const found = [];
  const diagnostics = [];
  async function walk(directory, prefix = '') {
    let children;
    try { children = await readdir(directory, { withFileTypes: true }); }
    catch (error) { diagnostics.push({ path: prefix, code: error.code || error.message }); return; }
    for (const entry of children) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const raw = prefix ? `${prefix}/${entry.name}` : entry.name;
      try {
        const { path } = publicPath(raw);
        const full = await safeNativePath(vaultRoot, raw);
        const info = await lstat(full);
        if (info.isDirectory()) {
          found.push({ path, nativePath: raw, nativeIdentity: await directoryIdentity(full), kind: 'directory', blobHash: null, byteLength: 0 });
          await walk(join(directory, entry.name), raw);
        } else if (info.isFile()) {
          found.push({ path, nativePath: raw, nativeIdentity: null, kind: path.toLowerCase().endsWith('.md') ? 'note' : 'asset', ...await objects.capture(full) });
        } else throw new Error('unsupported-file');
      } catch (error) { diagnostics.push({ path: raw, code: error.code || error.message }); }
    }
  }
  await safeNativePath(vaultRoot, '__root_check__');
  await walk(vaultRoot);
  found.diagnostics = diagnostics;
  return found;
}
