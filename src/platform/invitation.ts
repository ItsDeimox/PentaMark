import { normalizePcOrigin } from './remote-profile';

export type VaultInvitation = { address:string; inviteUrl:string; name:string };
export function parseInvitation(input:string):VaultInvitation {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('Convite inválido.');
  const url=new URL(input.trim());
  if(url.protocol!=='pentamark:'||url.hostname!=='join'||(url.pathname!==''&&url.pathname!=='/')||url.hash||url.username||url.password) throw new Error('Convite inválido.');
  if(url.searchParams.get('v')!=='1'||[...url.searchParams.keys()].some(key=>!['v','host','invite','name'].includes(key))||[...new Set(url.searchParams.keys())].some(key=>url.searchParams.getAll(key).length!==1)) throw new Error('Convite inválido.');
  const address=normalizePcOrigin(url.searchParams.get('host')||'');
  const invite=new URL(url.searchParams.get('invite')||'');
  if(invite.protocol!=='https:'||invite.hostname!=='login.tailscale.com'||invite.port||invite.username||invite.password||invite.search||invite.hash||!/^\/admin\/invite\/[a-zA-Z0-9_-]+$/.test(invite.pathname)) throw new Error('Convite Tailscale inválido.');
  return {address,inviteUrl:invite.href,name:(url.searchParams.get('name')||'Cofre compartilhado').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80)};
}
export function createInvitation(invitation:VaultInvitation):string {
  const link=new URL('pentamark://join');
  link.searchParams.set('v','1');link.searchParams.set('host',invitation.address);link.searchParams.set('invite',invitation.inviteUrl);link.searchParams.set('name',invitation.name);
  parseInvitation(link.href);
  return link.href;
}
export function isInvitation(value:string) { return /^pentamark:/i.test(value.trim()); }
