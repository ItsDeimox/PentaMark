# Task 4 — opaque Windows future-schema recovery export

Implemented only in replica IPC/validation/recovery, desktop sync bridge/declaration, and native unit tests. No host/server, Android, UI, main/startup, schema, dependency, or transport changes. No publication.

## Parent binding

Closed command: `{requestId, replicaId, method: 'exportRecovery', payload: {profile}}`, using the full existing ReplicaProfile shape. No renderer filesystem path, URL-to-fetch, JS, or extra keys are accepted. The profile replicaId must match the envelope.

The native IPC handler remembers a profile only when its `open` failed with exactly `unsupported-schema`. Export requires all profile fields to match that failed request and no active service for the replica. A new open attempt clears the authorization; successful open never authorizes recovery. A concurrent recovery blocks opening the same replica. Authorization is process-local, not persisted or claimed as a decoded future profile.

The existing Electron `pickExportDirectory` callback is reused. Trusted frame/child context is checked again after the picker. Cancellation returns `{cancelled:true}` without dispatching export. Success returns `{cancelled:false, format:'pentamark-opaque-replica-v1', directoryName}`. The renderer never receives file bytes. Recovery alone gets an 11-minute IPC timeout to accommodate the bounded native export. Parent UI should label this as an **opaque recovery folder**, not a converted vault or guaranteed-restorable future format.

## Snapshot and safety

- Derive the sole source from userData plus validated vault/replica UUIDs. Require the existing writer.sqlite; acquire the shared exclusive writer lock. Do not open replica.sqlite, migrate, query, checkpoint, or interpret its schema in the export helper.
- Copy every ordinary file and directory beneath that private replica root, including unknown files, SQLite/WAL/SHM, objects, staging, working files, history, and writer.sqlite. Source files are opened read-only; no source deletion/overwrite. Quiescence relies on native writers honoring the existing writer-lock convention.
- Reject destinations inside userData, UNC paths, links/junctions, nonregular files, and realpath escapes. Check ancestors too. Windows fixed-system PowerShell checks ReparsePoint attributes without following them, including non-symlink reparse tags. Paths are passed through dedicated environment values, never interpolated into executable script. Missing/failed attribute validation fails closed.
- Bound traversal to 10,000 entries, 64 levels, 16 GiB, and a 10-minute checked work budget; use streaming directory enumeration and a reusable 256 KiB file buffer. Individual PowerShell checks time out after 30 seconds. Filesystem calls are native operations; the deadline is checked between them.
- Compare file identity/size/timestamps before and after each copy and re-inventory under the writer lock before publication. Record copied-byte SHA-256 values in an uninterpreted manifest. Flush/close destination files and manifest and release the writer before publishing success.
- Output starts as a uniquely named `PentaMark-opaque-recovery-<UUID>.partial/`, with `replica/` plus `manifest.json`. Only completed output is renamed without `.partial`. Failures never return success, never replace an existing nonempty destination, and may leave clearly marked partial data for manual inspection. Originals remain intact. No automatic cleanup/delete or restore/conversion promise is made.

## RED/GREEN evidence

Node 24.19.0, disposable files/real SQLite only. Initial `node --test tests/sync-recovery-export.test.mjs`: **0/3 RED**, missing closed command (`invalid-method`). First sandbox verification hit Windows EPERM for junction creation/directory rename; these are fixture operations, so subsequent native runs used approved unsandboxed execution without accessing personal vaults.

- Recovery suite: **6/6 GREEN**. Future DB bytes unchanged; exact pending/history/WAL/SHM/writer copies; missing context/wrong profile/wrong replica/active service rejected; writer contention; renderer path rejection; native-picker cancellation/context change; private/junction/escape rejection; depth bound; failed publication preserves partial bytes and existing sentinel, releases writer, and leaves source unchanged.
- `node --test tests/sync-recovery-export.test.mjs tests/sync-desktop-store.test.mjs tests/sync-client-transport.test.mjs`: **57/57 GREEN**.
- Current `pnpm test:unit` (parent added chained sync suite): **181/181 general + 285/285 sync GREEN**, including desktop-data-root/updater and recovery tests.
- `pnpm typecheck`: **GREEN**. Scoped `git diff --check`: **GREEN**, normal Windows line-ending warnings only.

Independent recovery review and parent UI button wiring remain acceptance gates. Existing native folder-picker wiring is reused; no new server integration hook is required.
