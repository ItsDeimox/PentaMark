import { isAndroidLocal, nativeRequest } from '../platform/android';
import { activeVaultContext, notifyReplicaChange, isOfflineReplica } from '../platform/replica';
import { createVaultRouter } from '../platform/vault-context';
import {flushReplicaDrafts} from '../platform/replica-profile';

export class RequestError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(status: number, data: Record<string, unknown>) {
    super(String(data.error || `Erro ${status}`));
    this.name = "RequestError";
    this.status = status;
    this.data = data;
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const captured=activeVaultContext(),method=(init?.method||'GET').toUpperCase();
  const structural=captured.kind==='offline-replica'&&['PATCH','DELETE'].includes(method);
  if(structural)document.dispatchEvent(new CustomEvent('pentamark:storage-busy',{detail:true}));
  try{
    if(structural&&captured.kind==='offline-replica'){
      const path=new URL(url,'http://local').searchParams.get('path');
      if(path)for(const saved of await flushReplicaDrafts(localStorage,captured.profile,path,captured.replica.request))document.dispatchEvent(new CustomEvent('pentamark:draft-saved',{detail:saved}));
    }
    const {status,data}=await route(url,init);
    if (status >= 400) throw new RequestError(status, data);
    if(isOfflineReplica && init?.method && !['GET','HEAD'].includes(init.method.toUpperCase()) && !url.startsWith('/api/presence'))notifyReplicaChange();
    return data as T;
  }finally{if(structural)document.dispatchEvent(new CustomEvent('pentamark:storage-busy',{detail:false}));}
}
const route=createVaultRouter(activeVaultContext,async(url,init)=>{
  if(isAndroidLocal)return nativeRequest(url,init);
  const headers = new Headers(init?.headers);
  const clientId = localStorage.getItem("pentamark:client-id");
  if (clientId) headers.set("X-PentaMark-Client", clientId);
  return fetch(url, { ...init, headers }).then(async (response) => {
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {status:response.status,data};
  });
});
