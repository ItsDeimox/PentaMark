import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { request } from '../../api/client';
import type { OpenNote } from '../../domain/types';
import { titleOf } from '../../shared/path';
import { renderDynamicMarkdown, sanitizeMarkdown, type MarkdownContext } from '../markdown/renderer';

type HoverEvent = { target: EventTarget | null };
export type LinkPreviewHandle = { hover: (event: HoverEvent) => void; leave: () => void; close: () => void };
type Card = { id: number; path: string; x: number; y: number; width: number; height: number; html: string; loading: boolean; error: string };

function PreviewContent({ card, context }: { card: Card; context: MarkdownContext }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (ref.current) void renderDynamicMarkdown(ref.current, { ...context, activePath: card.path }); });
    return () => cancelAnimationFrame(frame);
  }, [card.html, card.path, context]);
  return <div ref={ref} className="pm-link-hover-content" dangerouslySetInnerHTML={{__html:card.html}}/>;
}

/** Hovering moves no UI; cards are anchored once, to the originating link. */
export const LinkPreviewStack = forwardRef<LinkPreviewHandle, { context: MarkdownContext; scale: number; onOpen: (path: string) => void }>(function LinkPreviewStack(props, ref) {
  const [cards, setCards] = useState<Card[]>([]);
  const cardsRef = useRef(cards);
  const propsRef = useRef(props); propsRef.current = props;
  const openTimer = useRef(0), closeTimer = useRef(0), sequence = useRef(0);
  const target = useRef('');
  const requests = useRef(new Map<number, AbortController>());
  const update = (next: Card[]) => { cardsRef.current = next; setCards(next); };
  const retain = (length: number) => {
    cardsRef.current.slice(length).forEach(c => { requests.current.get(c.id)?.abort(); requests.current.delete(c.id); });
    update(cardsRef.current.slice(0, length));
  };
  const cancelClose = () => { clearTimeout(closeTimer.current); closeTimer.current = 0; };
  const close = () => {
    clearTimeout(openTimer.current); cancelClose(); target.current = ''; sequence.current++;
    requests.current.forEach(r => r.abort()); requests.current.clear(); update([]);
  };
  const leave = () => {
    clearTimeout(openTimer.current); target.current = '';
    if (!closeTimer.current) closeTimer.current = window.setTimeout(close, 320);
  };
  const hover = (event: HoverEvent) => {
    const element = event.target instanceof Element ? event.target : null;
    const anchor = element?.closest<HTMLElement>('a[data-pm-note]');
    if (!anchor) { if (element?.closest('.pm-link-hover-preview')) cancelClose(); else leave(); return; }
    cancelClose();
    const parent = anchor.closest<HTMLElement>('[data-preview-level]');
    const level = parent ? Number(parent.dataset.previewLevel) + 1 : 0;
    const path = anchor.dataset.pmNote || '';
    if (!path || level >= 4) return;
    const key = `${level}:${path}`;
    if (target.current === key || cardsRef.current[level]?.path === path) return;
    target.current = key;
    clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      if (!anchor.isConnected || target.current !== key) return;
      retain(level);
      const scale = Math.max(.1, propsRef.current.scale);
      const bounds = (parent || anchor).getBoundingClientRect();
      const viewportWidth = innerWidth / scale, viewportHeight = innerHeight / scale;
      const width = Math.min(370, viewportWidth - 24), height = Math.min(350, viewportHeight - 32);
      const right = bounds.right / scale + 12;
      const x = Math.max(12, Math.min(right + width < viewportWidth ? right : bounds.left / scale - width - 12, viewportWidth-width-12));
      const y = Math.max(12, Math.min(bounds.top / scale + (parent?14:20), viewportHeight-height-12));
      const id = ++sequence.current;
      const card:Card = {id,path,x,y,width,height,html:'',loading:true,error:''};
      update([...cardsRef.current, card]);
      const controller = new AbortController(); requests.current.set(id, controller);
      request<OpenNote>(`/api/note?path=${encodeURIComponent(path)}`, {signal:controller.signal}).then(note => {
        const html = sanitizeMarkdown(note.content,{...propsRef.current.context,activePath:path});
        if (!controller.signal.aborted) update(cardsRef.current.map(c => c.id===id?{...c,html,loading:false}:c));
      }).catch(error => {
        if (!controller.signal.aborted) update(cardsRef.current.map(c => c.id===id?{...c,loading:false,error:error instanceof Error?error.message:'Não foi possível abrir a prévia.'}:c));
      }).finally(()=>requests.current.delete(id));
    }, 180);
  };
  useImperativeHandle(ref, () => ({hover,leave,close}));
  useEffect(() => {
    const resized = () => close();
    const escape = (e:KeyboardEvent) => { if(e.key==='Escape') close(); };
    window.addEventListener('resize',resized); window.addEventListener('keydown',escape);
    return () => { window.removeEventListener('resize',resized);window.removeEventListener('keydown',escape);clearTimeout(openTimer.current);clearTimeout(closeTimer.current);requests.current.forEach(r=>r.abort()); };
  }, []);
  useEffect(() => close(), [props.context.activePath]);
  return <>{cards.map((card,index)=><aside key={card.id} className="pm-link-hover-preview pm-markdown" data-preview-level={index}
    aria-label={`Prévia de ${titleOf(card.path)}`} style={{left:card.x,top:card.y,width:card.width,maxHeight:card.height,zIndex:220+index}}
    onMouseEnter={cancelClose} onMouseMove={hover} onMouseLeave={leave} onFocusCapture={cancelClose}
    onScrollCapture={()=>{ if(cardsRef.current.length>index+1)retain(index+1); }}
    onClick={event=>{ const path=(event.target as Element).closest<HTMLElement>('a[data-pm-note]')?.dataset.pmNote;if(path){event.preventDefault();props.onOpen(path);close();} }}>
    <header><div><strong>{titleOf(card.path)}</strong><small>{card.path}</small></div>
      <button title="Abrir nota" aria-label={`Abrir ${titleOf(card.path)}`} onClick={()=>{props.onOpen(card.path);close();}}><ExternalLink size={15}/></button>
      <button title="Fechar prévia" aria-label={`Fechar prévia ${index+1}`} onClick={()=>{target.current='';retain(index);}}><X size={15}/></button></header>
    {card.loading&&<div className="pm-link-hover-loading">Carregando…</div>}
    {card.error&&<p role="alert" className="pm-link-hover-error">{card.error}</p>}
    {!!card.html&&<PreviewContent card={card} context={props.context}/>}
  </aside>)}</>;
});
