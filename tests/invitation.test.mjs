import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'pm-invite-'));
test.after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:['src/platform/invitation.ts'],outfile:join(dir,'invitation.mjs'),bundle:true,platform:'node',format:'esm'});
const {parseInvitation,createInvitation}=await import(pathToFileURL(join(dir,'invitation.mjs')));
const invite={address:'http://100.100.10.20:3417',inviteUrl:'https://login.tailscale.com/admin/invite/one_time-123',name:'Cofre do André'};
test('invitation round-trips host, official invite and Unicode name without a credential',()=>assert.deepEqual(parseInvitation(createInvitation(invite)),invite));
test('arbitrary destinations and credential-bearing links cannot enter the privileged app',()=>{
  for(const address of ['http://127.0.0.1:3417','https://example.com','http://user:pass@100.100.1.2:3417','http://100.100.1.2:3417/api/config'])assert.throws(()=>createInvitation({...invite,address}));
  for(const inviteUrl of ['https://evil.example/admin/invite/x','https://login.tailscale.com.evil.example/admin/invite/x','javascript:alert(1)','https://login.tailscale.com/admin/invite/x?redirect=evil'])assert.throws(()=>createInvitation({...invite,inviteUrl}));
});
test('malformed, duplicate, oversized and unknown invitation fields are rejected',()=>{
  for(const value of ['pentamark://join?v=2',createInvitation(invite)+'&host=http://100.100.1.2',createInvitation(invite)+'&token=secret',createInvitation(invite)+'#test','pentamark://other','x'.repeat(4097)])assert.throws(()=>parseInvitation(value));
});

test('legacy Android opaque custom-scheme URL behavior cannot lose a valid invitation',()=>{
  const NativeURL=globalThis.URL;
  globalThis.URL=class extends NativeURL {
    constructor(value,...args){super(value,...args);if(this.protocol==='pentamark:')Object.defineProperties(this,{hostname:{value:''},pathname:{value:'//join'}});}
  };
  try{assert.deepEqual(parseInvitation(createInvitation(invite)),invite);}
  finally{globalThis.URL=NativeURL;}
});
test('explicit custom authority validation rejects lookalikes, credentials, ports and extra paths',()=>{
  const query=createInvitation(invite).split('?')[1];
  for(const authority of ['join.evil.test','user@join','join:99','join/path','join\\evil'])assert.throws(()=>parseInvitation(`pentamark://${authority}?${query}`));
});
