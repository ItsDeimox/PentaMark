import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA busy_timeout=5000');
  return db;
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
