const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkForUpdates, isNewer } = require('./updates.cjs');
const release = (tag = 'v2.9.0') => ({ tag_name: tag, assets: [{ name: `PentaMark-Desktop-${tag.slice(1)}-Windows.exe` }] });
const response = value => async () => ({ ok: true, json: async () => value });
test('compara versões numericamente e rejeita versões inválidas', () => {
  assert.equal(isNewer('v2.10.0', '2.9.0'), true);
  for (const candidate of ['v2.8.0', 'v2.7.9', 'v2.9.0-beta', 'bad']) assert.equal(isNewer(candidate, '2.8.0'), false);
});
test('retorna versão atual sem oferecer downgrade', async () => {
  assert.equal((await checkForUpdates('2.9.0', response(release()))).status, 'current');
  assert.equal((await checkForUpdates('3.0.0', response(release()))).status, 'current');
});
test('oferece release publicada com executável e endereço fixo do projeto', async () => {
  const result = await checkForUpdates('2.8.0', response({ ...release(), html_url: 'https://example.com/' }));
  assert.deepEqual(result, { status: 'available', version: '2.9.0', url: 'https://github.com/ItsDeimox/PentaMark/releases/tag/v2.9.0' });
});
test('ignora rascunho, pré-release e release sem executável', async () => {
  for (const value of [{ ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), assets: [] }, {}]) {
    assert.equal((await checkForUpdates('2.8.0', response(value))).status, 'unavailable');
  }
});
test('rede, timeout e limites da API não impedem a abertura', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => { throw new Error('JSON'); } })]) {
    assert.equal((await checkForUpdates('2.8.0', fetcher)).status, 'unavailable');
  }
});
test('requisição usa limite de tempo e cabeçalhos da API', async () => {
  await checkForUpdates('2.8.0', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/ItsDeimox/PentaMark/releases/latest');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers['User-Agent'], 'PentaMark');
    return { ok: true, json: async () => release() };
  });
});
