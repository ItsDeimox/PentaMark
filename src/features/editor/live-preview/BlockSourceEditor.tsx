import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Code2 } from 'lucide-react';
import { WorkspacePanel } from '../../workspace/WorkspacePanel';

export type BlockEditRequest = {
  from: number; to: number; source: string; document: string; path: string;
};

/** Source editing lives outside the measured document. No placeholder heights. */
export function BlockSourceEditor({ request, readOnly, onApply, onClose }: {
  request: BlockEditRequest | null; readOnly: boolean;
  onApply: (request: BlockEditRequest, source: string) => string | null;
  onClose: () => void;
}) {
  const previous = useRef(request);
  const [source, setSource] = useState(request?.source || '');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!request) return;
    previous.current = request;
    setSource(request.source);
    setError('');
  }, [request]);
  const current = request || previous.current;
  const close = () => {
    if (current && source !== current.source && !confirm('Descartar as alterações deste bloco?')) return;
    onClose();
  };
  const apply = () => {
    if (!request || readOnly) return;
    const result = onApply(request, source);
    if (result) setError(result);
    else onClose();
  };
  return createPortal(<WorkspacePanel open={!!request} title="Editar bloco" onClose={close} modal className="pm-block-source-panel">
    <div className="pm-block-source-caption"><Code2 size={16} /><span>Markdown do bloco</span><small>{current?.path.split('/').pop()}</small></div>
    <textarea data-autofocus aria-label="Fonte Markdown do bloco" value={source} readOnly={readOnly}
      spellCheck={false} onChange={event => setSource(event.target.value)}
      onKeyDown={event => { if (event.key !== 'Tab') event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); apply(); } }} />
    {error && <p role="alert" className="pm-block-source-error">{error}</p>}
    <footer className="pm-block-source-actions"><span>Ctrl + Enter para aplicar</span><button onClick={close}>Cancelar</button><button className="primary" disabled={readOnly} onClick={apply}><Check size={15} />Aplicar</button></footer>
  </WorkspacePanel>, document.querySelector(".pm-shell") || document.body);
}
