import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyInstrumentation} from '../scripts/verify-instrumentation-result.mjs';
const expected='com.pentagory.pentamark.SyncHostInteropTest#realHostOfflineConflictPushAndNestedFolderRename';
const record=code=>`INSTRUMENTATION_STATUS: class=com.pentagory.pentamark.SyncHostInteropTest\nINSTRUMENTATION_STATUS: test=realHostOfflineConflictPushAndNestedFolderRename\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
test('interop gate rejects assumption skips even with JUnit OK summary',()=>{assert.throws(()=>verifyInstrumentation(record(-4)+'OK (1 test)\n',expected),/skipped|failed/);});
test('interop gate requires the exact expected successful test, not just a summary',()=>{assert.throws(()=>verifyInstrumentation('OK (1 test)\n',expected),/completion/);assert.throws(()=>verifyInstrumentation(record(0).replace('SyncHostInteropTest','OtherTest')+'OK (1 test)',expected),/completion/);});
test('interop gate accepts actual completed test and rejects zero/failure outcomes',()=>{assert.equal(verifyInstrumentation(record(1)+record(0)+'OK (1 test)\nINSTRUMENTATION_CODE: -1',expected),1);assert.throws(()=>verifyInstrumentation('OK (0 tests)'));assert.throws(()=>verifyInstrumentation(record(-2)+'FAILURES!!!'));});
