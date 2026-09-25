import { randomUUID } from 'crypto';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { closeDb, openDb } from './db';
import { createProfile, deleteProfile, getProfile, listProfiles, rowToProfile, updateProfile } from './profiles';
import { generateFingerprint } from '../fingerprint/generate';
import type { Fingerprint } from '../types/fingerprint';

const FP: Fingerprint = generateFingerprint({ os: 'windows', seed: 'profiles-test' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: DatabaseSync;

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  closeDb(db);
});

describe('openDb', () => {
  it('runs the v1 migration and is idempotent on reopen', () => {
    const file = path.join(tmpdir(), `foxmask-test-${randomUUID()}.db`);
    try {
      const first = openDb(file);
      const version = first.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(version.user_version).toBe(2);
      closeDb(first);
      // Reopening the same file must not fail or re-apply statements destructively.
      const second = openDb(file);
      const again = second.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(again.user_version).toBe(2);
      const created = createProfile(second, { name: 'persisted', fingerprint: FP });
      expect(getProfile(second, created.id)?.name).toBe('persisted');
      closeDb(second);
    } finally {
      for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
    }
  });
});

describe('createProfile / getProfile', () => {
  it('round-trips a profile with fingerprint JSON preserved', () => {
    const row = createProfile(db, {
      name: 'shop-01',
      group_id: 'ecom',
      tags: ['work', 'paypal'],
      note: 'primary shop account',
      startup_urls: ['https://example.com', 'https://mail.example.com'],
      raw_proxy: 'socks5://u:p@1.2.3.4:1080',
      fingerprint: FP
    });
    expect(row.id).toMatch(/[0-9a-f-]{36}/);
    expect(row.created_at).toBe(row.updated_at);

    const got = getProfile(db, row.id);
    expect(got).toBeDefined();
    expect(got).toEqual(row);
    expect(JSON.parse(got!.fingerprint_json)).toEqual(FP); // fingerprint survives JSON round-trip
  });

  it('applies defaults for optional fields', () => {
    const row = createProfile(db, { name: 'bare', fingerprint: FP });
    expect(row.group_id).toBe('default');
    expect(row.tags).toBe('[]');
    expect(row.startup_urls).toBe('[]');
    expect(row.note).toBe('');
    expect(row.raw_proxy).toBe('');
  });

  it('returns undefined for an unknown id', () => {
    expect(getProfile(db, randomUUID())).toBeUndefined();
  });
});

describe('rowToProfile', () => {
  it('parses tags, startup_urls and fingerprint into a domain Profile', () => {
    const row = createProfile(db, {
      name: 'mapped',
      tags: ['a', 'b'],
      startup_urls: ['https://x.dev'],
      fingerprint: FP
    });
    const profile = rowToProfile(row);
    expect(profile.tags).toEqual(['a', 'b']);
    expect(profile.startup_urls).toEqual(['https://x.dev']);
    expect(profile.fingerprint).toEqual(FP);
    expect(profile.id).toBe(row.id);
    expect(profile.name).toBe('mapped');
  });
});

describe('updateProfile', () => {
  it('changes only patched fields and bumps updated_at', async () => {
    const row = createProfile(db, {
      name: 'original',
      tags: ['keep'],
      note: 'old note',
      fingerprint: FP
    });
    await sleep(15); // ensure a measurable timestamp difference
    const updated = updateProfile(db, row.id, { name: 'renamed', note: 'new note' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('renamed');
    expect(updated!.note).toBe('new note');
    expect(updated!.tags).toBe('["keep"]'); // untouched field survives
    expect(updated!.created_at).toBe(row.created_at);
    expect(Date.parse(updated!.updated_at)).toBeGreaterThan(Date.parse(row.updated_at));
    expect(Date.parse(updated!.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.created_at));
  });

  it('serializes array and fingerprint patches', () => {
    const row = createProfile(db, { name: 'patched', fingerprint: FP });
    const fp2 = generateFingerprint({ os: 'macos', seed: 'patched' });
    const updated = updateProfile(db, row.id, {
      tags: ['x', 'y'],
      startup_urls: ['https://start.dev'],
      fingerprint: fp2,
      raw_proxy: 'http://5.6.7.8:3128'
    });
    expect(JSON.parse(updated!.tags)).toEqual(['x', 'y']);
    expect(JSON.parse(updated!.startup_urls)).toEqual(['https://start.dev']);
    expect(JSON.parse(updated!.fingerprint_json)).toEqual(fp2);
    expect(updated!.raw_proxy).toBe('http://5.6.7.8:3128');
  });

  it('returns undefined for an unknown id', () => {
    expect(updateProfile(db, randomUUID(), { name: 'nope' })).toBeUndefined();
  });
});

describe('deleteProfile', () => {
  it('deletes once and reports false on the second attempt', () => {
    const row = createProfile(db, { name: 'gone', fingerprint: FP });
    expect(deleteProfile(db, row.id)).toBe(true);
    expect(getProfile(db, row.id)).toBeUndefined();
    expect(deleteProfile(db, row.id)).toBe(false);
  });
});

describe('listProfiles', () => {
  beforeEach(async () => {
    // Insert with spacing so created_at (ISO ms) is strictly ordered and deterministic.
    const names = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'alpha-one', 'alpha-two', 'beta-one'];
    for (const name of names) {
      createProfile(db, { name, fingerprint: FP });
      await sleep(5);
    }
  });

  it('paginates with total and last_page', () => {
    const page1 = listProfiles(db, { page: 1, page_size: 4 });
    expect(page1.total).toBe(10);
    expect(page1.rows).toHaveLength(4);
    expect(page1.last_page).toBe(3);
    const page3 = listProfiles(db, { page: 3, page_size: 4 });
    expect(page3.rows).toHaveLength(2);
    // Out-of-range page: no rows, totals unchanged.
    const page9 = listProfiles(db, { page: 9, page_size: 4 });
    expect(page9.rows).toHaveLength(0);
    expect(page9.last_page).toBe(3);
  });

  it('defaults to page 1 / page_size 30', () => {
    const all = listProfiles(db, {});
    expect(all.rows).toHaveLength(10);
    expect(all.last_page).toBe(1);
  });

  it('sorts by all four sort codes', () => {
    // 0 = newest first (beta-one was created last)
    expect(listProfiles(db, { sort: 0 }).rows[0].name).toBe('beta-one');
    // 1 = oldest first
    expect(listProfiles(db, { sort: 1 }).rows[0].name).toBe('p1');
    // 2 = name asc
    const asc = listProfiles(db, { sort: 2 }).rows.map((r) => r.name);
    expect(asc[0]).toBe('alpha-one');
    expect(asc[asc.length - 1]).toBe('p7');
    // 3 = name desc
    const desc = listProfiles(db, { sort: 3 }).rows.map((r) => r.name);
    expect(desc[0]).toBe('p7');
    expect(desc[desc.length - 1]).toBe('alpha-one');
  });

  it('searches by name (case-insensitive LIKE) with pagination', () => {
    const hit = listProfiles(db, { search: 'alpha' });
    expect(hit.total).toBe(2);
    expect(hit.rows.map((r) => r.name).sort()).toEqual(['alpha-one', 'alpha-two']);
    const exact = listProfiles(db, { search: 'ALPHA-ONE' });
    expect(exact.total).toBe(1);
    expect(exact.rows[0].name).toBe('alpha-one');
    const none = listProfiles(db, { search: 'zzz-no-match' });
    expect(none.total).toBe(0);
    expect(none.rows).toHaveLength(0);
    expect(none.last_page).toBe(1);
    // Search composes with sort + pagination. 'p' matches p1..p7 plus 'alpha-*'.
    const paged = listProfiles(db, { search: 'p', page: 1, page_size: 3, sort: 2 });
    expect(paged.total).toBe(9);
    expect(paged.rows.map((r) => r.name)).toEqual(['alpha-one', 'alpha-two', 'p1']);
  });
});
