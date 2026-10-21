import { registerPlugin } from '@capacitor/core';
import { isAndroidLocal } from './android';
import { parseInvitation, type VaultInvitation } from './invitation';

interface InvitationPlugin {
  getLaunchInvitation():Promise<{url?:string}>;
  acknowledge(options:{url:string}):Promise<void>;
  addListener(event:'invitation',listener:(event:{url:string})=>void):Promise<{remove():Promise<void>}>;
  openOfficialInvite(options:{url:string}):Promise<void>;
}
const plugin=registerPlugin<InvitationPlugin>('VaultInvitation');
export async function receiveInvitations(onInvite:(value:VaultInvitation)=>void,onError:(message:string)=>void,signal:AbortSignal):Promise<()=>void> {
  const receive=(url:string)=>{if(signal.aborted)return false;try {onInvite(parseInvitation(url));return true;} catch(error) {console.warn('Falha ao receber convite PentaMark:',error instanceof Error?error.message:'Formato inválido');onError('O link de convite não é válido.');return false;}};
  if(isAndroidLocal) {
    const deliver=(url:string)=>{if(receive(url))void plugin.acknowledge({url}).catch(()=>{});};
    const listener=await plugin.addListener('invitation',({url})=>deliver(url));
    if(signal.aborted){await listener.remove();return ()=>{};}
    const launch=await plugin.getLaunchInvitation();if(launch.url) deliver(launch.url);
    return ()=>{void listener.remove();};
  }
  const desktop=window.pentaMarkDesktop;
  if(desktop?.consumeInvitation) {
    const remove=desktop.onInvitation(url=>{if(signal.aborted)return;receive(url);void desktop.consumeInvitation().catch(()=>{});});
    await Promise.resolve();
    if(signal.aborted){remove();return ()=>{};}
    const launch=await desktop.consumeInvitation();if(launch)receive(launch);
    return remove;
  }
  return ()=>{};
}
export async function openOfficialInvite(url:string) {
  if(isAndroidLocal) await plugin.openOfficialInvite({url});
  else if(window.pentaMarkDesktop) await window.pentaMarkDesktop.openTailscaleInvite(url);
  else window.open(url,'_blank','noopener,noreferrer');
}
