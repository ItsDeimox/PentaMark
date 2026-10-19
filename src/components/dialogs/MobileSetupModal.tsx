import { CopyAddress } from './CopyAddress';
import { DialogFrame } from './DialogFrame';
import { Check, Copy, Download, HardDrive, Server, ShieldCheck, Smartphone, X } from "lucide-react";
import { connectionLabel } from "../../shared/client";

export function MobileSetupModal(props: {
  urls: string[];
  canInstall: boolean;
  installed: boolean;
  onInstall: () => void;
  onClose: () => void;
  onNotify: (message: string) => void;
}) {
  return <DialogFrame title="PentaMark no celular" subtitle="Acesso ao cofre e instalação neste aparelho." icon={Smartphone} onClose={props.onClose} className="pm-mobile-dialog"
    footer={<><span className="pm-footer-hint">{props.installed ? 'Aberto como aplicativo' : 'Acesso pelo navegador'}</span><button type="button" className="secondary" onClick={props.onClose}>Fechar</button></>}>
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
        <div className="pm-mobile-url-list">{props.urls.map((url) => <CopyAddress key={url} label={connectionLabel(url)} value={url} onNotify={props.onNotify}/>)}</div>
        <p className="pm-mobile-help">O Radmin VPN oficial é para Windows. No Android e no iPhone, use Tailscale. Não publique a porta 3417 diretamente na internet.</p>
      </section>

      <section className="pm-mobile-setup-card">
        <header><HardDrive size={18} /><div><strong>Usar o Android como host</strong><small>Disponível no pacote Mobile Host; funciona com Termux e arquivos Markdown reais.</small></div></header>
        <p className="pm-mobile-help">É uma opção portátil, mas o Android pode encerrar o servidor em segundo plano. Para uso diário e colaboração, o PC ligado ou um servidor com disco persistente é mais confiável.</p>
      </section>
    </div>
  </DialogFrame>;
}
