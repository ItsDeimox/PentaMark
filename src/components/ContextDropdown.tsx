import { ChevronsDownUp, ChevronsUpDown, CopyPlus, ExternalLink, Eye, FileImage, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Pencil, Sparkles, Trash2 } from "lucide-react";
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
}) {
  const { context } = props;
  return (
    <div className={`pm-context-menu ${context.type === "editor" ? "pm-format-menu" : ""}`} style={{ left: context.x / props.scale, top: context.y / props.scale }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
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
        <button onClick={() => props.onReveal("folder", context.path)}><ExternalLink size={14} />Abrir na pasta</button><span />
        <button className="danger" onClick={() => props.onDelete("folder", context.path)}><Trash2 size={14} />Excluir pasta</button>
      </> : context.type === "asset" ? <>
        <div className="pm-context-heading"><FileImage size={13} /><span>{baseName(context.path)}</span></div>
        <button onClick={() => props.onPreviewAsset(context.path)}><Eye size={14} />Visualizar asset</button>
        <button onClick={() => props.onReveal("asset", context.path)}><ExternalLink size={14} />Abrir na pasta</button><span />
        <button className="danger" onClick={() => props.onDelete("asset", context.path)}><Trash2 size={14} />Excluir asset</button>
      </> : <>
        <div className="pm-context-heading"><FileText size={13} /><span>{titleOf(context.path)}</span></div>
        <button onClick={() => props.onOpen(context.path)}><Eye size={14} />Abrir</button>
        <button onClick={() => props.onRename("note", context.path)}><Pencil size={14} />Renomear</button>
        <button onClick={() => props.onDuplicate(context.path)}><CopyPlus size={14} />Duplicar</button>
        <button onClick={() => props.onReveal("note", context.path)}><ExternalLink size={14} />Abrir na pasta</button><span />
        <button className="danger" onClick={() => props.onDelete("note", context.path)}><Trash2 size={14} />Excluir nota</button>
      </>}
    </div>
  );
}

