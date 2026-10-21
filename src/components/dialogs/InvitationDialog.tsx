import { useState } from 'react';
import { LogIn, ExternalLink } from 'lucide-react';
import { DialogFrame } from './DialogFrame';
import type { VaultInvitation } from '../../platform/invitation';
import { openOfficialInvite } from '../../platform/invitation-events';

export function InvitationDialog({invitation,onClose,onConnect}:{invitation:VaultInvitation;onClose:()=>void;onConnect:(address:string)=>Promise<void>}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false);
  const connect=async()=>{if(busy)return;setBusy(true);setError('');try{await onConnect(invitation.address);}catch(e){setError(e instanceof Error?e.message:'Não foi possível conectar.');}finally{setBusy(false);}};
  return <DialogFrame title="Entrar no cofre" subtitle={invitation.name} icon={LogIn} onClose={()=>{if(!busy)onClose();}}
    footer={<><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="primary" disabled={!accepted||busy} onClick={()=>void connect()}>{busy?'Conectando…':'Conectar ao cofre'}</button></>}>
    <div className="pm-invite-steps"><p>1. Aceite o convite usando sua conta do Tailscale.</p>
      <button type="button" onClick={()=>{setError('');void openOfficialInvite(invitation.inviteUrl).then(()=>setAccepted(true)).catch(()=>setError('Não foi possível abrir o convite.'));}}><ExternalLink size={16}/>Abrir convite do Tailscale</button>
      <p>2. Com o Tailscale conectado, volte aqui e conecte ao cofre.</p>
      <code className="pm-invite-address">{invitation.address}</code>
    </div>
    {error&&<p role="alert" className="pm-form-error">{error}</p>}
  </DialogFrame>;
}
