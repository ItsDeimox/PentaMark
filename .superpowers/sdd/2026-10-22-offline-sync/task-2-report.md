# Task 2 report — host durable history and conditional coordinator

Status: **DONE_WITH_CONCERNS**. Implementation and fixture verification complete; limitations below are explicit handoff items, not a claim of power-loss certification or exact single-rename atomic replacement.

Requested base: `f8d2ef3`. Worked directly in `feat/offline-sync-pc-android`. Controller commits and concurrent Android/protocol changes were preserved. No subagents, reviewers, publishing, personal vault access, or network listeners were used. Only the explicitly listed Task 2 files and this report belong to this commit.

## Scope and implementation

- SQLite metadata uses WAL, synchronous=FULL, foreign_keys=ON. SQL avoids STRICT, RETURNING, and modern UPSERT syntax. Common tables exist: vaults, entries, versions, pending_ops, applied_ops, conflicts, file_intents, transfer_progress, change_log. The host does not use replica pending_ops as a network queue.
- Persistent installation/server identity and vault-path association live in `<dataRoot>/sync/host-registry.sqlite`; per-vault metadata and objects live in `<dataRoot>/sync/hosts/<vaultId>/`. The configured private store must be outside the vault. Relocating a vault to a different absolute root currently creates a new registry association; migration of that association is not implemented.
- Every observed file version is streamed into a SHA-256 object store before replacing its indexed version. History, conflict objects, tombstones, applied operation results, interrupted staging and journal trash are not automatically pruned.
- Mutations are serialized. A dedicated exclusive SQLite writer lock prevents simultaneous coordinators for the same host-store directory and is released by the OS after process termination. Use the same dataRoot for a given vault; separate dataRoots are not a distributed lock.
- `apply` validates runtime wire fields, vault identity, base revision, dependencies, path spelling/folding, native path collisions, link traversal, content hash/length, semantic kind, and byte limit. Null base is conditional creation. Incoming objects must already exist and verify. Reusing `(replicaId, opId)` for another canonical operation is blocked; a replay returns the stored result (`already-applied` for an applied result) without another history/change record.
- Incoming conflicts retain base/local/remote versions. External changes are captured by scans before base validation. Startup, snapshot opening, and the running server's five-second active cycle rescan; no watcher dependency. External rename becomes deletion/creation, without hash-based identity guessing.
- Each filesystem intent holds the old and desired versions and immutable operation. After successful filesystem work, entry/version/change-log/applied-op writes and intent removal commit together. Startup recovers intents before rescanning or accepting writes. Unexpected disk state becomes conflict; recoverable I/O errors block writes without discarding intent or objects.
- The legacy adapter routes note writes, MCP write/move/delete, uploads, cleanup, note/folder/asset mutations, and boot migrations through the coordinator. Config writes stay private and outside sync. Legacy content revisions remain the first 20 hexadecimal SHA-256 characters; sync revisions are opaque UUIDs. Note PUT keeps 409/currentRevision and unchanged response behavior. Rejected legacy incoming content is retained too.
- Default note paths map to `notes/<notePath>` under the vault. Custom-vault note paths are directly relative to the vault. Assets and MCP paths always use vault-relative paths.
- Folder operations capture a child set once and apply conditional child operations. A new child causes non-empty rmdir conflict and remains on disk. No recursive unknown-child removal. Folder moves retain file IDs and directory IDs; local-only, freshly created destination scaffolds are adopted under journaled directory intents and their temporary identities tombstoned. Wire operations cannot use this scaffold-adoption exception to merge arbitrary directories.

## Task 3 integration contract (no routes wired)

Import `createHostService` from `local/sync/host-service.mjs` and await:

```js
const host = await createHostService({
  dataRoot, vaultRoot,
  maxFileBytes: 2 * 1024 * 1024 * 1024, // optional positive safe integer
});
```

`host.vaultId`, `host.serverId`, `host.epoch`, and `host.root` are available. `await host.hello()` returns `{protocol:1,vaultId,serverId,epoch,maxFileBytes,chunkBytes:1048576}`. The server supplies its configured upload limit at initialization. Changing that config at runtime does not change the existing host instance's limit; recreate it or add a deliberate limit-update interface if needed.

| Method | Contract |
| --- | --- |
| `recover(): Promise<void>` | Recover all outstanding file intents; rejects if recovery cannot safely finish. |
| `rescan(): Promise<void>` | Recover, then capture observed versions/deletions. |
| `apply(operation): Promise<ApplyResult>` | One canonical wire operation; serializes/revalidates; missing blob/dependency or I/O failure returns blocked. Conflicts and successful results are durable. |
| `openSnapshot(): Promise<SnapshotPage>` | Rescans and returns a detached complete entry array including tombstones, random snapshotToken, epoch/sequence atCursor, pageCursor:null. No bytes in JSON. |
| `readChanges(cursor, limit=100): Promise<ChangesPage>` | Null starts at this epoch's zero. Returns ordered version records, preserving repeated versions of an entry. Limits 1..10000. Exact sequence arithmetic uses BigInt internally and strings on wire. Wrong epoch, malformed, out-of-range or future cursor rejects. |
| `objects.path(hash): string` | Validates SHA-256 hex and returns private immutable-object filename. Use native streaming/read ranges; never expose the private root as a static directory. |
| `objects.verify({blobHash,byteLength}): Promise<void>` | Streams actual object bytes and checks hash/length. |
| `objects.put(bytesOrAsyncIterable): Promise<BlobRef>` | Streams to a unique temporary file, syncs it and publishes the hash-addressed object. Does not accept a claimed hash; compare returned ref with the transfer's expected ref. |
| `objects.capture(fullPath): Promise<BlobRef>` | Native streaming capture; intended for trusted coordinator/native callers, not unchecked wire paths. |
| `history(entryId): EntryVersion[]` | Detached version history ordered by insertion. |
| `pendingIntents(): object[]` | Detached durable intent records, useful for diagnostics/native validation. |
| `close(): Promise<void>` | Drains serialized work, closes metadata and writer-lock connections; idempotent. |

**Snapshot ownership:** openSnapshot materializes a consistent entry list/cursor under the coordinator, but does not retain/persist token pagination state. Task 3 should pin/cache that returned list under its token and serve pages from that list, not rescan for each page. Objects/history are retained, so referenced blobs remain available. Handle expired/unknown tokens explicitly.

**Cursor format:** `<epoch UUID>:<decimal sequence>`. Keep it opaque to clients; do not convert sequence strings through Number. The tested sequence `9007199254740993` survives exactly.

**Transfer coupling:** this task provides verified immutable-object ingestion and lookup, not upload-resume sessions, HTTP ranges, batch route permission checks, or response pagination. The route worker owns those. `transfer_progress` is available but not used by this task. Validate transfer limits before accepting data; `objects.put` itself is a storage primitive rather than a policy limiter. `apply` enforces maxFileBytes again. Protocol authentication, viewer/editor semantic permissions and sync-side lockEditedNotes enforcement remain Task 3 responsibilities, as directed by the controller.

The existing server still performs its legacy permission/lock checks. It exports `initializeVaultHost`, `closeVaultHost`, `requestHandler`, `mcpBridge`, and `cleanupUnusedAssets` for in-process integration/lifecycle use. Importing the module does not start a listener; direct execution still starts the existing server. Task 3 must reuse the initialized host rather than open a second writer.

## Task 4 reuse

`database.mjs` exports `openDatabase`, synchronous `transaction`, and `acquireWriter`; `objects.mjs` exports `createObjectStore`, `hashFile`, `syncDirectory`; `file-journal.mjs` exports `applyFileIntent` and `matches`; `scan.mjs` exports `scanVault`; `paths.mjs` exports lexical folding, public-path validation, native path checks and exists. The file journal accepts `{vaultRoot,objects,intent,interrupt}`; intent carries `{intentId,operation,before,desired}` and optional internal scaffold metadata.

Named interruption callbacks are `after-object`, `after-intent`, `before-rename`, `after-rename`, `before-commit`. The four required crash boundaries are exercised for put/delete by thrown interruption plus reopen; abrupt child-process exit with SQLite still open is also tested at all four for put. `before-rename` additionally injects EACCES/ENOSPC/EPERM. Callbacks are dependency injection at transaction boundaries, not a test-only reset API.

## RED/GREEN evidence

1. Initial focused RED: **0 pass / 15 fail**. Every failure was the explicit assertion that the durable coordinator was missing, not a module-import error.
2. First implementation GREEN: **15/15** outside the Windows app sandbox. The sandbox's real hard-link operation failed EPERM; the same isolated fixture command passed after execution escalation. No permissions workaround touched personal paths.
3. Legacy/folder adapter RED: **18 pass / 3 fail**, missing `mutate`; subsequent GREEN **21/21**.
4. Directory identity RED: moved folder retained old path under its original ID; fixed with journaled scaffold adoption.
5. Three native edge-case RED failures: case-only file move returned blocked, second coordinator was allowed, identical external creation was incorrectly claimed as applied. Fixed; subsequent **29/29**.
6. Legacy API retention RED: stale submitted bytes were missing (ENOENT). Removed the early rejection that bypassed the coordinator; kept legacy response shape and retained incoming bytes.
7. Actual Windows FileShare.None test RED exposed an unhandled EBUSY read-stream error. Lazy stream creation now returns blocked through the coordinator and retries after the fixture lock releases. Subsequent **32/32**.
8. Hello RED: missing route-facing method; implemented identity/limits and tested enforcement. A final empty-directory casing regression initially confirmed a missing directory; fixed native alias handling and reran focused verification.

Final verification with supplied **Node 24.19.0**:

- `node --test tests/sync-host-store.test.mjs tests/sync-reconcile.test.mjs`: **101 pass, 0 fail, 0 skip** (34 host + 67 existing shared-contract tests).
- `pnpm test:unit`: **181 pass, 0 fail, 0 skip**. Ran the existing suite once, including its inert native Windows updater fixtures and the controller's profile-isolation tests. The last directory-alias-only change was followed by the complete focused suite; the unrelated unit suite was not repeated.
- `node --check local/server.mjs`: pass.
- `git diff --check`: pass; scoped diff check also passed after the final change.

The tests use real SQLite databases and temporary files. Host API/MCP/upload/cleanup tests call handlers in-process without network listeners. A PowerShell helper holds only a generated fixture file with FileShare.None; it exits after releasing that handle. Abrupt-exit children execute only generated fixture operations. Test fixtures are removed afterward; retained journal/history behavior is asserted before cleanup.

## Concerns and limits requiring follow-up

1. **Single-rename atomic replacement is not fully implemented.** To avoid overwriting an external writer, the journal renames old bytes into same-volume hidden trash, then atomically publishes a synced staging file with a no-replace hard link. There is a recoverable interval where the working pathname is absent. Complete old/new objects and intent survive; tests recover this workflow. This intentionally favors no-clobber preservation over falsely claiming compare-and-swap guarantees from ordinary Node rename. It differs from the spec's literal single atomic replacement wording. A Windows native primitive/strategy decision is required before claiming that stronger guarantee.
2. **Power loss is not certified.** SQLite FULL and file fsync are used; Windows directory fsync errors for unsupported directory handles are tolerated explicitly. Process interruption tests are not power-cut tests. Hard-link-capable same-volume storage is required; unsupported filesystems block instead of falling back to destructive replacement. Native Task 4 should validate filesystem/platform guarantees and portable paths.
3. **Folder batches can partially complete.** Each child intent/result is durable, identities and all bytes are retained, and unknown/non-empty children remain visible. The entire legacy folder request is not itself a persisted resumable batch; after a mid-batch crash or conflict, completed children remain completed and remaining source/destination entries need review/retry. Case-only file moves and empty wire-directory moves are tested; case-only legacy folder moves through the scaffold adapter may return a conservative collision instead of completing.
4. **Filesystem race boundary:** native path components are checked for links before use and captured file contents are revalidated, but Node path APIs do not provide handle-relative, race-proof traversal against a hostile process replacing a directory/junction during the operation. Static symlink/junction escape is tested and blocked. Do not describe this as an adversarial filesystem sandbox.
5. **Scan cost/canonical names:** scans stream all visible files and stop on errors rather than inferring deletions from a partial scan. Non-NFC native spellings fail closed pending an explicit canonicalization policy; no silent rename occurs. Large vault scan optimization, disk-space management, and pruning are deliberately absent. The internal working journal retains staging/trash under `<vaultRoot>/.pentamark-sync/`; it is excluded from exposed vault scanning, while SQLite history/object metadata is outside the vault.
6. EACCES/ENOSPC/EPERM are injected at the filesystem transition boundary; the test does not fill a physical volume. The real sharing-lock test returns EBUSY while reading the locked current file before replacement. Both failure paths preserve original and incoming objects.

## Changed files owned by this task

- `local/sync/schema.sql`
- `local/sync/database.mjs`
- `local/sync/objects.mjs`
- `local/sync/file-journal.mjs`
- `local/sync/host-service.mjs`
- `local/sync/scan.mjs`
- `local/sync/paths.mjs` (focused dependency-free equivalent of shared normalizePath; every existing path/collision fixture is tested against it)
- `local/server.mjs`
- `tests/sync-host-store.test.mjs`
- `.superpowers/sdd/2026-10-22-offline-sync/task-2-report.md`

No protocol route/transfer files, Android files, desktop files, shared contracts, package files, or other workers' tests are part of this commit.
