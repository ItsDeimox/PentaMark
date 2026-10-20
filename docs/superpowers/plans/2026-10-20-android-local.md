# Android local — implementation plan

> **For agentic workers:** Use executing-plans for integration and dispatching-parallel-agents for the independent native storage slice.

**Goal:** Deliver an installable offline Android APK reusing PentaMark's editor and visual interface.
**Architecture:** Capacitor packages the existing Vite bundle. A native LocalVault plugin implements the current API contract against private Markdown files; the browser and desktop retain HTTP transport. Native import/export provides access to Android's document picker without broad storage permissions.
**Tech Stack:** React, CodeMirror, Capacitor 8.5.3, Android Java, Gradle.
**Spec:** User requests in this conversation: local first, no Termux, same editor/effects, Tailscale connectivity later, implement without further questions.

## Global constraints

- No changes to the existing graphical effects or desktop storage behavior.
- No server, internet, account or PC required for the APK.
- Real Markdown files; preserve errors/conflicts, recover deleted files, export before uninstall.
- No embedded private signing key in source or public artifacts.
- Remote vault/Tailscale support is explicitly deferred.

## Review focus

- Interrupted saves and rapid typing must not silently discard drafts.
- Traversal and folder self-moves must never escape the vault or destroy files.
- Unicode/space filenames and relative asset links must resolve offline.
- Reopening the installed app must retain both files and preferences.
- Android keyboard/back/system bars must not obscure the editor or exit unsaved work.

## Task 1: Native file backend

Files: android/app/src/main/java/com/pentagory/pentamark/LocalVault.java, LocalVaultPlugin.java; matching JVM tests.
Interface: LocalVault.request({url,method,body?,base64?}) -> {status,data}; info() -> {root}; importDocuments()/exportVault() native document pickers. State includes assetPaths.
- [ ] Write/run persistence, conflict, traversal, Unicode, rename/trash and upload tests.
- [ ] Implement serialized atomic writes and local API contract; verify JVM tests.

## Task 2: Shared UI integration

Files: src/platform/android.ts, src/api/client.ts, src/main.tsx, src/features/markdown/renderer.ts, src/app/PentaMarkApp.tsx, settings UI, mobile tests.
Consumes Task 1 contract; exposes native-aware request/events/file URLs without changing web behavior.
- [ ] Write failing transport/media/draft tests; run them.
- [ ] Implement native startup, transport, offline import/export controls and draft recovery.
- [ ] Run typecheck, units and browser regression tests.

## Task 3: APK packaging and validation

Files: capacitor.config.ts, android generated shell, .github/workflows/android.yml, Android documentation.
- [ ] Configure Android identity/version, safe WebView navigation and native registration.
- [ ] Build APK and run Android instrumented offline persistence smoke.
- [ ] Review integration, verify signature/checksum and deliver downloadable APK with honest validation scope.

## Decisions / progress

- 2026-10-20: Existing isolated worktree reused, branch feat/android-offline from 2.13.16 tree. User explicitly waived further approval prompts.
- Storage starts in app-private files with native import/export. A live external-folder SAF vault is not part of this first APK; export protects portability, uninstall removes private data.
- Task 1/2 shared contract above agreed before delegation. Task 1 owns only backend Java/tests; main owns UI and shell.
