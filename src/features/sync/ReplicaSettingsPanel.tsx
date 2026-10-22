import {useEffect,useState} from 'react';
import {SyncSettings} from './SyncSettings';
import {SyncConflictDialog} from './SyncConflictDialog';
import type {ReplicaSnapshot,EntryVersion} from './contracts';
import {activeSyncEngine,configureOfflineCopy,enableOfflineCopy,importLegacyDrafts,isOfflineReplica,nativeReplicaCall,notifyReplicaChange,offlineProfile,refreshReplicaStatus,rebindOfflineCopy,replicaPort,replicaStatus,replicaVaultEvents,supportsOfflineReplica} from '../../platform/replica';
import {activateReplica,listReplicaProfiles} from '../../platform/replica-profile';
import {isAndroidLocal,remoteOrigin} from '../../platform/android';

export function ReplicaSettingsPanel({beforeSwitch}:{beforeSwitch:()=>Promise<void>}) {
  const [snapshot,setSnapshot]=useState<ReplicaSnapshot|null>(null);
  const [status,setStatus]=useState(replicaStatus());
  const [review,setReview]=useState(false),[error,setError]=useState(''),[address,setAddress]=useState(offlineProfile?.origin||remoteOrigin);
  const refresh=async()=>{const next=await refreshReplicaStatus();setSnapshot(next);setStatus(replicaStatus());};
  useEffect(()=>{
    let mounted=true;
    const source=replicaVaultEvents();
    const changed=()=>{if(mounted){setStatus(replicaStatus());void replicaPort()?.snapshot().then(s=>{if(mounted)setSnapshot(s);}).catch(e=>{if(mounted)setError(String(e));});}};
    source.addEventListener('status',changed);changed();
    return()=>{mounted=false;source.close();};
  },[]);
  if(!supportsOfflineReplica)return <p>A cópia offline está disponível nos aplicativos Windows e Android.</p>;
  const attempt=async(action:()=>Promise<unknown>)=>{try{setError('');await action();}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const profiles=listReplicaProfiles(localStorage).filter(p=>p.offlineEnabled&&p.replicaId!==offlineProfile?.replicaId);
  const exportVersion=async(v:EntryVersion)=>{
    if(!v.blobHash||v.deleted)throw new Error('Esta versão não contém arquivo.');
    return nativeReplicaCall('exportVersion',{blob:{blobHash:v.blobHash,byteLength:v.byteLength}});
  };
  return <>
    <SyncSettings offlineEnabled={isOfflineReplica} mode={snapshot?.profile.mode||offlineProfile?.mode||'automatic'} origin={offlineProfile?.origin||remoteOrigin}
      status={status||undefined}
      onEnable={async input=>{await beforeSwitch();await enableOfflineCopy(input);}}
      onConfigure={async config=>{if(!config.offlineEnabled)await beforeSwitch();await configureOfflineCopy(config);await refresh();}}
      onSyncNow={async()=>{await activeSyncEngine()?.synchronizeNow();await refresh();}}
      onExportPending={()=>nativeReplicaCall('exportReplica')}
      onReviewConflicts={()=>{void refresh();setReview(true);}}/>
    {!!profiles.length&&<section aria-label="Cópias offline salvas"><h4>Cópias já salvas neste aparelho</h4>{profiles.map(p=><button type="button" key={p.replicaId} onClick={()=>void attempt(async()=>{await beforeSwitch();activateReplica(localStorage,p.replicaId);location.reload();})}>Abrir {p.origin} sem conectar</button>)}</section>}
    {isOfflineReplica&&<section aria-label="Endereço da réplica"><h4>Endereço do mesmo host</h4><p>Uma mudança de IP só é aceita após confirmar a identidade do cofre. As pendências não são enviadas para outro cofre.</p>
      <label className="pm-field">Novo endereço<input value={address} onChange={e=>setAddress(e.target.value)} aria-label="Novo endereço do mesmo host"/></label>
      <button type="button" onClick={()=>void attempt(async()=>{await beforeSwitch();await rebindOfflineCopy(address);})}>Verificar e atualizar endereço</button>
      {isAndroidLocal&&<><p>Rascunhos da conexão antiga podem ser recuperados. Bases desconhecidas ficam como conflito, sem envio automático.</p><button type="button" onClick={()=>void attempt(async()=>{await importLegacyDrafts();await refresh();})}>Recuperar rascunhos antigos</button></>}
    </section>}
    {review&&<SyncConflictDialog conflicts={(snapshot?.conflicts||[]).map(conflict=>({conflict,localHead:snapshot?.entries.find(e=>(e.local||e.base)?.entryId===conflict.entryId)?.localHead??null}))}
      capabilities={{'keep-both':true,local:true,remote:true,merged:true}}
      onResolve={async input=>{try{await replicaPort()!.resolve(input);notifyReplicaChange();}finally{await refresh();}}}
      onLoadVersion={async version=>(await nativeReplicaCall<{content:string}>('readVersion',{version})).content}
      onExportVersion={exportVersion} onClose={()=>setReview(false)}/>}
    {error&&<p role="alert">{error}</p>}
  </>;
}
