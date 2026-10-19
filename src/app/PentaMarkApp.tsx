import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  Columns2,
  Copy,
  CopyPlus,
  Edit3,
  Eye,
  ExternalLink,
  File,
  FileAudio,
  FileImage,
  FilePlus2,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCompareArrows,
  GripVertical,
  Hash,
  Heading2,
  ImagePlus,
  Italic,
  LayoutDashboard,
  Link,
  List,
  ListTodo,
  Lock,
  LogIn,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTopClose,
  Pencil,
  Quote,
  Search,
  Server,
  Settings,
  Share2,
  Sparkles,
  Smartphone,
  Trash2,
  UserCircle,
  Users,
  Wifi,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Appearance,
  AssetMeta,
  ClientInfo,
  ConflictData,
  ContextMenu,
  DesktopVaultInfo,
  DraftItem,
  DragItem,
  FormatKind,
  HostConfig,
  ItemKind,
  KanbanDialogState,
  LockInfo,
  NoteMeta,
  OpenNote,
  RenameItem,
  SaveState,
  TreeItemKind,
  VaultState,
  ViewMode,
} from "../domain/types";
import { DEFAULT_APPEARANCE, EDITOR_FONTS, EMPTY_STATE, UI_FONTS } from "./constants";
import { RequestError, request } from "../api/client";
import { AssetWorkspacePreview } from "../components/AssetWorkspacePreview";
import { ContextDropdown } from "../components/ContextDropdown";
import { MobileDock } from "../components/MobileDock";
import { ClientsModal } from "../components/dialogs/ClientsModal";
import { ConflictModal } from "../components/dialogs/ConflictModal";
import { ConnectModal } from "../components/dialogs/ConnectModal";
import { KanbanEditorDialog } from "../components/dialogs/KanbanEditorDialog";
import { MobileSetupModal } from "../components/dialogs/MobileSetupModal";
import { ProfileModal } from "../components/dialogs/ProfileModal";
import { SettingsModal } from "../components/dialogs/SettingsModal";
import { PresenceAvatar, PresenceStack, RemoteCursorOverlay } from "../components/presence/Presence";
import { LivePreviewEditor, type LiveEditorApi } from "../features/editor/LivePreviewEditor";
import { formatSelectionValue } from "../features/editor/formatting";
import { handleKanbanAction, handleKanbanDragStart, handleKanbanDrop } from "../features/markdown/kanban";
import {
  DocumentSurface,
  DocumentWorkspace,
  MarkdownContent,
} from "../features/markdown/DocumentSurface";
import { DOCUMENT_STYLE_VARIABLES } from "../features/markdown/document-layout";
import {
  renderDynamicMarkdown,
  resolveAssetTarget,
  sanitizeMarkdown,
  type MarkdownContext,
} from "../features/markdown/renderer";
import {
  colorForClient,
  connectionLabel,
  copyText,
  defaultDeviceName,
  initialDeviceName,
  isMobileViewport,
  normalizeConnectionAddress,
  timeAgo,
} from "../shared/client";
import {
  baseName,
  ensureMarkdown,
  joinPath,
  parentOf,
  titleOf,
} from "../shared/path";
import { decodeSource, replaceNth } from "../shared/text";
import { ToolsPanel } from "../features/workspace/ToolsPanel";
import { AnimatedDisclosure } from "../features/workspace/AnimatedDisclosure";
import { AcrylicLayer } from "../features/workspace/AcrylicLayer";
import { LinkPreviewStack, type LinkPreviewHandle } from "../features/workspace/LinkPreviewStack";
import { QuickOpen } from "../features/workspace/QuickOpen";
import { SelectionTools } from "../features/workspace/SelectionTools";
import { useWorkspaceNavigation } from "../features/workspace/useWorkspaceNavigation";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function PentaMarkApp() {
  const [vault, setVault] = useState<VaultState>(EMPTY_STATE);
  const [activePath, setActivePath] = useState("");
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem("pentamark:view") as ViewMode) || "live");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.min(380, Math.max(260, Number(localStorage.getItem("pentamark:sidebar")) || 304)));
  const [split, setSplit] = useState(() => Number(localStorage.getItem("pentamark:split")) || 50);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [draft, setDraft] = useState<DraftItem | null>(null);
  const [renaming, setRenaming] = useState<RenameItem | null>(null);
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [context, setContext] = useState<ContextMenu | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileSetupOpen, setMobileSetupOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflict, setConflict] = useState<ConflictData | null>(null);
  const [assetPreview, setAssetPreview] = useState<AssetMeta | null>(null);
  const [kanbanDialog, setKanbanDialog] = useState<KanbanDialogState | null>(null);
  const [syncScroll, setSyncScroll] = useState(() => localStorage.getItem("pentamark:sync-scroll") !== "false");
  const [historyVersion, setHistoryVersion] = useState(0);
  const previewsRef = useRef<LinkPreviewHandle>(null);
  const [connectionAddress, setConnectionAddress] = useState("");
  const [deviceName, setDeviceName] = useState(initialDeviceName);
  const [deviceAvatar, setDeviceAvatar] = useState(() => localStorage.getItem("pentamark:avatar") || "");
  const [clientId] = useState(() => {
    const stored = localStorage.getItem("pentamark:client-id");
    if (stored) return stored;
    const created = globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("pentamark:client-id", created);
    return created;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [uploading, setUploading] = useState(false);
  const [desktopVault, setDesktopVault] = useState<DesktopVaultInfo | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installedApp, setInstalledApp] = useState(() => window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const [appearance, setAppearance] = useState<Appearance>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("pentamark:appearance") || "{}") as Partial<Appearance>;
      const migrated = localStorage.getItem("pentamark:2k-scale-migrated") === "1";
      if (!migrated && window.screen.width >= 1900) {
        localStorage.setItem("pentamark:2k-scale-migrated", "1");
        return { ...DEFAULT_APPEARANCE, ...stored, uiSize: stored.uiSize ?? DEFAULT_APPEARANCE.uiSize, editorSize: stored.editorSize ?? DEFAULT_APPEARANCE.editorSize };
      }
      return { ...DEFAULT_APPEARANCE, ...stored };
    }
    catch { return DEFAULT_APPEARANCE; }
  });
  const [hostConfig, setHostConfig] = useState<HostConfig>({ vaultName: "PentaMark", port: 3417, openBrowser: true, maxUploadMB: 2048, lockEditedNotes: false, cleanupUnusedAssets: false, aiBridgeEnabled: false, aiBridgeToken: "", isHost: false });

  const navigation = useWorkspaceNavigation(appearance.appScale, sidebarOpen, mobileSidebar, setSidebarOpen, setMobileSidebar);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const liveEditorApiRef = useRef<LiveEditorApi | null>(null);
  const previewPaneRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const presenceTimer = useRef<number | null>(null);
  const cursorRef = useRef({ cursor: 0, selectionEnd: 0 });
  const deviceNameRef = useRef(deviceName);
  const deviceAvatarRef = useRef(deviceAvatar);
  const viewModeRef = useRef(viewMode);
  const locksRef = useRef<LockInfo[]>([]);
  const loadingPath = useRef("");
  const activePathRef = useRef("");
  const saveStateRef = useRef<SaveState>("saved");
  const contentRef = useRef(content);
  const scrollSyncGuard = useRef<"editor" | "preview" | null>(null);
  const noteHistory = useRef<{ paths: string[]; index: number }>({ paths: [], index: -1 });

  activePathRef.current = activePath;
  saveStateRef.current = saveState;
  contentRef.current = content;
  deviceNameRef.current = deviceName;
  deviceAvatarRef.current = deviceAvatar;
  viewModeRef.current = viewMode;
  locksRef.current = vault.locks;

  const shareUrls = useMemo(() => [...new Set([window.location.origin, ...vault.urls].filter((url) => /^https?:\/\//i.test(url)))], [vault.urls]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? "" : current), 2600);
  }, []);

  const copyValue = useCallback(async (value: string, message = "Endereço copiado") => {
    try {
      await copyText(value);
      notify(message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não deu para copiar");
    }
  }, [notify]);

  const installApp = useCallback(async () => {
    if (!installPrompt) {
      notify("Use o menu do navegador e escolha Adicionar à tela inicial");
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
      setInstalledApp(true);
      notify("PentaMark instalado");
    }
  }, [installPrompt, notify]);

  const refreshState = useCallback(async () => {
    try {
      const next = await request<VaultState>("/api/state");
      setVault({ ...next, assets: next.assets || [], connections: next.connections || [], locks: next.locks || [] });
      setHostConfig((current) => ({ ...current, vaultName: next.vaultName }));
      if (!activePathRef.current && next.notes[0]) setActivePath(next.notes[0].path);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não deu para ler o cofre");
    }
  }, [notify]);

  const openNote = useCallback(async (path: string, force = false, recordHistory = true) => {
    if (!path || (path === activePathRef.current && !force)) return;
    loadingPath.current = path;
    try {
      const note = await request<OpenNote>(`/api/note?path=${encodeURIComponent(path)}`);
      if (loadingPath.current !== path) return;
      setActivePath(note.path);
      setAssetPreview(null);
      setContent(note.content);
      setRevision(note.revision);
      setSaveState("saved");
      setConflict(null);
      setConflictOpen(false);
      setMobileSidebar(false);
      if (recordHistory) {
        const history = noteHistory.current;
        if (history.paths[history.index] !== note.path) {
          history.paths = history.paths.slice(0, history.index + 1);
          history.paths.push(note.path);
          history.index = history.paths.length - 1;
          setHistoryVersion((value) => value + 1);
        }
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não deu para abrir a nota");
    }
  }, [notify]);

  const navigateHistory = useCallback((delta: -1 | 1) => {
    const history = noteHistory.current;
    const next = history.index + delta;
    if (next < 0 || next >= history.paths.length) return;
    history.index = next;
    setHistoryVersion((value) => value + 1);
    void openNote(history.paths[next], true, false);
  }, [openNote]);

  const sendPresence = useCallback(async (editingOverride?: boolean) => {
    const path = activePathRef.current;
    const lock = locksRef.current.find((item) => item.path === path && item.clientId !== clientId);
    const mode = viewModeRef.current;
    const editing = editingOverride ?? (Boolean(path) && mode !== "preview" && !lock);
    try {
      await request("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          name: deviceNameRef.current,
          avatar: deviceAvatarRef.current,
          color: colorForClient(clientId),
          path,
          cursor: cursorRef.current.cursor,
          selectionEnd: cursorRef.current.selectionEnd,
          mode,
          editing,
        }),
      });
    } catch (error) {
      if (error instanceof RequestError && (error.status === 404 || error.status === 423)) {
        if (error.status === 423) void refreshState();
        return;
      }
    }
  }, [clientId, refreshState]);

  const schedulePresence = useCallback((target?: HTMLTextAreaElement) => {
    if (target) cursorRef.current = { cursor: target.selectionStart, selectionEnd: target.selectionEnd };
    if (presenceTimer.current) window.clearTimeout(presenceTimer.current);
    presenceTimer.current = window.setTimeout(() => void sendPresence(), 70);
  }, [sendPresence]);

  useEffect(() => {
    localStorage.setItem("pentamark:device-name", deviceName);
    if (deviceAvatar) localStorage.setItem("pentamark:avatar", deviceAvatar);
    else localStorage.removeItem("pentamark:avatar");
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has("device")) {
      currentUrl.searchParams.delete("device");
      window.history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    }
  }, [deviceAvatar, deviceName]);

  useEffect(() => {
    const captureInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setInstallPrompt(null);
      setInstalledApp(true);
    };
    window.addEventListener("beforeinstallprompt", captureInstall);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstall);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  useEffect(() => {
    void window.pentaMarkDesktop?.getProfile().then((profile) => {
      if (profile.name) setDeviceName(profile.name);
      if (profile.avatar) setDeviceAvatar(profile.avatar);
    });
    void window.pentaMarkDesktop?.getVault().then((vaultInfo) => {
      if (vaultInfo.ok && vaultInfo.path && vaultInfo.name) setDesktopVault(vaultInfo as DesktopVaultInfo);
    });
  }, []);

  useEffect(() => { void refreshState(); void request<HostConfig>("/api/config").then(setHostConfig).catch(() => undefined); }, [refreshState]);
  useEffect(() => { if (activePath && activePath !== loadingPath.current) void openNote(activePath, true); }, [activePath, openNote]);

  useEffect(() => {
    const events = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}&name=${encodeURIComponent(deviceName)}`);
    const reloadList = () => void refreshState();
    const reloadConfig = () => { void refreshState(); void request<HostConfig>("/api/config").then(setHostConfig).catch(() => undefined); };
    const refreshPresence = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { connections?: ClientInfo[]; locks?: LockInfo[] };
        setVault((current) => ({ ...current, connections: payload.connections || current.connections, locks: payload.locks || current.locks, clients: Math.max(1, payload.connections?.length || current.clients) }));
      } catch { /* presença incompleta */ }
    };
    const reloadActive = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data);
        if (payload.path === activePathRef.current && saveStateRef.current === "saved") void openNote(payload.path, true);
      } catch { /* evento incompleto */ }
    };
    events.addEventListener("notes", reloadList);
    events.addEventListener("state", reloadList);
    events.addEventListener("config", reloadConfig);
    events.addEventListener("note", reloadActive);
    events.addEventListener("presence", refreshPresence);
    events.addEventListener("open", () => void sendPresence());
    return () => events.close();
  }, [clientId, deviceName, openNote, refreshState, sendPresence]);

  const activeLockOwner = vault.locks.find((item) => item.path === activePath)?.clientId || "";
  useEffect(() => { void sendPresence(); }, [activeLockOwner, activePath, deviceAvatar, deviceName, sendPresence, viewMode]);

  const saveNow = useCallback(async () => {
    if (!activePathRef.current || saveStateRef.current === "saved" || saveStateRef.current === "saving") return;
    const lock = locksRef.current.find((item) => item.path === activePathRef.current && item.clientId !== clientId);
    if (lock) { notify(`${lock.name} está editando este arquivo`); return; }
    setSaveState("saving");
    try {
      const result = await request<{ revision: string }>(`/api/note?path=${encodeURIComponent(activePathRef.current)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, baseRevision: revision, clientId }),
      });
      setRevision(result.revision);
      setSaveState("saved");
      void refreshState();
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        setSaveState("conflict");
        try {
          const remote = await request<OpenNote>(`/api/note?path=${encodeURIComponent(activePathRef.current)}`);
          setConflict({ path: remote.path, localContent: content, remoteContent: remote.content, remoteRevision: remote.revision });
          setConflictOpen(true);
          notify("Conflito detectado — suas alterações foram preservadas");
        } catch {
          notify("Conflito detectado, mas não deu para carregar a outra versão");
        }
        return;
      }
      setSaveState("dirty");
      if (error instanceof RequestError && error.status === 423) void refreshState();
      notify(error instanceof Error ? error.message : "Não deu para salvar");
    }
  }, [clientId, content, notify, refreshState, revision]);

  const useServerVersion = useCallback(() => {
    if (!conflict) return;
    setContent(conflict.remoteContent);
    setRevision(conflict.remoteRevision);
    setSaveState("saved");
    setConflict(null);
    setConflictOpen(false);
    notify("Versão do servidor aplicada");
  }, [conflict, notify]);

  const resolveConflict = useCallback(async (resolvedContent: string) => {
    if (!conflict) return;
    setSaveState("saving");
    try {
      const result = await request<{ revision: string }>(`/api/note?path=${encodeURIComponent(conflict.path)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: resolvedContent, baseRevision: conflict.remoteRevision, clientId }),
      });
      setContent(resolvedContent);
      setRevision(result.revision);
      setSaveState("saved");
      setConflict(null);
      setConflictOpen(false);
      await refreshState();
      notify("Conflito resolvido e sincronizado");
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        const remote = await request<OpenNote>(`/api/note?path=${encodeURIComponent(conflict.path)}`).catch(() => null);
        if (remote) setConflict({ path: remote.path, localContent: resolvedContent, remoteContent: remote.content, remoteRevision: remote.revision });
        setSaveState("conflict");
        notify("O arquivo mudou de novo — atualizei o diff");
        return;
      }
      setSaveState("conflict");
      notify(error instanceof Error ? error.message : "Não deu para resolver o conflito");
    }
  }, [clientId, conflict, notify, refreshState]);

  const connectToVault = useCallback(() => {
    try {
      const target = normalizeConnectionAddress(connectionAddress);
      const cleanName = deviceName.trim().slice(0, 60) || defaultDeviceName();
      localStorage.setItem("pentamark:device-name", cleanName);
      target.searchParams.set("device", cleanName);
      window.location.assign(target.toString());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Endereço inválido");
    }
  }, [connectionAddress, deviceName, notify]);

  const saveProfile = useCallback((name: string, avatar: string) => {
    setDeviceName(name);
    setDeviceAvatar(avatar);
    setProfileOpen(false);
    void window.pentaMarkDesktop?.setProfile({ name, avatar }).then((result) => { if (!result.ok) notify(result.error || "Não deu para salvar o perfil no Desktop"); });
    notify("Perfil atualizado");
  }, [notify]);

  useEffect(() => {
    if (saveState !== "dirty" || !activePath) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveNow(), 700);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [activePath, content, saveNow, saveState]);

  useEffect(() => {
    localStorage.setItem("pentamark:view", viewMode);
    localStorage.setItem("pentamark:sidebar", String(sidebarWidth));
    localStorage.setItem("pentamark:split", String(split));
  }, [sidebarWidth, split, viewMode]);

  useEffect(() => { localStorage.setItem("pentamark:sync-scroll", String(syncScroll)); }, [syncScroll]);

  useEffect(() => {
    let lastMouseNavigation = 0;
    const mouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (Date.now() - lastMouseNavigation < 120) return;
      lastMouseNavigation = Date.now();
      navigateHistory(event.button === 3 ? -1 : 1);
    };
    const key = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      navigateHistory(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("mouseup", mouse);
    window.addEventListener("auxclick", mouse);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mouseup", mouse); window.removeEventListener("auxclick", mouse); window.removeEventListener("keydown", key); };
  }, [navigateHistory]);

  useEffect(() => { if (draft) requestAnimationFrame(() => draftRef.current?.focus()); }, [draft]);
  useEffect(() => { if (renaming) requestAnimationFrame(() => { renameRef.current?.focus(); renameRef.current?.select(); }); }, [renaming?.path]);
  const markdownContext = useMemo<MarkdownContext>(() => ({ activePath, notes: vault.notes, folders: vault.folders, assets: vault.assets }), [activePath, vault.assets, vault.folders, vault.notes]);

  useEffect(() => {
    const close = () => { setContext(null); setMoreOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setContext(null); setDraft(null); setRenaming(null); setMoreOpen(false); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("resize", close); window.removeEventListener("keydown", key); };
  }, []);

  const html = useMemo(() => sanitizeMarkdown(content, markdownContext), [content, markdownContext]);
  const words = useMemo(() => content.trim() ? content.trim().split(/\s+/).length : 0, [content]);
  const allFolders = useMemo(() => ["", ...vault.folders], [vault.folders]);
  const activeLock = vault.locks.find((item) => item.path === activePath && item.clientId !== clientId) || null;
  const activeFileUsers = useMemo(() => vault.connections.filter((client) => client.activePath === activePath), [vault.connections, activePath]);
  const remoteLiveUsers = useMemo(() => activeFileUsers.filter(client => client.id !== clientId && client.editing), [activeFileUsers, clientId]);
  const clientPermission = vault.connections.find((client) => client.id === clientId)?.permission || (hostConfig.isHost ? "admin" : "editor");
  const canEditActive = clientPermission !== "viewer" && (!hostConfig.lockEditedNotes || !activeLock);

  const syncPaneScroll = useCallback((source: "editor" | "preview") => {
    if (!syncScroll || viewModeRef.current !== "split" || scrollSyncGuard.current) return;
    const from = source === "editor" ? textareaRef.current : previewPaneRef.current;
    const to = source === "editor" ? previewPaneRef.current : textareaRef.current;
    if (!from || !to) return;
    const available = from.scrollHeight - from.clientHeight;
    const ratio = available > 0 ? from.scrollTop / available : 0;
    scrollSyncGuard.current = source;
    to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => { scrollSyncGuard.current = null; });
  }, [syncScroll]);

  const editorWheel = useCallback((event: React.WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    setAppearance((current) => ({ ...current, editorSize: Math.max(11, Math.min(32, current.editorSize + direction)) }));
  }, []);

  const toggleRenderedCheckbox = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLInputElement;
    if (target.tagName !== "INPUT" || target.type !== "checkbox") return;
    if (target.closest(".pm-note-embed,.pm-link-preview")) { notify("Abra a nota incorporada para alterar essa tarefa"); return; }
    if (!canEditActive) { target.checked = !target.checked; notify(`${activeLock?.name || "Outro usuário"} está editando este arquivo`); return; }
    const boxes = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const targetIndex = boxes.indexOf(target);
    if (targetIndex < 0) return;
    let index = -1;
    setContent((current) => current.replace(/^(\s*[-+*]\s+\[)( |x|X)(\]\s+)/gm, (match, before: string, _mark: string, after: string) => {
      index += 1;
      return index === targetIndex ? `${before}${target.checked ? "x" : " "}${after}` : match;
    }));
    setSaveState("dirty");
  }, [activeLock?.name, canEditActive, notify]);

  const commitStaticKanban = useCallback((event: React.SyntheticEvent<HTMLElement> | Event, nextSource: string) => {
    const board = (event.target as HTMLElement).closest<HTMLElement>("details.pm-kanban[data-pm-original]");
    const root = board?.closest<HTMLElement>("article.pm-markdown");
    if (!board || !root) return;
    const original = decodeSource(board.dataset.pmOriginal);
    const twins = Array.from(root.querySelectorAll<HTMLElement>("details.pm-kanban[data-pm-original]")).filter((item) => decodeSource(item.dataset.pmOriginal) === original);
    const ordinal = Math.max(0, twins.indexOf(board));
    setContent((current) => replaceNth(current, original, nextSource, ordinal));
    setSaveState("dirty");
  }, []);

  const staticKanbanClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!canEditActive && (event.target as HTMLElement).closest(".pm-kanban button,.pm-kanban input")) {
      event.preventDefault();
      notify(`${activeLock?.name || "Outro usuário"} está editando este arquivo`);
      return true;
    }
    return handleKanbanAction(event, (source) => commitStaticKanban(event, source), setKanbanDialog);
  }, [activeLock?.name, canEditActive, commitStaticKanban, notify]);

  const staticKanbanDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!canEditActive) return;
    handleKanbanDrop(event, (source) => commitStaticKanban(event, source));
  }, [canEditActive, commitStaticKanban]);

  const expandParents = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      let cursor = path;
      next.add("");
      while (cursor) { next.add(cursor); cursor = parentOf(cursor); }
      return next;
    });
  }, []);

  const closeLinkPreview = useCallback(() => previewsRef.current?.close(), []);
  const scheduleLinkPreviewClose = useCallback(() => previewsRef.current?.leave(), []);
  const handleLinkPreviewMove = useCallback((event: React.MouseEvent<HTMLElement>) => previewsRef.current?.hover(event), []);

  const handleMarkdownLink = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
    if (!anchor) return false;
    const notePath = anchor.dataset.pmNote;
    const folderPath = anchor.dataset.pmFolder;
    const createPath = anchor.dataset.pmCreate;
    if (notePath) {
      event.preventDefault();
      closeLinkPreview();
      void openNote(notePath, true);
      return true;
    }
    if (folderPath !== undefined) {
      event.preventDefault();
      setQuery("");
      expandParents(folderPath);
      setExpanded((current) => new Set(current).add(folderPath));
      notify(`Pasta aberta: ${folderPath || "raiz"}`);
      return true;
    }
    if (createPath) {
      event.preventDefault();
      if (!window.confirm(`A nota "${titleOf(createPath)}" não existe. Criar agora?`)) return true;
      void request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ensureMarkdown(createPath), content: `# ${titleOf(createPath)}\n\n` }),
      }).then(async () => { await refreshState(); await openNote(ensureMarkdown(createPath), true); }).catch((error) => notify(error instanceof Error ? error.message : "Não deu para criar a nota"));
      return true;
    }
    return false;
  }, [closeLinkPreview, expandParents, notify, openNote, refreshState]);

  const openAssetTarget = useCallback((target: string) => {
    const asset = resolveAssetTarget(target, activePathRef.current, vault.assets);
    if (!asset) { notify(`Asset não encontrado: ${target}`); return; }
    closeLinkPreview();
    setAssetPreview(asset);
  }, [closeLinkPreview, notify, vault.assets]);

  const handleMarkdownAsset = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const image = (event.target as HTMLElement).closest<HTMLImageElement>("img[data-pm-target]");
    if (!image?.dataset.pmTarget) return false;
    event.preventDefault();
    openAssetTarget(image.dataset.pmTarget);
    return true;
  }, [openAssetTarget]);

  const beginDraft = useCallback((kind: ItemKind, parent = "") => {
    setContext(null);
    setRenaming(null);
    setDraft({ kind, parent, value: "" });
    setSidebarOpen(true);
    setMobileSidebar(true);
    setToolsOpen(false);
    setQuickOpen(false);
    setQuery("");
    expandParents(parent);
  }, [expandParents]);

  const commitDraft = useCallback(async () => {
    if (!draft?.value.trim()) { setDraft(null); return; }
    try {
      if (draft.kind === "note") {
        const path = joinPath(draft.parent, ensureMarkdown(draft.value));
        const title = titleOf(path);
        await request("/api/note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content: `# ${title}\n\n` }),
        });
        setDraft(null);
        await refreshState();
        await openNote(path, true);
      } else {
        const path = joinPath(draft.parent, draft.value.trim());
        await request("/api/folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
        setDraft(null);
        setExpanded((current) => new Set(current).add(path));
        await refreshState();
      }
    } catch (error) { notify(error instanceof Error ? error.message : "Não deu para criar"); }
  }, [draft, notify, openNote, refreshState]);

  const startRename = useCallback((kind: ItemKind, path: string) => {
    setContext(null);
    setDraft(null);
    setRenaming({ kind, path, value: kind === "note" ? titleOf(path) : baseName(path) });
    setSidebarOpen(true);
    setMobileSidebar(true);
    setToolsOpen(false);
    setQuickOpen(false);
    expandParents(parentOf(path));
  }, [expandParents]);

  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const clean = renaming.value.trim();
    if (!clean) { setRenaming(null); return; }
    const parent = parentOf(renaming.path);
    const newPath = joinPath(parent, renaming.kind === "note" ? ensureMarkdown(clean) : clean);
    if (newPath === renaming.path) { setRenaming(null); return; }
    try {
      await request(`/api/${renaming.kind}?path=${encodeURIComponent(renaming.path)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath, clientId }),
      });
      if (renaming.kind === "note" && activePathRef.current === renaming.path) setActivePath(newPath);
      if (renaming.kind === "folder" && activePathRef.current.startsWith(`${renaming.path}/`)) {
        setActivePath(`${newPath}${activePathRef.current.slice(renaming.path.length)}`);
      }
      setRenaming(null);
      await refreshState();
    } catch (error) { notify(error instanceof Error ? error.message : "Não deu para renomear"); }
  }, [clientId, notify, refreshState, renaming]);

  const deleteItem = useCallback(async (kind: TreeItemKind, path: string) => {
    setContext(null);
    const label = kind === "folder" ? "a pasta e tudo dentro dela" : kind === "asset" ? "o asset" : "a nota";
    if (!window.confirm(`Mover ${label} para a lixeira?`)) return;
    try {
      await request(`/api/${kind}?path=${encodeURIComponent(path)}&clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
      if (kind === "note" && activePathRef.current === path) { setActivePath(""); setContent(""); }
      if (kind === "folder" && activePathRef.current.startsWith(`${path}/`)) { setActivePath(""); setContent(""); }
      if (kind === "asset" && assetPreview?.path === path) setAssetPreview(null);
      await refreshState();
    } catch (error) { notify(error instanceof Error ? error.message : "Não deu para apagar"); }
  }, [assetPreview?.path, clientId, notify, refreshState]);

  const duplicateNote = useCallback(async (path: string) => {
    setContext(null);
    try {
      const note = await request<OpenNote>(`/api/note?path=${encodeURIComponent(path)}`);
      const parent = parentOf(path);
      let index = 1;
      let copyPath = joinPath(parent, `${titleOf(path)} — cópia.md`);
      while (vault.notes.some((item) => item.path === copyPath)) copyPath = joinPath(parent, `${titleOf(path)} — cópia ${++index}.md`);
      await request("/api/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: copyPath, content: note.content }) });
      await refreshState();
      await openNote(copyPath, true);
    } catch (error) { notify(error instanceof Error ? error.message : "Não deu para duplicar"); }
  }, [notify, openNote, refreshState, vault.notes]);

  const moveItem = useCallback(async (item: DragItem, targetFolder: string) => {
    setDropTarget(null);
    setDragging(null);
    if (item.kind === "folder" && (targetFolder === item.path || targetFolder.startsWith(`${item.path}/`))) {
      notify("Uma pasta não pode ser movida para dentro dela mesma."); return;
    }
    const newPath = joinPath(targetFolder, baseName(item.path));
    if (newPath === item.path) return;
    const collision = item.kind === "note" ? vault.notes.some((note) => note.path === newPath) : item.kind === "asset" ? vault.assets.some((asset) => asset.path === newPath) : vault.folders.includes(newPath);
    if (collision) { notify("Já existe um item com esse nome nessa pasta"); return; }
    try {
      await request(`/api/${item.kind}?path=${encodeURIComponent(item.path)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath, clientId }),
      });
      if (item.kind === "note" && activePathRef.current === item.path) setActivePath(newPath);
      if (item.kind === "folder" && activePathRef.current.startsWith(`${item.path}/`)) setActivePath(`${newPath}${activePathRef.current.slice(item.path.length)}`);
      expandParents(targetFolder);
      await refreshState();
      notify(`Movido para ${targetFolder || "Notas"}`);
    } catch (error) { notify(error instanceof Error ? error.message : "Não deu para mover"); }
  }, [clientId, expandParents, notify, refreshState, vault.assets, vault.folders, vault.notes]);

  const openInFolder = useCallback(async (kind: TreeItemKind, path: string) => {
    setContext(null);
    if (!window.pentaMarkDesktop) {
      notify("Abrir na pasta funciona no PentaMark Desktop do host");
      return;
    }
    const result = await window.pentaMarkDesktop.openInFolder(kind, path);
    if (!result.ok) notify(result.error || "Não deu para abrir no Explorer");
  }, [notify]);

  const chooseVault = useCallback(async () => {
    setContext(null);
    setMoreOpen(false);
    if (!window.pentaMarkDesktop) { notify("Trocar o diretório do cofre funciona no PentaMark Desktop do host"); return; }
    await saveNow();
    const result = await window.pentaMarkDesktop.chooseVault();
    if (!result.ok) notify(result.error || "Não deu para abrir o cofre");
    else if (result.restarting) notify("Abrindo o outro cofre…");
  }, [notify, saveNow]);

  const showVault = useCallback(async () => {
    if (!window.pentaMarkDesktop) { notify("Disponível no PentaMark Desktop do host"); return; }
    const result = await window.pentaMarkDesktop.showVault();
    if (!result.ok) notify(result.error || "Não deu para abrir o cofre no Explorer");
  }, [notify]);

  const formatRaw = useCallback((kind: FormatKind) => {
    const editor = textareaRef.current;
    if (!editor) return;
    editor.focus();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const result = formatSelectionValue(content, start, end, kind);
    let nativeInserted = false;
    if (result.changeStart !== start || result.changeEnd !== end) nativeInserted = false;
    else try { nativeInserted = document.execCommand("insertText", false, result.replacement); } catch { /* fallback abaixo */ }
    if (!nativeInserted) {
      editor.setRangeText(result.replacement, result.changeStart, result.changeEnd, "end");
      setContent(result.next);
      setSaveState("dirty");
    }
    requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(result.selectionStart, result.selectionEnd); });
    setContext(null);
  }, [content]);

  const formatLive = useCallback((kind: FormatKind) => {
    const editor = liveEditorApiRef.current;
    if (!editor) { notify("O Live Preview ainda está carregando"); return; }
    editor.applyFormat(kind);
    setContext(null);
  }, [notify]);

  const applyFormat = useCallback((kind: FormatKind) => {
    if (assetPreview) { notify("Feche a prévia do asset para editar a nota"); return; }
    if (!canEditActive) { notify(clientPermission === "viewer" ? "Sua permissão neste cofre é somente leitura" : `${activeLock?.name || "Outro usuário"} está editando este arquivo`); return; }
    if (viewMode === "live") formatLive(kind); else formatRaw(kind);
  }, [activeLock?.name, assetPreview, canEditActive, clientPermission, formatLive, formatRaw, notify, viewMode]);

  const keyboardFormat = useCallback((event: React.KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    let action: FormatKind | null = null;
    const key = event.key.toLowerCase();
    if (!event.shiftKey && key === "b") action = "bold";
    if (!event.shiftKey && key === "i") action = "italic";
    if (!event.shiftKey && key === "k") action = "link";
    if (event.shiftKey && key === "h") action = "heading";
    if (event.shiftKey && key === "8") action = "bullet";
    if (event.shiftKey && key === "7") action = "ordered";
    if (event.shiftKey && key === "x") action = "task";
    if (event.shiftKey && key === "q") action = "quote";
    if (event.shiftKey && key === "k") action = "code";
    if (event.altKey && key === "d") action = "collapse";
    if (event.altKey && key === "k") action = "kanban";
    if (action) { event.preventDefault(); applyFormat(action); }
  }, [applyFormat]);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setQuickOpen(false); setToolsOpen(false); return; }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "n") { event.preventDefault(); beginDraft("note"); }
      if (key === "p") { event.preventDefault(); setToolsOpen(false); setQuickOpen(true); }
      if (key === "s") { event.preventDefault(); void saveNow(); }
      const editingLive = document.activeElement instanceof HTMLElement && Boolean(document.activeElement.closest(".pm-live-codemirror"));
      const editingField = document.activeElement instanceof HTMLElement && document.activeElement.matches("input,textarea,select,[contenteditable='true']");
      if (key === "b" && !editingField && !editingLive) { event.preventDefault(); if (window.innerWidth / appearance.appScale < 1100) setMobileSidebar(value => !value); else setSidebarOpen(value => !value); }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [beginDraft, saveNow, appearance.appScale]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    if (!files.length) return;
    if (!canEditActive) { notify(`${activeLock?.name || "Outro usuário"} está editando este arquivo`); return; }
    setUploading(true);
    try {
      const snippets: string[] = [];
      for (const file of Array.from(files)) {
        const result = await request<{ markdown: string }>(`/api/upload?name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        snippets.push(result.markdown);
      }
      setContent((current) => `${current}${current.endsWith("\n") ? "" : "\n"}\n${snippets.join("\n\n")}\n`);
      setSaveState("dirty");
      notify(`${snippets.length} arquivo(s) anexado(s)`);
    } catch (error) { notify(error instanceof Error ? error.message : "Upload falhou"); }
    finally { setUploading(false); }
  }, [activeLock?.name, canEditActive, notify]);

  const openContext = useCallback((event: React.MouseEvent, menu: ContextMenu) => {
    event.preventDefault();
    event.stopPropagation();
    const width = menu.type === "editor" ? 260 : 230;
    const height = menu.type === "editor" ? 448 : 310;
    setContext({ ...menu, x: Math.min(menu.x, window.innerWidth - width * appearance.appScale - 8), y: Math.min(menu.y, window.innerHeight - height * appearance.appScale - 8) } as ContextMenu);
  }, [appearance.appScale]);

  const resizeSidebar = (event: React.PointerEvent) => {
    event.preventDefault();
    const start = event.clientX;
    const width = sidebarWidth;
    document.body.classList.add("pm-resizing");
    const move = (next: PointerEvent) => setSidebarWidth(Math.min(520, Math.max(220, width + (next.clientX - start) / appearance.appScale)));
    const up = () => { document.body.classList.remove("pm-resizing"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const resizeSplit = (event: React.PointerEvent) => {
    event.preventDefault();
    const element = event.currentTarget.parentElement!;
    document.body.classList.add("pm-resizing");
    const move = (next: PointerEvent) => { const rect = element.getBoundingClientRect(); setSplit(Math.min(75, Math.max(25, ((next.clientX - rect.left) / rect.width) * 100))); };
    const up = () => { document.body.classList.remove("pm-resizing"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const setAllExpanded = useCallback((open: boolean) => {
    setExpanded(open ? new Set(allFolders) : new Set<string>());
    setContext(null);
  }, [allFolders]);

  const filteredNotes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return needle ? vault.notes.filter((note) => note.path.toLocaleLowerCase("pt-BR").includes(needle)) : [];
  }, [query, vault.notes]);
  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return needle ? vault.assets.filter((asset) => asset.path.toLocaleLowerCase("pt-BR").includes(needle)) : [];
  }, [query, vault.assets]);

  const treeIndex = useMemo(() => {
    const folders = new Map<string, string[]>(), notes = new Map<string, NoteMeta[]>(), assets = new Map<string, AssetMeta[]>();
    for (const path of vault.folders) { const parent = parentOf(path); if (!folders.has(parent)) folders.set(parent, []); folders.get(parent)!.push(path); }
    for (const note of vault.notes) { const parent = parentOf(note.path); if (!notes.has(parent)) notes.set(parent, []); notes.get(parent)!.push(note); }
    for (const asset of vault.assets) { const parent = parentOf(asset.path); if (!assets.has(parent)) assets.set(parent, []); assets.get(parent)!.push(asset); }
    return { folders, notes, assets };
  }, [vault.folders, vault.notes, vault.assets]);
  const directFolders = (parent: string) => treeIndex.folders.get(parent) || [];
  const directNotes = (parent: string) => treeIndex.notes.get(parent) || [];
  const directAssets = (parent: string) => treeIndex.assets.get(parent) || [];

  const navigateToClient = (client: ClientInfo) => {
    if (!client.activePath) { notify(`${client.name} não está em nenhum arquivo agora`); return; }
    expandParents(parentOf(client.activePath));
    void openNote(client.activePath, true);
  };

  const onDragStart = (event: React.DragEvent, item: DragItem) => {
    setDragging(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-pentamark", JSON.stringify(item));
    event.dataTransfer.setData("text/plain", item.path);
  };

  const folderDropProps = (path: string) => ({
    onDragOver: (event: React.DragEvent) => { if (!dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(path); },
    onDragLeave: (event: React.DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget((current) => current === path ? null : current); },
    onDrop: (event: React.DragEvent) => { if (!dragging) return; event.preventDefault(); event.stopPropagation(); void moveItem(dragging, path); },
  });

  const inlineInput = (kind: ItemKind, value: string, setValue: (value: string) => void, commit: () => void, ref: React.RefObject<HTMLInputElement | null>) => (
    <div className={`pm-tree-inline pm-tree-inline--${kind}`}>
      {kind === "folder" ? <FolderPlus size={14} /> : <FilePlus2 size={14} />}
      <input
        ref={ref}
        value={value}
        placeholder={kind === "folder" ? "Nome da pasta" : "Nome da nota"}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") { setDraft(null); setRenaming(null); } }}
        onBlur={() => { if (value.trim()) commit(); else { setDraft(null); setRenaming(null); } }}
      />
      {kind === "note" && <span>.md</span>}
      <Check size={13} />
    </div>
  );

  const noteRow = (note: NoteMeta, depth: number) => {
    const isRename = renaming?.kind === "note" && renaming.path === note.path;
    const noteUsers = vault.connections.filter((client) => client.activePath === note.path);
    const noteLock = vault.locks.find((item) => item.path === note.path);
    return (
      <div key={note.path} className={`pm-tree-row-wrap ${dragging?.path === note.path ? "dragging" : ""}`} style={{ "--pm-depth": depth } as React.CSSProperties}>
        {isRename ? inlineInput("note", renaming.value, (value) => setRenaming({ ...renaming, value }), () => void commitRename(), renameRef) : (
          <button
            className={`pm-note-item ${activePath === note.path ? "pm-note-item--active" : ""}`}
            draggable
            onDragStart={(event) => onDragStart(event, { kind: "note", path: note.path })}
            onDragEnd={() => { setDragging(null); setDropTarget(null); }}
            onClick={() => void openNote(note.path, true)}
            onDoubleClick={() => startRename("note", note.path)}
            onContextMenu={(event) => openContext(event, { type: "note", path: note.path, x: event.clientX, y: event.clientY })}
            title={`${note.path} — arraste para mover`}
          >
            <GripVertical className="pm-drag-grip" size={12} />
            <FileText size={14} />
            <span><strong>{note.title}</strong></span>
            {!!noteUsers.length && <PresenceStack clients={noteUsers} compact onClientClick={navigateToClient} />}
            {noteLock && <Lock className="pm-tree-lock" size={11} />}
            <small>{timeAgo(note.modified)}</small>
          </button>
        )}
      </div>
    );
  };

  const assetRow = (asset: AssetMeta, depth: number) => {
    const Icon = asset.kind === "image" ? FileImage : asset.kind === "audio" ? FileAudio : asset.kind === "video" ? FileVideo : File;
    return <div key={asset.path} className={`pm-tree-row-wrap ${dragging?.path === asset.path ? "dragging" : ""}`} style={{ "--pm-depth": depth } as React.CSSProperties}>
      <button
        className="pm-note-item pm-asset-item"
        draggable
        onDragStart={(event) => onDragStart(event, { kind: "asset", path: asset.path })}
        onDragEnd={() => { setDragging(null); setDropTarget(null); }}
        onClick={() => setAssetPreview(asset)}
        onContextMenu={(event) => openContext(event, { type: "asset", path: asset.path, x: event.clientX, y: event.clientY })}
        title={`${asset.path} — clique para visualizar · arraste para mover`}
      >
        <GripVertical className="pm-drag-grip" size={12} />
        <Icon size={14} />
        <span><strong>{asset.title}</strong></span>
        <small>{asset.extension.toUpperCase() || "FILE"}</small>
      </button>
    </div>;
  };

  const folderTree = (path: string, depth = 0, root = false): React.ReactNode => {
    const isOpen = expanded.has(path);
    const childrenFolders = directFolders(path);
    const childrenNotes = directNotes(path);
    const childrenAssets = directAssets(path);
    const folderUsers = vault.connections.filter((client) => client.activePath && (path ? client.activePath.startsWith(`${path}/`) : true));
    const isRename = !root && renaming?.kind === "folder" && renaming.path === path;
    return (
      <div key={path || "__root"} className={`pm-folder ${dropTarget === path ? "pm-folder--drop" : ""}`} {...folderDropProps(path)}>
        {isRename ? (
          <div style={{ "--pm-depth": depth } as React.CSSProperties}>{inlineInput("folder", renaming.value, (value) => setRenaming({ ...renaming, value }), () => void commitRename(), renameRef)}</div>
        ) : (
          <button
            className="pm-folder-title" aria-expanded={isOpen}
            style={{ "--pm-depth": depth } as React.CSSProperties}
            draggable={!root}
            onDragStart={(event) => !root && onDragStart(event, { kind: "folder", path })}
            onDragEnd={() => { setDragging(null); setDropTarget(null); }}
            onClick={() => setExpanded((current) => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; })}
            onDoubleClick={() => !root && startRename("folder", path)}
            onContextMenu={(event) => openContext(event, root ? { type: "blank", x: event.clientX, y: event.clientY } : { type: "folder", path, x: event.clientX, y: event.clientY })}
            title={`${root ? "Raiz do cofre" : path} — solte itens aqui para mover`}
          >
            {!root && <GripVertical className="pm-drag-grip" size={12} />}
            <ChevronRight className="pm-tree-chevron" data-expanded={isOpen} size={13} />
            {isOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
            <span>{root ? (vault.vaultName || "Cofre") : baseName(path)}</span>
            {!isOpen && !!folderUsers.length && <PresenceStack clients={folderUsers} compact onClientClick={navigateToClient} />}
            <small>{childrenFolders.length + childrenNotes.length + childrenAssets.length}</small>
          </button>
        )}
        <AnimatedDisclosure open={isOpen}>{() => <>
            {childrenFolders.map((folder) => folderTree(folder, depth + 1))}
            {draft?.parent === path && inlineInput(draft.kind, draft.value, (value) => setDraft({ ...draft, value }), () => void commitDraft(), draftRef)}
            {childrenNotes.map((note) => noteRow(note, depth + 1))}
            {childrenAssets.map((asset) => assetRow(asset, depth + 1))}
            {!childrenFolders.length && !childrenNotes.length && !childrenAssets.length && draft?.parent !== path && <div className="pm-empty-folder">Pasta vazia — solte algo aqui</div>}
        </>}</AnimatedDisclosure>
      </div>
    );
  };

  const uiFont = appearance.uiFont === "custom" ? appearance.customUiFont || UI_FONTS.modern : UI_FONTS[appearance.uiFont] || UI_FONTS.modern;
  const editorFont = appearance.editorFont === "custom" ? appearance.customEditorFont || EDITOR_FONTS.mono : EDITOR_FONTS[appearance.editorFont] || EDITOR_FONTS.mono;
  const shellStyle = {
    ...DOCUMENT_STYLE_VARIABLES,
    zoom: appearance.appScale,
    width: `${100 / appearance.appScale}vw`,
    height: `${100 / appearance.appScale}vh`,
    minHeight: 0,
    "--pm-sidebar-width": `${sidebarWidth}px`,
    "--pm-column-width": `${Math.min(940, Math.max(180, window.innerWidth / appearance.appScale - (navigation.compact ? 48 : sidebarWidth + 96)))}px`,
    "--pm-split": `${split}%`,
    "--pm-ui-font": uiFont,
    "--pm-editor-font": editorFont,
    "--pm-app-scale": appearance.appScale,
    "--pm-ui-size": `${appearance.uiSize}px`,
    "--pm-editor-size": `${appearance.editorSize}px`,
  } as React.CSSProperties;
  const saveSettings = async () => {
    localStorage.setItem("pentamark:appearance", JSON.stringify(appearance));
    try {
      if (hostConfig.isHost) await request("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(hostConfig) });
      setSettingsOpen(false);
      if (hostConfig.isHost) await refreshState();
      notify(hostConfig.isHost ? "Configurações salvas — porta nova vale no próximo início" : "Aparência salva neste dispositivo");
    } catch (error) { notify(error instanceof Error ? error.message : "Não deu para salvar as configurações"); }
  };

  return (
    <main className="pm-shell" data-theme={appearance.theme} data-compact={navigation.compact} data-navigation={navigation.visible} data-graphics={appearance.graphicsMode || "flat"} style={shellStyle}>
      <AcrylicLayer enabled={appearance.graphicsMode === "acrylic"} theme={appearance.theme} />
      <button ref={navigation.openerRef} className="pm-brand-anchor" data-open={navigation.visible}
        onClick={() => navigation.setVisible(!navigation.visible)} aria-expanded={navigation.visible}
        aria-label="Mostrar ou ocultar arquivos" title={navigation.visible ? "Recolher arquivos" : "Abrir arquivos"}>
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 29 12 24 28H8L3 12Z" /><path d="M16 9 23 14 20 22H12L9 14Z" /></svg><span>PentaMark</span>
      </button>
      <nav className="pm-command-bar" aria-label="Ações do espaço de trabalho">
        {saveState === "conflict" && <button className="pm-conflict-button" onClick={() => setConflictOpen(true)}>Conflito · Ver diff</button>}
        {saveState !== "saved" && saveState !== "conflict" && <span role="status">{saveState === "saving" ? "Salvando..." : "Alterado"}</span>}
        <button data-workspace-trigger onClick={() => { setToolsOpen(false); setQuickOpen(true); }} aria-label="Abrir arquivo"><Search size={18} /><span>Abrir</span><kbd>Ctrl P</kbd></button>
        <button data-workspace-trigger aria-expanded={toolsOpen} aria-label="Ferramentas e ações" onClick={() => setToolsOpen(value => !value)}><MoreHorizontal size={21} /></button>
      </nav>
      <aside
        ref={navigation.sidebarRef} inert={!navigation.visible} aria-hidden={!navigation.visible}
        className={`pm-sidebar ${navigation.visible ? "" : "pm-sidebar--closed"}`}
        onContextMenu={(event) => { if ((event.target as HTMLElement).closest("button,input")) return; openContext(event, { type: "blank", x: event.clientX, y: event.clientY }); }}
      >
        <div className="pm-brand"><button className="pm-sidebar-collapse" aria-label="Recolher arquivos" onClick={() => navigation.setVisible(false)} title="Recolher arquivos"><ChevronRight size={16} /></button></div>
        <div className="pm-library-head" {...folderDropProps("")}>
          <span>ARQUIVOS</span>
          <div>
            <button title="Nova nota inline" onClick={() => beginDraft("note")}><FilePlus2 size={13} /></button>
            <button title="Nova pasta inline" onClick={() => beginDraft("folder")}><FolderPlus size={13} /></button>
            <button title="Expandir tudo" onClick={() => setAllExpanded(true)}><ChevronsUpDown size={13} /></button>
            <button title="Recolher tudo" onClick={() => setAllExpanded(false)}><ChevronsDownUp size={13} /></button>
            <small>{vault.notes.length + vault.assets.length}</small>
          </div>
        </div>

        <div
          className={`pm-note-list ${dropTarget === "" ? "pm-note-list--drop" : ""}`}
          onContextMenu={(event) => { if ((event.target as HTMLElement).closest("button,input")) return; openContext(event, { type: "blank", x: event.clientX, y: event.clientY }); }}
          {...folderDropProps("")}
        >
          {folderTree("", 0, true)}
        </div>

        <div className="pm-sidebar-create"><button onClick={() => beginDraft("note")}><FilePlus2 size={18} />Nova nota</button></div>
      </aside>
      {navigation.compact && navigation.visible && <button type="button" className="pm-mobile-scrim" aria-label="Fechar arquivos" onClick={() => navigation.setVisible(false)} />}
      {!navigation.compact && navigation.visible && <div className="pm-sidebar-resizer" onPointerDown={resizeSidebar} />}

      <section className="pm-workspace">
        <div className="pm-document-path" title={activePath}><span>{vault.vaultName || "Cofre"}</span><ChevronRight size={15} /><strong>{assetPreview?.title || (activePath ? titleOf(activePath) : "Nenhuma nota")}</strong></div>
        <DocumentWorkspace
          mode={viewMode}
          onDragOver={(event) => { if (!dragging && event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
          onDrop={(event) => { if (!dragging && event.dataTransfer.files.length) { event.preventDefault(); void uploadFiles(event.dataTransfer.files); } }}
        >
          {assetPreview ? <AssetWorkspacePreview asset={assetPreview} activeNote={activePath} onClose={() => setAssetPreview(null)} onReveal={() => void openInFolder("asset", assetPreview.path)} /> : <>
          {activeLock && <div className="pm-lock-banner"><Lock size={14} /><span><strong>{activeLock.name}</strong> está editando este arquivo. Você está em modo leitura.</span></div>}
          {(viewMode === "edit" || viewMode === "split") && (
            <div className="pm-editor-pane" onWheel={editorWheel} onContextMenu={(event) => openContext(event, { type: "editor", x: event.clientX, y: event.clientY })}>
              <textarea
                ref={textareaRef}
                value={content}
                spellCheck
                readOnly={!canEditActive}
                onChange={(event) => { setContent(event.target.value); setSaveState("dirty"); }}
                onSelect={(event) => schedulePresence(event.currentTarget)}
                onScroll={() => syncPaneScroll("editor")}
                onKeyDown={keyboardFormat}
                placeholder="Comece a escrever…"
              />
              <RemoteCursorOverlay textareaRef={textareaRef} content={content} clients={activeFileUsers.filter((client) => client.id !== clientId && client.editing && (client.mode === "edit" || client.mode === "split"))} />
            </div>
          )}
          {viewMode === "split" && <div className="pm-split-resizer" onPointerDown={resizeSplit} />}
          {(viewMode === "preview" || viewMode === "split") && <DocumentSurface mode="preview" ref={previewPaneRef} onWheel={editorWheel} onScroll={() => syncPaneScroll("preview")}><MarkdownContent html={html} context={markdownContext} onMouseMove={(event) => handleLinkPreviewMove(event)} onMouseLeave={scheduleLinkPreviewClose} onDragStart={(event) => { if (canEditActive) handleKanbanDragStart(event); }} onDragOver={(event) => { const drop = (event.target as HTMLElement).closest("[data-pm-kanban-drop]"); if (drop && event.dataTransfer.types.includes("application/x-pentamark-kanban")) { event.preventDefault(); drop.classList.add("pm-kanban-drop-active"); } }} onDragEnd={(event) => event.currentTarget.querySelectorAll(".pm-kanban-card--dragging,.pm-kanban-drop-active").forEach((element) => element.classList.remove("pm-kanban-card--dragging", "pm-kanban-drop-active"))} onDrop={staticKanbanDrop} onClick={(event) => { if (staticKanbanClick(event)) return; if (handleMarkdownAsset(event)) return; toggleRenderedCheckbox(event); if (!(event.target as HTMLElement).matches('input[type="checkbox"]')) handleMarkdownLink(event); }} /></DocumentSurface>}
          {viewMode === "live" && (
            <DocumentSurface mode="live" onWheel={editorWheel} onKeyDown={keyboardFormat}>
              <LivePreviewEditor
                value={content}
                context={markdownContext}
                readOnly={!canEditActive}
                remoteClients={remoteLiveUsers}
                apiRef={liveEditorApiRef}
                onChange={(value) => { contentRef.current = value; setContent(value); setSaveState("dirty"); }}
                onSelection={(from, to) => { cursorRef.current = { cursor: from, selectionEnd: to }; schedulePresence(); }}
                onOpenNote={(path) => { closeLinkPreview(); void openNote(path, true); }}
                onOpenAsset={openAssetTarget}
                onKanbanDialog={setKanbanDialog}
                onLinkHover={(event) => handleLinkPreviewMove(event as unknown as React.MouseEvent<HTMLElement>)}
                onLinkLeave={scheduleLinkPreviewClose}
                onContextMenu={(event) => setContext({ type: "editor", x: event.clientX, y: event.clientY })}
              />
            </DocumentSurface>
          )}
          {uploading && <div className="pm-drop-zone"><ImagePlus size={26} /><strong>Sincronizando arquivos…</strong><span>Imagens, vídeos e anexos vão para o cofre</span></div>}
          </>}
        </DocumentWorkspace>

        <MobileDock
          mode={viewMode}
          onFiles={() => setMobileSidebar(true)}
          onLive={() => setViewMode("live")}
          onPreview={() => setViewMode("preview")}
          onNewNote={() => { setMobileSidebar(true); beginDraft("note", parentOf(activePath)); }}
        />
        <footer className="pm-statusbar"><span className="online"><Wifi size={10} />Sincronizado</span><span>Markdown</span><span>UTF-8</span><span className="pm-status-spacer" /><span>PentaMark 2.8.0</span></footer>
      </section>

      <QuickOpen open={quickOpen} query={query} onQuery={setQuery} inputRef={searchRef} notes={vault.notes} assets={vault.assets}
        onClose={() => { setQuickOpen(false); setQuery(""); }} onOpen={entry => { if (entry.kind === "note") void openNote(entry.path, true); else { const asset = vault.assets.find(item => item.path === entry.path); if (asset) setAssetPreview(asset); } }} />
      <ToolsPanel open={toolsOpen} onClose={() => setToolsOpen(false)} mode={viewMode} onMode={setViewMode}
        graphics={appearance.graphicsMode || "flat"} onGraphics={mode => setAppearance(current => {
          const next = { ...current, graphicsMode: mode }; localStorage.setItem("pentamark:appearance", JSON.stringify(next)); return next;
        })}
        canEdit={canEditActive && !assetPreview && viewMode !== "preview"} onFormat={applyFormat} onUpload={files => void uploadFiles(files)}
        editorSize={appearance.editorSize} onZoom={direction => setAppearance(current => ({ ...current, editorSize: Math.max(11, Math.min(32, current.editorSize + direction)) }))}
        syncScroll={syncScroll} onSync={() => setSyncScroll(value => !value)}
        hasNote={!!activePath} canBack={noteHistory.current.index > 0} canForward={noteHistory.current.index < noteHistory.current.paths.length - 1}
        onBack={() => navigateHistory(-1)} onForward={() => navigateHistory(1)}
        onNew={() => beginDraft("note", parentOf(activePath))} onRename={() => startRename("note", activePath)}
        onDuplicate={() => void duplicateNote(activePath)} onDelete={() => void deleteItem("note", activePath)}
        onReveal={() => void openInFolder(assetPreview ? "asset" : "note", assetPreview?.path || activePath)}
        onVault={() => void chooseVault()} onShare={() => setShareOpen(true)} onClients={() => setClientsOpen(true)}
        onConnect={() => setConnectOpen(true)} onMobile={() => setMobileSetupOpen(true)} onProfile={() => setProfileOpen(true)}
        onSettings={() => setSettingsOpen(true)} clients={vault.clients} saved={saveState === "saved"} />
      <SelectionTools enabled={viewMode === "live" && canEditActive && !toolsOpen && !quickOpen} scale={appearance.appScale} onFormat={applyFormat} onMore={() => setToolsOpen(true)} />
      <LinkPreviewStack ref={previewsRef} context={markdownContext} scale={appearance.appScale} onOpen={path => void openNote(path, true)} />

      {context && <ContextDropdown context={context} scale={appearance.appScale} onClose={() => setContext(null)} onFormat={applyFormat} onBeginDraft={beginDraft} onRename={startRename} onDuplicate={duplicateNote} onDelete={deleteItem} onExpand={setAllExpanded} onOpen={(path) => void openNote(path, true)} onReveal={(kind, path) => void openInFolder(kind, path)} onPreviewAsset={(path) => { setContext(null); const asset = vault.assets.find((item) => item.path === path); if (asset) setAssetPreview(asset); }} onChooseVault={() => void chooseVault()} />}

      {shareOpen && <div className="pm-modal-backdrop" onMouseDown={() => setShareOpen(false)}><div className="pm-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="pm-modal-close" aria-label="Fechar compartilhamento" onClick={() => setShareOpen(false)}><X size={17} /></button>
        <div className="pm-modal-icon"><Share2 size={21} /></div><h2>Compartilhar o cofre</h2><p>No celular e fora de casa, prefira o endereço HTTPS criado pelo Tailscale. Na mesma rede Wi-Fi, o endereço local também funciona.</p>
        <div className="pm-url-list">{shareUrls.map((url) => <button key={url} onClick={() => void copyValue(url)}><Copy size={14} /><code>{url}</code><span>{connectionLabel(url)}</span></button>)}</div>
        <div className="pm-share-note"><Server size={14} />O aparelho host precisa continuar ligado e com o PentaMark aberto.</div>
        <button className="pm-modal-inline-action" onClick={() => { setShareOpen(false); setMobileSetupOpen(true); }}><Smartphone size={14} />Configurar celular e Tailscale</button>
        <button className="pm-modal-inline-action" onClick={() => { setShareOpen(false); setConnectOpen(true); }}><LogIn size={14} />Entrar em outro cofre</button>
      </div></div>}

      {connectOpen && <ConnectModal address={connectionAddress} setAddress={setConnectionAddress} deviceName={deviceName} setDeviceName={setDeviceName} onClose={() => setConnectOpen(false)} onConnect={connectToVault} />}
      {clientsOpen && <ClientsModal vault={vault} currentClientId={clientId} isHost={hostConfig.isHost} onPermission={(targetId, permission) => { void request("/api/permission", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: targetId, permission }) }).then(() => refreshState()).catch((error) => notify(error instanceof Error ? error.message : "Não deu para alterar a permissão")); }} onClose={() => setClientsOpen(false)} onConnect={() => { setClientsOpen(false); setConnectOpen(true); }} onRefresh={() => void refreshState()} />}
      {profileOpen && <ProfileModal name={deviceName} avatar={deviceAvatar} color={colorForClient(clientId)} onClose={() => setProfileOpen(false)} onSave={saveProfile} onError={notify} />}
      {conflictOpen && conflict && <ConflictModal conflict={conflict} onClose={() => setConflictOpen(false)} onUseServer={useServerVersion} onResolve={(value) => void resolveConflict(value)} />}
      {kanbanDialog && <KanbanEditorDialog dialog={kanbanDialog} onClose={() => setKanbanDialog(null)} />}
      {mobileSetupOpen && <MobileSetupModal urls={shareUrls} canInstall={Boolean(installPrompt)} installed={installedApp} onInstall={() => void installApp()} onClose={() => setMobileSetupOpen(false)} onNotify={notify} />}
      {settingsOpen && <SettingsModal appearance={appearance} setAppearance={setAppearance} config={hostConfig} setConfig={setHostConfig} urls={shareUrls} desktopVault={desktopVault} onChooseVault={() => void chooseVault()} onShowVault={() => void showVault()} onClose={() => setSettingsOpen(false)} onSave={() => void saveSettings()} onNotify={notify} />}
      {toast && <div className="pm-toast">{toast}</div>}
    </main>
  );
}
