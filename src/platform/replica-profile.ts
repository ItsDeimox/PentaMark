import type { ReplicaProfile } from '../features/sync/contracts';
import type {ReplicaPort} from '../features/sync/contracts';
import { normalizePcOrigin, draftPrefix } from './remote-profile';

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'>;
const PROFILE_PREFIX = 'pentamark:sync:profile:';
const ACTIVE = 'pentamark:sync:active';
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function validate(value: unknown): ReplicaProfile {
  const p = value as ReplicaProfile;
  if (!p || ![p.vaultId,p.serverId,p.replicaId].every(id => typeof id === 'string' && UUID.test(id))
    || typeof p.offlineEnabled !== 'boolean' || !['automatic','manual'].includes(p.mode)
    || normalizePcOrigin(p.origin) !== p.origin) throw new Error('invalid-replica-profile');
  return Object.freeze({vaultId:p.vaultId,serverId:p.serverId,replicaId:p.replicaId,origin:p.origin,offlineEnabled:p.offlineEnabled,mode:p.mode});
}
export function readReplicaProfile(storage: StoragePort, replicaId: string): ReplicaProfile | null {
  if (!UUID.test(replicaId)) return null;
  try { const p = validate(JSON.parse(storage.getItem(PROFILE_PREFIX + replicaId) || 'null')); return p.replicaId === replicaId ? p : null; }
  catch { return null; }
}
export function saveReplicaProfile(storage: StoragePort, value: ReplicaProfile) {
  const p = validate(value), old = readReplicaProfile(storage,p.replicaId);
  if (old && (old.vaultId !== p.vaultId || old.serverId !== p.serverId || old.origin !== p.origin)) throw new Error('replica-identity-mismatch');
  storage.setItem(PROFILE_PREFIX+p.replicaId,JSON.stringify(p));
}
/** Called only with the profile returned by native rebind after its live identity check. */
export function saveVerifiedRebind(storage:StoragePort,value:ReplicaProfile,verified:Pick<ReplicaProfile,'vaultId'|'serverId'>) {
  const p=validate(value),old=readReplicaProfile(storage,p.replicaId);
  if(!old || old.vaultId!==p.vaultId || old.serverId!==p.serverId || verified.vaultId!==p.vaultId || verified.serverId!==p.serverId)throw new Error('replica-identity-mismatch');
  storage.setItem(PROFILE_PREFIX+p.replicaId,JSON.stringify(p));
}
export function listReplicaProfiles(storage: StoragePort): ReplicaProfile[] {
  const profiles: ReplicaProfile[]=[];
  for (let i=0;i<storage.length;i++) { const key=storage.key(i);if(key?.startsWith(PROFILE_PREFIX)){const p=readReplicaProfile(storage,key.slice(PROFILE_PREFIX.length));if(p)profiles.push(p);} }
  return profiles;
}
export function activateReplica(storage: StoragePort, replicaId: string) {
  const p=readReplicaProfile(storage,replicaId); if(!p?.offlineEnabled)throw new Error('replica-not-enabled');
  storage.setItem(ACTIVE,replicaId);
}
export function readActiveReplica(storage: StoragePort): ReplicaProfile | null {
  const p=readReplicaProfile(storage,storage.getItem(ACTIVE)||'');return p?.offlineEnabled?p:null;
}
/** Disconnecting never deletes a profile, local objects, pending operations or conflicts. */
export function clearActiveReplica(storage: StoragePort) { storage.removeItem(ACTIVE); }
export function replicaDraftPrefix(p: ReplicaProfile) { return `pentamark:sync:${p.vaultId}:${p.replicaId}:draft:`; }
/** Flush protected drafts to this captured local replica, never to its remote host.
 * A changing draft blocks structural operations instead of removing newer text. */
export async function flushReplicaDrafts(storage:StoragePort,profile:ReplicaProfile,path:string,request:ReplicaPort['request']) {
  const prefix=replicaDraftPrefix(profile),saved:Array<{path:string;content:string;revision:string}>=[];
  const matching=()=>Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((key):key is string=>Boolean(key?.startsWith(prefix)&&(key.slice(prefix.length)===path||key.slice(prefix.length).startsWith(path+'/'))));
  for(const key of matching()){
    const raw=storage.getItem(key);if(raw===null)continue;
    let draft:{content:string;revision:string};
    try{draft=JSON.parse(raw);if(typeof draft.content!=='string'||typeof draft.revision!=='string')throw Error();}catch{throw new Error('invalid-protected-draft');}
    const notePath=key.slice(prefix.length),url='/api/note?path='+encodeURIComponent(notePath);
    const current=await request(url,'GET');
    if(current.status!==200)throw new Error('protected-draft-unavailable');
    const result=current.data.content===draft.content?current:await request(url,'PUT',{content:draft.content,baseRevision:draft.revision});
    if(result.status>=400||typeof result.data.revision!=='string')throw new Error('protected-draft-not-saved');
    if(storage.getItem(key)!==raw)throw new Error('protected-draft-changed');
    storage.removeItem(key);saved.push({path:notePath,content:draft.content,revision:result.data.revision});
  }
  if(matching().length)throw new Error('protected-draft-changed');
  return saved;
}
export interface DraftImport {
  migrationId: string; vaultId: string; serverId: string; origin: string;
  path: string; content: string; legacyRevision: string;
}
/** Native import must preserve unknown bases as conflicts and deduplicate this stable receipt id. */
export async function migrateProtectedDrafts(storage: StoragePort, profile: ReplicaProfile,
  verified: Pick<ReplicaProfile,'vaultId'|'serverId'>,
  persist: (input: DraftImport) => Promise<{durable: boolean; migrationId?: string}>) {
  if(verified.vaultId!==profile.vaultId || verified.serverId!==profile.serverId)throw new Error('replica-identity-mismatch');
  const prefix=draftPrefix(profile.origin);
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((key):key is string=>Boolean(key?.startsWith(prefix)));
  for(const key of keys) {
    const raw=storage.getItem(key);if(!raw)continue;
    let draft: {content:string;revision:string};
    try { draft=JSON.parse(raw);if(typeof draft.content!=='string'||typeof draft.revision!=='string')continue; } catch{continue;}
    const path=key.slice(prefix.length);
    const bytes=new TextEncoder().encode(JSON.stringify([profile.vaultId,profile.serverId,profile.replicaId,key,draft.content,draft.revision]));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const migrationId=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const receipt=await persist({migrationId,vaultId:profile.vaultId,serverId:profile.serverId,origin:profile.origin,path,content:draft.content,legacyRevision:draft.revision});
    if(!receipt?.durable || receipt.migrationId!==migrationId)throw new Error('migration-not-durable');
    if(storage.getItem(key)===raw)storage.removeItem(key);
  }
}
