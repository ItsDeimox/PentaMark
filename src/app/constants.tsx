import { Bold, Code2, Heading2, Italic, LayoutDashboard, Link, List, ListOrdered, ListTodo, PanelTopClose, Quote } from "lucide-react";
import type React from "react";
import type { Appearance, FormatKind, VaultState } from "../domain/types";

export const EMPTY_STATE: VaultState = { notes: [], assets: [], folders: [], clients: 1, connections: [], locks: [], urls: [], vaultName: "PentaMark" };
export const DEFAULT_APPEARANCE: Appearance = {
  theme: "pentagory",
  uiFont: "modern",
  editorFont: "mono",
  customUiFont: "",
  customEditorFont: "",
  appScale: 1,
  uiSize: 12,
  editorSize: 15,
};

export const UI_FONTS: Record<string, string> = {
  modern: 'Inter, "Segoe UI", system-ui, sans-serif',
  rounded: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  mono: '"Cascadia Code", Consolas, monospace',
  serif: 'Georgia, "Times New Roman", serif',
};
export const EDITOR_FONTS: Record<string, string> = {
  mono: '"Cascadia Code", Consolas, monospace',
  modern: 'Inter, "Segoe UI", system-ui, sans-serif',
  rounded: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

export const FORMAT_ACTIONS: Array<{ kind: FormatKind; label: string; shortcut: string; icon: React.ComponentType<{ size?: number }> }> = [
  { kind: "bold", label: "Negrito", shortcut: "Ctrl B", icon: Bold },
  { kind: "italic", label: "Itálico", shortcut: "Ctrl I", icon: Italic },
  { kind: "heading", label: "Título", shortcut: "Ctrl ⇧ H", icon: Heading2 },
  { kind: "bullet", label: "Lista", shortcut: "Ctrl ⇧ 8", icon: List },
  { kind: "ordered", label: "Lista numerada", shortcut: "Ctrl ⇧ 7", icon: ListOrdered },
  { kind: "task", label: "Tarefa", shortcut: "Ctrl ⇧ X", icon: ListTodo },
  { kind: "quote", label: "Citação", shortcut: "Ctrl ⇧ Q", icon: Quote },
  { kind: "code", label: "Código", shortcut: "Ctrl ⇧ K", icon: Code2 },
  { kind: "link", label: "Link", shortcut: "Ctrl K", icon: Link },
  { kind: "collapse", label: "Seção recolhível", shortcut: "Ctrl Alt D", icon: PanelTopClose },
  { kind: "kanban", label: "Kanban", shortcut: "Ctrl Alt K", icon: LayoutDashboard },
];
