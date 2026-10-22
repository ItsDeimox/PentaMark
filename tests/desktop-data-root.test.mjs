import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
// Execute the actual startup path selection, stopping before Electron is started.
const startup = source.slice(0, source.indexOf('function defaultVaultDirectory()'));

function fixture(t, { portable = true, explicit = false, denied = [], localVault = false } = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'pentamark-data-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = Object.fromEntries(['portable', 'userData', 'explicit', 'runtime'].map(name => [name, join(root, name)]));
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir);
  if (localVault) fs.mkdirSync(join(dirs.portable, 'vault'));
  const blocked = new Set(denied.map(name => dirs[name]));
  const env = {
    ...(portable ? { PORTABLE_EXECUTABLE_DIR: dirs.portable } : {}),
    ...(explicit ? { PENTAMARK_DATA_DIR: dirs.explicit } : {}),
  };
  const module = { exports: {} };
  runInNewContext(startup + '\nmodule.exports = { dataRoot };', {
    module, __dirname: dirs.runtime,
    process: { env, argv: [], pid: process.pid, execPath: join(dirs.runtime, 'PentaMark.exe') },
    require(name) {
      if (name === 'electron') return { app: { getPath: () => dirs.userData } };
      if (name.startsWith('./')) return { invitationFromArgs: () => null };
      if (name === 'node:fs') return { ...fs, openSync(path, ...args) {
        if ([...blocked].some(dir => path.startsWith(dir + '\\') || path.startsWith(dir + '/'))) {
          throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
        }
        return fs.openSync(path, ...args);
      }};
      return require(name);
    },
  });
  return { ...dirs, dataRoot: module.exports.dataRoot };
}

test('a portable executable in a protected folder starts using the user data directory', t => {
  const f = fixture(t, { denied: ['portable'] });
  assert.equal(f.dataRoot(), f.userData);
});

test('a writable portable folder keeps its existing data destination', t => {
  const f = fixture(t);
  assert.equal(f.dataRoot(), f.portable);
  assert.deepEqual(fs.readdirSync(f.portable), []);
});

test('an explicit writable data directory is preserved', t => {
  const f = fixture(t, { explicit: true });
  assert.equal(f.dataRoot(), f.explicit);
});

test('an explicit unwritable directory reports the problem instead of changing vaults', t => {
  const f = fixture(t, { explicit: true, denied: ['explicit'] });
  assert.throws(() => f.dataRoot(), /gravar|permiss/i);
});

test('an existing portable vault is never silently replaced by a different vault', t => {
  const f = fixture(t, { denied: ['portable'], localVault: true });
  assert.throws(() => f.dataRoot(), /cofre|permiss/i);
  assert.ok(fs.existsSync(join(f.portable, 'vault')));
  assert.deepEqual(fs.readdirSync(f.userData), []);
});

test('a nonportable app uses its user data directory', t => {
  const f = fixture(t, { portable: false });
  assert.equal(f.dataRoot(), f.userData);
});
