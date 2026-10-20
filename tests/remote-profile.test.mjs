import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const dir=await mkdtemp(join(tmpdir(),'pm-remote-test-'));
after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:['src/platform/remote-profile.ts'],outfile:join(dir,'profile.mjs'),bundle:true,format:'esm',platform:'node'});
const {normalizePcOrigin,readRemoteProfile,draftPrefix}=await import(pathToFileURL(join(dir,'profile.mjs')).href);
test('Tailscale addresses normalize without allowing public or local-network destinations',()=>{
  assert.equal(normalizePcOrigin('100.100.10.2:3417'),'http://100.100.10.2:3417');
  assert.equal(normalizePcOrigin('https://PC.tailabcd.ts.net/'),'https://pc.tailabcd.ts.net');
  for(const value of ['http://192.168.1.2:3417','http://127.0.0.1','http://example.com','http://100.63.1.2','http://100.128.1.2','http://pc.tail.ts.net','https://notts.net','https://pc.ts.net.evil.com']) assert.throws(()=>normalizePcOrigin(value),value);
});
test('connection profiles reject credentials, paths and query secrets rather than silently stripping them',()=>{
  for(const value of ['http://user:pass@100.100.1.2:3417','http://100.100.1.2/api/state','http://100.100.1.2?token=x','https://pc.ts.net/#a','file:///data/vault']) assert.throws(()=>normalizePcOrigin(value),value);
});
test('corrupted persisted profile falls back to local and distinct origins have distinct draft scopes',()=>{
  assert.equal(readRemoteProfile({getItem:()=>'{bad'}),null);
  assert.equal(readRemoteProfile({getItem:()=>JSON.stringify({origin:'https://evil.com'})}),null);
  assert.deepEqual(readRemoteProfile({getItem:()=>JSON.stringify({origin:'http://100.100.1.2:3417'})}),{origin:'http://100.100.1.2:3417'});
  assert.equal(draftPrefix(''),'pentamark:android:draft:');
  assert.notEqual(draftPrefix('http://100.100.1.2:3417'),draftPrefix('http://100.100.1.3:3417'));
});
