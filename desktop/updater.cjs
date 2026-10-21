'use strict';

const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { join, resolve, relative, isAbsolute, win32 } = require('node:path');
const { tmpdir } = require('node:os');

const LATEST = 'https://api.github.com/repos/ItsDeimox/PentaMark/releases/latest';
const MAX_ASSET = 512 * 1024 * 1024;
const MAX_METADATA = 1024 * 1024;
const STORAGE_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

function stableVersion(value) {
  if (typeof value !== 'string' || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Versão estável inválida.');
  }
  const version = value.replace(/^v/, '');
  if (version.split('.').some(part => !Number.isSafeInteger(Number(part)))) throw new Error('Versão inválida.');
  return version;
}

function compareVersions(a, b) {
  const left = stableVersion(a).split('.').map(Number);
  const right = stableVersion(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

function selectRelease(metadata, currentVersion) {
  if (!metadata || typeof metadata !== 'object' || typeof metadata.tag_name !== 'string' ||
      typeof metadata.draft !== 'boolean' || typeof metadata.prerelease !== 'boolean') {
    throw new Error('Metadados da atualização inválidos.');
  }
  if (metadata.draft || metadata.prerelease) return null;
  // A non-stable tag must never be offered even if GitHub incorrectly calls it stable.
  if (/^v?\d+\.\d+\.\d+-/.test(metadata.tag_name)) return null;
  const version = stableVersion(metadata.tag_name);
  if (compareVersions(version, currentVersion) <= 0) return null;
  const name = `PentaMark-Desktop-${version}-Windows.exe`;
  const assets = Array.isArray(metadata.assets) ? metadata.assets.filter(asset => asset?.name === name) : [];
  if (assets.length !== 1) throw new Error('Executável portátil da atualização ausente ou duplicado.');
  const asset = assets[0];
  const url = `https://github.com/ItsDeimox/PentaMark/releases/download/${encodeURIComponent(metadata.tag_name)}/${name}`;
  if (asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET ||
      typeof asset.digest !== 'string' || !/^sha256:[a-fA-F0-9]{64}$/.test(asset.digest) ||
      asset.browser_download_url !== url) {
    throw new Error('Atualização sem tamanho, SHA-256 ou endereço oficial válido.');
  }
  return Object.freeze({ version, size: asset.size, sha256: asset.digest.slice(7).toLowerCase(), url });
}

function windowsFile(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z]:\\/.test(value) || /[\x00-\x1f<>"|?*]/.test(value) ||
      value.slice(2).includes(':') || value.split('\\').slice(1).some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new Error('Caminho do executável portátil inválido; use uma unidade local do Windows.');
  }
  return win32.normalize(value);
}

function portableExecutable(env, execPath) {
  const original = windowsFile(env.PORTABLE_EXECUTABLE_FILE);
  if (!original.toLowerCase().endsWith('.exe') || original.toLowerCase() === win32.normalize(execPath).toLowerCase()) {
    throw new Error('O executável original do portátil não foi identificado; não é seguro substituir a cópia extraída.');
  }
  if (env.PORTABLE_EXECUTABLE_DIR && win32.normalize(env.PORTABLE_EXECUTABLE_DIR).toLowerCase() !== win32.dirname(original).toLowerCase()) {
    throw new Error('A pasta do executável portátil não corresponde ao arquivo original.');
  }
  return original;
}

async function validateOriginal(original) {
  // Refuse links/junctions at every level, including directory junctions resolving
  // back to the same spelling. The helper repeats this just before replacement.
  let cursor = original;
  while (true) {
    const info = await fs.lstat(cursor);
    if (info.isSymbolicLink() || (cursor === original ? !info.isFile() : !info.isDirectory())) {
      throw new Error('O portátil deve ser um arquivo local, sem links ou junções.');
    }
    const parent = win32.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if ((await fs.realpath(original)).toLowerCase() !== original.toLowerCase()) {
    throw new Error('O caminho real do portátil difere do destino informado.');
  }
}

function helperLaunch(config, environment) {
  const systemRoot = environment.SystemRoot || environment.SYSTEMROOT;
  windowsFile(`${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`);
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (/^(ELECTRON_RUN_AS_NODE|ELECTRON_NO_ASAR|PENTAMARK_UPDATER_.*)$/i.test(key)) delete env[key];
  }
  env.PENTAMARK_UPDATER_CONFIG = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
  env.PENTAMARK_UPDATER_SCRIPT = join(config.workDir, 'apply-update.ps1');
  // Windows PowerShell may exit silently with Node's DETACHED_PROCESS flag.
  // Start-Process creates the independent hidden helper; the short bootstrap
  // stays attached. All arguments containing code are constant/base64 tokens.
  const worker = "$ErrorActionPreference='Stop'; & ([Environment]::GetEnvironmentVariable('PENTAMARK_UPDATER_SCRIPT')); exit $LASTEXITCODE";
  env.PENTAMARK_UPDATER_COMMAND = Buffer.from(worker, 'utf16le').toString('base64');
  const bootstrap = "$ErrorActionPreference='Stop'; Start-Process -FilePath ([Environment]::GetEnvironmentVariable('PENTAMARK_UPDATER_POWERSHELL')) -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',([Environment]::GetEnvironmentVariable('PENTAMARK_UPDATER_COMMAND'))) -WindowStyle Hidden";
  env.PENTAMARK_UPDATER_POWERSHELL = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return {
    command: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')],
    options: { env, cwd: config.workDir, detached: false, windowsHide: true, shell: false, stdio: 'ignore' },
  };
}

function storageURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !STORAGE_HOSTS.has(url.hostname)) {
    throw new Error('Redirecionamento da atualização não autorizado.');
  }
  return url.href;
}

async function request(url, { fetch: fetchImpl, signal, asset = false }) {
  for (let hop = 0; hop <= 3; hop++) {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'manual', credentials: 'omit', signal,
      headers: { Accept: asset ? 'application/octet-stream' : 'application/vnd.github+json',
        'Accept-Encoding': 'identity', 'User-Agent': 'PentaMark-Desktop-Updater',
        ...(!asset ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}) },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!asset || hop === 3 || !location) throw new Error('Redirecionamento da atualização recusado.');
      url = storageURL(new URL(location, url).href);
      continue;
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error(`Não foi possível obter a atualização (HTTP ${response.status}).`);
    }
    return response;
  }
  throw new Error('Muitos redirecionamentos na atualização.');
}

function deadline(ms, work) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Tempo limite da atualização excedido.')), ms);
  return Promise.resolve().then(() => work(controller.signal)).finally(() => clearTimeout(timer));
}

async function verifyFile(file, release) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== release.size) throw new Error('Tamanho do download inválido.');
  const hash = createHash('sha256');
  let count = 0;
  for await (const chunk of createReadStream(file)) {
    count += chunk.length;
    if (count > release.size) throw new Error('O download excede o tamanho esperado.');
    hash.update(chunk);
  }
  if (count !== release.size || hash.digest('hex') !== release.sha256) throw new Error('A verificação SHA-256 da atualização falhou.');
}

function containedIn(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (!path.startsWith(`..${require('node:path').sep}`) && path !== '..' && !isAbsolute(path));
}

/** Main-process API. The second argument is only for trusted Node tests; never IPC. */
function createUpdater({ app, stopServer, dataRoot }, dependencies = {}) {
  const deps = Object.assign({ platform: process.platform, env: process.env, execPath: process.execPath,
    tempRoot: tmpdir(), fetch: globalThis.fetch, spawn, validateOriginal,
    metadataTimeoutMs: 15000, downloadTimeoutMs: 10 * 60 * 1000, helperTimeoutMs: 15000, pollMs: 50 }, dependencies);
  const currentVersion = String(app.getVersion());
  let status = { phase: 'idle', currentVersion };
  let release = null, workDir = null, busy = false;
  const getDataRoot = () => typeof dataRoot === 'function' ? dataRoot() : dataRoot;
  const snapshot = () => ({ ...status });
  const set = (phase, extra = {}) => { status = { phase, currentVersion, ...extra }; };
  const supported = () => {
    if (deps.platform !== 'win32') throw new Error('A atualização automática está disponível apenas no Windows.');
    if (!app.isPackaged) throw new Error('A atualização exige a versão portátil empacotada do PentaMark.');
    portableExecutable(deps.env, deps.execPath);
    stableVersion(currentVersion);
  };
  async function operation(work, background = false) {
    if (busy || status.phase === 'installing') return snapshot();
    busy = true;
    const task = (async () => {
      try { supported(); await work(); }
      catch (error) { set('error', { ...(release ? { version: release.version } : {}), error: `Não foi possível atualizar: ${error.message || String(error)}` }); }
      finally { busy = false; }
    })();
    if (!background) await task;
    return snapshot();
  }
  async function staging() {
    if (!workDir) {
      // Logs and the detached helper must outlive NSIS's extraction cleanup and
      // must never be put inside dataRoot/the vault. Only exact files are removed.
      const roots = [getDataRoot(), deps.env.PENTAMARK_VAULT_DIR || ''].filter(root => typeof root === 'string' && root);
      if (roots.some(root => containedIn(root, deps.tempRoot))) throw new Error('A pasta temporária da atualização deve ficar fora do cofre.');
      workDir = await fs.mkdtemp(join(deps.tempRoot, 'pentamark-update-'));
    }
    return workDir;
  }
  async function check() {
    return operation(async () => {
      release = null;
      set('checking');
      if (workDir) {
        await fs.rm(join(workDir, 'update.exe'), { force: true });
        workDir = null; // Never reuse markers/script paths of a cancelled helper.
      }
      const metadata = await deadline(deps.metadataTimeoutMs, async signal => {
        const response = await request(LATEST, { fetch: deps.fetch, signal });
        const chunks = [];
        let count = 0;
        for await (const chunk of response.body) {
          signal.throwIfAborted(); count += chunk.length;
          if (count > MAX_METADATA) throw new Error('Metadados da atualização excedem o limite.');
          chunks.push(Buffer.from(chunk));
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      });
      release = selectRelease(metadata, currentVersion);
      set(release ? 'available' : 'current', release ? { version: release.version } : {});
    }, true);
  }
  async function download() {
    return operation(async () => {
      if (status.phase === 'ready') return;
      if (!release || status.phase !== 'available') throw new Error('Consulte uma atualização válida antes de baixar.');
      set('downloading', { version: release.version, progress: 0 });
      const directory = await staging();
      const partial = join(directory, 'update.exe.part'), complete = join(directory, 'update.exe');
      await fs.rm(complete, { force: true });
      try {
        await deadline(deps.downloadTimeoutMs, async signal => {
          const response = await request(release.url, { fetch: deps.fetch, signal, asset: true });
          const length = response.headers.get('content-length');
          if (length !== null && (!/^\d+$/.test(length) || Number(length) !== release.size)) {
            await response.body.cancel();
            throw new Error('O servidor informou um tamanho diferente para a atualização.');
          }
          const file = await fs.open(partial, 'wx', 0o600);
          try {
            const hash = createHash('sha256');
            let count = 0;
            for await (const chunk of response.body) {
              signal.throwIfAborted(); count += chunk.length;
              if (count > release.size || count > MAX_ASSET) throw new Error('O download excede o tamanho esperado.');
              hash.update(chunk);
              // FileHandle.write can be short; writeFile handles the entire chunk.
              await file.writeFile(chunk);
              set('downloading', { version: release.version, progress: Math.floor(count / release.size * 100) });
            }
            signal.throwIfAborted();
            if (count !== release.size || hash.digest('hex') !== release.sha256) throw new Error('Tamanho ou SHA-256 da atualização não confere.');
            await file.sync();
          } finally { await file.close(); }
        });
        await fs.rename(partial, complete);
        set('ready', { version: release.version, progress: 100 });
      } catch (error) { await fs.rm(partial, { force: true }); throw error; }
    }, true);
  }
  async function install() {
    return operation(async () => {
      if (!release || status.phase !== 'ready' || !workDir) throw new Error('Baixe e verifique a atualização antes de instalar.');
      const directory = getDataRoot();
      if (typeof directory !== 'string' || !win32.isAbsolute(directory) || typeof stopServer !== 'function') {
        throw new Error('A pasta de dados ou o encerramento do servidor não foi configurado.');
      }
      const original = portableExecutable(deps.env, deps.execPath);
      await deps.validateOriginal(original);
      await verifyFile(join(workDir, 'update.exe'), release);
      // Copy out of app.asar and NSIS's temporary app directory before quitting.
      await fs.copyFile(join(__dirname, 'apply-update.ps1'), join(workDir, 'apply-update.ps1'));
      const token = randomBytes(16).toString('hex');
      const config = { workDir, original, execPath: deps.execPath, dataRoot: directory, pid: process.pid, parentPid: process.ppid,
        size: release.size, sha256: release.sha256, token };
      const launch = helperLaunch(config, deps.env);
      let child, failure = null;
      try {
        child = deps.spawn(launch.command, launch.args, launch.options);
        child.on('error', error => { failure = error; });
        child.on('exit', code => { if (code !== 0) failure ||= new Error('O auxiliar de atualização encerrou antes de confirmar.'); });
        child.unref();
        const until = Date.now() + deps.helperTimeoutMs;
        while (true) {
          if (failure) throw failure;
          let ready;
          try { ready = await fs.readFile(join(workDir, 'ready'), 'utf8'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (ready === token) break;
          if (Date.now() >= until) throw new Error('O auxiliar de atualização não confirmou a inicialização.');
          await sleep(deps.pollMs);
        }
        // The helper has validated its inputs and captured process handles. A
        // cancellation or server-stop error leaves the original exe untouched.
        await stopServer();
        if (failure) throw failure;
        await fs.writeFile(join(workDir, 'go'), token, { flag: 'wx', mode: 0o600 });
        set('installing', { version: release.version, progress: 100 });
        app.quit();
      } catch (error) {
        await fs.writeFile(join(workDir, 'cancel'), token, { mode: 0o600 });
        throw error;
      }
    });
  }
  return { getStatus: async () => snapshot(), check, download, install };
}

module.exports = { createUpdater, stableVersion, compareVersions, selectRelease, portableExecutable, helperLaunch };
