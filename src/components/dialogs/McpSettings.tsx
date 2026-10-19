import { useState } from 'react';
import { Bot, Check, Eye, EyeOff, KeyRound, LockKeyhole, RefreshCw } from 'lucide-react';
import type { HostConfig } from '../../domain/types';
import { connectionLabel } from '../../shared/client';
import { DialogFrame, DialogSection } from './DialogFrame';
import { CopyAddress } from './CopyAddress';

export function McpSettings({ draft, saved, onChange, urls, onNotify }: {
  draft: HostConfig; saved: HostConfig; onChange: (patch: Partial<HostConfig>) => void; urls: string[]; onNotify: (message: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  const dirty = draft.aiBridgeEnabled !== saved.aiBridgeEnabled || draft.aiBridgeToken !== saved.aiBridgeToken;
  return <>
    <div className="pm-connection-status"><span className="pm-status-indicator" data-active={saved.aiBridgeEnabled}/><div><strong>{saved.aiBridgeEnabled ? 'Ponte habilitada' : 'Ponte desabilitada'}</strong><small>{dirty ? 'Alterações pendentes de salvar' : 'Estado informado pelo host'}</small></div><span className="pm-protocol-label">Streamable HTTP</span></div>
    <DialogSection title="Acesso ao cofre" hint="Conecte um cliente MCP às ferramentas de busca, leitura e edição do PentaMark.">
      {saved.isHost ? <label className="pm-option-row"><span><strong>Permitir acesso da IA ao cofre</strong><small>A ponte também permite mover arquivos e enviá-los à lixeira.</small></span><input role="switch" type="checkbox" checked={draft.aiBridgeEnabled} onChange={event => onChange({ aiBridgeEnabled: event.target.checked })}/></label>
        : <div className="pm-notice"><LockKeyhole size={17}/><span>Somente o host pode configurar a ponte. Peça o endereço e o token ao responsável pelo cofre.</span></div>}
    </DialogSection>
    {saved.isHost && <>
      <DialogSection title="Credencial de conexão" hint="Compartilhe somente com clientes em que você confia. Um novo token invalida os endereços anteriores após salvar.">
        <label className="pm-field">Token da ponte<div className="pm-secret-field"><KeyRound size={16}/><input aria-label="Token da ponte" autoComplete="off" type={reveal ? 'text' : 'password'} value={draft.aiBridgeToken} spellCheck={false} onChange={event => onChange({ aiBridgeToken: event.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0,128) })}/><button type="button" aria-label={reveal ? 'Ocultar token' : 'Mostrar token'} aria-pressed={reveal} onClick={() => setReveal(value => !value)}>{reveal ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
        <button type="button" className="pm-text-action" onClick={() => onChange({ aiBridgeToken: Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2,'0')).join('') })}><RefreshCw size={14}/>Gerar novo token</button>
      </DialogSection>
      <DialogSection title="Endereços MCP" hint={dirty ? 'Salve as alterações antes de copiar a conexão.' : 'Copie um endereço para o seu cliente MCP. A credencial fica oculta nesta tela.'}>
        <div className="pm-addresses">{urls.map(url => <CopyAddress key={url} label={connectionLabel(url)}
          value={`${url.replace(/\/$/,'')}/mcp?token=${encodeURIComponent(saved.aiBridgeToken)}`} display={`${url.replace(/\/$/,'')}/mcp?token=••••••••`}
          disabled={!saved.aiBridgeEnabled || dirty} onNotify={onNotify}/>)}</div>
      </DialogSection>
    </>}
    <div className="pm-notice"><Bot size={17}/><span>Cadastre a conexão no seu cliente MCP usando o transporte HTTP. O cofre continua no host; abrir este painel não ativa a ponte.</span></div>
  </>;
}

export function McpModal(props: { config: HostConfig; urls: string[]; onClose: () => void; onSave: (draft: HostConfig, baseline: HostConfig) => Promise<void>; onNotify: (message: string) => void }) {
  const [baseline] = useState(props.config), [draft, setDraft] = useState(props.config);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try { await props.onSave(draft, baseline); props.onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); } finally { setSaving(false); }
  };
  return <DialogFrame title="Ponte MCP" subtitle="Seu cofre, conectado às ferramentas de IA." icon={Bot} className="pm-mcp-dialog" onClose={() => { if (!saving) props.onClose(); }} onSubmit={() => void save()}
    footer={<><span className="pm-footer-hint">{props.config.isHost ? 'Configuração do host' : 'Somente leitura'}</span><button type="button" className="secondary" onClick={props.onClose} disabled={saving}>Cancelar</button>{props.config.isHost && <button type="submit" className="primary" disabled={saving}><Check size={15}/>{saving ? 'Salvando…' : 'Salvar ponte'}</button>}</>}>
    <McpSettings draft={draft} saved={props.config} onChange={patch => setDraft(current => ({ ...current, ...patch }))} urls={props.urls} onNotify={props.onNotify}/>
    {error && <p role="alert" className="pm-form-error">{error}</p>}
  </DialogFrame>;
}
