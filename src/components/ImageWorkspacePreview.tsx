import { ExternalLink, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type View = { zoom: number; x: number; y: number };
const INITIAL_VIEW: View = { zoom: 1, x: 0, y: 0 };

export function ImageWorkspacePreview({ source, title, onClose, onReveal }: {
  source: string; title: string; onClose: () => void; onReveal: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false), [dragging, setDragging] = useState(false);
  const [view, setView] = useState(INITIAL_VIEW), current = useRef(INITIAL_VIEW);
  const drag = useRef<{ id: number; x: number; y: number; origin: View; scaleX: number; scaleY: number } | null>(null);
  const previousFit = useRef(0);
  const fit = natural.width && viewport.width
    ? Math.min(Math.max(1, viewport.width - 16) / natural.width, Math.max(1, viewport.height - 16) / natural.height) : 0;
  const ready = Boolean(fit && !failed);
  const update = useCallback((next: View) => { current.current = next; setView(next); }, []);
  const endDrag = useCallback(() => {
    const active = drag.current; drag.current = null; setDragging(false);
    if (active && stage.current?.hasPointerCapture(active.id)) stage.current.releasePointerCapture(active.id);
  }, []);
  const reset = useCallback(() => { endDrag(); update(INITIAL_VIEW); }, [endDrag, update]);
  const zoomAt = useCallback((target: number, x = 0, y = 0) => {
    endDrag();
    const before = current.current, zoom = Math.max(.15, Math.min(8, target));
    const ratio = zoom / before.zoom;
    update({ zoom, x: x - (x - before.x) * ratio, y: y - (y - before.y) * ratio });
  }, [endDrag, update]);

  useEffect(() => { stage.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    const node = stage.current; if (!node) return;
    const measure = () => setViewport(before => before.width === node.clientWidth && before.height === node.clientHeight
      ? before : { width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver(measure); observer.observe(node); measure();
    // A native, non-passive listener prevents wheel zoom from scrolling the app.
    const wheel = (event: WheelEvent) => {
      if (!image.current?.naturalWidth || failed || !event.deltaY) return;
      event.preventDefault();
      if (drag.current) return;
      const bounds = node.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * node.clientWidth / bounds.width - node.clientWidth / 2;
      const y = (event.clientY - bounds.top) * node.clientHeight / bounds.height - node.clientHeight / 2;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      const delta = Math.max(-300, Math.min(300, event.deltaY * unit));
      zoomAt(current.current.zoom * Math.exp(-delta * .002), x, y);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); node.removeEventListener("wheel", wheel); };
  }, [zoomAt, failed]);

  useLayoutEffect(() => { endDrag(); }, [viewport.width, viewport.height, endDrag]);

  useLayoutEffect(() => {
    if (fit && previousFit.current) {
      const ratio = fit / previousFit.current, before = current.current;
      if (ratio !== 1) update({ ...before, x: before.x * ratio, y: before.y * ratio });
    }
    previousFit.current = fit;
  }, [fit, update]);

  return <section className="pm-asset-workspace pm-asset-workspace--image" aria-label={`Visualizador de imagem: ${title}`}
    onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.target !== stage.current || !ready) return;
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(current.current.zoom * 1.2); }
      if (event.key === "-") { event.preventDefault(); zoomAt(current.current.zoom / 1.2); }
      if (event.key === "0") { event.preventDefault(); reset(); }
    }}>
    <div ref={stage} className="pm-asset-stage pm-asset-stage--image" role="region" aria-label="Área da imagem" tabIndex={0}
      data-dragging={dragging} aria-describedby="pm-image-help" onDoubleClick={reset}
      onPointerDown={event => {
        if (!ready || !event.isPrimary || event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
        const bounds = event.currentTarget.getBoundingClientRect();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: current.current,
          scaleX: event.currentTarget.clientWidth / bounds.width, scaleY: event.currentTarget.clientHeight / bounds.height };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      }}
      onPointerMove={event => {
        const start = drag.current; if (!start || start.id !== event.pointerId) return;
        update({ ...start.origin, x: start.origin.x + (event.clientX - start.x) * start.scaleX,
          y: start.origin.y + (event.clientY - start.y) * start.scaleY });
      }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
      <img ref={image} src={source} alt={title} draggable={false} decoding="async"
        onLoad={event => { setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setFailed(false); }}
        onError={() => setFailed(true)}
        style={{ width: natural.width * fit, height: natural.height * fit, visibility: ready ? "visible" : "hidden",
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }} />
      {!ready && <p className="pm-image-status" role="status">{failed ? "Não foi possível carregar esta imagem." : "Carregando imagem…"}</p>}
    </div>
    <div className="pm-image-controls" role="toolbar" aria-label="Controles da imagem">
      <button type="button" aria-label="Diminuir zoom da imagem" title="Diminuir zoom" disabled={!ready || view.zoom <= .15} onClick={() => zoomAt(current.current.zoom / 1.2)}><ZoomOut size={17} /></button>
      <output aria-label="Zoom da imagem">{Math.round(view.zoom * 100)}%</output>
      <button type="button" aria-label="Aumentar zoom da imagem" title="Aumentar zoom" disabled={!ready || view.zoom >= 8} onClick={() => zoomAt(current.current.zoom * 1.2)}><ZoomIn size={17} /></button>
      <button type="button" aria-label="Ajustar imagem ao painel" title="Ajustar ao painel (0)" disabled={!ready} onClick={reset}><Maximize2 size={17} /></button>
      <span className="pm-image-controls-divider" />
      <button type="button" aria-label="Mostrar imagem na pasta" title="Mostrar na pasta" onClick={onReveal}><ExternalLink size={16} /></button>
      <button type="button" aria-label="Fechar imagem" title="Fechar (Esc)" onClick={onClose}><X size={18} /></button>
    </div>
    <span id="pm-image-help" className="pm-image-help">Scroll: zoom no cursor. Arraste para mover. Duplo clique ou 0: ajustar. Esc: fechar.</span>
  </section>;
}
