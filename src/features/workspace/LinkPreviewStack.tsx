import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { titleOf } from '../../shared/path';
import { loadPreviewNote, makeMarkdownReadOnly, renderDynamicMarkdown, sanitizeMarkdown, type MarkdownContext } from '../markdown/renderer';

type HoverEvent = { target: EventTarget | null };
export type LinkPreviewHandle = { hover: (event: HoverEvent) => void; leave: () => void; close: () => void };
type Card = {
  id: number; path: string; origin: HTMLElement; context: MarkdownContext;
  x: number; y: number; width: number; height: number;
  html: string; loading: boolean; error: string;
};
type RenderedNote = { content: string; context: MarkdownContext; html: string };

// A card keeps the resolution context captured when its HTML was generated.
// Adding a sibling or receiving presence updates must not restart its diagrams.
const PreviewContent = memo(function PreviewContent({ card }: { card: Card }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (ref.current) makeMarkdownReadOnly(ref.current);
    const frame = requestAnimationFrame(() => {
      if (ref.current) void renderDynamicMarkdown(ref.current, card.context, 0, { signal: controller.signal, readOnly: true });
    });
    return () => { cancelAnimationFrame(frame); controller.abort(); };
  }, [card.html, card.context]);
  return <div ref={ref} className="pm-link-hover-content" dangerouslySetInnerHTML={{ __html: card.html }} />;
});

/** Hovering moves no UI; cards are anchored once, to the originating link. */
export const LinkPreviewStack = forwardRef<LinkPreviewHandle, { context: MarkdownContext; scale: number; onOpen: (path: string) => void }>(function LinkPreviewStack(props, ref) {
  const [cards, setCards] = useState<Card[]>([]);
  const cardsRef = useRef(cards);
  const propsRef = useRef(props); propsRef.current = props;
  const openTimer = useRef(0), closeTimer = useRef(0), sequence = useRef(0);
  const target = useRef<HTMLElement | null>(null);
  const requests = useRef(new Map<number, AbortController>());
  const renderedNotes = useRef(new Map<string, RenderedNote>());
  const update = (next: Card[]) => { cardsRef.current = next; setCards(next); };
  const retain = (length: number) => {
    if (length >= cardsRef.current.length) return;
    cardsRef.current.slice(length).forEach(card => { requests.current.get(card.id)?.abort(); requests.current.delete(card.id); });
    update(cardsRef.current.slice(0, length));
  };
  const cancelClose = () => { clearTimeout(closeTimer.current); closeTimer.current = 0; };
  const cancelOpen = () => { clearTimeout(openTimer.current); openTimer.current = 0; target.current = null; };
  const close = () => {
    cancelOpen(); cancelClose();
    requests.current.forEach(controller => controller.abort()); requests.current.clear();
    retain(0);
  };
  const leave = () => {
    cancelOpen();
    if (!closeTimer.current) closeTimer.current = window.setTimeout(close, 320);
  };
  const hover = (event: HoverEvent) => {
    const element = event.target instanceof Element ? event.target : null;
    const anchor = element?.closest<HTMLElement>('a[data-pm-note]');
    if (!anchor) {
      cancelOpen();
      if (element?.closest('.pm-link-hover-preview')) cancelClose();
      else leave();
      return;
    }
    cancelClose();
    const parent = anchor.closest<HTMLElement>('[data-preview-level]');
    const level = parent ? Number(parent.dataset.previewLevel) + 1 : 0;
    const path = anchor.dataset.pmNote || '';
    if (!path || !Number.isInteger(level) || level < 0 || level >= 4) { cancelOpen(); return; }
    if (target.current === anchor) return;
    cancelOpen();
    if (cardsRef.current[level]?.origin === anchor && cardsRef.current[level]?.path === path) return;
    target.current = anchor;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = 0;
      if (!anchor.isConnected || target.current !== anchor) return;
      retain(level);
      const scale = Math.max(.1, propsRef.current.scale);
      const bounds = (parent || anchor).getBoundingClientRect();
      const viewportWidth = innerWidth / scale, viewportHeight = innerHeight / scale;
      const width = Math.max(1, Math.min(370, viewportWidth - 24));
      const height = Math.max(1, Math.min(350, viewportHeight - 32));
      const right = bounds.right / scale + 12;
      const x = Math.max(12, Math.min(right + width < viewportWidth ? right : bounds.left / scale - width - 12, viewportWidth - width - 12));
      const y = Math.max(12, Math.min(bounds.top / scale + (parent ? 14 : 20), viewportHeight - height - 12));
      const id = ++sequence.current;
      const context = { ...propsRef.current.context, activePath: path };
      const card: Card = { id, path, origin: anchor, context, x, y, width, height, html: '', loading: true, error: '' };
      update([...cardsRef.current, card]);
      const controller = new AbortController(); requests.current.set(id, controller);
      loadPreviewNote(path, context, controller.signal).then(note => {
        if (controller.signal.aborted || !cardsRef.current.some(current => current.id === id)) return;
        const cached = renderedNotes.current.get(path);
        const html = cached?.content === note.content && cached.context.notes === context.notes
          && cached.context.folders === context.folders && cached.context.assets === context.assets
          ? cached.html : sanitizeMarkdown(note.content, context);
        renderedNotes.current.delete(path);
        // Limit both count and retained HTML; large notes still render normally.
        if (html.length + note.content.length <= 250_000) {
          renderedNotes.current.set(path, { content: note.content, context, html });
          while (renderedNotes.current.size > 8) renderedNotes.current.delete(renderedNotes.current.keys().next().value!);
        }
        update(cardsRef.current.map(current => current.id === id ? { ...current, html, loading: false } : current));
      }).catch(error => {
        if (!controller.signal.aborted && cardsRef.current.some(current => current.id === id)) {
          update(cardsRef.current.map(current => current.id === id ? { ...current, loading: false, error: error instanceof Error ? error.message : 'Não foi possível abrir a prévia.' } : current));
        }
      }).finally(() => requests.current.delete(id));
    }, 180);
  };
  useImperativeHandle(ref, () => ({ hover, leave, close }));
  useEffect(() => {
    const resized = () => close();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('resize', resized); window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', resized); window.removeEventListener('keydown', escape);
      clearTimeout(openTimer.current); clearTimeout(closeTimer.current);
      requests.current.forEach(controller => controller.abort()); requests.current.clear();
      renderedNotes.current.clear();
    };
  }, []);
  useEffect(() => { close(); renderedNotes.current.clear(); }, [props.context.activePath]);
  return <>{cards.map((card, index) => <aside key={card.id} className="pm-link-hover-preview pm-markdown" data-preview-level={index}
    aria-label={`Prévia de ${titleOf(card.path)}`} style={{ left: card.x, top: card.y, width: card.width, maxHeight: card.height, zIndex: 220 + index }}
    onMouseEnter={cancelClose} onMouseMove={hover} onMouseLeave={leave} onFocusCapture={cancelClose}
    onScrollCapture={() => { cancelOpen(); if (cardsRef.current.length > index + 1) retain(index + 1); }}
    onClick={event => {
      const element = event.target instanceof Element ? event.target : null;
      const path = element?.closest<HTMLElement>('a[data-pm-note]')?.dataset.pmNote;
      if (!path) return;
      event.preventDefault(); event.stopPropagation();
      if (event.ctrlKey || event.metaKey) { propsRef.current.onOpen(path); close(); }
    }}>
    <header><div><strong>{titleOf(card.path)}</strong><small>{card.path}</small></div>
      <button title="Abrir nota" aria-label={`Abrir ${titleOf(card.path)}`} onClick={() => { propsRef.current.onOpen(card.path); close(); }}><ExternalLink size={15} /></button>
      <button title="Fechar prévia" aria-label={`Fechar prévia ${index + 1}`} onClick={() => { cancelOpen(); retain(index); }}><X size={15} /></button></header>
    {card.loading && <div className="pm-link-hover-loading">Carregando…</div>}
    {card.error && <p role="alert" className="pm-link-hover-error">{card.error}</p>}
    {!!card.html && <PreviewContent card={card} />}
  </aside>)}</>;
});
