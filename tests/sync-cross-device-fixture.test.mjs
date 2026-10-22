import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInteropHost} from './fixtures/android-interop-host.mjs';

test('cross-device host fixture uses real durable PC replica and survives offline restart',async t=>{
 const fixture=await startInteropHost();t.after(()=>fixture.close());
 const call=async(action,extra={})=>{const response=await fetch(fixture.origin+'/__test/pc',{method:'POST',body:JSON.stringify({action,...extra})});assert.equal(response.status,200);return response.json();};
 const state=await(await fetch(fixture.origin+'/__test/state')).json();
 assert.ok(state.hello.vaultId);assert.equal((await call('read',{path:'Shared.md'})).content,'PC base');
 await call('offline');await call('edit',{path:'Shared.md',content:'PC offline bytes'});
 assert.equal((await fetch(fixture.origin+'/api/sync/v1/hello')).status,503);
 await call('restart');assert.equal((await call('read',{path:'Shared.md'})).content,'PC offline bytes');
 await call('online');const result=await call('sync');assert.equal(result.status.pendingCount,0);assert.equal(result.status.conflictCount,0);
 const snapshot=await(await fetch(fixture.origin+'/api/sync/v1/snapshot',{method:'POST',body:'{}'})).json();
 const entry=snapshot.entries.find(e=>e.path==='Shared.md');assert.ok(entry);
 const bytes=await(await fetch(fixture.origin+'/api/sync/v1/blobs/'+entry.blobHash)).text();assert.equal(bytes,'PC offline bytes');
});
