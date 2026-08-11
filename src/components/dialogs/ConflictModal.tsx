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

  return <div className="pm-modal-backdrop" onMouseDown={props.onClose}><div className="pm-modal pm-conflict-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button className="pm-modal-close" onClick={props.onClose}><X size={17} /></button>
    <div className="pm-conflict-heading"><div className="pm-modal-icon"><GitCompareArrows size={21} /></div><div><h2>Conflito de edição</h2><p>{props.conflict.path}</p></div><div className="pm-diff-stats"><span>+{added}</span><span>-{removed}</span></div></div>
    <div className="pm-diff-legend"><span className="server">SERVIDOR</span><span className="local">SUA VERSÃO</span><small>Linhas sem cor são iguais</small></div>
    <div className="pm-diff-view" role="region" aria-label="Diferenças do arquivo">{changes.flatMap((part, partIndex) => { const lines = part.value.split("\n"); if (lines.at(-1) === "") lines.pop(); return lines.map((line, lineIndex) => <div key={`${partIndex}-${lineIndex}`} className={part.added ? "added" : part.removed ? "removed" : "same"}><b>{part.added ? "+" : part.removed ? "−" : " "}</b><code>{line || " "}</code></div>); })}</div>
    <label className="pm-merge-editor"><span>RESULTADO DA MESCLAGEM</span><textarea value={merged} onChange={(event) => setMerged(event.target.value)} spellCheck={false} /></label>
    <div className="pm-conflict-actions"><button className="secondary" onClick={props.onUseServer}>Usar servidor</button><button className="secondary local" onClick={() => props.onResolve(props.conflict.localContent)}>Manter minha versão</button><button className="primary" onClick={() => props.onResolve(merged)}><Check size={14} />Salvar mesclagem</button></div>
  </div></div>;
}

