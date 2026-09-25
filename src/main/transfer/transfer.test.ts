import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb, closeDb } from '../db/db';
import { listProfiles } from '../db/profiles';
import { generateFingerprint } from '../fingerprint/generate';
import {
  buildExport,
  parseImport,
  importProfiles,
  importFromText,
  exportAll
} from './transfer';
import type { Profile } from '../types/profile';

let db: DatabaseSync;

const FP = generateFingerprint({ os: 'windows', seed: 'import-test' });

function fixture(id: string, name: string): Profile {
  return {
    id,
    name,
    group_id: 'ecom',
    tags: ['a'],
    note: 'n',
    startup_urls: ['https://example.com'],
    raw_proxy: '',
    fingerprint: FP,
    created_at: '2026-09-25T00:00:00.000Z',
    updated_at: '2026-09-25T00:00:00.000Z'
  };
}

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  closeDb(db);
});

describe('buildExport / parseImport', () => {
  it('round-trips an export envelope', () => {
    const env = buildExport([fixture('p1', 'One'), fixture('p2', 'Two')]);
    const parsed = parseImport(JSON.stringify(env));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('One');
  });

  it('rejects non-JSON text', () => {
    expect(() => parseImport('{oops')).toThrow(/not valid JSON/);
  });

  it('rejects a foreign JSON shape', () => {
    expect(() => parseImport('{"hello": 1}')).toThrow(/not a Foxmask export/);
  });

  it('rejects a newer export version', () => {
    const env = buildExport([]);
    expect(() => parseImport(JSON.stringify({ ...env, version: 99 }))).toThrow(/newer/);
  });
});

describe('importProfiles', () => {
  it('inserts new profiles preserving id and fingerprint', () => {
    const result = importProfiles(db, [fixture('p1', 'One')]);
    expect(result.imported).toEqual(['p1']);
    expect(result.skipped).toEqual([]);
    const stored = listProfiles(db, {});
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].id).toBe('p1');
    expect(JSON.parse(stored.rows[0].fingerprint_json).userAgent).toBe(FP.userAgent);
  });

  it('skips duplicate ids and invalid fingerprints with reasons', () => {
    importProfiles(db, [fixture('p1', 'One')]);
    const bad = fixture('p2', 'Bad');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badFp = { ...bad, fingerprint: { nope: true } as any };

    const result = importProfiles(db, [fixture('p1', 'Dup'), badFp, fixture('p3', 'Good')]);
    expect(result.imported).toEqual(['p3']);
    expect(result.skipped).toEqual([
      { id: 'p1', reason: 'duplicate id' },
      { id: 'p2', reason: 'fingerprint schema v1 required' }
    ]);
  });

  it('importFromText chains parse + insert', () => {
    const text = JSON.stringify(buildExport([fixture('x1', 'X')]));
    const result = importFromText(db, text);
    expect(result.imported).toEqual(['x1']);
  });
});

describe('exportAll', () => {
  it('exports every stored profile', () => {
    importProfiles(db, [fixture('a', 'A'), fixture('b', 'B')]);
    const env = exportAll(db, (d) => listProfiles(d, { page: 1, page_size: 100 }).rows);
    expect(env.profiles.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });
});
