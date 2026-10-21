import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { version as appVersion } from '../../../package.json';
import {
  checkForUpdates, downloadUpdate, getUpdateStatus, installUpdate,
  isUpdateSupported, openUpdatePermissionSettings, type UpdateStatus,
} from '../../platform/updates';
import './updates.css';

type Action = 'check' | 'download' | 'install' | 'permission';
const android = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const errorMessage = (error: unknown) => error instanceof Error && error.message
  ? error.message : 'Não foi possível atualizar. Confira sua conexão e tente novamente.';

export function UpdateSettings({ beforeInstall }: { beforeInstall: () => Promise<void> }) {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle', currentVersion: appVersion });
  const [loading, setLoading] = useState(isUpdateSupported);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const acting = useRef(false);
  const reading = useRef<Promise<void> | null>(null);
  const revision = useRef(0);
  const headingId = useId();

  const refresh = useCallback((): Promise<void> => {
    if (!isUpdateSupported) return Promise.resolve();
    if (reading.current) return reading.current;
    const requestRevision = revision.current;
    const request = (async () => {
      try {
        const next = await getUpdateStatus();
        if (mounted.current && requestRevision === revision.current) { setStatus(next); setError(''); }
      } catch (failure) {
        if (mounted.current && requestRevision === revision.current) setError(errorMessage(failure));
      } finally {
        if (mounted.current) setLoading(false);
        reading.current = null;
      }
    })();
    reading.current = request;
    return request;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  useEffect(() => {
    const nativeWork = action === 'check' || action === 'download' || action === 'install';
    if (error || (action && !nativeWork) || (!nativeWork && !['checking', 'downloading', 'installing'].includes(status.phase))) return;
    const interval = window.setInterval(() => {
      // Native verification can finish after install() has already resolved.
      // While Android's installer owns the screen, resume/visibility will pick
      // up its result. Never interpret returning to the app as an install click.
      if (status.phase === 'installing' && document.visibilityState === 'hidden') return;
      void refresh();
    }, 650);
    return () => window.clearInterval(interval);
  }, [status.phase, action, error, refresh]);

  useEffect(() => {
    if (!android || !isUpdateSupported) return;
    // Android can return from its permission screen without remounting React.
    // Resuming only reads status; installation always needs another user action.
    const resume = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') resume(); };
    window.addEventListener('focus', resume);
    window.addEventListener('resume', resume);
    document.addEventListener('resume', resume);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', resume);
      window.removeEventListener('resume', resume);
      document.removeEventListener('resume', resume);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);

  const run = async (nextAction: Action) => {
    // Ref closes the gap before React renders disabled buttons, including
    // multiple clicks in the same event loop turn.
    if (acting.current || loading || !isUpdateSupported) return;
    acting.current = true;
    revision.current++;
    setAction(nextAction);
    setError('');
    try {
      // Check/download may resolve only after native work finishes. Keep status
      // reads independent so their progress remains visible during that Promise.
      if (nextAction === 'permission') {
        await openUpdatePermissionSettings();
        // Native settings calls may resolve an error status instead of rejecting.
        await refresh();
      } else {
        if (nextAction === 'install') await beforeInstall();
        // beforeInstall may intentionally close this panel. Once saving has
        // succeeded, carry out the explicit install even if it unmounted us.
        const next = await (nextAction === 'check' ? checkForUpdates()
          : nextAction === 'download' ? downloadUpdate() : installUpdate());
        revision.current++;
        if (mounted.current) { setStatus(next); setError(''); }
      }
    } catch (failure) {
      revision.current++;
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      acting.current = false;
      if (mounted.current) setAction(null);
    }
  };

  const busy = loading || action !== null || ['checking', 'downloading', 'installing'].includes(status.phase);
  const progress = typeof status.progress === 'number' && Number.isFinite(status.progress)
    ? Math.min(100, Math.max(0, status.progress)) : undefined;
  const message = loading ? 'Consultando atualizações…'
    : action === 'install' ? 'Salvando antes de instalar…'
    : action === 'check' || status.phase === 'checking' ? 'Verificando atualizações…'
    : action === 'download' || status.phase === 'downloading' ? `Baixando atualização${progress === undefined ? '…' : ` · ${Math.round(progress)}%`}`
    : status.phase === 'available' ? `Nova versão disponível${status.version ? `: ${status.version}` : '.'}`
    : status.phase === 'ready' ? `Atualização pronta para instalar${status.version ? `: ${status.version}` : '.'}`
    : status.phase === 'current' ? 'O aplicativo está atualizado.'
    : status.phase === 'installing' ? 'Instalando atualização…'
    : status.phase === 'error' ? 'Não foi possível atualizar.'
    : 'Verifique se há uma nova versão do aplicativo.';
  const failure = error || (status.phase === 'error' ? status.error || 'Confira sua conexão e tente novamente.' : '');

  return <section className="pm-update-settings" aria-labelledby={headingId}>
    <header className="pm-update-header"><h3 id={headingId}>Atualizações</h3><p>Versão atual: {status.currentVersion || appVersion}</p></header>
    {!isUpdateSupported ? <p>Atualize o aplicativo no dispositivo que hospeda este cofre.</p> : <>
      <p role="status" aria-live="polite" aria-atomic="true">{message}</p>
      {status.phase === 'downloading' && <progress aria-label="Download da atualização" max={100} value={progress}/>}
      {failure && <p role="alert" className="pm-update-error">{failure}</p>}
      {android && status.permissionRequired && <p>Autorize o PentaMark a instalar atualizações. Depois, toque em Instalar atualização.</p>}
      <div className="pm-update-actions">
        <button type="button" disabled={loading || action !== null || (busy && !error)} onClick={() => void run('check')}>Verificar atualizações</button>
        {status.phase === 'available' && <button type="button" className="primary" disabled={busy} onClick={() => void run('download')}>Baixar atualização</button>}
        {android && status.permissionRequired && <button type="button" disabled={busy} onClick={() => void run('permission')}>Autorizar instalação</button>}
        {status.phase === 'ready' && <button type="button" className="primary" disabled={busy} onClick={() => void run('install')}>{android ? 'Instalar atualização' : 'Instalar e reiniciar'}</button>}
      </div>
    </>}
  </section>;
}
