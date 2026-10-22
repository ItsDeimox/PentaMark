import type { EntryVersion, PathResult, ReconcileDecision } from './contracts';

/** Lexical validation only. Native ports must check actual destinations and links. */
export function normalizePath(input: string): PathResult {
  const path = input.replace(/\\/g, '/').normalize('NFC');
  const segments = path.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..'
    || /[<>:"|?*\u0000-\u001f]/u.test(segment) || /[. ]$/u.test(segment))) {
    return { ok: false, code: 'invalid-path' };
  }
  if (segments.some(segment => /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i
    .test(segment.split('.')[0].replace(/ +$/u, '')))) {
    return { ok: false, code: 'reserved-name' };
  }
  // Conservative shared fold, not locale-sensitive casing or full Unicode casefold.
  // Initial lowercase makes ẞ join ß before uppercase expands both to SS.
  // Java: Normalizer.normalize(path.toLowerCase(Locale.ROOT)
  //   .toUpperCase(Locale.ROOT).toLowerCase(Locale.ROOT), Normalizer.Form.NFC).
  const pathKey = path.toLowerCase().toUpperCase().toLowerCase().normalize('NFC');
  return { ok: true, path, pathKey };
}

function sameState(a: EntryVersion | null, b: EntryVersion | null): boolean {
  if (!a || !b) return a === b;
  const ap = normalizePath(a.path), bp = normalizePath(b.path);
  return ap.ok && bp.ok && a.entryId === b.entryId && a.kind === b.kind
    && ap.path === bp.path && a.blobHash === b.blobHash
    && a.byteLength === b.byteLength && a.deleted === b.deleted;
}

/**
 * Pure three-way comparison of known versions, never a write authorization.
 * The caller supplies cross-entry collision candidates; there is no filesystem scan.
 * Preserve original versions (including opaque base revision) in every decision.
 */
export function planEntry(
  base: EntryVersion | null,
  local: EntryVersion | null,
  remote: EntryVersion | null,
): ReconcileDecision {
  const decision = (action: ReconcileDecision['action'], reason: string): ReconcileDecision =>
    ({ action, reason, base, local, remote });
  const versions = [base, local, remote].filter((entry): entry is EntryVersion => entry !== null);
  for (const entry of versions) {
    const path = normalizePath(entry.path);
    if (!path.ok) return decision('conflict', path.code);
  }
  if (local && remote && local.entryId !== remote.entryId && !local.deleted && !remote.deleted) {
    const lp = normalizePath(local.path), rp = normalizePath(remote.path);
    if (lp.ok && rp.ok && lp.pathKey === rp.pathKey) return decision('conflict', 'path-collision');
  }
  if (new Set(versions.map(entry => entry.entryId)).size > 1) {
    return decision('conflict', 'identity-mismatch');
  }
  // Absence cannot safely be interpreted as deletion of a known version.
  if (base && (!local || !remote)) return decision('conflict', 'missing-version');
  const localChanged = !sameState(base, local);
  const remoteChanged = !sameState(base, remote);
  // A remote edit/revert can preserve state but still require acknowledging its revision.
  // Revisions are opaque: equality only, never ordering; keep the original base below.
  const remoteRevisionChanged = base !== null && remote !== null && base.revision !== remote.revision;
  if (!localChanged && !remoteChanged && !remoteRevisionChanged) return decision('none', 'unchanged');
  if (sameState(local, remote)) return decision('converged', 'same-state');
  if (!remoteChanged) return decision('push', 'local-only');
  if (!localChanged) return decision('pull', 'remote-only');
  return decision('conflict', local?.deleted !== remote?.deleted ? 'delete-change' : 'concurrent-change');
}
