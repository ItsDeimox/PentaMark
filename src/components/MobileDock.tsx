import { Eye, FilePlus2, FolderOpen, Sparkles } from "lucide-react";
import type { ViewMode } from "../domain/types";

export function MobileDock(props: {
  mode: ViewMode;
  onFiles: () => void;
  onLive: () => void;
  onPreview: () => void;
  onNewNote: () => void;
}) {
  return <nav className="pm-mobile-dock" aria-label="Ações do celular">
    <button type="button" onClick={props.onFiles}><FolderOpen size={19} /><span>Arquivos</span></button>
    <button type="button" className={props.mode === "live" || props.mode === "edit" || props.mode === "split" ? "active" : ""} onClick={props.onLive}><Sparkles size={19} /><span>Escrever</span></button>
    <button type="button" className={props.mode === "preview" ? "active" : ""} onClick={props.onPreview}><Eye size={19} /><span>Ler</span></button>
    <button type="button" onClick={props.onNewNote}><FilePlus2 size={19} /><span>Nova</span></button>
  </nav>;
}
