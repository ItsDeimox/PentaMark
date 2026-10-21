import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { DialogSection, SettingsHeading } from './DialogFrame';
import { createInvitation } from '../../platform/invitation';
import { copyText } from '../../shared/client';
import './sharing.css';

type Status={installed:boolean;connected:boolean;configured:boolean;deviceName?:string;address?:string;error?:string};
export function TailscaleSharing({onNotify}:{onNotify:(message:string)=>void}) {
  const [status,setStatus]=useState<Status|null>(null),[key,setKey]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[link,setLink]=useState('');
  const api=window.pentaMarkDesktop;
  const action=useRef(false);
  useEffect(()=>{let active=true;void api?.tailscaleStatus?.().then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setError('Não foi possível consultar o Tailscale.');});return()=>{active=false;};},[api]);
  if(!api?.tailscaleStatus)return null;
  const run=async(operation:()=>Promise<void>)=>{if(action.current)return;action.current=true;setBusy(true);setError('');try{await operation();}catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir.');void api.tailscaleStatus().then(setStatus).catch(()=>{});}finally{action.current=false;setBusy(false);}};
  const refresh=()=>run(async()=>setStatus(await api.tailscaleStatus()));
  return <DialogSection title="Convidar um amigo">
    {!status?<p role="status">Consultando Tailscale…</p>:<div className="pm-sharing-setup">
      <p className="pm-sharing-status">{status.connected?`Tailscale conectado · ${status.deviceName||'Este PC'}`:status.installed?'Conecte o Tailscale neste PC.':'Instale o Tailscale para criar convites.'}</p>
      {!status.connected&&<div className="pm-inline-actions"><button type="button" disabled={busy} onClick={()=>void run(async()=>{await api.openTailscaleSetup(status.installed?'login':'install');})}><ExternalLink size={15}/>{status.installed?'Abrir Tailscale':'Instalar Tailscale'}</button><button type="button" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={14}/>Já conectei</button></div>}
      {status.connected&&(!status.configured||editing)&&<>
        <p>Na página oficial, use “Generate access token” em API access tokens. Copie a chave que começa com tskey-api- e cole aqui.</p>
        <button type="button" disabled={busy} onClick={()=>void run(async()=>{await api.openTailscaleSetup('keys');})}><ExternalLink size={15}/>Gerar chave no Tailscale</button>
        <label className="pm-field">Chave de API<input type="password" value={key} onChange={event=>setKey(event.target.value)} placeholder="tskey-api-…" autoComplete="off" spellCheck={false} autoCapitalize="none"/></label>
        <button type="button" className="primary" disabled={busy||!key.trim()} onClick={()=>void run(async()=>{setStatus(await api.saveTailscaleKey(key.trim()));setKey('');setEditing(false);onNotify('Tailscale configurado.');})}>Validar e salvar chave</button>
      </>}
      {status.connected&&status.configured&&!editing&&<div className="pm-inline-actions"><button type="button" className="primary" disabled={busy} onClick={()=>void run(async()=>{const invite=await api.createTailscaleInvite();setLink(createInvitation({address:invite.address,inviteUrl:invite.inviteUrl,name:invite.deviceName||'Cofre compartilhado'}));})}>{busy?'Criando…':'Criar convite'}</button><button type="button" disabled={busy} onClick={()=>setEditing(true)}>Alterar chave</button></div>}
      {link&&<div className="pm-sharing-link"><label className="pm-field">Convite PentaMark<textarea readOnly rows={3} value={link} onFocus={event=>event.target.select()}/></label><button type="button" onClick={()=>void run(async()=>{await copyText(link);onNotify('Convite copiado.');})}><Copy size={15}/>Copiar convite</button><p>Seu amigo pode abrir o link ou colá-lo em “Conectar a um cofre”.</p></div>}
      <SettingsHeading title="Sobre os convites" help={<><p>A chave fica criptografada neste PC. Se expirar, gere outra e substitua aqui. Cada convite pode ser aceito uma vez.</p><p>O Tailscale compartilha o acesso a este dispositivo conforme as regras da sua rede. Seu amigo precisa do Tailscale conectado e do PentaMark instalado para abrir o link do aplicativo. O PC deve permanecer ligado com o cofre aberto.</p><button type="button" disabled={!status.configured||busy} onClick={()=>void run(async()=>{await api.forgetTailscaleKey();setStatus(await api.tailscaleStatus());setKey('');setLink('');setEditing(false);})}>Remover chave deste PC</button></>}/>
    </div>}
    {status?.error&&<p className="pm-sharing-status">{status.error}</p>}
    {error&&<p role="alert" className="pm-form-error">{error}</p>}
  </DialogSection>;
}
