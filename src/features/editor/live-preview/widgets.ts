import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import type { MutableRefObject } from "react";
import type { ClientInfo } from "../../../domain/types";
import { colorForClient } from "../../../shared/client";
import { handleKanbanAction, handleKanbanDragStart, handleKanbanDrop } from "../../markdown/kanban";
import { createDocumentListMarker } from "../../markdown/document-elements";
import { renderDynamicMarkdown, sanitizeMarkdown } from "../../markdown/renderer";
import { liveBlockContentEnd, type LiveSourceBlock } from "./blocks";
import { liveSourceRevealEffect, type LiveSourceReveal } from "./state";
import type { LiveEditorProps } from "./types";

function blockGapDOM(height: number) {
  const gap = document.createElement("div");
  gap.className = "pm-live-block-gap";
  gap.style.height = `${height}px`;
  gap.setAttribute("aria-hidden", "true");
  return gap;
}

export class LiveBlockGapWidget extends WidgetType {
  constructor(readonly height: number) { super(); }

  eq(other: LiveBlockGapWidget) {
    return other.height === this.height;
  }

  get estimatedHeight() { return this.height; }

  toDOM() { return blockGapDOM(this.height); }

  ignoreEvent() { return true; }
}

export class RemoteCaretWidget extends WidgetType {
  constructor(readonly client: ClientInfo) { super(); }

  eq(other: RemoteCaretWidget) {
    return other.client.id === this.client.id
      && other.client.cursor === this.client.cursor
      && other.client.name === this.client.name;
  }

  toDOM() {
    const caret = document.createElement("span");
    caret.className = "pm-live-remote-caret";
    caret.style.setProperty("--pm-presence-color", this.client.color || colorForClient(this.client.id));
    caret.dataset.pmName = this.client.name;
    return caret;
  }
}

export class LiveListMarkerWidget extends WidgetType {
  constructor(readonly label: string, readonly ordered = false) { super(); }

  eq(other: LiveListMarkerWidget) {
    return other.label === this.label && other.ordered === this.ordered;
  }

  toDOM() {
    return createDocumentListMarker(this.label, this.ordered);
  }

  ignoreEvent() { return true; }
}

export class LiveTaskWidget extends WidgetType {
  constructor(
    readonly markerStart: number,
    readonly checked: boolean,
    readonly propsRef: MutableRefObject<LiveEditorProps>,
  ) { super(); }

  eq(other: LiveTaskWidget) {
    return this.markerStart === other.markerStart && this.checked === other.checked;
  }

  toDOM(view: EditorView) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.className = "pm-live-task-checkbox";
    checkbox.setAttribute("aria-label", this.checked ? "Marcar tarefa como pendente" : "Marcar tarefa como concluída");
    checkbox.addEventListener("pointerdown", (event) => event.stopPropagation());
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.propsRef.current.readOnly) return;
      view.dispatch({ changes: { from: this.markerStart + 1, to: this.markerStart + 2, insert: this.checked ? " " : "x" } });
      view.focus();
    });
    return checkbox;
  }

  ignoreEvent() { return true; }
}

type NormalizedSource = { text: string; sourceOffsets: number[] };

function normalizeWithOffsets(value: string): NormalizedSource {
  let text = "";
  const sourceOffsets: number[] = [];
  let pendingWhitespace = -1;

  for (let index = 0; index < value.length; index += 1) {
    if (/\s/.test(value[index])) {
      if (text && !text.endsWith(" ") && pendingWhitespace < 0) pendingWhitespace = index;
      continue;
    }
    if (pendingWhitespace >= 0) {
      text += " ";
      sourceOffsets.push(pendingWhitespace);
      pendingWhitespace = -1;
    }
    text += value[index];
    sourceOffsets.push(index);
  }

  return { text, sourceOffsets };
}

type DomCaret = { node: Node; offset: number };

function domCaretAtPoint(clientX: number, clientY: number): DomCaret | null {
  const caretPosition = document.caretPositionFromPoint?.(clientX, clientY);
  let node = caretPosition?.offsetNode || null;
  let offset = caretPosition?.offset ?? 0;

  if (!node) {
    const legacyDocument = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
    const caretRange = legacyDocument.caretRangeFromPoint?.(clientX, clientY);
    node = caretRange?.startContainer || null;
    offset = caretRange?.startOffset || 0;
  }

  return node ? { node, offset } : null;
}

function caretTextOffset(target: HTMLElement, point: DomCaret | null, clientX: number) {
  if (point && target.contains(point.node)) {
    const range = document.createRange();
    range.selectNodeContents(target);
    range.setEnd(point.node, point.offset);
    return normalizeWithOffsets(range.toString()).text.length;
  }

  const rect = target.getBoundingClientRect();
  const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  return Math.round(normalizeWithOffsets(target.textContent || "").text.length * ratio);
}

function closestSourceOffset(root: HTMLElement, raw: string, event: MouseEvent | PointerEvent) {
  const point = domCaretAtPoint(event.clientX, event.clientY);
  const semanticTarget = (event.target as HTMLElement).closest<HTMLElement>(
    "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th,summary,.pm-property strong,.pm-property span",
  ) || root;
  const pointedText = point?.node.nodeType === Node.TEXT_NODE && root.contains(point.node)
    ? point.node.textContent || ""
    : "";
  const targetText = normalizeWithOffsets(pointedText || semanticTarget.innerText || semanticTarget.textContent || "").text;
  const textOffset = pointedText
    ? normalizeWithOffsets(pointedText.slice(0, point!.offset)).text.length
    : caretTextOffset(semanticTarget, point, event.clientX);
  const normalized = normalizeWithOffsets(raw);

  if (!targetText) return Math.max(0, raw.search(/\S|$/));

  const candidates: number[] = [];
  for (let cursor = normalized.text.indexOf(targetText); cursor >= 0; cursor = normalized.text.indexOf(targetText, cursor + 1)) {
    candidates.push(cursor);
  }
  if (!candidates.length) return Math.max(0, raw.search(/\S|$/));

  const rootRect = root.getBoundingClientRect();
  const verticalRatio = rootRect.height > 0
    ? Math.max(0, Math.min(1, (event.clientY - rootRect.top) / rootRect.height))
    : 0;
  const expected = verticalRatio * normalized.text.length;
  const start = candidates.reduce((closest, candidate) => (
    Math.abs(candidate - expected) < Math.abs(closest - expected) ? candidate : closest
  ), candidates[0]);
  const normalizedOffset = Math.min(normalized.sourceOffsets.length - 1, start + Math.min(targetText.length, textOffset));
  return normalized.sourceOffsets[Math.max(0, normalizedOffset)] ?? 0;
}

function preservePointerY(
  view: EditorView,
  anchor: number,
  clientY: number,
  reveal: LiveSourceReveal,
  attempt = 0,
) {
  view.requestMeasure({
    key: "pm-live-pointer-anchor",
    read: () => {
      const coordinates = view.coordsAtPos(anchor);
      return coordinates ? (coordinates.top + coordinates.bottom) / 2 : null;
    },
    write: (caretCenter) => {
      if (caretCenter === null) return;
      const delta = caretCenter - clientY;
      if (Math.abs(delta) <= .1 || Math.abs(delta) >= view.scrollDOM.clientHeight * 2) return;

      const shell = view.dom.closest<HTMLElement>(".pm-shell");
      const scale = Math.max(0.1, Number.parseFloat(
        shell ? getComputedStyle(shell).getPropertyValue("--pm-app-scale") : "1",
      ) || 1);
      const before = view.scrollDOM.scrollTop;
      const maximum = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
      const next = Math.max(0, Math.min(maximum, before + delta / scale));
      view.scrollDOM.scrollTop = next;
      const remaining = delta - (next - before) * scale;

      // A short document may have no room to scroll in either direction. In
      // that case its transparent gap becomes the temporary visual anchor.
      if (Math.abs(remaining) > .1) {
        // If the caret must move upward but the document has no scroll room,
        // add temporary space after it and scroll normally. Negative block
        // gaps would corrupt CodeMirror's coordinate map. Moving downward can
        // safely use extra transparent space before the revealed source.
        const scrollRect = view.scrollDOM.getBoundingClientRect();
        const contentChildren = Array.from(view.contentDOM.children);
        const visibleContentBottom = contentChildren.reduce(
          (bottom, child) => Math.max(bottom, child.getBoundingClientRect().bottom),
          view.contentDOM.getBoundingClientRect().top,
        );
        const contentPaddingBottom = Number.parseFloat(getComputedStyle(view.contentDOM).paddingBottom) || 0;
        const scrollUnderflow = Math.max(0, scrollRect.bottom - visibleContentBottom - contentPaddingBottom * scale);
        const correctedReveal = remaining > 0
          ? { ...reveal, scrollRoom: reveal.scrollRoom + scrollUnderflow / scale + remaining / scale + 2 }
          : { ...reveal, paddingBefore: reveal.paddingBefore - remaining / scale };
        requestAnimationFrame(() => {
          view.dispatch({ effects: liveSourceRevealEffect.of(correctedReveal) });
          if (attempt < 8) {
            requestAnimationFrame(() => preservePointerY(
              view,
              anchor,
              clientY,
              correctedReveal,
              attempt + 1,
            ));
          }
        });
      }
    },
  });
}

export class MarkdownBlockWidget extends WidgetType {
  constructor(
    readonly block: LiveSourceBlock,
    readonly version: number,
    readonly propsRef: MutableRefObject<LiveEditorProps>,
  ) { super(); }

  eq(other: MarkdownBlockWidget) {
    return this.block.raw === other.block.raw
      && this.block.start === other.block.start
      && this.block.gapBefore === other.block.gapBefore
      && this.block.gapAfter === other.block.gapAfter
      && this.version === other.version;
  }

  toDOM(view: EditorView) {
    const shell = document.createElement("div");
    shell.className = "pm-live-widget-shell";
    if (this.block.gapBefore > 0) shell.append(blockGapDOM(this.block.gapBefore));

    const root = document.createElement("div");
    root.className = "pm-live-widget pm-markdown";
    root.dataset.pmFrom = String(this.block.start);
    root.dataset.pmTo = String(this.block.end);
    root.innerHTML = sanitizeMarkdown(this.block.raw, this.propsRef.current.context);
    shell.append(root);
    if (this.block.gapAfter > 0) shell.append(blockGapDOM(this.block.gapAfter));

    requestAnimationFrame(async () => {
      if (!root.isConnected) return;
      await renderDynamicMarkdown(root, this.propsRef.current.context);
      if (root.isConnected) view.requestMeasure();
    });
    const refreshLayout = () => view.requestMeasure();
    root.addEventListener("load", refreshLayout, true);
    root.addEventListener("loadedmetadata", refreshLayout, true);
    root.addEventListener("toggle", refreshLayout, true);

    const revealSource = (event: MouseEvent | PointerEvent) => {
      const relative = closestSourceOffset(root, this.block.raw, event);
      const editableEnd = liveBlockContentEnd(this.block);
      const anchor = Math.max(this.block.start, Math.min(editableEnd, this.block.start + relative));
      const reveal = { from: this.block.start, to: editableEnd, paddingBefore: 0, scrollRoom: 0 };
      view.dispatch({
        selection: EditorSelection.cursor(anchor),
        effects: liveSourceRevealEffect.of(reveal),
      });
      view.focus();
      preservePointerY(view, anchor, event.clientY, reveal);
    };

    root.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      const modifiedLink = (event.ctrlKey || event.metaKey) && target.closest("a");
      if (modifiedLink || target.closest("button,input,summary,img,video,audio,details,.pm-kanban")) return;
      event.preventDefault();
      revealSource(event);
    });

    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (this.propsRef.current.readOnly && target.closest(".pm-kanban button,.pm-kanban input,input[type=checkbox]")) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const commitKanban = (source: string) => view.dispatch({
        changes: {
          from: this.block.start,
          to: this.block.end,
          insert: `${source}${this.block.raw.endsWith("\n") ? "\n" : ""}`,
        },
      });
      if (handleKanbanAction(event, commitKanban, this.propsRef.current.onKanbanDialog)) return;

      const anchor = target.closest<HTMLAnchorElement>("a");
      if ((event.ctrlKey || event.metaKey) && anchor?.dataset.pmNote) {
        event.preventDefault();
        this.propsRef.current.onOpenNote(anchor.dataset.pmNote);
        return;
      }

      const image = target.closest<HTMLImageElement>("img[data-pm-target]");
      if (image?.dataset.pmTarget) {
        event.preventDefault();
        this.propsRef.current.onOpenAsset(image.dataset.pmTarget);
        return;
      }

      const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"]');
      if (checkbox && !checkbox.closest(".pm-kanban")) {
        const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
        const wanted = boxes.indexOf(checkbox);
        let index = -1;
        const nextRaw = this.block.raw.replace(/^(\s*[-+*]\s+\[)( |x|X)(\]\s+)/gm, (match, before: string, _mark: string, after: string) => {
          index += 1;
          return index === wanted ? `${before}${checkbox.checked ? "x" : " "}${after}` : match;
        });
        if (nextRaw !== this.block.raw) {
          view.dispatch({ changes: { from: this.block.start, to: this.block.end, insert: nextRaw } });
        }
      }
    });

    root.addEventListener("dragstart", (event) => {
      if (!this.propsRef.current.readOnly) handleKanbanDragStart(event);
    });
    root.addEventListener("dragend", () => {
      root.querySelectorAll(".pm-kanban-card--dragging,.pm-kanban-drop-active")
        .forEach((element) => element.classList.remove("pm-kanban-card--dragging", "pm-kanban-drop-active"));
    });
    root.addEventListener("dragover", (event) => {
      const drop = (event.target as HTMLElement).closest<HTMLElement>("[data-pm-kanban-drop]");
      if (!drop || !event.dataTransfer?.types.includes("application/x-pentamark-kanban")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      root.querySelectorAll(".pm-kanban-drop-active")
        .forEach((element) => element.classList.remove("pm-kanban-drop-active"));
      drop.classList.add("pm-kanban-drop-active");
    });
    root.addEventListener("drop", (event) => {
      handleKanbanDrop(event, (source) => view.dispatch({
        changes: {
          from: this.block.start,
          to: this.block.end,
          insert: `${source}${this.block.raw.endsWith("\n") ? "\n" : ""}`,
        },
      }));
    });
    root.addEventListener("mousemove", (event) => {
      if ((event.target as HTMLElement).closest("a[data-pm-note]")) this.propsRef.current.onLinkHover(event);
      else this.propsRef.current.onLinkLeave();
    });
    root.addEventListener("mouseleave", () => this.propsRef.current.onLinkLeave());
    root.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      revealSource(event);
      this.propsRef.current.onContextMenu(event);
    });
    return shell;
  }

  ignoreEvent() { return false; }
}
