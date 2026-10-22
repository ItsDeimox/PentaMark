# Task 6 — shared engine / native transport

Status: BLOCKED on one shared-planner regression pending controller correction; owned implementation checkpoint is ready for review. No adapter/platform/server/desktop/Android/UI/package/contracts edits by Task 6. No subagents, personal vault, installed app, publication or external host used.

## Delivered integration API

Native constructor:

```js
const remote = await createNativeSyncTransport({
  profile, // trusted persisted profile, immutable origin/vault/server/replica binding
  objects: service.objects,
  stagingRoot: join(service.root, 'staging'),
  headers: () => ({ 'X-PentaMark-Client': clientId }), // native auth, optional
});
```

Expose only RemotePort methods through validated native IPC. No renderer-supplied origin, filesystem paths or headers. handshake(profile) verifies the bound identity; snapshot(token?, cursor?), changes(cursor, limit), apply(operations), downloadBlob(ref, offset), uploadBlob(ref, offset) operate against that same binding. JSON/control and individual transfer segments capped at 1 MiB; object bytes stay native.

`createSyncEngine({replica, remote, clock})` exposes `start(): Promise<void>`, `stop(): void`, `synchronizeNow(): Promise<void>`, `setMode(mode): Promise<void>`, `onStatus(listener): () => void`, `localChanged(): void`, `resume(): Promise<void>`, `reconnect(): Promise<void>`. start/resume/reconnect never initiate content in manual mode after confirmed initial copy. resume sets running=true. localChanged debounces automatic work by one second. Retries use 1/2/4/8/16/30 seconds with ±20% jitter capped at 30 seconds; successful automatic cycles poll every 30 seconds for remote-only changes. stop cancels scheduling and prevents subsequent requests at async boundaries; in-flight apply results are still durably acknowledged. Immediate socket cancellation is not exposed by RemotePort and remains a native lifecycle integration concern.

`useSyncController(engine: SyncEngine | null)` subscribes to status and starts/stops the stable engine in an effect, returning `SyncStatus | null`. Task 7 first opens the replica offline, constructs stable ports/engine, passes it to the hook, and routes durable local-save notifications, resume and reconnect to the engine methods. Controller is wiring platform/UI; no such files belong to this checkpoint. Immediate stop/start (including effect restart) resumes the cancelled startup cycle.

`discoverNativeSyncOrigin(origin)` performs only GET `/api/sync/v1/hello` before a profile exists. Canonical bare 100.64.0.0/10 HTTP(S) or HTTPS *.ts.net only; no credentials/path/query/fragment/port 0, no redirects, bounded JSON, UUID vault/server identity and protocol/chunk/size/epoch validation. Optional native-only dependencies `{headers, timeoutMs, fetchImpl}` are not renderer IPC payload. Discovery tests validate tailnet URL construction and forward through an injected fetch dependency to real temporary loopback HTTP; no real tailnet is contacted. Bound transport uses the trusted saved origin and does not accept arbitrary URLs per request. Default request timeout is 30 seconds.

## Approved contract coordination

Controller approved and edited shared declarations/spec: new adapters emit read-only `preparedOperations: Operation[]`, and implement `completeCycle({expectedCursor, expectedEpoch}): Promise<SyncStatus>`. Native transaction requires matching cursor/epoch, offlineEnabled, completed copy, zero ALL dirty/unprepared/prepared state, zero conflicts; stale input rejects `stale-local-head`. Success uses native clock for durable lastSuccessfulSync. No generation field is required because guards inspect all dirty state atomically. Timestamp means caught up through the observed remote cursor, never a guarantee about later host writes. EngineReplica is a structural required-capability type; runtime fails closed for missing hooks. The earlier generation/completeSync proposal was superseded and is NOT an integration requirement.

Existing operations replay before change reception without fresh preparation. When a manifest is needed (including changed epoch), the engine reads it fully before replay, defers prepared entries, then represents newer confirmed ACKs/conflicts before committing the final manifest cursor. Missing old entries become `planEntry(base,local,null)` conflicts. Incomplete stable manifests are reread from cursor zero after restart to reconstruct membership; native verified objects are reused. A 410 expired token restarts once with a fresh manifest. Incoming pages coalesce latest versions per entry, fetch verified native objects, retry stale-local-head up to eight times with a fresh snapshot, and persist the entire page before cursor advancement. Independent outgoing failures keep immutable operations and do not prevent other outgoing files from attempting synchronization.

The engine imports `planEntry` and `normalizePath`; it does not implement another reconciliation algorithm. Cross-entry normalized-path candidates are supplied to that shared planner. Native guards remain authoritative.

## Owned files

- src/features/sync/engine.ts
- src/features/sync/useSyncController.ts
- local/sync/transport.mjs
- tests/sync-engine.test.mjs
- tests/sync-client-transport.test.mjs
- .superpowers/sdd/2026-10-22-offline-sync/task-6-report.md

## RED/GREEN evidence

- Node 24.19.0 PATH: `C:/Users/kevin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`. Commands run from repository root; native fixtures use authorized escalated execution for local loopback/hardlinks.
- Initial transport RED: `node --test tests/sync-client-transport.test.mjs`: 7 assertion failures for absent factory; no import-error substitute. First implementation 3 pass/4 fail exposed Windows append-handle ftruncate EPERM. Changed staging handles to r+/wx+; 7/7 GREEN.
- Additional transport RED: `node --test --test-name-pattern='queued transfer|truncated HTTP' tests/sync-client-transport.test.mjs`: queued mutable reference failed; interrupted-body case passed. Capture blob refs before queuing; subsequent 9/9 GREEN.
- Discovery RED: `node --test --test-name-pattern='discovery' tests/sync-client-transport.test.mjs`: 3 assertion failures for absent export. Implemented fixed hello and native boundaries; all 12 transport cases GREEN in combined run.
- Initial engine RED: `node --test tests/sync-engine.test.mjs`: 11 assertion failures for absent factory. Implementation GREEN 11/11 with injected fake clock, manual isolation, capped retries over simulated seven offline days, debounce/single flight, restart/lost ACK, edit B during ACK A, mode change during apply, stale-head retry, page persistence failure, identity/epoch and completion race.
- Further engine RED: `node --test --test-name-pattern='omission|restart resumes|create edit' tests/sync-engine.test.mjs`: 2 fail/1 pass. Missing new-epoch manifest entry incorrectly uploaded and immediate stop/start lost restart. Fixed both; GREEN 14/14.
- Epoch prepared replay RED: `node --test --test-name-pattern='epoch recovery' tests/sync-engine.test.mjs`: failed 0 sends vs expected 2. Full-manifest-before-replay implementation GREEN 15/15.
- Actual native-pair tests use HostService, SQLite ReplicaService, actual HTTP routes and this transport with temp userData/vaults. Lost committed create response, native-store close/reopen, immutable replay then conditional deletion, and unprepared create/edit/rename/delete suppression passed. This is store reopen, NOT OS process-kill certification.
- Name-conflict RED: `node --test --test-name-pattern='real native pair' tests/sync-engine.test.mjs`: 2 pass/1 fail (no preserved conflict). Supplied cross-entry collision candidate to shared planner; engine GREEN 18/18.
- Combined checkpoint: `node --test tests/sync-client-transport.test.mjs tests/sync-engine.test.mjs`: **30 pass, 0 fail, 0 skip**. Includes actual 33 MiB + 10-byte upload/download with every request <=1 MiB, resume after short staged tail/recreation, final hash verification, empty objects, valid ahead-of-request replay and invalid progress, interrupted body rollback, JSON/redirect/identity limits.
- `npm.cmd run test:unit`: **181 pass, 0 fail, 0 skip**, run once for checkpoint. `npm.cmd run typecheck`: **pass**, run once. These completed before the last planner edge-case regression was added; no owned implementation changed afterward at this point.
- Final edge-case regression: `node --test --test-name-pattern='remote edit then revert' tests/sync-engine.test.mjs`: **1 fail** with `unrepresented-remote-change`. Host A→B→A updates remote revision but shared planner emits none; native exact-base guard rejects it. Controller notified to correct shared planner to emit converged for identical local/remote state with a different remote revision. No local fork or native weakening was made. Checkpoint remains pending this correction and focused rerun.
- Final combined rerun of both owned suites: **31 tests, 30 pass, 1 fail, 0 skip**; only the above shared-planner regression fails. `git diff --check` for owned source/test paths passed. No test skipped or changed to assert the blocked behavior.

## Remaining integration/verification concerns

- Controller/native owners must land completeCycle/preparedOperations and the closed RemotePort IPC/plugin bindings alongside this checkpoint. Tests consumed their concurrent checkout implementations; Task 6 does not commit their files.
- Renderer never handles blob bytes. Upload verifies the immutable source before each chunk; this bounds memory but repeats full-object I/O. Download staging persists aligned segments and verifies final hash/length before object-store publication. No physical power-loss certification or hostile same-user filesystem-race claim.
- stop cancels future work at async boundaries; an issued native request may run until completion/30-second timeout. Immediate abort requires a lifecycle extension to the reviewed RemotePort; Android already has native socket-pause machinery, but the common port does not expose it.
- Shared planner revision-refresh edge case above is a concrete integration blocker until controller correction. Native Android instrumentation, packaged Windows/APK and real UI/IPC end-to-end acceptance remain controller-owned gates; they were not run here.
