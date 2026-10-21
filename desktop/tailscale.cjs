'use strict';

const nativeFs = require('node:fs/promises');
const {execFile: nativeExecFile} = require('node:child_process');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {isIP} = require('node:net');

const API = 'https://api.tailscale.com/api/v2/device/';
const MAX_RESPONSE = 256 * 1024;
const MAX_CREDENTIAL = 16 * 1024;
const validKey = key => typeof key === 'string' && /^tskey-api-[A-Za-z0-9_-]{20,240}$/.test(key);
const validID = id => typeof id === 'string' && /^n[A-Za-z0-9]{1,100}$/.test(id);
const tailscaleIP = ip => typeof ip === 'string' && isIP(ip) === 4 && ip.startsWith('100.') && +ip.split('.')[1] >= 64 && +ip.split('.')[1] <= 127;
const fail = (message, code) => Object.assign(new Error(message), {code});

/** Main-process only. The optional second argument supplies I/O dependencies for isolated tests.
 * status/saveKey/forgetKey return public status; createInvite returns only its three public fields.
 * Other failures reject with a sanitized Portuguese Error. No key is cached or returned.
 */
function createTailscaleSharing({app, safeStorage, shell, getPort}, dependencies = {}) {
  const fs = dependencies.fs || nativeFs;
  const execFile = dependencies.execFile || nativeExecFile;
  const fetch = dependencies.fetch || globalThis.fetch;
  const platform = dependencies.platform || process.platform;
  const env = dependencies.env || process.env;
  const timeoutMs = Math.max(1, Math.min(dependencies.timeoutMs || 8000, 10000));
  const userData = app.getPath('userData');
  const credentialPath = path.join(userData, 'tailscale-api-key.enc');
  let queue = Promise.resolve();

  // Serialize credential changes and sharing, so forget/save cannot race an in-flight invite.
  function serialized(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function requireEncryption() {
    let available = false;
    try { available = safeStorage?.isEncryptionAvailable() === true; } catch {}
    if (!available) throw fail('A criptografia segura do Windows está indisponível. Reinicie o PentaMark antes de configurar a chave.', 'STORAGE_UNAVAILABLE');
  }

  async function installation() {
    if (platform !== 'win32') return null;
    const roots = ['C:\\Program Files', env.ProgramW6432, env.ProgramFiles];
    for (const root of new Set(roots)) {
      // Never search PATH, the working directory or a relative/UNC executable path.
      if (typeof root !== 'string' || !/^[A-Za-z]:\\[^\r\n]*$/.test(root)) continue;
      const directory = path.win32.join(root, 'Tailscale');
      const executable = path.win32.join(directory, 'tailscale.exe');
      try { await fs.access(executable); return {directory, executable}; } catch {}
    }
    return null;
  }

  async function currentDevice() {
    const installed = await installation();
    if (!installed) return {installed:false, connected:false, error:'Instale o Tailscale para compartilhar este computador.'};
    let data;
    try {
      const stdout = await new Promise((resolve, reject) => {
        execFile(installed.executable, ['status', '--json'], {
          shell:false, windowsHide:true, timeout:timeoutMs, maxBuffer:1024 * 1024, encoding:'utf8',
        }, (error, output) => error ? reject(error) : resolve(output));
      });
      data = JSON.parse(stdout);
    } catch {
      return {installed:true, connected:false, error:'Não foi possível consultar o Tailscale. Abra o aplicativo e verifique a conexão.'};
    }
    const self = data?.Self;
    // ipnstate.PeerStatus.ID is tailcfg.StableNodeID; PublicKey/NodeKey are NOT API IDs.
    // https://github.com/tailscale/tailscale/blob/main/ipn/ipnstate/ipnstate.go
    const id = validID(self?.ID) ? self.ID : undefined;
    const ip = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs.find(tailscaleIP) : undefined;
    const deviceName = typeof self?.HostName === 'string' && /^[\p{L}\p{N}_. -]{1,253}$/u.test(self.HostName) && !self.HostName.includes('tskey-') ? self.HostName : 'Este computador';
    const device = {installed:true, connected:false, deviceName, id, ip};
    if (data?.BackendState !== 'Running' || self?.Online !== true) {
      return {...device, error:'O Tailscale está desconectado. Abra o aplicativo, entre na sua conta e conecte este computador.'};
    }
    if (!id || !ip) return {...device, error:'O Tailscale não informou um dispositivo e endereço válidos. Conecte novamente ou atualize o Tailscale.'};
    let port;
    try { port = await getPort(); } catch {}
    if (!Number.isInteger(port) || port < 1 || port > 65535) return {...device, error:'A porta do PentaMark está indisponível. Reinicie o aplicativo.'};
    return {...device, connected:true, address:`http://${ip}:${port}`};
  }

  function requireConnected(device) {
    if (!device.connected) throw fail(device.error, 'TAILSCALE_OFFLINE');
    return device;
  }

  async function readCredential() {
    requireEncryption();
    try {
      const stat = await fs.stat(credentialPath);
      if (!stat.size || stat.size > MAX_CREDENTIAL) throw new Error('size');
      const bytes = await fs.readFile(credentialPath);
      if (!bytes.length || bytes.length > MAX_CREDENTIAL) throw new Error('size');
      const value = JSON.parse(safeStorage.decryptString(bytes));
      if (value.version !== 1 || !validKey(value.key) || !validID(value.deviceId)) throw new Error('format');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw fail('Não foi possível ler a chave protegida. Remova a chave e configure novamente.', 'STORAGE_READ');
    }
  }

  async function publicStatus(device) {
    let configured = false;
    let storageError;
    try {
      const credential = await readCredential();
      configured = !!credential && credential.deviceId === device.id;
      if (credential && !configured) storageError = 'O dispositivo Tailscale mudou. Configure uma chave para este computador novamente.';
    } catch (error) { storageError = error.message; }
    return {
      installed:device.installed, connected:device.connected, configured,
      ...(device.deviceName ? {deviceName:device.deviceName} : {}),
      ...(device.address ? {address:device.address} : {}),
      ...((device.error || storageError) ? {error:device.error || storageError} : {}),
    };
  }

  async function removeCredential() {
    try { await fs.unlink(credentialPath); }
    catch (error) { if (error.code !== 'ENOENT') throw fail('Não foi possível remover a chave protegida. Tente novamente.', 'STORAGE_DELETE'); }
  }

  async function persist(key, deviceId) {
    requireEncryption();
    const temporary = `${credentialPath}.${randomUUID()}.tmp`;
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify({version:1, key, deviceId}));
      if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > MAX_CREDENTIAL) throw new Error('encryption');
      await fs.mkdir(userData, {recursive:true});
      await fs.writeFile(temporary, encrypted, {flag:'wx', mode:0o600});
      await fs.rename(temporary, credentialPath);
    } catch {
      throw fail('Não foi possível salvar a chave com criptografia segura. A configuração anterior foi preservada.', 'STORAGE_WRITE');
    } finally {
      try { await fs.unlink(temporary); } catch {}
    }
  }

  async function request(key, id, method = 'GET', body) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(fail('O Tailscale demorou para responder. Verifique a internet e tente novamente.', 'API_TIMEOUT'));
      }, timeoutMs);
    });
    const operation = async () => {
      const response = await fetch(`${API}${id}${method === 'POST' ? '/device-invites' : ''}`, {
        method, redirect:'error', signal:controller.signal,
        headers:{Authorization:`Basic ${Buffer.from(`${key}:`).toString('base64')}`, Accept:'application/json', ...(body ? {'Content-Type':'application/json'} : {})},
        ...(body ? {body:JSON.stringify(body)} : {}),
      });
      if (response.redirected || response.status < 200 || response.status >= 300) {
        const errors = {
          401:['A chave de API é inválida ou expirou. Gere uma nova chave pessoal no Tailscale.', 'API_KEY'],
          403:['A chave não tem permissão para compartilhar este dispositivo. Confira a conta e as permissões no Tailscale.', 'API_PERMISSION'],
          404:['Este dispositivo não foi encontrado na conta da chave. Confira a conta conectada ao Tailscale.', 'API_DEVICE'],
          429:['Muitas tentativas no Tailscale. Aguarde um pouco e tente novamente.', 'API_RATE_LIMIT'],
        };
        try { await response.body?.cancel(); } catch {}
        const [message, code] = errors[response.status] || ['O Tailscale não concluiu a solicitação. Tente novamente.', 'API_RESPONSE'];
        throw fail(message, code);
      }
      const length = response.headers.get('content-length');
      if ((length && (!/^\d+$/.test(length) || +length > MAX_RESPONSE)) || !response.body) throw fail('O Tailscale retornou uma resposta inválida.', 'API_RESPONSE');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE) throw fail('O Tailscale retornou uma resposta muito grande.', 'API_RESPONSE');
          chunks.push(Buffer.from(value));
        }
        return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
      } finally {
        // Do not let a failed/hostile stream stall cleanup or extend the request deadline.
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    };
    try { return await Promise.race([operation(), timeout]); }
    catch (error) {
      if (['API_KEY','API_PERMISSION','API_DEVICE','API_RATE_LIMIT','API_RESPONSE','API_TIMEOUT'].includes(error.code)) throw error;
      throw fail('Não foi possível acessar a API do Tailscale. Verifique a internet e tente novamente.', 'API_NETWORK');
    } finally { clearTimeout(timer); controller.abort(); }
  }

  async function validateDevice(key, device) {
    const remote = await request(key, device.id);
    if (!remote || remote.nodeId !== device.id || !Array.isArray(remote.addresses) || !remote.addresses.includes(device.ip)) {
      throw fail('A chave não corresponde ao dispositivo conectado. Confira a conta Tailscale deste computador.', 'API_DEVICE');
    }
    const latest = requireConnected(await currentDevice());
    if (latest.id !== device.id || latest.ip !== device.ip) throw fail('O dispositivo Tailscale mudou durante a operação. Tente novamente.', 'API_DEVICE');
    return latest;
  }

  return {
    async status() { return serialized(async () => publicStatus(await currentDevice())); },
    async saveKey(key) {
      return serialized(async () => {
        if (typeof key === 'string') key = key.trim();
        if (!validKey(key)) throw fail('Informe uma chave pessoal de API do Tailscale começando com tskey-api-.', 'INVALID_KEY');
        requireEncryption();
        const device = await validateDevice(key, requireConnected(await currentDevice()));
        await persist(key, device.id);
        return publicStatus(device);
      });
    },
    async forgetKey() {
      return serialized(async () => { await removeCredential(); return publicStatus(await currentDevice()); });
    },
    async createInvite() {
      return serialized(async () => {
        const device = requireConnected(await currentDevice());
        const credential = await readCredential();
        if (!credential) throw fail('Configure sua chave pessoal de API do Tailscale antes de gerar um convite.', 'NOT_CONFIGURED');
        if (credential.deviceId !== device.id) throw fail('O dispositivo Tailscale mudou. Configure a chave novamente.', 'API_DEVICE');
        try {
          const latest = await validateDevice(credential.key, device);
          // Request and response are arrays; no email means the URL is returned without sending it.
          // https://github.com/tailscale/tailscale/blob/v1.68.0/publicapi/device.md#create-device-invites
          const invites = await request(credential.key, latest.id, 'POST', [{multiUse:false, allowExitNode:false}]);
          const inviteUrl = Array.isArray(invites) && invites.length === 1 ? invites[0]?.inviteUrl : undefined;
          if (typeof inviteUrl !== 'string' || inviteUrl.length > 2048 || !/^https:\/\/login\.tailscale\.com\/admin\/invite\/[A-Za-z0-9_-]+$/.test(inviteUrl) || inviteUrl.includes('tskey-') || inviteUrl.includes(credential.key)) {
            throw fail('O Tailscale retornou um link de convite inválido. Tente gerar um novo convite.', 'INVALID_INVITE');
          }
          return {inviteUrl, address:latest.address, deviceName:latest.deviceName};
        } catch (error) {
          if (['API_KEY','API_PERMISSION'].includes(error.code)) await removeCredential();
          throw error;
        }
      });
    },
    async openSetup(step) {
      if (step === 'install' || step === 'keys') {
        const url = step === 'install' ? 'https://tailscale.com/download/windows' : 'https://login.tailscale.com/admin/settings/keys';
        try { await shell.openExternal(url); } catch { throw fail('Não foi possível abrir o navegador para configurar o Tailscale.', 'SETUP_OPEN'); }
      } else if (step === 'login') {
        const installed = await installation();
        if (!installed) throw fail('Instale o Tailscale antes de entrar na sua conta.', 'NOT_INSTALLED');
        const gui = path.win32.join(installed.directory, 'tailscale-ipn.exe');
        try {
          await fs.access(gui);
          if (await shell.openPath(gui)) throw new Error('open');
        } catch { throw fail('Não foi possível abrir o Tailscale. Verifique a instalação do aplicativo.', 'SETUP_OPEN'); }
      } else throw fail('Etapa de configuração do Tailscale inválida.', 'INVALID_STEP');
      return {ok:true};
    },
  };
}

module.exports = {createTailscaleSharing};
