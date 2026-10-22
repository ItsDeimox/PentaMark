import type { ApiResponse, ReplicaPort, ReplicaProfile } from '../features/sync/contracts';

export type ActiveVaultContext = Readonly<
  {kind:'local-host'} | {kind:'live-remote';origin:string} |
  {kind:'offline-replica';profile:Readonly<ReplicaProfile>;replica:ReplicaPort}
>;
type Dispatcher = (url:string,init?:RequestInit)=>Promise<ApiResponse>;
/** Capture destination before the first asynchronous boundary; never fall back on an error. */
export function createVaultRouter(context:()=>ActiveVaultContext, live:Dispatcher):Dispatcher {
  return async(url,init)=>{
    const captured=context();
    if(captured.kind!=='offline-replica')return live(url,init);
    const method=(init?.method||'GET').toUpperCase();
    // Presence/locks belong to a live collaborative session, not to offline edits.
    if(/^\/api\/presence(?:\?|$)/.test(url))return{status:200,data:{connections:[],locks:[]}};
    let body:unknown;
    if(init?.body!==undefined && init.body!==null) {
      if(typeof init.body!=='string')throw new Error('native-import-required');
      body=JSON.parse(init.body);
    }
    return captured.replica.request(url,method,body);
  };
}
