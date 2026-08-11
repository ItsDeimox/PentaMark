import type { MutableRefObject } from "react";
import type { ClientInfo, FormatKind, KanbanDialogState } from "../../../domain/types";
import type { MarkdownContext } from "../../markdown/renderer";

export type LiveEditorApi = {
  applyFormat: (kind: FormatKind) => void;
  focus: () => void;
  selection: () => { from: number; to: number };
};

export type LiveEditorProps = {
  value: string;
  context: MarkdownContext;
  readOnly: boolean;
  remoteClients: ClientInfo[];
  apiRef: MutableRefObject<LiveEditorApi | null>;
  onChange: (value: string) => void;
  onSelection: (from: number, to: number) => void;
  onOpenNote: (path: string) => void;
  onOpenAsset: (target: string) => void;
  onKanbanDialog: (dialog: KanbanDialogState) => void;
  onLinkHover: (event: MouseEvent) => void;
  onLinkLeave: () => void;
  onContextMenu: (event: MouseEvent) => void;
};
