import type React from "react";
import { marked } from "marked";
import type { KanbanDialogState } from "../../domain/types";
import { decodeSource, encodeSource, escapeAttribute, escapeCode } from "../../shared/text";

export type KanbanCard = { text: string; task: boolean; checked: boolean };
export type KanbanColumn = { title: string; cards: KanbanCard[] };
export type KanbanBoard = { layout: "horizontal" | "vertical"; columns: KanbanColumn[] };

export function parseKanban(text: string, languageLine = "kanban"): KanbanBoard {
  const layout: KanbanBoard["layout"] = /\bvertical\b/i.test(languageLine) ? "vertical" : "horizontal";
  const columns: KanbanColumn[] = [];
  let current: KanbanColumn = { title: "Lista", cards: [] };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim() || /^@layout\s+(?:horizontal|vertical)$/i.test(line.trim())) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (heading) {
      if (current.cards.length || columns.length || current.title !== "Lista") columns.push(current);
      current = { title: heading[1].trim(), cards: [] };
      continue;
    }
    const task = /^\s*[-+*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    const card = /^\s*[-+*]\s+(.+)$/.exec(line);
    if (task) current.cards.push({ text: task[2].trim(), task: true, checked: task[1].toLowerCase() === "x" });
    else if (card) current.cards.push({ text: card[1].trim(), task: false, checked: false });
    else current.cards.push({ text: line.trim(), task: false, checked: false });
  }
  if (current.cards.length || !columns.length) columns.push(current);
  return { layout, columns };
}

export function serializeKanban(board: KanbanBoard) {
  const body = board.columns.map((column) => {
    const cards = column.cards.map((card) => card.task ? `- [${card.checked ? "x" : " "}] ${card.text}` : `- ${card.text}`).join("\n");
    return `## ${column.title}\n${cards}`.trimEnd();
  }).join("\n\n");
  return `\`\`\`kanban ${board.layout}\n${body}\n\`\`\``;
}

export function kanbanFromSource(source: string) {
  const match = /^```(kanban(?:\s+(?:horizontal|vertical))?)\s*\n([\s\S]*?)\n```\s*$/i.exec(source.trim());
  if (!match) return null;
  return parseKanban(match[2], match[1]);
}

export function renderKanban(text: string, languageLine: string) {
  const original = `\`\`\`${languageLine}\n${text}\n\`\`\``;
  const board = parseKanban(text, languageLine);
  const count = board.columns.reduce((total, column) => total + column.cards.length, 0);
  const columns = board.columns.map((column, columnIndex) => `<section class="pm-kanban-column" data-pm-kanban-column="${columnIndex}">
    <header><strong>${escapeCode(column.title)}</strong><small>${column.cards.length}</small><span><button type="button" data-pm-kanban-action="edit-column" title="Renomear lista">✎</button><button type="button" data-pm-kanban-action="remove-column" title="Remover lista">×</button></span></header>
    <div class="pm-kanban-cards" data-pm-kanban-drop="${columnIndex}">${column.cards.map((card, cardIndex) => `<article class="pm-kanban-card${card.checked ? " done" : ""}" draggable="true" data-pm-kanban-card="${cardIndex}">${card.task ? `<input type="checkbox"${card.checked ? " checked" : ""}>` : ""}<div>${marked.parseInline(card.text)}</div><span><button type="button" data-pm-kanban-action="edit-card" title="Editar cartão">✎</button><button type="button" data-pm-kanban-action="remove-card" title="Remover cartão">×</button></span></article>`).join("") || '<span class="pm-kanban-empty">Solte ou adicione um cartão</span>'}</div>
    <button type="button" class="pm-kanban-add-card" data-pm-kanban-action="add-card">+ Adicionar cartão</button>
  </section>`).join("");
  return `<details class="pm-kanban pm-kanban--${board.layout}" data-pm-original="${escapeAttribute(encodeSource(original))}" data-pm-kanban-layout="${board.layout}" contenteditable="false" open><summary><span><strong>Kanban</strong><small>${count} cartões · ${board.columns.length} listas</small></span><span class="pm-kanban-board-actions"><button type="button" data-pm-kanban-action="layout" title="Alternar alinhamento">${board.layout === "horizontal" ? "↕" : "↔"}</button><button type="button" data-pm-kanban-action="add-column" title="Adicionar lista">+ Lista</button></span></summary><div class="pm-kanban-board">${columns}</div></details>\n`;
}

export function handleKanbanAction(
  event: MouseEvent | React.MouseEvent<HTMLElement>,
  commit: (source: string) => void,
  openDialog: (dialog: KanbanDialogState) => void,
) {
  const target = event.target as HTMLElement;
  const boardElement = target.closest<HTMLElement>("details.pm-kanban[data-pm-original]");
  if (!boardElement) return false;
  const source = decodeSource(boardElement.dataset.pmOriginal);
  const board = kanbanFromSource(source);
  if (!board) return false;
  const columnElement = target.closest<HTMLElement>("[data-pm-kanban-column]");
  const cardElement = target.closest<HTMLElement>("[data-pm-kanban-card]");
  const columnIndex = Number(columnElement?.dataset.pmKanbanColumn ?? -1);
  const cardIndex = Number(cardElement?.dataset.pmKanbanCard ?? -1);
  const action = target.closest<HTMLElement>("[data-pm-kanban-action]")?.dataset.pmKanbanAction;
  const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"]');

  const save = () => commit(serializeKanban(board));
  if (checkbox && columnIndex >= 0 && cardIndex >= 0) {
    event.preventDefault();
    event.stopPropagation();
    const card = board.columns[columnIndex]?.cards[cardIndex];
    if (card) { card.task = true; card.checked = !card.checked; save(); }
    return true;
  }
  if (!action) return false;
  event.preventDefault();
  event.stopPropagation();
  if (action === "layout") { board.layout = board.layout === "horizontal" ? "vertical" : "horizontal"; save(); return true; }
  if (action === "add-column") {
    openDialog({ kind: "column", title: "Nova lista", value: "Nova lista", onSave: (value) => { board.columns.push({ title: value.trim() || "Nova lista", cards: [] }); save(); } });
    return true;
  }
  const column = board.columns[columnIndex];
  if (!column) return true;
  if (action === "edit-column") {
    openDialog({ kind: "column", title: "Renomear lista", value: column.title, onSave: (value) => { column.title = value.trim() || column.title; save(); } });
  } else if (action === "remove-column") {
    if (window.confirm(`Remover a lista "${column.title}" e seus ${column.cards.length} cartões?`)) { board.columns.splice(columnIndex, 1); if (!board.columns.length) board.columns.push({ title: "Lista", cards: [] }); save(); }
  } else if (action === "add-card") {
    openDialog({ kind: "card", title: `Novo cartão · ${column.title}`, value: "", onSave: (value, task) => { if (value.trim()) { column.cards.push({ text: value.trim(), task, checked: false }); save(); } } });
  } else {
    const card = column.cards[cardIndex];
    if (!card) return true;
    if (action === "edit-card") {
      openDialog({ kind: "card", title: `Editar cartão · ${column.title}`, value: card.text, task: card.task, onSave: (value, task) => { card.text = value.trim() || card.text; card.task = task; if (!task) card.checked = false; save(); } });
    } else if (action === "remove-card" && window.confirm("Remover este cartão?")) { column.cards.splice(cardIndex, 1); save(); }
  }
  return true;
}

export function handleKanbanDragStart(event: DragEvent | React.DragEvent<HTMLElement>) {
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-pm-kanban-card]");
  const column = card?.closest<HTMLElement>("[data-pm-kanban-column]");
  const board = card?.closest<HTMLElement>("details.pm-kanban[data-pm-original]");
  if (!card || !column || !board || !event.dataTransfer) return false;
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-pentamark-kanban", JSON.stringify({
    source: decodeSource(board.dataset.pmOriginal),
    column: Number(column.dataset.pmKanbanColumn),
    card: Number(card.dataset.pmKanbanCard),
  }));
  card.classList.add("pm-kanban-card--dragging");
  return true;
}

export function handleKanbanDrop(event: DragEvent | React.DragEvent<HTMLElement>, commit: (source: string) => void) {
  const drop = (event.target as HTMLElement).closest<HTMLElement>("[data-pm-kanban-drop]");
  const boardElement = drop?.closest<HTMLElement>("details.pm-kanban[data-pm-original]");
  if (!drop || !boardElement || !event.dataTransfer) return false;
  const raw = event.dataTransfer.getData("application/x-pentamark-kanban");
  if (!raw) return false;
  event.preventDefault();
  event.stopPropagation();
  drop.classList.remove("pm-kanban-drop-active");
  try {
    const payload = JSON.parse(raw) as { source: string; column: number; card: number };
    const source = decodeSource(boardElement.dataset.pmOriginal);
    if (payload.source !== source) return true;
    const board = kanbanFromSource(source);
    const from = board?.columns[payload.column];
    const toIndex = Number(drop.dataset.pmKanbanDrop);
    const to = board?.columns[toIndex];
    const card = from?.cards[payload.card];
    if (!board || !from || !to || !card) return true;
    from.cards.splice(payload.card, 1);
    const targetCard = (event.target as HTMLElement).closest<HTMLElement>("[data-pm-kanban-card]");
    let insertAt = targetCard ? Number(targetCard.dataset.pmKanbanCard) : to.cards.length;
    if (from === to && payload.card < insertAt) insertAt -= 1;
    to.cards.splice(Math.max(0, Math.min(insertAt, to.cards.length)), 0, card);
    commit(serializeKanban(board));
  } catch { /* payload externo ignorado */ }
  return true;
}

