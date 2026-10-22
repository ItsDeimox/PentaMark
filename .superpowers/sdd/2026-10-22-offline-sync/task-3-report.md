# Task 3 — protocol/transfer module handoff

Status: MODULE IMPLEMENTED; SERVER INTEGRATION PENDING. No edits to server.mjs, HostService/storage, Android, desktop or UI. Controller reserves server wiring sequentially Task 3 then Task 4 after Task 2 review. This is not a claim that the full Task 3 is complete.

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
