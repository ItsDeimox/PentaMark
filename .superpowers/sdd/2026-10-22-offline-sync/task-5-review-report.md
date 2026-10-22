# Task5 independent-review repair rounds

## Round 0: Android SDK directory fsync compile blocker

Controller CI 39850393784 reported compile RED: SDK has no OsConstants.O_DIRECTORY (tests not reached). Replaced with SDK O_RDONLY|O_NOFOLLOW, fstat descriptor S_ISDIR verification, fsync, guaranteed close. No numeric constant and no path-only check susceptible to symlink substitution. Instrumented regression asserts actual directory succeeds and regular file/symlink reject. Device RED/GREEN remains unrun locally (SDK unavailable); subsequent controller CI required. This is a compile-fix checkpoint, NOT a passing Android build claim. `git diff --check -- android` passed.

Five review findings pending in subsequent bounded rounds: journal dependency order; host-compatible directory rename; offset-zero progress negotiation; upload completion revalidation; picker ownership on replica-busy.

## Round 1: dependency-ordered journal

Confirmed preflight accepted a planned child deletion but materialization ran original parent-first order. Added stable topological ordering before intent persistence; old durable intents are ordered on recovery too. Vacated descendants precede parents, vacated names precede replacements, fresh directories precede destination descendants; cycles reject before intent. Real filesystem regression RED: `parentFirstDeletePlanReplaysChildrenBeforeDirectory` failed `directory-not-empty`. GREEN after fix: `SyncVaultTest SyncReplicaArchiveTest`, 8 tests passed (JDK22 supplied jars, same Task5 JVM command). Regression applies twice and verifies retained bytes. Added real SQLite incoming parent-first deletion/reopen regression; device execution awaits controller CI. No helper-only claim of native validation. `git diff --check -- android` passed.
