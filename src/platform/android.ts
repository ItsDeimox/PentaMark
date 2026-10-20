import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { DraftStore, resolveLocalFile } from './local-files';

type NativeResponse = { status: number; data: Record<string, unknown> };
interface LocalVaultPlugin {
  info(): Promise<{ root: string }>;
  request(options: { url: string; method: string; body?: string; base64?: string }): Promise<NativeResponse>;
  importDocuments(): Promise<{ cancelled?: boolean; count?: number }>;
  exportVault(): Promise<{ cancelled?: boolean }>;
  addListener(event: 'vaultChanged', listener: () => void): Promise<PluginListenerHandle>;
}
const plugin = registerPlugin<LocalVaultPlugin>('LocalVault');
export const isAndroidLocal = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const androidDrafts = new DraftStore(localStorage);
const events = new EventTarget();
let root = '';
let files: string[] = [];

export async function initializeAndroid() {
  if (!isAndroidLocal) return;
  root = (await plugin.info()).root;
  if (!root.startsWith('/')) throw new Error('O Android não retornou um diretório de arquivos válido.');
  document.documentElement.dataset.platform = 'android';
  await plugin.addListener('vaultChanged', () => events.dispatchEvent(new Event('notes')));
}

export function nativeFileUrl(value: string, note: string, fragment = '') {
  const path = resolveLocalFile(value, note, files);
  if (!path || !root) return '';
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
  const result = await plugin.request(options);
  if (method === 'PATCH' && result.status < 400 && typeof result.data.path === 'string') {
    const source = new URL(url, 'https://localhost').searchParams.get('path');
    if (source) androidDrafts.move(source, result.data.path);
  }
  if (url === '/api/state' && result.status === 200) files = result.data.assetPaths as string[] || [];
  if (result.status < 400 && method !== 'GET' && !url.startsWith('/api/presence')) {
    // The writer already owns its current editor state; never reload its note
    // in the middle of an autosave. Only refresh the tree/configuration.
    events.dispatchEvent(new Event(url.startsWith('/api/config') ? 'config' : 'notes'));
  }
  return result;
}

export function vaultEvents(url: string): Pick<EventSource, 'addEventListener' | 'close'> {
  if (!isAndroidLocal) return new EventSource(url);
  const controller = new AbortController();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      events.addEventListener(type, listener, { signal: controller.signal });
    },
    close() { controller.abort(); },
  } as Pick<EventSource, 'addEventListener' | 'close'>;
}

export const importAndroidDocuments = () => plugin.importDocuments();
export async function flushAndroidDrafts(onlyPath?: string) {
  const prefix = 'pentamark:android:draft:';
  // Snapshot keys: completed saves remove entries while this loop runs.
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  for (const key of keys) {
    const path = key.slice(prefix.length);
    if (onlyPath && path !== onlyPath && !path.startsWith(onlyPath + '/')) continue;
    const draft = androidDrafts.get(path);
    if (!draft) continue;
    const url = `/api/note?path=${encodeURIComponent(path)}`;
    const current = await plugin.request({ url, method: 'GET' });
    if (current.status !== 200) throw new Error(`Abra e recupere o rascunho de ${path} antes de continuar.`);
    // An autosave already in flight may have written this exact draft.
    const result = current.data.content === draft.content ? current : await plugin.request({ url, method: 'PUT', body: JSON.stringify({ content: draft.content, baseRevision: draft.revision }) });
    if (result.status >= 400) throw new Error(`Não foi possível salvar ${path}. Resolva o conflito ou erro de armazenamento antes de continuar.`);
    const revision = String(result.data.revision);
    androidDrafts.saved(path, draft.content, revision);
    document.dispatchEvent(new CustomEvent('pentamark:draft-saved', { detail: { path, content: draft.content, revision } }));
  }
}
export async function exportAndroidVault() {
  document.dispatchEvent(new CustomEvent('pentamark:storage-busy', {detail: true}));
  try { await flushAndroidDrafts(); return await plugin.exportVault(); }
  finally { document.dispatchEvent(new CustomEvent('pentamark:storage-busy', {detail: false})); }
}
