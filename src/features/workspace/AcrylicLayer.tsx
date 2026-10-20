import { useEffect, useRef } from 'react';
import { attachAcrylicRenderer } from './acrylic-renderer';

/** One renderer for all app-owned surfaces, including native top-layer dialogs. */
export function AcrylicLayer({ enabled, theme, refraction = true, interfaceMotion = true, reactive = true }: {
  enabled: boolean; theme: string; refraction?: boolean; interfaceMotion?: boolean; reactive?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const shell = canvas?.closest<HTMLElement>('.pm-shell');
    if (enabled && canvas && shell) return attachAcrylicRenderer(canvas, shell, { refraction, interfaceMotion, reactive });
  }, [enabled, theme, refraction, interfaceMotion, reactive]);
  return enabled ? <canvas ref={ref} className="pm-acrylic-layer" data-material="acrylic" aria-hidden="true" /> : null;
}
