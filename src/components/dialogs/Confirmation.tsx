import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, Trash2 } from 'lucide-react';
import { DialogFrame, DialogPresence } from './DialogFrame';

import { CONFIRMATION_EVENT, type ConfirmationRequest, type ConfirmationOptions as Options } from './confirmation-request';
type Pending = { options: Options; finish: (value: boolean) => void };
const ConfirmationContext = createContext<((options: Options) => Promise<boolean>) | null>(null);
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Pending | null>(null);
  const pending = useRef<Pending[]>([]), active = useRef<Pending | null>(null), timer = useRef(0);
  const confirm = useCallback((options: Options) => new Promise<boolean>(finish => {
    const item = { options, finish };
    if (active.current || timer.current) pending.current.push(item);
    else { active.current = item; setCurrent(item); }
  }), []);
  useEffect(() => {
    const requested = (event: Event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.closest('.pm-shell')) return;
      const request = event as CustomEvent<ConfirmationRequest>;
      if (!request.detail || typeof request.detail.reply !== 'function') return;
      event.preventDefault(); void confirm(request.detail.options).then(request.detail.reply);
    };
    document.addEventListener(CONFIRMATION_EVENT, requested);
    return () => document.removeEventListener(CONFIRMATION_EVENT, requested);
  }, [confirm]);
  const settle = (value: boolean) => {
    if (!active.current) return;
    const item = active.current;active.current = null;setCurrent(null);item.finish(value);
    timer.current = window.setTimeout(() => {
      timer.current = 0; const next = pending.current.shift() || null;
      active.current = next;setCurrent(next);
    }, 190);
  };
  useEffect(() => () => {
    clearTimeout(timer.current);timer.current = 0;
    active.current?.finish(false);active.current = null;
    pending.current.splice(0).forEach(item => item.finish(false));
  }, []);
  return <ConfirmationContext.Provider value={confirm}>{children}{createPortal(
    <DialogPresence open={!!current}>{current && <DialogFrame title={current.options.title} subtitle="Confirme antes de continuar." icon={current.options.danger ? Trash2 : CircleHelp} className="pm-confirm-dialog" onClose={() => settle(false)}
      footer={<><button type="button" data-autofocus className="secondary" onClick={() => settle(false)}>Cancelar</button><button type="button" className={current.options.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>{current.options.accept || 'Confirmar'}</button></>}><p className="pm-confirm-copy">{current.options.message}</p></DialogFrame>}</DialogPresence>, document.querySelector('.pm-shell') || document.body)}</ConfirmationContext.Provider>;
}
export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error('ConfirmationProvider is required.');
  return confirm;
}
