import { EditorView, WidgetType } from "@codemirror/view";
import type { MutableRefObject } from "react";
import type { ClientInfo } from "../../../domain/types";
import { colorForClient } from "../../../shared/client";
import { handleKanbanAction, handleKanbanDragStart, handleKanbanDrop } from "../../markdown/kanban";
import { createDocumentListMarker } from "../../markdown/document-elements";
import { renderDynamicMarkdown, sanitizeMarkdown } from "../../markdown/renderer";
import type { LiveSourceBlock } from "./blocks";
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
    const refreshLayout = () => { if (root.isConnected) view.requestMeasure(); };
    root.addEventListener("load", refreshLayout, true);
    root.addEventListener("loadedmetadata", refreshLayout, true);
    root.addEventListener("toggle", refreshLayout, true);

    const editSource = () => {
      if (!this.propsRef.current.readOnly) this.propsRef.current.onEditBlock?.(this.block.start, this.block.end);
    };
    root.tabIndex = 0;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Bloco Markdown. Enter para editar a fonte.");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.disabled = this.propsRef.current.readOnly;
    edit.className = "pm-block-edit-trigger";
    edit.textContent = "Editar";
    edit.setAttribute("aria-label", "Editar fonte do bloco");
    edit.addEventListener("click", (event) => { event.stopPropagation(); editSource(); });
    root.append(edit);
    root.addEventListener("keydown", (event) => {
      if (event.target !== root || !["Enter", "F2"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); editSource();
    });

    root.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      const modifiedLink = (event.ctrlKey || event.metaKey) && target.closest("a");
      if (modifiedLink || target.closest("button,input,summary,img,video,audio,.pm-kanban")) return;
      event.preventDefault();
      editSource();
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
      if (this.propsRef.current.readOnly) return;
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
      event.stopPropagation();
      this.propsRef.current.onContextMenu(event);
    });
    return shell;
  }

  ignoreEvent() { return true; }
}
