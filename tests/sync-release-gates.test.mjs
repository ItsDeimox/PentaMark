import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';
test('legacy workflow cannot publish a Windows-only release',()=>{
 const source=readFileSync('.github/workflows/publish-app.yml','utf8'),workflow=YAML.parse(source);
 assert.equal(workflow.permissions.contents,'read');assert.doesNotMatch(source,/gh release create|softprops\/action-gh-release|electron-builder[^\n]*--publish always/);
});
test('validated pair requires same-SHA Windows and supported native Android gate',()=>{
 const w=YAML.parse(readFileSync('.github/workflows/offline-sync.yml','utf8'));
 assert.deepEqual(w.jobs['validated-pair'].needs,['windows','android-build','android-device']);assert.deepEqual(w.jobs['android-device'].strategy.matrix.api,[35]);
 assert.ok(w.jobs.windows.steps.some(s=>s.run==='node --test tests/native-desktop-offline.test.mjs'));
 assert.ok(w.jobs['android-device'].steps.some(s=>s.with?.name==='offline-sync-android-${{ github.sha }}'));
 const script=readFileSync('scripts/verify-android-offline-device.sh','utf8');assert.match(script,/SyncHostInteropTest -e pmHostPort/);assert.match(script,/check_result device-evidence\/interop.txt/);
});
