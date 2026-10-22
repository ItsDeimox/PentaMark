import { lstat, realpath, opendir, mkdir, open, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireWriter } from './database.mjs';
import { check, profileValue } from './replica-validation.mjs';

const MAX_ENTRIES = 10000, MAX_BYTES = 16 * 1024 ** 3, MAX_DEPTH = 64, MAX_MS = 10 * 60 * 1000;
const comparable = p => process.platform === 'win32' ? p.toLowerCase() : p;
const within = (p, root) => comparable(p) === comparable(root) || comparable(p).startsWith(comparable(root + sep));
const signature = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.isDirectory()];

async function safeAncestors(path) {
  check(!path.startsWith('\\\\'), 'unsafe-recovery-path');
  for (let p = path;; p = dirname(p)) {
    const s = await lstat(p);
    check(s.isDirectory() && !s.isSymbolicLink(), 'unsafe-recovery-path');
    if (dirname(p) === p) break;
  }
  check(comparable(await realpath(path)) === comparable(path), 'unsafe-recovery-path');
}

// lstat detects symlinks/junctions. Windows attributes additionally reject ALL
// reparse tags (including cloud placeholders), without following their targets.
async function windowsReparseCheck(root, destination) {
  if (process.platform !== 'win32') return;
  const script = `
$ErrorActionPreference='Stop'
foreach ($value in @($env:PENTAMARK_RECOVERY_SOURCE,$env:PENTAMARK_RECOVERY_DESTINATION)) {
  $p=$value
  while ($p) {
    if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse' }
    $parent=[IO.Directory]::GetParent($p)
    if ($null -eq $parent) { break }; $p=$parent.FullName
  }
}
$stack=[Collections.Generic.Stack[string]]::new(); $stack.Push($env:PENTAMARK_RECOVERY_SOURCE); $count=0
while ($stack.Count -gt 0) {
  foreach ($p in [IO.Directory]::EnumerateFileSystemEntries($stack.Pop())) {
    $count++; if ($count -gt 10000) { throw 'limit' }
    $a=[IO.File]::GetAttributes($p)
    if (($a -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse' }
    if (($a -band [IO.FileAttributes]::Directory) -ne 0) { $stack.Push($p) }
  }
}`;
  try {
    await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30000, maxBuffer: 8192,
        env: { ...process.env, PENTAMARK_RECOVERY_SOURCE: root, PENTAMARK_RECOVERY_DESTINATION: destination } });
  } catch { throw new Error('unsafe-recovery-path'); }
}

/** No replica database connection, PRAGMA, migration or interpretation here. */
export async function exportRecoveryDirectory({ userData, profile, directory }) {
  profileValue(profile); check(typeof directory === 'string' && directory.length > 0, 'native-picker-required');
  const privateRoot = resolve(userData), root = join(privateRoot, 'sync', 'replicas', profile.vaultId, profile.replicaId);
  const destination = resolve(directory), deadline = Date.now() + MAX_MS;
  const bounded = () => check(Date.now() <= deadline, 'recovery-limit-exceeded');
  check(!within(destination, privateRoot), 'unsafe-recovery-path');
  await safeAncestors(root); await safeAncestors(destination);
  await windowsReparseCheck(root, destination);
  const writer = join(root, 'writer.sqlite'), writerStat = await lstat(writer);
  check(writerStat.isFile() && !writerStat.isSymbolicLink(), 'unsafe-recovery-path');
  // Require the existing lock file. Never create a new lock namespace or touch
  // replica.sqlite, even when it contains an unknown SQLite/user schema.
  let release = acquireWriter(writer);
  try {
    async function inventory() {
      const rows = []; let bytes = 0;
      async function walk(relative, depth) {
        bounded(); check(depth <= MAX_DEPTH, 'recovery-limit-exceeded');
        const path = join(root, relative), s = await lstat(path);
        check(!s.isSymbolicLink() && (s.isFile() || s.isDirectory()), 'unsafe-recovery-path');
        check(comparable(await realpath(path)) === comparable(path), 'unsafe-recovery-path');
        if (relative) {
          check(rows.length < MAX_ENTRIES, 'recovery-limit-exceeded');
          if (s.isFile()) bytes += s.size;
          check(Number.isSafeInteger(bytes) && bytes <= MAX_BYTES, 'recovery-limit-exceeded');
          rows.push({ path: relative, directory: s.isDirectory(), signature: signature(s) });
        }
        if (s.isDirectory()) for await (const { name } of await opendir(path)) {
          check(!/[\\/:]/.test(name) && name !== '.' && name !== '..', 'unsafe-recovery-path');
          await walk(join(relative, name), depth + 1);
        }
      }
      await walk('', 0); return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    }
    const rows = await inventory();
    const name = `PentaMark-opaque-recovery-${randomUUID()}`, partial = join(destination, name + '.partial');
    await mkdir(partial); await mkdir(join(partial, 'replica'));
    const files = [], buffer = Buffer.alloc(256 * 1024);
    for (const row of rows) {
      bounded(); const source = join(root, row.path), target = join(partial, 'replica', row.path);
      if (row.directory) { await mkdir(target); continue; }
      const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        check(JSON.stringify(signature(await input.stat())) === JSON.stringify(row.signature), 'recovery-source-changed');
        const output = await open(target, 'wx');
        try {
          const hash = createHash('sha256'); let copied = 0;
          for (;;) {
            bounded(); const { bytesRead } = await input.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
            copied += bytesRead; check(copied <= row.signature[2], 'recovery-source-changed');
            hash.update(buffer.subarray(0, bytesRead));
            for (let offset = 0; offset < bytesRead;) {
              const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset); check(bytesWritten > 0, 'recovery-copy-failed'); offset += bytesWritten;
            }
          }
          check(copied === row.signature[2] && JSON.stringify(signature(await input.stat())) === JSON.stringify(row.signature), 'recovery-source-changed');
          await output.sync(); files.push({ path: row.path, byteLength: copied, sha256: hash.digest('hex') });
        } finally { await output.close(); }
      } finally { await input.close(); }
    }
    check(JSON.stringify(await inventory()) === JSON.stringify(rows), 'recovery-source-changed');
    await safeAncestors(destination); await windowsReparseCheck(root, partial); bounded();
    const manifest = await open(join(partial, 'manifest.json'), 'wx');
    try {
      await manifest.writeFile(JSON.stringify({ format: 'pentamark-opaque-replica-v1', interpreted: false,
        warning: 'Opaque private-file snapshot. No conversion or future-format restore compatibility is implied.',
        requestedProfile: profile, createdAt: new Date().toISOString(), files }, null, 2));
      await manifest.sync();
    } finally { await manifest.close(); }
    release(); release = null; // All handles closed before publishing success.
    await rename(partial, join(destination, name));
    return { cancelled: false, format: 'pentamark-opaque-replica-v1', directoryName: basename(name) };
  } finally { release?.(); }
}
