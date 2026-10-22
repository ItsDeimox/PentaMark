# Task 8 — isolated sync UI and conflict model

Implemented reusable components with injected typed actions, without platform/backend imports or changes to Task 7 integration. Scope: conflict-model.ts, SyncSettings.tsx, SyncStatus.tsx, SyncConflictDialog.tsx, focused sync-controls.css, sync-conflicts.test.mjs, sync-controls.spec.mjs, and this report. No subagents/reviewers used. Shared contracts, package/lock files, live app, fixtures, Playwright configuration and tests/sync-ui.spec.mjs were not edited.

## Exact wiring contract

All types are exported from the corresponding component/model modules. Promise-returning callbacks accept Promise<unknown>, so existing native/status-returning adapters fit without discarding their return types. Errors must reject; do not turn native errors into fulfilled responses. These components do not infer successful native persistence from button clicks.

```ts
interface SyncSettingsProps {
  offlineEnabled: boolean;
  mode: SyncMode;
  origin?: string;
  status?: SyncStatus;
  busy?: boolean;
  onEnable?: (input: { origin: string; mode: SyncMode }) => Promise<unknown>;
  onConfigure?: (config: { offlineEnabled: boolean; mode: SyncMode }) => Promise<unknown>;
  onSyncNow?: () => Promise<unknown>;
  onExportPending?: () => Promise<unknown>;
  onReviewConflicts?: () => void;
}
interface SyncStatusProps {
  status?: SyncStatus;
  onReviewConflicts?: () => void;
}
interface ConflictReview {
  conflict: Conflict;
  localHead: string | null;
}
type ResolutionCapabilities = Partial<Record<ConflictResolution['choice'], true | string>>;
interface SyncConflictDialogProps {
  conflicts: readonly ConflictReview[];
  capabilities: ResolutionCapabilities;
  onResolve: (input: ConflictResolution) => Promise<unknown>;
  onLoadVersion?: (version: EntryVersion) => Promise<string>;
  onExportVersion?: (version: EntryVersion) => Promise<unknown>;
  onClose: () => void;
}
```

- Main owns the desktop/Android-only tab and origin/Tailscale validation. The placeholder is `http://100.100.1.2:3417`. UI checks HTTP(S) syntax and rejects embedded credentials; authoritative policy remains native. Existing profiles must pass offlineEnabled=false; automatic is the upstream default mode. Checkbox only opens setup. Origin and automatic/manual choice precede the explicit “Criar cópia inicial” action, which calls onEnable once. Bind discovery, identity confirmation, profile creation/configuration and initial copy in that callback. There is no separate automatic onSyncNow call during enable.
- Bind onConfigure to the active controller/native configuration operation and update the supplied props after persistence. Mode selection waits for “Salvar modo”. onSyncNow is an explicit user action. Main handles immutable page-lifetime offlineProfile and any required navigation/reload; these components do not change routing or pcConnect.
- Feed status from the engine/native status subscription (convert null to undefined). “Sincronizado” requires idle, complete snapshot, zero pending/conflicts, valid last-success timestamp, and no error. Other phases and unknown state remain conservative. Last-success timestamps and local-save status are shown separately.
- Disabling requires a complete snapshot, no error, zero pending/conflicts, and idle/offline/waiting-manual phase. Otherwise the checkbox remains enabled and offers sync/export/cancel. Export never triggers disable or deletion. Native configure must atomically revalidate since status may change after render.
- Build ConflictReview rows from the same snapshot as entries/localHead. Preserve native head strings exactly, including empty string (Android empty entry uses it); pass null for unknown head. The shared desktop validator also accepts any string. No truthiness substitution of missing head to empty is safe.
- capabilities enables a choice ONLY with true; a string supplies an explicit disabled reason, and absent choices remain disabled. Main should gate choices to actual native/platform support. Merging additionally requires two live note versions and successful retained text loading, including the base when present. Binary/directory/delete combinations never merge bytes. Native code owns retention, collision-free naming, trash and atomic revision checks.
- onResolve receives exactly conflictId, expectedRemoteRevision, expectedLocalHead, choice, and mergedContent only for merged. Refresh the snapshot after resolution and after native stale rejection, rethrowing the original error. A stale rejected snapshot cannot be reapproved by reselecting it in the list. Review updated versions explicitly before retrying; newer remote/head/identity cannot inherit old approval.
- onLoadVersion reads the immutable EntryVersion, not a mutable working path. Adapt native readVersion's result to its text content. onExportVersion receives the full retained version; main can map blobHash/byteLength into the native exportVersion blob payload/picker. No binary bytes/base64 enter these components. Omit unavailable callbacks: export and merge controls explicitly remain unavailable. Pending export is a distinct callback for exportReplica or equivalent supported native flow.
- Keep the dialog mounted during snapshot refresh/stale errors. Drafts are retained per entryId (including intentionally empty drafts) across conflict-id changes and list selection. They are component-local: unmounting/reloading does not persist a merge draft. Main should not key/remount this dialog by conflictId. A removed selected conflict remains visible with its draft and disabled resolution until another item is selected or the dialog is closed.

## Verification

TDD skill used. Initial run: all 11 original focused cases RED for absent model/components. Follow-up RED cases exposed stale re-selection bypass, empty-to-populated list selection, incomplete/blocked disable eligibility and the legitimate empty native local head; all fixed and rerun GREEN.

Final commands/results:

```powershell
$env:CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test tests/sync-conflicts.test.mjs tests/sync-controls.spec.mjs
# 18 passed: 7 model + 11 real React DOM/Chromium cases
npm run typecheck
# passed
npm run test:unit
# 181 passed, 0 failed
```

Standalone browser harness bundles real components in memory with esbuild, loads the existing dialog styles plus component CSS, and mounts into a synthetic page. It bypasses live app/server/fixtures/config and uses injected action-boundary callbacks. Desktop width 1100 and mobile width 390 exercised; all four choice payloads, retained text loading, binary export, missing capabilities, pending disable, initial mode, counters/timestamp and stale draft handling covered. The file is also safe for collection by the shared Playwright runner, but that runner/config was not used for this isolated verification.

Default bundled Playwright browser was absent in the sandbox; the installed Chrome path above resolved it without installation or configuration changes. Node runtime was v22.20.0 for UI/model/unit checks; this is not the Node 24 native-storage acceptance run.

## Remaining integration/acceptance boundaries

Main/Task 7 binds SettingsModal, RemoteConnectionPanel, PentaMarkApp and status events. Native history/readVersion/export capabilities remain Task 4/5 integration responsibilities. Model tests prove guarded payloads and no mutation of retained metadata; they do not substitute for native retention/restart/atomic persistence tests. No Android device/APK or end-to-end native host sync acceptance was claimed. No real vault, network policy, package or shared fixture was changed.

Commit subject: `feat(sync): expose safe conflict resolution and per-vault modes` (owned files only).
