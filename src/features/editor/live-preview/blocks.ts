import { Lexer, Marked, type Token, type Tokens } from "marked";
import {
  DOCUMENT_LAYOUT,
  documentBlockSpacing,
  type DocumentBlockType,
} from "../../markdown/document-layout";

export type LiveBlockType = DocumentBlockType;

export type LiveSourceBlock = {
  type: LiveBlockType;
  start: number;
  end: number;
  raw: string;
  gapBefore: number;
  gapAfter: number;
  /** Render the complete Markdown tree instead of decorating individual lines. */
  semantic?: boolean;
};

type SourceBlock = Omit<LiveSourceBlock, "gapBefore" | "gapAfter">;

const mediaLine = /^ {0,3}(?:!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]+\))[ \t]*(?:\n|$)/;
const ruledLine = /^ {0,3}-#[ \t]+[^\n]*(?:\n|$)/;
const calloutLine = /^ {0,3}\[![a-z0-9_-]+\][+-]?[^\n]*(?:\n|$)/i;
const extensionStart = new RegExp([ruledLine, mediaLine, calloutLine].map((pattern) => pattern.source).join("|"), "im");

// Keep scanner extensions local: the reading renderer configures marked's
// global instance independently. Standard block grammar stays owned by marked.
const liveMarkdown = new Marked({ gfm: true, breaks: true }, {
  extensions: [{
    name: "live-source",
    level: "block",
    start(source) {
      // Only clip a paragraph where the tokenizer can actually consume an
      // extension; a false start makes marked synthesize a joining newline.
      return extensionStart.exec(source)?.index;
    },
    tokenizer(source) {
      const ruled = ruledLine.exec(source);
      if (ruled) return { type: "live-heading", raw: ruled[0] };
      const media = mediaLine.exec(source);
      if (media) return { type: "live-media", raw: media[0] };
      if (calloutLine.test(source)) {
        const raw = /^(?:[^\n]*\S[^\n]*(?:\n|$))+/.exec(source)![0];
        return { type: "live-callout", raw };
      }
      // marked normally removes definitions from its output. Retain their raw
      // ranges so a definition cannot shift every following editor offset.
      const definition = Lexer.rules.block.gfm.def.exec(source);
      if (definition) return { type: "live-definition", raw: definition[0] };
    },
  }],
});

function tokenBlock(token: Token): Pick<SourceBlock, "type" | "semantic"> {
  switch (token.type) {
    case "live-heading": return { type: "heading" };
    case "live-media": return { type: "media" };
    case "live-callout": return { type: "quote", semantic: true };
    case "heading": return { type: "heading", semantic: !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(token.raw) };
    case "hr": return { type: "separator" };
    case "code": return { type: "code" };
    case "table": return { type: "table" };
    case "list": {
      const list = token as Tokens.List;
      return { type: "list", semantic: list.loose || list.items.some((item) => (
        item.text.includes("\n") || item.tokens.length !== 1 || item.tokens[0].type !== "text"
      )) };
    }
    case "blockquote": {
      const quote = token as Tokens.Blockquote;
      return { type: "quote", semantic: quote.tokens.length !== 1
        || quote.tokens[0].type !== "paragraph"
        || quote.raw.trimEnd().split("\n").some((line) => !/^ {0,3}>/.test(line)) };
    }
    case "paragraph": return { type: "paragraph" };
    default: return { type: "paragraph", semantic: true };
  }
}

function blockMargins(block: SourceBlock) {
  let headingLevel = 1;
  if (block.type === "heading") {
    const marker = /^\s*(#{1,6}|-#)(?:\s+|$)/.exec(block.raw)?.[1];
    headingLevel = marker ? (marker === "-#" ? 1 : marker.length)
      : /(?:^|\n) {0,3}-+[ \t]*(?:\r?\n)?$/.test(block.raw) ? 2 : 1;
  }
  return documentBlockSpacing(block.type, headingLevel);
}

function addCollapsedSpacing(blocks: SourceBlock[]) {
  return blocks.map((block, index): LiveSourceBlock => {
    const current = blockMargins(block);
    const previous = index > 0 ? blockMargins(blocks[index - 1]) : null;
    return {
      ...block,
      // HTML block margins collapse. CodeMirror line boxes do not, so the
      // collapsed gap is calculated once and rendered as a measured,
      // transparent block widget by the decoration layer.
      gapBefore: previous ? Math.max(previous.bottom, current.top) : current.top,
      gapAfter: index === blocks.length - 1 ? current.bottom : 0,
    };
  });
}

export function liveBlockContentEnd(block: LiveSourceBlock) {
  return block.end - (/\r\n$/.test(block.raw) ? 2 : /\n$/.test(block.raw) ? 1 : 0);
}

export function scanLiveSourceBlocks(source: string): LiveSourceBlock[] {
  const normalized = source.replace(/\r\n?/g, "\n");
  const blocks: SourceBlock[] = [];
  let originalCursor = 0;
  let normalizedCursor = 0;
  // Token boundaries are visited in order, so CRLF mapping needs no per-byte
  // offset array and never searches for possibly repeated text in the source.
  const originalOffset = (target: number) => {
    if (source === normalized) return target;
    while (normalizedCursor < target) {
      if (source[originalCursor] === "\r" && source[originalCursor + 1] === "\n") originalCursor += 1;
      originalCursor += 1;
      normalizedCursor += 1;
    }
    return originalCursor;
  };
  let offset = 0;
  const opening = /^[ \t]*---[ \t]*(?:\n|$)/.exec(normalized);
  if (opening) {
    const closing = /^[ \t]*---[ \t]*(?:\n|$)/m.exec(normalized.slice(opening[0].length));
    offset = closing ? opening[0].length + closing.index + closing[0].length : normalized.length;
    const end = originalOffset(offset);
    blocks.push({ type: "properties", start: 0, end, raw: source.slice(0, end) });
  }
  for (const token of liveMarkdown.lexer(normalized.slice(offset))) {
    const startOffset = offset;
    offset += token.raw.length;
    if (token.type === "space") continue;
    // Tokens may own separator newlines. Keep exactly the content's final line
    // terminator; blank lines stay in the source for existing spacing widgets.
    const fence = token.type === "code" ? /^ {0,3}(`{3,}|~{3,})/.exec(token.raw)?.[1] : undefined;
    const unclosedFence = fence && !new RegExp(`\n {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\n|$)`).test(token.raw);
    const content = unclosedFence ? token.raw : token.raw.replace(/(?:\n[ \t]*)+$/, "");
    if (!content.trim()) continue;
    const contentEnd = startOffset + content.length;
    const endOffset = contentEnd + (normalized[contentEnd] === "\n" ? 1 : 0);
    const start = originalOffset(startOffset);
    const end = originalOffset(endOffset);
    blocks.push({ ...tokenBlock(token), start, end, raw: source.slice(start, end) });
  }

  return addCollapsedSpacing(blocks);
}

export function liveBlockUsesWidget(block: LiveSourceBlock) {
  return block.semantic === true
    || block.type === "properties"
    || block.type === "code"
    || block.type === "table"
    || block.type === "media"
    || block.type === "separator"
    || (block.type === "quote" && /^\s*>\s*\[![a-z0-9_-]+\][+-]?/im.test(block.raw));
}

export function liveLinePadding(block: LiveSourceBlock, first: boolean, last: boolean) {
  let top = 0;
  let bottom = 0;

  // Only spacing that belongs to the painted element stays on the line.
  // External block gaps are separate widgets so backgrounds and borders do
  // not bleed into the equivalent of an HTML margin.
  if (block.type === "list") {
    if (!last) bottom += DOCUMENT_LAYOUT.list.itemGap;
  }
  if (block.type === "quote") {
    if (first) top += DOCUMENT_LAYOUT.quote.paddingBlock;
    if (last) bottom += DOCUMENT_LAYOUT.quote.paddingBlock;
  }
  if (block.type === "heading" && /^\s*-#\s+/.test(block.raw) && last) {
    bottom += DOCUMENT_LAYOUT.heading.ruledPaddingBottom;
  }

  return { top, bottom };
}
