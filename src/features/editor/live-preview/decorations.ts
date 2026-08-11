import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import type { MutableRefObject } from "react";
import { extensionOfLink, resolveAssetTarget, resolveNotePath } from "../../markdown/renderer";
import {
  liveBlockContentEnd,
  liveBlockUsesWidget,
  liveLinePadding,
  scanLiveSourceBlocks,
  type LiveSourceBlock,
} from "./blocks";
import type { LiveEditorProps } from "./types";
import type { LiveSourceReveal } from "./state";
import {
  LiveBlockGapWidget,
  LiveListMarkerWidget,
  LiveTaskWidget,
  MarkdownBlockWidget,
  RemoteCaretWidget,
} from "./widgets";

type LiveDecorationRange = ReturnType<Decoration["range"]>;
type SourceRange = { from: number; to: number };

function localRangeTouched(from: number, to: number, state: EditorState, focused: boolean) {
  return focused && state.selection.ranges.some((range) => range.empty
    ? range.from >= from && range.from <= to
    : range.from <= to && range.to >= from);
}

function overlaps(from: number, to: number, ranges: SourceRange[]) {
  return ranges.some((range) => from < range.to && to > range.from);
}

function containedBy(from: number, to: number, ranges: SourceRange[]) {
  return ranges.some((range) => from >= range.from && to <= range.to);
}

function hide(ranges: LiveDecorationRange[], from: number, to: number) {
  if (to > from) ranges.push(Decoration.replace({}).range(from, to));
}

function mark(
  ranges: LiveDecorationRange[],
  from: number,
  to: number,
  className: string,
  attributes?: Record<string, string>,
  tagName?: string,
) {
  if (to > from) ranges.push(Decoration.mark({ class: className, attributes, tagName }).range(from, to));
}

function revealOrHideMarkers(
  ranges: LiveDecorationRange[],
  markers: SourceRange[],
  active: boolean,
) {
  for (const marker of markers) {
    if (active) mark(ranges, marker.from, marker.to, "pm-live-syntax");
    else hide(ranges, marker.from, marker.to);
  }
}

function customInlineDecorations(
  text: string,
  absoluteStart: number,
  ranges: LiveDecorationRange[],
  protectedRanges: SourceRange[],
  state: EditorState,
  propsRef: MutableRefObject<LiveEditorProps>,
  focused: boolean,
) {
  const active = (from: number, to: number) => localRangeTouched(from, to, state, focused);

  for (const match of text.matchAll(/%%([\s\S]*?)%%/g)) {
    const from = absoluteStart + match.index!;
    const to = from + match[0].length;
    protectedRanges.push({ from, to });
    if (active(from, to)) mark(ranges, from, to, "pm-live-comment");
    else hide(ranges, from, to);
  }

  for (const match of text.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
    const from = absoluteStart + match.index!;
    const to = from + match[0].length;
    if (overlaps(from, to, protectedRanges)) continue;
    protectedRanges.push({ from, to });

    const embed = Boolean(match[1]);
    const body = match[2];
    const pipe = body.indexOf("|");
    const target = (pipe >= 0 ? body.slice(0, pipe) : body).trim();
    const labelOffset = match[0].indexOf(body) + (pipe >= 0 ? pipe + 1 : 0);
    const labelFrom = from + labelOffset;
    const labelTo = to - 2;
    const notePath = resolveNotePath(target, propsRef.current.context);
    const asset = resolveAssetTarget(target, propsRef.current.context.activePath, propsRef.current.context.assets);
    let attributes: Record<string, string> | undefined;
    if (notePath) attributes = { "data-pm-note": notePath };
    else if (asset || embed) attributes = { "data-pm-asset": target };
    mark(ranges, labelFrom, labelTo, `pm-live-link${notePath ? "" : " pm-live-link--file"}`, attributes, "a");
    revealOrHideMarkers(ranges, [{ from, to: labelFrom }, { from: labelTo, to }], active(from, to));
  }

  for (const match of text.matchAll(/==([^=\n]+)==/g)) {
    const from = absoluteStart + match.index!;
    const to = from + match[0].length;
    if (overlaps(from, to, protectedRanges)) continue;
    protectedRanges.push({ from, to });
    const contentFrom = from + 2;
    const contentTo = to - 2;
    mark(ranges, contentFrom, contentTo, "pm-live-highlight");
    revealOrHideMarkers(ranges, [{ from, to: contentFrom }, { from: contentTo, to }], active(from, to));
  }
}

function parserInlineDecorations(
  state: EditorState,
  ranges: LiveDecorationRange[],
  zones: SourceRange[],
  protectedRanges: SourceRange[],
  propsRef: MutableRefObject<LiveEditorProps>,
  focused: boolean,
) {
  const active = (from: number, to: number) => localRangeTouched(from, to, state, focused);

  syntaxTree(state).iterate({
    enter(ref) {
      if (!overlaps(ref.from, ref.to, zones)) return false;
      if (containedBy(ref.from, ref.to, protectedRanges)) return false;

      const markerName = ref.name === "InlineCode"
        ? "CodeMark"
        : ref.name === "Strikethrough"
          ? "StrikethroughMark"
          : ref.name === "StrongEmphasis" || ref.name === "Emphasis"
            ? "EmphasisMark"
            : "";
      const formatClass = ref.name === "InlineCode"
        ? "pm-live-inline-code"
        : ref.name === "Strikethrough"
          ? "pm-live-strike"
          : ref.name === "StrongEmphasis"
            ? "pm-live-strong"
            : ref.name === "Emphasis"
              ? "pm-live-emphasis"
              : "";

      if (markerName && formatClass) {
        mark(ranges, ref.from, ref.to, formatClass);
        const markers = ref.node.getChildren(markerName).map((node) => ({ from: node.from, to: node.to }));
        revealOrHideMarkers(ranges, markers, active(ref.from, ref.to));
        return;
      }

      if (ref.name === "Link" || ref.name === "Image" || ref.name === "Autolink") {
        const node = ref.node;
        const url = node.getChild("URL");
        const markers = node.getChildren("LinkMark");
        let labelFrom = ref.from;
        let labelTo = ref.to;

        if (ref.name === "Autolink" && url) {
          labelFrom = url.from;
          labelTo = url.to;
        } else if (markers.length >= 2) {
          labelFrom = markers[0].to;
          const closingLabel = markers.find((marker) => state.doc.sliceString(marker.from, marker.to) === "]");
          labelTo = closingLabel?.from ?? markers[1].from;
        }

        const target = url ? state.doc.sliceString(url.from, url.to).trim().replace(/^<|>$/g, "") : "";
        const notePath = extensionOfLink(target) === "md" ? resolveNotePath(target, propsRef.current.context) : "";
        const attributes: Record<string, string> | undefined = target
          ? notePath
            ? { "data-pm-note": notePath }
            : { "data-pm-asset": target }
          : undefined;
        mark(ranges, labelFrom, labelTo, "pm-live-link", attributes, "a");

        const syntaxRanges = [
          ...markers.map((marker) => ({ from: marker.from, to: marker.to })),
          ...(url && (ref.name !== "Autolink" || url.from !== labelFrom) ? [{ from: url.from, to: url.to }] : []),
        ].filter((marker) => marker.to <= labelFrom || marker.from >= labelTo);
        revealOrHideMarkers(ranges, syntaxRanges, active(ref.from, ref.to));
        return false;
      }

      if (ref.name === "Escape") {
        const marker = { from: ref.from, to: Math.min(ref.to, ref.from + 1) };
        revealOrHideMarkers(ranges, [marker], active(ref.from, ref.to));
        return false;
      }
    },
  });
}

function lineDecoration(
  classes: string[],
  block: LiveSourceBlock,
  first: boolean,
  last: boolean,
) {
  const padding = liveLinePadding(block, first, last);
  return Decoration.line({
    class: classes.join(" "),
    attributes: {
      style: `--pm-live-padding-top:${padding.top}px;--pm-live-padding-bottom:${padding.bottom}px`,
    },
  });
}

export function buildLivePreviewDecorations(
  state: EditorState,
  propsRef: MutableRefObject<LiveEditorProps>,
  version: number,
  focusedRef: MutableRefObject<boolean>,
  reveal: LiveSourceReveal | null = null,
): DecorationSet {
  const ranges: LiveDecorationRange[] = [];
  const blocks = scanLiveSourceBlocks(state.doc.toString());
  const coveredLines = new Set<number>();
  const inlineZones: SourceRange[] = [];
  const protectedRanges: SourceRange[] = [];
  const focused = focusedRef.current;

  for (const block of blocks) {
    if (!block.raw.trim()) continue;
    const contentEnd = liveBlockContentEnd(block);
    const selected = localRangeTouched(block.start, contentEnd, state, focused);
    const renderedAsWidget = liveBlockUsesWidget(block) && !selected;

    if (renderedAsWidget) {
      // A block replacement beginning at a line boundary still leaves the
      // CodeMirror anchor line in the DOM. Collapse that structural line so
      // the shared HTML widget starts at the same Y as semantic Preview.
      ranges.push(Decoration.line({ class: "pm-live-widget-anchor" }).range(block.start));
      ranges.push(Decoration.replace({
        widget: new MarkdownBlockWidget(block, version, propsRef),
        block: true,
        inclusive: false,
      }).range(block.start, block.end));
      continue;
    }

    const gapBefore = Math.max(0, block.gapBefore
      + (reveal?.from === block.start ? reveal.paddingBefore : 0));
    if (gapBefore > 0) {
      ranges.push(Decoration.widget({
        widget: new LiveBlockGapWidget(gapBefore),
        block: true,
        side: -100,
      }).range(block.start));
    }
    if (block.gapAfter > 0) {
      ranges.push(Decoration.widget({
        widget: new LiveBlockGapWidget(block.gapAfter),
        block: true,
        side: 100,
      }).range(contentEnd));
    }

    if (!liveBlockUsesWidget(block)) {
      inlineZones.push({ from: block.start, to: contentEnd });
      customInlineDecorations(
        state.doc.sliceString(block.start, contentEnd),
        block.start,
        ranges,
        protectedRanges,
        state,
        propsRef,
        focused,
      );
    }

    let cursor = block.start;
    while (cursor <= contentEnd && cursor <= state.doc.length) {
      const line = state.doc.lineAt(cursor);
      coveredLines.add(line.number);
      const lineText = state.doc.sliceString(line.from, line.to);
      const first = line.from === block.start;
      const last = line.to >= contentEnd;
      const lineActive = localRangeTouched(line.from, line.to, state, focused);
      const classes = ["pm-live-line", `pm-live-line--${block.type}`];
      if (first) classes.push("pm-live-block-first");
      if (last) classes.push("pm-live-block-last");
      if (lineActive) classes.push("pm-live-line--active");

      if (liveBlockUsesWidget(block)) {
        classes.push("pm-live-source", `pm-live-source--${block.type}`);
      } else if (block.type === "heading") {
        const heading = /^(\s*)(#{1,6}|-#)(\s+)/.exec(lineText);
        if (heading) {
          const level = heading[2] === "-#" ? 1 : heading[2].length;
          classes.push(`pm-live-heading-${level}`);
          if (heading[2] === "-#") classes.push("pm-live-heading-ruled");
          const markerFrom = line.from + heading[1].length;
          const markerTo = markerFrom + heading[2].length + heading[3].length;
          if (lineActive) mark(ranges, markerFrom, markerTo, "pm-live-syntax pm-live-block-syntax");
          else hide(ranges, markerFrom, markerTo);
        }
      } else if (block.type === "list") {
        const list = /^(\s*)([-+*]|\d+[.)])(\s+)(?:\[( |x|X)\](\s+))?/.exec(lineText);
        if (list) {
          const markerFrom = line.from + list[1].length;
          if (list[4] !== undefined) {
            classes.push("pm-live-task-line");
            const taskMarkerStart = markerFrom + list[2].length + list[3].length;
            // The semantic checkbox consumes the whitespace after `[ ]` too.
            // Leaving it in the document shifted task text by one rendered space.
            const prefixTo = taskMarkerStart + 3 + list[5].length;
            if (lineActive) mark(ranges, markerFrom, prefixTo, "pm-live-syntax pm-live-block-syntax");
            else ranges.push(Decoration.replace({
              widget: new LiveTaskWidget(taskMarkerStart, list[4].toLowerCase() === "x", propsRef),
            }).range(markerFrom, prefixTo));
          } else {
            const markerTo = markerFrom + list[2].length + list[3].length;
            if (lineActive) {
              mark(ranges, markerFrom, markerTo, "pm-live-syntax pm-live-block-syntax");
            } else if (/^[-+*]$/.test(list[2])) {
              ranges.push(Decoration.replace({ widget: new LiveListMarkerWidget("•") }).range(markerFrom, markerTo));
            } else {
              const label = `${list[2].replace(/[.)]$/, "")}.`;
              ranges.push(Decoration.replace({ widget: new LiveListMarkerWidget(label, true) }).range(markerFrom, markerTo));
            }
          }
        }
      } else if (block.type === "quote") {
        const quote = /^(\s*)>(\s?)/.exec(lineText);
        if (quote) {
          const markerFrom = line.from + quote[1].length;
          const markerTo = markerFrom + 1 + quote[2].length;
          if (lineActive) mark(ranges, markerFrom, markerTo, "pm-live-syntax pm-live-block-syntax");
          else hide(ranges, markerFrom, markerTo);
        }
      }

      ranges.push(lineDecoration(classes, block, first, last).range(line.from));
      if (last || line.to >= state.doc.length) break;
      cursor = line.to + 1;
    }
  }

  parserInlineDecorations(state, ranges, inlineZones, protectedRanges, propsRef, focused);

  for (let number = 1; number <= state.doc.lines; number += 1) {
    if (coveredLines.has(number)) continue;
    const line = state.doc.line(number);
    if (!line.text.trim()) {
      const previousBlank = number > 1 && !state.doc.line(number - 1).text.trim();
      ranges.push(Decoration.line({
        class: `pm-live-line pm-live-line--blank${previousBlank ? " pm-live-line--blank-extra" : ""}`,
      }).range(line.from));
    }
  }

  for (const client of propsRef.current.remoteClients) {
    const position = Math.max(0, Math.min(state.doc.length, client.cursor));
    ranges.push(Decoration.widget({ widget: new RemoteCaretWidget(client), side: 1 }).range(position));
  }

  if (reveal && reveal.scrollRoom > 0) {
    ranges.push(Decoration.widget({
      widget: new LiveBlockGapWidget(reveal.scrollRoom),
      block: true,
      side: 1000,
    }).range(state.doc.length));
  }

  return Decoration.set(ranges, true);
}
