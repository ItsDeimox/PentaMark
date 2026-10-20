import { DialogFrame } from './DialogFrame';
import { Check, GitCompareArrows, X } from "lucide-react";
import { diffLines } from "diff";
import { useEffect, useMemo, useState } from "react";
import type { ConflictData } from "../../domain/types";

export function ConflictModal(props: { conflict: ConflictData; onClose: () => void; onUseServer: () => void; onResolve: (content: string) => void }) {
  const [merged, setMerged] = useState(props.conflict.localContent);
  useEffect(() => setMerged(props.conflict.localContent), [props.conflict]);
  const changes = useMemo(() => diffLines(props.conflict.remoteContent, props.conflict.localContent), [props.conflict.localContent, props.conflict.remoteContent]);
  const added = changes.filter((part) => part.added).reduce((total, part) => total + (part.count || 0), 0);
  const removed = changes.filter((part) => part.removed).reduce((total, part) => total + (part.count || 0), 0);

  return <DialogFrame title="Conflito de edição" subtitle={props.conflict.path} icon={GitCompareArrows} onClose={props.onClose} className="pm-conflict-dialog"
    footer={<><button type="button" className="secondary" onClick={props.onUseServer}>Usar servidor</button><button type="button" className="secondary" onClick={() => props.onResolve(props.conflict.localContent)}>Manter minha versão</button><span className="pm-footer-spacer"/><button type="button" className="primary" onClick={() => props.onResolve(merged)}><Check size={14}/>Salvar mesclagem</button></>}>
    <div className="pm-conflict-summary"><strong>Revise antes de salvar</strong><span>+{added} adicionadas · −{removed} removidas</span></div>
    <div className="pm-diff-legend"><span className="server">SERVIDOR</span><span className="local">SUA VERSÃO</span><small>Linhas sem cor são iguais</small></div>
    <div className="pm-diff-view" role="region" aria-label="Diferenças do arquivo">{changes.flatMap((part, partIndex) => { const lines = part.value.split("\n"); if (lines.at(-1) === "") lines.pop(); return lines.map((line, lineIndex) => <div key={`${partIndex}-${lineIndex}`} className={part.added ? "added" : part.removed ? "removed" : "same"}><b>{part.added ? "+" : part.removed ? "−" : " "}</b><code>{line || " "}</code></div>); })}</div>
    <label className="pm-merge-editor"><span>RESULTADO DA MESCLAGEM</span><textarea aria-label="Resultado da mesclagem" value={merged} onChange={(event) => setMerged(event.target.value)} spellCheck={false} /></label>
  </DialogFrame>;
}
