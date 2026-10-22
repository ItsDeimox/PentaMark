import type { Conflict, ConflictResolution, SyncStatus } from './contracts';

/** Empty string is a known absent-entry head on Android; null means not yet known. */
export interface ConflictReview { conflict: Conflict; localHead: string | null }
export type ResolutionChoice = ConflictResolution['choice'];
/** Only true enables an action; strings explain native limitations to the user. */
export type ResolutionCapabilities = Partial<Record<ResolutionChoice, true | string>>;

export function choiceUnavailable(conflict: Conflict, choice: ResolutionChoice, capabilities: ResolutionCapabilities): string | null {
  if (choice === 'merged' && [conflict.local, conflict.remote].some(v => !v || v.deleted || v.kind !== 'note')) {
    return 'Mesclagem disponível somente para duas versões de texto existentes.';
  }
  const available = capabilities[choice];
  return available === true ? null : available || 'Esta opção ainda não está disponível neste aparelho.';
}

export function sameReview(reviewed: ConflictReview, current: ConflictReview | null): boolean {
  return current !== null && reviewed.localHead === current.localHead &&
    JSON.stringify(reviewed.conflict) === JSON.stringify(current.conflict);
}

/** UI guard only. The native port must atomically recheck both guards and retain all versions. */
export function createResolution(reviewed: ConflictReview, current: ConflictReview | null, choice: ResolutionChoice,
  capabilities: ResolutionCapabilities, mergedContent?: string): ConflictResolution {
  if (!sameReview(reviewed, current)) throw new Error('stale-conflict');
  if (choiceUnavailable(reviewed.conflict, choice, capabilities)) throw new Error('unsupported-choice');
  if (typeof reviewed.localHead !== 'string') throw new Error('missing-local-head');
  if (choice === 'merged' && mergedContent === undefined) throw new Error('missing-merge-content');
  return { conflictId: reviewed.conflict.conflictId, expectedRemoteRevision: reviewed.conflict.remote?.revision ?? null,
    expectedLocalHead: reviewed.localHead, choice, ...(choice === 'merged' ? { mergedContent } : {}) };
}

export function canDisableOffline(status?: SyncStatus): boolean {
  return !!status && status.snapshotComplete && !status.errorCode && status.pendingCount === 0 && status.conflictCount === 0 &&
    ['idle', 'offline', 'waiting-manual'].includes(status.phase);
}

export function syncStatusLabel(status?: SyncStatus): string {
  if (!status) return 'Estado da cópia ainda não confirmado';
  if (status.phase === 'blocked' || status.errorCode) return 'Sincronização bloqueada — cópia local preservada';
  if (!status.snapshotComplete || status.phase === 'initial-copy') return 'Download inicial incompleto';
  if (status.conflictCount > 0 || status.phase === 'conflicts') return 'Conflitos para revisar';
  if (status.phase === 'offline') return status.pendingCount > 0 ? 'Offline — alterações pendentes' : 'Offline';
  if (status.phase === 'syncing') return 'Sincronizando';
  if (status.phase === 'waiting-manual') return 'Aguardando sincronização manual';
  if (status.pendingCount > 0) return 'Alterações pendentes';
  if (status.phase === 'idle' && status.pendingCount === 0 && status.conflictCount === 0 &&
      status.lastSuccessfulSync && Number.isFinite(Date.parse(status.lastSuccessfulSync))) return 'Sincronizado';
  return 'Sincronização ainda não confirmada';
}
