import { ArrowRightLeft, LogIn, Wifi, X } from "lucide-react";

export function ConnectModal(props: {
  address: string;
  setAddress: (value: string) => void;
  deviceName: string;
  setDeviceName: (value: string) => void;
  onClose: () => void;
  onConnect: () => void;
}) {
  return <div className="pm-modal-backdrop" onMouseDown={props.onClose}><form className="pm-modal pm-connect-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); props.onConnect(); }}>
    <button type="button" className="pm-modal-close" onClick={props.onClose}><X size={17} /></button>
    <div className="pm-modal-icon"><LogIn size={21} /></div>
    <h2>Conectar a um cofre</h2>
    <p>Cole o endereço compartilhado pelo host. Também funciona digitando somente o IP do Radmin e a porta.</p>
    <div className="pm-connect-fields">
      <label>Endereço do host<input autoFocus value={props.address} onChange={(event) => props.setAddress(event.target.value)} placeholder="26.xxx.xxx.xxx:3417" spellCheck={false} /></label>
      <label>Seu nome neste cofre<input value={props.deviceName} onChange={(event) => props.setDeviceName(event.target.value)} placeholder="Ex.: Deimox — Desktop" maxLength={60} /></label>
    </div>
    <div className="pm-connect-hint"><Wifi size={13} />Os dois dispositivos precisam estar na mesma rede Radmin, LAN ou VPN.</div>
    <div className="pm-dialog-actions"><button type="button" className="secondary" onClick={props.onClose}>Cancelar</button><button type="submit" className="primary"><ArrowRightLeft size={14} />Conectar</button></div>
  </form></div>;
}

