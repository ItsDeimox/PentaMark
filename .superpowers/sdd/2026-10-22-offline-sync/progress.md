# SDD ledger — plan: docs/superpowers/plans/2026-10-22-offline-sync.md

User authorized implementation and joint EXE/APK GitHub publication after validation on 2026-10-22.
Workspace: existing isolated clone pentamark-startup-fix; branch feat/offline-sync-pc-android. Preserve installed application and real vaults. No shutdown.
Baseline 4ff62df plus previously tested startup fix and approved design.

## Preflight task consistency
|Task|Tests / implementation / files|Finding|
|1|Pure decisions, contracts, fixtures|Consistent; decisions retain all versions.|
|2|Host object/journal/SQLite recovery and mutation coordinator|Consistent; external filesystem cannot be transactionally locked, must fail conservatively.|
|3|Routes and resumable streams|Consistent; ACK only after durable task 2.|
|4|Windows replica and closed IPC|Consistent; stale head atomically rejects incoming.|
|5|Android native replica|Consistent; real SQLite API24/35 gates mandatory.|
|6|Shared engine and transport|Consistent; prepared operations immutable.|
|7|Local routing/migration|Consistent; do not remove original drafts before durable copy.|
|8|Conflict UI|Consistent; displayed revisions and local heads required.|
|9|Crash/native/e2e evidence|Consistent; no personal vault fixtures.|
|10|Upgrade/release|Consistent; both artifacts same commit before publication.|

## Shared surfaces
|Tasks|Producer / consumer|Finding|
|1→2,3,4,5,6,7,8,9|contracts and literal fixtures → storage/protocol/engine/UI/tests|Sequential contract stabilization.|
|2→3,4,9,10|SQLite/file journal/host service → routes/replica/recovery/upgrade|Shared durability mechanism, no duplicate ad hoc writes.|
|2↔3↔4|local/server.mjs coordinator/routes/IPC|Sequential changes preserve prior tests.|
|3→5,6,9|HTTP protocol → native transfer/engine/pair tests|Exactly version 1; native staging only.|
|4↔10|desktop/main/preload/build → packaging|Preserve protected-directory fix; include new modules.|
|4,5→6,7,8,9|ReplicaPort → engine/routing/resolution/tests|Same wire DTOs; platform stores tested separately.|
|5↔7|Android draft and startup/native storage|Migrate only after verified vault identity.|
|6↔7↔8|controller/routing/editor/status/settings|Explicit ActiveVaultContext and no network ACK clearing newer local edit.|
|7↔8↔9|sync-ui tests and dialogs|Integrate in sequence, keep editor state safe.|
|9↔10|workflow gates/version/packaging|Tests on final commit and same version artifacts.|

Ruling: reuse the existing task-isolated clone on a new feature branch rather than another checkout — it already contains the required protected-folder fix and dependencies; another copy risks omitting them — cost if wrong: branch isolation can later be migrated without losing work.
Ruling: current user authorization supersedes planning-only wording in the documents — implementation and joint publication are explicitly requested — cost if wrong: external publication is still gated on complete tests.
Ruling: subagents inherit the current model rather than overriding it — tool instruction disallows model override without user request — cost if wrong: potential execution cost, not product behavior.

## Progress
Baseline: 178/178 unit tests passed, command pnpm run test:unit, duration 30s. Baseline commit df8baf4.
Task 1: implemented 1ed27c6, 48/48 new tests, existing 178/178, typecheck passed; review running 01a1651d-65c1-7292-89bd-744e69702a43 (Arendt). Implementer 01a16518-ffd7-7702-b799-ab44cd3886af closed; can resume for fixes. Base df8baf4.
Task 1 integration follow-ups: add tests to test:unit in task9; validate wire/native paths in tasks2–5. null means missing/unknown, not a tombstone; adapters must represent deletion explicitly.
Tasks 2–10 pending.
Task 1: review important open — lowercase-only pathKey misses sigma/final-sigma case collision. Fix round 1 dispatched to original implementer; scope reconcile/fixtures/tests. Base 1ed27c6.
Task 1: fix round 1/5 (1 addressed, 0 open; commits 1ed27c6..f8d2ef3), reviewed by 01a16520-547d-7440-a955-577ec49f3772. Caseless key is NFC→lower→upper→lower→NFC; Java Locale.ROOT; 67 tests/typecheck green.
Task 1: complete (commits df8baf4..f8d2ef3, review clean).
Task 2: running implementer 01a16521-a45b-7d72-9faa-00c2bbb3f3bf (Hume), base f8d2ef3. Report task-2-report.md. Own host persistence modules, server integration and host-store tests. Controller preparing later integration/release requirements only.
Task2 implementation6b2ae00 ready: 34host+67contract+181existing passed. Review package07e93a7..6b2ae00 contains only Task2 commit. Concerns under review: journal no-replace publication has recoverable pathname gap; legacy folder batch partial progress not persisted. Host limit currently constructor-fixed; Task3 requires runtime config-aware limit. Review pending, server wiring remains withheld.
Task2 review01a16534-b868-7300-b967-4227fe484c29 found4 Important: partial staging canpublish/ACK truncatedbytes; unexpecteddirectorytarget accepted; nonatomicpathnamegap vs spec; nonpersistedfolderremainder. Originalworker resumed fixround1 for staging/ownership/durablebatches+runtimecap/preconditionhooks; focusedregressiontests required. Additional NFDstartup risk senttoreviewer.
Ruling: amend spec7 to recoverable no-clobber publication with serialized application reads rather than single overwriting filesystem rename — preserving a racing external writer is the primary no-loss requirement and ordinary Node rename cannot provide conditional atomic replacement — cost if wrong: external programs can observe a brief absent working pathname, unsupported filesystems block safely. Journal retains completeold/newbytes; recovery precedesservingcofre. No claim of power-cut certification. Known partial-staging/directoryownership gaps remain must-fix, not excused by this ruling.
Ruling: run Android task5 alongside host task2 after shared contract review — developer delegation guidance favors independent disjoint work and the plan permits adapters after contract stabilization; workers have exclusive Android versus Node file ownership — cost if wrong: adapter integration rework, caught by task6/9 pair tests. Reviews use task path-filtered diffs if commits interleave.
Task 5: dispatched Android-only implementation, base f8d2ef3. Local SDK unavailable; instrumentation remains mandatory in CI before completion/publication.
Task 5 agent: 01a16524-c890-7c92-8bda-60c18a7fd062 (Singer).
Task 3: protocol module/tests dispatched with disjoint ownership only routes/transfer helpers/tests. local/server.mjs remains exclusively Task2 until explicit handover; Task3 cannot complete before real integration. Base3a4b630. Review task-path-filtered diffs due interleaved commits.
Task3 worker01a1652d-f47c-7dc0-b1db-60a1622f694a (Ptolemy).
Task4 Windows replica/IPC dispatched, base6b2ae00, exclusive replica modules+desktop+types+test; no local/server edits until Task2/3 handover. Host reusable journal under review, no fork. Final task completion still requires server wiring. New contract initialCopy metadata required in native implementations.
Task4 worker01a16535-9f58-7011-acae-0a3540945f21 (Jason).
Task3 module507bd16:14HTTP/transfer+34host tests pass,181existing pass, actual33MiB transfer. Serverintegrationpending. Needs hostdynamiclimit and inqueueauthorization callback; Android uploadreplayprogress corrected byTask5. Module report task-3-report.md.
Task9/10 controller prerequisite: added .github/workflows/offline-sync.yml for Windows build/native fixture and Android JVM+real API24/35 instrumentation on identical SHA. YAML parsed locally; no CI run yet. Workflow does NOT publish; final locally-signed APK verification remains release gate. Add final UI/pair tests to workflow when implemented. Review pending.
Task10 prerequisite: controller implemented native profile isolation, smoke unique profile/vault/port and pre-mutation random marker. RED2 failures→GREEN9 tests; existing suite181/181. Native smoke pending final rebuilt binary. Details profile-isolation-report.md; review pending.
Prerequisite review complete: 01a1652b-452b-7501-9300-9e1dec80173f approved f8d2ef3..3a4b630 (contract metadata50dbc56 and profile isolation3a4b630), no findings. Native packaged execution and portable PID-tree cleanup still pending. Do not run older executable smoke expecting startup writes to be isolated; only final rebuilt binary.
Ruling: extend ReplicaSnapshot/IncomingBatch with durable initial-copy progress, epoch, status and conflicts — original contract could not express incomplete paginated snapshot versus completed copy after restart — cost if wrong: extra optional DTO fields, checked by task4/5/6 recovery tests. Controller changed only shared declarations/spec; Android worker notified. Native implementations must emit them; engine treats missing status as unconfirmed.

## Release prerequisites
Checkpoint2026-10-22: host Task2 ee31fa0 round2 reviewedclean. Task3e579a60 realHTTP integration91focused+181baselinegreen; independentreviewDalton found casealias lockbypass and startupfailure IPC listenerleak; originalPtolemy fixing. Task4followup0efa3be36native/48combinedgreen reviewedbyFaraday inprogress. Android5b2c09c reviewMill Important5: journaldependencyorder, foldermovehost incompatibility, offsetzero retryresume, uploadcompletionepochbinding, pickerownership; Singerfixing. Androidexportd519e2c+compilefix1801988 needreview/nativeCI.
Task6 4feb671+plannerba65b47: main31/31green. ReviewerHerschel Important3 enginecancellation/polling/handoff fixedf2ad224;36/36green and scopedrereviewAPPROVED. Plannerba65b47 approvedsameindependentreview. Task8UI26de37d awaitingreview. Controllerlatestrenderercheck/typebuildgreen;8browserPCAndroidbridge-mock+legacygreen, notnativecertification.
Windowsstartup CI failure diagnosed as smokeharness nullenv producingemptyELECTRON_RUN_AS_NODE, notyetproductcode. Correctedscript samebinaryisolatedsmokegreen2.3s; diagnosticreportrecordsdiscardedcontaminatedfixture and rejectedhypotheses. FinalCI/rebuildstillrequired.
Task7 renderercheckpoint: knownreplica nativebootstrap+routing+draftscope+offlineautosave+refreshguard; 11puretests and8browser(new2+old6)green. Browsermocksnotnativecertification. Engine/media/settings/discovery/migration integrationpending.
Task4 core8b2789f reviewGauss Important3 dispatchedoriginalworker: crossentrycollisionvalidation mismatch; pathreuse durableintentordertrap; replacedconflict typedmerge retainedtoo late. Followupalso ownsremainingfolders/import/history/media/export/discovery; serverstillnotwired.
Task5 checkpoints82e2954/dd14412/abe8c2e:36JVMtests; realAndroidbuild/instrumentationpending. Nativefollowupdiscovery/importDraft/rebind authorizedworker, reporttask-5-followup-report.md pending.
Task8 worker01a16548-9cf7-7ba1-bd5f-5a328ab44734 Planck owns purepropsUI/model/tests; controllerownsactualSettingsModal/PentaMarkApp wiring.
Ruling: add readonly preparedOperations snapshot and guarded completeCycle(cursor,epoch) — without these, replaying immutable ops would preparefresh staleedits and successful-cycle timestampscouldnot be persisted safely — cost: nativeAPIextension, oldadapters block ratherthan falselyclaimsync. Nativecompletiontransaction mustrejectanydirty/prepared/conflict/incomplete state; no broadstatussetter.
Task2 additionalreviewImportant confirmed: NFD nativefilename aborts entireunconditionalhoststartup; foldednativecollision diagnosticsmissing. Fixround1worker notified preserve nativeaddressing+normalizedkey, isolate diagnosticswithoutfalsedeletions.
Task3 independentreviewOhm01a1653f-4501-7540-9d30-de8664a49deb Needsfixes: inqueuepolicyrecheck; durableACKreplaybeforecurrentpolicy; dynamicraisedlimit; boundeduploadadmission; minorsnapshotcapacityreservation. Fixround1 dispatchedoriginalworker; serverhandoverstillpending.
Task6 worker01a1653e-bf3e-7bc2-877d-c9daa6e1e97a Pauli ownsengine/controller/nativeclienttransport+focusedtests; nativeIPCbindingsintegrationpending.
Task7 controllerbegan pureprofile/migration/routerfoundation:11/11 tests, realnative/UIintegrationpending. Reporttask-7-report.md. No publication yet.
- GitHub remote added as github=https://github.com/ItsDeimox/PentaMark.git; origin remains local source clone. Auth works with network permission. Connector GET works.
- Latest published v2.13.21 includes EXE and APK. Remote main b543486 is old v2.8.0; never reset current code to it or force-push over it. Release from explicit new source branch/commit after gates.
- Existing Android signing pair located at C:/Users/kevin/Documents/Codex/2026-10-19/cara-me-ajuda-pelo-amor-de/outputs/android-signing/{pentamark-release.p12,password.dpapi.xml}. Do not print/decode credentials to logs or generate a new signing key.
- Existing apksigner.jar and reference signed 2.13.21 APK at C:/Users/kevin/Documents/Codex/2026-10-20/http-100-104-7-87-3417/work/android-2.13.21/.
- No local Android SDK at default path. Existing Android workflow builds unsigned APK and runs API35 instrumentation in GitHub; add API24 gate and use CI as necessary. Signing remains local.
