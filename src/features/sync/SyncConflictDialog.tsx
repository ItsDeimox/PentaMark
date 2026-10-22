import { useEffect, useRef, useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { DialogFrame } from '../../components/dialogs/DialogFrame';
import type { ConflictResolution, EntryVersion } from './contracts';
import { choiceUnavailable, createResolution, sameReview, type ConflictReview, type ResolutionCapabilities, type ResolutionChoice } from './conflict-model';
import './sync-controls.css';

export interface SyncConflictDialogProps {
  conflicts: readonly ConflictReview[];
  capabilities: ResolutionCapabilities;
  onResolve: (input: ConflictResolution) => Promise<unknown>;
  /** Read immutable retained content, never the current path. Notes only; binaries stay native. */
  onLoadVersion?: (version: EntryVersion) => Promise<string>;
  onExportVersion?: (version: EntryVersion) => Promise<unknown>;
  onClose: () => void;
}
const choices: [ResolutionChoice, string][] = [['keep-both', 'Manter ambas'], ['local', 'Manter minha versão'], ['remote', 'Usar versão do host'], ['merged', 'Salvar mesclagem']];
const sides = [['base', 'Base'], ['local', 'Local'], ['remote', 'Host']] as const;

export function SyncConflictDialog(props: SyncConflictDialogProps) {
  const [reviewed, setReviewed] = useState<ConflictReview | null>(() => props.conflicts[0] ? structuredClone(props.conflicts[0]) : null);
  // entryId, rather than conflictId: native refresh can replace the conflict without losing the draft.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [contents, setContents] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [rejectedReviews, setRejectedReviews] = useState<Record<string, ConflictReview>>({});
  const inFlight = useRef(false);
  const current = props.conflicts.find(item => item.conflict.entryId === reviewed?.conflict.entryId) ?? null;
  const needsReview = !!reviewed && sameReview(reviewed, rejectedReviews[reviewed.conflict.entryId] ?? null);
  const stale = !!reviewed && (!sameReview(reviewed, current) || needsReview);
  const conflict = reviewed?.conflict;
  const draft = conflict ? drafts[conflict.entryId] ?? '' : '';

  useEffect(() => {
    if (!reviewed && props.conflicts[0]) setReviewed(structuredClone(props.conflicts[0]));
  }, [reviewed, props.conflicts]);

  useEffect(() => {
    let cancelled = false;
    setContents({}); setLoadError('');
    if (!reviewed || !props.onLoadVersion) return;
    const selected = reviewed.conflict;
    void Promise.all(sides.map(async ([side]) => {
      const version = selected[side];
      if (!version || version.deleted || version.kind !== 'note') return;
      try {
        const text = await props.onLoadVersion!(version);
        if (cancelled) return;
        setContents(previous => ({ ...previous, [side]: text }));
        if (side === 'local') setDrafts(previous => Object.hasOwn(previous, selected.entryId) ? previous : { ...previous, [selected.entryId]: text });
      } catch (cause) { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause)); }
    }));
    return () => { cancelled = true; };
  }, [reviewed, props.onLoadVersion]);

  const run = async (action: () => Promise<unknown>, resolution = false) => {
    if (inFlight.current) return;
    inFlight.current = true; setWorking(true); setError('');
    try { await action(); }
    catch (cause) {
      setError(`${cause instanceof Error ? cause.message : String(cause)} — seu rascunho foi mantido.`);
      if (resolution && reviewed && /stale|revision|local.head/i.test(cause instanceof Error ? cause.message : String(cause))) {
        setRejectedReviews(previous => ({ ...previous, [reviewed.conflict.entryId]: reviewed }));
      }
    } finally { inFlight.current = false; setWorking(false); }
  };
  const select = (item: ConflictReview) => { setReviewed(structuredClone(item)); setError(''); };
  const mergeReady = !!conflict && sides.every(([side]) => !conflict[side] || conflict[side]!.deleted || conflict[side]!.kind !== 'note' || Object.hasOwn(contents, side));
  return <DialogFrame title="Conflitos de sincronização" subtitle="Revise as versões preservadas antes de escolher." icon={GitCompareArrows}
    onClose={props.onClose} className="pm-conflict-dialog pm-sync-conflict-dialog">
    <nav aria-label="Lista de conflitos" className="pm-sync-conflict-list">
      {props.conflicts.map(item => <button type="button" key={item.conflict.conflictId} disabled={working}
        aria-pressed={item.conflict.entryId === conflict?.entryId}
        onClick={() => select(item)}>{item.conflict.local?.path || item.conflict.remote?.path || item.conflict.entryId} — {item.conflict.reason}</button>)}
    </nav>
    {!conflict && <p>Nenhum conflito para revisar.</p>}
    {conflict && <>
      <p>Motivo: {conflict.reason}. As versões devem ser preservadas pela réplica antes de qualquer alteração.</p>
      <div className="pm-sync-versions">{sides.map(([side, label]) => {
        const version = conflict[side];
        return <section key={side} aria-label={`Versão ${label}`}>
          <h3>{label}</h3>
          {!version ? <p>Versão ausente</p> : <>
            <p>{version.path}</p><p>Revisão: {version.revision}</p>
            <p>{version.deleted ? 'Excluído (tombstone preservado)' : version.kind === 'directory' ? 'Pasta' : `${version.byteLength} bytes`}</p>
            {version.kind === 'note' && !version.deleted && <pre>{contents[side] ?? (props.onLoadVersion ? 'Carregando versão preservada…' : 'Leitura da versão ainda indisponível.')}</pre>}
            {version.kind === 'asset' && !version.deleted && <p>Anexo binário — exporte para comparar; não há mesclagem de bytes.</p>}
            <button type="button" disabled={working || !props.onExportVersion || version.deleted || version.kind === 'directory'}
              onClick={() => void run(() => props.onExportVersion!(version))}>Exportar {label}</button>
          </>}
        </section>;
      })}</div>
      {!props.onExportVersion && <p>Exportação de versões ainda indisponível neste aparelho.</p>}
      {stale && <section role="status"><p>O conflito mudou ou precisa ser atualizado. Revise as versões atuais; seu rascunho foi mantido.</p>
        <button type="button" disabled={working || !current || (needsReview && sameReview(reviewed!, current))}
          onClick={() => current && select(current)}>Revisar versões atualizadas</button>
        {!current && <p>Este conflito não está mais na lista atual. O rascunho continua acessível abaixo.</p>}
      </section>}
      <label className="pm-merge-editor">Resultado da mesclagem
        <textarea aria-label="Resultado da mesclagem" value={draft} spellCheck={false}
          disabled={working || (!!choiceUnavailable(conflict, 'merged', { merged: true }) && !Object.hasOwn(drafts, conflict.entryId))}
          onChange={event => setDrafts(previous => ({ ...previous, [conflict.entryId]: event.target.value }))}/>
      </label>
      <div className="pm-sync-actions">{choices.map(([choice, label]) => {
        const unavailable = choiceUnavailable(conflict, choice, props.capabilities) ||
          (choice === 'merged' && (!props.onLoadVersion || !mergeReady) ? 'Leia as versões preservadas antes de mesclar.' : null);
        return <div key={choice}><button type="button" disabled={working || stale || !!unavailable || typeof reviewed?.localHead !== 'string'}
          title={unavailable || undefined} onClick={() => void run(() => props.onResolve(createResolution(reviewed!, current, choice, props.capabilities, draft)), true)}>{label}</button>
          {unavailable && <small>{unavailable}</small>}</div>;
      })}</div>
    </>}
    {loadError && <p role="alert">Não foi possível ler a versão: {loadError}</p>}
    {error && <p role="alert">{error}</p>}
  </DialogFrame>;
}
