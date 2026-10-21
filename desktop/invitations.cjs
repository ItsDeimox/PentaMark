function validInviteUrl(value) {
  if(typeof value!=="string"||value.length>2048)return false;
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='login.tailscale.com'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/admin\/invite\/[A-Za-z0-9_-]+$/.test(url.pathname);}catch{return false;}
}
function validateInvitation(value) {
  if(typeof value!=='string'||value.length>4096)throw new Error('Convite inválido.');
  const url=new URL(value);
  if(url.protocol!=='pentamark:'||url.hostname!=='join'||!['','/'].includes(url.pathname)||url.hash||url.username||url.password||url.searchParams.get('v')!=='1')throw new Error('Convite inválido.');
  for(const key of url.searchParams.keys())if(!['v','host','invite','name'].includes(key)||url.searchParams.getAll(key).length!==1)throw new Error('Convite inválido.');
  const host=new URL(url.searchParams.get('host')||'');
  const parts=host.hostname.split('.');
  const ip=parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255)&&Number(parts[0])===100&&Number(parts[1])>=64&&Number(parts[1])<=127;
  const dns=/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+ts\.net$/i.test(host.hostname);
  if(!((ip&&['http:','https:'].includes(host.protocol))||(dns&&host.protocol==='https:'))||host.username||host.password||host.pathname!=='/'||host.search||host.hash||!validInviteUrl(url.searchParams.get('invite')))throw new Error('Destino do convite inválido.');
  return url.href;
}
function invitationFromArgs(args){for(const arg of args){if(typeof arg==='string'&&/^pentamark:/i.test(arg)){try{return validateInvitation(arg);}catch{return null;}}}return null;}
module.exports={validInviteUrl,validateInvitation,invitationFromArgs};
