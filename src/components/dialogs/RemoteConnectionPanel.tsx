import {useState} from 'react';
import {connectAndroidPc,isRemoteVault,remoteOrigin,returnToAndroidLocal} from '../../platform/android';
import {DialogSection} from './DialogFrame';

export function RemoteConnectionPanel() {
  const [address,setAddress] = useState(remoteOrigin);
  const [error,setError] = useState('');
  return <DialogSection title="Conectar ao PC · Tailscale" hint="O editor continua dentro deste aplicativo. O cofre local permanece separado e funciona sem internet.">
    <p className="pm-notice">No PC, abra o PentaMark. Mantenha o aplicativo oficial do Tailscale conectado nos dois aparelhos, na mesma rede privada. Não precisa de Termux, comandos ou servidor no celular.</p>
    <label className="pm-field wide">Endereço do PC<input aria-label="Endereço Tailscale do PC" value={address} onChange={e=>setAddress(e.target.value)} placeholder="100.x.x.x:3417 ou https://pc.rede.ts.net" autoCapitalize="none" autoCorrect="off" spellCheck={false}/></label>
    <div className="pm-inline-actions"><button type="button" onClick={()=>{
      try {setError('');connectAndroidPc(address);} catch(e) {setError(e instanceof Error?e.message:'Endereço inválido.');}
    }}>Conectar ao PC</button>{isRemoteVault && <button type="button" onClick={returnToAndroidLocal}>Usar arquivos locais</button>}</div>
    <p className="pm-notice">Copie o IP Tailscale do PC e a porta mostrada pelo PentaMark. O endereço HTTPS .ts.net só funciona se o Tailscale Serve já estiver configurado no PC. O PC precisa estar ligado para acessar seus arquivos.</p>
    <small>Não há sincronização automática entre cofres. Alterações não salvas no PC ficam como rascunhos neste aparelho, vinculadas ao mesmo endereço. Voltar ao local não descarta esses rascunhos.</small>
    {error && <p role="alert" className="pm-form-error">{error}</p>}
  </DialogSection>;
}
