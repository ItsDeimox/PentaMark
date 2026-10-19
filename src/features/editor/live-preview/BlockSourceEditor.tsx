import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Code2 } from 'lucide-react';
import { DialogFrame, DialogPresence } from '../../../components/dialogs/DialogFrame';
import { useConfirmation } from '../../../components/dialogs/Confirmation';

export type BlockEditRequest = {
  from: number; to: number; source: string; document: string; path: string;
};
export function BlockSourceEditor({ request, readOnly, onApply, onClose }: {
  request: BlockEditRequest | null; readOnly: boolean;
  onApply: (request: BlockEditRequest, source: string) => string | null;
  onClose: () => void;
}) {
  const previous = useRef(request);
  const confirmation = useConfirmation();
  const closing = useRef(false);
  const [source, setSource] = useState(request?.source || '');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!request) return;
    previous.current = request;
    setSource(request.source);
    setError('');
  }, [request]);
  const current = request || previous.current;
  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      if (current && source !== current.source && !await confirmation({ title: 'Descartar alterações', message: 'As alterações deste bloco ainda não foram aplicadas. Descartar e fechar o editor?', accept: 'Descartar', danger: true })) return;
      onClose();
    } finally { closing.current = false; }
  };
  const apply = () => {
    if (!request || readOnly) return;
    const result = onApply(request, source);
    if (result) setError(result);
    else onClose();
  };
  return createPortal(<DialogPresence open={!!request}><DialogFrame title="Editar bloco" subtitle={current?.path || 'Markdown do bloco'} icon={Code2} onClose={() => void close()} className="pm-block-source-dialog"
    footer={<><span className="pm-footer-hint">Ctrl + Enter para aplicar</span><button type="button" className="secondary" onClick={() => void close()}>Cancelar</button><button type="button" className="primary" disabled={readOnly} onClick={apply}><Check size={15}/>Aplicar</button></>}>
    <label className="pm-field">Markdown do bloco<textarea data-autofocus aria-label="Fonte Markdown do bloco" value={source} readOnly={readOnly}
      spellCheck={false} onChange={event => setSource(event.target.value)}
      onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); apply(); } }}/></label>
    {error && <p role="alert" className="pm-form-error">{error}</p>}
  </DialogFrame></DialogPresence>, document.querySelector('.pm-shell') || document.body);
}
