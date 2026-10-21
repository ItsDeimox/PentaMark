import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {win32} from 'node:path';

const require = createRequire(import.meta.url);
let createTailscaleSharing;
try { ({createTailscaleSharing} = require('../desktop/tailscale.cjs')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

const KEY = 'tskey-api-abcdefghijklmnopqrst-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const OTHER_KEY = 'tskey-api-zyxwvutsrqponmlkjihg-123456ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const IP = '100.100.10.2';
const ID = 'n5SUKe8CNTRL';
const CLI = 'C:\\Program Files\\Tailscale\\tailscale.exe';
const GUI = 'C:\\Program Files\\Tailscale\\tailscale-ipn.exe';
const INVITE = 'https://login.tailscale.com/admin/invite/abcdef123456';
const native = () => ({BackendState:'Running', Self:{ID, PublicKey:'nodekey:NOT_AN_API_ID', HostName:'meu-pc', DNSName:'meu-pc.tail123.ts.net.', Online:true, TailscaleIPs:[IP, 'fd7a:115c:a1e0::1']}});
const device = () => ({id:'123456', nodeId:ID, addresses:[IP, 'fd7a:115c:a1e0::1'], hostname:'meu-pc', name:'meu-pc.tail123.ts.net'});
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers:{'content-type':'application/json'}});
const enoent = () => Object.assign(new Error('missing'), {code:'ENOENT'});

function fixture(options = {}) {
  assert.equal(typeof createTailscaleSharing, 'function', 'backend factory must exist');
  const files = new Map();
  const calls = {exec:[], fetch:[], writes:[], external:[], paths:[]};
  const state = {native:native(), installed:true, encryption:true, writeFails:false, renameFails:false, decryptFails:false, replies:[], ...options};
  const fs = {
    async access(path) { if (!state.installed || !(state.executables || [CLI,GUI]).includes(path)) throw enoent(); },
    async stat(path) { if (!files.has(path)) throw enoent(); return {size:files.get(path).length}; },
    async readFile(path) { if (!files.has(path)) throw enoent(); return Buffer.from(files.get(path)); },
    async mkdir() {},
    async writeFile(path, bytes, config) {
      if (state.writeFails) throw new Error(KEY);
      if (config.flag === 'wx' && files.has(path)) throw new Error('exists');
      calls.writes.push({path,bytes:Buffer.from(bytes),config}); files.set(path,Buffer.from(bytes));
    },
    async rename(from,to) { if (state.renameFails) throw new Error(KEY); files.set(to,files.get(from)); files.delete(from); },
    async unlink(path) { if (!files.delete(path)) throw enoent(); },
  };
  const safeStorage = {
    isEncryptionAvailable:() => state.encryption,
    encryptString(value) { return Buffer.from([...Buffer.from(value)].map(byte => byte ^ 0xa5)); },
    decryptString(bytes) { if (state.decryptFails) throw new Error(KEY); return Buffer.from([...bytes].map(byte => byte ^ 0xa5)).toString(); },
  };
  const dependencies = {
    fs, platform:state.platform || 'win32', env:state.env || {ProgramFiles:'C:\\Program Files', PATH:'C:\\untrusted'}, timeoutMs:50,
    execFile(path,args,config,callback) {
      calls.exec.push({path,args,config});
      callback(state.execError || null, state.stdout ?? JSON.stringify(state.native), '');
    },
    async fetch(url,config) {
      calls.fetch.push({url,config});
      const reply = state.replies.shift();
      if (typeof reply === 'function') return reply(url,config);
      if (reply instanceof Error) throw reply;
      return reply || (config.method === 'POST' ? json([{inviteUrl:INVITE,multiUse:false,allowExitNode:false}]) : json(device()));
    },
  };
  const args = {
    app:{getPath(name) { assert.equal(name,'userData'); return 'C:\\PentaMark-test-userData'; }},
    safeStorage,
    shell:{async openExternal(url) { calls.external.push(url); },async openPath(path) { calls.paths.push(path); return ''; }},
    getPort:() => state.port ?? 3417,
  };
  return {api:createTailscaleSharing(args,dependencies), reopen:() => createTailscaleSharing(args,dependencies),state,calls,files};
}

test('status uses fixed official executable, native stable ID and bounded shell-free command', async () => {
  const {api,calls} = fixture();
  assert.deepEqual(await api.status(), {installed:true,connected:true,configured:false,deviceName:'meu-pc',address:'http://100.100.10.2:3417'});
  assert.equal(calls.exec[0].path,CLI);
  assert.deepEqual(calls.exec[0].args,['status','--json']);
  assert.equal(calls.exec[0].config.shell,false);
  assert.equal(calls.exec[0].config.windowsHide,true);
  assert.ok(calls.exec[0].config.timeout > 0 && calls.exec[0].config.timeout <= 10000);
  assert.ok(calls.exec[0].config.maxBuffer <= 1024 * 1024);
  assert.equal(calls.fetch.length,0);
});

test('missing installation and unsupported platforms never search PATH or run a command', async () => {
  const {api,calls} = fixture({installed:false});
  assert.deepEqual(Object.fromEntries(Object.entries(await api.status()).filter(([key]) => key !== 'error')), {installed:false,connected:false,configured:false});
  assert.equal(calls.exec.length,0);
  const unsupported=fixture({platform:'linux'});
  assert.equal((await unsupported.api.status()).installed,false);
  assert.equal(unsupported.calls.exec.length,0);
});

test('known Program Files environment path supports installations on another drive', async () => {
  const alternate='D:\\Program Files\\Tailscale\\tailscale.exe';
  const {api,calls} = fixture({env:{ProgramFiles:'D:\\Program Files'},executables:[alternate]});
  assert.equal((await api.status()).installed,true);
  assert.equal(calls.exec[0].path,alternate);
});

test('malformed native status and command failure return safe disconnected status', async () => {
  for (const options of [{stdout:'null'},{stdout:'[]'},{stdout:'{}'},{stdout:'not json'},{execError:new Error(KEY)}]) {
    const {api,calls} = fixture(options);
    const result=await api.status();
    assert.equal(result.connected,false); assert.ok(result.error);
    assert.ok(!JSON.stringify(result).includes(KEY)); assert.equal(calls.fetch.length,0);
  }
});

test('save validates only current device with Basic authentication and persists ciphertext in userData', async () => {
  const {api,calls,files,reopen} = fixture();
  const result = await api.saveKey(KEY);
  assert.equal(result.configured,true);
  assert.equal(calls.fetch.length,1);
  const {url,config} = calls.fetch[0];
  assert.equal(url,'https://api.tailscale.com/api/v2/device/n5SUKe8CNTRL');
  assert.equal(config.method,'GET');
  assert.equal(config.redirect,'error');
  assert.equal(config.headers.Authorization,`Basic ${Buffer.from(`${KEY}:`).toString('base64')}`);
  assert.ok(config.signal instanceof AbortSignal);
  assert.equal(files.size,1);
  for (const [path,bytes] of files) {
    assert.equal(win32.dirname(path),'C:\\PentaMark-test-userData');
    assert.ok(!bytes.toString().includes(KEY));
  }
  assert.equal(calls.writes[0].config.mode,0o600);
  assert.equal((await reopen().status()).configured,true);
  assert.ok(!JSON.stringify(result).includes(KEY));
});

test('createInvite revalidates device and posts one-use device sharing without exit-node access', async () => {
  const {api,calls} = fixture();
  await api.saveKey(KEY);
  assert.deepEqual(await api.createInvite(),{inviteUrl:INVITE,address:'http://100.100.10.2:3417',deviceName:'meu-pc'});
  assert.deepEqual(calls.fetch.map(call => call.config.method),['GET','GET','POST']);
  const post = calls.fetch.at(-1);
  assert.equal(post.url,'https://api.tailscale.com/api/v2/device/n5SUKe8CNTRL/device-invites');
  assert.deepEqual(JSON.parse(post.config.body),[{multiUse:false,allowExitNode:false}]);
  assert.equal(post.config.redirect,'error');
  assert.equal(post.config.headers['Content-Type'],'application/json');
  assert.ok(!post.config.body.includes(KEY));
});

test('invalid key types and auth/client keys are rejected before any network or storage write', async () => {
  for (const key of ['',null,{},'tskey-auth-secret','tskey-client-secret','tskey-api-short',`${KEY}\nother`]) {
    const {api,calls,files} = fixture();
    await assert.rejects(api.saveKey(key),/chave.*API/i);
    assert.equal(calls.fetch.length,0); assert.equal(files.size,0);
  }
});

test('unavailable secure storage fails closed without requests or plaintext fallback', async () => {
  const {api,calls,files,state} = fixture({encryption:false});
  await assert.rejects(api.saveKey(KEY),/criptograf/i);
  assert.equal(calls.fetch.length,0); assert.equal(files.size,0);
  state.encryption = true; await api.saveKey(KEY); state.encryption = false;
  assert.equal((await api.status()).configured,false);
  await assert.rejects(api.createInvite(),/criptograf/i);
  assert.equal(calls.fetch.length,1);
});

test('disconnected/offline clients, invalid Self ID and addresses cannot save or invite', async () => {
  for (const mutate of [
    data => {data.BackendState='Stopped';}, data => {data.Self.Online=false;},
    data => {data.Self.ID='nodekey:123';}, data => {delete data.Self.ID;},
    ...['100.63.255.255','100.128.0.1','127.0.0.1','100.100.999.1','100.064.0.1'].map(ip => data => {data.Self.TailscaleIPs=[ip];}),
  ]) {
    const {api,state,calls} = fixture(); mutate(state.native);
    assert.equal((await api.status()).connected,false);
    await assert.rejects(api.saveKey(KEY)); await assert.rejects(api.createInvite());
    assert.equal(calls.fetch.length,0);
  }
});

test('100.64/10 boundaries are accepted and getPort is validated', async () => {
  for (const ip of ['100.64.0.0','100.127.255.255']) {
    const {api,state} = fixture(); state.native.Self.TailscaleIPs=[ip];
    assert.equal((await api.status()).address,`http://${ip}:3417`);
  }
  for (const port of [0,65536,'3417',NaN,3.5]) {
    const {api,calls} = fixture({port});
    await assert.rejects(api.saveKey(KEY),/porta/i); assert.equal(calls.fetch.length,0);
  }
});

test('wrong API node ID or IP is rejected before persistence and before POST', async () => {
  for (const bad of [{...device(),nodeId:'nOTHER'},{...device(),addresses:['100.100.10.3']}]) {
    const {api,state,files,calls} = fixture(); state.replies.push(json(bad));
    await assert.rejects(api.saveKey(KEY),/dispositivo/i); assert.equal(files.size,0);
    await api.saveKey(KEY); state.replies.push(json(bad));
    await assert.rejects(api.createInvite(),/dispositivo/i);
    assert.equal(calls.fetch.filter(call => call.config.method === 'POST').length,0);
  }
});

test('account/device switch invalidates configuration and blocks sharing with saved key', async () => {
  const {api,state,calls} = fixture(); await api.saveKey(KEY); state.native.Self.ID='nOTHER';
  assert.equal((await api.status()).configured,false);
  await assert.rejects(api.createInvite(),/dispositivo/i); assert.equal(calls.fetch.length,1);
});

test('device switch while validation is in flight cannot persist or issue invite', async () => {
  const {api,state,files,calls} = fixture();
  state.replies.push(() => {state.native.Self.ID='nOTHER'; return json(device());});
  await assert.rejects(api.saveKey(KEY),/dispositivo/i); assert.equal(files.size,0);
  state.native=native(); await api.saveKey(KEY);
  state.replies.push(() => {state.native.Self.Online=false; return json(device());});
  await assert.rejects(api.createInvite());
  assert.equal(calls.fetch.filter(call => call.config.method === 'POST').length,0);
});

test('API failures produce Portuguese errors, never disclose response secrets, and invalidate rejected saved keys', async () => {
  for (const [code,pattern] of [[401,/expirad|inválid/i],[403,/permiss/i],[404,/dispositivo/i],[429,/aguard|tentativ/i],[500,/Tailscale/i]]) {
    const {api,state} = fixture(); await api.saveKey(KEY); state.replies.push(json({message:KEY},code));
    await assert.rejects(api.createInvite(),error => pattern.test(error.message) && !error.message.includes(KEY));
    if ([401,403].includes(code)) assert.equal((await api.status()).configured,false);
  }
});

test('failed save preserves previous working credential and cleans temporary ciphertext', async () => {
  for (const failure of ['writeFails','renameFails']) {
    const {api,state,files} = fixture(); await api.saveKey(KEY); const before = [...files].map(([path,bytes]) => [path,Buffer.from(bytes)]);
    state[failure]=true;
    await assert.rejects(api.saveKey(OTHER_KEY),error => /salvar/i.test(error.message) && !error.message.includes(KEY));
    assert.deepEqual([...files],before); assert.equal((await api.status()).configured,true);
  }
  const {api,state,files} = fixture(); await api.saveKey(KEY); const before=[...files];
  state.replies.push(json({message:OTHER_KEY},401)); await assert.rejects(api.saveKey(OTHER_KEY));
  assert.deepEqual([...files],before); assert.equal((await api.status()).configured,true);
});

test('corrupt/undecryptable storage is unconfigured and forgetting is idempotent', async () => {
  const {api,state,files,calls} = fixture(); await api.saveKey(KEY); state.decryptFails=true;
  assert.equal((await api.status()).configured,false);
  await assert.rejects(api.createInvite(),error => !error.message.includes(KEY));
  await api.forgetKey(); await api.forgetKey();
  assert.equal(files.size,0); assert.equal(calls.fetch.length,1);
});

test('corrupted ciphertext or invalid decrypted credential cannot enable sharing', async () => {
  for (const bytes of [Buffer.from('garbage'),Buffer.alloc(0),Buffer.alloc(20000)]) {
    const {api,files,calls} = fixture(); await api.saveKey(KEY);
    files.set([...files.keys()][0],bytes);
    assert.equal((await api.status()).configured,false);
    await assert.rejects(api.createInvite()); assert.equal(calls.fetch.length,1);
  }
});

test('forget waits for an in-flight save and leaves no credential behind', async () => {
  const {api,state,files} = fixture();
  let release;
  const pending = new Promise(resolve => {release=resolve;});
  state.replies.push(() => pending);
  const save=api.saveKey(KEY);
  const forget=api.forgetKey();
  release(json(device()));
  await save; assert.equal((await forget).configured,false);
  assert.equal(files.size,0);
});

test('redirects, oversized responses, malformed JSON, network errors and timeout never leak or persist', async () => {
  for (const reply of [
    new Response(null,{status:302,headers:{location:'https://evil.example'}}),
    json({message:'x'.repeat(300000)}), new Response('{invalid'), new Error(KEY),
    () => new Promise(() => {}),
    () => new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode('{'));}})),
  ]) {
    const {api,state,files,calls} = fixture(); state.replies.push(reply);
    await assert.rejects(api.saveKey(KEY),error => !error.message.includes(KEY));
    assert.equal(files.size,0); assert.equal(calls.fetch.length,1);
    assert.equal(calls.fetch[0].config.redirect,'error');
  }
});

test('invite response accepts only exact HTTPS login.tailscale.com/admin/invite/token URLs', async () => {
  for (const inviteUrl of [
    'http://login.tailscale.com/admin/invite/abc', 'https://login.tailscale.com.evil.example/admin/invite/abc',
    'https://user@login.tailscale.com/admin/invite/abc', 'https://login.tailscale.com:443/admin/invite/abc',
    'https://login.tailscale.com/admin/invite/abc?token=secret', 'https://login.tailscale.com/admin/invite/abc#secret',
    'https://login.tailscale.com/admin/invite/../settings', 'https://admin.tailscale.com/admin/invite/abc',
    'https://login.tailscale.com/admin/invite/abc/def', `https://login.tailscale.com/admin/invite/${KEY}`,
  ]) {
    const {api,state} = fixture(); await api.saveKey(KEY);
    state.replies.push(json(device()),json([{inviteUrl}]));
    await assert.rejects(api.createInvite(),error => /convite/i.test(error.message) && !error.message.includes(KEY));
  }
});

test('setup opens only allowlisted pages or the installed official GUI', async () => {
  const {api,calls} = fixture();
  await api.openSetup('install'); await api.openSetup('keys'); await api.openSetup('login');
  assert.deepEqual(calls.external,['https://tailscale.com/download/windows','https://login.tailscale.com/admin/settings/keys']);
  assert.deepEqual(calls.paths,[GUI]); assert.equal(calls.exec.length,0);
  for (const step of ['https://evil.example','cmd.exe','LOGIN',null]) await assert.rejects(api.openSetup(step));
  const missing=fixture({installed:false}); await assert.rejects(missing.api.openSetup('login'),/instal/i);
});
