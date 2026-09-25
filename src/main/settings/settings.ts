import type { DatabaseSync } from 'node:sqlite';

/**
 * App settings persisted in SQLite (key-value). Written by the Settings page,
 * read at startup. Migration to user_version 2 creates the table.
 */

export interface AppSettings {
  /** Local REST API port preference (actual port may differ on fallback). */
  apiPort: number;
  /** Directory holding profile user-data dirs and the database. */
  dataDir: string;
  /** Chromium executable override; empty = managed/dev-cache default. */
  chromiumPath: string;
  /** Launch Foxmask when the user logs in. */
  launchAtLogin: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiPort: 35000,
  dataDir: '',
  chromiumPath: '',
  launchAtLogin: false
};

const VALID_KEYS = new Set<keyof AppSettings>(['apiPort', 'dataDir', 'chromiumPath', 'launchAtLogin']);

function coerce(key: keyof AppSettings, raw: string): string | number | boolean {
  if (key === 'apiPort') return Number(raw);
  if (key === 'launchAtLogin') return raw === 'true';
  return raw;
}

/** Read all settings, falling back to defaults for missing keys. */
export function getSettings(db: DatabaseSync): AppSettings {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (VALID_KEYS.has(row.key as keyof AppSettings)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(out as any)[row.key] = coerce(row.key as keyof AppSettings, row.value)
    }
  }
  return out;
}

/** Persist a partial settings patch (upsert per key). */
export function saveSettings(db: DatabaseSync, patch: Partial<AppSettings>): AppSettings {
  const upsert = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!VALID_KEYS.has(key as keyof AppSettings)) continue;
    upsert.run(key, String(value));
  }
  return getSettings(db);
}
