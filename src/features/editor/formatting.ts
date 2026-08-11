import type { FormatKind } from "../../domain/types";

export function formatSelectionValue(value: string, start: number, end: number, kind: FormatKind) {
  let changeStart = start;
  let changeEnd = end;
  let selected = value.slice(start, end);
  let replacement = selected;
  let selectionStart = start;
  let selectionEnd = end;
  const wrap = (before: string, after = before, fallback = "texto") => {
    if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
      replacement = selected.slice(before.length, selected.length - after.length);
      selectionStart = start;
      selectionEnd = start + replacement.length;
      return;
    }
    if (value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
      changeStart = start - before.length;
      changeEnd = end + after.length;
      replacement = selected;
      selectionStart = changeStart;
      selectionEnd = changeStart + selected.length;
      return;
    }
    if (!selected) {
      const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const nextBreak = value.indexOf("\n", start);
      const lineEnd = nextBreak < 0 ? value.length : nextBreak;
      const left = value.lastIndexOf(before, start);
      const right = value.indexOf(after, start);
      const italicBoundaryOk = before !== "*" || (value[left - 1] !== "*" && value[left + 1] !== "*" && value[right - 1] !== "*" && value[right + 1] !== "*");
      if (left >= lineStart && right >= start && right + after.length <= lineEnd && left + before.length <= start && italicBoundaryOk) {
        const body = value.slice(left + before.length, right);
        changeStart = left;
        changeEnd = right + after.length;
        replacement = body;
        const cursor = Math.max(0, start - left - before.length);
        selectionStart = left + cursor;
        selectionEnd = selectionStart;
        return;
      }
    }
    const body = selected || fallback;
    replacement = `${before}${body}${after}`;
    selectionStart = start + before.length;
    selectionEnd = selectionStart + body.length;
  };
  const lines = (prefix: string | ((index: number) => string), matcher: RegExp) => {
    const useCurrentLine = start === end;
    if (useCurrentLine) {
      changeStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const nextBreak = value.indexOf("\n", end);
      changeEnd = nextBreak < 0 ? value.length : nextBreak;
      selected = value.slice(changeStart, changeEnd);
    }
    const source = selected || "item";
    const rows = source.split("\n");
    const populated = rows.filter((line) => line.trim());
    const remove = populated.length > 0 && populated.every((line) => matcher.test(line));
    replacement = rows.map((line, index) => {
      if (!line.trim()) return line;
      if (remove) return line.replace(matcher, "");
      return `${typeof prefix === "function" ? prefix(index) : prefix}${line}`;
    }).join("\n");
    const originalCursor = start - changeStart;
    const firstPrefix = typeof prefix === "function" ? prefix(0) : prefix;
    const cursorDelta = remove ? -Math.min(firstPrefix.length, originalCursor) : firstPrefix.length;
    selectionStart = useCurrentLine ? changeStart + Math.max(0, originalCursor + cursorDelta) : changeStart;
    selectionEnd = useCurrentLine ? selectionStart : changeStart + replacement.length;
  };
  if (kind === "bold") wrap("**");
  if (kind === "italic") wrap("*");
  if (kind === "heading") lines("## ", /^\s*##\s+/);
  if (kind === "bullet") lines("- ", /^\s*[-+*]\s+(?!\[[ xX]\])/);
  if (kind === "ordered") lines((index) => `${index + 1}. `, /^\s*\d+[.)]\s+/);
  if (kind === "task") lines("- [ ] ", /^\s*[-+*]\s+\[[ xX]\]\s+/);
  if (kind === "quote") lines("> ", /^\s*>\s?/);
  if (kind === "code") selected.includes("\n") ? wrap("```\n", "\n```", "código") : wrap("`", "`", "código");
  if (kind === "link") {
    const link = /^\[([^\]]+)\]\([^)]+\)$/.exec(selected);
    if (link) { replacement = link[1]; selectionStart = start; selectionEnd = start + replacement.length; }
    else wrap("[", "](https://)", "link");
  }
  if (kind === "collapse") {
    const folded = /^>\s*\[!fold\][+-]?[^\n]*\n([\s\S]*)$/.exec(selected);
    if (folded) {
      replacement = folded[1].split("\n").map((line) => line.replace(/^>\s?/, "")).join("\n");
      selectionStart = start;
      selectionEnd = start + replacement.length;
    } else {
      const body = selected || "conteúdo recolhível";
      replacement = `> [!fold]- Seção\n${body.split("\n").map((line) => `> ${line}`).join("\n")}`;
      selectionStart = start + "> [!fold]- Seção\n> ".length;
      selectionEnd = start + replacement.length;
    }
  }
  if (kind === "kanban") {
    const fenced = /^```kanban(?:\s+\w+)?\n([\s\S]*)\n```$/.exec(selected);
    if (fenced) {
      replacement = fenced[1];
      selectionStart = start;
      selectionEnd = start + replacement.length;
    } else {
      const body = selected || "## A fazer\n- Primeiro cartão\n\n## Fazendo\n- Trabalho atual\n\n## Feito\n- Exemplo concluído";
      replacement = `\`\`\`kanban horizontal\n${body}\n\`\`\``;
      selectionStart = start + "```kanban horizontal\n".length;
      selectionEnd = selectionStart + body.length;
    }
  }
  return { changeStart, changeEnd, replacement, selectionStart, selectionEnd, next: `${value.slice(0, changeStart)}${replacement}${value.slice(changeEnd)}` };
}
