import React, { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { fragmentClip } from "./fragment-reveal";
import { useInterfaceMotion } from "./graphics-motion";

/** An overlay, never a child of the document's measured layout. */
export function WorkspacePanel({ open, title, onClose, children, className = "", modal = false }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
  className?: string; modal?: boolean;
}) {
  const interfaceMotion = useInterfaceMotion();
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const reveal = useRef(0);
  const id = useId();
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!mounted) {
      if (open) setMounted(true);
      return;
    }
    const panel = ref.current;
    if (!panel) return;
    if (!interfaceMotion) {
      if (open) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && !panel.contains(active)) restore.current = active;
      }
      reveal.current = open ? 1 : 0;
      panel.dataset.reveal = String(reveal.current);
      delete panel.dataset.fragmenting;
      // The stylesheet's initial reveal is fully clipped and offset by 9px.
      // Settling without motion must override it, not restore that hidden state.
      panel.style.clipPath = 'none';
      panel.style.setProperty('--pm-reveal-x', '0px');
      setEntered(open);
      if (!open) setMounted(false);
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const target = open ? 1 : 0;
    const from = reveal.current;
    const start = performance.now();
    // Match the sidebar's duration, easing and partial-distance reversal.
    const duration = 280 * Math.max(.32, Math.abs(target - from));
    let frame = 0;
    if (open) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !panel.contains(active)) restore.current = active;
    }
    setEntered(open);
    const paint = (value: number) => {
      reveal.current = value;
      panel.dataset.reveal = String(value);
      panel.style.clipPath = fragmentClip(value, panel.offsetWidth, panel.offsetHeight, "right");
      panel.style.setProperty("--pm-reveal-x", `${9 * (1 - value)}px`);
    };
    const finish = () => {
      cancelAnimationFrame(frame);
      paint(target);
      delete panel.dataset.fragmenting;
      if (!open) setMounted(false);
    };
    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      paint(from + (target - from) * t * t * (3 - 2 * t));
      if (t < 1) frame = requestAnimationFrame(animate);
      else finish();
    };
    const settle = () => { if (reduced.matches || document.hidden) finish(); };
    if (reduced.matches || document.hidden || from === target) finish();
    else {
      paint(from);
      panel.dataset.fragmenting = "true";
      frame = requestAnimationFrame(animate);
    }
    reduced.addEventListener("change", settle);
    document.addEventListener("visibilitychange", settle);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener("change", settle);
      document.removeEventListener("visibilitychange", settle);
    };
  }, [open, mounted, interfaceMotion]);

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
      <header className="pm-workspace-panel-heading"><h2 id={id}>{title}</h2><button type="button" onClick={close} aria-label={`Fechar ${title}`} data-tooltip="Fechar" data-shortcut="Esc"><X size={16} aria-hidden="true" /></button></header>
      {children}
    </div>
  </>;
}
