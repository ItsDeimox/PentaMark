import { useState, type ComponentType } from 'react';
import { ArrowLeft, ArrowRight, ArrowRightLeft, Check, ChevronDown, Code2, Columns2, CopyPlus, ExternalLink,
  Eye, FilePlus2, FolderOpen, ImagePlus, LogIn, Pencil, Settings, Share2, Smartphone, Sparkles, Trash2,
  Bot, UserCircle, Users, ZoomIn, ZoomOut, Square, Layers } from 'lucide-react';
import { FORMAT_ACTIONS } from '../../app/constants';
import type { FormatKind, ViewMode, GraphicsMode } from '../../domain/types';
import { WorkspacePanel } from './WorkspacePanel';
import { isAndroidLocal } from '../../platform/android';

type Action = { label: string; icon: ComponentType<{size?:number}>; run: () => void; disabled?: boolean; danger?: boolean };
export function ToolsPanel(p: {
  open: boolean; onClose: () => void; mode: ViewMode; onMode: (mode: ViewMode) => void;
  graphics: GraphicsMode; onGraphics: (mode: GraphicsMode) => void;
  onFormat: (kind: FormatKind) => void; onUpload: (files: FileList) => void; canEdit: boolean;
  onZoom: (direction: number) => void; editorSize: number; syncScroll: boolean; onSync: () => void;
  hasNote: boolean; canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void;
  onNew: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void;
  onReveal: () => void; onVault: () => void; onShare: () => void; onClients: () => void;
  onConnect: () => void; onMobile: () => void; onProfile: () => void; onSettings: () => void;
  onMcp: () => void; mcpEnabled: boolean; clients: number; saved: boolean;
}) {
  const [fileActions, setFileActions] = useState(false);
  const [formats, setFormats] = useState(false);
  const modes: Array<{ id: ViewMode; label: string; name: string; icon: Action['icon'] }> = [
    { id:'live', label:'Live', name:'Live Preview', icon:Sparkles },
    { id:'edit', label:'Código', name:'Editor Markdown', icon:Code2 },
    { id:'preview', label:'Leitura', name:'Somente leitura', icon:Eye },
    { id:'split', label:'Dividido', name:'Editor + visualização', icon:Columns2 },
  ];
  const action = ({label,icon:Icon,run,disabled,danger}: Action) => <button key={label} className={`pm-tool-action ${danger?'danger':''}`} data-tooltip={label} disabled={disabled}
    onClick={run}><Icon size={16}/><span>{label}</span></button>;
  const leave = (run:()=>void) => () => { p.onClose(); run(); };
  return <WorkspacePanel open={p.open} title="Ferramentas e ações" onClose={p.onClose} className="pm-workspace-tools">
    {!isAndroidLocal && <button type="button" className="pm-tool-mcp" aria-label="Ponte MCP" data-tooltip="Ponte MCP" onClick={leave(p.onMcp)}><Bot size={19}/><span><strong>Ponte MCP</strong><small>Conectar ferramentas de IA</small></span><i data-active={p.mcpEnabled}/></button>}
    <section className="pm-tool-section"><div className="pm-section-label"><span>VISUALIZAÇÃO</span><span className="pm-tool-saved"><Check size={11}/>{p.saved?'Salvo':'Alterado'}</span></div>
      <div className="pm-mode-grid">{modes.map(({id,label,name,icon:Icon}) => <button key={id} aria-label={name} data-tooltip={name}
        aria-pressed={p.mode===id} onClick={()=>p.onMode(id)}><Icon size={17}/><span>{label}</span></button>)}</div>
    </section>
    <section className="pm-tool-section"><div className="pm-section-label">GRÁFICOS</div>
      <div className="pm-material-switch" role="group" aria-label="Modo gráfico">
        <button aria-pressed={p.graphics==='flat'} onClick={()=>p.onGraphics('flat')}><Square size={16}/>Flat</button>
        <button aria-pressed={p.graphics==='acrylic'} onClick={()=>p.onGraphics('acrylic')}><Layers size={16}/>Acrílico</button>
      </div>
    </section>
    <section className="pm-tool-section"><div className="pm-section-label"><span>DOCUMENTO</span><span className="pm-history-controls">
      <button aria-label="Voltar" disabled={!p.canBack} onClick={p.onBack}><ArrowLeft size={14}/></button>
      <button aria-label="Avançar" disabled={!p.canForward} onClick={p.onForward}><ArrowRight size={14}/></button></span></div>
      <div className="pm-tools-format" role="toolbar" aria-label="Formatação" onMouseDown={e=>e.preventDefault()}>
        {FORMAT_ACTIONS.slice(0, formats?FORMAT_ACTIONS.length:5).map(({kind,label,shortcut,icon:Icon})=><button key={kind} disabled={!p.canEdit} aria-label={label} data-tooltip={label} data-shortcut={shortcut} onClick={()=>p.onFormat(kind)}><Icon size={16}/></button>)}
        <button aria-label="Todos os formatos" data-tooltip="Mais formatos" aria-expanded={formats} onClick={()=>setFormats(v=>!v)}><ChevronDown size={15}/></button>
        <label data-tooltip="Anexar arquivos"><ImagePlus size={16}/><input aria-label="Anexar arquivos" type="file" multiple disabled={!p.canEdit} onChange={e=>{if(e.target.files)p.onUpload(e.target.files);e.target.value='';}}/></label>
      </div>
      <div className="pm-tool-zoom"><span>Texto</span><button aria-label="Diminuir zoom do editor" data-tooltip="Diminuir zoom" onClick={()=>p.onZoom(-1)}><ZoomOut size={15}/></button><output>{p.editorSize}px</output><button aria-label="Aumentar zoom do editor" data-tooltip="Aumentar zoom" onClick={()=>p.onZoom(1)}><ZoomIn size={15}/></button><button aria-label="Sincronizar rolagem" data-tooltip="Sincronizar rolagem" aria-pressed={p.syncScroll} title="Sincronizar rolagem" onClick={p.onSync}><ArrowRightLeft size={15}/></button></div>
      {!isAndroidLocal && action({label:'Mostrar no diretório',icon:ExternalLink,run:leave(p.onReveal),disabled:!p.hasNote})}
      <button className="pm-tool-action" aria-label="Mais ações" data-tooltip="Ações do arquivo" aria-expanded={fileActions} onClick={()=>setFileActions(v=>!v)}><FolderOpen size={16}/><span>Arquivo e cofre</span><ChevronDown size={14}/></button>
      {fileActions && <div className="pm-tool-file-actions">{[
        {label:'Nova nota',icon:FilePlus2,run:leave(p.onNew)},
        {label:'Renomear',icon:Pencil,run:leave(p.onRename),disabled:!p.hasNote},
        {label:'Duplicar',icon:CopyPlus,run:leave(p.onDuplicate),disabled:!p.hasNote},
        {label:isAndroidLocal?'Importar / exportar arquivos':'Abrir outro cofre',icon:FolderOpen,run:leave(p.onVault)},
        {label:'Excluir nota',icon:Trash2,run:leave(p.onDelete),disabled:!p.hasNote,danger:true},
      ].map(action)}</div>}
    </section>
    {!isAndroidLocal && <section className="pm-tool-section pm-tool-collaboration"><div className="pm-section-label">CONEXÕES</div>
      {[
        {label:'Compartilhar',icon:Share2,run:leave(p.onShare)},
        {label:`${p.clients} conectado${p.clients===1?'':'s'}`,icon:Users,run:leave(p.onClients)},
        {label:'Conectar a um cofre',icon:LogIn,run:leave(p.onConnect)},
        {label:'Celular e acesso remoto',icon:Smartphone,run:leave(p.onMobile)},
      ].map(action)}
    </section>}
    {isAndroidLocal && <section className="pm-tool-section pm-tool-collaboration"><div className="pm-section-label">CONEXÃO COM O PC</div>{action({label:'Conectar ao PC · Tailscale',icon:LogIn,run:leave(p.onConnect)})}</section>}
    <footer className="pm-tool-footer">{action({label:'Conta',icon:UserCircle,run:leave(p.onProfile)})}{action({label:'Configurações',icon:Settings,run:leave(p.onSettings)})}</footer>
  </WorkspacePanel>;
}
