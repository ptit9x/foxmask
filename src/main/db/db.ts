import { readFileSync } from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

/** Path to the DDL bundle applied at migration v1. */
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Open (or create) the Foxmask SQLite database and bring its schema up to the
 * latest migration version, tracked via `PRAGMA user_version`.
 *
 * Returns the raw DatabaseSync so callers (tests included) can inject it into
 * the profile CRUD functions instead of relying on module-global state.
 */
export function openDb(filePath: string): DatabaseSync {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/** Close a database opened by openDb. Safe to call twice. */
export function closeDb(db: DatabaseSync): void {
  try {
    db.close();
  } catch {
    // Already closed — nothing to do.
  }
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as Record<string, unknown>;
  let version = Number(row?.user_version ?? 0);

  if (version < 1) {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    for (const stmt of schema.split(';')) {
      const sql = stmt.trim();
      if (sql) db.exec(sql);
    }
    db.exec('PRAGMA user_version = 1');
    version = 1;
  }

  if (version < 2) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
    );
    db.exec('PRAGMA user_version = 2');
    version = 2;
  }
}
