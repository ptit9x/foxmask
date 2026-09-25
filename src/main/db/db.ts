import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

/**
 * DDL applied at migration v1. Kept in a separate schema.sql for readability,
 * with an embedded copy as the packaged-app fallback: electron-vite does not
 * copy the .sql into the asar, and reading from the asar is fragile anyway.
 */
const SCHEMA_SQL_FALLBACK = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_id TEXT NOT NULL DEFAULT 'default',
  tags TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  startup_urls TEXT NOT NULL DEFAULT '[]',
  raw_proxy TEXT NOT NULL DEFAULT '',
  fingerprint_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS proxies (
  id TEXT PRIMARY KEY, name TEXT, raw TEXT NOT NULL,
  last_check_at TEXT, last_status TEXT
);
`;

/** Load the v1 DDL: prefer the sibling schema.sql, fall back to the embedded copy. */
function loadSchemaSql(): string {
  const primary = path.join(__dirname, 'schema.sql');
  if (existsSync(primary)) return readFileSync(primary, 'utf8');
  return SCHEMA_SQL_FALLBACK;
}

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
    const schema = loadSchemaSql();
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
