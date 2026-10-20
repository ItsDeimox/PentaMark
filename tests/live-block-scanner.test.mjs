import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Import the real TypeScript scanner, including marked and the layout contract.
// Only this test's unique directory is removed; the shared test vault is kept.
const temporaryRoot = join(tmpdir(), 'pentamark-unit-tests');
await mkdir(temporaryRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'live-block-scanner-'));
after(() => rm(temporaryDirectory, { recursive: true, force: true }));
const bundle = join(temporaryDirectory, 'blocks.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../src/features/editor/live-preview/blocks.ts', import.meta.url))],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});
const { scanLiveSourceBlocks: scan, liveBlockContentEnd, liveBlockUsesWidget, liveLinePadding } =
  await import(pathToFileURL(bundle).href);

function assertBlocks(source, expected) {
  const blocks = scan(source);
  assert.deepEqual(blocks.map(({ type, raw }) => ({ type, raw })), expected);
  let previousEnd = 0;
  for (const block of blocks) {
    assert.equal(source.slice(block.start, block.end), block.raw, 'offsets address the original source');
    assert.match(source.slice(previousEnd, block.start), /^\s*$/, 'no content is lost between blocks');
    assert.equal(liveBlockContentEnd(block), block.start + block.raw.replace(/(?:\r\n|\n)$/, '').length);
    previousEnd = block.end;
  }
  assert.match(source.slice(previousEnd), /^\s*$/, 'no trailing content is lost');
  return blocks;
}

test('simple blocks retain offsets, collapsed gaps, line padding and blank lines', () => {
  const source = '# H\n\n\nP\n\n- a\n- b\n\n> q\n> r\n\n## Two\n';
  const blocks = assertBlocks(source, [
    { type: 'heading', raw: '# H\n' },
    { type: 'paragraph', raw: 'P\n' },
    { type: 'list', raw: '- a\n- b\n' },
    { type: 'quote', raw: '> q\n> r\n' },
    { type: 'heading', raw: '## Two\n' },
  ]);
  assert.deepEqual(blocks.map(({ start, end, gapBefore, gapAfter }) => [start, end, gapBefore, gapAfter]), [
    [0, 4, 0, 0], [6, 8, 27, 0], [9, 17, 18, 0], [18, 26, 22, 0], [27, 34, 38, 14],
  ]);
  assert.ok(blocks.every(block => !block.semantic && !liveBlockUsesWidget(block)));
  assert.deepEqual(liveLinePadding(blocks[2], true, false), { top: 0, bottom: 5 });
  assert.deepEqual(liveLinePadding(blocks[3], true, true), { top: 15, bottom: 15 });
});

for (const [name, raw] of [
  ['nested unordered items', '- parent\n  - child\n    - grandchild\n- sibling\n'],
  ['nested ordered items', '1. parent\n   1. child\n   2. child two\n2. sibling\n'],
  ['indented continuation', '- first\n  continued text\n- next\n'],
  ['lazy continuation', '- first\ncontinued text\n- next\n'],
  ['loose paragraphs', '- first\n\n  second paragraph\n\n- next\n'],
  ['nested fenced code', '- first\n\n  ~~~~js\n  const x = 1;\n  ~~~~\n- next\n'],
  ['heading inside an item', '- ## Item heading\n- next\n'],
]) {
  test(`keeps ${name} in one semantic list`, () => {
    const [block] = assertBlocks(`${raw}\nAfter\n`, [
      { type: 'list', raw }, { type: 'paragraph', raw: 'After\n' },
    ]);
    assert.equal(block.semantic, true);
    assert.equal(liveBlockUsesWidget(block), true);
  });
}

for (const [name, raw] of [
  ['multiple paragraphs', '> first\n>\n> second\n'],
  ['lazy paragraph continuation', '> first\ncontinued text\n'],
  ['nested quote', '> outer\n> > inner\n'],
  ['list inside quote', '> - first\n> - second\n'],
  ['heading inside quote', '> ## Heading\n> text\n'],
]) {
  test(`keeps a blockquote with ${name} in one semantic block`, () => {
    const [block] = assertBlocks(`${raw}\nAfter\n`, [
      { type: 'quote', raw }, { type: 'paragraph', raw: 'After\n' },
    ]);
    assert.equal(block.semantic, true);
    assert.equal(liveBlockUsesWidget(block), true);
  });
}

for (const [raw, level, gapBefore, gapAfter] of [
  ['Title\n====\n', 1, 0, 27],
  ['Title\n----\n', 2, 38, 14],
  ['Title\ncontinued title\n---\n', 2, 38, 14],
]) {
  test(`recognizes level ${level} setext heading ${JSON.stringify(raw)}`, () => {
    const [block] = assertBlocks(raw, [{ type: 'heading', raw }]);
    assert.equal(block.semantic, true);
    assert.equal(liveBlockUsesWidget(block), true);
    assert.equal(block.gapBefore, gapBefore);
    assert.equal(block.gapAfter, gapAfter);
  });
}

for (const raw of [
  '````js\n```\ninside\n````\n',
  '~~~~js\n~~~\ninside\n~~~~\n',
  '````\n~~~~\n```` trailing text\nstill inside\n`````\n',
  '~~~~\n````\n~~~~suffix\nstill inside\n~~~~~\n',
  '  `````js\n  ````\n  inside\n   `````  \n',
]) {
  test(`only closes a matching fence of sufficient length ${JSON.stringify(raw)}`, () => {
    const [block] = assertBlocks(`${raw}\nAfter\n`, [
      { type: 'code', raw }, { type: 'paragraph', raw: 'After\n' },
    ]);
    assert.equal(liveBlockUsesWidget(block), true);
  });
}

test('unclosed long fences retain every line through EOF', () => {
  const raw = '`````js\n```\n\n## still code\n';
  assertBlocks(raw, [{ type: 'code', raw }]);
});

test('blank lines at EOF belong to an unclosed fence', () => {
  const raw = '````js\ninside\n\n \t\n';
  assertBlocks(raw, [{ type: 'code', raw }]);
});

test('blank lines following a closed fence remain outside its source range', () => {
  const raw = '````js\ninside\n````\n';
  assertBlocks(`${raw}\n \t\nAfter\n`, [
    { type: 'code', raw }, { type: 'paragraph', raw: 'After\n' },
  ]);
});

for (const raw of [
  'Name | Value\n--- | ---:\nA | 42\nB | 84\n',
  '| Name | Value |\n| --- | ---: |\nA | 42\n',
  'Name | Value\n:--- | ---:\nA \\| B | 42\n',
]) {
  test(`recognizes GFM tables with optional outer pipes ${JSON.stringify(raw)}`, () => {
    const [block] = assertBlocks(`${raw}\nAfter\n`, [
      { type: 'table', raw }, { type: 'paragraph', raw: 'After\n' },
    ]);
    assert.equal(liveBlockUsesWidget(block), true);
  });
}

test('a table requires a valid delimiter row with matching columns', () => {
  const raw = 'Name | Value\n--- | --- | ---\nA | 42\n';
  assertBlocks(raw, [{ type: 'paragraph', raw }]);
});

test('CRLF, Unicode and whitespace-only gaps keep exact source positions', () => {
  const source = '\r\n😀 título\r\n----\r\n \t\r\n- pai\r\n  - filho\r\n\r\nFim\r\n';
  const blocks = assertBlocks(source, [
    { type: 'heading', raw: '😀 título\r\n----\r\n' },
    { type: 'list', raw: '- pai\r\n  - filho\r\n' },
    { type: 'paragraph', raw: 'Fim\r\n' },
  ]);
  assert.deepEqual(blocks.map(({ start, end }) => [start, end]), [[2, 19], [23, 41], [43, 48]]);
});

test('properties, ruled heading, media and quoted callout retain their boundaries', () => {
  const source = '---\ntitle: Note\n---\n\n-# Ruled\nText\n![[clip.mp4]]\n![Pic](image.png)\n> [!note]+ Title\n> body\n\n***\n';
  const blocks = assertBlocks(source, [
    { type: 'properties', raw: '---\ntitle: Note\n---\n' },
    { type: 'heading', raw: '-# Ruled\n' },
    { type: 'paragraph', raw: 'Text\n' },
    { type: 'media', raw: '![[clip.mp4]]\n' },
    { type: 'media', raw: '![Pic](image.png)\n' },
    { type: 'quote', raw: '> [!note]+ Title\n> body\n' },
    { type: 'separator', raw: '***\n' },
  ]);
  assert.deepEqual(blocks.map(liveBlockUsesWidget), [true, false, false, true, true, true, true]);
  assert.deepEqual(liveLinePadding(blocks[1], true, true), { top: 0, bottom: 20 });
});

test('standalone callout includes its body and uses the complete renderer', () => {
  const raw = '[!warning]- Title\nbody\n- item\n';
  const [block] = assertBlocks(`${raw}\nAfter\n`, [
    { type: 'quote', raw }, { type: 'paragraph', raw: 'After\n' },
  ]);
  assert.equal(block.semantic, true);
  assert.equal(liveBlockUsesWidget(block), true);
});

test('extension markers inside fenced code do not split the code block', () => {
  const raw = '~~~~\n-# literal\n![[literal.png]]\n[!note] literal\n---\n~~~~\n';
  assertBlocks(raw, [{ type: 'code', raw }]);
});

test('an inline image followed by text does not split or shift the paragraph', () => {
  const raw = 'Text\n![Pic](image.png) beside text\nmore text\n';
  assertBlocks(`${raw}\n# End\n`, [
    { type: 'paragraph', raw }, { type: 'heading', raw: '# End\n' },
  ]);
});

test('incomplete extension markers remain literal paragraph text', () => {
  const raw = 'Text\n![incomplete\n![[unfinished\nmore text\n';
  assertBlocks(`${raw}\n# End\n`, [
    { type: 'paragraph', raw }, { type: 'heading', raw: '# End\n' },
  ]);
});

test('properties and fenced code preserve CRLF with no final newline', () => {
  assertBlocks('---\r\ntitle: Note\r\n---\r\n\r\n~~~~\r\nx\r\n~~~~\r\n\r\n## End', [
    { type: 'properties', raw: '---\r\ntitle: Note\r\n---\r\n' },
    { type: 'code', raw: '~~~~\r\nx\r\n~~~~\r\n' },
    { type: 'heading', raw: '## End' },
  ]);
});

test('an unfinished properties block retains the existing EOF behavior', () => {
  const raw = '---\ntitle: Note\n\ntext\n';
  assertBlocks(raw, [{ type: 'properties', raw }]);
});

test('reference definitions do not shift subsequent source offsets', () => {
  assertBlocks('[id]: /After\n\nAfter\n\n# End\n', [
    { type: 'paragraph', raw: '[id]: /After\n' },
    { type: 'paragraph', raw: 'After\n' },
    { type: 'heading', raw: '# End\n' },
  ]);
});

test('indented code uses the code renderer', () => {
  const raw = '    const x = 1;\n    const y = 2;\n';
  const [block] = assertBlocks(raw, [{ type: 'code', raw }]);
  assert.equal(liveBlockUsesWidget(block), true);
});

test('plain paragraphs keep numbered text that cannot interrupt a paragraph', () => {
  const raw = 'Paragraph\n2. still paragraph\n';
  assertBlocks(raw, [{ type: 'paragraph', raw }]);
});

test('empty and whitespace-only documents have no painted blocks', () => {
  assert.deepEqual(scan(''), []);
  assert.deepEqual(scan('\r\n \t\r\n\n'), []);
});
