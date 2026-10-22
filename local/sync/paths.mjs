import { lstat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// Exact runtime equivalent of src/features/sync/reconcile.ts normalizePath.
// Kept dependency-free for packaged local/; contract fixtures test both implementations.
export function normalizePath(input) {
  const path = input.replace(/\\/g, '/').normalize('NFC');
  const segments = path.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..'
    || /[<>:"|?*\u0000-\u001f]/u.test(segment) || /[. ]$/u.test(segment))) return { ok: false, code: 'invalid-path' };
  if (segments.some(segment => /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(segment.split('.')[0].replace(/ +$/u, ''))))
    return { ok: false, code: 'reserved-name' };
  return { ok: true, path, pathKey: path.toLowerCase().toUpperCase().toLowerCase().normalize('NFC') };
}
export function publicPath(input) {
  if (typeof input !== 'string') throw new Error('invalid-path');
  const result = normalizePath(input);
  if (!result.ok) throw new Error(result.code);
  if (result.path.split('/').some(s => s.startsWith('.') || s === 'node_modules')) throw new Error('private-path');
  return result;
}
export async function safePath(root, path) {
  const normalized = publicPath(path).path;
  const full = resolve(root, normalized);
  if (!full.startsWith(resolve(root) + sep)) throw new Error('invalid-path');
  let part = resolve(root);
  for (const segment of ['', ...normalized.split('/')]) {
    if (segment) part = resolve(part, segment);
    try { if ((await lstat(part)).isSymbolicLink()) throw new Error('symlink'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return full;
}
export async function exists(path) {
  try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
