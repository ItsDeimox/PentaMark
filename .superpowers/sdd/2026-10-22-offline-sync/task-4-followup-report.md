# Task 4 follow-up — review fixes and native completion hooks

Status: **READY FOR REVIEW / integration gates remain**. This follows checkpoint `8b2789f`; independent clean review has not yet been received for this follow-up. Server edits remain unauthorized and were not made. No transport implementation, Android/TS engine edits, dependencies, subagents, publication, installed-app operations or personal vault access.

## Independent review findings addressed

1. Cross-entry conflicts now accept distinct identities from shared reconciliation. The local entry supplies the expected head; both versions are archived. Keep-both preserves the local file ID under a unique path and installs the remote identity separately. Choosing local/merged uses the remote entry ID with its displayed conditional base, never a revision from another ID. Regression persists and resolves the distinct-ID collision.
2. Filesystem dependency planning happens **before** intent persistence. A new occupant waits for deletion/move of the former occupant; files wait for destination directories; directory removal waits for captured children. Cyclic plans reject before any intent/disk change. Recovery persists each completed substep; final verification checks final pathname effects, so tombstone A followed by B at the same path does not incorrectly require the path to remain absent.
3. Resolution finds archived conflicts before processing merged input. Typed merge bytes and a retained-resolution receipt persist before a superseded-conflict stale rejection. The active newer conflict remains untouched.

## Folder batches

Rename/delete capture the known child set once inside a durable intent. Children move/delete with retained objects; directories are created shallow-first and removed only when empty. An unexpected new child produces a visible retained source directory, a `folder-has-new-children` conflict, and captured/indexed encountered files, rather than expanding the original deletion set. Batch recovery resumes durable substeps after a crash between children.

Wire dependencies order mkdir before child publication and child operations before rmdir. If an older prepared child A still occupies the source while newer local B moved, parent removal waits for A's ACK and preparation of B's conditional move. Prepared operations remain immutable.

**Directory identity tradeoff:** file entry IDs survive rename. Destination directories receive new IDs and source directories receive tombstones, because the current host wire operation only moves empty directories and cannot adopt destination scaffolds. This was stated to the controller during implementation; confirm this representation in review. No recursive deletion of unknown children is used.

## Closed native methods and return shapes

The existing envelope remains `{requestId, replicaId, method, payload}`. The response remains correlated `{requestId, replicaId, ok, value|error}`. Discovery can use a newly generated replicaId as correlation before any persisted profile exists.

| Method | Payload | Value |
| --- | --- | --- |
| completeCycle | `{expectedCursor,expectedEpoch}` | SyncStatus |
| discover | `{origin}` | Handshake |
| rebind | `{origin}` | `{profile,hello}` |
| history | `{entryId}` | `{versions: EntryVersion[]}` |
| readVersion | `{version: EntryVersion}` | `{version,content}`; bounded note text only |
| mediaUrl | `{entryId}` | `{url}`; session-capability relative URL |
| importDocument | `{path}` relative destination | imported asset EntryVersion, or `{cancelled:true}` |
| exportVersion | `{blob:{blobHash,byteLength}}` | `{cancelled:false}` after export, or `{cancelled:true}` |
| exportReplica | `{}` | `{cancelled:false,format:'directory',directoryName}`, or `{cancelled:true}` |
| handshake | `{profile}` | Handshake |
| remoteSnapshot | `{snapshotToken?,cursor?}` | SnapshotPage |
| changes | `{cursor,limit}` | ChangesPage |
| apply | `{operations}` | `{results}` |
| downloadBlob / uploadBlob | `{blob,offset}` | TransferProgress |

History/readVersion/exportVersion match Android's shapes. `mediaUrl` follows the controller binding. `preparePending` retains its original desktop raw-array result; controller already wraps it. Historic text reads require an exact retained version, not a forged hash under another version. Asset bytes and exports stream natively, never through JS/base64.

Electron opens a file picker for import, a save picker for version export, and a directory picker for whole-replica export. Renderer payloads cannot contain native paths. Main adds only picker-selected paths to the trusted parent/child IPC message. It rechecks frame/server identity after the modal picker; cancellation never dispatches export or reports completion. Duplicate request IDs during picker selection reject. Export destinations inside userData reject to protect private replica state.

## Atomic completion and disable

New snapshots always include detached `preparedOperations` without calling preparePending or preparing fresh work.

`completeCycle` checks the current cursor/epoch, enabled state, completed manifest, zero dirty entries, zero prepared operations and zero conflicts inside a SQLite transaction under the native serialization queue. Failure returns `stale-local-head`. Only success writes native-clock ISO time and permits idle. Edits, incoming changes, ACKs and preparation invalidate the completed-cycle flag while retaining the last-success timestamp; ACK alone cannot resurrect an old idle status.

`configure({offlineEnabled:false,...})` atomically rejects incomplete/dirty/prepared/conflicted replicas with `replica-not-clean`; a UI precheck is not trusted. Mode changes/enabling remain supported. Rebind persists only after a fresh native proof matches vaultId/serverId; pending ops, cursor, epoch and replica identity remain preserved.

## Whole-replica export format

No ZIP dependency was added. `exportReplica` creates `PentaMark-replica-<UUID>/` inside the user-selected directory:

- `manifest.json`: format `pentamark-replica-directory-v1`, native export timestamp, profile, public snapshot, canonical native state (prepared operations and ACKs included), all historical versions, archived conflicts, retained typed-merge receipts, observed working entries, and retained object references.
- `working/`: actual observed working bytes, safely captured into immutable objects before copying.
- `objects/<sha256>`: all retained complete objects, including old/prepared/conflicting versions. Every referenced manifest object must exist and verify; missing history fails the export instead of silently omitting bytes.

Metadata is captured in a SQLite transaction while the replica queue is held. No live SQLite/WAL file is copied. File copies and manifest are synced, then the uniquely named `.partial` directory is renamed to its completed name. Cancellation is distinct from success. A failed export can leave a clearly marked partial folder; no successful receipt is returned. Originals/queue/history are never deleted. This is a documented backup format, not a claim that an automatic restore/import UI exists. Incomplete transfer staging is not represented as a complete object in this backup.

## Task 6 / controller binding still required

`installReplicaIpc({channel,userData,discoverOrigin?,transportFactory?})` now accepts native hooks:

```js
discoverOrigin(origin) -> Promise<Handshake>
transportFactory({profile,objects,stagingRoot}) -> Promise<RemotePort>
```

Discovery performs only fixed `/api/sync/v1/hello`, with native origin validation, bounded response, timeout, no arbitrary endpoint and no redirect/auth leakage. The callback is native injection, never supplied by the renderer. If omitted, the adapter uses Task 6 export `discoverNativeSyncOrigin` from `transport.mjs`, now present in commit `4feb671`. That implementation permits canonical Tailscale IP origins and HTTPS ts.net origins. No competing HTTP client was added here. Rebind uses this same native discovery hook. A build missing the export returns `native-discovery-unavailable`.

The transport factory defaults to Task 6's existing `createNativeSyncTransport`. It binds to the opened replica's object store and staging directory. Auth providers can be captured by the native injected factory. `apply` accepts only byte-for-byte durable prepared operations from snapshot; it never prepares fresh operations as a side effect. Rebind drops the old transport binding after verifying/persisting the new origin. Optional native transport `close()` is called when rebinding/shutting down.

Server must still install `installReplicaIpc`, route capability media before public/static handling, and close it on shutdown, as specified in the first report. This follow-up does **not** authorize or perform that wiring. Real Electron dialogs, packaged-app end-to-end discovery, and UI integration remain acceptance gates. Media Range support is still absent.

## RED/GREEN evidence

All native runs use supplied Node **24.19.0**, real SQLite/files and disposable fixtures. Windows hard-link tests run outside the app sandbox, which rejects hard links. No real vault is used. Replica-only tests use no network listener; the final combined Task 6 suite uses isolated loopback fixture servers.

- Folder milestone RED: **0/3**, each rejected by old folder-not-empty behavior. Subsequent suite **22/22**.
- Review regression RED: **0/3**: cross-entry invalid-command, same-path replacement external-change, archived merge unknown-conflict. Subsequent suite **25/25**.
- Native completion/import/discovery RED: **0/3**, missing methods/closed-union cases. Subsequent hook suite passed; one intermediate cleanup failure was a fixture after-hook ordering error (SQLite still open), fixed by closing IPC before fixture deletion.
- Folder A/B dependency RED: rmdir prepared before child A ACK. Corrected; parent removal now depends on final child operation.
- Disable/export RED: **0/2**, disable incorrectly succeeded and exportReplica was missing. Corrected.
- Cycle-phase regression RED: ACK restored idle using an old last-success timestamp. Corrected with durable cycle-completion invalidation.
- Missing historical object export RED: export incorrectly reported success. Corrected by verifying every manifest reference before publication.
- Final `node --test tests/sync-desktop-store.test.mjs`: **36 pass, 0 fail**.
- Final integration `node --test tests/sync-desktop-store.test.mjs tests/sync-client-transport.test.mjs`: **48/48**, including Task 6 fixed-hello discovery and real fixture native transfer tests.
- `node --test tests/sync-desktop-store.test.mjs tests/desktop-data-root.test.mjs tests/desktop-updater.test.mjs`: **65/65** before the final export-reference and cycle-phase-only refinements; final replica suite rerun afterward. Native updater fixtures only.
- `pnpm test:unit`: **181/181** (the prior checkpoint's timing failure did not recur). Run before the final export-reference-only refinement; focused export/replica checks rerun afterward.
- `pnpm typecheck`: pass. Scoped `git diff --check`: pass (normal LF/CRLF warnings).

This checkpoint is submitted for the requested clean review, not self-certified as independently reviewed. Outstanding gates are server wiring, directory-ID representation acceptance, and actual packaged/native UI acceptance. Native discovery now reuses Task 6's committed export.
