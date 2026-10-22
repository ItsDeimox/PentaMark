# Task 4 — Windows durable replica / closed IPC

Status: **DONE_WITH_CONCERNS — core checkpoint ready for review; not end-to-end enabled.**

Requested base `6b2ae00`; shared checkout contains interleaved controller/Android/protocol work. Only the owned Task 4 paths and this report are committed. No server edits, transport implementation, subagents, personal vault access, publishing, or app installation. Preserved the isolated userData selection from `3a4b630`.

## Implemented

- `createReplicaService({userData, profile, interrupt?})`: `<userData>/sync/replicas/<vaultId>/<replicaId>/{working,objects,staging}` plus SQLite metadata. Imports the shared database, objects, paths and corrected file journal; does not fork them. Depends on the host review's new `directoryIdentity` and `verifyFileIntent` exports currently in the shared checkout.
- WAL/FULL metadata; exclusive native writer; serialized API reads/writes; retained immutable version objects/history. A durable file intent contains the entire next replica state and constituent file intents. All incoming heads are checked before disk changes; cursor/state commit together after verified file work. Recovery precedes API operations.
- Local edits stay independent from immutable prepared operations. Prepared A survives restart and editing B; ACK A advances the base without clearing B. Duplicate ACK does not clear a newer operation. Create/delete before preparation collapses; prepared operations remain immutable.
- Initial-copy pages persist progress and entries, keep the confirmed cursor unchanged until the final page, and never mark a partial cycle successful. Snapshot always includes status/epoch/initialCopy/conflicts. Unknown/new copies are incomplete.
- Stored profile identity (including origin) cannot be silently retargeted, and snapshots are detached. Configuration changes use configure.
- Conflict base/local/remote objects and archived conflict rows remain retained after resolution. Resolution checks expected local head and remote revision. Typed stale merges are persisted as objects plus a receipt in `replica_resolutions` before returning stale-conflict-resolution.
- Local editor requests support state/config/note CRUD, empty-folder operations, asset rename/delete, and POST presence as a no-op. Notes create durable parent directories; prepared child operations depend on prepared parents. `locks:[]`, string folders, NoteMeta/AssetMeta, and complete HostConfig fields match `src/domain/types.ts` and server responses. Media is not fetched from renderer-supplied URLs.
- Main/preload expose `window.pentaMarkDesktop.sync.invoke`; main uses the existing trustedFrame guard. Parent spawns the local server with an IPC descriptor and the selected userData environment. Package adds only `desktop/sync-ipc.cjs` to build.files. Validation is shared from packaged `local/sync/replica-validation.mjs`.
- `installReplicaIpc` exposes explicit child-installation and media hooks. Loopback plus a fresh random session capability protects media; routes address replica/entry IDs, serve verified objects, set no-store/nosniff, and prevent active-document execution. No HTTP replica-management routes or arbitrary JS/path/URL commands.

## Stable adapter contract / required wiring

Command: `{requestId: UUID, replicaId: UUID, method, payload}`. Response: `{requestId, replicaId, ok:true, value}` or `{requestId, replicaId, ok:false, error}`. Renderer boundary validation rejects malformed commands; native errors are sanitized. Duplicate simultaneous request IDs reject. No implicit method dispatch.

| Method | Payload |
| --- | --- |
| open | ReplicaProfile; replicaId must equal the envelope |
| configure | `{offlineEnabled, mode}` |
| request | `{url, method, body?}`; body is an object, never JSON source/JS |
| snapshot | `{}` |
| preparePending | `{limit}` (1–100) |
| persistIncoming | IncomingBatch |
| confirm | ApplyResult |
| resolve | ConflictResolution |

Absent-entry expectedLocalHead is `''`. Known heads come from snapshot and are opaque. Initial copy must supply `initialCopy:{snapshotToken,atCursor,pageCursor}`; non-manifest pages require a completed initial copy. All referenced blobs must already verify locally, including conflict result versions. One decision per entry per batch; repeated change-log versions must be reconciled in ordered batches/coalesced against a correct base by the engine. `none`/`push` cannot acknowledge an unrepresented remote version; they currently require exact stored base equality (including revision). A prepared operation blocks pull/convergence for its entry until its outcome is known.

Controller-owned server follow-up, **not performed here**:

```js
import { installReplicaIpc } from './sync/replica-ipc.mjs';
// Only in the Electron child: PENTAMARK_DESKTOP=1, process.send available.
const replicaIpc = installReplicaIpc({
  channel: process,
  userData: process.env.PENTAMARK_USER_DATA_DIR,
});
// Before public/static routing, await replicaIpc.handleMedia(req, res).
// If handled, return; failures must not fall through to static serving.
// On orderly shutdown, await replicaIpc.close().
```

Task 6 binding: `replicaIpc.getReplica(replicaId)` after open returns the existing service. Reuse `service.objects.put(asyncIterable)`, `verify(ref)`, `path(hash)` and `join(service.root,'staging')`. Paths are native-only. Transfer owns offset verification, hash validation, limits, authentication, cancellation and remote network calls. Do not open a second writer. The server must install IPC before main's readiness handshake is considered sync-ready.

Remote/bootstrap slot remains missing: add an explicit validated discovery command taking origin before a known profile exists, verify hello vaultId/serverId, then open. RemotePort methods are **not** currently accepted by this union. Controller/Task 6 must add the agreed explicit extension; no generic forwarding or arbitrary URL fetching. Same-origin address changes require verified identity and a deliberate persistence hook; ordinary open refuses retargeting.

Media native hooks: `mediaPath(replicaId,entryId)` returns a capability-relative URL; `handleMedia(req,res)` handles only that URL family. Renderer mediaURL/readVersion/history/export commands and native export picker are deferred to the scoped UI follow-up. Metadata and retained objects are present, but the current closed union cannot expose historic bytes to the UI. No media Range handling yet.

Android draft migration is outside this PC checkpoint. Do not migrate through ordinary PUT: the Android owner/controller must provide an idempotent native importDraft hook that checks verified origin/vault/server, retains unknown legacy bases as conflicts, and returns a durable receipt before deleting any old draft.

## RED/GREEN evidence

Runtime: supplied Node **24.19.0**, `C:/Users/kevin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`.

- `node --test tests/sync-desktop-store.test.mjs`: initial RED **0/12**, explicit missing factory/bridge assertions. Initial implementation GREEN **12/12** outside sandbox. Sandbox execution hit Windows hard-link EPERM in the shared object store; isolated-fixture escalation succeeded.
- Expanded RED **15 pass / 3 fail**: unrepresented change advanced cursor, missing parent directory/dependency, missing retained conflict row. Fixed; subsequent combined run **48/48** with `tests/desktop-data-root.test.mjs tests/desktop-updater.test.mjs`.
- Controller API regression RED: `node --test --test-name-pattern='editor state' tests/sync-desktop-store.test.mjs` failed with `state.locks.find is not a function`. Fixed locks, metadata/config shapes and no-op presence; full focused GREEN **19/19**.
- Real SQLite/files cover offline restart, immutable prepare, ACK A while B edited, whole-batch stale rejection, durable initial pagination, interruptions after-object/after-intent/after-rename/before-commit, abrupt child exit after-rename, and a manually truncated desired staging fixture. Recovery asserts complete actual working bytes and verifies the referenced object. Media test runs the handler against a stream response without opening a network listener, rejects non-loopback/wrong capability/traversal, and asserts exact served bytes.
- `pnpm typecheck`: **pass**.
- `pnpm test:unit`: **180 pass / 1 fail**. Existing `reverification and original-path validation prevent installation after tampering` failed at `tests/desktop-updater.test.mjs:257`, `background action did not settle` (settle helper line 61). Isolated rerun `node --test --test-name-pattern='reverification and original-path' tests/desktop-updater.test.mjs`: **1/1 pass**. Do not describe the full unit run as green. No updater code/test changed.
- `git diff --check`: pass, with normal unrelated CRLF warnings in interleaved files.

## Review concerns / explicit gates

1. Server installation and media routing are deliberately unwired pending controller authorization after host/protocol review; current desktop calls time out until installed. Remote transport/discovery, UI context routing, historic-byte/export access, and end-to-end native acceptance remain separate gates.
2. Shared corrected journal exports must land together with this checkpoint. No-clobber publication has the documented recoverable pathname gap. API reads serialize behind writes. Tests prove process recovery, not power-cut durability or protection against a hostile local filesystem process.
3. Nonempty-folder rename/delete currently fail closed with `folder-not-empty`; durable child-batch decomposition is not implemented in this replica. Asset creation/import also needs a native streaming hook; JSON/base64 upload is intentionally absent. This checkpoint does not claim complete folder/attachment editing parity.
4. Native status is conservative: `lastSuccessfulSync` remains null and phase never claims idle/success. Task 6 needs an explicit guarded cycle-completion/status integration if native status must persist successful catch-up timestamps. No unknown state is reported synced.
5. Epoch changes require a new manifest. Exact-equality no-op validation, one-entry-per-batch, missing remote tombstone conflict choices, and cross-entry path collisions need protocol/engine adapter review; unsupported cases block with retained data rather than overwrite. A filesystem recovery failure retains its intent and blocks service until it can recover; there is no recovery/export UX in this checkpoint.
6. No profile listing/bootstrap persistence UI yet. Opening a known saved profile works offline; the controller must supply that profile. Preview/export/history commands may be added after this checkpoint, as requested.
