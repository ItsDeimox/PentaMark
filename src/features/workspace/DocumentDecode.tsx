import { useEffect } from 'react';

/** Adapted from Cortex Idle's panel-animation decode: immutable source glyphs,
 * a disposable visual-only layer and a bounded left-to-right character lock-in.
 * Never insert text into CodeMirror or mutate a Markdown document. */
export function decodedFrame(text: string, progress: number, tick = 0): string {
  if (progress >= 1) return text;
  const glyphs = '01:/+<>[]';
  const chars = Array.from(text);
  const resolved = Math.floor(chars.length * Math.max(0, progress));
  return chars.map((char, index) => index < resolved || /\s/u.test(char)
    ? char : glyphs[(index * 7 + tick * 3) % glyphs.length]).join('');
}

export function DocumentDecode({ path, enabled, mode }: { path: string; enabled: boolean; mode: string }) {
  useEffect(() => {
    if (!path || !enabled || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const workspace = document.querySelector<HTMLElement>('.pm-workspace');
    if (!workspace) return;
    let frame = 0;
    const cleanups: Array<() => void> = [];
    let disposed = false;
    const cancel = () => { disposed = true; cancelAnimationFrame(frame); cleanups.forEach(fn => fn()); cleanups.length = 0; };
    workspace.addEventListener('pointerdown', cancel, { once: true });
    workspace.addEventListener('keydown', cancel, { once: true });
    workspace.addEventListener('wheel', cancel, { once: true, passive: true });
    const mount = () => {
      if (disposed) return;
      const candidates = mode === 'live'
        ? workspace.querySelectorAll<HTMLElement>('.pm-live-codemirror .cm-line')
        : mode === 'preview' || mode === 'split'
          ? workspace.querySelectorAll<HTMLElement>('.pm-preview-pane .pm-markdown h1,.pm-preview-pane .pm-markdown h2,.pm-preview-pane .pm-markdown h3,.pm-preview-pane .pm-markdown p')
          : workspace.querySelectorAll<HTMLElement>('.pm-document-path strong');
      const layer = document.createElement('div');
      layer.className = 'pm-decode-layer';
      layer.setAttribute('aria-hidden', 'true');
      workspace.appendChild(layer);
      cleanups.push(() => layer.remove());
      const bounds = workspace.getBoundingClientRect();
      const scale = bounds.width / Math.max(1, workspace.offsetWidth);
      const labels: Array<{text: string; overlay: HTMLSpanElement; delay: number}> = [];
      const visibleTop = bounds.top + 84 * scale;
      for (const target of Array.from(candidates)) {
        if (labels.length >= 12) break;
        if (target.closest('.pm-live-widget,.pm-kanban,.pm-callout,.pm-properties,.pm-link-hover-preview')) continue;
        const text = (target.textContent || '').trim();
        if (text.length < 3 || text.length > 180) continue;
        const rect = target.getBoundingClientRect();
        if (rect.width < 15 || rect.height < 5 || rect.top < visibleTop || rect.top > bounds.bottom - 38 || rect.left < bounds.left) continue;
        const style = getComputedStyle(target);
        if (rect.height > (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.7) * 1.7) continue;
        const overlay = document.createElement('span');
        overlay.className = 'pm-decode-glyphs';
        overlay.style.left = `${(rect.left - bounds.left) / scale}px`;
        overlay.style.top = `${(rect.top - bounds.top) / scale}px`;
        overlay.style.height = `${rect.height / scale}px`;
        overlay.style.maxWidth = `${rect.width / scale}px`;
        overlay.style.font = style.font;
        overlay.style.letterSpacing = style.letterSpacing;
        overlay.style.lineHeight = style.lineHeight;
        overlay.textContent = decodedFrame(text, 0);
        layer.appendChild(overlay);
        target.classList.add('pm-decoding-original');
        cleanups.push(() => target.classList.remove('pm-decoding-original'));
        labels.push({text, overlay, delay: Math.min(labels.length * 22, 135)});
      }
      if (!labels.length) { cleanups.forEach(fn => fn()); cleanups.length = 0; return; }
      const start = performance.now();
      let lastTick = -1;
      const draw = (now: number) => {
        if (disposed) return;
        const elapsed = now - start, tick = Math.floor(elapsed / 48);
        if (tick !== lastTick) {
          lastTick = tick;
          for (const label of labels) {
            const progress = Math.max(0, Math.min(1, (elapsed - label.delay) / 385));
            label.overlay.textContent = decodedFrame(label.text, progress, tick);
          }
        }
        if (elapsed < 540) frame = requestAnimationFrame(draw);
        else { cleanups.forEach(fn => fn()); cleanups.length = 0; }
      };
      frame = requestAnimationFrame(draw);
    };
    // Wait for CodeMirror's view transaction and the final note content to paint.
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(mount); });
    return () => { cancel(); workspace.removeEventListener('pointerdown', cancel); workspace.removeEventListener('keydown', cancel); workspace.removeEventListener('wheel', cancel); };
  }, [path, enabled, mode]);
  return null;
}
