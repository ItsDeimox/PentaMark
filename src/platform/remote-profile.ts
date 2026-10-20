export const REMOTE_PROFILE_KEY = 'pentamark:android:remote-profile';
export function normalizePcOrigin(value: string): string {
  const input = value.trim();
  const invalid = () => new Error('Use o IP Tailscale do PC (100.x.x.x:3417) ou o endereço HTTPS .ts.net, sem caminho ou credenciais.');
  let url: URL;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`); }
  catch { throw invalid(); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || /[\\\s]/.test(input)) throw invalid();
  const octets = url.hostname.split('.');
  const tailIp = octets.length === 4 && octets.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
    && Number(octets[0]) === 100 && Number(octets[1]) >= 64 && Number(octets[1]) <= 127;
  const tailDns = /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+ts\.net$/i.test(url.hostname);
  if (!(tailIp && ['http:','https:'].includes(url.protocol)) && !(tailDns && url.protocol === 'https:')) throw invalid();
  return url.origin;
}
export function readRemoteProfile(storage: Pick<Storage,'getItem'>): {origin:string} | null {
  try {
    const value = JSON.parse(storage.getItem(REMOTE_PROFILE_KEY) || 'null');
    return value && typeof value.origin === 'string' ? {origin:normalizePcOrigin(value.origin)} : null;
  } catch { return null; }
}
export function draftPrefix(origin: string): string {
  return origin ? `pentamark:android:remote:${encodeURIComponent(origin)}:draft:` : 'pentamark:android:draft:';
}
