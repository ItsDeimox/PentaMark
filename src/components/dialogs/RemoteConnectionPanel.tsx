import {useState} from 'react';
import {connectAndroidPc,isRemoteVault,remoteOrigin,returnToAndroidLocal} from '../../platform/android';
import {DialogSection} from './DialogFrame';
import {isInvitation,parseInvitation,type VaultInvitation} from '../../platform/invitation';
import {InvitationDialog} from './InvitationDialog';

export function RemoteConnectionPanel() {
  const [address,setAddress] = useState(remoteOrigin);
  const [error,setError] = useState('');
  const [invitation,setInvitation]=useState<VaultInvitation|null>(null);
  return <><DialogSection title="Conectar ao PC" help={<>
    <ol>
      <li>Conecte o Tailscale no PC e no celular, na mesma rede privada.</li>
      <li>Abra o PentaMark no PC e mantenha-o ligado.</li>
      <li>Informe o IP Tailscale do PC e a porta do PentaMark, normalmente 3417.</li>
    </ol>
    <p>Endereços HTTPS .ts.net precisam do Tailscale Serve configurado no PC.</p>
    <p>O cofre local independente continua separado do PC. Para editar uma cópia do cofre do PC sem conexão, habilite “Manter cópia offline” na aba Sincronização e escolha o modo automático ou manual. Sem essa opção, a conexão ao vivo exige o host disponível.</p>
  </>}>
    <label className="pm-field wide">Endereço ou convite<input aria-label="Endereço Tailscale do PC" value={address} onChange={e=>setAddress(e.target.value)} placeholder="100.x.x.x:3417 ou pentamark://join?…" autoCapitalize="none" autoCorrect="off" spellCheck={false}/></label>
    <div className="pm-inline-actions"><button type="button" onClick={()=>{
      try {setError('');if(isInvitation(address))setInvitation(parseInvitation(address));else connectAndroidPc(address);} catch(e) {setError(e instanceof Error?e.message:'Endereço inválido.');}
    }}>Conectar ao PC</button>{isRemoteVault && <button type="button" onClick={returnToAndroidLocal}>Usar arquivos locais</button>}</div>
    {error && <p role="alert" className="pm-form-error">{error}</p>}
  </DialogSection>{invitation&&<InvitationDialog invitation={invitation} onClose={()=>setInvitation(null)} onConnect={async value=>{connectAndroidPc(value);}}/>}</>;
}
