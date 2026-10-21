import { registerPlugin } from '@capacitor/core';
import { isAndroidLocal } from './android';
import { parseInvitation, type VaultInvitation } from './invitation';

interface InvitationPlugin {
  getLaunchInvitation():Promise<{url?:string}>;
  addListener(event:'invitation',listener:(event:{url:string})=>void):Promise<{remove():Promise<void>}>;
  openOfficialInvite(options:{url:string}):Promise<void>;
}
const plugin=registerPlugin<InvitationPlugin>('VaultInvitation');
export async function receiveInvitations(onInvite:(value:VaultInvitation)=>void,onError:(message:string)=>void,signal:AbortSignal):Promise<()=>void> {
  const receive=(url:string)=>{try {onInvite(parseInvitation(url));} catch {onError('O link de convite não é válido.');}};
  if(isAndroidLocal) {
    const listener=await plugin.addListener('invitation',({url})=>receive(url));
    if(signal.aborted){await listener.remove();return ()=>{};}
    const launch=await plugin.getLaunchInvitation();if(launch.url) receive(launch.url);
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
