export type ViewMode = "edit" | "split" | "preview" | "live";
export type SaveState = "saved" | "dirty" | "saving" | "conflict";
export type ItemKind = "note" | "folder";
export type TreeItemKind = ItemKind | "asset";
export type FormatKind = "bold" | "italic" | "heading" | "bullet" | "ordered" | "task" | "quote" | "code" | "link" | "collapse" | "kanban";

export type NoteMeta = { path: string; title: string; modified: number; size: number };
export type AssetMeta = { path: string; title: string; extension: string; kind: "image" | "audio" | "video" | "pdf" | "file"; modified: number; size: number };
export type ClientInfo = {
  id: string; name: string; address: string; connectedAt: number; lastSeen: number; local: boolean; sessions: number;
  activePath: string; cursor: number; selectionEnd: number; mode: ViewMode; editing: boolean; avatar: string; color: string;
  permission?: "viewer" | "editor" | "admin"; viaMcp?: boolean;
};
export type LockInfo = { path: string; clientId: string; name: string };
export type VaultState = { notes: NoteMeta[]; assets: AssetMeta[]; folders: string[]; clients: number; connections: ClientInfo[]; locks: LockInfo[]; urls: string[]; vaultName: string };
export type OpenNote = NoteMeta & { content: string; revision: string };
export type ConflictData = { path: string; localContent: string; remoteContent: string; remoteRevision: string };
export type LinkHoverPreview = { path: string; x: number; y: number; html: string; loading: boolean; error: string };
export type KanbanDialogState = {
  kind: "card" | "column";
  title: string;
  value: string;
  task?: boolean;
  onSave: (value: string, task: boolean) => void;
};
export type DraftItem = { kind: ItemKind; parent: string; value: string };
export type RenameItem = { kind: ItemKind; path: string; value: string };
export type DragItem = { kind: TreeItemKind; path: string };
export type ContextMenu =
  | { type: "note"; x: number; y: number; path: string }
  | { type: "folder"; x: number; y: number; path: string }
  | { type: "asset"; x: number; y: number; path: string }
  | { type: "blank"; x: number; y: number }
  | { type: "editor"; x: number; y: number };

export type Appearance = {
  theme: "pentagory" | "eclipse" | "ember" | "terminal";
  uiFont: string;
  editorFont: string;
  customUiFont: string;
  customEditorFont: string;
  appScale: number;
  uiSize: number;
  editorSize: number;
};

export type HostConfig = {
  vaultName: string; port: number; openBrowser: boolean; maxUploadMB: number; lockEditedNotes: boolean;
  cleanupUnusedAssets: boolean; aiBridgeEnabled: boolean; aiBridgeToken: string; isHost: boolean;
  userPermissions?: Record<string, "viewer" | "editor" | "admin">;
};
export type DesktopVaultInfo = { ok: boolean; path: string; name: string; custom: boolean; error?: string };
