#!/usr/bin/env bash
set -euo pipefail
mkdir -p device-evidence
fixture_pid=''
cleanup() {
  adb logcat -d > device-evidence/logcat.txt || true
  if [[ -n "$fixture_pid" ]]; then kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" || true; fi
}
trap cleanup EXIT
adb install -r offline-android/app-debug.apk
adb install -r offline-android/app-debug-androidTest.apk
# Only this disposable CI emulator: block actual external traffic, not merely
# a vendor-dependent radio setting. Loopback remains for fixture HTTP and ADB.
adb root
adb wait-for-device
adb shell 'iptables -I OUTPUT 1 ! -o lo -j REJECT'
adb shell 'ip6tables -I OUTPUT 1 ! -o lo -j REJECT'
adb shell 'iptables -C OUTPUT ! -o lo -j REJECT'
adb shell 'ip6tables -C OUTPUT ! -o lo -j REJECT'
adb shell 'iptables -S OUTPUT; ip6tables -S OUTPUT' > device-evidence/network-isolation.txt
check_result() {
  cat "$1"
  node scripts/verify-instrumentation-result.mjs "$1" "${2:-}"
}
# Separate instrumentation process isolates legacy URL-factory state from the
# real host test; neither process allows external network traffic in WebView.
adb shell am instrument -w -r -e notClass com.pentagory.pentamark.SyncHostInteropTest,com.pentagory.pentamark.SyncProcessRestartTest com.pentagory.pentamark.test/androidx.test.runner.AndroidJUnitRunner > device-evidence/instrumentation.txt
check_result device-evidence/instrumentation.txt
adb shell am instrument -w -r -e class com.pentagory.pentamark.SyncProcessRestartTest#seedOfflinePending com.pentagory.pentamark.test/androidx.test.runner.AndroidJUnitRunner > device-evidence/process-seed.txt
check_result device-evidence/process-seed.txt com.pentagory.pentamark.SyncProcessRestartTest#seedOfflinePending
adb shell am force-stop com.pentagory.pentamark
adb shell am instrument -w -r -e class com.pentagory.pentamark.SyncProcessRestartTest#verifyOfflinePending com.pentagory.pentamark.test/androidx.test.runner.AndroidJUnitRunner > device-evidence/process-reopen.txt
check_result device-evidence/process-reopen.txt com.pentagory.pentamark.SyncProcessRestartTest#verifyOfflinePending
node tests/fixtures/android-interop-host.mjs 35491 > device-evidence/interop-host.txt 2>&1 &
fixture_pid=$!
for attempt in $(seq 1 60); do
  if grep -q 'INTEROP_READY' device-evidence/interop-host.txt; then break; fi
  kill -0 "$fixture_pid"
  sleep 1
done
grep -q 'INTEROP_READY' device-evidence/interop-host.txt
adb reverse tcp:35491 tcp:35491
adb shell am instrument -w -r -e class com.pentagory.pentamark.SyncHostInteropTest -e pmHostPort 35491 com.pentagory.pentamark.test/androidx.test.runner.AndroidJUnitRunner > device-evidence/interop.txt
check_result device-evidence/interop.txt com.pentagory.pentamark.SyncHostInteropTest#realHostOfflineConflictPushAndNestedFolderRename
