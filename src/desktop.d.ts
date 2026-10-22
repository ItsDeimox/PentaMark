type DesktopSyncPayloads = {
  open: import('./features/sync/contracts').ReplicaProfile;
  configure: { offlineEnabled: boolean; mode: import('./features/sync/contracts').SyncMode };
  request: { url: string; method: string; body?: unknown };
  snapshot: Record<string, never>;
  preparePending: { limit: number };
  persistIncoming: import('./features/sync/contracts').IncomingBatch;
  confirm: import('./features/sync/contracts').ApplyResult;
  resolve: import('./features/sync/contracts').ConflictResolution;
  completeCycle: { expectedCursor: string; expectedEpoch: string };
  discover: { origin: string };
  rebind: { origin: string };
  history: { entryId: string };
  readVersion: { version: import('./features/sync/contracts').EntryVersion };
  mediaUrl: { entryId: string };
  exportVersion: { blob: import('./features/sync/contracts').BlobRef };
  exportReplica: Record<string, never>;
  exportRecovery: { profile: import('./features/sync/contracts').ReplicaProfile };
  importDocument: { path: string };
  handshake: { profile: import('./features/sync/contracts').ReplicaProfile };
  remoteSnapshot: { snapshotToken?: string; cursor?: string };
  changes: { cursor: string; limit: number };
  apply: { operations: import('./features/sync/contracts').Operation[] };
  downloadBlob: { blob: import('./features/sync/contracts').BlobRef; offset: number };
  uploadBlob: { blob: import('./features/sync/contracts').BlobRef; offset: number };
};
type DesktopSyncCommand = { [M in keyof DesktopSyncPayloads]: {
  requestId: string; replicaId: string; method: M; payload: DesktopSyncPayloads[M];
} }[keyof DesktopSyncPayloads];
type DesktopSyncResponse = { requestId: string; replicaId: string } &
  ({ ok: true; value: unknown } | { ok: false; error: string });
interface Window {
  pentaMarkDesktop?: {
    sync: { invoke(command: DesktopSyncCommand): Promise<DesktopSyncResponse> };
    tailscaleStatus(): Promise<{installed:boolean;connected:boolean;configured:boolean;deviceName?:string;address?:string;error?:string}>;
    saveTailscaleKey(key:string): Promise<{installed:boolean;connected:boolean;configured:boolean;deviceName?:string;address?:string;error?:string}>;
    forgetTailscaleKey(): Promise<void>;
    createTailscaleInvite(): Promise<{inviteUrl:string;address:string;deviceName?:string}>;
    openTailscaleSetup(step:'install'|'login'|'keys'):Promise<void>;
    consumeInvitation():Promise<string|null>;
    onInvitation(listener:(url:string)=>void):()=>void;
    openTailscaleInvite(url:string):Promise<void>;
    getUpdateStatus():Promise<import('./platform/updates').UpdateStatus>;
    checkForUpdates():Promise<import('./platform/updates').UpdateStatus>;
    downloadUpdate():Promise<import('./platform/updates').UpdateStatus>;
    installUpdate():Promise<import('./platform/updates').UpdateStatus>;
    getProfile(): Promise<{ name: string; avatar: string }>;
    setProfile(profile: { name: string; avatar: string }): Promise<{ ok: boolean; error?: string }>;
    getVault(): Promise<{ ok: boolean; path?: string; name?: string; custom?: boolean; error?: string }>;
    chooseVault(): Promise<{ ok: boolean; canceled?: boolean; path?: string; restarting?: boolean; error?: string }>;
    showVault(): Promise<{ ok: boolean; error?: string }>;
    openInFolder(kind: "note" | "folder" | "asset", path: string): Promise<{ ok: boolean; error?: string }>;
    resolveItemPath(kind: "note" | "folder" | "asset", path: string): Promise<{ ok: boolean; relative?: string; absolute?: string; error?: string }>;
  };
}
