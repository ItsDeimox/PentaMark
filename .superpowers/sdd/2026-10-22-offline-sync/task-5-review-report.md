# Task5 independent-review repair rounds

## Round 0: Android SDK directory fsync compile blocker

Controller CI 39850393784 reported compile RED: SDK has no OsConstants.O_DIRECTORY (tests not reached). Replaced with SDK O_RDONLY|O_NOFOLLOW, fstat descriptor S_ISDIR verification, fsync, guaranteed close. No numeric constant and no path-only check susceptible to symlink substitution. Instrumented regression asserts actual directory succeeds and regular file/symlink reject. Device RED/GREEN remains unrun locally (SDK unavailable); subsequent controller CI required. This is a compile-fix checkpoint, NOT a passing Android build claim. `git diff --check -- android` passed.

The five review findings are addressed below, with native verification and legacy-prepared-folder recovery limitations called out explicitly.

## Round 1: dependency-ordered journal

Confirmed preflight accepted a planned child deletion but materialization ran original parent-first order. Added stable topological ordering before intent persistence; old durable intents are ordered on recovery too. Vacated descendants precede parents, vacated names precede replacements, fresh directories precede destination descendants; cycles reject before intent. Real filesystem regression RED: `parentFirstDeletePlanReplaysChildrenBeforeDirectory` failed `directory-not-empty`. GREEN after fix: `SyncVaultTest SyncReplicaArchiveTest`, 8 tests passed (JDK22 supplied jars, same Task5 JVM command). Regression applies twice and verifies retained bytes. Added real SQLite incoming parent-first deletion/reopen regression; device execution awaits controller CI. No helper-only claim of native validation. `git diff --check -- android` passed.

## Round 2: host-compatible folder rename

Inspected host-service.mjs: apply rejects nonempty directory move/rmdir. Local folder rename now journals destination mkdir rows (new directory identities), existing-ID child file moves, and old directory tombstones; preparation uses conditional bases and explicit dependencies on moved/deleted source descendants. It waits if a prerequisite has an immutable prepared operation for an older local head. File IDs/history survive; source directory identities remain as tombstones/history rather than silently reassigned. Added SQLite regression: confirm original folder/note, rename, reopen, require exact mkdir -> note move -> rmdir shapes/bases/dependencies/IDs and immutable retry. Test written before implementation but native RED/GREEN unavailable locally; not claimed passing. `git diff --check -- android` passed. Actual host/native interoperability remains CI gate.

Important existing-data limitation: already-prepared legacy nonempty-directory moves cannot be rewritten under the same opId. This change prevents new bad plans but does not silently mutate old immutable operations. Controller needs explicit recovery/abandon-and-replan coordination for such legacy queues if present. No user vault or existing replica was migrated automatically.

## Round 3: transfer restart and remote completion revalidation (findings 3/4)

Confirmed shared engine starts each attempt at offset zero. Download retry now returns validated durable progress when a private partial supports it; missing/truncated partial resets only on a zero-offset restart. Upload zero-offset retry ALWAYS sends a real first segment and consumes the server's hash/aligned forward-progress acknowledgement, including when the local up:<hash> receipt says complete. Thus remote loss/reset (even without an epoch change) cannot be hidden by cached completion. Subsequent offsets remain checked against durable progress; no arbitrary skip or unverified complete response.

Native test-first regressions: existing SQLite + real HTTP download now reopens and negotiates at zero before the next segment. New SQLite + real HTTP upload reopens after partial progress, completes, reopens again, then receives shorter server progress simulating object/storage loss and must resend to completion. No SQLite/network mocks. These Android regressions were authored before the fix but RED/GREEN cannot run without controller SDK/device gates; no native pass claim. Existing JVM wire tests still cover validated ahead-of-request ACKs and malformed/hash/completion rejection. `git diff --check -- android` passed.

## Round 4: import picker ownership (finding 5)

The importing slot now belongs to its exact PluginCall. Only that owner can release it on failure or consume the Activity result; replica-busy from a second request leaves the first vault/path/callback untouched. UI-thread picker-launch failures use the same owner-checked cleanup. Null/unrelated callbacks cannot consume a newer request. Added instrumented regression with real MainActivity/plugin, real SQLite replica and ContentResolver file: seed a displayed picker state, reject the second call, deliver the first result through the actual native callback, and require the first file/entry to commit. Only PluginCall responses are captured by the test; SQLite and import code are real. This tests pending-picker/callback ownership, not manual provider UI. Test authored before implementation, native RED/GREEN still awaits CI.

## Final verification / remaining gates

- Fresh pure-JVM compile and JUnitCore suite using JDK22/json.jar/junit.jar/hamcrest.jar: **OK (42 tests)**. Same command/class list as follow-up report, plus the new SyncVaultTest ordering regression. One initial invocation had a command typo (`com.pentagory.pentamark/RemoteConnectionTest`); corrected to dotted class name and reran the entire suite successfully. Not a product failure or behavioral RED.
- Parse-only diagnostic using JDK compiler JavacTask.parse over `android/app/src`: **32 files, zero syntax errors**. Helper lives in generated Documents scratch, not the repository. This does NOT type-check Android/Capacitor symbols or replace the SDK build.
- `git diff --check -- android` passed. Android SDK compilation, real API24/35 instrumentation, actual host/native folder interop and same-SHA controller gates remain required. No device RED/GREEN or successful Android build claimed. GH CLI status read failed network connectivity; controller's CI reports were used, not invented results.
- Round checkpoints: `1801988` SDK fsync; `090bac0` journal ordering; `0d86112` folder plan; `b9be119` transfer negotiation/revalidation. Picker ownership is the subsequent commit containing this report update.
- Prepared legacy nonempty-directory move recovery needs explicit controller coordination, as described in Round 2. New plans do not create those operations. No existing immutable op payloads changed, no personal vault, no non-Android code/workflow edits, no push/CI dispatch, no subagents.
