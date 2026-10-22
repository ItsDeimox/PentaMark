import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { safePath, publicPath } from './paths.mjs';

export async function scanVault(vaultRoot, objects) {
  const found = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const raw = prefix ? `${prefix}/${entry.name}` : entry.name;
      const { path } = publicPath(raw);
      // Do not silently represent an unaddressable spelling as another native file.
      if (raw !== path) throw new Error('noncanonical-native-path');
      const full = await safePath(vaultRoot, path);
      const info = await lstat(full);
      if (info.isDirectory()) {
        found.push({ path, kind: 'directory', blobHash: null, byteLength: 0 });
        await walk(join(directory, entry.name), raw);
      } else if (info.isFile()) {
        found.push({ path, kind: path.toLowerCase().endsWith('.md') ? 'note' : 'asset', ...await objects.capture(full) });
      } else throw new Error('unsupported-file');
    }
  }
  await safePath(vaultRoot, '__root_check__');
  await walk(vaultRoot);
  return found;
}
