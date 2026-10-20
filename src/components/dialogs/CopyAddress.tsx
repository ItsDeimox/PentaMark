import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../shared/client';

export function CopyAddress({ value, display = value, label, disabled = false, onNotify }: {
  value: string; display?: string; label: string; disabled?: boolean; onNotify: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  return <button type="button" className="pm-copy-address" disabled={disabled} aria-label={`Copiar ${label}`} onClick={async () => {
    try {
      await copyText(value);
      if (!mounted.current) return;
      setCopied(true); clearTimeout(timer.current); timer.current = window.setTimeout(() => setCopied(false), 1600);
      onNotify('Endereço copiado');
    } catch { onNotify('Não foi possível copiar o endereço.'); }
  }}><span><small>{label}</small><code>{display}</code></span>{copied ? <Check size={16}/> : <Copy size={16}/>}<span className="pm-copy-feedback" aria-live="polite">{copied ? 'Copiado' : ''}</span></button>;
}
