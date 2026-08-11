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
};

type SourceBlock = Omit<LiveSourceBlock, "gapBefore" | "gapAfter">;

const lineText = (line: string) => line.replace(/\r?\n$/, "");

function sourceEnd(start: number, raw: string) {
  return start + raw.length;
}

function blockMargins(block: SourceBlock) {
  let headingLevel = 1;
  if (block.type === "heading") {
    const marker = /^\s*(#{1,6}|-#)\s+/.exec(block.raw)?.[1] || "#";
    headingLevel = marker === "-#" ? 1 : marker.length;
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
  const lines = source.match(/.*(?:\n|$)/g)?.filter(Boolean) || [];
  const blocks: SourceBlock[] = [];
  let offset = 0;
  let index = 0;

  const consume = (type: LiveBlockType, endIndex: number) => {
    const start = offset;
    const raw = lines.slice(index, endIndex + 1).join("");
    blocks.push({ type, start, end: sourceEnd(start, raw), raw });
    for (let cursor = index; cursor <= endIndex; cursor += 1) offset += lines[cursor].length;
    index = endIndex + 1;
  };

  while (index < lines.length) {
    const current = lineText(lines[index]);

    if (index === 0 && current.trim() === "---") {
      let endIndex = index + 1;
      while (endIndex < lines.length && lineText(lines[endIndex]).trim() !== "---") endIndex += 1;
      consume("properties", Math.min(lines.length - 1, endIndex));
      continue;
    }

    const fence = /^\s*(```|~~~)/.exec(current);
    if (fence) {
      let endIndex = index + 1;
      const closingFence = new RegExp(`^\\s*${fence[1]}`);
      while (endIndex < lines.length && !closingFence.test(lineText(lines[endIndex]))) endIndex += 1;
      consume("code", Math.min(lines.length - 1, endIndex));
      continue;
    }

    if (!current.trim()) {
      offset += lines[index].length;
      index += 1;
      continue;
    }

    if (/^\s*(?:!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]+\))\s*$/.test(current)) {
      consume("media", index);
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(current)) {
      consume("separator", index);
      continue;
    }

    if (/^\s*\|?.+\|\s*$/.test(current)
      && index + 1 < lines.length
      && /^\s*\|?\s*:?-{3,}/.test(lineText(lines[index + 1]))) {
      let endIndex = index + 1;
      while (endIndex + 1 < lines.length && /^\s*\|?.+\|\s*$/.test(lineText(lines[endIndex + 1]))) endIndex += 1;
      consume("table", endIndex);
      continue;
    }

    if (/^\s*(?:#{1,6}|-#)\s+/.test(current)) {
      consume("heading", index);
      continue;
    }

    if (/^\s*>/.test(current)) {
      let endIndex = index;
      while (endIndex + 1 < lines.length && /^\s*>/.test(lineText(lines[endIndex + 1]))) endIndex += 1;
      consume("quote", endIndex);
      continue;
    }

    if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(current)) {
      let endIndex = index;
      while (endIndex + 1 < lines.length && /^\s*(?:[-+*]|\d+[.)])\s+/.test(lineText(lines[endIndex + 1]))) endIndex += 1;
      consume("list", endIndex);
      continue;
    }

    let endIndex = index;
    while (endIndex + 1 < lines.length) {
      const next = lineText(lines[endIndex + 1]);
      if (!next.trim()
        || /^\s*(?:```|~~~|(?:#{1,6}|-#)\s+|>|(?:[-+*]|\d+[.)])\s+|(?:[-*_]\s*){3,}|(?:!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]+\))\s*$)/.test(next)
        || (/^\s*\|?.+\|\s*$/.test(next)
          && endIndex + 2 < lines.length
          && /^\s*\|?\s*:?-{3,}/.test(lineText(lines[endIndex + 2])))) break;
      endIndex += 1;
    }
    consume("paragraph", endIndex);
  }

  return addCollapsedSpacing(blocks);
}

export function liveBlockUsesWidget(block: LiveSourceBlock) {
  return block.type === "properties"
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
