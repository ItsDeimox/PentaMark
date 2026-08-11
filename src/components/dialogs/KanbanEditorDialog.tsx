import { Bold, Check, Code2, Italic, LayoutDashboard, Link, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KanbanDialogState } from "../../domain/types";
import { formatSelectionValue } from "../../features/editor/formatting";

export function KanbanEditorDialog(props: { dialog: KanbanDialogState; onClose: () => void }) {
  const [value, setValue] = useState(props.dialog.value);
  const [task, setTask] = useState(Boolean(props.dialog.task));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); }); }, []);
  const save = () => {
    if (!value.trim()) return;
    props.dialog.onSave(value.trim(), task);
    props.onClose();
  };
  const format = (kind: "bold" | "italic" | "code" | "link") => {
    const input = inputRef.current;
    if (!input) return;
    const result = formatSelectionValue(value, input.selectionStart, input.selectionEnd, kind);
    setValue(result.next);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(result.selectionStart, result.selectionEnd); });
  };
  return <div className="pm-modal-backdrop" onMouseDown={props.onClose}><form className="pm-modal pm-kanban-editor" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); save(); }}>
    <button type="button" className="pm-modal-close" onClick={props.onClose}><X size={17} /></button>
    <div className="pm-modal-icon"><LayoutDashboard size={21} /></div><h2>{props.dialog.title}</h2><p>{props.dialog.kind === "card" ? "Escreva o cartão com Markdown. Enter conclui; Shift+Enter quebra a linha." : "O título identifica esta lista no quadro."}</p>
    {props.dialog.kind === "card" && <div className="pm-card-format"><button type="button" onClick={() => format("bold")}><Bold size={14} /></button><button type="button" onClick={() => format("italic")}><Italic size={14} /></button><button type="button" onClick={() => format("code")}><Code2 size={14} /></button><button type="button" onClick={() => format("link")}><Link size={14} /></button></div>}
    <textarea ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); save(); } }} spellCheck />
    {props.dialog.kind === "card" && <label className="pm-check-row"><input type="checkbox" checked={task} onChange={(event) => setTask(event.target.checked)} />Cartão com checkbox</label>}
    <div className="pm-dialog-actions"><button type="button" className="secondary" onClick={props.onClose}>Cancelar</button><button type="submit" className="primary"><Check size={14} />Concluir</button></div>
  </form></div>;
}

