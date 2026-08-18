import { ArrowRightLeft, Bot, Check, Copy, ExternalLink, FolderOpen, Lock, Palette, RotateCcw, Server, Settings, Type, X } from "lucide-react";
import React from "react";
import { DEFAULT_APPEARANCE } from "../../app/constants";
import type { Appearance, DesktopVaultInfo, HostConfig } from "../../domain/types";
import { connectionLabel, copyText } from "../../shared/client";

export function SettingsModal(props: {
  appearance: Appearance;
  setAppearance: React.Dispatch<React.SetStateAction<Appearance>>;
  config: HostConfig;
  setConfig: React.Dispatch<React.SetStateAction<HostConfig>>;
  urls: string[];
  desktopVault: DesktopVaultInfo | null;
  onChooseVault: () => void;
  onShowVault: () => void;
  onClose: () => void;
  onSave: () => void;
  onNotify: (message: string) => void;
}) {
  const themes: Array<{ id: Appearance["theme"]; name: string; color: string }> = [
    { id: "pentagory", name: "PentaMark", color: "#67e7ef" },
    { id: "eclipse", name: "Eclipse", color: "#a78bfa" },
    { id: "ember", name: "Ember", color: "#f0a35e" },
    { id: "terminal", name: "Terminal", color: "#73dc8c" },
  ];
  return <div className="pm-modal-backdrop" onMouseDown={props.onClose}><div className="pm-modal pm-settings-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button className="pm-modal-close" onClick={props.onClose}><X size={17} /></button>
    <div className="pm-settings-heading"><div className="pm-modal-icon"><Settings size={21} /></div><div><h2>Configurações</h2><p>Aparência local e opções do host</p></div></div>
    <div className="pm-settings-scroll">
      <section className="pm-settings-section"><h3><Palette size={15} />Tema</h3><div className="pm-theme-grid">
        {themes.map((theme) => <button key={theme.id} className={props.appearance.theme === theme.id ? "active" : ""} onClick={() => props.setAppearance((current) => ({ ...current, theme: theme.id }))}><span style={{ background: theme.color }} /><strong>{theme.name}</strong></button>)}
      </div></section>
      <section className="pm-settings-section"><h3><Type size={15} />Fontes</h3><div className="pm-settings-grid">
        <label>Interface<select value={props.appearance.uiFont} onChange={(event) => props.setAppearance((current) => ({ ...current, uiFont: event.target.value }))}><option value="modern">Moderna</option><option value="rounded">Arredondada</option><option value="mono">Monoespaçada</option><option value="serif">Serifada</option><option value="custom">Personalizada</option></select></label>
        <label>Editor<select value={props.appearance.editorFont} onChange={(event) => props.setAppearance((current) => ({ ...current, editorFont: event.target.value }))}><option value="mono">Monoespaçada</option><option value="modern">Moderna</option><option value="rounded">Arredondada</option><option value="serif">Serifada</option><option value="custom">Personalizada</option></select></label>
        {props.appearance.uiFont === "custom" && <label className="wide">Fonte instalada da interface<input value={props.appearance.customUiFont} placeholder="Ex.: JetBrains Mono" onChange={(event) => props.setAppearance((current) => ({ ...current, customUiFont: event.target.value }))} /></label>}
        {props.appearance.editorFont === "custom" && <label className="wide">Fonte instalada do editor<input value={props.appearance.customEditorFont} placeholder="Ex.: Fira Code" onChange={(event) => props.setAppearance((current) => ({ ...current, customEditorFont: event.target.value }))} /></label>}
        <label className="wide">Escala do app: {Math.round(props.appearance.appScale * 100)}%<input type="range" min="0.8" max="1.6" step="0.05" value={props.appearance.appScale} onChange={(event) => props.setAppearance((current) => ({ ...current, appScale: Number(event.target.value) }))} /></label>
        <label>Tamanho da interface: {props.appearance.uiSize}px<input type="range" min="10" max="20" value={props.appearance.uiSize} onChange={(event) => props.setAppearance((current) => ({ ...current, uiSize: Number(event.target.value) }))} /></label>
        <label>Tamanho do editor: {props.appearance.editorSize}px<input type="range" min="11" max="32" value={props.appearance.editorSize} onChange={(event) => props.setAppearance((current) => ({ ...current, editorSize: Number(event.target.value) }))} /></label>
      </div><small className="pm-settings-hint">A fonte da interface agora é herdada por botões, menus, inputs, atalhos e modais. O editor usa a fonte escolhida logo ao lado.</small></section>
      <section className="pm-settings-section"><h3><FolderOpen size={15} />Cofre</h3>
        {props.desktopVault ? <div className="pm-vault-settings">
          <div><strong>{props.desktopVault.name}</strong><code title={props.desktopVault.path}>{props.desktopVault.path}</code></div>
          <div><button onClick={props.onShowVault}><ExternalLink size={14} />Explorer</button><button onClick={props.onChooseVault}><ArrowRightLeft size={14} />Abrir outro</button></div>
        </div> : <div className="pm-host-only-note"><FolderOpen size={15} /><span>A troca de diretório está disponível no PentaMark Desktop do computador host.</span></div>}
      </section>
      <section className="pm-settings-section"><h3><Server size={15} />Host local</h3>{props.config.isHost ? <div className="pm-settings-grid">
        <label className="wide">Nome do cofre<input value={props.config.vaultName} onChange={(event) => props.setConfig((current) => ({ ...current, vaultName: event.target.value }))} /></label>
        <label>Porta<input type="number" min="1024" max="65535" value={props.config.port} onChange={(event) => props.setConfig((current) => ({ ...current, port: Number(event.target.value) }))} /></label>
        <label>Upload máximo (MB)<input type="number" min="1" max="16384" value={props.config.maxUploadMB} onChange={(event) => props.setConfig((current) => ({ ...current, maxUploadMB: Number(event.target.value) }))} /></label>
        <label className="pm-check-row"><input type="checkbox" checked={props.config.openBrowser} onChange={(event) => props.setConfig((current) => ({ ...current, openBrowser: event.target.checked }))} />Abrir navegador ao iniciar</label>
        <label className="pm-check-row wide"><input type="checkbox" checked={props.config.lockEditedNotes} onChange={(event) => props.setConfig((current) => ({ ...current, lockEditedNotes: event.target.checked }))} /><span><strong>Bloquear edição simultânea</strong><small>O primeiro usuário no arquivo recebe a trava; os demais entram em modo leitura.</small></span></label>
        <label className="pm-check-row wide"><input type="checkbox" checked={props.config.cleanupUnusedAssets} onChange={(event) => props.setConfig((current) => ({ ...current, cleanupUnusedAssets: event.target.checked }))} /><span><strong>Limpar assets sem uso</strong><small>Após salvar uma nota, imagens, áudios, vídeos e PDFs sem nenhuma referência vão para .trash/unused-assets. Desativado por padrão.</small></span></label>
      </div> : <div className="pm-host-only-note"><Lock size={15} /><span>Estas opções só podem ser alteradas no computador que está hospedando o cofre.</span></div>}</section>
      <section className="pm-settings-section"><h3><Bot size={15} />Ponte IA · Codex / MCP</h3>{props.config.isHost ? <div className="pm-ai-settings">
        <label className="pm-check-row wide"><input type="checkbox" checked={props.config.aiBridgeEnabled} onChange={(event) => props.setConfig((current) => ({ ...current, aiBridgeEnabled: event.target.checked }))} /><span><strong>Permitir acesso da IA ao cofre</strong><small>Expõe ferramentas MCP de busca, leitura, edição, movimentação e lixeira pela rede do PentaMark.</small></span></label>
        <div className="pm-ai-token"><label>Token da ponte<input value={props.config.aiBridgeToken} onChange={(event) => props.setConfig((current) => ({ ...current, aiBridgeToken: event.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128) }))} spellCheck={false} /></label><button onClick={() => { const bytes = crypto.getRandomValues(new Uint8Array(18)); props.setConfig((current) => ({ ...current, aiBridgeToken: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("") })); }}><RotateCcw size={13} />Gerar</button></div>
        <div className="pm-ai-urls">{props.urls.map((url) => { const mcpUrl = `${url}/mcp?token=${props.config.aiBridgeToken}`; return <button key={url} disabled={!props.config.aiBridgeEnabled} onClick={() => void copyText(mcpUrl).then(() => props.onNotify("URL MCP copiada")).catch((error) => props.onNotify(error instanceof Error ? error.message : "Não deu para copiar"))}><Copy size={13} /><code>{mcpUrl}</code><span>{connectionLabel(url)}</span></button>; })}</div>
        <p><strong>No Codex:</strong> Configurações → MCP servers → Add server → Streamable HTTP. Cole a URL acima e reinicie o Codex. Ele usará a conta já conectada do seu amigo; o PentaMark não cobra nem precisa de chave da API.</p>
      </div> : <div className="pm-host-only-note"><Bot size={15} /><span>{props.config.aiBridgeEnabled ? "A Ponte IA está habilitada. Peça ao host a URL MCP com token." : "A Ponte IA está desabilitada pelo host deste cofre."}</span></div>}</section>
    </div>
    <div className="pm-settings-actions"><button className="secondary" onClick={() => props.setAppearance(DEFAULT_APPEARANCE)}><RotateCcw size={14} />Restaurar visual</button><button className="primary" onClick={props.onSave}><Check size={14} />Salvar configurações</button></div>
  </div></div>;
}
