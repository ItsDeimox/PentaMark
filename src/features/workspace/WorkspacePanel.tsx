import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** An overlay, never a child of the document's measured layout. */
export function WorkspacePanel({ open, title, onClose, children, className = "", modal = false }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
  className?: string; modal?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const id = useId();
  closeRef.current = onClose;

  useEffect(() => {
    let timer = 0;
    let frame = 0;
    if (open) {
      restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMounted(true);
      frame = requestAnimationFrame(() => setEntered(true));
    } else {
      setEntered(false);
      timer = window.setTimeout(() => setMounted(false), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
    }
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [open]);

  useEffect(() => {
    if (!mounted || !open) return;
    const frame = requestAnimationFrame(() => {
      (ref.current?.querySelector<HTMLElement>("[data-autofocus]") || ref.current?.querySelector<HTMLElement>("input,textarea,button"))?.focus({ preventScroll: true });
    });
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest("[data-workspace-trigger],.pm-workspace-scrim,.pm-modal-backdrop,.pm-modal")) return;
      closeRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (event.target as HTMLElement)?.closest?.(".pm-modal-backdrop,.pm-modal")) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      requestAnimationFrame(() => {
        if (restore.current?.isConnected && !restore.current.closest("[inert]")) restore.current.focus({ preventScroll: true });
      });
    };
    document.addEventListener("pointerdown", outside);
    // Capture Escape even during the opening frame, before focus reaches the panel.
    document.addEventListener("keydown", escape, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [mounted, open]);

  const close = () => {
    closeRef.current();
    requestAnimationFrame(() => {
      if (restore.current?.isConnected && !restore.current.closest("[inert]")) restore.current.focus({ preventScroll: true });
    });
  };

  if (!mounted) return null;
  return <>
    {modal && <div className="pm-workspace-scrim" data-entered={entered && open} onClick={close} />}
    <div ref={ref} className={`pm-workspace-panel ${className}`} role="dialog" aria-modal={modal || undefined}
      aria-labelledby={id} data-entered={entered && open} inert={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (event.key !== "Tab") return;
        const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex='0']") || []).filter(el => el.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header className="pm-workspace-panel-heading"><h2 id={id}>{title}</h2><button type="button" onClick={close} aria-label={`Fechar ${title}`}>×</button></header>
      {children}
    </div>
  </>;
}
