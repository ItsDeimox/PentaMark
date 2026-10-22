import { useEffect, useState } from 'react';
import type { SyncStatus } from './contracts';
import type { SyncEngine } from './engine';

/** Open the native replica first and pass a stable engine. Platform owners route
 * localChanged/resume/reconnect events; this hook owns subscription and lifetime. */
export function useSyncController(engine: SyncEngine | null): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  useEffect(() => {
    if (!engine) { setStatus(null); return; }
    const unsubscribe = engine.onStatus(setStatus);
    void engine.start();
    return () => { unsubscribe(); engine.stop(); };
  }, [engine]);
  return status;
}
