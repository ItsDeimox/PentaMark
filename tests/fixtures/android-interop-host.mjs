// Test-only loopback fixture. Never packaged or pointed at an installed vault.
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createHostService} from '../../local/sync/host-service.mjs';
import {createReplicaService} from '../../local/sync/replica-service.mjs';
import {createNativeSyncTransport} from '../../local/sync/transport.mjs';
import {createSyncHandler} from '../../local/sync/routes.mjs';

export async function startInteropHost(port=0){
 const root=await mkdtemp(join(tmpdir(),'pm-android-node-pair-'));
 let host,replica,handler,engine,profile,origin,offline=false,controls=Promise.resolve(),closed=false;
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/__test/state'&&req.method==='GET')return json(res,200,{hello:await(await fetch(origin+'/api/sync/v1/hello')).json(),pcSnapshot:await replica.snapshot()});
   if(req.url==='/__test/pc'&&req.method==='POST'){
    let body='';for await(const part of req){body+=part;if(body.length>65536)throw Error('fixture-body-too-large');}
    const input=JSON.parse(body);const action=async()=>{
     if(input.action==='edit'){const r=await replica.request('/api/note?path='+encodeURIComponent(input.path),'PUT',{content:input.content});if(r.status>=400)throw Error(JSON.stringify(r));return r.data;}
     if(input.action==='read'){const r=await replica.request('/api/note?path='+encodeURIComponent(input.path),'GET');if(r.status!==200)throw Error(JSON.stringify(r));return r.data;}
     if(input.action==='offline'){offline=true;return{offline};}
     if(input.action==='online'){offline=false;return{offline};}
     if(input.action==='restart'){engine.stop();await replica.close();await host.close();await open();return{restarted:true};}
     if(input.action==='sync'){await engine.synchronizeNow();return replica.snapshot();}
     throw Error('unknown-fixture-action');
    };
    const result=controls.then(action);controls=result.catch(()=>{});return json(res,200,await result);
   }
   if(offline)return json(res,503,{error:'fixture-host-offline'});
   if(!await handler(req,res))json(res,404,{error:'not-found'});
  }catch(error){if(!res.headersSent)json(res,500,{error:error.message});else res.destroy(error);}
 });
 async function open(){
  host=await createHostService({dataRoot:join(root,'host'),vaultRoot:join(root,'vault')});
  handler=await createSyncHandler({host,maxFileBytes:40*1048576,permission:()=> 'admin',authorizeOperation:async()=>true});
  profile??={vaultId:host.vaultId,serverId:host.serverId,replicaId:randomUUID(),origin,mode:'manual',offlineEnabled:true};
  replica=await createReplicaService({userData:join(root,'pc'),profile});
  const remote=await createNativeSyncTransport({profile,objects:replica.objects,stagingRoot:join(replica.root,'staging')});
  engine=createSyncEngine({replica,remote});
 }
 let createSyncEngine;
 async function close(){if(closed)return;closed=true;engine?.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await replica?.close();await host?.close();await rm(root,{recursive:true,force:true});}
 try{
  await build({entryPoints:[fileURLToPath(new URL('../../src/features/sync/engine.ts',import.meta.url))],outfile:join(root,'engine.mjs'),bundle:true,format:'esm',platform:'node'});
  ({createSyncEngine}=await import(pathToFileURL(join(root,'engine.mjs')).href));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;await open();await engine.synchronizeNow();
  await replica.request('/api/note?path=Shared.md','PUT',{content:'PC base'});await engine.synchronizeNow();
  const snapshot=await replica.snapshot();if(snapshot.status.pendingCount||snapshot.status.conflictCount||!snapshot.status.lastSuccessfulSync)throw Error('fixture-seed-not-synced');
  return{origin,close};
 }catch(error){await close();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const fixture=await startInteropHost(Number(process.argv[2]||35491));
 console.log('INTEROP_READY '+fixture.origin);
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await fixture.close();};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
