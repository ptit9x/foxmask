import { randomUUID } from 'crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Fingerprint } from '../types/fingerprint';
import type { Profile, ProfileRow } from '../types/profile';

export interface CreateProfileInput {
  /** Preserve a specific id (import); a fresh uuid when omitted. */
  id?: string;
  name: string;
  group_id?: string;
  tags?: string[];
  note?: string;
  startup_urls?: string[];
  raw_proxy?: string;
  fingerprint: Fingerprint;
}

/** Fields updateProfile accepts; arrays and the fingerprint are serialized on write. */
export interface UpdateProfileInput extends Partial<Omit<CreateProfileInput, 'fingerprint'>> {
  fingerprint?: Fingerprint;
}

export interface ListProfilesOptions {
  page?: number;
  page_size?: number;
  search?: string;
  sort?: 0 | 1 | 2 | 3;
}

export interface ListProfilesResult {
  rows: ProfileRow[];
  total: number;
  last_page: number;
}

/** Serialize an array field for storage ('[]' when empty). */
function jsonText(value: unknown[] | undefined): string {
  return JSON.stringify(value ?? []);
}

const CREATE_FIELDS = [
  'id',
  'name',
  'group_id',
  'tags',
  'note',
  'startup_urls',
  'raw_proxy',
  'fingerprint_json',
  'created_at',
  'updated_at'
] as const;

/** Insert a profile; id is a fresh UUID, timestamps are now (ISO). */
export function createProfile(db: DatabaseSync, input: CreateProfileInput): ProfileRow {
  const row: ProfileRow = {
    id: input.id ?? randomUUID(),
    name: input.name,
    group_id: input.group_id ?? 'default',
    tags: jsonText(input.tags),
    note: input.note ?? '',
    startup_urls: jsonText(input.startup_urls),
    raw_proxy: input.raw_proxy ?? '',
    fingerprint_json: JSON.stringify(input.fingerprint),
    created_at: new Date().toISOString(),
    updated_at: ''
  };
  row.updated_at = row.created_at;
  db.prepare(
    `INSERT INTO profiles (${CREATE_FIELDS.join(', ')})
     VALUES (${CREATE_FIELDS.map(() => '?').join(', ')})`
  ).run(...CREATE_FIELDS.map((f) => row[f]));
  return row;
}

/** Fetch one profile row by id, or undefined. */
export function getProfile(db: DatabaseSync, id: string): ProfileRow | undefined {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  return (row as Record<string, unknown> | undefined) as ProfileRow | undefined;
}

// Order columns for each sort code: 0=newest, 1=oldest, 2=name asc, 3=name desc.
const SORT_ORDER = ['updated_at DESC, created_at DESC, id DESC', 'created_at ASC, id ASC', 'name COLLATE NOCASE ASC, id ASC', 'name COLLATE NOCASE DESC, id DESC'] as const;

/** Paginated, searchable profile listing. */
export function listProfiles(db: DatabaseSync, opts: ListProfilesOptions = {}): ListProfilesResult {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, opts.page_size ?? 30);
  const sort: 0 | 1 | 2 | 3 = opts.sort ?? 0;

  const where = opts.search ? "WHERE name LIKE ? ESCAPE '\\' " : '';
  const params: (string | number)[] = [];
  if (opts.search) params.push(`%${escapeLike(opts.search)}%`);

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM profiles ${where}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT * FROM profiles ${where} ORDER BY ${SORT_ORDER[sort]} LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as unknown as ProfileRow[];

  return { rows, total, last_page: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Escape %, _ and \ inside a LIKE pattern. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Patch only the provided fields and bump updated_at. Unknown id → undefined. */
export function updateProfile(
  db: DatabaseSync,
  id: string,
  patch: UpdateProfileInput
): ProfileRow | undefined {
  const columns: string[] = [];
  const values: (string | number)[] = [];

  const scalar: Array<[keyof UpdateProfileInput, ProfileRow[keyof ProfileRow]]> = [
    ['name', typeof patch.name === 'string' ? patch.name : ''],
    ['group_id', typeof patch.group_id === 'string' ? patch.group_id : ''],
    ['note', typeof patch.note === 'string' ? patch.note : ''],
    ['raw_proxy', typeof patch.raw_proxy === 'string' ? patch.raw_proxy : '']
  ];
  for (const [key, value] of scalar) {
    if (patch[key] !== undefined) {
      columns.push(key as string);
      values.push(value as string);
    }
  }
  if (patch.tags !== undefined) {
    columns.push('tags');
    values.push(jsonText(patch.tags));
  }
  if (patch.startup_urls !== undefined) {
    columns.push('startup_urls');
    values.push(jsonText(patch.startup_urls));
  }
  if (patch.fingerprint !== undefined) {
    columns.push('fingerprint_json');
    values.push(JSON.stringify(patch.fingerprint));
  }

  if (columns.length === 0) return getProfile(db, id);

  columns.push('updated_at');
  values.push(new Date().toISOString());

  const result = db
    .prepare(`UPDATE profiles SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...values, id);
  if (result.changes === 0) return undefined;
  return getProfile(db, id);
}

/** Delete by id; true when a row was removed. */
export function deleteProfile(db: DatabaseSync, id: string): boolean {
  return db.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes > 0;
}

/** Convert a stored row into a domain Profile (parses the JSON columns). */
export function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    group_id: row.group_id,
    tags: JSON.parse(row.tags),
    note: row.note,
    startup_urls: JSON.parse(row.startup_urls),
    raw_proxy: row.raw_proxy,
    fingerprint: JSON.parse(row.fingerprint_json),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
