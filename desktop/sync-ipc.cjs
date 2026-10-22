const { pathToFileURL } = require('node:url');
const { join } = require('node:path');

// The shared validator lives with the packaged native service in extraResources.
function createSyncBridge({ getChild, trustedFrame, validationPath = join(__dirname, '../local/sync/replica-validation.mjs'), timeoutMs = 30000 }) {
  const pending = new Map(); let child = null; let closed = false;
  function failAll() { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('sync-server-disconnected')); } pending.clear(); }
  function receive(message) {
    if (message?.type !== 'pentamark:sync:result') return;
    const p = pending.get(message.requestId);
    if (!p || p.replicaId !== message.replicaId) return;
    pending.delete(message.requestId); clearTimeout(p.timer);
    if (message.ok === true) p.resolve({ requestId: message.requestId, replicaId: message.replicaId, ok: true, value: message.value });
    else p.resolve({ requestId: message.requestId, replicaId: message.replicaId, ok: false, error: typeof message.error === 'string' ? message.error : 'sync-failed' });
  }
  function detach() { if (child) { child.off('message', receive); child.off('exit', failAll); child.off('disconnect', failAll); } failAll(); child = null; }
  async function invoke(event, command) {
    if (!trustedFrame(event)) throw new Error('untrusted-frame');
    if (closed) throw new Error('sync-bridge-closed');
    command = structuredClone(command);
    const { commandValue } = await import(pathToFileURL(validationPath).href); commandValue(command);
    const current = getChild();
    if (!current?.connected) throw new Error('sync-server-unavailable');
    if (current !== child) { detach(); child = current; child.on('message', receive); child.on('exit', failAll); child.on('disconnect', failAll); }
    if (pending.has(command.requestId)) throw new Error('duplicate-request-id');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(command.requestId); reject(new Error('sync-timeout')); }, timeoutMs);
      pending.set(command.requestId, { resolve, reject, timer, replicaId: command.replicaId });
      try { child.send({ type: 'pentamark:sync:command', command }, error => { if (error && pending.has(command.requestId)) { pending.delete(command.requestId); clearTimeout(timer); reject(error); } }); }
      catch (error) { pending.delete(command.requestId); clearTimeout(timer); reject(error); }
    });
  }
  return { invoke, close() { closed = true; detach(); } };
}
module.exports = { createSyncBridge };
