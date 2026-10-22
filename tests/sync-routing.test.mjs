import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir=await mkdtemp(join(tmpdir(),'pm-sync-router-'));
after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:['src/platform/vault-context.ts'],outfile:join(dir,'router.mjs'),bundle:true,format:'esm',platform:'node'});
const {createVaultRouter}=await import(pathToFileURL(join(dir,'router.mjs')).href);
test('offline replica routes all content locally without consulting network state',async()=>{
 const calls=[];const context=Object.freeze({kind:'offline-replica',replica:{request:async(...args)=>{calls.push(args);return{status:200,data:{content:'saved'}};}}});
 const router=createVaultRouter(()=>context,async()=>{throw Error('network forbidden');});
 assert.deepEqual(await router('/api/note?path=a.md',{method:'PUT',body:JSON.stringify({content:'new'})}),{status:200,data:{content:'saved'}});
 assert.deepEqual(calls,[['/api/note?path=a.md','PUT',{content:'new'}]]);
});
test('inflight requests retain the exact captured replica when active context changes',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);const calls=[];
 let context={kind:'offline-replica',replica:{request:async()=>{calls.push('A');await pending;return{status:200,data:{identity:'A'}};}}};
 const router=createVaultRouter(()=>context,async()=>{throw Error('network forbidden');});
 const result=router('/api/note?path=a.md');context={kind:'offline-replica',replica:{request:async()=>{calls.push('B');return{status:200,data:{identity:'B'}};}}};
 release();assert.equal((await result).data.identity,'A');assert.deepEqual(calls,['A']);
});
test('failed or missing local file never falls back to live host or empty text',async()=>{
 const router=createVaultRouter(()=>({kind:'offline-replica',replica:{request:async()=>({status:404,data:{error:'unavailable-offline'}})}}),async()=>{throw Error('network forbidden');});
 assert.deepEqual(await router('/api/note?path=missing.md'),{status:404,data:{error:'unavailable-offline'}});
});
test('presence stays local and binary bodies require native import instead of JSON conversion',async()=>{
 const router=createVaultRouter(()=>({kind:'offline-replica',replica:{request:async()=>{throw Error('not allowed');}}}),async()=>{throw Error('network forbidden');});
 assert.equal((await router('/api/presence',{method:'POST'})).status,200);
 await assert.rejects(router('/api/upload',{method:'POST',body:new Blob(['binary'])}),/native-import-required/);
});
test('host and live-remote contexts use original dispatcher unchanged',async()=>{
 const init={method:'GET'};let seen;
 const router=createVaultRouter(()=>({kind:'local-host'}),async(url,options)=>{seen=[url,options];return{status:200,data:{ok:true}};});
 await router('/api/state',init);assert.deepEqual(seen,['/api/state',init]);
});
