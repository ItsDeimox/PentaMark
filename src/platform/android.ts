import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { DraftStore, resolveLocalFile } from './local-files';
import { draftPrefix, normalizePcOrigin, readRemoteProfile, REMOTE_PROFILE_KEY } from './remote-profile';
import { isOfflineReplica, offlineProfile, replicaVaultEvents, connectSavedReplica } from './replica';
import { clearActiveReplica, replicaDraftPrefix } from './replica-profile';

type NativeResponse = { status: number; data: Record<string, unknown> };
interface LocalVaultPlugin {
  info(): Promise<{ root: string }>;
  request(options: { url: string; method: string; body?: string; base64?: string }): Promise<NativeResponse>;
  importDocuments(): Promise<{ cancelled?: boolean; count?: number }>;
  exportVault(): Promise<{ cancelled?: boolean }>;
  addListener(event: 'vaultChanged', listener: () => void): Promise<PluginListenerHandle>;
}
const plugin = registerPlugin<LocalVaultPlugin>('LocalVault');
interface RemoteVaultPlugin {
  configure(options: {origin:string}): Promise<void>;
  disconnect(): Promise<void>;
  request(options: {url:string;method:string;body?:string;base64?:string;clientId?:string}): Promise<NativeResponse>;
  startEvents(options: {url:string}): Promise<void>;
  stopEvents(): Promise<void>;
  addListener(event:'remoteEvent', listener:(event:{type:string;data:string})=>void):Promise<PluginListenerHandle>;
}
const remote = registerPlugin<RemoteVaultPlugin>('RemoteVault');
export const isAndroidLocal = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
// Immutable for this page lifetime: switching vaults reloads the bundled UI.
// In-flight saves can never change their destination under the editor.
export const remoteOrigin = offlineProfile?.origin || (isAndroidLocal ? readRemoteProfile(localStorage)?.origin || '' : '');
export const isRemoteVault = Boolean(remoteOrigin);
export const androidDrafts = new DraftStore(localStorage, offlineProfile ? replicaDraftPrefix(offlineProfile) : draftPrefix(remoteOrigin));
export const androidLastNoteKey = remoteOrigin ? `pentamark:android:remote:${encodeURIComponent(remoteOrigin)}:last-note` : 'pentamark:android:last-note';
const events = new EventTarget();
let root = '';
let files: string[] = [];

export async function initializeAndroid() {
  if (!isAndroidLocal) return;
  if(isOfflineReplica){
    // Native plugins survive WebView reloads: stop the prior live session before
    // declaring the offline/manual context ready, without asking it for content.
    if(Capacitor.isPluginAvailable('RemoteVault'))await remote.disconnect();
    document.documentElement.dataset.platform='android';return;
  }
  root = (await plugin.info()).root;
  if (!root.startsWith('/')) throw new Error('O Android não retornou um diretório de arquivos válido.');
  document.documentElement.dataset.platform = 'android';
  await plugin.addListener('vaultChanged', () => events.dispatchEvent(new Event('notes')));
  if (isRemoteVault) {
    await remote.configure({origin:remoteOrigin});
    const probe = await remote.request({url:'/api/state',method:'GET',clientId:localStorage.getItem('pentamark:client-id') || undefined});
    if (probe.status !== 200 || probe.data.app !== 'PentaMark' || !Array.isArray(probe.data.notes)) {
      throw new Error('O endereço não respondeu como um cofre PentaMark. Confira o app aberto no PC e o Tailscale nos dois aparelhos.');
    }
  } else if (Capacitor.isPluginAvailable('RemoteVault')) {
    // WebView reload does not necessarily destroy the native Activity/plugin.
    // Release the prior PC's stream and locks even when switching without a network.
    await remote.disconnect();
  }
}

export function connectAndroidPc(value: string) {
  const origin = normalizePcOrigin(value);
  if(connectSavedReplica(origin))return;
  if (!document.dispatchEvent(new Event('pentamark:before-vault-switch',{cancelable:true}))) return;
  clearActiveReplica(localStorage);
  localStorage.setItem(REMOTE_PROFILE_KEY, JSON.stringify({origin}));
  location.reload();
}
export function returnToAndroidLocal() {
  if (!document.dispatchEvent(new Event('pentamark:before-vault-switch',{cancelable:true}))) return;
  clearActiveReplica(localStorage);
  localStorage.removeItem(REMOTE_PROFILE_KEY);
  location.reload();
}

const deviceRequest = async (options: Parameters<LocalVaultPlugin['request']>[0]) => {
  if (!isRemoteVault) return plugin.request(options);
  try {
    const result = await remote.request({...options,clientId:localStorage.getItem('pentamark:client-id') || undefined});
    if (result.status < 500) document.dispatchEvent(new CustomEvent('pentamark:remote-status',{detail:true}));
    return result;
  }
  catch(error) {
    document.dispatchEvent(new CustomEvent('pentamark:remote-status',{detail:false}));
    document.dispatchEvent(new Event('pentamark:remote-request-failed'));
    throw error;
  }
};

export function nativeFileUrl(value: string, note: string, fragment = '') {
  const path = resolveLocalFile(value, note, files);
  if (!path || !root) return '';
  if (isRemoteVault) return '/_pm_remote/file?path=' + encodeURIComponent(path) + (fragment.startsWith('#') ? fragment : '');
  // convertFileSrc keeps the asset in the WebView's local origin. Encode reserved
  // filename characters before appending a fragment; no base64 copies of media.
  const url = Capacitor.convertFileSrc(root + '/' + path);
  const encoded = url.split('/').map((part, i) => i < 3 ? part : encodeURIComponent(part)).join('/');
  return encoded + (fragment.startsWith('#') ? fragment : '');
}

export async function nativeRequest(url: string, init?: RequestInit): Promise<NativeResponse> {
  const method = (init?.method || 'GET').toUpperCase();
  const exclusive = method === 'PATCH' || method === 'DELETE';
  if (exclusive) document.dispatchEvent(new CustomEvent('pentamark:storage-busy', {detail: true}));
  try { return await performNativeRequest(url, method, init); }
  finally { if (exclusive) document.dispatchEvent(new CustomEvent('pentamark:storage-busy', {detail: false})); }
}

async function performNativeRequest(url: string, method: string, init?: RequestInit): Promise<NativeResponse> {
  if (method === 'PATCH' || method === 'DELETE') {
    const path = new URL(url, 'https://localhost').searchParams.get('path');
    if (path) await flushAndroidDrafts(path);
  }
  const options: Parameters<LocalVaultPlugin['request']>[0] = { url, method };
  if (init?.body instanceof Blob) {
    if (init.body.size > 32 * 1024 * 1024) throw new Error('No Android, importe anexos de até 32 MB por arquivo.');
    options.base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler o anexo.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(init.body as Blob);
    });
  } else if (typeof init?.body === 'string') options.body = init.body;
  const result = await deviceRequest(options);
  if (method === 'PATCH' && result.status < 400 && typeof result.data.path === 'string') {
    const source = new URL(url, 'https://localhost').searchParams.get('path');
    if (source) androidDrafts.move(source, result.data.path);
  }
  if (url === '/api/state' && result.status === 200) {
    files = Array.isArray(result.data.assetPaths) ? result.data.assetPaths as string[]
      : [...(Array.isArray(result.data.notes) ? result.data.notes : []), ...(Array.isArray(result.data.assets) ? result.data.assets : [])]
        .map(item => item.path).filter((path): path is string => typeof path === 'string');
  }
  if (result.status < 400 && method !== 'GET' && !url.startsWith('/api/presence')) {
    // The writer already owns its current editor state; never reload its note
    // in the middle of an autosave. Only refresh the tree/configuration.
    events.dispatchEvent(new Event(url.startsWith('/api/config') ? 'config' : 'notes'));
  }
  return result;
}

export function vaultEvents(url: string): Pick<EventSource, 'addEventListener' | 'close'> {
  if(isOfflineReplica)return replicaVaultEvents();
  if (!isAndroidLocal) return new EventSource(url);
  if (isRemoteVault) return remoteEvents(url);
  const controller = new AbortController();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      events.addEventListener(type, listener, { signal: controller.signal });
    },
    close() { controller.abort(); },
  } as Pick<EventSource, 'addEventListener' | 'close'>;
}

function remoteEvents(url: string): Pick<EventSource, 'addEventListener' | 'close'> {
  const target = new EventTarget();
  let closed = false, listener: PluginListenerHandle | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 1500, running = false;
  const retry = () => {
    running = false;
    if (closed || document.hidden || timer) return;
    timer = setTimeout(() => {timer = undefined; void start();}, delay);
    delay = Math.min(delay * 2, 15000);
  };
  const start = async () => {
    if (closed || document.hidden || running) return;
    running = true;
    try { await remote.startEvents({url}); } catch { retry(); }
  };
  const visibility = () => {
    if (document.hidden) { clearTimeout(timer); timer = undefined; running = false; void remote.stopEvents().catch(()=>undefined); }
    else void start();
  };
  const requestFailed = () => {
    if (closed || timer) return;
    void remote.stopEvents().catch(()=>undefined).finally(retry);
  };
  void remote.addListener('remoteEvent', event => {
    if (closed) return;
    if (event.type === 'open') {delay = 1500; running = true;}
    if (event.type === 'error') retry();
    target.dispatchEvent(new MessageEvent(event.type,{data:event.data}));
    if (['open','error'].includes(event.type)) document.dispatchEvent(new CustomEvent('pentamark:remote-status',{detail:event.type==='open'}));
  }).then(handle => {
    listener = handle;
    if (closed) void handle.remove(); else void start();
  }).catch(retry);
  document.addEventListener('visibilitychange',visibility);
  document.addEventListener('pentamark:remote-request-failed',requestFailed);
  return {
    addEventListener(type:string,callback:EventListenerOrEventListenerObject) {target.addEventListener(type,callback);},
    close() {closed = true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('pentamark:remote-request-failed',requestFailed);void listener?.remove();void remote.stopEvents().catch(()=>undefined);},
  } as Pick<EventSource,'addEventListener'|'close'>;
}

export const importAndroidDocuments = () => {
  if (isRemoteVault) throw new Error('Volte aos arquivos locais para importar documentos no aparelho.');
  return plugin.importDocuments();
};
export async function flushAndroidDrafts(onlyPath?: string) {
  const prefix = androidDrafts.prefix;
  // Snapshot keys: completed saves remove entries while this loop runs.
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  for (const key of keys) {
    const path = key.slice(prefix.length);
    if (onlyPath && path !== onlyPath && !path.startsWith(onlyPath + '/')) continue;
    const draft = androidDrafts.get(path);
    if (!draft) continue;
    const url = `/api/note?path=${encodeURIComponent(path)}`;
    const current = await deviceRequest({ url, method: 'GET' });
    if (current.status !== 200) throw new Error(`Abra e recupere o rascunho de ${path} antes de continuar.`);
    // An autosave already in flight may have written this exact draft.
    const result = current.data.content === draft.content ? current : await deviceRequest({ url, method: 'PUT', body: JSON.stringify({ content: draft.content, baseRevision: draft.revision, clientId:localStorage.getItem('pentamark:client-id') || undefined }) });
    if (result.status >= 400) throw new Error(`Não foi possível salvar ${path}. Resolva o conflito ou erro de armazenamento antes de continuar.`);
    const revision = String(result.data.revision);
    androidDrafts.saved(path, draft.content, revision);
    document.dispatchEvent(new CustomEvent('pentamark:draft-saved', { detail: { path, content: draft.content, revision } }));
  }
}
export async function exportAndroidVault() {
  if (isRemoteVault) throw new Error('Volte aos arquivos locais para exportar o cofre do aparelho.');
  document.dispatchEvent(new CustomEvent('pentamark:storage-busy', {detail: true}));
  try { await flushAndroidDrafts(); return await plugin.exportVault(); }
  finally { document.dispatchEvent(new CustomEvent('pentamark:storage-busy', {detail: false})); }
}
