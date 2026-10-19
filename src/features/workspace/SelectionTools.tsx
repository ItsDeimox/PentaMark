import React, { useEffect, useRef, useState } from "react";
import { Bold, Italic, Link, Code, MoreHorizontal, Braces } from "lucide-react";
import type { FormatKind } from "../../domain/types";

type Position = { x: number; y: number };
export function SelectionTools({ enabled, scale, onFormat, onMore, onSource }: {
  enabled: boolean; scale: number; onFormat: (kind: FormatKind) => void; onMore: () => void; onSource?: () => void;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled) { setPosition(null); return; }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        const element = selection?.anchorNode?.parentElement;
        if (!selection || selection.isCollapsed || !selection.rangeCount || !element?.closest(".pm-live-codemirror")) { setPosition(null); return; }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const shell = element.closest(".pm-shell")!.getBoundingClientRect();
        if (!rect.width || rect.bottom < 0 || rect.top > innerHeight) { setPosition(null); return; }
        setPosition({ x: Math.max(12, Math.min((rect.left - shell.left) / scale, shell.width / scale - 260)), y: Math.max(8, (rect.top - shell.top) / scale - 52) });
      });
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setPosition(null); };
    document.addEventListener("selectionchange", update);
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("selectionchange", update); document.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); window.removeEventListener("keydown", key); };
  }, [enabled, scale]);
  if (!position) return null;
  return <div ref={ref} className="pm-selection-tools" role="toolbar" aria-label="Formatação da seleção" style={{ left: position.x, top: position.y }} onMouseDown={event => event.preventDefault()}>
    <button aria-label="Negrito na seleção" onClick={() => onFormat("bold")}><Bold size={18} /></button>
    <button aria-label="Itálico na seleção" onClick={() => onFormat("italic")}><Italic size={18} /></button>
    <button aria-label="Link na seleção" onClick={() => onFormat("link")}><Link size={18} /></button>
    <button aria-label="Código na seleção" onClick={() => onFormat("code")}><Code size={18} /></button>
    {onSource && <button aria-label="Editar fonte do trecho" onClick={onSource}><Braces size={18} /></button>}
    <button aria-label="Mais ferramentas de formatação" onClick={onMore}><MoreHorizontal size={18} /></button>
  </div>;
}
