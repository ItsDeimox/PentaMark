# Windows packaged smoke diagnosis

2026-10-22. No installed application or real vault touched.

CI runs 39849545072 and 39850393784 compiled Windows successfully but failed isolated startup. Local packaged runtime stderr reproduced native `CreateEnvironment` assertion `isolate_data->snapshot_data() != nullptr`, before application JavaScript. Original Electron43.3.0 and a renamed copy ran an isolated minimal script; run-as-node probes worked with and without IPC. Disabling executable editing and then ASAR both reproduced the assertion, rejecting resource-corruption hypotheses. No such packaging change is retained.

Root cause: `[Environment]::SetEnvironmentVariable(name,$null,'Process')` on this PowerShell/.NET preserves an empty environment entry. A child Node probe returned `{exists:true,value:''}` for ELECTRON_RUN_AS_NODE. `Remove-Item Env:ELECTRON_RUN_AS_NODE` returned `{exists:false}`. Electron bootstrap distinguishes presence and value, making the test harness itself abort the GUI runtime. The smoke now removes entries through the environment provider and restores absent versus empty originals faithfully.

RED: ordinary build failed in exclusive fixture `pentamark-smoke-596f78979118481caaa1408df79702eb`, launcher7300 aborted. GREEN: same ordinary packaged executable, corrected script, exclusive fixture `pentamark-smoke-047059efd7fe490e8c56ea69fba7e5b8`; startup, private fixture marker, bundled frontend and note write/read passed in2.3s. Script retains diagnostic stdout/stderr capture on failure. New final release still needs rebuild and CI smoke.

Discarded evidence: earlier fixture ce89d7e9131e470aab042cadf8d0b8e0 reported success while a development diagnostic inadvertently reused its port/profile. It is not evidence for packaged startup. Subsequent RED/GREEN used separate fixtures without competing processes. Test-specific development process was terminated; no installed application processes targeted.

Android CI39850393784 failed SDK compilation at OsConstants.O_DIRECTORY; Android owner fixed in1801988 with descriptor validation. Native instrumentation still not reached at that checkpoint.
