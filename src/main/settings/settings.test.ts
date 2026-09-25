import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb, closeDb } from '../db/db';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from './settings';

let db: DatabaseSync;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('settings store', () => {
  it('returns defaults on a fresh database', () => {
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a patch and coerces types on read', () => {
    saveSettings(db, { apiPort: 36000, launchAtLogin: true, chromiumPath: '/usr/bin/chromium' });
    const settings = getSettings(db);
    expect(settings.apiPort).toBe(36000);
    expect(settings.launchAtLogin).toBe(true);
    expect(settings.chromiumPath).toBe('/usr/bin/chromium');
    expect(settings.dataDir).toBe('');
  });

  it('upserts: second save overwrites, does not duplicate', () => {
    saveSettings(db, { apiPort: 36000 });
    saveSettings(db, { apiPort: 37000 });
    expect(getSettings(db).apiPort).toBe(37000);
  });

  it('ignores unknown keys', () => {
    saveSettings(db, { apiPort: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveSettings(db, { evil: 'nope' } as any);
    expect(getSettings(db).apiPort).toBe(1);
  });
});

afterEach(() => {
  closeDb(db);
});
