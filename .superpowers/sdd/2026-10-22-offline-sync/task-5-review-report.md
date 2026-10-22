# Task5 independent-review repair rounds

## Round 0: Android SDK directory fsync compile blocker

Controller CI 39850393784 reported compile RED: SDK has no OsConstants.O_DIRECTORY (tests not reached). Replaced with SDK O_RDONLY|O_NOFOLLOW, fstat descriptor S_ISDIR verification, fsync, guaranteed close. No numeric constant and no path-only check susceptible to symlink substitution. Instrumented regression asserts actual directory succeeds and regular file/symlink reject. Device RED/GREEN remains unrun locally (SDK unavailable); subsequent controller CI required. This is a compile-fix checkpoint, NOT a passing Android build claim. `git diff --check -- android` passed.

Five review findings pending in subsequent bounded rounds: journal dependency order; host-compatible directory rename; offset-zero progress negotiation; upload completion revalidation; picker ownership on replica-busy.

## Round 1: dependency-ordered journal

Confirmed preflight accepted a planned child deletion but materialization ran original parent-first order. Added stable topological ordering before intent persistence; old durable intents are ordered on recovery too. Vacated descendants precede parents, vacated names precede replacements, fresh directories precede destination descendants; cycles reject before intent. Real filesystem regression RED: `parentFirstDeletePlanReplaysChildrenBeforeDirectory` failed `directory-not-empty`. GREEN after fix: `SyncVaultTest SyncReplicaArchiveTest`, 8 tests passed (JDK22 supplied jars, same Task5 JVM command). Regression applies twice and verifies retained bytes. Added real SQLite incoming parent-first deletion/reopen regression; device execution awaits controller CI. No helper-only claim of native validation. `git diff --check -- android` passed.

## Round 2: host-compatible folder rename

Inspected host-service.mjs: apply rejects nonempty directory move/rmdir. Local folder rename now journals destination mkdir rows (new directory identities), existing-ID child file moves, and old directory tombstones; preparation uses conditional bases and explicit dependencies on moved/deleted source descendants. It waits if a prerequisite has an immutable prepared operation for an older local head. File IDs/history survive; source directory identities remain as tombstones/history rather than silently reassigned. Added SQLite regression: confirm original folder/note, rename, reopen, require exact mkdir -> note move -> rmdir shapes/bases/dependencies/IDs and immutable retry. Test written before implementation but native RED/GREEN unavailable locally; not claimed passing. `git diff --check -- android` passed. Actual host/native interoperability remains CI gate.

Important existing-data limitation: already-prepared legacy nonempty-directory moves cannot be rewritten under the same opId. This change prevents new bad plans but does not silently mutate old immutable operations. Controller needs explicit recovery/abandon-and-replan coordination for such legacy queues if present. No user vault or existing replica was migrated automatically.

## Round 3: transfer restart and remote completion revalidation (findings 3/4)

Confirmed shared engine starts each attempt at offset zero. Download retry now returns validated durable progress when a private partial supports it; missing/truncated partial resets only on a zero-offset restart. Upload zero-offset retry ALWAYS sends a real first segment and consumes the server's hash/aligned forward-progress acknowledgement, including when the local up:<hash> receipt says complete. Thus remote loss/reset (even without an epoch change) cannot be hidden by cached completion. Subsequent offsets remain checked against durable progress; no arbitrary skip or unverified complete response.

Native test-first regressions: existing SQLite + real HTTP download now reopens and negotiates at zero before the next segment. New SQLite + real HTTP upload reopens after partial progress, completes, reopens again, then receives shorter server progress simulating object/storage loss and must resend to completion. No SQLite/network mocks. These Android regressions were authored before the fix but RED/GREEN cannot run without controller SDK/device gates; no native pass claim. Existing JVM wire tests still cover validated ahead-of-request ACKs and malformed/hash/completion rejection. `git diff --check -- android` passed.
