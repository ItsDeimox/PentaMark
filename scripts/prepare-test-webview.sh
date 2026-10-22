#!/usr/bin/env bash
# CI emulator dependency only. Never run this against a personal device.
set -euxo pipefail
[[ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" == '24' ]] || exit 0
mkdir -p device-evidence
url='https://github.com/JonaNorman/WebViewPackage/releases/download/google/119.0.6045.53_min24_x86.apk'
apk='device-evidence/webview-119.apk'
curl --fail --location --retry 2 --max-time 120 "$url" -o "$apk"
echo '149e15c24ed24fcda4817a871054e84bb52fd8b9dfbea1fa732db3bd271a1f3a  device-evidence/webview-119.apk' | sha256sum -c -
# Authenticate the archive against the certificate already trusted by Google's
# emulator image, not merely a certificate name or the download's own metadata.
trusted=$(adb shell pm path com.google.android.webview | tr -d '\r' | sed -n 's/^package://p' | head -n 1)
[[ "$trusted" == /* ]]
adb pull "$trusted" device-evidence/system-webview.apk
java -jar offline-android/apksigner.jar verify --print-certs device-evidence/system-webview.apk > device-evidence/system-webview-certificate.txt
java -jar offline-android/apksigner.jar verify --print-certs "$apk" > device-evidence/test-webview-certificate.txt
old_cert=$(grep 'Signer.*certificate SHA-256 digest:' device-evidence/system-webview-certificate.txt | head -n 1 | awk '{print $NF}')
new_cert=$(grep 'Signer.*certificate SHA-256 digest:' device-evidence/test-webview-certificate.txt | head -n 1 | awk '{print $NF}')
[[ -n "$old_cert" && "$old_cert" == "$new_cert" ]]
timeout 90s adb install -r "$apk"
adb shell pm enable com.google.android.webview
adb shell cmd webviewupdate set-webview-implementation com.google.android.webview
adb shell dumpsys webviewupdate > device-evidence/webview-provider.txt
grep -E 'Current WebView package.*com.google.android.webview.*119\.0\.6045\.53' device-evidence/webview-provider.txt
# Do not upload third-party binary dependencies as release/test artifacts.
rm -- "$apk" device-evidence/system-webview.apk
