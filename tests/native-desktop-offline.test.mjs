// Standalone Windows acceptance: Node 24 --test tests/native-desktop-offline.test.mjs
// First npm run desktop:build. PM_NATIVE_DESKTOP_EXE optionally selects the
// dedicated desktop-dist-probe-native package. Never uses an installed app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { _electron, expect } from '@playwright/test';
import { createReplicaService } from '../local/sync/replica-service.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
// Resolve the builder's existing transitive dependency (also works with pnpm).
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const { extractFile } = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const baseText = '# Alpha\n\nKnown local copy.\n';
const editedText = `${baseText}\nNative offline edit survives process restart.\n`;
const newerText = `${editedText}\nNewer local IPC edit.\n`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64');

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return server.address().port;
}
const closeServer = server => new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unexpected link in build resources: ${path}`);
  }
  return result.sort();
}
async function verifyPackage(exe) {
  // Refuse installed executables and stale integration resources.
  const actual = await realpath(exe);
  const outputs = ['desktop-dist', 'desktop-dist-probe-native'];
  const allowed = await Promise.all(outputs.map(name => realpath(join(repo, name)).catch(() => null)));
  assert.ok(allowed.some(root => root && actual.startsWith(root + sep)), 'EXE must be inside a repository packaging output');
  const resources = join(dirname(actual), 'resources');
  for (const folder of ['local', 'local-dist']) {
    const source = join(repo, folder), packaged = join(resources, folder);
    const names = await files(source);
    assert.deepEqual(await files(packaged), names, `Rebuild package: ${folder} file list changed`);
    for (const name of names) {
      assert.equal(hash(await readFile(join(packaged, name))), hash(await readFile(join(source, name))),
        `Rebuild package: stale ${folder}/${name}`);
    }
  }
  for (const name of ['desktop/main.cjs', 'desktop/preload.cjs', 'desktop/sync-ipc.cjs']) {
    assert.equal(hash(extractFile(join(resources, 'app.asar'), name)), hash(await readFile(join(repo, name))), `Rebuild package: stale ${name}`);
  }
  return { exe: actual, exeSha256: hash(await readFile(actual)), asarSha256: hash(await readFile(join(resources, 'app.asar'))) };
}

test('packaged Windows: manual replica boots offline, saves, restarts, rejects stale writes and preserves conflicts',
  { skip: process.platform !== 'win32' ? 'Windows packaged acceptance only' : false, timeout: 180_000 }, async t => {
    assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Fixture requires Node 24 with node:sqlite');
    const build = await verifyPackage(process.env.PM_NATIVE_DESKTOP_EXE || join(repo, 'desktop-dist/win-unpacked/PentaMark.exe'));
    t.diagnostic(JSON.stringify(build));
    const root = await mkdtemp(join(tmpdir(), 'pentamark-native-offline-'));
    const userData = join(root, 'userData'), data = join(root, 'data'), vault = join(root, 'vault');
    let app, page, passed = false, hostConnections = 0;
    let processLog = '';
    const rendererHostRequests = [];
    // No HTTP host or mocked responses: count any attempted native/renderer
    // connection and immediately reset it. The sync service is unreachable.
    const unreachable = createServer(socket => { hostConnections++; socket.destroy(); });
    const hostPort = await listen(unreachable);
    const reservation = createServer();
    const localPort = await listen(reservation);
    const unavailableName = `native-${randomUUID()}.invalid.ts.net`;
    const profile = { vaultId: randomUUID(), serverId: randomUUID(), replicaId: randomUUID(),
      origin: `https://${unavailableName}:${hostPort}`, offlineEnabled: true, mode: 'manual' };
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|PENTAMARK_.*|PORTABLE_EXECUTABLE_.*)$/i.test(key)));
    Object.assign(env, { PENTAMARK_USER_DATA_DIR: userData, PENTAMARK_DATA_DIR: data, PENTAMARK_VAULT_DIR: vault });
    assert.ok(!Object.keys(env).some(key => key.toUpperCase() === 'ELECTRON_RUN_AS_NODE'));
    function killOwned() {
      const child = app?.process();
      if (child && child.exitCode === null && child.signalCode === null) {
        const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 });
        t.diagnostic(`Forced cleanup of test-owned PID ${child.pid}: ${result.status}`);
      }
    }
    const watchdog = setTimeout(killOwned, 150_000);
    async function stop() {
      if (!app) return;
      const observation = await app.evaluate(() => ({ remote: globalThis.__nativeOfflineRemoteCalls, local: globalThis.__nativeOfflineLocalCalls }));
      let timer;
      try {
        await Promise.race([app.close(), new Promise((_, reject) => {
          timer = setTimeout(() => { killOwned(); reject(new Error('Native app did not close within 10 seconds')); }, 10_000);
        })]);
      } finally { clearTimeout(timer); }
      app = undefined;
      assert.deepEqual(observation.remote, [], 'Packaged native IPC attempted remote transport');
      assert.ok(observation.local.includes('open') && observation.local.includes('request'), 'IPC observer must witness actual native boot and reads');
    }
    const invokeRaw = (method, payload = {}) => page.evaluate(command => window.pentaMarkDesktop.sync.invoke(command),
      { requestId: randomUUID(), replicaId: profile.replicaId, method, payload });
    async function invoke(method, payload = {}) {
      const reply = await invokeRaw(method, payload);
      assert.equal(reply.ok, true, `${method}: ${JSON.stringify(reply)}`);
      assert.equal(reply.replicaId, profile.replicaId);
      return reply.value;
    }
    const getNote = () => invoke('request', { url: '/api/note?path=Alpha.md', method: 'GET' });
    const noteEntry = snapshot => snapshot.entries.find(e => e.local?.path === 'Alpha.md');
    async function launch() {
      app = await _electron.launch({ executablePath: build.exe, env, timeout: 30_000,
        args: [`--host-resolver-rules=MAP ${unavailableName} 127.0.0.1`] });
      // Observe real parent->server IPC before the renderer exists. The original
      // send, preload, handlers and native service remain in use, unmodified.
      // Every native remote transport entrypoint is dispatched through this IPC.
      await app.evaluate(({ BrowserWindow }) => {
        if (BrowserWindow.getAllWindows().some(w => /^https?:/.test(w.webContents.getURL()))) {
          throw new Error('Transport observation attached too late');
        }
        globalThis.__nativeOfflineRemoteCalls = [];
        globalThis.__nativeOfflineLocalCalls = [];
        const { ChildProcess } = process.getBuiltinModule('child_process');
        const remoteMethods = new Set(['discover', 'rebind', 'handshake', 'remoteSnapshot', 'changes', 'apply', 'downloadBlob', 'uploadBlob']);
        const observed = new WeakSet();
        const observe = child => {
          if (typeof child.send !== 'function' || observed.has(child)) return;
          observed.add(child);
          const send = child.send;
          child.send = function(message, ...args) {
            if (message?.type === 'pentamark:sync:command') {
              const list = remoteMethods.has(message.command?.method) ? globalThis.__nativeOfflineRemoteCalls : globalThis.__nativeOfflineLocalCalls;
              list.push(message.command.method);
            }
            return send.call(this, message, ...args);
          };
        };
        // Node installs send as an instance member when it creates an IPC pipe.
        const spawn = ChildProcess.prototype.spawn;
        ChildProcess.prototype.spawn = function(...args) { const result = spawn.apply(this, args); observe(this); return result; };
        for (const handle of process._getActiveHandles()) if (handle instanceof ChildProcess) observe(handle);
      });
      app.process().stdout?.on('data', chunk => { processLog = (processLog + chunk).slice(-16_000); });
      app.process().stderr?.on('data', chunk => { processLog = (processLog + chunk).slice(-16_000); });
      app.context().on('request', request => {
        if (request.url().startsWith(profile.origin + '/')) rendererHostRequests.push(request.url());
      });
      await expect.poll(() => app.windows().some(w => w.url().startsWith(`http://127.0.0.1:${localPort}`)), { timeout: 30_000 }).toBe(true);
      page = app.windows().find(w => w.url().startsWith(`http://127.0.0.1:${localPort}`));
      page.setDefaultTimeout(10_000);
      await page.waitForFunction(() => typeof window.pentaMarkDesktop?.getVault === 'function');
      assert.equal(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged), true);
      assert.equal(resolve(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))), resolve(userData));
      assert.equal(resolve((await page.evaluate(() => window.pentaMarkDesktop.getVault())).path), resolve(vault));
    }
    try {
      for (const path of [userData, data, vault]) await mkdir(path);
      await writeFile(join(data, 'pentamark.config.json'), JSON.stringify({ port: localPort, openBrowser: false, vaultName: 'Native test only', lockEditedNotes: false }));
      await writeFile(join(data, 'pentamark.profile.json'), JSON.stringify({ name: 'Native acceptance', avatar: '' }));
      await writeFile(join(userData, 'pentamark.desktop.json'), JSON.stringify({ vaultPath: vault }));
      const seed = await createReplicaService({ userData, profile });
      let base, media, remote;
      try {
        const version = async (path, content, kind = 'note') => ({ entryId: randomUUID(), revision: randomUUID(), path, kind, deleted: false, ...await seed.objects.put(content) });
        base = await version('Alpha.md', baseText);
        const beta = await version('Beta.md', '# Beta\n\nSecond offline note.\n');
        media = await version('pixel.png', png, 'asset');
        // Seed a retained candidate object without changing the working version.
        remote = { ...base, revision: randomUUID(), ...await seed.objects.put('# Remote candidate\n') };
        await seed.persistIncoming({ epoch: 'native-epoch', nextCursor: 'native:1',
          initialCopy: { snapshotToken: 'native-snapshot', atCursor: 'native:1', pageCursor: null },
          items: [base, beta, media].map(v => ({ expectedLocalHead: '', decision: { action: 'pull', reason: 'remote', base: null, local: null, remote: v } })) });
      } finally { await seed.close(); }
      await closeServer(reservation);
      await launch();
      await page.evaluate(p => {
        localStorage.setItem('pentamark:sync:profile:' + p.replicaId, JSON.stringify(p));
        localStorage.setItem('pentamark:sync:active', p.replicaId);
        localStorage.setItem('pentamark:appearance', JSON.stringify({ graphicsMode: 'flat', backgroundMotion: false }));
      }, profile);
      await page.reload();
      const editor = page.locator('.cm-content');
      await expect(editor).toContainText('Known local copy.', { timeout: 20_000 });
      assert.equal(new URL(page.url()).origin, `http://127.0.0.1:${localPort}`);
      const initial = await invoke('snapshot');
      assert.equal(initial.status.snapshotComplete, true);
      assert.equal(initial.profile.mode, 'manual');
      assert.equal(initial.status.pendingCount, 0);
      const oldHead = noteEntry(initial).localHead;
      const oldRevision = (await getNote()).data.revision;
      await editor.fill(editedText);
      await page.keyboard.press('Control+s');
      await expect.poll(async () => (await getNote()).data.content, { timeout: 15_000 }).toBe(editedText);
      await page.locator('.pm-note-item').filter({ hasText: 'Beta' }).click();
      await expect(editor).toContainText('Second offline note.');
      await page.locator('.pm-note-item').filter({ hasText: 'Alpha' }).click();
      await expect(editor).toContainText('Native offline edit survives process restart.');
      assert.equal((await invoke('snapshot')).status.pendingCount, 1);
      t.diagnostic('PASS: packaged UI opens known manual replica, edits and saves via native IPC, navigates two notes');

      // Verify native media capability and actual Chromium decoding, no route interception.
      const mediaUrl = (await invoke('mediaUrl', { entryId: media.entryId })).url;
      const mediaResult = await page.evaluate(async url => {
        const response = await fetch(url); const bytes = [...new Uint8Array(await response.arrayBuffer())];
        const image = new Image(); image.src = url; await image.decode();
        return { status: response.status, bytes, width: image.naturalWidth, height: image.naturalHeight };
      }, mediaUrl);
      assert.equal(mediaResult.status, 200); assert.deepEqual(mediaResult.bytes, [...png]);
      assert.equal(mediaResult.width, 1); assert.equal(mediaResult.height, 1);
      t.diagnostic('PASS: packaged native media bytes and Chromium image decode');

      await stop();
      await launch();
      await expect(page.locator('.cm-content')).toContainText('Native offline edit survives process restart.', { timeout: 20_000 });
      assert.equal((await getNote()).data.content, editedText);
      assert.equal((await invoke('snapshot')).status.pendingCount, 1);
      t.diagnostic('PASS: full native process restart preserves UI content and SQLite pending state');

      const staleWrite = await invoke('request', { url: '/api/note?path=Alpha.md', method: 'PUT', body: { content: 'STALE OVERWRITE', baseRevision: oldRevision } });
      assert.equal(staleWrite.status, 409); assert.equal(staleWrite.data.error, 'stale-local-revision');
      assert.equal((await getNote()).data.content, editedText);
      const beforePull = await invoke('snapshot');
      const stalePull = await invokeRaw('persistIncoming', { nextCursor: 'native:2', items: [{ expectedLocalHead: oldHead,
        decision: { action: 'pull', reason: 'remote', base, local: base, remote } }] });
      assert.equal(stalePull.ok, false); assert.equal(stalePull.error, 'stale-local-head');
      assert.deepEqual(await invoke('snapshot'), beforePull);

      const local = noteEntry(beforePull);
      await invoke('persistIncoming', { nextCursor: 'native:2', items: [{ expectedLocalHead: local.localHead,
        decision: { action: 'conflict', reason: 'both-modified', base, local: local.local, remote } }] });
      const conflicted = await invoke('snapshot');
      const conflict = conflicted.conflicts[0];
      assert.equal(conflicted.conflicts.length, 1);
      assert.equal((await getNote()).data.content, editedText);
      for (const [version, content] of [[conflict.base, baseText], [conflict.local, editedText], [conflict.remote, '# Remote candidate\n']]) {
        assert.equal((await invoke('readVersion', { version })).content, content);
      }
      const currentRevision = (await getNote()).data.revision;
      assert.equal((await invoke('request', { url: '/api/note?path=Alpha.md', method: 'PUT', body: { content: newerText, baseRevision: currentRevision } })).status, 200);
      const beforeResolve = await invoke('snapshot');
      const staleResolve = await invokeRaw('resolve', { conflictId: conflict.conflictId, expectedLocalHead: local.localHead,
        expectedRemoteRevision: remote.revision, choice: 'remote' });
      assert.equal(staleResolve.ok, false); assert.equal(staleResolve.error, 'stale-conflict-resolution');
      assert.deepEqual(await invoke('snapshot'), beforeResolve);
      assert.equal((await getNote()).data.content, newerText);
      t.diagnostic('PASS: stale PUT/pull/resolution rejected; cursor and conflict unchanged; all three versions readable');
      await stop();

      // Independently reopen SQLite/files after Electron exits: no renderer draft
      // can satisfy these persistence assertions.
      const reopened = await createReplicaService({ userData, profile });
      try {
        const state = await reopened.snapshot();
        assert.equal((await reopened.request('/api/note?path=Alpha.md', 'GET')).data.content, newerText);
        assert.equal(await readFile(join(reopened.workingRoot, 'Alpha.md'), 'utf8'), newerText);
        assert.equal(state.conflicts.length, 1); assert.equal(state.status.pendingCount, 1);
        for (const [version, content] of [[conflict.base, baseText], [conflict.local, editedText], [conflict.remote, '# Remote candidate\n']]) {
          assert.equal((await reopened.readVersion(version)).content, content);
        }
      } finally { await reopened.close(); }
      assert.equal(hostConnections, 0, 'Native or renderer attempted the unavailable host');
      assert.deepEqual(rendererHostRequests, [], 'Renderer requested unavailable host');
      t.diagnostic('PASS: zero native remote IPC commands, host TCP connections and renderer host requests throughout both boots');
      passed = true;
    } finally {
      clearTimeout(watchdog);
      if (!passed) t.diagnostic(`Fixture retained: ${root}\nHost connections: ${hostConnections}\n${processLog}`);
      try { await stop(); } finally {
        killOwned();
        if (reservation.listening) await closeServer(reservation);
        await closeServer(unreachable);
      }
      if (passed) {
        const owned = relative(tmpdir(), root);
        assert.ok(owned.startsWith('pentamark-native-offline-') && !owned.includes(sep), 'Cleanup restricted to this mkdtemp fixture');
        await rm(root, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  });
