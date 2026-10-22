# Task 3 — protocol/transfer module handoff

Current status: SERVER INTEGRATION IMPLEMENTED AND REAL HTTP TESTS PASS; independent integration review pending. Controller explicitly handed server.mjs to Task 3 after Task 2 ee31fa0 approval and authorized installing the stable Task 4 IPC/media hook. Historical pending-integration notes below are superseded by the final handover section. No HostService/storage, replica-ipc, Android, desktop or UI edits by this task.

Owned files: local/sync/routes.mjs, local/sync/transfer.mjs, tests/sync-protocol.test.mjs, tests/sync-transfer.test.mjs, this report. Read starting base 3a4b630; Task 2 landed as 6b2ae00 during implementation, alongside unrelated controller/Android commits.

## Evidence (Node 24.19.0)

- Initial RED: 9/9 assertion failures, absent createSyncHandler. No import-error substitute.
- Additional RED: interrupted partial segment returned 409 instead of resuming; null snapshot input returned 503 instead of 400; dynamic advertised cap returned 10 while host allowed 8. Each fixed and rerun.
- Interoperability RED: Android snapshotToken parameter and Content-Range framing rejected; apply lacked the object envelope required by native JSON transport. Fixed in owned files only.
- Final GREEN: `node --test tests/sync-protocol.test.mjs tests/sync-transfer.test.mjs tests/sync-host-store.test.mjs`: 48 pass, 0 fail, 0 skip (14 owned HTTP tests + 34 host tests). Includes existing in-process normal API/MCP/upload/cleanup coverage.
- `npm run test:unit`: 181 pass, 0 fail, 0 skip. No package script edits.
- All new HTTP tests mount the actual createSyncHandler on ephemeral 127.0.0.1 listeners with real HostService/SQLite and temporary vaults. Actual upload/download is 33 MiB + 10 bytes, streamed with incremental SHA-256, never a full-file buffer. Only individual segments/JSON are buffered, capped at 1 MiB.
- Initial sandbox execution encountered loopback EACCES and hard-link EPERM; authorized escalated execution passed. No personal vault, publication or subagents.
- Production server requestHandler has NOT yet been wired/tested against these protocol endpoints. Must add integrated HTTP tests after controller handover before calling Task 3 done.

## Wire details for adapters

- GET `/api/sync/v1/hello`: Handshake. Optional `X-Sync-Protocol`, `X-Sync-Vault-Id`, `X-Sync-Server-Id` mismatch returns 409. Unknown sync protocol fails closed; no legacy fallback or outbound renderer destination.
- POST `/snapshot`: `{limit?:1..100}` (default 100). GET `/snapshot?snapshotToken=...&cursor=...`; `token` alias also accepted. Returns SnapshotPage. Fixed manifest/cursor, 15-minute token TTL, capacity 32; expiration/restart returns 410 and requires new manifest. Objects remain immutable/retained by HostService.
- GET `/changes?cursor=...&limit=...`: rescan then readChanges; old epoch/invalid cursor returns 409. Cursor stays a string; no Number conversion.
- POST `/apply`: `{operations: Operation[]}` (raw array also accepted); response **`{results: ApplyResult[]}`**. Adapter unwraps results to satisfy RemotePort.apply. At most 100; invalid ops return explicit blocked results. All identity/dependency UUIDs, paths, kinds, sizes and hashes validated. Viewer mutations blocked, editor delete/rmdir blocked regardless of POST, note locks checked through mandatory callback. ACK follows awaited durable host.apply. Host retains conflict/idempotency/conditional-creation semantics.
- PUT `/blobs/<sha256>?offset=N`: binary body of exactly min(1 MiB,total-offset); canonical Android header `Content-Range: bytes N-END/TOTAL`, zero bytes `bytes */0`. Alternative `X-Sync-Byte-Length: TOTAL` accepted; if both supplied they must agree. Offsets aligned to 1 MiB. Response TransferProgress. Retry requires byte-identical existing segment. Staging survives handler/process restart; incomplete tail is truncated back to complete segment boundary on resume; final length/hash precede publication.
- GET blobs streams immutable object, supports ordinary/open-ended/suffix single Range (206), invalid range 416, missing object 404. No full-file buffering.

## Exact server wiring (controller permission required)

1. Import `createSyncHandler` from `./sync/routes.mjs`; maintain one `syncHandler` per initialized host (do not construct per request, which would discard snapshot tokens).
2. In initializeVaultHost, after host creation/ensureVault, assign:

```js
syncHandler = await createSyncHandler({
  host: hostService,
  maxFileBytes: () => Math.floor(Math.max(1, Number(config.maxUploadMB) || 2048) * 1024 * 1024),
  permission: requestPermission,
  authorizeOperation: async (req, operation, current) => {
    const clientId = clientIdFromRequest(req);
    for (const version of [current, operation.after]) {
      if (!version) continue;
      // Convert vault-relative protocol paths to NOTES_DIR-relative lock keys.
      const notePath = relative(NOTES_DIR, resolve(VAULT_DIR, version.path)).replaceAll('\\', '/');
      if (notePath === '..' || notePath.startsWith('../') || isAbsolute(notePath)) continue;
      if (lockedByOther(notePath, clientId)) return false;
      if (version.kind === 'directory') {
        if (notePath && folderLockedByOther(notePath, clientId)) return false;
        if (!notePath && config.lockEditedNotes && currentLocks().some(lock => lock.clientId !== clientId)) return false;
      }
    }
    return true;
  },
});
```

Add `relative`/`isAbsolute` imports if absent. Default vault protocol `notes/a.md` maps to lock `a.md`; custom-vault protocol `a.md` also maps to lock `a.md`. Check both source and destination, including directory descendant locks. Callbacks are mandatory and fail closed if omitted.

3. At start of handleApi, BEFORE its generic method-based viewer/editor mutation gates, call `if (await syncHandler(req, res)) return true;`. Keep any authentication/origin boundary ahead of this dispatch. This permits reader POST snapshot while apply/PUT use semantic permissions. Unrecognized `/api/sync/` routes are handled as explicit sync errors; non-sync routes return false.
4. Clear/recreate handler with host lifecycle and publish normal state/change notifications after successful mutations as appropriate. Do not allow requests against a closed host. Add real requestHandler HTTP tests for viewer snapshots, editor delete/rmdir, configured limits and note/folder locks.

## Specific host/controller hooks still needed

1. **Live host limit update:** current `host.hello()`/`host.apply()` close over constructor maxFileBytes. The route uses `min(host constructor cap, current config getter)` and rechecks current cap for hello, every apply op, incoming chunk and before publication, so reducing config cannot retain the larger advertised/accepted cap. Raising config above constructor cap intentionally stays capped until restart. Preferred host change: accept a validated `getMaxFileBytes()` getter used in hello and immediately before mutation commitment (or expose serialized `setMaxFileBytes`). Supply the same config getter to host and route. On a live-capable host the route's cached host cap should likewise become dynamic; controller must coordinate that change. Current tests prove lowered setting enforcement and conservative cap intersection.
2. **Atomic authorization hook:** host.apply currently only accepts op; route authorization occurs before joining host's serial queue. For strict lock/permission/config changes during queued work, host needs an optional precondition callback run inside the serialized mutation immediately before its irreversible filesystem action, with current entry supplied. Recheck requestPermission, note/folder locks and current maxFileBytes there; deny without persisting a new applied result. Current static denial tests pass; concurrent lock acquisition/revocation during host work is not certified. No shared host edits made.
3. **Android replay progress:** RemoteConnection.uploadChunk presently demands `verifiedBytes == offset + count`. This server truthfully returns existing stored progress (possibly total/complete) when replaying an earlier segment of an already uploaded blob. Controller should route a client fix accepting validated forward progress up to total, or settle request-relative acknowledgement semantics consistently. Do not claim native retry interoperability until tested together. Snapshot query, upload Content-Range and JSON object envelope are aligned already.
4. Staging has no automatic garbage collection; incomplete valid segments are retained for resumption. Snapshot manifests are memory-resident (bounded token count, not aggregate manifest bytes); objects/history are retained indefinitely by current host. Power-loss and adversarial filesystem-race guarantees remain the Task 2 limitations; no new certification claimed.

## Prepared integration patch sequence — awaiting controller handover

This is a patch plan, not authorization to edit server.mjs. Task 2 fixes/review remain in progress; Task 6 owns engine/native Node transport; Task 4 owns replica IPC/media helpers. No changes to those workers' files. Line numbers below are navigation hints from the inspected server, not patch anchors.

1. **Contract freeze after Task 2 fix commit.** Read final host exports and updated Task 2 report, record revision, and use the actual getter/precondition signatures. Current inspected working tree still exposes constructor maxFileBytes and apply(op); proposed APIs above are not implemented contracts. Require the host precondition to receive the current entry inside its writer queue, return/throw a defined denial, and run before a NEW operation creates an irreversible intent. Specify how durable pre-existing intents/replays recover: permission revocation must not strand an already committed/partially executed operation. Recovery semantics belong to Task 2. Test that newly denied operations do not consume op identity and can retry after authorization returns.

2. **Adapt owned routes to final hooks (TDD, before server edits).** Replace captured role/hostLimit as authoritative apply decisions with the host's live limit and in-queue precondition. Keep inexpensive shape checks at the HTTP boundary. The precondition re-reads requestPermission(req), checks semantic delete/rmdir authorization, evaluates source/destination note/folder locks against supplied current entry, and checks the live limit. Do not call host.openSnapshot/rescan/apply from inside the callback: nested acquisition of the host queue can deadlock. Re-read the limit for hello and each upload segment; cover both raising and lowering without reconstructing handler or losing snapshot tokens. Avoid an asynchronous hello lookup inside the synchronous transfer getter; use the final synchronous getter or a shared validated config accessor supplied to both host and handler.

3. **Lifecycle patch in server (only after handover).** Add import and one module-level syncHandler beside hostService (~124). Centralize the validated current config limit accessor. In initializeVaultHost (~1258), pass the final live-limit hook into host creation, await ensureVault, then create the handler with mandatory permission/lock callbacks. Publish a ready handler only after initialization succeeds; on failure follow Task 2's finalized host cleanup contract. Clear handler before closeVaultHost (~1268) closes the host; sync requests before readiness/after closure get explicit 503, never fall through to legacy routes. Keep snapshots valid across ordinary configuration changes.

4. **Dispatch patch in server.** At handleApi entry (~777), dispatch the `/api/sync/` namespace before legacy POST/DELETE permission gates, preserving all existing access checks outside that function. If not ready, respond 503. Otherwise `if (await syncHandler(req, res)) return true;`. This is one insertion; leave the later Task 4 IPC/media dispatch site free. Snapshot POST is read-only, PUT blobs is a write, and each apply operation is authorized semantically. Keep note lock key conversion shown above; check a locked destination even when the incoming kind differs from the old destination kind.

5. **Notifications, narrowly scoped.** Add an optional post-commit callback in owned routes if required by current server consumers; invoke for each newly applied result, after host.apply resolves. Server adapter emits its existing note/list events using NOTES_DIR-relative paths and the legacy content revision format where required. Never use sync's opaque revision as the old note content revision. Callback failure must not turn a durable applied result into a misleading failure or prevent later results from returning. Replays need no duplicate mutation notification. This addition needs its own regression before implementation; no engine/UI changes belong here.

6. **Actual server HTTP regressions.** Use a separate fixture process/environment per vault mode, isolated DATA_DIR/VAULT_DIR, no autostart/browser, supplied Node 24.19, and createServer(exported requestHandler) on 127.0.0.1:0 after initializeVaultHost. Exercise real configuration/permission/lock state rather than substitute the production dispatcher. Since loopback defaults to admin, use existing in-process API request fixtures with controlled nonlocal request metadata for viewer/editor gate coverage if no safe production-supported remote fixture exists; report that boundary honestly. Do not add a production header granting test roles. Cover hello, viewer snapshot, editor delete/rmdir denial, existing and destination note locks, folder descendants, default `notes/` versus custom vault mapping, null-base collision, idempotent replay, epoch rejection, live limit decreases/increases, malformed uploads and actual >32MiB streaming through requestHandler. Add deterministic queued-operation tests for permission revocation, lock acquisition and limit reduction using the real host's existing interruption support; no timing sleeps or personal state.

7. **Task 6 adapter agreement.** Share the wire details above: `{operations}` -> `{results}`, `snapshotToken` and string cursor, Content-Range upload, optional identity headers, 409 epoch/incompatibility and 410 token-expiry behavior. TransferProgress is authoritative stored progress: the adapter must tolerate a valid acknowledgement ahead of the requested segment up to declared total, and validate complete/length/hash. Downloads/ uploads stay native streams; no JSON/base64 blob transport. Task 6 owns implementation of that adapter; this plan makes no edits there.

8. **Verification and handoff to Task 4.** Run both owned HTTP suites plus host regressions against the fixed host; run existing unit suite after final integration. Verify syntax and scoped diff; commit only Task 3 integration-owned files, including server only during its assigned window. Record exact integration commit and test totals here, then explicitly return server ownership to controller for Task 4. Until actual requestHandler protocol tests pass and controller review concerns are resolved, status remains INTEGRATION PENDING. Do not silently fold Task 2's five recovery/startup fixes into this patch.

## Independent review round 1 — owned-module fixes

Status remains SERVER INTEGRATION PENDING. Changes below supersede the historical cached-limit/precondition concerns above. No server, host, Android, desktop, Task 4 or Task 6 files edited.

- **Queued mutation policy:** routes now call `host.apply(op, {precondition: async ({operation,current}) => ...})`. Only structural validation occurs before apply; the precondition re-reads permission, enforces editor delete/rmdir denial, checks note/folder locks using host-supplied current state, and checks the live limit. The real host runs this at its mutation boundary inside its writer queue. No nested queued host calls; hello is a nonqueued live getter.
- **Lost ACK:** route-side mutation policy no longer masks the host's durable replay lookup. Identical committed operations return already-applied even after downgrade to viewer, new lock, or decreased limit, with the original confirmed version and no extra history entry. Authentication/recognized read-role and identity checks remain at the HTTP boundary; this does not grant a revoked/unrecognized principal access.
- **Live limits:** removed captured hostLimit. Every maximum() awaits current host.hello(), validates both host/config limits, and intersects their current values. Hello, apply preconditions and transfer stages use that live value. Raising config/host limits works without recreating the handler or expiring existing snapshot tokens. Integration should pass the same config accessor to host `getMaxFileBytes` and route `maxFileBytes`.
- **Bounded upload admission:** createSyncHandler/createTransfers accept `maxConcurrentUploads` (default 4). Capacity is reserved synchronously before any await/body read; excess requests return 429/transfer-capacity. Accepted requests wait in a bounded queue with unconsumed bodies; only the current request reads a capped segment. Slots release in finally on success or failure. Existing 1MiB segment limits, streaming publication and final hash verification remain.
- **Snapshot admission:** pendingSnapshots reservations count toward maxSnapshots before openSnapshot is awaited. Reservation releases in finally on failure or promotion to a stored token. Concurrent creators cannot exceed the configured capacity.

RED evidence: new deterministic review regression selection initially failed **9/9**: three queued-policy writes incorrectly applied; three changed-policy replays incorrectly blocked; raised hello cap stayed 2 rather than 8; concurrent snapshot returned 200 rather than 429; excess upload body was consumed instead of rejected. These failures were observed before production edits. The host interrupt at after-intent changes policy before the real filesystem transition; no scheduling sleeps. Capacity test uses a held async request body and real transfer/object storage, asserting the rejected body's iterator is never consumed, then verifies admission recovers after a failed hash.

GREEN evidence: supplied Node 24.19.0, `node --test tests/sync-protocol.test.mjs tests/sync-transfer.test.mjs tests/sync-host-store.test.mjs`: **73 pass, 0 fail, 0 skip** (25 owned + 48 current host tests). Includes added admin-to-editor delete/rmdir boundary checks, retries after policy restoration, real >32MiB transfer, immutable snapshots, and failure-release coverage. `npm run test:unit`: **181 pass, 0 fail, 0 skip**; scoped `git diff --check`: pass. Production requestHandler protocol wiring remains untested/pending the controller's sequential handover; no whole-task completion claim.

## Authorized final server integration — ready for independent review

Controller handed over local/server.mjs exclusively after Task 2 ee31fa0 was approved. This patch touches server.mjs, owned routes.mjs/protocol tests, the new tests/sync-server.test.mjs, and this report only. No edits to Task 4 replica-ipc or Task 6 transport/engine; no CI/startup scripts touched. Server editing window is returned to the controller after this commit.

Implemented wiring:

- One currentMaxFileBytes accessor is shared by host getMaxFileBytes and createSyncHandler maxFileBytes. Handler constructed after ensureVault, retained across config changes, and cleared before closing the host. Failed handler/IPC initialization closes initialized resources.
- `/api/sync/` dispatch precedes the legacy HTTP-verb write gates. Viewer POST snapshot succeeds; per-op viewer writes/editor delete/rmdir are denied by the in-queue precondition, after durable replay lookup. Not-ready/closed sync host returns explicit 503. The route does not nest host.read around apply/snapshot/changes; hello and lock lookup do not acquire the writer queue.
- The server callback checks existing note locks on source and destination and descendant locks for directories, converting default vault `notes/...` and custom-vault paths to the same NOTES_DIR-relative lock keys. Root note-directory locks check all active locks.
- Existing requestPermission/client identification/local-host config policy and MCP Bearer authorization remain intact. No new permissive CORS/origin bypass or role-granting test header. The HTTP tests use the server's existing loopback-proxy X-Forwarded-For handling to exercise remote viewer/editor/admin roles through real configured permissions; this is not a new authentication scheme or cryptographic client-identity guarantee.
- Newly applied mutations emit existing note/list SSE refresh events only after durable apply. Note events use legacy SHA-256-prefix content revision, not the sync revision UUID. Replay does not emit another mutation notification. Optional route onApplied failures do not erase a durable ACK.
- When PENTAMARK_DESKTOP=1, process.send exists, and PENTAMARK_USER_DATA_DIR is present, installReplicaIpc receives process and the resolved private profile directory during initializeVaultHost, before listen. Capability-media dispatch runs before public routing; unavailable media handler fails closed instead of falling through to vault/static files. closeVaultHost removes route/media availability, awaits IPC/replica close, then host close. The external helper implementation was not modified.

TDD and final verification, Node 24.19.0:

- Integration RED: three real-server tests returned 404 instead of hello 200; desktop IPC command timed out because listener was not installed. All used isolated child processes and temporary DATA_DIR/VAULT_DIR/USER_DATA_DIR, never the user's selected vault. Test setup corrections: valid MCP calls require Accept/Content-Type negotiation; the fixture uploader must remain authorized after deliberately downgrading another client.
- Post-commit notification RED: notification count remained 0 instead of 1. Added callback, asserted observed durable revision externally, and verified callback failure still returns applied plus replay already-applied.
- GREEN `node --test tests/sync-server.test.mjs tests/sync-protocol.test.mjs tests/sync-transfer.test.mjs tests/sync-host-store.test.mjs`: **91 pass, 0 fail, 0 skip**. Breakdown: 4 new real-server integrations, 26 protocol/transfer tests, 61 approved/evolved host regressions.
- Real requestHandler HTTP coverage: default/custom vaults; viewer snapshot; denied remote config; wrong/correct MCP token; viewer writes; editor delete/rmdir; source/destination/directory-descendant locks via real SSE presence; lost-ACK replay after role/lock changes; live limit decrease/increase and oversized new operation; old epoch; post-commit SSE content revision; closed-host 503. Actual **33 MiB + 3 byte** asset uploads, applies and downloads through production requestHandler using bounded chunks/incremental hash; no full-file buffer.
- Desktop integration opens a real private replica via process IPC, creates local content, obtains a capability media URL and reads it through production HTTP dispatch. Invalid capability gets 403; Markdown is attachment/octet-stream; private replica content is absent from host snapshot. Closing host disables media. Test process exits normally and temporary roots are removed.
- `npm run test:unit`: **181 pass, 0 fail, 0 skip**. `node --check local/server.mjs` and scoped `git diff --check`: pass.

Review scope/limits: ready for controller's independent integration review; not a claim of end-to-end packaged Windows/Android deployment validation or power-loss certification. Existing origin/client-identity trust model is preserved, not strengthened. Controller retains ownership of broader lifecycle/Windows CI diagnostics and cross-platform acceptance. Current protocol tests and real server wiring now pass; previous "server not wired" blocker is resolved.
