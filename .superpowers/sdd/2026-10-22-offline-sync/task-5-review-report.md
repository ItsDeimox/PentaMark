# Task5 independent-review repair rounds

## Round 0: Android SDK directory fsync compile blocker

Controller CI 39850393784 reported compile RED: SDK has no OsConstants.O_DIRECTORY (tests not reached). Replaced with SDK O_RDONLY|O_NOFOLLOW, fstat descriptor S_ISDIR verification, fsync, guaranteed close. No numeric constant and no path-only check susceptible to symlink substitution. Instrumented regression asserts actual directory succeeds and regular file/symlink reject. Device RED/GREEN remains unrun locally (SDK unavailable); subsequent controller CI required. This is a compile-fix checkpoint, NOT a passing Android build claim. `git diff --check -- android` passed.

Five review findings pending in subsequent bounded rounds: journal dependency order; host-compatible directory rename; offset-zero progress negotiation; upload completion revalidation; picker ownership on replica-busy.
