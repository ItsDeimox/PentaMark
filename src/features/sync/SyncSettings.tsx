import { useEffect, useId, useRef, useState } from 'react';
import type { SyncMode, SyncStatus as Status } from './contracts';
import { canDisableOffline } from './conflict-model';
import { SyncStatus } from './SyncStatus';
import './sync-controls.css';

export interface SyncSettingsProps {
  offlineEnabled: boolean;
  mode: SyncMode;
  origin?: string;
  status?: Status;
  busy?: boolean;
  /** Discover identity, configure and begin first copy; called only by explicit confirmation. */
  onEnable?: (input: { origin: string; mode: SyncMode }) => Promise<unknown>;
  /** Native implementation must recheck pending/conflict counts before disabling. */
  onConfigure?: (config: { offlineEnabled: boolean; mode: SyncMode }) => Promise<unknown>;
  onSyncNow?: () => Promise<unknown>;
  onExportPending?: () => Promise<unknown>;
  onReviewConflicts?: () => void;
}

export function SyncSettings(props: SyncSettingsProps) {
  const [preparing, setPreparing] = useState(false);
  const [mode, setMode] = useState(props.mode);
  const [origin, setOrigin] = useState(props.origin || '');
  const [disablePrompt, setDisablePrompt] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const group = useId();
  useEffect(() => { setMode(props.mode); }, [props.mode]);
  useEffect(() => { setOrigin(props.origin || ''); }, [props.origin]);
  useEffect(() => { if (props.offlineEnabled) setPreparing(false); }, [props.offlineEnabled]);
  const busy = props.busy || working || props.status?.phase === 'syncing';
  const run = async (action?: () => Promise<unknown>) => {
    if (!action || busy || inFlight.current) return;
    inFlight.current = true; setWorking(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setWorking(false); }
  };
  let validOrigin = false;
  try { const url = new URL(origin); validOrigin = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { /* Input stays editable. */ }
  return <section className="pm-sync-settings" aria-label="Sincronização" aria-busy={busy}>
    <h3>Sincronização</h3>
    <label className="pm-check-row"><input type="checkbox" checked={props.offlineEnabled || preparing} disabled={busy}
      onChange={event => {
        if (event.target.checked) { setPreparing(true); return; }
        if (!props.offlineEnabled) { setPreparing(false); return; }
        if (!canDisableOffline(props.status)) { setDisablePrompt(true); return; }
        void run(props.onConfigure && (() => props.onConfigure!({ offlineEnabled: false, mode: props.mode })));
      }}/>Manter cópia offline</label>
    {(props.offlineEnabled || preparing) && <>
      {!props.offlineEnabled && <label className="pm-field">Endereço do host
        <input type="url" aria-label="Endereço do host" value={origin} disabled={busy} onChange={event => setOrigin(event.target.value)} placeholder="http://100.100.1.2:3417"/>
      </label>}
      <fieldset disabled={busy} className="pm-sync-modes"><legend>Modo de sincronização</legend>
        {(['automatic', 'manual'] as const).map(value => <label key={value}><input type="radio" name={group} value={value} checked={mode === value}
          onChange={() => setMode(value)}/>{value === 'automatic' ? 'Automática' : 'Manual'}</label>)}
      </fieldset>
      <p>{mode === 'manual' ? 'No modo manual, o conteúdo só é transferido ao criar a cópia inicial ou sincronizar agora.'
        : 'No Android, a sincronização automática é retomada com o aplicativo em primeiro plano.'}</p>
      {!props.offlineEnabled
        ? <button type="button" disabled={busy || !validOrigin || !props.onEnable} onClick={() => void run(() => props.onEnable!({ origin: origin.trim(), mode }))}>Criar cópia inicial</button>
        : mode !== props.mode && <button type="button" disabled={busy || !props.onConfigure} onClick={() => void run(() => props.onConfigure!({ offlineEnabled: true, mode }))}>Salvar modo</button>}
      {!props.offlineEnabled && !props.onEnable && <p>Criação da cópia indisponível neste aparelho.</p>}
    </>}
    {props.offlineEnabled && <>
      <SyncStatus status={props.status} onReviewConflicts={props.onReviewConflicts}/>
      <div className="pm-sync-actions">
        <button type="button" disabled={busy || !props.onSyncNow} onClick={() => void run(props.onSyncNow)}>Sincronizar agora</button>
        <button type="button" disabled={busy || !props.onExportPending} onClick={() => void run(props.onExportPending)}>Exportar pendências</button>
      </div>
      {!props.onExportPending && <p>Exportação de pendências ainda indisponível neste aparelho.</p>}
      {!props.onConfigure && <p>Alteração da configuração indisponível neste aparelho.</p>}
    </>}
    {disablePrompt && <section role="region" aria-label="Desativação da cópia offline">
      <p>Há pendências, conflitos ou um estado ainda não confirmado. Sincronize, exporte uma cópia ou cancele. A cópia offline continuará habilitada.</p>
      <p>Use os botões Sincronizar agora ou Exportar pendências acima. Exportar não descarta nem desativa a cópia.</p>
      <button type="button" disabled={busy} onClick={() => setDisablePrompt(false)}>Cancelar</button>
    </section>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
