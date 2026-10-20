import { Marked, type Tokens } from 'marked';

export type TableCellRange = {
  /** Half-open UTF-16 offsets into the original raw block. */
  from: number;
  to: number;
  /** Apply once when materializing a cell synthesized by marked. */
  insertPrefix?: string;
  insertSuffix?: string;
};

// A private lexer keeps this helper independent of the renderer/editor and of
// extensions registered on marked's global instance.
const markdown = new Marked({ gfm: true, breaks: true });

function rowRanges(text: string, offset: number, width: number): TableCellRange[] {
  const segments: TableCellRange[] = [];
  let start = 0;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    // Match marked's splitCells: odd backslash runs escape a pipe; inline
    // backtick spans and quotation marks do not hide unescaped separators.
    if (character === '|' && !escaped) {
      segments.push({ from: start, to: index });
      start = index + 1;
    }
    escaped = character === '\\' ? !escaped : false;
  }
  segments.push({ from: start, to: text.length });
  const blank = (range: TableCellRange) => !text.slice(range.from, range.to).trim();
  if (segments.length && blank(segments[0])) segments.shift();
  const trailingPipe = start > 0 && !text.slice(start).trim();
  if (segments.length && blank(segments[segments.length - 1])) segments.pop();

  const present = segments.length;
  const ranges: TableCellRange[] = segments.slice(0, width).map(({ from, to }) => {
    if(!text.slice(from,to).trim()) {
      const caret=offset+from+Math.floor((to-from)/2);
      return {from:caret,to:caret};
    }
    while (from < to && /\s/.test(text[from])) from++;
    while (to > from && /\s/.test(text[to - 1])) to--;
    return { from: offset + from, to: offset + to };
  });
  // A trailing outer pipe already separates the first missing cell. Without
  // it we must add a separator. Later missing columns need empty intervening
  // cells, so editing column N never writes into an earlier padded column.
  const prefix = trailingPipe ? (/\s$/.test(text) ? '' : ' ') : ' | ';
  for (let column = present; column < width; column++) {
    ranges.push({
      from: offset + text.length,
      to: offset + text.length,
      insertPrefix: prefix + '| '.repeat(column - present),
      insertSuffix: ' |',
    });
  }
  return ranges;
}

/**
 * Ranges in querySelectorAll('th,td') order: header, then body row/column.
 * The first non-space block must be a table; subsequent blocks are ignored.
 * For a padded range, replace [from,to) with insertPrefix + escapedCellText +
 * insertSuffix on the first edit, then recompute ranges from the updated raw.
 * Offsets always address the original source, including CRLF and Unicode.
 */
export function tableCellRanges(raw: string): TableCellRange[] {
  let table: Tokens.Table | undefined;
  let headerLine = 0;
  for (const token of markdown.lexer(raw)) {
    if (token.type === 'space') {
      headerLine += (token.raw.match(/\n/g) ?? []).length;
      continue;
    }
    if (token.type !== 'table') return [];
    table = token as Tokens.Table;
    break;
  }
  if (!table) return [];

  // Lexing normalizes newlines. Read physical lines separately to retain
  // original offsets instead of searching for repeated/decoded cell text.
  const lines: { text: string; from: number }[] = [];
  let from = 0;
  for (const match of raw.matchAll(/\r\n?|\n/g)) {
    lines.push({ text: raw.slice(from, match.index), from });
    from = match.index + match[0].length;
  }
  lines.push({ text: raw.slice(from), from });

  const header = lines[headerLine];
  const width = table.header.length;
  const ranges = rowRanges(header.text, header.from, width);
  for (let row = 0; row < table.rows.length; row++) {
    const line = lines[headerLine + 2 + row];
    ranges.push(...rowRanges(line.text, line.from, table.rows[row].length));
  }
  return ranges;
}
