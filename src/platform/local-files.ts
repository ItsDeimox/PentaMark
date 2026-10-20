/** Resolve only files enumerated by the native vault, never arbitrary device paths. */
export function resolveLocalFile(value: string, note: string, files: readonly string[]): string | null {
  const normalize = (path: string) => {
    const parts: string[] = [];
    for (const part of path.replaceAll('\\', '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) return null; parts.pop(); }
      else if (part.startsWith('.') || /[\x00-\x1f]/.test(part)) return null;
      else parts.push(part);
    }
    return parts.join('/');
  };
  if (/^[\\/]|^[a-z]+:/i.test(value)) return null;
  const parent = note.includes('/') ? note.slice(0, note.lastIndexOf('/') + 1) : '';
  const relative = normalize(parent + value);
  const direct = normalize(value);
  const candidates = /^\.{1,2}[\\/]/.test(value) ? [relative] : [direct, relative, normalize('assets/' + value)];
  for (const candidate of candidates) {
    const match = candidate && files.find(file => file.localeCompare(candidate, undefined, { sensitivity: 'accent' }) === 0);
    if (match) return match;
  }
  if (!direct || value.includes('..')) return null;
  const matches = files.filter(file => file.split('/').pop()?.localeCompare(direct.split('/').pop()!, undefined, { sensitivity: 'accent' }) === 0);
  return matches.length === 1 ? matches[0] : null;
}

type Draft = { content: string; revision: string };
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class DraftStore {
  constructor(private storage: StoragePort) {}
  private key(path: string) { return `pentamark:android:draft:${path}`; }
  get(path: string): Draft | null {
    try {
      const value = JSON.parse(this.storage.getItem(this.key(path)) || 'null');
      return value && typeof value.content === 'string' && typeof value.revision === 'string' ? value : null;
    } catch { return null; }
  }
  put(path: string, content: string, revision: string) {
    this.storage.setItem(this.key(path), JSON.stringify({ content, revision }));
  }
  remove(path: string) { this.storage.removeItem(this.key(path)); }
  saved(path: string, content: string, revision: string) {
    const draft = this.get(path);
    if (!draft || draft.content === content) this.remove(path);
    else this.put(path, draft.content, revision);
  }
}
