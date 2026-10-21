import { ArrowRightLeft, LogIn, Wifi } from 'lucide-react';
import { DialogFrame, DialogSection } from './DialogFrame';
export function ConnectModal(p: {
  address: string; setAddress: (value: string) => void; deviceName: string; setDeviceName: (value: string) => void; onClose: () => void; onConnect: () => void;
}) {
  return <DialogFrame title="Conectar a um cofre" subtitle="Continue seu trabalho em um host compartilhado." icon={LogIn} onClose={p.onClose} onSubmit={p.onConnect}
    footer={<><span className="pm-footer-hint">Conexão ao host</span><button type="button" className="secondary" onClick={p.onClose}>Cancelar</button><button type="submit" className="primary" disabled={!p.address.trim() || !p.deviceName.trim()}><ArrowRightLeft size={15}/>Conectar</button></>}>
    <DialogSection title="Destino"><label className="pm-field">Endereço ou convite<input data-autofocus value={p.address} onChange={e => p.setAddress(e.target.value)} placeholder="pentamark://join?… ou endereço do PC" spellCheck={false} inputMode="url" autoComplete="off" required/></label></DialogSection>
    <DialogSection title="Identificação"><label className="pm-field">Seu nome neste cofre<input value={p.deviceName} onChange={e => p.setDeviceName(e.target.value)} maxLength={60} required autoComplete="nickname"/></label></DialogSection>
    <div className="pm-notice"><Wifi size={18}/><span>Os dispositivos precisam alcançar a mesma rede do host ou o endereço remoto configurado por ele.</span></div>
  </DialogFrame>;
}
