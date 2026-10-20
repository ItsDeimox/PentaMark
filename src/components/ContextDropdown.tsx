import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, ChevronRight, Copy, CopyPlus, ExternalLink, Eye, FileImage, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Pencil, Sparkles, Trash2 } from "lucide-react";
import { FORMAT_ACTIONS } from "../app/constants";
import type { ContextMenu, FormatKind, ItemKind, TreeItemKind } from "../domain/types";
import { baseName, titleOf } from "../shared/path";

export function ContextDropdown(props: {
  context: ContextMenu;
  scale: number;
  onClose: () => void;
  onFormat: (kind: FormatKind) => void;
  onBeginDraft: (kind: ItemKind, parent?: string) => void;
  onRename: (kind: ItemKind, path: string) => void;
  onDuplicate: (path: string) => void;
  onDelete: (kind: TreeItemKind, path: string) => void;
  onExpand: (open: boolean) => void;
  onOpen: (path: string) => void;
  onReveal: (kind: TreeItemKind, path: string) => void;
  onPreviewAsset: (path: string) => void;
  onChooseVault: () => void;
  onCopyPath: (kind: TreeItemKind, path: string, mode: "relative" | "absolute") => void;
  canCopyAbsolute: boolean;
}) {
  const { context } = props;
  const ref = useRef<HTMLDivElement>(null);
  const copyTrigger = useRef<HTMLButtonElement>(null);
  const [copyExpanded, setCopyExpanded] = useState(false);
  const [copyFlipped, setCopyFlipped] = useState(false);
  const [copyCompact, setCopyCompact] = useState(false);
  useEffect(() => { setCopyExpanded(false); }, [context.type, 'path' in context ? context.path : '']);
  const openCopy = () => {
    const rect = copyTrigger.current?.getBoundingClientRect();
    const rightFits = Boolean(rect && rect.right + 232 * props.scale < window.innerWidth - 8);
    const leftFits = Boolean(rect && rect.left - 232 * props.scale > 8);
    setCopyCompact(!rightFits && !leftFits);
    setCopyFlipped(!rightFits && leftFits);
    setCopyExpanded(true);
  };
  const copyPath = (kind: TreeItemKind, path: string) => <div className="pm-copy-path-host"
    data-flip={copyFlipped} data-compact={copyCompact} onMouseEnter={openCopy} onMouseLeave={() => setCopyExpanded(false)}>
    <button type="button" ref={copyTrigger} aria-haspopup="menu" aria-expanded={copyExpanded}
      onFocus={openCopy} onClick={() => setCopyExpanded(value => !value)}><Copy size={14}/>
      <span>Copiar caminho</span><ChevronRight size={13}/></button>
    {copyExpanded && <div role="menu" aria-label="Copiar caminho" className="pm-copy-path-submenu"
       onPointerDown={event => event.stopPropagation()}>
      <button type="button" role="menuitem" onClick={() => props.onCopyPath(kind,path,'relative')}><Copy size={14}/>Copiar caminho relativo</button>
      <button type="button" role="menuitem" disabled={!props.canCopyAbsolute} title={!props.canCopyAbsolute ? 'Disponível no aplicativo Desktop' : undefined}
        onClick={() => props.onCopyPath(kind,path,'absolute')}><Copy size={14}/>Copiar caminho absoluto</button>
    </div>}
  </div>;
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    const rect = element.getBoundingClientRect(), scale = Math.max(.1, props.scale);
    element.style.left = `${Math.max(8, Math.min(context.x, innerWidth - rect.width - 8)) / scale}px`;
    element.style.top = `${Math.max(8, Math.min(context.y, innerHeight - rect.height - 8)) / scale}px`;
  }, [context, props.scale]);
  return (
    <div ref={ref} onKeyDown={event => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (copyExpanded) { setCopyExpanded(false); copyTrigger.current?.focus(); }
        else props.onClose();
        return;
      }
      if (event.key === "ArrowRight" && document.activeElement === copyTrigger.current) {
        event.preventDefault(); openCopy();
        requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('.pm-copy-path-submenu button')?.focus());
        return;
      }
      if (event.key === "ArrowLeft" && copyExpanded && (event.target as HTMLElement).closest('.pm-copy-path-submenu')) {
        event.preventDefault(); setCopyExpanded(false); copyTrigger.current?.focus(); return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }} role="menu" aria-label="Ações do arquivo" className={`pm-context-menu ${context.type === "editor" ? "pm-format-menu" : ""}`} style={{ left: context.x / props.scale, top: context.y / props.scale }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      {context.type === "editor" ? <>
        <div className="pm-context-heading"><Sparkles size={13} /><span>ESTILIZAR</span><small>Markdown</small></div>
        {FORMAT_ACTIONS.map(({ kind, label, shortcut, icon: Icon }) => <button key={kind} onClick={() => props.onFormat(kind)}><Icon size={14} /><span>{label}</span><kbd>{shortcut}</kbd></button>)}
      </> : context.type === "blank" ? <>
        <button onClick={() => props.onBeginDraft("note")}><FilePlus2 size={14} />Nova nota</button>
        <button onClick={() => props.onBeginDraft("folder")}><FolderPlus size={14} />Nova pasta</button>
        <button onClick={props.onChooseVault}><FolderOpen size={14} />Abrir outro cofre</button><span />
        <button onClick={() => props.onExpand(true)}><ChevronsUpDown size={14} />Expandir tudo</button>
        <button onClick={() => props.onExpand(false)}><ChevronsDownUp size={14} />Recolher tudo</button>
      </> : context.type === "folder" ? <>
        <div className="pm-context-heading"><Folder size={13} /><span>{baseName(context.path)}</span></div>
        <button onClick={() => props.onBeginDraft("note", context.path)}><FilePlus2 size={14} />Nova nota aqui</button>
        <button onClick={() => props.onBeginDraft("folder", context.path)}><FolderPlus size={14} />Nova subpasta</button>
        <button onClick={() => props.onRename("folder", context.path)}><Pencil size={14} />Renomear</button>
        <button onClick={() => props.onReveal("folder", context.path)}><ExternalLink size={14} />Mostrar no diretório</button>
        {copyPath('folder',context.path)}<span />
        <button className="danger" onClick={() => props.onDelete("folder", context.path)}><Trash2 size={14} />Excluir pasta</button>
      </> : context.type === "asset" ? <>
        <div className="pm-context-heading"><FileImage size={13} /><span>{baseName(context.path)}</span></div>
        <button onClick={() => props.onPreviewAsset(context.path)}><Eye size={14} />Visualizar asset</button>
        <button onClick={() => props.onReveal("asset", context.path)}><ExternalLink size={14} />Mostrar no diretório</button>
        {copyPath('asset',context.path)}<span />
        <button className="danger" onClick={() => props.onDelete("asset", context.path)}><Trash2 size={14} />Excluir asset</button>
      </> : <>
        <div className="pm-context-heading"><FileText size={13} /><span>{titleOf(context.path)}</span></div>
        <button onClick={() => props.onOpen(context.path)}><Eye size={14} />Abrir</button>
        <button onClick={() => props.onRename("note", context.path)}><Pencil size={14} />Renomear</button>
        <button onClick={() => props.onDuplicate(context.path)}><CopyPlus size={14} />Duplicar</button>
        <button onClick={() => props.onReveal("note", context.path)}><ExternalLink size={14} />Mostrar no diretório</button>
        {copyPath('note',context.path)}<span />
        <button className="danger" onClick={() => props.onDelete("note", context.path)}><Trash2 size={14} />Excluir nota</button>
      </>}
    </div>
  );
}

