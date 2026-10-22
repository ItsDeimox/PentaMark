import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';

const moduleURL = new URL('../local/sync/host-service.mjs', import.meta.url);
const implementation = existsSync(moduleURL) ? await import(moduleURL) : {};
async function fixture(t, options = {}) {
  assert.equal(typeof implementation.createHostService, 'function', 'host durable coordinator is required');
  const root = await mkdtemp(join(tmpdir(), 'pm-host-'));
  const vaultRoot = join(root, 'vault'), dataRoot = join(root, 'private');
  await mkdir(vaultRoot);
  let host = await implementation.createHostService({ vaultRoot, dataRoot, ...options });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  return { root, vaultRoot, dataRoot, get host() { return host; }, async reopen() {
    await host.close(); host = await implementation.createHostService({ vaultRoot, dataRoot }); return host;
  } };
}
async function put(f, content, base = null, path = 'a.md') {
  const blob = await f.host.objects.put(Buffer.from(content));
  return { vaultId: f.host.vaultId, replicaId: 'test-replica', opId: randomUUID(), entryId: base?.entryId ?? randomUUID(),
    kind: 'put', baseRevision: base?.revision ?? null, after: { path, kind: 'note', ...blob }, dependsOn: [] };
}
test('conditional writes preserve incoming, previous and external versions; replay is durable', async t => {
  const f = await fixture(t);
  const op = await put(f, 'base');
  const first = await f.host.apply(op);
  assert.equal(first.status, 'applied');
  const incoming = await put(f, 'incoming', first.confirmed);
  await writeFile(join(f.vaultRoot, 'a.md'), 'external');
  const conflict = await f.host.apply(incoming);
  assert.equal(conflict.status, 'conflict');
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'external');
  for (const [version, text] of [[conflict.conflict.base, 'base'], [conflict.conflict.local, 'incoming'], [conflict.conflict.remote, 'external']])
    assert.equal(await readFile(f.host.objects.path(version.blobHash), 'utf8'), text);
  const before = await f.host.readChanges(null, 100);
  await f.reopen();
  assert.equal((await f.host.apply(op)).status, 'already-applied');
  assert.deepEqual(await f.host.apply(incoming), conflict);
  assert.deepEqual(await f.host.readChanges(null, 100), before);
  assert.equal(f.host.history(first.confirmed.entryId).length, 2);
});
for (const boundary of ['after-object', 'after-intent', 'after-rename', 'before-commit']) {
  for (const deleting of [false, true]) test(`recover ${deleting ? 'delete' : 'put'} at ${boundary}`, async t => {
    let armed = false;
    const f = await fixture(t, { interrupt: async name => { if (armed && name === boundary) throw new Error(`interrupted:${name}`); } });
    const first = await f.host.apply(await put(f, 'old'));
    const op = deleting ? { ...(await put(f, 'unused', first.confirmed)), kind: 'delete', after: null } : await put(f, 'new', first.confirmed);
    armed = true;
    await assert.rejects(f.host.apply(op), /interrupted:/);
    await f.reopen();
    const result = await f.host.apply(op);
    assert.ok(['applied', 'already-applied'].includes(result.status));
    assert.equal(result.confirmed.deleted, deleting);
    assert.equal(f.host.pendingIntents().length, 0);
    if (deleting) assert.equal(existsSync(join(f.vaultRoot, 'a.md')), false);
    else assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'new');
    assert.equal(await readFile(f.host.objects.path(first.confirmed.blobHash), 'utf8'), 'old');
    assert.equal(f.host.history(first.confirmed.entryId).length, 2);
  });
}
test('rmdir refuses unknown children and does not recursively remove them', async t => {
  const f = await fixture(t);
  await mkdir(join(f.vaultRoot, 'folder'));
  const dir = (await f.host.openSnapshot()).entries.find(e => e.path === 'folder');
  await writeFile(join(f.vaultRoot, 'folder', 'unknown.md'), 'keep');
  const result = await f.host.apply({ vaultId: f.host.vaultId, replicaId: 'test', opId: randomUUID(), entryId: dir.entryId,
    kind: 'rmdir', baseRevision: dir.revision, after: null, dependsOn: [] });
  assert.equal(result.status, 'conflict');
  assert.equal(await readFile(join(f.vaultRoot, 'folder', 'unknown.md'), 'utf8'), 'keep');
});
for (const code of ['EACCES', 'ENOSPC', 'EPERM']) test(`filesystem ${code} preserves old bytes and retryable intent`, async t => {
  let armed = false;
  const f = await fixture(t, { interrupt: async name => { if (armed && name === 'before-rename') throw Object.assign(new Error(code), { code }); } });
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'new', first.confirmed);
  armed = true;
  assert.equal((await f.host.apply(op)).status, 'blocked');
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'old');
  await f.reopen();
  assert.equal((await f.host.apply(op)).status, 'already-applied');
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'new');
});
test('reject malformed operations, traversal, unverified blobs, reused IDs and folded collisions', async t => {
  const f = await fixture(t);
  const op = await put(f, 'one');
  assert.equal((await f.host.apply(op)).status, 'applied');
  const reused = { ...op, after: { ...op.after, path: 'b.md' } };
  assert.equal((await f.host.apply(reused)).errorCode, 'op-id-reused');
  for (const change of [{ after: { ...op.after, path: '../escape.md' } }, { after: { ...op.after, byteLength: -1 } }, { after: { ...op.after, blobHash: '0'.repeat(64) } }, { dependsOn: 'bad' }]) {
    const result = await f.host.apply({ ...op, opId: randomUUID(), ...change });
    assert.equal(result.status, 'blocked');
  }
  assert.equal((await f.host.apply(await put(f, 'two', null, 'A.md'))).status, 'conflict');
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'one');
});
test('snapshot rescans, external rename is deletion/creation and changes cursors are strings', async t => {
  const f = await fixture(t);
  await writeFile(join(f.vaultRoot, 'a.md'), 'external');
  const snap = await f.host.openSnapshot();
  assert.equal(snap.entries.length, 1);
  assert.equal(typeof snap.atCursor, 'string');
  await writeFile(join(f.vaultRoot, 'b.md'), 'external');
  await rm(join(f.vaultRoot, 'a.md'));
  await f.host.rescan();
  const changes = await f.host.readChanges(snap.atCursor, 100);
  assert.equal(changes.entries.length, 2);
  assert.equal(changes.entries.find(e => e.path === 'a.md').deleted, true);
  assert.notEqual(changes.entries.find(e => e.path === 'b.md').entryId, snap.entries[0].entryId);
  await assert.rejects(f.host.readChanges('wrong:1', 10), /cursor/);
});

test('host path folding exactly matches every shared fixture', async () => {
  const { normalizePath } = await import('../local/sync/paths.mjs');
  const cases = JSON.parse(await readFile(new URL('./fixtures/sync/contract-cases.json', import.meta.url), 'utf8'));
  for (const c of cases.paths) assert.deepEqual(normalizePath(c.input), c.expected, c.input);
  for (const c of cases.caseCollisions) assert.equal(normalizePath(c.local).pathKey === normalizePath(c.remote).pathKey, c.reason === 'path-collision');
});
test('legacy adapter preserves content revisions and rejects stale writes within coordinator', async t => {
  const f = await fixture(t);
  assert.equal(typeof f.host.mutate, 'function', 'legacy mutations require the same coordinator');
  const first = await f.host.mutate({ kind: 'put', path: 'notes/deep/a.md', content: 'old', createOnly: true });
  assert.equal(first.revision.length, 20);
  await writeFile(join(f.vaultRoot, 'notes/deep/a.md'), 'external');
  await assert.rejects(f.host.mutate({ kind: 'put', path: 'notes/deep/a.md', content: 'incoming', expectedRevision: first.revision }), /conflict/i);
  assert.equal(await readFile(join(f.vaultRoot, 'notes/deep/a.md'), 'utf8'), 'external');
  await assert.rejects(f.host.mutate({ kind: 'put', path: 'notes/deep/a.md', content: 'overwrite', createOnly: true }), /conflict/i);
  const moved = await f.host.mutate({ kind: 'move', path: 'notes/deep/a.md', newPath: 'assets/a.md' });
  assert.equal(moved.confirmed.entryId, first.confirmed.entryId);
  await f.host.mutate({ kind: 'delete', path: 'assets/a.md' });
  assert.equal(existsSync(join(f.vaultRoot, 'assets/a.md')), false);
});
test('folder adapter decomposes children and leaves a newly arriving child visible', async t => {
  let f, armed = false;
  f = await fixture(t, { interrupt: async name => {
    if (armed && name === 'after-rename') { armed = false; await writeFile(join(f.vaultRoot, 'folder', 'late.md'), 'keep'); }
  } });
  assert.equal(typeof f.host.mutate, 'function');
  await f.host.mutate({ kind: 'put', path: 'folder/known.md', content: 'old' });
  armed = true;
  await assert.rejects(f.host.mutate({ kind: 'delete', path: 'folder' }), /conflict/i);
  assert.equal(await readFile(join(f.vaultRoot, 'folder', 'late.md'), 'utf8'), 'keep');
  assert.equal(existsSync(join(f.vaultRoot, 'folder/known.md')), false);
});
test('folder move preserves child IDs and never moves unknown contents recursively', async t => {
  const f = await fixture(t);
  assert.equal(typeof f.host.mutate, 'function');
  const a = await f.host.mutate({ kind: 'put', path: 'old/nested/a.md', content: 'A' });
  const oldDirectory = (await f.host.openSnapshot()).entries.find(e => e.path === 'old/nested');
  await f.host.mutate({ kind: 'move', path: 'old', newPath: 'new' });
  const moved = (await f.host.openSnapshot()).entries.find(e => e.entryId === a.confirmed.entryId);
  assert.equal(moved.path, 'new/nested/a.md');
  assert.equal(await readFile(join(f.vaultRoot, moved.path), 'utf8'), 'A');
  assert.equal(existsSync(join(f.vaultRoot, 'old')), false);
  assert.equal((await f.host.openSnapshot()).entries.find(e => e.entryId === oldDirectory.entryId).path, 'new/nested');
});
test('junction traversal fails closed and cannot write outside fixture vault', async t => {
  const f = await fixture(t);
  const outside = join(f.root, 'outside'); await mkdir(outside);
  await symlink(outside, join(f.vaultRoot, 'escape'), 'junction');
  const result = await f.host.apply(await put(f, 'bad', null, 'escape/a.md'));
  assert.equal(result.status, 'blocked');
  assert.equal(result.errorCode, 'symlink');
  assert.equal(existsSync(join(outside, 'a.md')), false);
});
test('external writer at rename boundary is preserved through recovery', async t => {
  let f, armed = false;
  f = await fixture(t, { interrupt: async name => {
    if (armed && name === 'before-rename') { armed = false; await writeFile(join(f.vaultRoot, 'a.md'), 'racing'); }
  } });
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'new', first.confirmed);
  armed = true;
  assert.equal((await f.host.apply(op)).status, 'blocked');
  await f.reopen();
  assert.equal((await f.host.apply(op)).status, 'conflict');
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'racing');
});

test('normal API, MCP, uploads and cleanup persist history without opening a network listener', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pm-api-'));
  const oldData = process.env.PENTAMARK_DATA_DIR, oldVault = process.env.PENTAMARK_VAULT_DIR;
  process.env.PENTAMARK_DATA_DIR = root; delete process.env.PENTAMARK_VAULT_DIR;
  await writeFile(join(root, 'pentamark.config.json'), JSON.stringify({ cleanupUnusedAssets: true, aiBridgeToken: 'fixture', openBrowser: false }));
  const server = await import(`../local/server.mjs?fixture=${randomUUID()}`);
  const host = await server.initializeVaultHost();
  t.after(async () => {
    await server.closeVaultHost(); await rm(root, { recursive: true, force: true });
    if (oldData === undefined) delete process.env.PENTAMARK_DATA_DIR; else process.env.PENTAMARK_DATA_DIR = oldData;
    if (oldVault === undefined) delete process.env.PENTAMARK_VAULT_DIR; else process.env.PENTAMARK_VAULT_DIR = oldVault;
  });
  async function request(method, url, body, address = '127.0.0.1', client = '') {
    const req = Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url, headers: { host: 'localhost', 'x-pentamark-client': client }, socket: { remoteAddress: address } });
    let status, data;
    const res = { headersSent: false, writeHead(code) { status = code; this.headersSent = true; }, end(text) { data = JSON.parse(text); } };
    await server.requestHandler(req, res);
    return { status, data };
  }
  const first = await request('POST', '/api/note', { path: 'group/a.md', content: 'one' });
  assert.equal(first.status, 201);
  assert.equal(first.data.revision, '7692c3ad3540bb803c02');
  const second = await request('PUT', '/api/note?path=group/a.md', { content: 'two', baseRevision: first.data.revision });
  assert.equal(second.status, 200);
  assert.equal((await request('PUT', '/api/note?path=group/a.md', { content: 'stale', baseRevision: first.data.revision })).status, 409);
  const note = (await host.openSnapshot()).entries.find(e => e.path === 'notes/group/a.md');
  assert.equal(host.history(note.entryId).length, 2);
  const { createHash } = await import('node:crypto');
  const staleHash = createHash('sha256').update('stale').digest('hex');
  assert.equal(await readFile(host.objects.path(staleHash), 'utf8'), 'stale', 'legacy rejected bytes remain recoverable');
  assert.equal((await request('PATCH', '/api/folder?path=group', { newPath: 'renamed' })).status, 200);
  assert.equal(await readFile(join(root, 'vault/notes/renamed/a.md'), 'utf8'), 'two');
  const bridge = server.mcpBridge({ headers: {}, socket: { remoteAddress: '127.0.0.1' } });
  await bridge.writeFile('notes/renamed/a.md', 'three', second.data.revision);
  await bridge.moveFile('notes/renamed/a.md', 'notes/renamed/b.md');
  await bridge.deleteFile('notes/renamed/b.md');
  assert.equal(host.history(note.entryId).at(-1).deleted, true);
  assert.equal(host.history(note.entryId).length, 6);
  const uploaded = await request('POST', '/api/upload?name=photo.png', Buffer.from([0, 255, 7]));
  assert.equal(uploaded.status, 201);
  const asset = (await host.openSnapshot()).entries.find(e => e.path === 'assets/photo.png');
  assert.equal(asset.byteLength, 3);
  assert.deepEqual(await server.cleanupUnusedAssets(), ['assets/photo.png']);
  assert.equal(host.history(asset.entryId).at(-1).deleted, true);
  assert.deepEqual(await readFile(host.objects.path(asset.blobHash)), Buffer.from([0, 255, 7]));
});

for (const boundary of ['after-object', 'after-intent', 'after-rename', 'before-commit']) test(`process exits with SQLite open at ${boundary}`, async t => {
  const f = await fixture(t);
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'new', first.confirmed);
  await f.host.close();
  const script = `import { createHostService } from ${JSON.stringify(moduleURL.href)};
    const host = await createHostService({ dataRoot: ${JSON.stringify(f.dataRoot)}, vaultRoot: ${JSON.stringify(f.vaultRoot)},
      interrupt: async name => { if(name === ${JSON.stringify(boundary)}) process.exit(73); } });
    await host.apply(${JSON.stringify(op)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(code, 73, stderr);
  await f.reopen();
  assert.ok(['applied', 'already-applied'].includes((await f.host.apply(op)).status));
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'new');
  assert.equal(f.host.pendingIntents().length, 0);
});

test('case-only file moves preserve ID and content', async t => {
  const f = await fixture(t);
  const first = await f.host.apply(await put(f, 'case'));
  const result = await f.host.apply({ vaultId: f.host.vaultId, replicaId: 'test', opId: randomUUID(), entryId: first.confirmed.entryId,
    kind: 'move', baseRevision: first.confirmed.revision, after: { ...first.confirmed, path: 'A.md' }, dependsOn: [] });
  assert.equal(result.status, 'applied');
  assert.equal(result.confirmed.entryId, first.confirmed.entryId);
  assert.equal(await readFile(join(f.vaultRoot, 'A.md'), 'utf8'), 'case');
});
test('a second coordinator cannot concurrently own the same vault', async t => {
  const f = await fixture(t);
  let other;
  try {
    await assert.rejects(async () => { other = await implementation.createHostService({ vaultRoot: f.vaultRoot, dataRoot: f.dataRoot }); }, /host-already-open/);
  } finally { await other?.close(); }
});
test('external identical creation during intent does not steal its identity', async t => {
  let f, armed = false;
  f = await fixture(t, { interrupt: async name => {
    if (armed && name === 'after-intent') { armed = false; await writeFile(join(f.vaultRoot, 'a.md'), 'same'); }
  } });
  const op = await put(f, 'same'); armed = true;
  assert.equal((await f.host.apply(op)).status, 'blocked');
  await f.reopen();
  assert.equal((await f.host.apply(op)).status, 'conflict');
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'same');
});

test('change cursors retain exact 64-bit sequence beyond JavaScript safe integers', async t => {
  const f = await fixture(t);
  const first = await f.host.apply(await put(f, 'old'));
  const root = f.host.root;
  await f.host.close();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(root, 'store.sqlite'));
  db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='change_log'").run(9007199254740992n);
  db.close();
  await f.reopen();
  await f.host.apply(await put(f, 'new', first.confirmed));
  const page = await f.host.readChanges(null, 100);
  assert.equal(page.nextCursor, `${f.host.epoch}:9007199254740993`);
  assert.equal((await f.host.readChanges(`${f.host.epoch}:9007199254740992`, 100)).entries.length, 1);
});

test('native Windows sharing lock blocks writes without losing either version', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'new', first.confirmed);
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$f = [System.IO.File]::Open($env:PM_FIXTURE_LOCK, 'Open', 'ReadWrite', 'None'); [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null; $f.Dispose()"],
    { env: { ...process.env, PM_FIXTURE_LOCK: join(f.vaultRoot, 'a.md') }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const ended = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', bytes => { output += bytes; if (output.includes('locked')) resolve(); });
      child.once('error', reject); child.once('exit', () => reject(new Error('lock helper exited before ready')));
    });
    const result = await f.host.apply(op);
    assert.equal(result.status, 'blocked');
    assert.ok(['EBUSY', 'EPERM', 'EACCES'].includes(result.errorCode), result.errorCode);
  } finally { child.stdin.end('\n'); await ended; }
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'old');
  assert.equal((await f.host.apply(op)).status, 'applied');
  assert.equal(await readFile(f.host.objects.path(first.confirmed.blobHash), 'utf8'), 'old');
});

test('dependencies block without consuming operation identity and directories delete recoverably', async t => {
  const f = await fixture(t);
  const parent = { vaultId: f.host.vaultId, replicaId: 'test', opId: randomUUID(), entryId: randomUUID(), kind: 'mkdir',
    baseRevision: null, after: { path: 'folder', kind: 'directory', blobHash: null, byteLength: 0 }, dependsOn: [] };
  const child = { ...await put(f, 'child', null, 'folder/a.md'), replicaId: 'test', dependsOn: [parent.opId] };
  assert.equal((await f.host.apply(child)).errorCode, 'dependency-not-applied');
  assert.equal((await f.host.apply(parent)).status, 'applied');
  assert.equal((await f.host.apply(child)).status, 'applied');
  await f.host.mutate({ kind: 'delete', path: 'folder' });
  assert.equal(existsSync(join(f.vaultRoot, 'folder')), false);
  assert.equal((await f.host.openSnapshot()).entries.filter(e => e.deleted).length, 2);
});

test('hello advertises stable identity and enforced byte limits for protocol routes', async t => {
  const f = await fixture(t, { maxFileBytes: 3 });
  assert.equal(typeof f.host.hello, 'function');
  const hello = await f.host.hello();
  assert.deepEqual(hello, { protocol: 1, vaultId: f.host.vaultId, serverId: f.host.serverId, epoch: f.host.epoch, maxFileBytes: 3, chunkBytes: 1048576 });
  assert.equal((await f.host.apply(await put(f, 'four'))).errorCode, 'file-too-large');
  await f.reopen();
  assert.equal(f.host.vaultId, hello.vaultId); assert.equal(f.host.serverId, hello.serverId); assert.equal(f.host.epoch, hello.epoch);
});

test('case-only directory move never confirms an absent directory', async t => {
  const f = await fixture(t);
  const first = await f.host.mutate({ kind: 'mkdir', path: 'folder' });
  const result = await f.host.apply({ vaultId: f.host.vaultId, replicaId: 'test', opId: randomUUID(), entryId: first.confirmed.entryId,
    kind: 'move', baseRevision: first.confirmed.revision, after: { ...first.confirmed, path: 'Folder' }, dependsOn: [] });
  assert.ok(existsSync(join(f.vaultRoot, result.status === 'applied' ? 'Folder' : 'folder')));
});
