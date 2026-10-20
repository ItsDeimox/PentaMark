import { Bot, Check, ExternalLink, FolderOpen, Layers, LockKeyhole, Palette, RotateCcw, Settings, Square, Type } from 'lucide-react';
import { useId, useState, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_APPEARANCE } from '../../app/constants';
import type { Appearance, DesktopVaultInfo, HostConfig } from '../../domain/types';
import { DialogFrame, DialogSection } from './DialogFrame';
import { McpSettings } from './McpSettings';
import { exportAndroidVault, importAndroidDocuments, isAndroidLocal, isRemoteVault } from '../../platform/android';
import { RemoteConnectionPanel } from './RemoteConnectionPanel';
import { GraphicsSettings } from '../../features/workspace/GraphicsSettings';

const THEMES = [
  { id:'pentagory', name:'PentaMark', color:'#79d2dc' },
  { id:'eclipse', name:'Eclipse', color:'#b5a1e7' },
  { id:'ember', name:'Ember', color:'#e8b087' },
  { id:'terminal', name:'Terminal', color:'#9dd0aa' },
  { id:'pearl', name:'Pérola', color:'#35788c' },
] as const;
const TABS = [
  { id:'appearance', label:'Aparência', icon:Palette },
  { id:'graphics', label:'Gráficos', icon:Layers },
  { id:'type', label:'Tipografia', icon:Type },
  { id:'vault', label:'Cofre e host', icon:FolderOpen },
  { id:'connection', label:'Conectar ao PC', icon:ExternalLink },
  { id:'mcp', label:'MCP', icon:Bot },
] as const;
const FONT_OPTIONS = [['technical','Técnica · PentaMark'],['modern','Moderna'],['rounded','Arredondada'],['mono','Monoespaçada'],['serif','Serifada'],['custom','Personalizada']];
export function SettingsModal(p: {
  initialTab?: string;
  appearance: Appearance; setAppearance: Dispatch<SetStateAction<Appearance>>;
  config: HostConfig; urls: string[]; desktopVault: DesktopVaultInfo | null;
  onChooseVault: () => void; onShowVault: () => void; onClose: () => void;
  onSave: (draft: HostConfig, baseline: HostConfig) => Promise<void>; onNotify: (message: string) => void;
}) {
  const [initialAppearance] = useState(p.appearance), [baseline] = useState(p.config), [draft, setDraft] = useState(p.config);
  const [tab, setTab] = useState<string>(p.initialTab || 'appearance');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [transferring, setTransferring] = useState(false);
  const tabs = TABS.filter(item => isAndroidLocal ? item.id !== 'mcp' : item.id !== 'connection');
  const transfer = async (mode: 'import' | 'export') => {
    if (transferring) return;
    setTransferring(true); setError('');
    try {
      const result = mode === 'import' ? await importAndroidDocuments() : await exportAndroidVault();
      if (!result.cancelled) p.onNotify(mode === 'import' ? 'Arquivos importados para o aparelho.' : 'Cópia do cofre exportada.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível transferir os arquivos.'); }
    finally { setTransferring(false); }
  };
  const id = useId();
  const appearance = (patch: Partial<Appearance>) => p.setAppearance(current => ({ ...current, ...patch }));
  const config = (patch: Partial<HostConfig>) => setDraft(current => ({ ...current, ...patch }));
  const close = () => { if (saving) return; p.setAppearance(initialAppearance); p.onClose(); };
  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try { await p.onSave(draft, baseline); p.onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); } finally { setSaving(false); }
  };
  const navigation = <nav className="pm-preferences-nav" aria-label="Categorias das configurações"><span>PREFERÊNCIAS</span><div role="tablist" aria-label="Categorias das configurações" onKeyDown={event => {
    if (!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex(t => t.id === tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index + (['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next].id);
    document.getElementById(`${id}-${tabs[next].id}`)?.focus();
  }}>{tabs.map(({id:key,label,icon:Icon}) => <button type="button" id={`${id}-${key}`} key={key} role="tab" aria-selected={tab===key}
    aria-controls={`${id}-content`} tabIndex={tab===key ? 0 : -1} onClick={() => setTab(key)}><Icon size={17}/><span>{isAndroidLocal && key === 'vault' ? 'Arquivos locais' : label}</span></button>)}</div></nav>;
  return <DialogFrame title="Configurações" icon={Settings} className="pm-settings-dialog" navigation={navigation} onClose={close} onSubmit={() => void save()}
    footer={<><button type="button" className="pm-text-action" disabled={saving} onClick={() => p.setAppearance({ ...DEFAULT_APPEARANCE })}><RotateCcw size={14}/><span>Restaurar visual</span></button><span className="pm-footer-spacer"/><button type="button" className="secondary" disabled={saving} onClick={close}>Cancelar</button><button type="submit" className="primary" disabled={saving}><Check size={15}/>{saving ? 'Salvando…' : 'Salvar configurações'}</button></>}>
    <div role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-${tab}`} className="pm-preference-page" key={tab}>
      {tab==='appearance' && <>
        <DialogSection title="Identidade visual">
          <div className="pm-theme-options">{THEMES.map(theme => <button type="button" key={theme.id} aria-pressed={p.appearance.theme===theme.id} onClick={() => appearance({theme:theme.id})} style={{'--pm-swatch':theme.color} as React.CSSProperties}><i/><span>{theme.name}</span>{p.appearance.theme===theme.id && <Check size={13}/>}</button>)}</div>
        </DialogSection>
      </>}
      {tab==='graphics' && <GraphicsSettings appearance={p.appearance} setAppearance={p.setAppearance}/>}
      {tab==='type' && <>
        <DialogSection title="Fontes"><div className="pm-field-grid">
          <label className="pm-field">Fonte da interface<select aria-label="Fonte da interface" value={p.appearance.uiFont} onChange={e => appearance({uiFont:e.target.value})}>{FONT_OPTIONS.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="pm-field">Fonte do editor<select aria-label="Fonte do editor" value={p.appearance.editorFont} onChange={e => appearance({editorFont:e.target.value})}>{FONT_OPTIONS.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          {p.appearance.uiFont==='custom' && <label className="pm-field wide">Fonte instalada da interface<input value={p.appearance.customUiFont} onChange={e => appearance({customUiFont:e.target.value})}/></label>}
          {p.appearance.editorFont==='custom' && <label className="pm-field wide">Fonte instalada do editor<input value={p.appearance.customEditorFont} onChange={e => appearance({customEditorFont:e.target.value})}/></label>}
        </div></DialogSection>
        <DialogSection title="Escala e leitura">
          <label className="pm-range-field"><span>Escala do app<output>{Math.round(p.appearance.appScale*100)}%</output></span><input aria-label="Escala do app" type="range" min="0.8" max="1.6" step="0.05" value={p.appearance.appScale} onChange={e => appearance({appScale:Number(e.target.value)})}/></label>
          <label className="pm-range-field"><span>Tamanho da interface<output>{p.appearance.uiSize}px</output></span><input aria-label="Tamanho da interface" type="range" min="10" max="20" value={p.appearance.uiSize} onChange={e => appearance({uiSize:Number(e.target.value)})}/></label>
          <label className="pm-range-field"><span>Tamanho do editor<output>{p.appearance.editorSize}px</output></span><input aria-label="Tamanho do editor" type="range" min="11" max="32" value={p.appearance.editorSize} onChange={e => appearance({editorSize:Number(e.target.value)})}/></label>
        </DialogSection>
      </>}
      {tab==='vault' && <>
        {isAndroidLocal && isRemoteVault ? <RemoteConnectionPanel/> : isAndroidLocal ? <DialogSection title="Cofre neste aparelho" hint="Notas Markdown e anexos ficam salvos no armazenamento privado do PentaMark, sem internet e sem computador.">
          <div className="pm-inline-actions"><button type="button" disabled={transferring} onClick={() => void transfer('import')}>Importar arquivos</button><button type="button" disabled={transferring} onClick={() => void transfer('export')}>Exportar cofre (ZIP)</button></div>
          <p className="pm-notice">Exporte uma cópia antes de desinstalar ou limpar os dados do aplicativo. Importar copia os arquivos, sem alterar os originais. Anexos: até 32 MB por arquivo.</p>
          <p className="pm-notice">Para acessar outro cofre sem misturar seus arquivos, use a aba Conectar ao PC.</p>
        </DialogSection> : <>
        <DialogSection title="Diretório do cofre">
          {p.desktopVault ? <div className="pm-vault-location"><FolderOpen size={21}/><div><strong>{p.desktopVault.name}</strong><code>{p.desktopVault.path}</code></div><div className="pm-inline-actions"><button type="button" onClick={p.onShowVault}><ExternalLink size={14}/>Mostrar diretório</button><button type="button" onClick={p.onChooseVault}>Abrir outro cofre</button></div></div>
            : <div className="pm-notice"><FolderOpen size={17}/><span>A troca de diretório está disponível no aplicativo Desktop do host.</span></div>}
        </DialogSection>
        <DialogSection title="Host local" hint="As opções de rede e inicialização podem exigir reiniciar o host.">
          {p.config.isHost ? <div className="pm-field-grid">
            <label className="pm-field wide">Nome do cofre<input value={draft.vaultName} maxLength={80} onChange={e => config({vaultName:e.target.value})}/></label>
            <label className="pm-field">Porta<input type="number" min="1024" max="65535" value={draft.port} onChange={e => config({port:Number(e.target.value)})}/></label>
            <label className="pm-field">Upload máximo (MB)<input type="number" min="1" max="16384" value={draft.maxUploadMB} onChange={e => config({maxUploadMB:Number(e.target.value)})}/></label>
            {([['openBrowser','Abrir navegador ao iniciar','Abre a interface quando o host é iniciado.'],['lockEditedNotes','Bloquear edição simultânea','O primeiro editor recebe a trava; os demais entram em modo leitura.'],['cleanupUnusedAssets','Limpar assets sem uso','Após salvar, anexos sem referências vão para .trash/unused-assets.']] as const).map(([key,label,hint]) => <label key={key} className="pm-option-row wide"><span><strong>{label}</strong><small>{hint}</small></span><input role="switch" type="checkbox" checked={draft[key]} onChange={e => config({[key]:e.target.checked})}/></label>)}
          </div> : <div className="pm-notice"><LockKeyhole size={17}/><span>Estas opções só podem ser alteradas no host deste cofre.</span></div>}
        </DialogSection>
        </>}
      </>}
      {tab==='connection' && isAndroidLocal && <RemoteConnectionPanel/>}
      {tab==='mcp' && !isAndroidLocal && <McpSettings draft={draft} saved={p.config} onChange={config} urls={p.urls} onNotify={p.onNotify}/>}
    </div>
    {error && <p role="alert" className="pm-form-error">{error}</p>}
  </DialogFrame>;
}
