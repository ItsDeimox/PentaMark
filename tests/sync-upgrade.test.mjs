import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../local/sync/database.mjs';

test('future metadata schema is refused without creating tables or changing its bytes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pm-upgrade-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'store.sqlite');
 const future=new DatabaseSync(path);future.exec("PRAGMA user_version=99; CREATE TABLE future_notes(value TEXT); INSERT INTO future_notes VALUES('preserve');");future.close();const before=await readFile(path);
 assert.throws(()=>{const unexpected=openDatabase(path);unexpected.close();},/unsupported-schema/);assert.deepEqual(await readFile(path),before);
 const check=new DatabaseSync(path,{readOnly:true});try{assert.equal(check.prepare('PRAGMA user_version').get().user_version,99);assert.equal(check.prepare('SELECT value FROM future_notes').get().value,'preserve');assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='entries'").get().n,0);}finally{check.close();}
});
test('schema initialization is versioned and idempotent without discarding retained versions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pm-upgrade-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'store.sqlite');
 let db=openDatabase(path);db.prepare('INSERT INTO versions VALUES(?,?,?)').run('revision','entry','retained');assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);db.close();
 db=openDatabase(path);try{assert.equal(db.prepare('SELECT version FROM versions').get().version,'retained');assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);}finally{db.close();}
});
