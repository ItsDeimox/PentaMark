import { useEffect, useState } from 'react';

type Hint = { label: string; shortcut: string; left: number; top: number; below: boolean };

/** Shared, anchored tooltip. One layer instead of dozens of hover animations. */
export function TooltipLayer() {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.pm-shell');
    if (!shell) return;
    let active: HTMLElement | null = null;
    let timer = 0;
    const close = () => {
      window.clearTimeout(timer);
      timer = 0;
      if (active?.getAttribute('aria-describedby') === 'pm-optical-hint') active.removeAttribute('aria-describedby');
      active = null;
      setHint(null);
    };
    const position = (button: HTMLElement) => {
      const rect = button.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const scale = rect.width / Math.max(button.offsetWidth, 1) || 1;
      const logicalWidth = shellRect.width / scale;
      const below = rect.top < shellRect.top + 64 * scale;
      setHint({
        label: button.dataset.tooltip || '',
        shortcut: button.dataset.shortcut || '',
        left: Math.max(90, Math.min(logicalWidth - 90, (rect.left + rect.width / 2 - shellRect.left) / scale)),
        top: (below ? rect.bottom + 9 * scale : rect.top - 9 * scale - shellRect.top) / scale,
        below,
      });
      button.setAttribute('aria-describedby', 'pm-optical-hint');
    };
    const begin = (button: HTMLElement | null, immediate: boolean) => {
      if (!button || button.closest('[inert]') || !button.dataset.tooltip) { close(); return; }
      if (active === button) return;
      close(); active = button;
      timer = window.setTimeout(() => {
        if (active === button && button.isConnected) position(button);
      }, immediate ? 0 : 240);
    };
    const find = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
    const over = (event: PointerEvent) => { if (event.pointerType !== 'touch') begin(find(event.target), false); };
    const out = (event: PointerEvent) => {
      if (active && event.target instanceof Node && active.contains(event.target) &&
        !(event.relatedTarget instanceof Node && active.contains(event.relatedTarget))) close();
    };
    const focus = (event: FocusEvent) => begin(find(event.target), true);
    const blur = (event: FocusEvent) => {
      if (active && event.target instanceof Node && active.contains(event.target)) close();
    };
    const hide = () => close();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    shell.addEventListener('pointerover', over);
    shell.addEventListener('pointerout', out);
    shell.addEventListener('focusin', focus);
    shell.addEventListener('focusout', blur);
    shell.addEventListener('click', hide, true);
    shell.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', key);
    return () => {
      close(); shell.removeEventListener('pointerover', over); shell.removeEventListener('pointerout', out);
      shell.removeEventListener('focusin', focus); shell.removeEventListener('focusout', blur);
      shell.removeEventListener('click', hide, true); shell.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide); window.removeEventListener('keydown', key);
    };
  }, []);

  return hint ? <div id="pm-optical-hint" className="pm-optical-tooltip" data-below={hint.below} role="tooltip"
    style={{left: hint.left, top: hint.top}}>
    <span>{hint.label}</span>{hint.shortcut && <kbd>{hint.shortcut}</kbd>}
  </div> : null;
}
