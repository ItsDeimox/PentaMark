# Task10 upgrade/release gates in progress

No release yet. Existing signing identity must be reused; never generate replacement credentials. EXE/APK must match the same final source SHA/version, and signature/hash verification must precede joint publication. Latest known public release remains2.13.21.

## Node metadata downgrade guard
Added `PRAGMA user_version` schema1. Newer metadata versions reject before journal/DDL changes; the opened handle closes on every failure. Existing unversioned v1 tables are initialized idempotently, with DDL plus version marker in one transaction. No destructive migration/reset is permitted. Replica JSON state already rejects schema other than1.

RED2/2: futureversion99 was accepted/modified, freshstore version remained0. GREEN102/102: new2upgrade tests plus host-store anddesktop-store regressions. Futurefile test checks byte-identical database, preserved sentinel, no new entries table. Existinghistory survivesreopen. Real SQLite/files use disposablefixtures; Windows hardlinks require elevatedtestprocess. Source files database.mjs andtests/sync-upgrade.test.mjs. Independent review pending.

## CI gates
Windows job39853168341 passed compile, unit/sync tests, portableEXE build and correctedisolatedstartupsmoke. Android stopped JVMtestcompile atJSONObject.keySet, subsequentlyfixed c7e6a57; run39854392445 nowvalidatinge2064f4. No Androidinstrumentation success claimedyet.

Added reproducible packagecommands test:sync and test:sync:ui; Windows workflow installsChromium and runs offlineeditor/legacyremote/conflictDOM tests beforepackaging. NativeWindowsoffline acceptance test worker stillinprogress; controllerwillwireits explicitgate. Workflow artifactsretainUIevidence evenfailure. Noautomaticpublishingenabled.
