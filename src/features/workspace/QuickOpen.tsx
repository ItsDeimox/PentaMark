import React, { useEffect, useMemo, useState, type RefObject } from "react";
import { File, FileText, Search } from "lucide-react";
import type { AssetMeta, NoteMeta } from "../../domain/types";
import { WorkspacePanel } from "./WorkspacePanel";

type Entry = { path: string; label: string; kind: "note" | "asset" };
export function QuickOpen({ open, query, onQuery, inputRef, notes, assets, onOpen, onClose }: {
  open: boolean; query: string; onQuery: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>; notes: NoteMeta[]; assets: AssetMeta[];
  onOpen: (entry: Entry) => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    const list: Entry[] = [
      ...notes.map(note => ({ path: note.path, label: note.title, kind: "note" as const })),
      ...assets.map(asset => ({ path: asset.path, label: asset.title, kind: "asset" as const })),
    ];
    return needle ? list.filter(entry => `${entry.path} ${entry.label}`.toLocaleLowerCase("pt-BR").includes(needle)) : list;
  }, [query, notes, assets]);
  const visible = entries.slice(0, 80);
  useEffect(() => setSelected(0), [query, open]);
  useEffect(() => setSelected(index => Math.min(index, Math.max(0, visible.length - 1))), [visible.length]);
  useEffect(() => {
    document.getElementById(`pm-open-result-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const choose = (entry: Entry) => { onOpen(entry); onClose(); };
  return <WorkspacePanel open={open} title="Abrir arquivo" onClose={onClose} className="pm-quick-open" modal>
    <div className="pm-quick-open-input"><Search size={18} /><input ref={inputRef} data-autofocus
      role="combobox" aria-label="Buscar arquivos" aria-expanded={open} aria-controls="pm-open-results"
      aria-activedescendant={visible[selected] ? `pm-open-result-${selected}` : undefined}
      placeholder="Buscar notas e anexos..." value={query} onChange={event => onQuery(event.target.value)}
      onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setSelected(i => Math.min(visible.length - 1, i + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setSelected(i => Math.max(0, i - 1)); }
        if (event.key === "Enter" && visible[selected]) { event.preventDefault(); choose(visible[selected]); }
      }} /><kbd>Esc</kbd></div>
    <div id="pm-open-results" role="listbox" aria-label="Resultados" className="pm-quick-open-results">
      {visible.map((entry, index) => <button key={`${entry.kind}:${entry.path}`} id={`pm-open-result-${index}`} type="button" role="option"
        aria-selected={index === selected} tabIndex={-1} onClick={() => choose(entry)}>
        {entry.kind === "note" ? <FileText size={18} /> : <File size={18} />}<span><strong>{entry.label || entry.path}</strong><small>{entry.path}</small></span>
      </button>)}
      {!visible.length && <p>Nenhum arquivo encontrado.</p>}
    </div>
    <footer>{entries.length > 80 ? `80 de ${entries.length} resultados. Refine a busca.` : `${entries.length} arquivo(s)`}<span>↑ ↓ navegar · Enter abrir</span></footer>
  </WorkspacePanel>;
}
