import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X, type LucideIcon } from 'lucide-react';

const Presence = createContext(true);
const EXIT_MS = 180;

/** Retain only the outgoing dialog, so save, cancel and navigation all animate. */
export function DialogPresence({ open, children }: { open: boolean; children: ReactNode }) {
  const last = useRef(children);
  const [retained, setRetained] = useState(open);
  if (open) last.current = children;
  useLayoutEffect(() => {
    if (open) { setRetained(true); return; }
    const timer = window.setTimeout(() => setRetained(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return open || retained ? <Presence.Provider value={open}>{open ? children : last.current}</Presence.Provider> : null;
}

/** The browser top layer owns modality, including nested confirmation dialogs. */
export function DialogFrame({ title, subtitle, icon: Icon, children, footer, navigation, onClose, onSubmit, className = '', eyebrow = 'PENTAMARK' }: {
  title: string; subtitle?: string; icon: LucideIcon; children: ReactNode; footer?: ReactNode; navigation?: ReactNode;
  onClose: () => void; onSubmit?: (event: FormEvent<HTMLFormElement>) => void; className?: string; eyebrow?: string;
}) {
  const open = useContext(Presence);
  const [entered, setEntered] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(), descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const frame = requestAnimationFrame(() => {
      setEntered(true);
      (dialog.querySelector<HTMLElement>('[data-autofocus]') || dialog.querySelector<HTMLElement>('.pm-dialog-close'))?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      dialog.close();
      queueMicrotask(() => {
        // A second dialog may already have taken focus during a modal-to-modal switch.
        if (document.querySelector('dialog[open]')) return;
        const fallback = document.querySelector<HTMLElement>('[aria-label="Ferramentas e ações"][data-workspace-trigger]');
        const target = previous?.isConnected && !previous.closest('[inert]') ? previous : fallback;
        target?.focus({ preventScroll: true });
      });
    };
  }, []);
  return <dialog ref={ref} className="pm-dialog-layer" aria-labelledby={titleId} aria-describedby={subtitle ? descriptionId : undefined}
    data-entered={open && entered} aria-modal="true"
    onCancel={event => { event.preventDefault(); if (open) onClose(); }}
    onPointerDown={event => { if (open && event.target === event.currentTarget && event.button === 0) onClose(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (!open) { event.preventDefault(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type="hidden"]),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') || [])
        .filter(el => el.tabIndex >= 0 && !el.closest('[hidden],[inert]') && el.getClientRects().length > 0);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <form className={`pm-modal pm-dialog ${className}`} onSubmit={event => { event.preventDefault(); if (open) onSubmit?.(event); }} inert={!open}>
      <header className="pm-dialog-header">
        <div className="pm-dialog-emblem" aria-hidden="true"><Icon size={22}/></div>
        <div className="pm-dialog-heading"><span className="pm-dialog-eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2>{subtitle && <p id={descriptionId}>{subtitle}</p>}</div>
        <button type="button" className="pm-dialog-close" onClick={onClose} aria-label={`Fechar ${title}`}><X size={18}/></button>
      </header>
      <div className="pm-dialog-content">{navigation}<div className="pm-dialog-body">{children}</div></div>
      {footer && <footer className="pm-dialog-footer">{footer}</footer>}
    </form>
  </dialog>;
}

export function DialogSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="pm-dialog-section"><header><h3>{title}</h3>{hint && <p>{hint}</p>}</header>{children}</section>;
}
