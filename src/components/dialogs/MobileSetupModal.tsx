import { Check, Copy, Download, HardDrive, Server, ShieldCheck, Smartphone, X } from "lucide-react";
import { connectionLabel, copyText } from "../../shared/client";

export function MobileSetupModal(props: {
  urls: string[];
  canInstall: boolean;
  installed: boolean;
  onInstall: () => void;
  onClose: () => void;
  onNotify: (message: string) => void;
}) {
  const copy = async (value: string) => {
    try {
      await copyText(value);
      props.onNotify("Endereço copiado");
    } catch (error) {
      props.onNotify(error instanceof Error ? error.message : "Não deu para copiar");
    }
  };

  return <div className="pm-modal-backdrop" onMouseDown={props.onClose}><div className="pm-modal pm-mobile-setup-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="pm-modal-close" aria-label="Fechar configuração do celular" onClick={props.onClose}><X size={17} /></button>
    <div className="pm-mobile-setup-heading"><div className="pm-modal-icon"><Smartphone size={22} /></div><div><h2>PentaMark no celular</h2><p>Instale, conecte e edite o mesmo cofre de qualquer lugar.</p></div></div>

    <div className="pm-mobile-setup-scroll">
      <section className="pm-mobile-setup-card featured">
        <header><ShieldCheck size={18} /><div><strong>Recomendado: PC host + Tailscale</strong><small>O cofre continua no PC; o celular vira um editor seguro e instalável.</small></div></header>
        <ol><li>Abra o PentaMark no PC.</li><li>Conecte PC e celular à mesma conta/rede Tailscale.</li><li>No PC, execute <code>Configurar-Acesso-Remoto-Tailscale.bat</code> uma vez.</li><li>Abra o endereço HTTPS no celular e instale o app.</li></ol>
      </section>

      <section className="pm-mobile-setup-card">
        <header><Download size={18} /><div><strong>Instalar neste aparelho</strong><small>A instalação mantém o PentaMark na tela inicial, sem barra do navegador.</small></div></header>
        {props.installed ? <div className="pm-install-state success"><Check size={15} />O PentaMark já está aberto como aplicativo.</div> : props.canInstall ? <button type="button" className="pm-install-button" onClick={props.onInstall}><Download size={15} />Instalar PentaMark</button> : <p className="pm-mobile-help">No iPhone: <strong>Compartilhar → Adicionar à Tela de Início</strong>. No Android, use o menu do navegador → <strong>Instalar app</strong>. A opção exige HTTPS ou localhost.</p>}
      </section>

      <section className="pm-mobile-setup-card">
        <header><Server size={18} /><div><strong>Endereços disponíveis</strong><small>Para sair de casa, prefira o endereço Tailscale HTTPS.</small></div></header>
        <div className="pm-mobile-url-list">{props.urls.map((url) => <button type="button" key={url} onClick={() => void copy(url)}><span><b>{connectionLabel(url)}</b><code>{url}</code></span><Copy size={14} /></button>)}</div>
        <p className="pm-mobile-help">O Radmin VPN oficial é para Windows. No Android e no iPhone, use Tailscale. Não publique a porta 3417 diretamente na internet.</p>
      </section>

      <section className="pm-mobile-setup-card">
        <header><HardDrive size={18} /><div><strong>Usar o Android como host</strong><small>Disponível no pacote Mobile Host; funciona com Termux e arquivos Markdown reais.</small></div></header>
        <p className="pm-mobile-help">É uma opção portátil, mas o Android pode encerrar o servidor em segundo plano. Para uso diário e colaboração, o PC ligado ou um servidor com disco persistente é mais confiável.</p>
      </section>
    </div>
  </div></div>;
}
