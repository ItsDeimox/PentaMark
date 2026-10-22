import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';
test('legacy workflow cannot publish a Windows-only release',()=>{
 const source=readFileSync('.github/workflows/publish-app.yml','utf8'),workflow=YAML.parse(source);
 assert.equal(workflow.permissions.contents,'read');assert.doesNotMatch(source,/gh release create|softprops\/action-gh-release|electron-builder[^\n]*--publish always/);
});
test('API24 runtime dependency is hash-pinned and signature-matched to the system before install',()=>{
 const script=readFileSync('scripts/prepare-test-webview.sh','utf8');
 assert.match(script,/149e15c24ed24fcda4817a871054e84bb52fd8b9dfbea1fa732db3bd271a1f3a/);
 assert.match(script,/\$old_cert" == "\$new_cert/);
 assert.ok(script.indexOf('$old_cert" == "$new_cert')<script.indexOf('adb install -r'));
 const config=readFileSync('capacitor.config.ts','utf8');assert.match(config,/minWebViewVersion: 119/);assert.match(config,/errorPath: 'webview-required.html'/);
 const page=readFileSync('public/webview-required.html','utf8');assert.doesNotMatch(page,/<script/i);assert.match(page,/Não limpe os dados/);
});
test('validated pair requires same-SHA Windows and both native Android API gates',()=>{
 const w=YAML.parse(readFileSync('.github/workflows/offline-sync.yml','utf8'));
 assert.deepEqual(w.jobs['validated-pair'].needs,['windows','android-build','android-device']);assert.deepEqual(w.jobs['android-device'].strategy.matrix.api,[24,35]);
 assert.ok(w.jobs.windows.steps.some(s=>s.run==='node --test tests/native-desktop-offline.test.mjs'));
 assert.ok(w.jobs['android-device'].steps.some(s=>s.with?.name==='offline-sync-android-${{ github.sha }}'));
 const script=readFileSync('scripts/verify-android-offline-device.sh','utf8');assert.match(script,/SyncHostInteropTest -e pmHostPort/);assert.match(script,/check_result device-evidence\/interop.txt/);
});
