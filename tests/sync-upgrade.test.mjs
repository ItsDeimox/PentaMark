import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../local/sync/database.mjs';

test('future metadata schema is refused without creating tables or changing its bytes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pm-upgrade-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'store.sqlite');
 const future=new DatabaseSync(path);future.exec("PRAGMA user_version=99; CREATE TABLE future_notes(value TEXT); INSERT INTO future_notes VALUES('preserve');");future.close();const before=await readFile(path);
 assert.throws(()=>{const unexpected=openDatabase(path);unexpected.close();},/unsupported-schema/);assert.deepEqual(await readFile(path),before);
 const check=new DatabaseSync(path,{readOnly:true});try{assert.equal(check.prepare('PRAGMA user_version').get().user_version,99);assert.equal(check.prepare('SELECT value FROM future_notes').get().value,'preserve');assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='entries'").get().n,0);}finally{check.close();}
});

test('unversioned previous schema retains pending/conflict/intent rows and creates a closed pre-upgrade backup',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pm-upgrade-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'store.sqlite');
 const old=new DatabaseSync(path);
 // Literal previous-format fixture, not initialized with the implementation under test.
 old.exec(`CREATE TABLE pending_ops(op_id TEXT PRIMARY KEY, operation TEXT NOT NULL);
 CREATE TABLE conflicts(conflict_id TEXT PRIMARY KEY, conflict TEXT NOT NULL);
 CREATE TABLE file_intents(intent_id TEXT PRIMARY KEY, intent TEXT NOT NULL);
 CREATE TABLE versions(revision TEXT PRIMARY KEY,entry_id TEXT NOT NULL,version TEXT NOT NULL);
 INSERT INTO pending_ops VALUES('op-A','{"content":"local pending"}');
 INSERT INTO conflicts VALUES('conflict-A','{"local":"local version","remote":"remote version"}');
 INSERT INTO file_intents VALUES('intent-A','{"old":"old bytes","new":"new bytes"}');
 INSERT INTO versions VALUES('rev-A','entry-A','{"content":"retained base"}');`);
 const tables=['pending_ops','conflicts','file_intents','versions'];const before=Object.fromEntries(tables.map(name=>[name,old.prepare('SELECT * FROM '+name).all()]));old.close();
 const migrated=openDatabase(path);try{assert.equal(migrated.prepare('PRAGMA user_version').get().user_version,1);for(const name of tables)assert.deepEqual(migrated.prepare('SELECT * FROM '+name).all(),before[name]);}finally{migrated.close();}
 const backups=(await readdir(root)).filter(name=>name.startsWith('store.sqlite.pre-schema-1-'));assert.equal(backups.length,1);
 const backup=new DatabaseSync(join(root,backups[0]),{readOnly:true});try{assert.equal(backup.prepare('PRAGMA user_version').get().user_version,0);for(const name of tables)assert.deepEqual(backup.prepare('SELECT * FROM '+name).all(),before[name]);}finally{backup.close();}
 const reopened=openDatabase(path);reopened.close();assert.equal((await readdir(root)).filter(name=>name.startsWith('store.sqlite.pre-schema-1-')).length,1);
});

test('failed migration rolls back DDL and schema marker while retaining prior data and backup',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pm-upgrade-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'store.sqlite');
 const old=new DatabaseSync(path);old.exec("CREATE TABLE pending_ops(op_id TEXT PRIMARY KEY,operation TEXT NOT NULL); INSERT INTO pending_ops VALUES('pending','keep'); CREATE INDEX versions ON pending_ops(operation);");old.close();
 assert.throws(()=>openDatabase(path),/versions/);
 const check=new DatabaseSync(path);try{assert.equal(check.prepare('PRAGMA user_version').get().user_version,0);assert.equal(check.prepare('SELECT operation FROM pending_ops').get().operation,'keep');assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='vaults'").get().n,0);}finally{check.close();}
 assert.equal((await readdir(root)).filter(name=>name.startsWith('store.sqlite.pre-schema-1-')).length,1);
});
test('schema initialization is versioned and idempotent without discarding retained versions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pm-upgrade-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'store.sqlite');
 let db=openDatabase(path);db.prepare('INSERT INTO versions VALUES(?,?,?)').run('revision','entry','retained');assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);db.close();
 db=openDatabase(path);try{assert.equal(db.prepare('SELECT version FROM versions').get().version,'retained');assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);}finally{db.close();}
});
