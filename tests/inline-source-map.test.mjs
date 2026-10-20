import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let mapInlineSource, sliceInlineMap, replaceInlineSource;
before(async () => {
  const entry = fileURLToPath(new URL('../src/features/editor/live-preview/inline-source-map.ts', import.meta.url));
  assert.ok(existsSync(entry), 'the inline source mapper must exist');
  const bundle = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  ({ mapInlineSource, sliceInlineMap, replaceInlineSource } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')));
});

const map = (source, options) => mapInlineSource(source, 0, source.length, options);
function replace(source, first, end, insert, options) {
  const mapped = map(source, options);
  const result = replaceInlineSource(source, mapped, first, end, insert, options);
  let applied = source;
  for (const change of [...result.changes].reverse()) applied = applied.slice(0, change.from) + change.insert + applied.slice(change.to);
  assert.equal(applied, result.source, 'changes use sorted, nonoverlapping original source offsets');
  return result.source;
}

test('repeated visible link labels never map into hidden destinations', () => {
  const source = '[x](x)**x**';
  const mapped = map(source);
  assert.equal(mapped.text, 'xx');
  assert.deepEqual(mapped.starts, [1, 8]);
  assert.deepEqual(mapped.ends, [2, 9]);
  assert.equal(replace(source, 1, 2, 'y'), '[x](x)**y**');
});

test('slices find rendered text, exclude URLs and retain absolute offsets', () => {
  const source = 'prefix [label](label) **word** suffix';
  const mapped = mapInlineSource(source, 7, source.length - 7);
  const sliced = sliceInlineMap(mapped, 'word');
  assert.equal(sliced.text, 'word');
  assert.deepEqual(sliced.starts, [24, 25, 26, 27]);
  assert.equal(sliceInlineMap(mapped, 'https://'), null);
  assert.equal(sliceInlineMap(mapped, 'not rendered'), null);
  assert.equal(replaceInlineSource(source, sliced, 0, 4, 'new').source, 'prefix [label](label) **new** suffix');
});

test('cross-format replacement preserves both emphasis delimiters', () => {
  assert.equal(replace('**bold** plain', 2, 7, 'X'), '**boX**ain');
  assert.equal(replace('plain **bold**', 3, 10, 'X'), 'plaX');
  assert.equal(replace('**bold** plain', 0, 4, ''), ' plain');
  assert.equal(replace('**bold** plain', 0, 4, 'new'), '**new** plain');
});

for (const [source, expected] of [
  ['*bold* plain', '*boX*ain'], ['~~bold~~ plain', '~~boX~~ain'],
  ['`bold` plain', '`boX`ain'], ['==bold== plain', '==boX==ain'],
  ['***bold*** plain', '***boX***ain'],
]) test(`cross-boundary edits keep ${source} balanced`, () => {
  assert.equal(replace(source, 2, 7, 'X'), expected);
  assert.equal(replace(source, 0, 4, ''), ' plain');
});

test('nested formatting removes only empty pairs', () => {
  assert.equal(replace('**a *bold* z** plain', 2, 6, ''), '**a  z** plain');
  assert.equal(replace('**a *bold* z** plain', 2, 6, 'X'), '**a *X* z** plain');
});

test('quote joins consume the continuation prefix', () => {
  const source = '> [!note] Title\n> body';
  const mapped = map(source, { quote: true });
  assert.equal(mapped.text, 'Title\nbody');
  assert.equal(mapped.ends[5], 18);
  assert.equal(replace(source, 5, 6, '', { quote: true }), '> [!note] Titlebody');
});

test('new quote lines retain the original nesting depth', () => {
  const source = '> > Title\n> > body';
  assert.equal(map(source, { quote: true }).text, 'Title\nbody');
  assert.equal(replace(source, 2, 2, '\nnext', { quote: true }), '> > Ti\n> > nexttle\n> > body');
});

test('CRLF quote joins and inserted lines retain valid offsets and prefixes', () => {
  const source = '> A\r\n> B';
  assert.equal(map(source, { quote: true }).text, 'A\nB');
  assert.equal(replace(source, 1, 2, '', { quote: true }), '> AB');
  assert.equal(replace(source, 1, 1, '\nC', { quote: true }), '> A\r\n> C\r\n> B');
});

test('table br tags map to an atomic newline and support subsequent edits', () => {
  assert.deepEqual(map('a<br>b').starts, [0, 1, 5]);
  assert.deepEqual(map('a<br>b').ends, [1, 5, 6]);
  const pasted = replace('ab', 1, 1, '\n', { table: true });
  assert.equal(pasted, 'a<br>b');
  assert.equal(replace(pasted, 3, 3, 'c', { table: true }), 'a<br>bc');
  assert.equal(replace(pasted, 1, 2, '', { table: true }), 'ab');
});

test('table pipes delete their escape along with the visible glyph', () => {
  const source = replace('ab', 1, 1, '|', { table: true });
  assert.equal(source, 'a\\|b');
  assert.equal(map(source).text, 'a|b');
  assert.equal(replace(source, 1, 2, '', { table: true }), 'ab');
});

test('escape and entity glyphs cover their complete raw source spans', () => {
  const source = '\\[x\\] &amp; &#x1F600; &nbsp;';
  const mapped = map(source);
  assert.equal(mapped.text, '[x] & 😀 \u00a0');
  assert.deepEqual(mapped.starts.slice(0, 3), [0, 2, 3]);
  assert.deepEqual(mapped.ends.slice(0, 3), [2, 3, 5]);
  assert.equal(replace('A &amp; B', 2, 3, 'and'), 'A and B');
  assert.equal(replace('A &#x1F600; B', 2, 4, ''), 'A  B');
});

test('wikilink aliases and basenames expose only their rendered labels', () => {
  const source = '[[folder/Note.md]] [[target|alias]] [[hidden|Note]]';
  const mapped = map(source);
  assert.equal(mapped.text, 'Note alias Note');
  assert.equal(source.slice(mapped.starts[0], mapped.ends[3]), 'Note');
  assert.equal(replace('[[target|alias]]', 0, 5, 'new'), '[[target|new]]');
});

test('comments are hidden without allowing edits to erase their contents', () => {
  assert.equal(map('a%%hidden URL%%b').text, 'ab');
  assert.equal(replace('a%%hidden URL%%b', 0, 2, 'X'), 'X%%hidden URL%%');
});

test('literal code passes Markdown, HTML and entities through untouched', () => {
  const source = '**x** <br> &amp; [x](url)\n%%comment%%';
  assert.equal(map(source, { literal: true }).text, source);
  assert.equal(replace('a*b', 1, 2, '<br>\n|', { literal: true }), 'a<br>\n|b');
});

test('codespan whitespace normalization retains original source ranges', () => {
  const mapped = map('`` a `\nb ``');
  assert.equal(mapped.text, 'a ` b');
  assert.deepEqual(mapped.starts, [3, 4, 5, 6, 7]);
  assert.equal(replace('` a `', 0, 1, ''), '');
});

test('unsupported HTML and ambiguous slices require the explicit source fallback', () => {
  assert.equal(sliceInlineMap(map('x <em>y</em>'), 'y'), null);
  assert.equal(sliceInlineMap(map('same **same**'), 'same'), null);
  assert.equal(sliceInlineMap(map('![picture](image.png)'), 'picture'), null);
});

test('stale maps and invalid visible ranges cannot write changes', () => {
  const mapped = map('**word**');
  assert.throws(() => replaceInlineSource('**else**', mapped, 0, 4, 'X'), /stale|source/i);
  assert.throws(() => replaceInlineSource('**word**', mapped, 0, 20, 'X'), /range/i);
});

test('empty literal maps and slices expose the original caret origin', () => {
  const source = 'before\n```\n\n```\nafter';
  const mapped = mapInlineSource(source, 11, 11, { literal: true });
  const sliced = sliceInlineMap(mapped, '');
  assert.equal(sliced.from, 11);
  assert.equal(sliced.to, 11);
  assert.deepEqual(sliced.starts, []);
  assert.deepEqual(sliced.ends, []);
  assert.equal(replaceInlineSource(source, sliced, 0, 0, 'x', { literal: true }).source, 'before\n```\nx\n```\nafter');
});

test('an empty slice has a valid cursor even when its parent contains text', () => {
  const sliced = sliceInlineMap(map('**word**'), '');
  assert.equal(sliced.text, '');
  assert.equal(sliced.from, 2);
  assert.equal(sliced.to, 2);
  assert.equal(replaceInlineSource('**word**', sliced, 0, 0, 'X').source, '**Xword**');
});

test('escaped brackets in a link label retain escape spans and hide its destination', () => {
  const source = '[a \\] b](target) **b**';
  assert.equal(map(source).text, 'a ] b b');
  assert.equal(replace(source, 2, 3, 'X'), '[a X b](target) **b**');
});

test('literal multiline bodies retain newline glyph positions across repeated edits', () => {
  const source = 'before\nalpha\nbeta\nafter';
  const mapped = mapInlineSource(source, 7, 17, { literal: true });
  assert.equal(mapped.text, 'alpha\nbeta');
  assert.deepEqual(mapped.starts, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const result = replaceInlineSource(source, mapped, 5, 6, '\nnew\n', { literal: true });
  assert.equal(result.source, 'before\nalpha\nnew\nbeta\nafter');
});

test('numeric entities use HTML replacement and Windows-1252 rules', () => {
  assert.equal(map('&#0; &#128; &#xD800; &#x110000;').text, '� € � �');
});

test('semicolonless entities map complete glyph spans or require source fallback', () => {
  assert.equal(map('A &amp B').text, 'A & B');
  assert.equal(replace('A &amp B', 2, 3, 'and'), 'A and B');
  assert.equal(sliceInlineMap(map('&NotEqualTilde;'), '≂̸'), null);
  assert.equal(sliceInlineMap(map('&notin'), '&notin'), null);
});

test('typing backticks into inline code grows both fences together', () => {
  assert.equal(replace('`ab`', 1, 1, '`'), '``a`b``');
  assert.equal(replace('`ab`', 0, 2, '`'), '`` ` ``');
  assert.equal(map(replace('`ab`', 0, 2, '`')).text, '`');
});

test('a UTF-16 diff inside an entity preserves the unselected surrogate', () => {
  assert.equal(replace('&#x1F600;', 1, 2, '\ude04'), '😄');
});
