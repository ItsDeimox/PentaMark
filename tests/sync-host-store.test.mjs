import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
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
  return { root, vaultRoot, dataRoot, get host() { return host; }, async reopen(options = {}) {
    await host.close(); host = await implementation.createHostService({ vaultRoot, dataRoot, ...options }); return host;
  } };
}
async function put(f, content, base = null, path = 'a.md') {
  const blob = await f.host.objects.put(Buffer.from(content));
  return { vaultId: f.host.vaultId, replicaId: 'test-replica', opId: randomUUID(), entryId: base?.entryId ?? randomUUID(),
    kind: 'put', baseRevision: base?.revision ?? null, after: { path, kind: 'note', ...blob }, dependsOn: [] };
}
for (const mode of ['remote-put', 'remote-move', 'legacy-folder-move']) test(`round2 ambiguous destination ancestor blocks ${mode}`, async t => {
  const f = await fixture(t);
  await mkdir(join(f.vaultRoot, 'cafe\u0301')); await mkdir(join(f.vaultRoot, 'café'));
  await writeFile(join(f.vaultRoot, 'cafe\u0301/keep.md'), 'NFD');
  await writeFile(join(f.vaultRoot, 'café/keep.md'), 'NFC');
  const source = await f.host.mutate({ kind: 'put', path: 'source/a.md', content: 'source' });
  if (mode === 'legacy-folder-move') {
    await assert.rejects(f.host.mutate({ kind: 'move', path: 'source', newPath: 'café/nested/dest' }), /path-collision/);
    assert.equal(f.host.pendingPlans().length, 0);
  } else {
    const op = mode === 'remote-put' ? await put(f, 'incoming', null, 'café/new.md')
      : { vaultId: f.host.vaultId, replicaId: 'test', opId: randomUUID(), entryId: source.confirmed.entryId,
        kind: 'move', baseRevision: source.confirmed.revision, after: { ...source.confirmed, path: 'café/new.md' }, dependsOn: [] };
    const result = await f.host.apply(op);
    assert.equal(result.status, 'conflict');
    assert.equal(result.conflict.reason, 'path-collision');
  }
  for (const native of ['cafe\u0301', 'café']) {
    assert.equal(existsSync(join(f.vaultRoot, native, 'new.md')), false);
    assert.equal(existsSync(join(f.vaultRoot, native, 'nested')), false);
  }
  assert.equal(await readFile(join(f.vaultRoot, 'source/a.md'), 'utf8'), 'source');
  assert.equal(await readFile(join(f.vaultRoot, 'cafe\u0301/keep.md'), 'utf8'), 'NFD');
  assert.equal(await readFile(join(f.vaultRoot, 'café/keep.md'), 'utf8'), 'NFC');
  assert.equal((await f.host.apply(await put(f, 'unrelated', null, 'unrelated.md'))).status, 'applied');
});

for (const dependency of [false, true]) test(`round2 denied stale delete cannot persist or consume op ID (dependency=${dependency})`, async t => {
  const f = await fixture(t);
  const creation = await put(f, 'base');
  const first = await f.host.apply(creation);
  const updated = await f.host.apply(await put(f, 'current', first.confirmed));
  const op = { ...creation, opId: randomUUID(), kind: 'delete', after: null,
    baseRevision: first.confirmed.revision, dependsOn: dependency ? ['missing-dependency'] : [] };
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(f.host.root, 'store.sqlite'), { readOnly: true });
  try {
    const counts = () => ['conflicts', 'applied_ops', 'file_intents'].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
    const before = counts();
    const denied = await f.host.apply(op, { precondition: ({ current }) => {
      assert.equal(current.revision, updated.confirmed.revision);
      return { errorCode: 'permission-denied' };
    } });
    assert.deepEqual(denied, { opId: op.opId, status: 'blocked', errorCode: 'permission-denied' });
    assert.deepEqual(counts(), before);
    assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'current');
    const allowed = await f.host.apply(op, { precondition: () => true });
    assert.equal(allowed.status, dependency ? 'blocked' : 'conflict');
    if (dependency) {
      assert.equal(allowed.errorCode, 'dependency-not-applied');
      assert.deepEqual(counts(), before);
    } else {
      assert.equal(allowed.conflict.reason, 'base-diverged');
      assert.deepEqual(counts(), [before[0] + 1, before[1] + 1, before[2]]);
      await f.reopen();
      assert.deepEqual(await f.host.apply(op, { precondition: () => { throw new Error('must replay conflict first'); } }), allowed);
    }
    assert.equal((await f.host.apply(creation, { precondition: () => { throw new Error('must replay lost ACK first'); } })).status, 'already-applied');
  } finally { db.close(); }
});

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
  let unlock, entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const holding = host.read(async () => { entered(); await new Promise(resolve => { unlock = resolve; }); });
  await reached;
  let noteRead = false, stateRead = false;
  const readingNote = request('GET', '/api/note?path=group/a.md').then(value => { noteRead = true; return value; });
  const readingState = request('GET', '/api/state').then(value => { stateRead = true; return value; });
  try {
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(noteRead, false, 'ordinary note reads must join the coordinator');
    assert.equal(stateRead, false, 'ordinary state reads must join the coordinator');
  } finally { unlock(); await holding; await Promise.all([readingNote, readingState]); }
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
  let releaseStream, streamStarted;
  const startedStream = new Promise(resolve => { streamStarted = resolve; });
  const chunks = [];
  const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); releaseStream = done; streamStarted(); } });
  response.writeHead = () => { response.headersSent = true; };
  const finishedStream = new Promise(resolve => response.on('finish', resolve));
  await server.requestHandler({ method: 'GET', url: '/api/file?path=assets/photo.png', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } }, response);
  await startedStream;
  let timeout;
  try {
    await Promise.race([host.mutate({ kind: 'put', path: 'assets/photo.png', content: Buffer.from([9, 8, 7]) }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('network stream holds coordinator')), 2000); })]);
  } finally { clearTimeout(timeout); releaseStream(); await finishedStream; }
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([0, 255, 7]), 'stream stays on pinned completed bytes');
  assert.deepEqual(await server.cleanupUnusedAssets(), ['assets/photo.png']);
  assert.equal(host.history(asset.entryId).at(-1).deleted, true);
  assert.deepEqual(await readFile(host.objects.path(asset.blobHash)), Buffer.from([0, 255, 7]));
  const nativeNote = 'cafe\u0301.md';
  await writeFile(join(root, 'vault/notes', nativeNote), 'legacy Unicode');
  const unicodeRead = await request('GET', `/api/note?path=${encodeURIComponent(nativeNote)}`);
  assert.equal(unicodeRead.status, 200); assert.equal(unicodeRead.data.content, 'legacy Unicode');
  assert.equal((await request('PUT', `/api/note?path=${encodeURIComponent(nativeNote)}`, { content: 'edited Unicode', baseRevision: unicodeRead.data.revision })).status, 200);
  assert.equal(await readFile(join(root, 'vault/notes', nativeNote), 'utf8'), 'edited Unicode');
  assert.equal(existsSync(join(root, 'vault/notes/café.md')), false);
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

test('round1 incomplete desired staging is rebuilt before recovery publishes it', async t => {
  let armed = false;
  const f = await fixture(t, { interrupt: async name => { if (armed && name === 'after-intent') throw new Error('interrupted:stage'); } });
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'x'.repeat(100), first.confirmed); armed = true;
  await assert.rejects(f.host.apply(op), /interrupted/);
  const work = join(f.vaultRoot, '.pentamark-sync', f.host.pendingIntents()[0].intentId);
  await mkdir(work, { recursive: true }); await writeFile(join(work, 'desired'), 'partial');
  await f.reopen();
  assert.equal((await f.host.apply(op)).status, 'already-applied');
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'x'.repeat(100));
});
test('round1 publication changed before commit cannot be confirmed as intended bytes', async t => {
  let armed = false, f;
  f = await fixture(t, { interrupt: async name => { if (armed && name === 'before-commit') { armed = false; await writeFile(join(f.vaultRoot, 'a.md'), 'external'); } } });
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'x'.repeat(100), first.confirmed); armed = true;
  assert.notEqual((await f.host.apply(op)).status, 'applied');
  await f.reopen();
  assert.equal((await f.host.apply(op)).status, 'conflict');
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'external');
});
for (const kind of ['mkdir', 'move']) for (const directory of [false, true]) test(`round1 ${kind} rejects unowned ${directory ? 'directory' : 'file'} destination`, async t => {
  let armed = false, f;
  f = await fixture(t, { interrupt: async name => {
    if (armed && name === 'before-rename') { armed = false; if (directory) await mkdir(join(f.vaultRoot, 'dest')); else await writeFile(join(f.vaultRoot, 'dest'), 'external'); }
  } });
  const source = kind === 'move' ? (await f.host.mutate({ kind: 'mkdir', path: 'source' })).confirmed : null;
  const op = { vaultId: f.host.vaultId, replicaId: 'test', opId: randomUUID(), entryId: source?.entryId ?? randomUUID(), kind,
    baseRevision: source?.revision ?? null, after: { path: 'dest', kind: 'directory', blobHash: null, byteLength: 0 }, dependsOn: [] };
  armed = true;
  assert.notEqual((await f.host.apply(op)).status, 'applied');
  await f.reopen();
  assert.equal((await f.host.apply(op)).status, 'conflict');
  if (source) assert.equal(existsSync(join(f.vaultRoot, 'source')), true);
  if (!directory) assert.equal(await readFile(join(f.vaultRoot, 'dest'), 'utf8'), 'external');
});

for (const kind of ['move', 'delete']) test(`round1 persisted folder ${kind} resumes remaining children after crash`, async t => {
  let armed = false;
  const f = await fixture(t, { interrupt: async name => { if (armed && name === 'after-rename') { armed = false; throw new Error('interrupted:folder'); } } });
  const a = await f.host.mutate({ kind: 'put', path: 'source/nested/a.md', content: 'A' });
  const b = await f.host.mutate({ kind: 'put', path: 'source/b.md', content: 'B' });
  const dirs = (await f.host.openSnapshot()).entries.filter(e => e.kind === 'directory');
  armed = true;
  await assert.rejects(f.host.mutate({ kind, path: 'source', newPath: kind === 'move' ? 'dest' : undefined }), /interrupted/);
  await f.reopen();
  assert.equal(existsSync(join(f.vaultRoot, 'source')), false, 'startup must resume the persisted original child plan');
  if (kind === 'move') {
    assert.equal(await readFile(join(f.vaultRoot, 'dest/nested/a.md'), 'utf8'), 'A');
    assert.equal(await readFile(join(f.vaultRoot, 'dest/b.md'), 'utf8'), 'B');
    for (const original of [a.confirmed, b.confirmed, ...dirs])
      assert.equal(f.host.history(original.entryId).at(-1).path, original.path.replace('source', 'dest'));
  }
  assert.equal(f.host.pendingPlans().length, 0);
});
test('round1 resumed folder plan retains original bases and durably conflicts on an edited remaining child', async t => {
  let armed = false;
  const f = await fixture(t, { interrupt: async name => { if (armed && name === 'after-rename') { armed = false; throw new Error('interrupted:folder'); } } });
  await f.host.mutate({ kind: 'put', path: 'source/a.md', content: 'A' });
  await f.host.mutate({ kind: 'put', path: 'source/b.md', content: 'B' });
  armed = true; await assert.rejects(f.host.mutate({ kind: 'delete', path: 'source' }), /interrupted/);
  await writeFile(join(f.vaultRoot, 'source/b.md'), 'external');
  await f.reopen();
  assert.equal(await readFile(join(f.vaultRoot, 'source/b.md'), 'utf8'), 'external');
  assert.equal(f.host.pendingPlans()[0].status, 'conflict');
  await assert.rejects(f.host.mutate({ kind: 'delete', path: 'source' }), /Conflict/);
});

test('round1 current limits and queued preconditions deny without consuming operation identity', async t => {
  let cap = 100, authorized = true, armed = false;
  const f = await fixture(t, { getMaxFileBytes: () => cap, interrupt: async name => { if (armed && name === 'before-rename') { armed = false; authorized = false; } } });
  assert.equal((await f.host.hello()).maxFileBytes, 100);
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'new', first.confirmed); armed = true;
  let checked;
  const precondition = ({ current }) => { checked = current; return authorized ? true : { errorCode: 'permission-changed' }; };
  assert.equal((await f.host.apply(op, { precondition })).errorCode, 'permission-changed');
  assert.equal(checked.revision, first.confirmed.revision);
  assert.equal(f.host.pendingIntents().length, 0);
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'old');
  cap = 2; assert.equal((await f.host.hello()).maxFileBytes, 2);
  assert.equal((await f.host.apply(op)).errorCode, 'file-too-large');
  cap = NaN; await assert.rejects(f.host.hello(), /invalid-file-limit/);
  cap = 100; authorized = true;
  assert.equal((await f.host.apply(op, { precondition })).status, 'applied');
});
test('round1 coordinated reads wait for completed writes and nested queue calls reject promptly', async t => {
  let release, entered, armed = false;
  const gate = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { interrupt: async name => { if (armed && name === 'after-preserve') { entered(); await gate; } } });
  const first = await f.host.apply(await put(f, 'old'));
  assert.equal(typeof f.host.read, 'function');
  const op = await put(f, 'new', first.confirmed); armed = true;
  const write = f.host.apply(op);
  await Promise.race([reached, write.then(() => { throw new Error('missing after-preserve boundary'); })]);
  assert.equal(existsSync(join(f.vaultRoot, 'a.md')), false, 'exercise the actual recoverable pathname gap');
  let readDone = false;
  const reading = f.host.read(async () => { readDone = true; return readFile(join(f.vaultRoot, 'a.md'), 'utf8'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readDone, false); release(); await write;
  assert.equal(await reading, 'new');
  await assert.rejects(f.host.read(() => f.host.openSnapshot()), /nested-host-operation/);
});
test('round1 NFD startup and edit preserve native spelling while sync path is NFC', async t => {
  const f = await fixture(t);
  const raw = 'cafe\u0301.md';
  await writeFile(join(f.vaultRoot, raw), 'before');
  await f.reopen();
  const entry = (await f.host.openSnapshot()).entries.find(e => e.path === 'café.md');
  assert.ok(entry);
  await f.host.mutate({ kind: 'put', path: raw, content: 'after' });
  assert.equal(await readFile(join(f.vaultRoot, raw), 'utf8'), 'after');
  assert.equal(existsSync(join(f.vaultRoot, 'café.md')), false);
  assert.equal(f.host.history(entry.entryId).length, 2);
});
test('round1 folded native collisions are diagnosed while unrelated entries remain accessible', async t => {
  const f = await fixture(t);
  await writeFile(join(f.vaultRoot, 'cafe\u0301.md'), 'NFD');
  await writeFile(join(f.vaultRoot, 'café.md'), 'NFC');
  await writeFile(join(f.vaultRoot, 'other.md'), 'safe');
  await f.reopen();
  assert.equal((await f.host.openSnapshot()).entries.length, 3);
  assert.ok(f.host.scanDiagnostics().some(d => d.code === 'path-collision'));
  await f.host.mutate({ kind: 'put', path: 'other.md', content: 'edited' });
  assert.equal(await readFile(join(f.vaultRoot, 'other.md'), 'utf8'), 'edited');
  await assert.rejects(f.host.mutate({ kind: 'put', path: 'cafe\u0301.md', content: 'unsafe' }), /Conflict/);
});
test('round1 unscannable known entry retains its live version and reports diagnostic', async t => {
  const f = await fixture(t);
  const a = await f.host.mutate({ kind: 'put', path: 'folder/a.md', content: 'keep' });
  await rm(join(f.vaultRoot, 'folder'), { recursive: true });
  const outside = join(f.root, 'outside'); await mkdir(outside);
  await symlink(outside, join(f.vaultRoot, 'folder'), 'junction');
  await f.reopen();
  assert.equal(f.host.history(a.confirmed.entryId).at(-1).deleted, false);
  assert.ok(f.host.scanDiagnostics().some(d => d.code === 'symlink'));
  assert.equal((await f.host.apply(await put(f, 'safe', null, 'other.md'))).status, 'applied');
});

for (const replacement of ['file', 'directory']) test(`round1 directory recovery rejects replacement ${replacement} despite old ownership evidence`, async t => {
  let armed = false;
  const f = await fixture(t, { interrupt: async name => { if (armed && name === 'before-commit') throw new Error('interrupted:directory'); } });
  const op = { vaultId: f.host.vaultId, replicaId: 'test', opId: randomUUID(), entryId: randomUUID(), kind: 'mkdir', baseRevision: null,
    after: { path: 'owned', kind: 'directory', blobHash: null, byteLength: 0 }, dependsOn: [] };
  armed = true; await assert.rejects(f.host.apply(op), /interrupted/);
  await rm(join(f.vaultRoot, 'owned'), { recursive: true });
  if (replacement === 'file') await writeFile(join(f.vaultRoot, 'owned'), 'external');
  else { await mkdir(join(f.vaultRoot, 'owned')); await writeFile(join(f.vaultRoot, 'owned/unknown.md'), 'external'); }
  await f.reopen();
  assert.equal((await f.host.apply(op)).status, 'conflict');
  assert.equal(await readFile(join(f.vaultRoot, replacement === 'file' ? 'owned' : 'owned/unknown.md'), 'utf8'), 'external');
});
test('round1 directory creation without persisted ownership is not adopted after crash', async t => {
  const f = await fixture(t, { interrupt: async name => { if (name === 'after-directory-create') throw new Error('interrupted:unowned'); } });
  const op = { vaultId: f.host.vaultId, replicaId: 'test', opId: randomUUID(), entryId: randomUUID(), kind: 'mkdir', baseRevision: null,
    after: { path: 'unproven', kind: 'directory', blobHash: null, byteLength: 0 }, dependsOn: [] };
  await assert.rejects(f.host.apply(op), /interrupted/);
  await f.reopen();
  assert.equal((await f.host.apply(op)).status, 'conflict');
  assert.equal(existsSync(join(f.vaultRoot, 'unproven')), true);
});
test('round1 process exit mid-folder-plan resumes at startup with original identities', async t => {
  const f = await fixture(t);
  const a = await f.host.mutate({ kind: 'put', path: 'source/a.md', content: 'A' });
  await f.host.mutate({ kind: 'put', path: 'source/b.md', content: 'B' });
  await f.host.close();
  const script = `import { createHostService } from ${JSON.stringify(moduleURL.href)};
    const host = await createHostService({ dataRoot: ${JSON.stringify(f.dataRoot)}, vaultRoot: ${JSON.stringify(f.vaultRoot)},
      interrupt: async name => { if(name === 'after-plan-step') process.exit(73); } });
    await host.mutate({kind:'move',path:'source',newPath:'dest'});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(code, 73, stderr);
  await f.reopen();
  assert.equal(await readFile(join(f.vaultRoot, 'dest/a.md'), 'utf8'), 'A');
  assert.equal(await readFile(join(f.vaultRoot, 'dest/b.md'), 'utf8'), 'B');
  assert.equal(f.host.history(a.confirmed.entryId).at(-1).path, 'dest/a.md');
  assert.equal(f.host.pendingPlans().length, 0);
});
test('round1 early precondition never becomes implicit startup transition authorization', async t => {
  let armed = false;
  const f = await fixture(t, { interrupt: async name => { if (armed && name === 'after-intent') throw new Error('interrupted:unauthorized'); } });
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'new', first.confirmed); armed = true;
  await assert.rejects(f.host.apply(op, { precondition: () => true }), /interrupted/);
  await f.reopen();
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'old');
  assert.equal((await f.host.apply(op, { precondition: () => true })).status, 'applied');
});
test('round1 ambiguous native folder cannot expand a legacy delete into both trees', async t => {
  const f = await fixture(t);
  await mkdir(join(f.vaultRoot, 'cafe\u0301')); await mkdir(join(f.vaultRoot, 'café'));
  await writeFile(join(f.vaultRoot, 'cafe\u0301/a.md'), 'one'); await writeFile(join(f.vaultRoot, 'café/b.md'), 'two');
  await f.host.rescan();
  await assert.rejects(f.host.mutate({ kind: 'delete', path: 'cafe\u0301' }), /Conflict/);
  assert.equal(await readFile(join(f.vaultRoot, 'cafe\u0301/a.md'), 'utf8'), 'one');
  assert.equal(await readFile(join(f.vaultRoot, 'café/b.md'), 'utf8'), 'two');
});
test('round1 dynamic cap is rechecked at the filesystem boundary', async t => {
  let cap = 100, armed = false;
  const f = await fixture(t, { getMaxFileBytes: () => cap, interrupt: async name => { if (armed && name === 'before-rename') { armed = false; cap = 1; } } });
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'new', first.confirmed); armed = true;
  assert.equal((await f.host.apply(op)).errorCode, 'file-too-large');
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'old');
  assert.equal(f.host.pendingIntents().length, 0);
  cap = 100; assert.equal((await f.host.apply(op)).status, 'applied');
});
test('round1 lowered cap during unstarted recovery does not block unrelated vault startup', async t => {
  let cap = 100, armed = false;
  const f = await fixture(t, { getMaxFileBytes: () => cap, interrupt: async name => { if (armed && name === 'before-rename') throw new Error('interrupted:cap'); } });
  const first = await f.host.apply(await put(f, 'old'));
  const op = await put(f, 'new', first.confirmed); armed = true;
  await assert.rejects(f.host.apply(op), /interrupted/);
  cap = 1; await f.reopen({ getMaxFileBytes: () => cap });
  assert.equal(await readFile(join(f.vaultRoot, 'a.md'), 'utf8'), 'old');
  assert.equal(f.host.pendingIntents().length, 0);
  assert.equal((await f.host.apply(op)).errorCode, 'file-too-large');
  cap = 100; assert.equal((await f.host.apply(op)).status, 'applied');
});
