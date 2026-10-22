# Task 7 — integration in progress

## Integrated checkpoint for independent review
- Native Windows/Android command adapters, shared engine lifetime, automatic/manual controls, fixed-origin discovery, saved-replica reopen without network, verified same-identity rebind, and explicit Android legacy draft recovery are wired. Bootstrap opens a saved replica before legacy Android initialization. Source context is immutable for page lifetime; switching reloads only after saving.
- Settings expose sync mode, initial copy, manual sync, current status, conflicts, and native whole-replica export. Conflict resolution passes displayed head/revision, reloads snapshot even after a stale rejection, and retains the dialog mounted. Historic version text/export go through native methods; no arbitrary native path accepted from renderer.
- Media uses native capability URLs on Windows and local WebView routes on Android. Missing offline assets show unavailable, not a request to the host. The URL cache tracks entry identity on pathname reuse.
- Tools use a native import picker with explicit relative destination name; ordinary Blob/drop upload is refused for offline replicas with instructions to use that picker. Imported bytes never pass through renderer JSON. Attachment insertion verifies the active note still matches; switching notes cannot append to the wrong document.
- Protected pending drafts are flushed only to the captured local replica before PATCH/DELETE. Failed/conflicting/changing drafts block the mutation, preserve text and do not call the remote host. Storage-busy/draft-saved events cover offline PC as well as Android.
- RED attachment tests2/2 missingcontrol. GREEN2/2 after implementation; intermediate assertion on live-preview raw Markdown was corrected to inspect actual saved Markdown, since preview correctly renders link label. Earlier regression run8/8 (new offline2+legacy6) after engine/settings/media changes. Later full offline4 run had2baselinepass+2testassertionfail, followed correctedfocused2/2pass. Final combined rerun after draftguard remains needed.
- RED protected draft helper3 failures (missingfunction); GREEN14/14 profile/migration/router tests. Latest typecheck passed. Productionbuild passed before final draftguard, with existing bundle-size warnings. Browser tests mock native bridges; Task9 native EXE test and actual Android instrumentation remain separate release gates.
- React best practices skill review applied to affected components: stable engine lifetime, effect cleanup, functional edits/current refs, native-operation duplicate guard, explicit accessible labels. No framework/dependency migration.
- Native followup implementations remain independently reviewed/fixed in their own tasks. This is a checkpoint for review, not release approval.

Controller owns platform/replica.ts, replica-profile.ts, vault-context.ts, api/client.ts, platform/android.ts, main.tsx and PentaMarkApp changes plus routing/migration/UI tests. No other worker edits these files.

## Foundation checkpoint (not task completion)
- Persistent per-replica identity profiles, immutable loaded context, disconnect retains profile/data; identity/origin replacement is rejected rather than silently rebinding.
- Protected Android draft migration requires verified vault/server identity and a native durable/idempotent receipt. A newer draft arriving during import is retained. Native import hook and live bootstrap integration still pending.
- Router captures context before async work and routes offline requests only to native replica; never falls back to live host on missing file/failure. Presence stays local; Blob import requires native stream path rather than base64.
- RED: Node24 `node --test tests/sync-migration.test.mjs` and `node --test tests/sync-routing.test.mjs` both exit1 because respective implementation modules did not exist.
- GREEN: `node --test tests/sync-migration.test.mjs tests/sync-routing.test.mjs` 11/11, no failures/skips. Includes identity mismatch, failure/retry receipt, newer draft, exact captured destination, 404 preserved, and no accidental network calls.
- Remaining: native bindings/discovery/migration; local bootstrap/events/media; UI editor guards + real browser tests. These focused injected-port tests do not substitute native/UI integration.

## Local-opening UI checkpoint
- Added explicit native metadata bindings and initializeReplica before initializeAndroid. Known replica skips legacy remote probe/SSE, uses native request router, scoped local draft store, and allows autosave with host offline. In-flight refresh cannot replace newly typed text.
- Real browser RED after completed pre-change build: PC opened fixture host note instead of replica Alpha; Android legacy probe failed opening. An earlier run overlapped build and hit missing index.html; discarded as nonbehavioral evidence.
- GREEN after integration: `PM_TEST_PORT=34981 CHROMIUM_PATH=<Edge> npx playwright test tests/sync-ui.spec.mjs tests/remote-ui.spec.mjs`: **8/8 passed**, 22.8s. Local fixture only. New PC/Android bridge simulations assert saved offline edits, multiple-note navigation, reload and no legacy/new network content call in manual mode. These are renderer tests with mocked native bridge, not proof of installed EXE/APK behavior.
- Typecheck passed; production build passed with existing large-chunk warning (main bundle ~1.87MB, Mermaid chunks). NO_COLOR warning eliminated for rerun. Native engine scheduling, media/discovery/migration and settings wiring remain pending.
