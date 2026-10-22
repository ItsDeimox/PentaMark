# Task 9 — bounded packaged Windows acceptance

Implemented `tests/native-desktop-offline.test.mjs` only; no app, package or workflow edits. This is the Windows subset of Task 9, not completion of the full cross-device/fault matrix.

## CI command and environment

Use Node 24 (local run: 24.19.0), installed repository dependencies, and a Windows desktop session capable of launching Electron.

```powershell
npm run desktop:build
node --test tests/native-desktop-offline.test.mjs
```

Default executable: repository `desktop-dist/win-unpacked/PentaMark.exe`. No required environment variables. Optional `PM_NATIVE_DESKTOP_EXE` selects an executable under repository `desktop-dist` or `desktop-dist-probe-native`; installed application paths are refused. A missing/stale package fails, rather than skips, on Windows. Other platforms skip explicitly.

For the separate local package used here:

```powershell
npm run local:build
node node_modules/electron-builder/cli.js --dir --publish never --config.directories.output=desktop-dist-probe-native
$env:PM_NATIVE_DESKTOP_EXE = Join-Path $PWD 'desktop-dist-probe-native/win-unpacked/PentaMark.exe'
node --test tests/native-desktop-offline.test.mjs
```

The test compares every packaged `local`/`local-dist` file against current build resources and compares main/preload/sync bridge bytes in ASAR. This detects stale packaging, but does not establish that `local-dist` was rebuilt after subsequent source edits. Coordinate builds with the parent before rerunning.

## Actual validation, 2026-10-22

Real Electron 43.3.0 unpacked EXE launched through the installed Playwright `_electron`; real preload, parent/child IPC, SQLite, object store and filesystem. No mocked API responses, replacement replica service, browser-only app, downloaded APK execution or publication.

- PASS: known completed manual replica opens in packaged UI with unavailable host; local page origin retained.
- PASS: editor replaces note content, Ctrl+S persists exact bytes through native IPC; navigation to Beta and back preserves text; pending count is 1.
- PASS: complete Electron shutdown/relaunch restores the same note in the actual editor and retains pending state.
- PASS: native media capability serves exact fixture PNG bytes and Chromium decodes a 1×1 image.
- PASS: stale revision PUT returns 409 without changing current note.
- PASS: stale local-head pull rejects without changing snapshot/cursor.
- PASS: conflict records preserve independently readable base/local/remote contents; applying the conflict does not overwrite the working note.
- PASS: newer local edit makes old conflict resolution reject; snapshot/conflict and newer bytes survive.
- PASS: after Electron exits, independent Node service reopen confirms working-file bytes, SQLite pending state, conflict and all three versions.
- PASS: zero native remote-transport commands, zero renderer requests to host and zero connections to the rejecting TCP sentinel during both boots and all operations.
- PASS: post-run process inventory found no executable remaining under the dedicated probe output. Successful fixture directories are removed.

Validated executable SHA-256: `861e3fee2770bc604be9d61722e22cc7c74f40d2c115ec317c0812ba4b1ebd5b`.
Validated ASAR SHA-256: `c204cfcf12e59f019f2e8f189241449a3c4b62162af02e7dabc0b17ebb10e12b`.
Validated final local-dist/index.html SHA-256: `c11a805582ff8a6f51e0818f77de3c57dcfab4f2f954a8053e2aba2b6f24bd65`.

Final run used the parent's finalized frontend containing Android disconnect, legacy media link and draft conflict backup fixes. A preceding attempt correctly failed the freshness check when parent rebuilt local-dist; after repackaging, the final test passed (1 passed, 0 failed). EXE/ASAR hashes are unchanged because frontend lives in extraResources; the index hash above identifies the refreshed frontend.

Final run: scenario 8.77 seconds, total runner 9.72 seconds. Timeout: 180 seconds; owned-process watchdog: 150 seconds; launches: 30 seconds; shutdown: 10 seconds. Cleanup targets only the ChildProcess PID returned by Playwright (with its descendants if forced cleanup is needed), never process names or unrelated running apps.

## Isolation, instrumentation and limits

- Fixture uses mkdtemp userData/data/vault, random identities and ephemeral ports. Explicit environment overrides and saved vault selection point only at that fixture. The child environment omits ELECTRON_RUN_AS_NODE entirely, including case variants; it is never assigned an empty value.
- Renderer profile validation rejects loopback origins. The fixture therefore uses a random HTTPS `.invalid.ts.net` name, with Chromium-only resolver mapping to a TCP sentinel which immediately destroys connections and serves no protocol. Native transport attempts are counted at actual parent→server command forwarding. The observer forwards every original send unchanged and must witness real `open` and `request` commands on each launch, preventing a vacuous zero-traffic pass. It attaches before any HTTP renderer loads; late attachment fails.
- This is bounded absence-of-host-contact evidence, not OS-wide packet capture or a long-duration reconnect test. It covers the native service's IPC transport entrypoints and renderer host requests. It does not claim no unrelated updater traffic.
- Conflict/pull candidates are seeded objects and submitted through real IPC. There is no live peer host, automatic reconciliation, Android peer, network ACK loss, crash injection, ENOSPC or seven-day test here. Stale/conflict protection is checked at native IPC, not by clicking conflict-resolution UI. Media checks native delivery/decoding, not the attachment picker or workspace preview layout.
- Normal packaged app startup runs unchanged, including its existing protocol-registration code; isolated data paths do not sandbox Windows protocol registration.
- Initial harness runs exposed pnpm transitive ASAR resolution, invalid loopback profile and main-process `require` scope assumptions; these were corrected in the test. No app changes were made to obtain a pass. Failed fixtures are deliberately retained under the OS temp directory, with their exact paths printed by the test.
- Playwright 1.56.1 emits Node DEP0190 for its Windows launcher; the passing result is not suppressed. The executable is constrained to repository packaging output.

Only this report and the new test belong to this work. Parent-owned renderer/media/workflow changes were neither staged nor committed here.

## Follow-up: responsive navigation in Windows CI (2.14.0)

Read the actual logs for [run 39856738060, job 120096773310](https://github.com/ItsDeimox/PentaMark/actions/runs/39856738060/job/120096773310). Packaged boot and editor save passed; Beta selection timed out because the matching button was hidden. The navigation hook chooses compact mode below 1100 effective CSS pixels, and compact navigation starts closed and closes again after selecting a note. The old harness assumed the sidebar stayed visible.

Rebuilt `local-dist` and the isolated `desktop-dist-probe-native` with the parent's authorization, using its 2.14.0 package metadata. No app, package or workflow files were changed by this follow-up.

The test now opens the real “Mostrar ou ocultar arquivos” button only when its `aria-expanded` is false, waits for visible navigation, and normally clicks the note. It repeats this for each selection. No forced click, DOM visibility override or synthetic click bypass is used.

`PM_NATIVE_DESKTOP_VIEWPORT=1000x700` optionally sets the real Electron window content size on both launches and checks the renderer dimensions. Leaving it unset preserves the runner's normal window size. Supported explicit sizes respect the app's minimum (920×620).

```powershell
$env:PM_NATIVE_DESKTOP_EXE = Join-Path $PWD 'desktop-dist-probe-native/win-unpacked/PentaMark.exe'
$env:PM_NATIVE_DESKTOP_VIEWPORT = '1000x700'
node --test tests/native-desktop-offline.test.mjs
```

Observed evidence:

- RED, before the navigation fix: reproduced the same Beta click timeout with actual `innerWidth=1000`, `innerHeight=700`, `compact=true`, `navigation=false`, sidebar `aria-hidden=true`, `inert=true`, `visibility=hidden`, opacity 0. Save had already persisted and host connections remained zero.
- Failure capture verified: `test-results/native-desktop-1792704651135-25768.png` and matching `.json` were generated and inspected. Screenshot shows the edited Alpha note and closed sidebar. The diagnostic includes error/stack, requested and actual viewport, screen/DPR, sidebar state/geometry, note geometry, package hashes, fixture location and process log.
- GREEN, same packaged build at 1000×700: 1 passed / 0 failed, runner 5.89 seconds. Logs confirm the actual sidebar button was used before both Beta and Alpha. All native persistence/media/conflict/no-host-contact assertions still passed.
- GREEN at 1440×900: 1 passed / 0 failed, runner 6.73 seconds. Already-open desktop sidebar needed no toggle. The same native assertions passed.
- `npm run test:unit` with Node 24: 181 unit tests and 279 sync tests passed, zero failures/skips; log saved to `test-results/native-unit-regression.log`. Final process inventory found no remaining probe executable.

On scenario failure, evidence is written before teardown under `test-results/native-desktop-<timestamp>-<pid>.png` and `.json`, ready for the parent's existing artifact upload. Screenshot/renderer capture is bounded to five seconds each; capture failure is recorded without replacing the original scenario error. If there is no live renderer, JSON records that limitation. Preflight package validation cannot capture a screenshot because no app has launched.

Follow-up package SHA-256: EXE `40923aa89ed608ec5c23ebb3cdd41ff07cff3a011b3ade58a6f4bf020ef408c4`; ASAR `32c0f9bcb699ddf957053e3e0ee28d185088c29b857b167a7882f53448166941`; frontend index `ebd2f848c4da662dc5087efd7e78008c924b6c8b327e600f193dc82e9087d682`.

This fixes the test's navigation assumption, not an application bug. The failed GitHub job was inspected, not rerun or cancelled here. The debugging workflow guided a real failing reproduction before the fix, followed by compact and wide native verification.
