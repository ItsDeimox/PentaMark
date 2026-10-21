import { normalizePcOrigin } from './remote-profile';

export type VaultInvitation = { address:string; inviteUrl:string; name:string };
export function parseInvitation(input:string):VaultInvitation {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('Convite inválido.');
  const value=input.trim();
  // Older Android WebViews parse non-special schemes as an opaque path
  // (hostname="", pathname="//join"). Validate the exact authority ourselves
  // and parse only its query with the stable HTTPS URL implementation.
  if(!/^pentamark:\/\/join\/?\?/i.test(value))throw new Error('Convite inválido.');
  const url=new URL(`https://invitation.pentamark.invalid/${value.slice(value.indexOf('?'))}`);
  if(url.hash) throw new Error('Convite inválido.');
  if(url.searchParams.get('v')!=='1'||[...url.searchParams.keys()].some(key=>!['v','host','invite','name'].includes(key))||[...new Set(url.searchParams.keys())].some(key=>url.searchParams.getAll(key).length!==1)) throw new Error('Convite inválido.');
  const address=normalizePcOrigin(url.searchParams.get('host')||'');
  const invite=new URL(url.searchParams.get('invite')||'');
  if(invite.protocol!=='https:'||invite.hostname!=='login.tailscale.com'||invite.port||invite.username||invite.password||invite.search||invite.hash||!/^\/admin\/invite\/[a-zA-Z0-9_-]+$/.test(invite.pathname)) throw new Error('Convite Tailscale inválido.');
  return {address,inviteUrl:invite.href,name:(url.searchParams.get('name')||'Cofre compartilhado').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80)};
}
export function createInvitation(invitation:VaultInvitation):string {
  const params=new URLSearchParams({v:'1',host:invitation.address,invite:invitation.inviteUrl,name:invitation.name});
  const link=`pentamark://join?${params}`;
  parseInvitation(link);
  return link;
}
export function isInvitation(value:string) { return /^pentamark:/i.test(value.trim()); }
