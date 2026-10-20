import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Marked } from 'marked';

const temporaryRoot = join(tmpdir(), 'pentamark-unit-tests');
await mkdir(temporaryRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'table-source-'));
after(() => rm(temporaryDirectory, { recursive: true, force: true }));
const bundle = join(temporaryDirectory, 'table-source.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../src/features/editor/live-preview/table-source.ts', import.meta.url))],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});
const { tableCellRanges } = await import(pathToFileURL(bundle).href);
const markdown = new Marked({ gfm: true, breaks: true });
const header = '| A | B |\n| --- | --- |\n';

function texts(raw) {
  return tableCellRanges(raw).map(({ from, to }) => raw.slice(from, to));
}

// Apply the public contract exactly as the first DOM edit will consume it.
function edit(raw, index, value = 'novo') {
  const range = tableCellRanges(raw)[index];
  assert.ok(range, `cell ${index} has a source range`);
  const insert = (range.insertPrefix ?? '') + value + (range.insertSuffix ?? '');
  return raw.slice(0, range.from) + insert + raw.slice(range.to);
}

function renderedTexts(raw) {
  return markdown.lexer(raw).filter(token => token.type === 'table')
    .flatMap(token => [token.header, ...token.rows]).map(row => row.map(cell => cell.text));
}

test('pads a short row before mapping the following row in DOM order', () => {
  const raw = header + '| a |\n| b | c |\n';
  assert.deepEqual(texts(raw), ['A', 'B', 'a', '', 'b', 'c']);
  const missing = tableCellRanges(raw)[3];
  assert.equal(missing.from, raw.indexOf('\n| b'));
  assert.equal(missing.to, missing.from);
  const updated = edit(raw, 3);
  assert.equal(updated, header + '| a | novo |\n| b | c |\n');
  assert.deepEqual(renderedTexts(updated), [['A', 'B'], ['a', 'novo'], ['b', 'c']]);
  assert.equal(edit(raw, 4, 'outro'), header + '| a |\n| outro | c |\n');
});

for (const row of ['| a', 'a', '| a |   ', '| a |\t']) {
  test(`materializes a missing cell at the end of ${JSON.stringify(row)}`, () => {
    const raw = header + row + '\n| b | c |\n';
    const ranges = tableCellRanges(raw);
    assert.equal(ranges[3].from, header.length + row.length);
    assert.equal(ranges[3].to, ranges[3].from);
    assert.deepEqual(texts(raw), ['A', 'B', 'a', '', 'b', 'c']);
    const updated = edit(raw, 3);
    assert.deepEqual(renderedTexts(updated), [['A', 'B'], ['a', 'novo'], ['b', 'c']]);
    assert.ok(updated.endsWith('\n| b | c |\n'));
  });
}

for (const row of ['| a |', 'a', '|', '| |']) {
  test(`inserting each padded column preserves its index for ${JSON.stringify(row)}`, () => {
    const raw = '| A | B | C | D |\n| --- | --- | --- | --- |\n' + row + '\n| w | x | y | z |\n';
    assert.equal(tableCellRanges(raw).length, 12);
    for (let column = 1; column < 4; column++) {
      const updated = edit(raw, 4 + column);
      const expected = [row.includes('a') ? 'a' : '', '', '', ''];
      expected[column] = 'novo';
      assert.deepEqual(renderedTexts(updated)[1], expected);
      assert.deepEqual(renderedTexts(updated)[2], ['w', 'x', 'y', 'z']);
    }
  });
}

test('truncates surplus cells per row without shifting later rows', () => {
  const raw = header + '| a | extra | ignored |\n| b | c | fourth |\n';
  assert.deepEqual(texts(raw), ['A', 'B', 'a', 'extra', 'b', 'c']);
  assert.equal(edit(raw, 4), header + '| a | extra | ignored |\n| novo | c | fourth |\n');
});

test('maps explicit empty cells as source cells, not synthetic padding', () => {
  const raw = header + '| | c |\n| a | |\n';
  assert.deepEqual(texts(raw), ['A', 'B', '', 'c', 'a', '']);
  assert.ok(tableCellRanges(raw).every(range => range.insertPrefix === undefined));
  assert.deepEqual(renderedTexts(edit(raw, 2)), [['A', 'B'], ['novo', 'c'], ['a', '']]);
  assert.deepEqual(renderedTexts(edit(raw, 5)), [['A', 'B'], ['', 'c'], ['a', 'novo']]);
});

test('uses the separator token instead of a dash heuristic for body rows', () => {
  const raw = '| A | B |\n| - | :-: |\n| --- body | value |\n';
  assert.deepEqual(texts(raw), ['A', 'B', '--- body', 'value']);
});

for (const cell of [
  '"quoted \\| pipe"',
  '`code \\| pipe`',
  '``code ` inside \\| pipe``',
  '```code `` inside \\| pipe```',
  'odd' + '\\'.repeat(3) + '|pipe',
]) {
  test(`preserves original offsets for escaped pipes in ${JSON.stringify(cell)}`, () => {
    const raw = header + '| ' + cell + ' | next |\n| b | c |\n';
    assert.deepEqual(texts(raw), ['A', 'B', cell, 'next', 'b', 'c']);
    assert.equal(edit(raw, 3), header + '| ' + cell + ' | novo |\n| b | c |\n');
  });
}

test('unescaped pipes within multiple backticks still follow marked cell boundaries', () => {
  const raw = header + '| ``a`|b`` | discarded |\n| b | c |\n';
  assert.deepEqual(texts(raw), ['A', 'B', '``a`', 'b``', 'b', 'c']);
  assert.equal(edit(raw, 4), header + '| ``a`|b`` | discarded |\n| novo | c |\n');
});

test('an even number of backslashes leaves a pipe as a column separator', () => {
  const cell = 'a' + '\\'.repeat(2);
  const raw = header + '| ' + cell + '| b | extra |\n';
  assert.deepEqual(texts(raw), ['A', 'B', cell, 'b']);
});

test('escaped trailing pipes are content and require a new separator when padding', () => {
  const raw = header + '| a\\|\n| b | c |\n';
  assert.deepEqual(texts(raw), ['A', 'B', 'a\\|', '', 'b', 'c']);
  assert.equal(edit(raw, 3), header + '| a\\| | novo |\n| b | c |\n');
});

for (const eol of ['\n', '\r\n', '\r']) {
  test(`keeps UTF-16 offsets in original ${JSON.stringify(eol)} source`, () => {
    const raw = ['| 😀 | B |', '| --- | --- |', '| ação |', '| b | c |', ''].join(eol);
    const ranges = tableCellRanges(raw);
    assert.deepEqual(texts(raw), ['😀', 'B', 'ação', '', 'b', 'c']);
    assert.equal(ranges[4].from, raw.indexOf('b |'));
    assert.equal(ranges[3].from, raw.indexOf(eol + '| b'));
    assert.equal(edit(raw, 3), ['| 😀 | B |', '| --- | --- |', '| ação | novo |', '| b | c |', ''].join(eol));
  });
}

test('supports optional outer pipes and trims only cell whitespace', () => {
  const raw = '  A \\| title | B  \n  :-- | --:\n  a | b  \n';
  assert.deepEqual(texts(raw), ['A \\| title', 'B', 'a', 'b']);
  assert.equal(edit(raw, 3), '  A \\| title | B  \n  :-- | --:\n  a | novo  \n');
});

test('ignores trailing non-table blocks and accepts leading blank lines', () => {
  const raw = '\r\n' + header.replaceAll('\n', '\r\n') + '| a | b |\r\n\r\n# Heading\r\n';
  assert.deepEqual(texts(raw), ['A', 'B', 'a', 'b']);
  assert.equal(tableCellRanges(raw)[0].from, raw.indexOf('A'));
});

test('maps a final short row without requiring a terminating newline', () => {
  const raw = header + '| a |';
  assert.equal(edit(raw, 3), header + '| a | novo |');
});

test('an explicitly empty cell retains one padding space on each side when retyped',()=>{
  const raw=header+'| a |  |\n';
  const cell=tableCellRanges(raw)[3];
  assert.equal(raw.slice(0,cell.from)+'novo'+raw.slice(cell.to),header+'| a | novo |\n');
});

for (const raw of ['', '| A | B |\n| --- |\n| a | b |\n', 'plain text\n', '# Heading\n' + header]) {
  test(`returns no editable table ranges for ${JSON.stringify(raw)}`, () => {
    assert.deepEqual(tableCellRanges(raw), []);
  });
}
