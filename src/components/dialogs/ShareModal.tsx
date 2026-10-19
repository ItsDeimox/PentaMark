import { LogIn, Server, Share2, Smartphone } from 'lucide-react';
import { connectionLabel } from '../../shared/client';
import { DialogFrame, DialogSection } from './DialogFrame';
import { CopyAddress } from './CopyAddress';
export function ShareModal(p: { urls: string[]; onClose: () => void; onMobile: () => void; onConnect: () => void; onNotify: (message: string) => void }) {
  return <DialogFrame title="Compartilhar o cofre" subtitle="Um endereço. O mesmo espaço de trabalho." icon={Share2} onClose={p.onClose}
    footer={<><span className="pm-footer-hint">Arquivos no host</span><button type="button" className="secondary" onClick={p.onClose}>Fechar</button></>}>
    <DialogSection title="Endereços disponíveis" hint="Escolha o endereço acessível ao outro dispositivo e clique para copiar."><div className="pm-addresses">{p.urls.map(url => <CopyAddress key={url} value={url} label={connectionLabel(url)} onNotify={p.onNotify}/>)}</div></DialogSection>
    <div className="pm-notice"><Server size={18}/><span>O host precisa continuar ligado e com o PentaMark aberto. Compartilhe endereços de rede somente com pessoas de confiança.</span></div>
    <div className="pm-flow-actions"><button type="button" onClick={p.onMobile}><Smartphone size={18}/><span><strong>Celular e acesso remoto</strong><small>Instalação e conexão ao host</small></span></button><button type="button" onClick={p.onConnect}><LogIn size={18}/><span><strong>Entrar em outro cofre</strong><small>Usar um endereço compartilhado</small></span></button></div>
  </DialogFrame>;
}
