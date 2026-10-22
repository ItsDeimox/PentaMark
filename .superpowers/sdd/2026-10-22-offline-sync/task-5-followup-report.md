# Task 5 follow-up: discovery, migration, rebind and cycle completion

Status: DONE_WITH_CONCERNS for this checkpoint. Android compile and API24/35 instrumentation remain controller gates. No TS/host/desktop/workflow edits, publishing, SDK installation, personal vault or subagents.

## Native interfaces

- `discover({origin}) -> Hello`: pre-profile, validated fixed origin, only GET `/api/sync/v1/hello`; checks protocol/chunk/identity/epoch/max size. Native immutable proof is cached for subsequent open, not accepted from JS.
- `open({profile})` uses matching discovery proof; otherwise `handshake()` verifies the opened identity and durably records association. Neither automatically changes an existing origin.
- `importDraft({input: DraftImport}) -> {durable:true,migrationId}`. Wrapper aligned to controller's latest request. Exact fields: migrationId, vaultId, serverId, origin, path, content, legacyRevision. Requires verified association; retains exact UTF-8 bytes and version; deduplicates SHA256-shaped ID plus fingerprint of every payload field. Native cannot recompute the opaque Task7 ID because raw storage key is not in the DTO. Same ID/different payload rejects. Receipt and metadata share the journal recovery transaction. Unknown legacy base creates a durable conflict and unapproved dirty entry, never an unconditional PUT. Existing local edits/prepared operations survive at their original paths. No old draft deletion or network upload.
- `rebind({origin}) -> {profile,hello}`: explicit fixed-origin hello, identical vault/server mandatory before saving new origin. Existing cursor, epoch, versions and operations retained. Invalidated/queued old network work cannot adopt new binding; pause closes probes/transports.
- `snapshot().preparedOperations` reads all durable existing operations, never prepares fresh ones. Native apply validates against this read-only list.
- `completeCycle({input:{expectedCursor,expectedEpoch}}) -> SyncStatus`: real transaction checks current cursor/epoch, enabled, complete snapshot/no initial copy, zero pending operations/conflicts/intents and ALL entry dirty flags (including unapproved). Invalid returns stale-local-head. Only successful completion assigns native UTC lastSuccessfulSync. Edits/incoming/config changes invalidate idle without erasing previous success.

## Verification

TDD: discovery tests first failed javac for missing VerifiedHello/discover; this is compilation RED, not behavioral RED. After implementation, discovery passed 2 tests with real loopback HTTP, including immutable proof and malformed hello rejection. Full pure-JVM run: **OK (38 tests)**, exit 0. Existing Task5 test command applies with SyncDiscoveryTest added plus `android/app/src/sharedTest/java/com/pentagory/pentamark/SyncDiscoveryTestServer.java` in javac inputs. JDK22 and supplied json/junit/hamcrest jars; Documents scratch and loopback-only approved execution. JVM compilation does NOT include Android-dependent SyncVault/plugin.

Instrumented tests authored before implementation, NOT locally executed: SQLite migration association/deduplication/reopen/exact bytes/unknown conflict/existing prepared edit preservation/known base/rebind/receipt intent recovery; cycle read-only snapshot, cursor/epoch/enabled/incomplete guards, unprepared/unapproved dirty entries, prepared-only guard, conflicts, historical timestamp and reopen; actual Capacitor wrapper roundtrip for migration and completion. Shared test HTTP helper source-set added for JVM and Android tests.

Local attempt: `JAVA_HOME=JDK22; ./gradlew.bat :app:testDebugUnitTest :app:connectedDebugAndroidTest --offline` stopped before compilation because wrapper lock directory under `.gradle/wrapper/dists/gradle-8.14.3-all` cannot be created. Default SDK/emulators absent. No install attempted.

Controller reported CI run 39849545072 at 9506446 failed Android compilation at SyncVault.java:41 (missing closing parenthesis). Fixed in this checkpoint; no passing Android compile claim. Controller must rerun compilation and real API24/35 suite, plus same-SHA Windows/APK gates. Self-review only (user prohibits subagents); independent Android review still pending. Task5 report's unrelated filesystem/platform/host interoperability limitations remain. This follow-up supersedes its missing discovery/migration/rebind/cycle hooks.

Next authorized scoped follow-up: native `exportReplica` ZIP picker, full manifest/working/referenced objects, no JS bytes or live SQLite copy; not included in this checkpoint.
