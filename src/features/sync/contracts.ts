/** Wire contracts shared by the desktop and Android replica implementations. */
export type SyncMode = 'automatic' | 'manual';
export interface ReplicaProfile {
  vaultId: string;
  serverId: string;
  replicaId: string;
  origin: string;
  offlineEnabled: boolean;
  mode: SyncMode;
}
export type EntryKind = 'note' | 'asset' | 'directory';
export interface EntryVersion {
  entryId: string;
  kind: EntryKind;
  path: string;
  /** Opaque, required for every known version; never ordered as a clock. */
  revision: string;
  /** Null only for directories and tombstones. */
  blobHash: string | null;
  /** Nonnegative safe integer; validated at the native/wire boundary. */
  byteLength: number;
  deleted: boolean;
}
export interface Operation {
  vaultId: string;
  replicaId: string;
  opId: string;
  entryId: string;
  kind: 'put' | 'move' | 'delete' | 'mkdir' | 'rmdir';
  /** Null is conditional creation, never permission to overwrite. */
  baseRevision: string | null;
  after: { path: string; kind: EntryKind; blobHash: string | null; byteLength: number } | null;
  dependsOn: string[];
}
export interface Conflict {
  conflictId: string;
  entryId: string;
  base: EntryVersion | null;
  local: EntryVersion | null;
  remote: EntryVersion | null;
  reason: string;
}
export interface SyncStatus {
  phase: 'initial-copy' | 'offline' | 'idle' | 'waiting-manual' | 'syncing' | 'conflicts' | 'blocked';
  localSaved: boolean;
  pendingCount: number;
  conflictCount: number;
  snapshotComplete: boolean;
  /** ISO timestamp; partial cycles must not update it. */
  lastSuccessfulSync: string | null;
  errorCode: string | null;
}
export interface ApiResponse { status: number; data: Record<string, unknown> }
export interface BlobRef { blobHash: string; byteLength: number }
export interface Handshake {
  protocol: 1;
  vaultId: string;
  serverId: string;
  epoch: string;
  maxFileBytes: number;
  chunkBytes: 1048576;
}
export interface SnapshotPage {
  snapshotToken: string;
  atCursor: string;
  entries: EntryVersion[];
  pageCursor: string | null;
}
export interface ChangesPage { fromCursor: string; nextCursor: string; entries: EntryVersion[] }
export interface ReplicaSnapshot {
  profile: ReplicaProfile;
  cursor: string | null;
  entries: { base: EntryVersion | null; local: EntryVersion | null; localHead: string }[];
}
/** An advisory decision: application still requires revision/head checks. */
export interface ReconcileDecision {
  action: 'none' | 'push' | 'pull' | 'converged' | 'conflict';
  reason: string;
  base: EntryVersion | null;
  local: EntryVersion | null;
  remote: EntryVersion | null;
}
/** path preserves NFC spelling; pathKey uses NFC -> lower -> upper -> lower -> NFC.
 * Casing is locale-independent; Java must use Locale.ROOT for every casing step.
 * This conservative collision key never replaces native destination checks.
 */
export type PathResult = { ok: true; path: string; pathKey: string }
  | { ok: false; code: 'invalid-path' | 'reserved-name' };
export interface IncomingBatch {
  nextCursor: string;
  items: { decision: ReconcileDecision; expectedLocalHead: string }[];
}
export interface ApplyResult {
  opId: string;
  status: 'applied' | 'already-applied' | 'conflict' | 'blocked';
  confirmed?: EntryVersion;
  conflict?: Conflict;
  errorCode?: string;
}
export interface TransferProgress { blobHash: string; verifiedBytes: number; complete: boolean }
export interface ConflictResolution {
  conflictId: string;
  expectedRemoteRevision: string | null;
  expectedLocalHead: string;
  choice: 'keep-both' | 'local' | 'remote' | 'merged';
  mergedContent?: string;
}
export interface ReplicaPort {
  open(profile: ReplicaProfile): Promise<SyncStatus>;
  configure(config: { offlineEnabled: boolean; mode: SyncMode }): Promise<SyncStatus>;
  request(url: string, method: string, body?: unknown): Promise<ApiResponse>;
  snapshot(): Promise<ReplicaSnapshot>;
  preparePending(limit: number): Promise<Operation[]>;
  /** Require verified blobs; reject stale-local-head atomically without advancing cursor. */
  persistIncoming(batch: IncomingBatch): Promise<void>;
  confirm(result: ApplyResult): Promise<void>;
  resolve(input: ConflictResolution): Promise<void>;
}
/** Bound to the same replica; blobs stream to/from native staging, never JSON bytes. */
export interface RemotePort {
  handshake(profile: ReplicaProfile): Promise<Handshake>;
  snapshot(snapshotToken?: string, cursor?: string): Promise<SnapshotPage>;
  changes(cursor: string, limit: number): Promise<ChangesPage>;
  apply(operations: Operation[]): Promise<ApplyResult[]>;
  downloadBlob(blob: BlobRef, offset: number): Promise<TransferProgress>;
  uploadBlob(blob: BlobRef, offset: number): Promise<TransferProgress>;
}
export interface Scheduler {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
  random(): number;
}
