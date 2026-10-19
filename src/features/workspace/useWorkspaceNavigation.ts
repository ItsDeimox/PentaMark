import { useEffect, useRef, useState } from "react";

export function useWorkspaceNavigation(scale: number, desktopOpen: boolean, mobileOpen: boolean,
  setDesktop: (open: boolean) => void, setMobile: (open: boolean) => void) {
  const [width, setWidth] = useState(() => window.innerWidth);
  const compact = width / Math.max(.1, scale) < 1100;
  const visible = compact ? mobileOpen : desktopOpen;
  const openerRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const setVisible = (open: boolean) => {
    if (compact) setMobile(open); else setDesktop(open);
    requestAnimationFrame(() => {
      if (!open) openerRef.current?.focus({ preventScroll: true });
      else sidebarRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (!visible) return;
    const key = (event: KeyboardEvent) => {
      if (!sidebarRef.current?.contains(event.target as Node)) return;
      if (event.key === "Escape") { event.preventDefault(); setVisible(false); }
      if (!compact || event.key !== "Tab") return;
      const targets = Array.from(sidebarRef.current.querySelectorAll<HTMLElement>("button:not(:disabled),input,[tabindex='0']")).filter(el => el.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [visible, compact]);
  return { compact, visible, setVisible, openerRef, sidebarRef };
}
