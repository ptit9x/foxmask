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
