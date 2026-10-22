import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertSupportedNode} from '../local/runtime-version.mjs';
test('standalone runtime rejects older Node before SQLite host initialization',()=>{
 for(const v of ['20.20.0','22.21.0','24.0.0','24.18.0','invalid'])assert.throws(()=>assertSupportedNode(v),/24\.18\.1/);
 for(const v of ['24.18.1','24.19.0','25.0.0'])assert.doesNotThrow(()=>assertSupportedNode(v));
});
