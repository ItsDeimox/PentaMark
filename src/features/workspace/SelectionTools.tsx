import React, { useEffect, useRef, useState } from "react";
import { Braces, MoreHorizontal } from "lucide-react";
import { FORMAT_ACTIONS } from "../../app/constants";
import type { FormatKind } from "../../domain/types";

type Position = { x: number; y: number };
const QUICK_FORMATS = new Set<FormatKind>(['bold', 'italic', 'heading', 'bullet', 'task', 'quote', 'link', 'code']);
const QUICK_ACTIONS = FORMAT_ACTIONS.filter(action => QUICK_FORMATS.has(action.kind));
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
        const logicalWidth = shell.width / scale;
        const fallbackWidth = logicalWidth < 560 ? 242 : 365;
        const toolbarWidth = ref.current?.offsetWidth || fallbackWidth;
        setPosition({
          x: Math.max(12, Math.min((rect.left - shell.left) / scale, logicalWidth - toolbarWidth - 12)),
          y: Math.max(8, (rect.top - shell.top) / scale - 52),
        });
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
    {QUICK_ACTIONS.map(({kind,label,shortcut,icon:Icon}, index) => <button key={kind} type="button"
      aria-label={`${label} na seleção`} data-tooltip={label} data-shortcut={shortcut} data-compact-action={index >= 4}
      onClick={() => onFormat(kind)}><Icon size={16}/></button>)}
    {onSource && <button type="button" aria-label="Editar fonte do trecho" data-tooltip="Editar fonte" data-shortcut=""
      onClick={onSource}><Braces size={16}/></button>}
    <button type="button" aria-label="Mais ferramentas de formatação" data-tooltip="Mais formatação" data-shortcut=""
      onClick={onMore}><MoreHorizontal size={17}/></button>
  </div>;
}
