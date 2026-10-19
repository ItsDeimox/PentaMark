import type { HostConfig } from '../domain/types';
import { request } from './client';

const EDITABLE = ['vaultName','port','maxUploadMB','openBrowser','lockEditedNotes','cleanupUnusedAssets','aiBridgeEnabled','aiBridgeToken'] as const;
/** Merge only this dialog's edits; never reset unrelated flags or a newer host value. */
export async function saveHostSettings(draft: HostConfig, baseline: HostConfig): Promise<HostConfig> {
  const keys = EDITABLE.filter(key => draft[key] !== baseline[key]);
  if (!keys.length) return await request<HostConfig>('/api/config');
  const current = await request<HostConfig>('/api/config');
  if (!current.isHost) throw new Error('Somente o host pode alterar estas configurações.');
  for (const key of keys) if (current[key] !== baseline[key] && current[key] !== draft[key]) {
    throw new Error('A configuração mudou em outra janela. Feche e reabra este painel antes de salvar.');
  }
  if (keys.includes('aiBridgeToken') && !/^[a-zA-Z0-9_-]{16,128}$/.test(draft.aiBridgeToken)) throw new Error('O token precisa ter de 16 a 128 caracteres. Use Gerar novo token para criar um.');
  if (keys.includes('vaultName') && !draft.vaultName.trim()) throw new Error('Informe um nome para o cofre.');
  if (keys.includes('port') && (!Number.isInteger(draft.port) || draft.port < 1024 || draft.port > 65535)) throw new Error('A porta precisa ser um inteiro entre 1024 e 65535.');
  if (keys.includes('maxUploadMB') && (!Number.isFinite(draft.maxUploadMB) || draft.maxUploadMB < 1 || draft.maxUploadMB > 16384)) throw new Error('O limite de upload precisa estar entre 1 e 16384 MB.');
  const next = { ...current, ...Object.fromEntries(keys.map(key => [key, draft[key]])) };
  return await request<HostConfig>('/api/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(next) });
}
