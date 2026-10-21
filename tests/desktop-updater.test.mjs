import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import updater from '../desktop/updater.cjs';

const { createUpdater, stableVersion, compareVersions, selectRelease, portableExecutable, helperLaunch } = updater;
const bytes = Buffer.from('a verified portable executable fixture');
const digest = createHash('sha256').update(bytes).digest('hex');
const latest = 'https://api.github.com/repos/ItsDeimox/PentaMark/releases/latest';
const assetURL = 'https://github.com/ItsDeimox/PentaMark/releases/download/v2.14.0/PentaMark-Desktop-2.14.0-Windows.exe';
const original = "C:\\Apps & coisas\\Penta'Mark $() ` [x].exe";
const extracted = 'C:\\Temp\\ns123\\app\\PentaMark.exe';
function release() {
  return { tag_name: 'v2.14.0', draft: false, prerelease: false, assets: [{
    name: 'PentaMark-Desktop-2.14.0-Windows.exe', size: bytes.length,
    digest: `sha256:${digest}`, browser_download_url: assetURL, state: 'uploaded',
  }] };
}
async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(process.cwd(), '.pm-updater-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [], events = [];
  const app = { isPackaged: true, getVersion: () => '2.13.18', quit: () => events.push('quit') };
  const deps = {
    platform: 'win32', env: { SystemRoot: 'C:\\Windows', PORTABLE_EXECUTABLE_FILE: original,
      PORTABLE_EXECUTABLE_DIR: win32.dirname(original), ELECTRON_RUN_AS_NODE: '1', KEEP_ME: 'kept' },
    execPath: extracted, tempRoot: root, helperTimeoutMs: 100, pollMs: 1,
    validateOriginal: async path => { assert.equal(path, original); },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return url === latest ? Response.json(release()) : new Response(bytes);
    },
    spawn: (_file, _args, options) => {
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(async () => {
        const config = JSON.parse(Buffer.from(options.env.PENTAMARK_UPDATER_CONFIG, 'base64').toString('utf8'));
        events.push('helper');
        await writeFile(join(config.workDir, 'ready'), config.token);
        child.emit('spawn');
      });
      return child;
    },
    ...overrides,
  };
  const instance = createUpdater({ app, dataRoot: 'C:\\Notes', stopServer: async () => events.push('stop') }, {
    ...deps, fetch: (...args) => deps.fetch(...args),
  });
  return { instance, app, deps, root, calls, events };
}
async function settle(instance, method) {
  await instance[method]();
  const until = Date.now() + 2000;
  while (true) {
    const status = await instance.getStatus();
    if (!['checking', 'downloading'].includes(status.phase)) return status;
    assert.ok(Date.now() < until, 'background action did not settle');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

test('stable versions compare numerically and reject prereleases, ambiguous tags and overflow', () => {
  assert.equal(stableVersion('v2.14.0'), '2.14.0');
  assert.equal(compareVersions('2.10.0', '2.9.99'), 1);
  assert.equal(compareVersions('2.13.18', '2.13.18'), 0);
  assert.equal(compareVersions('1.99.99', '2.0.0'), -1);
  for (const v of ['2.14.0-beta.1', '2.14.0+build', '02.14.0', '2.14', '../2.14.0', '9007199254740992.0.0']) {
    assert.throws(() => stableVersion(v));
  }
});

test('metadata selects only a newer stable release and the exact verified Windows asset', () => {
  assert.deepEqual(selectRelease(release(), '2.13.18'), { version: '2.14.0', size: bytes.length, sha256: digest, url: assetURL });
  assert.equal(selectRelease(release(), '2.14.0'), null);
  assert.equal(selectRelease(release(), '3.0.0'), null);
  for (const patch of [{ draft: true }, { prerelease: true }, { tag_name: 'v2.14.0-rc.1' }]) {
    assert.equal(selectRelease({ ...release(), ...patch }, '2.13.18'), null);
  }
  for (const patch of [
    { digest: undefined }, { digest: 'sha512:abcd' }, { digest: `sha256:${'x'.repeat(64)}` },
    { size: 0 }, { size: -1 }, { size: 1.5 }, { size: 600 * 1024 * 1024 },
    { name: 'PentaMark-Setup.exe' }, { state: 'new' },
    { browser_download_url: 'https://evil.test/Windows.exe' },
    { browser_download_url: assetURL.replace('ItsDeimox', 'SomeoneElse') },
    { browser_download_url: assetURL.replace('https://', 'https://user:secret@') },
  ]) {
    const metadata = release();
    Object.assign(metadata.assets[0], patch);
    assert.throws(() => selectRelease(metadata, '2.13.18'), JSON.stringify(patch));
  }
  const duplicate = release(); duplicate.assets.push({ ...duplicate.assets[0] });
  assert.throws(() => selectRelease(duplicate, '2.13.18'));
});

test('portable destination is the original NSIS executable, with no extracted-path fallback', () => {
  assert.equal(portableExecutable({ PORTABLE_EXECUTABLE_FILE: original, PORTABLE_EXECUTABLE_DIR: win32.dirname(original) }, extracted), original);
  for (const value of [undefined, 'relative.exe', '\\\\host\\share\\app.exe', 'C:\\app.exe:stream', 'C:\\a\\..\\app.exe', 'C:\\app.exe.', extracted]) {
    assert.throws(() => portableExecutable({ PORTABLE_EXECUTABLE_FILE: value }, extracted), String(value));
  }
  assert.throws(() => portableExecutable({ PORTABLE_EXECUTABLE_FILE: original, PORTABLE_EXECUTABLE_DIR: 'C:\\Other' }, extracted));
});

test('helper command carries paths as data and sanitizes Electron node mode while preserving data environment', () => {
  const config = { original, workDir: 'C:\\Temp\\work', dataRoot: "C:\\Dados & '$()", token: 'abc' };
  const launch = helperLaunch(config, { SystemRoot: 'C:\\Windows', KEEP_ME: 'kept', ELECTRON_RUN_AS_NODE: '1' });
  assert.equal(launch.command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.windowsHide, true);
  assert.equal(launch.options.detached, false);
  assert.equal(launch.options.env.KEEP_ME, 'kept');
  assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.deepEqual(JSON.parse(Buffer.from(launch.options.env.PENTAMARK_UPDATER_CONFIG, 'base64').toString('utf8')), config);
  const command = Buffer.from(launch.args.at(-1), 'base64').toString('utf16le');
  assert.ok(!command.includes(original));
  assert.ok(!command.includes(config.dataRoot));
});

test('unsupported builds fail in Portuguese without touching network or shutting down', async t => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const f = await fixture(t, { platform });
    if (platform === 'win32') f.app.isPackaged = false;
    for (const method of ['check', 'download', 'install']) {
      const status = await f.instance[method]();
      assert.equal(status.phase, 'error');
      assert.match(status.error, /Windows|empacotad|portátil/);
    }
    assert.equal(f.calls.length, 0); assert.deepEqual(f.events, []);
  }
});

test('check uses fixed public GitHub endpoint, snapshots cannot mutate status, and no renderer URL is used', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.instance.getStatus(), { phase: 'idle', currentVersion: '2.13.18' });
  const starting = await f.instance.check('https://evil.test');
  assert.equal(starting.phase, 'checking');
  const status = await settle(f.instance, 'getStatus');
  assert.equal(status.phase, 'available'); assert.equal(status.version, '2.14.0');
  status.version = 'malicious';
  assert.equal((await f.instance.getStatus()).version, '2.14.0');
  assert.equal(f.calls[0].url, latest);
  assert.equal(f.calls[0].options.redirect, 'manual');
  assert.equal(f.calls[0].options.credentials, 'omit');
  assert.equal(f.calls[0].options.headers.Authorization, undefined);
});

test('current version reports current and failed recheck clears stale ready state', async t => {
  const f = await fixture(t);
  await settle(f.instance, 'check'); await settle(f.instance, 'download');
  f.deps.fetch = async () => { throw new Error('offline'); };
  assert.equal((await settle(f.instance, 'check')).phase, 'error');
  assert.equal((await f.instance.install()).phase, 'error');
  assert.deepEqual(f.events, []);
  const g = await fixture(t, { fetch: async () => Response.json({ ...release(), tag_name: 'v2.13.18' }) });
  assert.equal((await settle(g.instance, 'check')).phase, 'current');
});

test('verified streamed download is atomically promoted and progress reaches 100', async t => {
  const f = await fixture(t);
  await settle(f.instance, 'check');
  assert.equal((await f.instance.download('https://evil.test')).phase, 'downloading');
  const status = await settle(f.instance, 'getStatus');
  assert.equal(status.phase, 'ready', status.error); assert.equal(status.progress, 100);
  const [folder] = await readdir(f.root);
  const files = await readdir(join(f.root, folder));
  assert.ok(!files.some(name => name.endsWith('.part')));
  assert.deepEqual(await readFile(join(f.root, folder, 'update.exe')), bytes);
  assert.equal(f.calls[1].url, assetURL);
});

test('checksum mismatch, truncated and oversized bodies never become ready and remove the part file', async t => {
  for (const body of [Buffer.alloc(bytes.length, 0), bytes.subarray(1), Buffer.concat([bytes, bytes])]) {
    const f = await fixture(t, { fetch: async url => url === latest ? Response.json(release()) : new Response(body) });
    await settle(f.instance, 'check');
    assert.equal((await settle(f.instance, 'download')).phase, 'error');
    const [folder] = await readdir(f.root);
    assert.deepEqual(await readdir(join(f.root, folder)), []);
    assert.equal((await f.instance.install()).phase, 'error');
    assert.deepEqual(f.events, []);
  }
});

test('redirects allow only GitHub asset storage, without forwarding credentials', async t => {
  const storage = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/asset?signature=x';
  const urls = [];
  const f = await fixture(t, { fetch: async (url, options) => {
    urls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, undefined);
    if (url === latest) return Response.json(release());
    if (url === assetURL) return new Response(null, { status: 302, headers: { location: storage } });
    return new Response(bytes);
  } });
  await settle(f.instance, 'check'); const downloaded = await settle(f.instance, 'download'); assert.equal(downloaded.phase, 'ready', downloaded.error);
  assert.deepEqual(urls, [latest, assetURL, storage]);
  for (const location of ['http://release-assets.githubusercontent.com/x', 'https://evil.test/x', 'https://github.com/other/repo/x', 'https://u:p@objects.githubusercontent.com/x', 'https://objects.githubusercontent.com:444/x']) {
    const g = await fixture(t, { fetch: async url => url === latest ? Response.json(release()) : new Response(null, { status: 302, headers: { location } }) });
    await settle(g.instance, 'check'); assert.equal((await settle(g.instance, 'download')).phase, 'error', location);
  }
});

test('metadata size, HTTP failure, redirect loop and request deadline are bounded', async t => {
  for (const response of [new Response('x'.repeat(1024 * 1024 + 1)), new Response('rate limited', { status: 403 }), new Response(null, { status: 302, headers: { location: latest } })]) {
    const f = await fixture(t, { fetch: async () => response });
    assert.equal((await settle(f.instance, 'check')).phase, 'error');
  }
  const f = await fixture(t, { metadataTimeoutMs: 10, fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  assert.equal((await settle(f.instance, 'check')).phase, 'error');
});

test('install requires helper readiness before stopping the server and quitting', async t => {
  const f = await fixture(t);
  await settle(f.instance, 'check'); await settle(f.instance, 'download');
  const installed = await f.instance.install(); assert.equal(installed.phase, 'installing', installed.error);
  assert.deepEqual(f.events, ['helper', 'stop', 'quit']);
  const [folder] = await readdir(f.root);
  assert.ok((await readdir(join(f.root, folder))).includes('go'));
});

test('helper spawn errors and missing readiness keep the app and server alive', async t => {
  for (const spawn of [() => { throw new Error('spawn failed'); }, () => {
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => child.emit('error', new Error('ENOENT'))); return child;
  }, () => { const child = new EventEmitter(); child.unref = () => {}; return child; }]) {
    const f = await fixture(t, { spawn, helperTimeoutMs: 15 });
    await settle(f.instance, 'check'); await settle(f.instance, 'download');
    assert.equal((await f.instance.install()).phase, 'error');
    assert.deepEqual(f.events, []);
  }
});

test('successful bootstrap exit before worker readiness is expected, not an install failure', async t => {
  const f = await fixture(t);
  const instance = createUpdater({ app: f.app, dataRoot: () => 'C:\\Notes', stopServer: async () => f.events.push('stop') }, {
    ...f.deps,
    spawn: (_file, _args, options) => {
      const child = new EventEmitter(); child.unref = () => {};
      const config = JSON.parse(Buffer.from(options.env.PENTAMARK_UPDATER_CONFIG, 'base64').toString('utf8'));
      queueMicrotask(() => child.emit('exit', 0));
      setTimeout(() => writeFile(join(config.workDir, 'ready'), config.token), 10);
      return child;
    },
  });
  await settle(instance, 'check'); await settle(instance, 'download');
  const status = await instance.install();
  assert.equal(status.phase, 'installing', status.error);
  assert.deepEqual(f.events, ['stop', 'quit']);
});

test('reverification and original-path validation prevent installation after tampering', async t => {
  const f = await fixture(t);
  await settle(f.instance, 'check'); await settle(f.instance, 'download');
  const [folder] = await readdir(f.root);
  await writeFile(join(f.root, folder, 'update.exe'), Buffer.alloc(bytes.length));
  assert.equal((await f.instance.install()).phase, 'error'); assert.deepEqual(f.events, []);
  const g = await fixture(t, { validateOriginal: async () => { throw new Error('link/reparse'); } });
  await settle(g.instance, 'check'); await settle(g.instance, 'download');
  assert.equal((await g.instance.install()).phase, 'error'); assert.deepEqual(g.events, []);
});

test('concurrent calls cannot race check/download against install', async t => {
  let releaseRequest;
  const f = await fixture(t, { fetch: async () => new Promise(resolve => { releaseRequest = resolve; }) });
  const checking = f.instance.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.instance.download()).phase, 'checking');
  assert.equal((await f.instance.install()).phase, 'checking');
  releaseRequest(Response.json(release()));
  assert.equal((await checking).phase, 'checking');
  assert.equal((await settle(f.instance, 'getStatus')).phase, 'available');
});

test('background download exposes intermediate progress to concurrent polling', async t => {
  let stream;
  const f = await fixture(t, { fetch: async url => url === latest ? Response.json(release()) : new Response(new ReadableStream({ start(controller) { stream = controller; } })) });
  await settle(f.instance, 'check');
  assert.equal((await f.instance.download()).phase, 'downloading');
  const until = Date.now() + 2000;
  while (!stream) { assert.ok(Date.now() < until); await new Promise(resolve => setTimeout(resolve, 2)); }
  stream.enqueue(bytes.subarray(0, 10));
  let status;
  do { status = await f.instance.getStatus(); await new Promise(resolve => setTimeout(resolve, 2)); } while (!status.progress && Date.now() < until);
  assert.equal(status.phase, 'downloading'); assert.ok(status.progress > 0 && status.progress < 100);
  stream.enqueue(bytes.subarray(10)); stream.close();
  assert.equal((await settle(f.instance, 'getStatus')).phase, 'ready');
});

test('integration accepts a dataRoot function and reports the running app version', async t => {
  const f = await fixture(t);
  f.app.getVersion = () => '2.13.19';
  let captured;
  const instance = createUpdater({ app: f.app, dataRoot: () => "C:\\Dados & ' notas", stopServer: async () => {} }, {
    ...f.deps, spawn: (file, args, options) => {
      captured = JSON.parse(Buffer.from(options.env.PENTAMARK_UPDATER_CONFIG, 'base64').toString('utf8'));
      return f.deps.spawn(file, args, options);
    },
  });
  assert.equal((await instance.getStatus()).currentVersion, '2.13.19');
  await settle(instance, 'check'); await settle(instance, 'download');
  const status = await instance.install();
  assert.equal(status.phase, 'installing', status.error);
  assert.equal(captured.dataRoot, "C:\\Dados & ' notas");
});

test('PowerShell helper parses without executing any update', { skip: process.platform !== 'win32' }, () => {
  const script = new URL('../desktop/apply-update.ps1', import.meta.url);
  const command = '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:PM_PARSE_PATH,[ref]$tokens,[ref]$errors) > $null; if ($errors.Count) { $errors | Out-String | Write-Output; exit 1 }';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    env: { ...process.env, PM_PARSE_PATH: decodeURIComponent(script.pathname).replace(/^\//, '') }, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('PowerShell swap succeeds and rolls back a failed launch using inert fixture files only', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(process.cwd(), '.pm-updater-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = new URL('../desktop/apply-update.ps1', import.meta.url);
  // Load function definitions from the actual helper, WITHOUT running its entry
  // point, waiting on a real application, or starting any executable. Only inert
  // fixture bytes are swapped; Start-Portable is replaced at the process boundary.
  const harness = `
    $ErrorActionPreference='Stop'
    $tokens=$null; $errors=$null
    $ast=[System.Management.Automation.Language.Parser]::ParseFile($env:PM_PARSE_PATH,[ref]$tokens,[ref]$errors)
    if ($errors.Count) { throw 'parse failure' }
    foreach ($f in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
      . ([scriptblock]::Create($f.Extent.Text))
    }
    $script:launches=New-Object 'Collections.Generic.List[string]'
    function Start-Portable([string] $Path, [string] $DataDirectory) {
      if ($DataDirectory -cne $env:PM_DATA_DIR) { throw 'dataRoot lost' }
      $script:launches.Add((Get-UpdateHash $Path))
      if ($env:PM_SCENARIO -eq 'launch-fails' -and $script:launches.Count -eq 1) { throw 'simulated launch failure' }
    }
    $failed=$false; $failureMessage=''
    try { Invoke-PortableSwap $env:PM_ORIGINAL $env:PM_PAYLOAD ([long]$env:PM_SIZE) $env:PM_HASH $env:PM_TOKEN $env:PM_DATA_DIR $env:PM_CANCEL }
    catch { $failed=$true; $failureMessage=$_.Exception.Message }
    @{failed=$failed;message=$failureMessage;launches=@($script:launches.ToArray())} | ConvertTo-Json -Compress
  `;
  const previous = Buffer.from('previous portable fixture');
  const oldHash = createHash('sha256').update(previous).digest('hex');
  for (const scenario of ['success', 'launch-fails', 'bad-checksum', 'existing-backup']) {
    const destination = join(root, `Penta'Mark & $() [${scenario}] é.exe`);
    const payload = join(root, `${scenario}.bin`);
    const token = { success: 'a', 'launch-fails': 'b', 'bad-checksum': 'c', 'existing-backup': 'd' }[scenario].repeat(32);
    const backup = join(root, `.pentamark-update-${token}.bak`);
    await writeFile(destination, previous); await writeFile(payload, bytes);
    if (scenario === 'existing-backup') await writeFile(backup, 'do not overwrite');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')], {
      env: { ...process.env, PM_PARSE_PATH: decodeURIComponent(script.pathname).replace(/^\//, ''),
        PM_ORIGINAL: destination, PM_PAYLOAD: payload, PM_SIZE: String(bytes.length), PM_HASH: scenario === 'bad-checksum' ? '0'.repeat(64) : digest,
        PM_TOKEN: token, PM_DATA_DIR: "C:\\Dados & ' Unicode é", PM_CANCEL: join(root, 'cancel'), PM_SCENARIO: scenario },
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.failed, scenario !== 'success', `${scenario}: ${report.message}`);
    assert.deepEqual(report.launches, scenario === 'success' ? [digest] : scenario === 'launch-fails' ? [digest, oldHash] : [], report.message);
    assert.deepEqual(await readFile(destination), scenario === 'success' ? bytes : previous);
    if (scenario === 'success' || scenario === 'launch-fails') assert.deepEqual(await readFile(backup), previous);
    if (scenario === 'existing-backup') assert.equal(await readFile(backup, 'utf8'), 'do not overwrite');
    assert.ok(!(await readdir(root)).some(name => name.endsWith('.new')));
  }
});

test('native Windows helper replaces only a compiled fixture, preserves notes and relaunches with dataRoot', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const root = await mkdtemp(join(process.cwd(), '.pm-updater-test-'));
  const workDir = join(root, 'helper');
  const dataRoot = join(root, "Dados & $() ' [é]");
  const original = join(root, "Penta'Mark & $() [é].exe");
  const oldBinary = join(root, 'old.exe');
  const payload = join(workDir, 'update.exe');
  const { mkdir, copyFile } = await import('node:fs/promises');
  await mkdir(workDir); await mkdir(dataRoot);
  await writeFile(join(dataRoot, 'notes.md'), 'fixture notes must survive');
  await writeFile(join(dataRoot, 'userdata.json'), '{"preserve":true}');
  const children = [];
  let workerObserver;
  let workerReaped = false;
  t.after(async () => {
    // Cancellation is bound to this fixture and does not touch a process by PID.
    await writeFile(join(workDir, 'cancel'), 'e'.repeat(32));
    if (workerObserver && !workerReaped && workerObserver.exitCode === null) {
      // The observer holds the already-validated worker process handle, so this
      // can only terminate this test's worker, even if Windows reuses its PID.
      workerObserver.stdin.end('cancel\n');
      await new Promise(resolve => workerObserver.once('exit', resolve));
    }
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve));
    }
    // The independent worker logs success just before PowerShell releases its
    // working directory; allow that process to finish before fixture cleanup.
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  });
  const ps = win32.join(process.env.SystemRoot || process.env.SYSTEMROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const compile = `
    $ErrorActionPreference='Stop'
    Add-Type -TypeDefinition 'public class OldFixture { public static void Main() {} }' -OutputAssembly $env:PM_OLD -OutputType ConsoleApplication
    Add-Type -TypeDefinition 'public class NewFixture { public static void Main() { System.IO.File.WriteAllText(System.IO.Path.Combine(System.Environment.GetEnvironmentVariable("PENTAMARK_DATA_DIR"), "relaunched.txt"), "updated"); } }' -OutputAssembly $env:PM_NEW -OutputType ConsoleApplication
  `;
  const compiled = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(compile, 'utf16le').toString('base64')], {
    env: { ...process.env, PM_OLD: oldBinary, PM_NEW: payload }, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  await copyFile(oldBinary, original);
  const oldBytes = await readFile(original), newBytes = await readFile(payload);
  assert.notDeepEqual(oldBytes, newBytes);
  await copyFile(new URL('../desktop/apply-update.ps1', import.meta.url), join(workDir, 'apply-update.ps1'));

  // This is the only process the test terminates: its own disposable sleeper.
  const sleeperCode = "[Console]::WriteLine([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName); Start-Sleep -Seconds 90";
  const sleeper = spawn(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(sleeperCode, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(sleeper);
  let sleeperOutput = '';
  sleeper.stdout.on('data', chunk => { sleeperOutput += chunk; });
  const waitUntil = async (check, label, timeout = 20000) => {
    const until = Date.now() + timeout;
    while (!(await check())) {
      assert.ok(Date.now() < until, `${label}: helper output ${sleeperOutput}`);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  await waitUntil(() => sleeperOutput.includes('\n'), 'fixture process startup');
  const config = { workDir, dataRoot, original, execPath: sleeperOutput.trim(), pid: sleeper.pid, parentPid: process.pid,
    token: 'e'.repeat(32), sha256: createHash('sha256').update(newBytes).digest('hex'), size: newBytes.length };
  const launch = helperLaunch(config, process.env);
  const helper = spawn(launch.command, launch.args, launch.options);
  children.push(helper);
  let helperOutput = '';
  let helperError;
  helper.on('error', error => { helperError = error; });
  await waitUntil(async () => {
    assert.ifError(helperError);
    if (helper.exitCode !== null && helper.exitCode !== 0) {
      const log = await readFile(join(workDir, 'update.log'), 'utf8').catch(() => 'no helper log');
      assert.fail(`helper exited ${helper.exitCode}: ${helperOutput}; ${log}`);
    }
    return await readFile(join(workDir, 'ready'), 'utf8').catch(() => '') === config.token;
  }, 'helper handshake');
  const identity = JSON.parse(await readFile(join(workDir, 'worker.pid'), 'utf8'));
  assert.equal(identity.token, config.token); assert.equal(identity.workDir, workDir);
  assert.ok(Number.isSafeInteger(identity.pid) && identity.pid > 0 && identity.pid !== process.pid && identity.pid !== sleeper.pid);
  assert.match(identity.startedTicks, /^\d+$/);
  // Capture an OS process handle before sending go. Validate PID + executable +
  // creation time; never wait for, or kill, an unrelated reused PID.
  const observe = `
    $ErrorActionPreference='Stop'
    $record=$env:PM_WORKER_RECORD | ConvertFrom-Json
    $p=[Diagnostics.Process]::GetProcessById([int]$record.pid)
    if ($p.MainModule.FileName -ine $env:PM_WORKER_EXE -or $p.StartTime.ToUniversalTime().Ticks.ToString() -cne $record.startedTicks) { throw 'worker identity mismatch' }
    $null=$p.Handle
    [Console]::WriteLine('captured')
    $action=[Console]::ReadLine()
    if ($action -eq 'cancel' -and !$p.HasExited) { $p.Kill() }
    if (!$p.WaitForExit(30000)) { throw 'worker did not exit' }
    $p.Dispose()
  `;
  workerObserver = spawn(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(observe, 'utf16le').toString('base64')], {
    env: { ...process.env, PM_WORKER_RECORD: JSON.stringify(identity), PM_WORKER_EXE: ps }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let observerOutput = '';
  workerObserver.stdout.on('data', chunk => { observerOutput += chunk; });
  workerObserver.stderr.on('data', chunk => { observerOutput += chunk; });
  await waitUntil(() => { assert.equal(workerObserver.exitCode, null, observerOutput); return observerOutput.includes('captured'); }, 'capture actual worker');
  await writeFile(join(workDir, 'go'), config.token, { flag: 'wx' });
  const exited = new Promise(resolve => sleeper.once('exit', resolve));
  sleeper.kill(); await exited;
  let result;
  await waitUntil(async () => {
    result = await readFile(join(workDir, 'result.json'), 'utf8').then(JSON.parse).catch(() => null);
    return result !== null;
  }, 'actual worker result');
  assert.equal(result.token, config.token); assert.equal(result.pid, identity.pid);
  const observedExit = new Promise(resolve => workerObserver.once('exit', resolve));
  workerObserver.stdin.end('wait\n');
  assert.equal(await observedExit, 0, observerOutput);
  workerReaped = true;
  const log = await readFile(join(workDir, 'update.log'), 'utf8');
  assert.equal(result.phase, 'success', log);
  assert.equal(helper.exitCode, 0, helperOutput + log);
  assert.deepEqual(await readFile(original), newBytes);
  assert.deepEqual(await readFile(join(root, `.pentamark-update-${config.token}.bak`)), oldBytes);
  assert.equal(await readFile(join(dataRoot, 'notes.md'), 'utf8'), 'fixture notes must survive');
  assert.equal(await readFile(join(dataRoot, 'userdata.json'), 'utf8'), '{"preserve":true}');
  assert.equal(await readFile(join(dataRoot, 'relaunched.txt'), 'utf8'), 'updated');
});
