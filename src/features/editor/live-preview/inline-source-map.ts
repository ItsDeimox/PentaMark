import { Marked, type Token } from 'marked';

/** Offsets address UTF-16 code units in the original, complete source string. */
export type InlineSourceMap = {
  /** Source interval, also the insertion origin when there are no glyphs. */
  from: number;
  to: number;
  text: string;
  starts: number[];
  ends: number[];
  formats: {
    from: number; to: number; contentFrom: number; contentTo: number;
    visibleFrom: number; visibleTo: number;
  }[];
};

type Format = InlineSourceMap['formats'][number];
type Options = { quote?: boolean; literal?: boolean };
type MapContext = {
  source: string; from: number; to: number; valid: boolean;
  quote: boolean; literal: boolean; prefix: string;
};
const contexts = new WeakMap<InlineSourceMap, MapContext>();
const formatKinds = new WeakMap<Format, string>();

// Never configure marked's global instance: the reading renderer owns it.
const markdown = new Marked({ gfm: true, breaks: true }, {
  extensions: [{
    name: 'pm-inline-source', level: 'inline',
    start(source) { return /!?\[\[|==|%%/.exec(source)?.index; },
    tokenizer(source) {
      const comment = /^%%[\s\S]*?%%/.exec(source);
      if (comment) return { type: 'pm-comment', raw: comment[0] };
      const wiki = /^(!?)\[\[([^\]\n]+)\]\]/.exec(source);
      if (wiki) return { type: wiki[1] ? 'pm-embed' : 'pm-wiki', raw: wiki[0] };
      const mark = /^==([^=\n]+)==/.exec(source);
      if (mark) return { type: 'pm-mark', raw: mark[0] };
    },
  }],
});

// The browser is authoritative when available. Node's conservative fallback
// covers numeric references and common named references; unfamiliar names make
// the map unavailable rather than guessing a glyph's source position.
const entities: Record<string, string> = {
  amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', apos: "'",
  nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', middot: '·', euro: '€', pound: '£', yen: '¥', cent: '¢',
  times: '×', divide: '÷', plusmn: '±', deg: '°', micro: 'µ', para: '¶', sect: '§',
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', zwnj: '\u200c', zwj: '\u200d',
  lrm: '\u200e', rlm: '\u200f', shy: '\u00ad', NewLine: '\n', Tab: '\t',
  eacute: 'é', Eacute: 'É', aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À',
  acirc: 'â', Acirc: 'Â', atilde: 'ã', Atilde: 'Ã', ccedil: 'ç', Ccedil: 'Ç',
  ecirc: 'ê', Ecirc: 'Ê', iacute: 'í', Iacute: 'Í', oacute: 'ó', Oacute: 'Ó',
  ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ', uacute: 'ú', Uacute: 'Ú',
  uuml: 'ü', Uuml: 'Ü', ntilde: 'ñ', Ntilde: 'Ñ', auml: 'ä', ouml: 'ö', szlig: 'ß',
};
const c1References: Record<number, number> = {
  128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225,
  136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216,
  146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732,
  153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376,
};

function decodeEntity(raw: string): string | null {
  // HTML permits legacy names without ';'. Do not treat an unfamiliar name
  // as literal text: the browser could decode a legacy prefix of that name.
  if (/^&[a-zA-Z]/.test(raw) && !raw.endsWith(';')) {
    return /^(?:amp|AMP|lt|LT|gt|GT|quot|QUOT|nbsp|copy|reg)$/.test(raw.slice(1)) ? entities[raw.slice(1)] : null;
  }
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = raw;
    // Unknown references remain literal. A decoded legacy prefix followed by
    // the rest of a name is not one atomic entity and needs source fallback.
    return textarea.value === raw || textarea.value.length <= 2 ? textarea.value : null;
  }
  const numeric = /^&#(x[\da-f]+|\d+);?$/i.exec(raw);
  if (numeric) {
    let code = /^x/i.test(numeric[1]) ? parseInt(numeric[1].slice(1), 16) : Number(numeric[1]);
    code = c1References[code] ?? code;
    return String.fromCodePoint(!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? 0xfffd : code);
  }
  return entities[raw.slice(1, -1)] ?? null;
}

const quotePrefix = (line: string) => /^(?: {0,3}>[ \t]?)+/.exec(line)?.[0] || '';

/** Strip quote structure while retaining the complete source span of a join. */
function sourceStream(source: string, from: number, to: number, quote: boolean) {
  const stream = { text: '', starts: [] as number[], ends: [] as number[], prefix: '' };
  let cursor = from, firstLine = true;
  while (cursor < to) {
    if (quote && (cursor === from || source[cursor - 1] === '\n')) {
      const prefix = quotePrefix(source.slice(cursor, to));
      if (prefix && !stream.prefix) stream.prefix = prefix;
      cursor += prefix.length;
      if (stream.text.endsWith('\n')) stream.ends[stream.ends.length - 1] = cursor;
      if (firstLine) cursor += /^\[![a-z0-9_-]+\][+-]?[ \t]*/i.exec(source.slice(cursor, to))?.[0].length || 0;
      firstLine = false;
    }
    if (cursor >= to) break;
    const start = cursor;
    if (source[cursor] === '\r') {
      cursor += source[cursor + 1] === '\n' && cursor + 1 < to ? 2 : 1;
      stream.text += '\n';
    } else stream.text += source[cursor++];
    stream.starts.push(start); stream.ends.push(cursor);
  }
  return stream;
}

export function mapInlineSource(source: string, from: number, to: number, options: Options = {}): InlineSourceMap {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > source.length) throw new RangeError('Invalid source range');
  const map: InlineSourceMap = { from, to, text: '', starts: [], ends: [], formats: [] };
  const context: MapContext = { source, from, to, valid: true, quote: !!options.quote, literal: !!options.literal, prefix: '' };
  contexts.set(map, context);
  // Literal fenced-code bodies must not decode entities, escapes or markup.
  if (options.literal) {
    map.text = source.slice(from, to);
    for (let i = from; i < to; i++) { map.starts.push(i); map.ends.push(i + 1); }
    return map;
  }
  const stream = sourceStream(source, from, to, !!options.quote);
  context.prefix = stream.prefix;
  const append = (text: string, start: number, end: number) => {
    map.text += text;
    for (let i = 0; i < text.length; i++) { map.starts.push(stream.starts[start]); map.ends.push(stream.ends[end - 1]); }
  };
  const plain = (start: number, end: number, decode = true) => {
    for (let i = start; i < end;) {
      const entity = decode && /^&(?:#[xX][\da-fA-F]+;?|#\d+;?|[a-zA-Z][\da-zA-Z]*;?)/.exec(stream.text.slice(i, end));
      if (entity) {
        const decoded = decodeEntity(entity[0]);
        if (decoded === null) { context.valid = false; return; }
        if (decoded !== entity[0]) { append(decoded, i, i + entity[0].length); i += entity[0].length; continue; }
      }
      append(stream.text[i], i, i + 1); i++;
    }
  };
  const wrap = (kind: string, start: number, end: number, bodyStart: number, bodyEnd: number, visit: () => void) => {
    const format: Format = {
      from: stream.starts[start], to: stream.ends[end - 1],
      contentFrom: stream.starts[bodyStart] ?? stream.ends[start],
      contentTo: bodyEnd > bodyStart ? stream.ends[bodyEnd - 1] : stream.starts[bodyStart],
      visibleFrom: map.text.length, visibleTo: map.text.length,
    };
    map.formats.push(format); formatKinds.set(format, kind);
    visit(); format.visibleTo = map.text.length;
  };
  const visit = (start: number, end: number) => {
    const raw = stream.text.slice(start, end);
    const tokens: Token[] = markdown.Lexer.lexInline(raw, markdown.defaults);
    let cursor = start;
    for (const token of tokens) {
      const tokenStart = cursor, tokenEnd = cursor + token.raw.length;
      if (!token.raw || stream.text.slice(tokenStart, tokenEnd) !== token.raw || tokenEnd > end) { context.valid = false; return; }
      cursor = tokenEnd;
      if (token.type === 'pm-comment') continue;
      if (token.type === 'text') plain(tokenStart, tokenEnd);
      else if (token.type === 'escape') append(token.raw.slice(1), tokenStart, tokenEnd);
      else if (token.type === 'br' || (token.type === 'html' && /^<br\s*\/?\s*>$/i.test(token.raw))) append('\n', tokenStart, tokenEnd);
      else if (['strong', 'em', 'del', 'pm-mark'].includes(token.type)) {
        const size = token.type === 'em' ? 1 : token.type === 'del' ? /^~+/.exec(token.raw)![0].length : 2;
        wrap(token.type, tokenStart, tokenEnd, tokenStart + size, tokenEnd - size, () => visit(tokenStart + size, tokenEnd - size));
      } else if (token.type === 'codespan') {
        const size = /^`+/.exec(token.raw)![0].length;
        let bodyStart = tokenStart + size, bodyEnd = tokenEnd - size;
        const body = stream.text.slice(bodyStart, bodyEnd).replace(/\n/g, ' ');
        if (body.startsWith(' ') && body.endsWith(' ') && /[^ ]/.test(body)) { bodyStart++; bodyEnd--; }
        wrap('code', tokenStart, tokenEnd, bodyStart, bodyEnd, () => {
          for (let i = bodyStart; i < bodyEnd; i++) append(stream.text[i] === '\n' ? ' ' : stream.text[i], i, i + 1);
        });
      } else if (token.type === 'pm-wiki') {
        const body = token.raw.slice(2, -2), pipe = body.indexOf('|');
        let labelFrom = 2 + (pipe < 0 ? 0 : pipe + 1), labelTo = token.raw.length - 2;
        if (pipe < 0) {
          const target = body.split(/[#^]/, 1)[0];
          labelFrom += Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')) + 1;
          labelTo = 2 + target.length - (/\.md$/i.test(target) ? 3 : 0);
        }
        while (labelFrom < labelTo && /\s/.test(token.raw[labelFrom])) labelFrom++;
        while (labelTo > labelFrom && /\s/.test(token.raw[labelTo - 1])) labelTo--;
        if (labelFrom === labelTo) { context.valid = false; continue; }
        wrap('wiki', tokenStart, tokenEnd, tokenStart + labelFrom, tokenStart + labelTo, () => plain(tokenStart + labelFrom, tokenStart + labelTo, false));
      } else if (token.type === 'link') {
        if (token.raw[0] === '[') {
          // Scan syntax, not label text: marked unescapes bracket escapes in
          // token.text, so its child raw lengths cannot address the source.
          let labelEnd = tokenStart + 1, depth = 1;
          for (; labelEnd < tokenEnd; labelEnd++) {
            const char = stream.text[labelEnd];
            if (char === '\\') { labelEnd++; continue; }
            if (char === '`') {
              const fence = /^`+/.exec(stream.text.slice(labelEnd, tokenEnd))![0];
              const closing = stream.text.indexOf(fence, labelEnd + fence.length);
              if (closing >= 0 && closing < tokenEnd) { labelEnd = closing + fence.length - 1; continue; }
            }
            if (char === '[') depth++;
            if (char === ']' && --depth === 0) break;
          }
          if (depth) { context.valid = false; continue; }
          wrap('link', tokenStart, tokenEnd, tokenStart + 1, labelEnd, () => visit(tokenStart + 1, labelEnd));
        } else if (token.raw[0] === '<') wrap('link', tokenStart, tokenEnd, tokenStart + 1, tokenEnd - 1, () => plain(tokenStart + 1, tokenEnd - 1));
        else plain(tokenStart, tokenEnd);
      } else context.valid = false;
    }
    if (cursor !== end) context.valid = false;
  };
  visit(0, stream.text.length);
  return map;
}

/** Ambiguous matches and unsupported rendering require the explicit source UI. */
export function sliceInlineMap(map: InlineSourceMap, visibleText: string): InlineSourceMap | null {
  const context = contexts.get(map);
  if (!context?.valid) return null;
  const normalize = (value: string) => value.replace(/\u00a0/g, ' ');
  const text = normalize(map.text), wanted = normalize(visibleText);
  const start = text.indexOf(wanted);
  if (start < 0 || (wanted && text.indexOf(wanted, start + 1) >= 0)) return null;
  const end = start + wanted.length;
  const from = map.starts[start] ?? map.from;
  const to = wanted ? map.ends[end - 1] : from;
  const sliced: InlineSourceMap = {
    from, to,
    text: map.text.slice(start, end), starts: map.starts.slice(start, end), ends: map.ends.slice(start, end),
    formats: map.formats.filter(format => wanted ? format.visibleFrom < end && format.visibleTo > start : format.contentFrom <= from && format.contentTo >= from).map(format => {
      // Keep bounds outside the slice: their surviving glyphs prevent removal
      // of a wrapper that contains other islands or unselected text.
      const slicedFormat = { ...format, visibleFrom: format.visibleFrom - start, visibleTo: format.visibleTo - start };
      formatKinds.set(slicedFormat, formatKinds.get(format) || ''); return slicedFormat;
    }),
  };
  contexts.set(sliced, { ...context, from, to });
  return sliced;
}

/** Changes are sorted, nonoverlapping and address the unmodified source. */
export function replaceInlineSource(source: string, map: InlineSourceMap, first: number, end: number, insert: string,
  options: Options & { table?: boolean } = {}): { source: string; changes: { from: number; to: number; insert: string }[] } {
  const context = contexts.get(map);
  if (!context?.valid || context.source !== source) throw new Error('Unmappable or stale inline source');
  if (!Number.isInteger(first) || !Number.isInteger(end) || first < 0 || end < first || end > map.text.length) throw new RangeError('Invalid visible range');
  if (first === end && !insert) return { source, changes: [] };
  // A character reference may decode into several UTF-16 units. A native
  // prefix/suffix diff can split it (for example changing only an emoji's low
  // surrogate); replace the whole source atom and retain its unselected units.
  const requestedFirst = first, requestedEnd = end;
  const sameAtom = (a: number, b: number) => map.starts[a] === map.starts[b] && map.ends[a] === map.ends[b];
  while (first > 0 && first < map.text.length && sameAtom(first - 1, first)) first--;
  while (end > 0 && end < map.text.length && sameAtom(end - 1, end)) end++;
  insert = map.text.slice(first, requestedFirst) + insert + map.text.slice(requestedEnd, end);
  const anchor = map.starts[first] ?? map.ends[first - 1] ?? context.from;
  const literal = options.literal ?? context.literal;
  const code = map.formats.some(format => formatKinds.get(format) === 'code' && anchor >= format.contentFrom && anchor <= format.contentTo);
  let replacement = insert;
  if (!literal && !code) replacement = replacement.replace(/&/g, '&amp;').replace(/[\\`*_[\]<>~=%]/g, '\\$&');
  if (options.table && !literal) replacement = replacement.replace(/\|/g, '\\|').replace(/\r\n?|\n/g, '<br>');
  else if ((options.quote ?? context.quote) && !literal) {
    const lineStart = source.lastIndexOf('\n', Math.max(0, anchor - 1)) + 1;
    const prefix = quotePrefix(source.slice(lineStart)) || context.prefix || '> ';
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    replacement = replacement.replace(/\r\n?|\n/g, newline + prefix);
  }
  const removals: { from: number; to: number }[] = [];
  for (let i = first; i < end; i++) removals.push({ from: map.starts[i], to: map.ends[i] });
  for (const format of map.formats) {
    const emptied = first <= format.visibleFrom && end >= format.visibleTo;
    const insertingInside = !!insert && anchor >= format.contentFrom && anchor <= format.contentTo;
    if (emptied && !insertingInside) {
      removals.push({ from: format.from, to: format.contentFrom }, { from: format.contentTo, to: format.to });
    }
  }
  removals.sort((a, b) => a.from - b.from || a.to - b.to);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const range of removals) {
    if (range.to <= range.from) continue;
    const last = changes[changes.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else changes.push({ ...range, insert: '' });
  }
  if (replacement) {
    const containing = changes.find(change => anchor >= change.from && anchor <= change.to);
    if (containing) containing.insert = replacement;
    else changes.push({ from: anchor, to: anchor, insert: replacement });
  }
  // Code spans cannot escape backticks. If a visible edit introduces a fence,
  // grow both delimiters, adding CommonMark's padding when the body touches it.
  for (const format of map.formats) {
    if (formatKinds.get(format) !== 'code' || !changes.some(change => change.from >= format.contentFrom && change.to <= format.contentTo)) continue;
    const emptied = first <= format.visibleFrom && end >= format.visibleTo;
    if (emptied && !(insert && anchor >= format.contentFrom && anchor <= format.contentTo)) continue;
    let body = source.slice(format.contentFrom, format.contentTo);
    const bodyChanges = changes.filter(change => change.from >= format.contentFrom && change.to <= format.contentTo);
    for (let i = bodyChanges.length - 1; i >= 0; i--) {
      const change = bodyChanges[i];
      body = body.slice(0, change.from - format.contentFrom) + change.insert + body.slice(change.to - format.contentFrom);
    }
    const oldFence = /^`+/.exec(source.slice(format.from))![0];
    const runs = body.match(/`+/g) || [];
    const fence = runs.some(run => run.length === oldFence.length) ? '`'.repeat(Math.max(oldFence.length, ...runs.map(run => run.length)) + 1) : oldFence;
    const padding = body.startsWith('`') || body.endsWith('`') || (body.startsWith(' ') && body.endsWith(' ') && /[^ ]/.test(body)) ? ' ' : '';
    const before = fence + padding, after = padding + fence;
    if (source.slice(format.from, format.contentFrom) !== before) changes.push({ from: format.from, to: format.contentFrom, insert: before });
    if (source.slice(format.contentTo, format.to) !== after) changes.push({ from: format.contentTo, to: format.to, insert: after });
  }
  changes.sort((a, b) => a.from - b.from || a.to - b.to);
  let result = source;
  for (let i = changes.length - 1; i >= 0; i--) result = result.slice(0, changes[i].from) + changes[i].insert + result.slice(changes[i].to);
  return { source: result, changes };
}
