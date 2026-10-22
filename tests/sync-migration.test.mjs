import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'pm-sync-migration-'));
after(() => rm(dir, { recursive: true, force: true }));
await build({entryPoints:['src/platform/replica-profile.ts'],outfile:join(dir,'profile.mjs'),bundle:true,format:'esm',platform:'node'});
const {saveReplicaProfile,readActiveReplica,activateReplica,clearActiveReplica,migrateProtectedDrafts,replicaDraftPrefix,flushReplicaDrafts} = await import(pathToFileURL(join(dir,'profile.mjs')).href);
const profile = {vaultId:'11111111-1111-4111-8111-111111111111',serverId:'22222222-2222-4222-8222-222222222222',replicaId:'33333333-3333-4333-8333-333333333333',origin:'http://100.100.1.2:3417',offlineEnabled:true,mode:'manual'};
function storage(){const map=new Map();return{get length(){return map.size;},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
test('persisted replica opens by identity without network and returned context cannot mutate storage',()=>{
 const s=storage();saveReplicaProfile(s,profile);activateReplica(s,profile.replicaId);
 const found=readActiveReplica(s);assert.deepEqual(found,profile);assert(Object.isFrozen(found));
 clearActiveReplica(s);assert.equal(readActiveReplica(s),null);activateReplica(s,profile.replicaId);assert.deepEqual(readActiveReplica(s),profile);
});
test('origin reuse cannot replace a different identity or silently change a bound origin',()=>{
 const s=storage();saveReplicaProfile(s,profile);activateReplica(s,profile.replicaId);
 assert.throws(()=>saveReplicaProfile(s,{...profile,vaultId:'44444444-4444-4444-8444-444444444444'}),/identity/);
 assert.throws(()=>saveReplicaProfile(s,{...profile,origin:'http://100.100.1.3:3417'}),/identity/);
 assert.deepEqual(readActiveReplica(s),profile);
});
test('draft scopes use identities instead of address or independent Android cofre',()=>{
 assert.notEqual(replicaDraftPrefix(profile),replicaDraftPrefix({...profile,replicaId:'44444444-4444-4444-8444-444444444444'}));
 assert(!replicaDraftPrefix(profile).includes(profile.origin));
});
test('migration requires verified host identity and does not touch independent drafts',async()=>{
 const s=storage();s.setItem('pentamark:android:draft:a.md',JSON.stringify({content:'private',revision:'old'}));
 const key=`pentamark:android:remote:${encodeURIComponent(profile.origin)}:draft:a.md`;
 s.setItem(key,JSON.stringify({content:'mine',revision:'old'}));let calls=0;
 await assert.rejects(migrateProtectedDrafts(s,profile,{vaultId:'wrong',serverId:profile.serverId},async()=>{calls++;}),/identity/);
 assert.equal(calls,0);assert(s.getItem(key));assert(s.getItem('pentamark:android:draft:a.md'));
});
test('failed import retains original, durable receipt alone permits removal, retry id stable',async()=>{
 const s=storage();const key=`pentamark:android:remote:${encodeURIComponent(profile.origin)}:draft:a.md`;
 const original=JSON.stringify({content:'mine',revision:'unknown-legacy'});s.setItem(key,original);
 let first;
 await assert.rejects(migrateProtectedDrafts(s,profile,profile,async input=>{first=input;throw Error('disk-full');}),/disk-full/);
 assert.equal(s.getItem(key),original);
 await assert.rejects(migrateProtectedDrafts(s,profile,profile,async()=>({durable:false})),/not-durable/);
 assert.equal(s.getItem(key),original);
 await migrateProtectedDrafts(s,profile,profile,async input=>{assert.deepEqual(input,first);assert.equal(input.legacyRevision,'unknown-legacy');return{durable:true,migrationId:input.migrationId};});
 assert.equal(s.getItem(key),null);
});
test('new draft written while native import runs is never removed',async()=>{
 const s=storage();const key=`pentamark:android:remote:${encodeURIComponent(profile.origin)}:draft:a.md`;
 s.setItem(key,JSON.stringify({content:'A',revision:'old'}));
 await migrateProtectedDrafts(s,profile,profile,async input=>{s.setItem(key,JSON.stringify({content:'B',revision:'old'}));return{durable:true,migrationId:input.migrationId};});
 assert.equal(JSON.parse(s.getItem(key)).content,'B');
});
test('structural mutations flush only matching replica drafts locally before proceeding',async()=>{
 const s=storage(),prefix=replicaDraftPrefix(profile);s.setItem(prefix+'folder/a.md',JSON.stringify({content:'pending',revision:'base'}));s.setItem(prefix+'other.md',JSON.stringify({content:'other',revision:'old'}));
 const calls=[];const saved=await flushReplicaDrafts(s,profile,'folder',async(url,method,body)=>{calls.push({url,method,body});return{status:200,data:method==='GET'?{content:'base',revision:'base'}:{revision:'new'}};});
 assert.deepEqual(calls.map(c=>c.method),['GET','PUT']);assert.equal(calls[1].body.baseRevision,'base');assert.equal(s.getItem(prefix+'folder/a.md'),null);assert(s.getItem(prefix+'other.md'));assert.equal(saved[0].content,'pending');
});
test('failed local draft flush blocks structural mutation and preserves original text',async()=>{
 const s=storage(),key=replicaDraftPrefix(profile)+'a.md',raw=JSON.stringify({content:'mine',revision:'old'});s.setItem(key,raw);
 await assert.rejects(flushReplicaDrafts(s,profile,'a.md',async()=>({status:409,data:{error:'stale'}})),/draft/);assert.equal(s.getItem(key),raw);
});
test('new draft during local flush is preserved and blocks rename/delete',async()=>{
 const s=storage(),key=replicaDraftPrefix(profile)+'a.md';s.setItem(key,JSON.stringify({content:'A',revision:'old'}));
 await assert.rejects(flushReplicaDrafts(s,profile,'a.md',async(_url,method)=>{if(method==='PUT')s.setItem(key,JSON.stringify({content:'B',revision:'old'}));return{status:200,data:{content:'old',revision:'new'}};}),/draft-changed/);assert.equal(JSON.parse(s.getItem(key)).content,'B');
});
