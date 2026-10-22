import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ReplicaPort, ReplicaProfile, RemotePort, SyncStatus, ReplicaSnapshot, Handshake, SyncMode } from '../features/sync/contracts';
import type { ActiveVaultContext } from './vault-context';
import { readActiveReplica, listReplicaProfiles, saveReplicaProfile, saveVerifiedRebind, activateReplica, clearActiveReplica, migrateProtectedDrafts } from './replica-profile';
import { normalizePcOrigin } from './remote-profile';
import { createSyncEngine, type EngineReplica, type SyncEngine } from '../features/sync/engine';
import { resolveLocalFile } from './local-files';

type NativeCall = <T>(method:string,payload?:Record<string,unknown>)=>Promise<T>;
const android = Capacitor.isNativePlatform() && Capacitor.getPlatform()==='android';
const plugin=registerPlugin<Record<string,(payload:Record<string,unknown>)=>Promise<unknown>>>('SyncVault');
const supported=android || Boolean(window.pentaMarkDesktop?.sync);
const selected=supported?readActiveReplica(localStorage):null;
const events=new EventTarget();
let context:ActiveVaultContext=Object.freeze({kind:'local-host'});
let native:NativeCall|null=null;
let currentStatus:SyncStatus|null=null;
let engine:SyncEngine|null=null;
const mediaUrls=new Map<string,{entryId:string;url:string}>();
async function refreshMedia(snapshot:ReplicaSnapshot,call:NativeCall) {
  const live=new Set(snapshot.entries.filter(e=>e.local&&!e.local.deleted).map(e=>e.local!.path));
  for(const path of mediaUrls.keys())if(!live.has(path))mediaUrls.delete(path);
  for(const entry of snapshot.entries){
    const v=entry.local;if(!v||v.deleted||!v.blobHash)continue;
    if(android){mediaUrls.set(v.path,{entryId:v.entryId,url:'/_pm_sync/file?path='+encodeURIComponent(v.path)});continue;}
    if(mediaUrls.get(v.path)?.entryId!==v.entryId){
      const result=await call<{url:string}>('mediaUrl',{entryId:v.entryId});
      if(!result.url.startsWith('/__replica_media/'))throw new Error('invalid-media-url');
      mediaUrls.set(v.path,{entryId:v.entryId,url:result.url});
    }
  }
}
export function replicaFileUrl(value:string,note:string,fragment='') {
  const path=resolveLocalFile(value,note,[...mediaUrls.keys()]);
  const url=path?mediaUrls.get(path)?.url:null;
  return url?url+(fragment.startsWith('#')?fragment:''):'';
}

/** The page never changes its vault: switching is saved first and then reloads. */
export const isOfflineReplica=Boolean(selected);
export const offlineProfile=selected;
export const supportsOfflineReplica=supported;
export const activeVaultContext=()=>context;
export const replicaStatus=()=>currentStatus;
export const replicaPort=():ReplicaPort|null=>context.kind==='offline-replica'?context.replica:null;
export const activeSyncEngine=()=>engine;
export async function exportReplicaRecovery():Promise<{cancelled:boolean}> {
  if(!selected)throw new Error('replica-not-selected');
  // Native validates the exact failed-open profile and never opens/migrates it.
  return nativeCaller(selected)<{cancelled:boolean}>('exportRecovery',{profile:selected});
}

export function bindNativeReplica(profile:ReplicaProfile,call:NativeCall):{replica:ReplicaPort;remote:RemotePort} {
  const replica:ReplicaPort={
    open:p=>call('open',{profile:p}),configure:config=>call('configure',{config}),
    request:async(url,method,body)=>{
      const result=await call<Awaited<ReturnType<ReplicaPort['request']>>>('request',{url,method,...(body===undefined?{}:{body})});
      if(url==='/api/state'&&result.status===200)await refreshMedia(await call<ReplicaSnapshot>('snapshot'),call);
      return result;
    },
    snapshot:()=>call('snapshot'),preparePending:async limit=>(await call<{operations:Awaited<ReturnType<ReplicaPort['preparePending']>>}>('preparePending',{limit})).operations,
    persistIncoming:async batch=>{await call('persistIncoming',{batch});},
    confirm:async result=>{await call('confirm',{result});},resolve:async input=>{await call('resolve',{input});},
    completeCycle:input=>call('completeCycle',{input}),
  };
  const remote:RemotePort={
    handshake:()=>call('handshake',{profile}),snapshot:(snapshotToken,cursor)=>call('remoteSnapshot',{...(snapshotToken?{snapshotToken}:{}),...(cursor?{cursor}:{})}),
    changes:(cursor,limit)=>call('changes',{cursor,limit}),
    apply:async operations=>(await call<{results:Awaited<ReturnType<RemotePort['apply']>>}>('apply',{operations})).results,
    downloadBlob:(blob,offset)=>call('downloadBlob',{blob,offset}),uploadBlob:(blob,offset)=>call('uploadBlob',{blob,offset}),
  };
  return {replica,remote};
}

function nativeCaller(profile:Pick<ReplicaProfile,'replicaId'>):NativeCall {
  if(android)return async<T>(method:string,payload:Record<string,unknown>={})=>await plugin[method](payload) as T;
  const desktop=window.pentaMarkDesktop?.sync;if(!desktop)throw new Error('native-sync-unavailable');
  return async<T>(method:string,payload:Record<string,unknown>={})=>{
    const keys:Record<string,string>={open:'profile',configure:'config',persistIncoming:'batch',confirm:'result',resolve:'input',completeCycle:'input'};
    const nativePayload=keys[method]?payload[keys[method]]:payload;
    const requestId=crypto.randomUUID();
    const reply=await desktop.invoke({requestId,replicaId:profile.replicaId,method,payload:nativePayload} as DesktopSyncCommand);
    if(reply.requestId!==requestId||reply.replicaId!==profile.replicaId)throw new Error('native-response-mismatch');
    if(!reply.ok)throw new Error(reply.error);
    // The desktop port returns the typed array directly; Android wraps plugin results.
    if(method==='preparePending')return {operations:reply.value} as T;
    return reply.value as T;
  };
}

export async function enableOfflineCopy(input:{origin:string;mode:SyncMode}) {
  if(!supported)throw new Error('Use o aplicativo para manter uma cópia offline.');
  const origin=normalizePcOrigin(input.origin);
  const probe=nativeCaller({replicaId:crypto.randomUUID()});
  const hello=await probe<Handshake>('discover',{origin});
  if(hello.protocol!==1||hello.chunkBytes!==1048576)throw new Error('Host incompatível com sincronização offline.');
  const old=listReplicaProfiles(localStorage).find(p=>p.vaultId===hello.vaultId&&p.serverId===hello.serverId);
  const profile:ReplicaProfile={vaultId:hello.vaultId,serverId:hello.serverId,replicaId:old?.replicaId||crypto.randomUUID(),origin,offlineEnabled:true,mode:input.mode};
  const call=nativeCaller(profile);
  await call('open',{profile:old||profile});
  if(old&&old.origin!==origin){
    const rebound=await call<{profile:ReplicaProfile;hello:Handshake}>('rebind',{origin});
    saveVerifiedRebind(localStorage,rebound.profile,rebound.hello);
  }
  await call('configure',{config:{offlineEnabled:true,mode:input.mode}});
  saveReplicaProfile(localStorage,profile);
  if(!document.dispatchEvent(new Event('pentamark:before-vault-switch',{cancelable:true})))throw new Error('Salve o rascunho antes de trocar de cofre.');
  activateReplica(localStorage,profile.replicaId);location.reload();
}
export async function configureOfflineCopy(config:{offlineEnabled:boolean;mode:SyncMode}) {
  const port=replicaPort();if(!port||!selected)throw new Error('replica-not-open');
  if(!config.offlineEnabled){
    const state=await port.snapshot();
    if(!state.status?.snapshotComplete || state.status.pendingCount || state.status.conflictCount)throw new Error('Sincronize ou exporte as pendências antes de desativar.');
    await port.configure(config);engine?.stop();
    saveReplicaProfile(localStorage,{...state.profile,...config});clearActiveReplica(localStorage);location.reload();return;
  }
  await engine?.setMode(config.mode);
  const state=await port.snapshot();saveReplicaProfile(localStorage,state.profile);await refreshReplicaStatus();
}
export function connectSavedReplica(value:string):boolean {
  if(!supported)return false;
  let origin:string;try{origin=normalizePcOrigin(value);}catch{return false;}
  const saved=listReplicaProfiles(localStorage).find(p=>p.origin===origin&&p.offlineEnabled);
  if(!saved)return false;
  if(!document.dispatchEvent(new Event('pentamark:before-vault-switch',{cancelable:true})))return true;
  activateReplica(localStorage,saved.replicaId);location.reload();return true;
}
export async function rebindOfflineCopy(value:string) {
  if(!selected)throw new Error('replica-not-open');
  const origin=normalizePcOrigin(value);
  engine?.stop();
  try {
    const rebound=await nativeReplicaCall<{profile:ReplicaProfile;hello:Handshake}>('rebind',{origin});
    saveVerifiedRebind(localStorage,rebound.profile,rebound.hello);location.reload();
  } catch(error){void engine?.resume();throw error;}
}
export async function importLegacyDrafts() {
  if(!selected||!android)throw new Error('Nenhum rascunho Android associado.');
  // Explicit recovery action, not an automatic upload of ambiguous legacy text.
  const hello=await nativeReplicaCall<Handshake>('handshake',{profile:selected});
  await migrateProtectedDrafts(localStorage,selected,hello,input=>nativeReplicaCall('importDraft',{input}));
  notifyReplicaChange();
}

export async function initializeReplica() {
  if(!selected)return false;
  native=nativeCaller(selected);
  const bound=bindNativeReplica(selected,native);
  currentStatus=await bound.replica.open(selected);
  context=Object.freeze({kind:'offline-replica',profile:selected,replica:bound.replica});
  // Engine verifies new-adapter capabilities before any content cycle.
  engine=createSyncEngine({replica:bound.replica as EngineReplica,remote:bound.remote});
  engine.onStatus(status=>{
    currentStatus=status;events.dispatchEvent(new Event('status'));
    if(!['syncing','initial-copy'].includes(status.phase))void bound.replica.snapshot().then(async snapshot=>{
      await refreshMedia(snapshot,native!);
      events.dispatchEvent(new Event('notes'));
      for(const e of snapshot.entries)if(e.local?.kind==='note'&&!e.local.deleted)events.dispatchEvent(new MessageEvent('note',{data:JSON.stringify({path:e.local.path})}));
    }).catch(()=>{ /* Native failure remains visible in the engine's status. */ });
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)engine?.stop();else void engine?.resume();});
  window.addEventListener('online',()=>{void engine?.reconnect();});
  return true;
}
export function nativeReplicaCall<T>(method:string,payload?:Record<string,unknown>):Promise<T> {
  if(!native)return Promise.reject(new Error('replica-not-open'));
  return native<T>(method,payload);
}
export async function refreshReplicaStatus():Promise<ReplicaSnapshot|null> {
  const port=replicaPort();if(!port)return null;
  const snapshot=await port.snapshot();currentStatus=snapshot.status??null;
  events.dispatchEvent(new Event('status'));return snapshot;
}
export function replicaVaultEvents():Pick<EventSource,'addEventListener'|'close'> {
  const controller=new AbortController();
  return {addEventListener(type:string,listener:EventListenerOrEventListenerObject){events.addEventListener(type,listener,{signal:controller.signal});},close(){controller.abort();}} as Pick<EventSource,'addEventListener'|'close'>;
}
export function notifyReplicaChange(path?:string) {
  engine?.localChanged();
  void refreshReplicaStatus().catch(()=>{});
  events.dispatchEvent(new Event('notes'));
  if(path)events.dispatchEvent(new MessageEvent('note',{data:JSON.stringify({path})}));
}
