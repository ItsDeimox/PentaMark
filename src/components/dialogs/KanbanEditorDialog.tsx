import { DialogFrame } from './DialogFrame';
import { Bold, Check, Code2, Italic, LayoutDashboard, Link, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KanbanDialogState } from "../../domain/types";
import { formatSelectionValue } from "../../features/editor/formatting";

export function KanbanEditorDialog(props: { dialog: KanbanDialogState; onClose: () => void }) {
  const [value, setValue] = useState(props.dialog.value);
  const [task, setTask] = useState(Boolean(props.dialog.task));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const frame = requestAnimationFrame(() => inputRef.current?.select()); return () => cancelAnimationFrame(frame); }, []);
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
  return <DialogFrame title={props.dialog.title} subtitle={props.dialog.kind === 'card' ? 'Markdown no cartão. Enter conclui; Shift + Enter quebra a linha.' : 'O título identifica esta lista no quadro.'} icon={LayoutDashboard} onClose={props.onClose} className="pm-kanban-editor" onSubmit={save}
    footer={<><span className="pm-footer-spacer"/><button type="button" className="secondary" onClick={props.onClose}>Cancelar</button><button type="submit" className="primary" disabled={!value.trim()}><Check size={15}/>Concluir</button></>}>
    {props.dialog.kind === "card" && <div className="pm-card-format"><button type="button" aria-label="Negrito" onClick={() => format("bold")}><Bold size={14} /></button><button type="button" aria-label="Itálico" onClick={() => format("italic")}><Italic size={14} /></button><button type="button" aria-label="Código" onClick={() => format("code")}><Code2 size={14} /></button><button type="button" aria-label="Link" onClick={() => format("link")}><Link size={14} /></button></div>}
    <textarea data-autofocus aria-label="Conteúdo do cartão ou lista" ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); save(); } }} spellCheck />
    {props.dialog.kind === "card" && <label className="pm-check-row"><input type="checkbox" checked={task} onChange={(event) => setTask(event.target.checked)} />Cartão com checkbox</label>}
  </DialogFrame>;
}
