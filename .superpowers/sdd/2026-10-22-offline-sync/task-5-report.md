# Task 5 — Android durable replica and native streaming

Status: DONE_WITH_CONCERNS. Native implementation/checkpoints are ready for controller CI; Android compilation and API 24/35 execution are NOT locally certified. No SDK installation, push, publication, personal-vault access, or subagents.

Checkpoints: `82e2954` initial implementation; `dd14412` native retry/history/bridge review. Final follow-up adds the in-flight-download instrumentation case, read-only config compatibility and this report. Only Android sources/tests, fixture source-set wiring in Android build config, and this report were committed. Concurrent host/desktop/controller files and staged changes were preserved using explicit `git commit --only` paths.

## Delivered

- `SyncDatabase`: real SQLiteOpenHelper, WAL, synchronous FULL, foreign keys; API-24 SQL, fail-closed unknown schema. No SQLite mocks.
- `SyncVault`: private `filesDir/sync/replicas/<vaultId>/<replicaId>/{working,objects,staging}`; exact shared version/operation/decision JSON; explicit tombstones; immutable prepared operations, dependent directory deletions, durable ACKs, old ACK does not clear later edits.
- `SyncFileJournal`: file fsync, Android Os.rename, directory fsync, durable roll-forward intents before serving writes; retained prior objects/versions. Complete length AND SHA-256 checked before staging publication/reuse; incomplete `.working` files are never reused. Filesystem collision/symlink checks are separate from shared path policy.
- `SyncPaths`: NFC -> lower(ROOT) -> upper(ROOT) -> lower(ROOT) -> NFC, common fixture coverage under Turkish default locale. No Java reconciliation algorithm: incoming action is supplied by the shared engine, with defensive head/base/version checks.
- Whole incoming batches preflight before file intent; stale-local-head leaves cursor/state unchanged. Intermediate initial-copy pages persist entries/progress without advancing confirmed cursor; final page confirms atCursor. Snapshot exposes durable status/epoch/initialCopy/conflicts.
- Conditional conflict resolution retains base/local/remote and stale merged text. History/readVersion/exportVersion expose retained versions; distinct-ID name conflicts support keep-both/remote without identity reassignment. Local writes, known-subtree moves/deletions and native document import are journaled.
- Fixed-origin native protocol transport: hello, snapshotToken pagination, changes, POST apply `{operations}` / `{results}`, 1 MiB binary chunks. Upload retry accepts server forward progress only within total and aligned (or exactly total), exact hash, exact completion flag. No JS blob/base64 transport. Download verifies Content-Range, length, fsync and final hash; queue/progress remain native. Pause aborts sockets; resume requires handshake.
- Registered SyncVault plugin and passive `/_pm_sync/file?path=...` route with Range streaming. `setBlockNetworkLoads(true)` preserved; navigation/foreign origins/active documents denied. `/api/state` retains notes/assets/folders/assetPaths and array-shaped locks; GET `/api/config` provides safe read-only defaults, without copying host secrets.

## Evidence and reproducible commands

Read Task-5 brief, shared contracts/fixtures, relevant design, and Task-3 wire report. Used TDD skill; tests were authored before the SQLite/bridge implementation, but their RED/GREEN execution remains a CI gate. Initial JVM RED was missing SyncPaths (ClassNotFoundException), and transport RED was missing symbols; those are existence/compilation failures, not behavioral proof. The later upload replay test produced a real behavioral RED (`invalid-transfer-progress` for a valid ahead-of-request acknowledgement), then GREEN after the fix.

From repository root, with JDK 22 and the supplied jars (PowerShell):

```powershell
$deps='C:/Users/kevin/Documents/Codex/2026-10-19/cara-me-ajuda-pelo-amor-de/native-test-deps'
$out='C:/Users/kevin/Documents/Codex/task5-jvm'
$main='android/app/src/main/java/com/pentagory/pentamark'
$test='android/app/src/test/java/com/pentagory/pentamark'
$sources=@('SyncPaths','SyncFileJournal','RemoteConnection','LocalVault','AppUpdatePolicy') | ForEach-Object { "$main/$_.java" }
$tests=@('SyncVaultTest','SyncTransportTest','RemoteConnectionTest','LocalVaultTest','AppUpdatePolicyTest') | ForEach-Object { "$test/$_.java" }
& 'C:/Program Files/Java/jdk-22/bin/javac.exe' -encoding UTF-8 -cp "$deps/json.jar;$deps/junit.jar" -d $out @sources @tests
& 'C:/Program Files/Java/jdk-22/bin/java.exe' "-Djava.io.tmpdir=$out" -cp "$out;$deps/json.jar;$deps/junit.jar;$deps/hamcrest.jar" org.junit.runner.JUnitCore com.pentagory.pentamark.SyncVaultTest com.pentagory.pentamark.SyncTransportTest com.pentagory.pentamark.RemoteConnectionTest com.pentagory.pentamark.LocalVaultTest com.pentagory.pentamark.AppUpdatePolicyTest
```

Final JVM output: **OK (36 tests)**. Includes shared paths, old-object retention/idempotent materialization, untracked-destination rejection, reopened truncated/corrupt staging rejection, 33 MiB + 17 byte HTTP download in 34 segments with connection restart, bad Content-Range, valid upload replay forward progress and malformed/hash/completion rejection, and existing Android JVM regression classes. Legacy LocalVault symlink test uses JUnit Assume when the platform cannot create links; JUnitCore summary does not separately display assumptions. The new tests do not use assumptions. Local sockets initially hit sandbox EACCES; authorized execution with loopback only passed. Default Windows sandbox temp rename was denied; writable Documents scratch was used. No real host was contacted.

`git diff --check -- android` passed. JDK emitted only existing/deprecation notes.

Attempted twice from android:

```powershell
$env:JAVA_HOME='C:/Program Files/Java/jdk-22'
./gradlew.bat :app:testDebugUnitTest :app:connectedDebugAndroidTest --offline
```

Stopped before project compilation: wrapper could not create its `.gradle/wrapper/dists/gradle-8.14.3-all/...zip.lck`. No default Android SDK/emulator is installed. This is NOT a passing Android build/test. No attempt to install SDK or launch CI was made.

Instrumented tests committed (not run locally): real database pragmas/reopen, immutable prep/edit/old ACK, atomic stale page rejection, initial-copy progress/reopen, stale resolution preserves merged bytes, intent recovery after working rename before metadata commit, case-only file rename, distinct-ID collision rejection and keep-both, known-subtree deletion dependencies/unknown-file preservation, folder move/reopen, retained history, API state/config compatibility, concurrent edit during blocked native download plus durable offset/reopen, actual Capacitor promise roundtrip/Activity recreation, network-block policy and shared decision fixtures. Fixture symbolic hashes are replaced with actual stored test bytes while fixture actions/reasons remain the oracle.

## Parent adapter/hook contract

- Capacitor methods wrap arguments as `open({profile})`, `configure({config})`, `request({url,method,body})`, `persistIncoming({batch})`, `confirm({result})`, `resolve({input})`. `snapshot()` returns ReplicaSnapshot directly. `preparePending({limit})` returns `{operations}`; unwrap for ReplicaPort. Request body accepts an object or legacy JSON string.
- Remote methods: `handshake()`, `remoteSnapshot({snapshotToken?,cursor?})`, `changes({cursor,limit})`, `apply({operations})`, `downloadBlob({blob,offset})`, `uploadBlob({blob,offset})`. Apply returns `{results}`; unwrap for RemotePort. Calls bind to the opened replica/origin, never a caller-provided remote URL or filesystem path. Native apply checks submitted operations against durable preparation.
- An unknown entry's expectedLocalHead is `""`. One decision per entry per batch; duplicate IDs are rejected. Fetch/verify all referenced remote blobs before persistIncoming or conflict confirm. Conflicts can reference retained old local state even after the current local head changes.
- `history({entryId}) -> {versions}`, `readVersion({version}) -> {version,content}` (notes <=8 MiB), `exportVersion({blob})` via native document picker; `importDocument({path})` streams selected content natively. `transferProgress() -> {transfers}` and `transferProgress` events provide durable/native progress.
- Protocol API matches Task-3 report: `snapshotToken`, `Content-Range: bytes N-END/TOTAL` (`bytes */0` for empty upload), and `{results}` apply response. Tests exercise the documented retry response with a real local HTTP server, not the actual Node host module.

## Unmet gates and explicit remaining integration concerns

1. Controller must run Android compile/assemble, Gradle JVM suite, actual API 24 AND 35 instrumentation (including new Sync* classes), and Windows/APK same-SHA gates. No Android compilation success, true process kill/power-loss certification, disk-full fault matrix, or end-to-end host/native sync is claimed here. The in-process native network test and actual SQLite/Capacitor tests are written but await those devices.
2. Full successful-cycle status needs an explicit shared-engine completion signal. Native never sets lastSuccessfulSync from a partial page; it currently remains null and settled state remains conservative `offline`. Engine/UI must not interpret that as certified sync completion. This need was reported to controller.
3. Task7 coordinated follow-up: no pre-profile discovery or migration receipt hook yet. RemoteVault.request currently rejects sync hello; SyncVault.handshake needs open. Proposed narrow `discover({origin})` performs only validated fixed-origin hello. Planned `importDraft` accepts the exact Task7 `DraftImport` (`migrationId` SHA-256, vaultId, serverId, origin, path, content, legacyRevision), verifies the association, deduplicates ID AND content, preserves exact version plus an unknown-base conflict when legacy revision cannot establish a base, and returns `{durable:true,migrationId}` only after durable commit. Task7 removes unchanged old raw draft after that receipt. Controller explicitly allowed this as a separate follow-up; not implemented or simulated by ordinary request().
4. Existing-profile origin changes currently fail closed (`origin-change-needs-handshake`); a verified rebind flow is still needed with the discovery follow-up. No automatic retargeting or unverified legacy fallback.
5. Case-only **file** rename is implemented/tested; case-only folder rename is conservatively rejected. Directory move operations retain IDs but require real host interoperability validation of ordering/descendant behavior. For distinct-ID conflicts, local/merged choices conservatively require explicit rename (`identity-conflict-needs-rename`); keep-both/remote preserve the local identity at a unique path.
6. Private Android working files are serialized through the native instance. Protection against a compromised same-UID process or physical storage failure is not certified. Versions/objects/tombstones intentionally have no GC; unknown schemas block rather than destructively migrate. Read-only config defaults are UI compatibility, not authority to exceed the hello file-size limit.

Self-review corrected batch destination ownership, reusable-name replay, directory dependencies, content/version preservation, phase conservatism, upload ACK interoperability and staged integrity. No second reconciliation engine, timestamps deciding conflicts, or shared-fixture modifications were introduced.
