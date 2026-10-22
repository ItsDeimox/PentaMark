import type { SyncStatus as Status } from './contracts';
import { syncStatusLabel } from './conflict-model';
import './sync-controls.css';

export interface SyncStatusProps { status?: Status; onReviewConflicts?: () => void }

export function SyncStatus({ status, onReviewConflicts }: SyncStatusProps) {
  const timestamp = status?.lastSuccessfulSync;
  const validTimestamp = timestamp && Number.isFinite(Date.parse(timestamp));
  return <section className="pm-sync-status" aria-label="Estado da sincronização">
    <div role="status" aria-live="polite">
      <strong>{syncStatusLabel(status)}</strong>
      {status?.localSaved && <p>Salvo neste aparelho</p>}
      <p>{status ? `${status.pendingCount} pendências · ${status.conflictCount} conflitos` : 'Pendências e conflitos ainda não confirmados'}</p>
      <p>Última sincronização concluída: {validTimestamp
        ? <time dateTime={timestamp}>{new Date(timestamp).toLocaleString('pt-BR')}</time> : 'nenhuma confirmada'}</p>
      {status?.errorCode && <p>Motivo: {status.errorCode}</p>}
    </div>
    {!!status?.conflictCount && <button type="button" disabled={!onReviewConflicts} onClick={onReviewConflicts}>Revisar conflitos</button>}
  </section>;
}
