#!/usr/bin/env bash
set -euxo pipefail
mkdir -p device-evidence
fixture_pid=''
cleanup() {
  timeout 15s adb logcat -d > device-evidence/logcat.txt || true
  if [[ -n "$fixture_pid" ]]; then kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" || true; fi
}
trap cleanup EXIT
timeout 90s adb install -r offline-android/app-debug.apk
timeout 90s adb install -r offline-android/app-debug-androidTest.apk
bash scripts/prepare-test-webview.sh
# Disposable emulator only: block the app UID, preserving the older emulator's
# ADB transport. A global OUTPUT block can sever the test-control connection.
timeout 30s adb root
timeout 30s adb wait-for-device
app_uid=$(timeout 30s adb shell stat -c %u /data/user/0/com.pentagory.pentamark | tr -d '\r')
[[ "$app_uid" =~ ^[0-9]+$ ]] && [[ "$app_uid" -ge 10000 ]]
timeout 30s adb shell "iptables -I OUTPUT 1 ! -o lo -m owner --uid-owner $app_uid -j REJECT"
timeout 30s adb shell "ip6tables -I OUTPUT 1 ! -o lo -m owner --uid-owner $app_uid -j REJECT"
timeout 30s adb shell "iptables -C OUTPUT ! -o lo -m owner --uid-owner $app_uid -j REJECT"
timeout 30s adb shell "ip6tables -C OUTPUT ! -o lo -m owner --uid-owner $app_uid -j REJECT"
timeout 30s adb shell 'iptables -S OUTPUT; ip6tables -S OUTPUT' > device-evidence/network-isolation.txt
check_result() {
  cat "$1"
  node scripts/verify-instrumentation-result.mjs "$1" "${2:-}"
}
# Separate instrumentation process isolates legacy URL-factory state from the
# real host test; neither process allows external network traffic in WebView.
timeout 300s adb shell am instrument -w -r -e notClass com.pentagory.pentamark.SyncHostInteropTest,com.pentagory.pentamark.SyncProcessRestartTest com.pentagory.pentamark.test/androidx.test.runner.AndroidJUnitRunner > device-evidence/instrumentation.txt
check_result device-evidence/instrumentation.txt
timeout 60s adb shell am instrument -w -r -e class com.pentagory.pentamark.SyncProcessRestartTest#seedOfflinePending com.pentagory.pentamark.test/androidx.test.runner.AndroidJUnitRunner > device-evidence/process-seed.txt
check_result device-evidence/process-seed.txt com.pentagory.pentamark.SyncProcessRestartTest#seedOfflinePending
timeout 30s adb shell am force-stop com.pentagory.pentamark
timeout 60s adb shell am instrument -w -r -e class com.pentagory.pentamark.SyncProcessRestartTest#verifyOfflinePending com.pentagory.pentamark.test/androidx.test.runner.AndroidJUnitRunner > device-evidence/process-reopen.txt
check_result device-evidence/process-reopen.txt com.pentagory.pentamark.SyncProcessRestartTest#verifyOfflinePending
node tests/fixtures/android-interop-host.mjs 35491 > device-evidence/interop-host.txt 2>&1 &
fixture_pid=$!
for attempt in $(seq 1 60); do
  if grep -q 'INTEROP_READY' device-evidence/interop-host.txt; then break; fi
  kill -0 "$fixture_pid"
  sleep 1
done
grep -q 'INTEROP_READY' device-evidence/interop-host.txt
timeout 30s adb reverse tcp:35491 tcp:35491
timeout 240s adb shell am instrument -w -r -e class com.pentagory.pentamark.SyncHostInteropTest -e pmHostPort 35491 com.pentagory.pentamark.test/androidx.test.runner.AndroidJUnitRunner > device-evidence/interop.txt
check_result device-evidence/interop.txt com.pentagory.pentamark.SyncHostInteropTest#realHostOfflineConflictPushAndNestedFolderRename
