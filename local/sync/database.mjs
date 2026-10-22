import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  try {
    // Refuse newer stores before changing journal mode or issuing any DDL.
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('unsupported-schema');
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON');
    const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8').replace(/^PRAGMA[^;]*;\s*/gm, '');
    transaction(db, () => { db.exec(schema); db.exec('PRAGMA user_version=1'); });
    return db;
  } catch (error) { db.close(); throw error; }
}
export function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

// A dedicated SQLite lock is released by the OS on crash; no stale PID guessing.
// Keep it separate from WAL metadata so readers can inspect committed history.
export function acquireWriter(path) {
  const lock = new DatabaseSync(path);
  try { lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE'); }
  catch (error) { lock.close(); throw new Error('host-already-open', { cause: error }); }
  return () => lock.close();
}
