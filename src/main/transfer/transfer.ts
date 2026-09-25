import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createProfile, getProfile, type CreateProfileInput } from '../db/profiles';
import { rowToProfile } from '../db/profiles';
import type { Profile, ProfileRow } from '../types/profile';
import { FINGERPRINT_SCHEMA_VERSION } from '../types/fingerprint';
import type { Fingerprint } from '../types/fingerprint';

/**
 * Profile import/export (JSON).
 *
 * Export shape: { version, exported_at, profiles: [...] } — fingerprints ride
 * along verbatim so an imported profile keeps its frozen identity.
 * Import validates the fingerprint schema version and skips duplicates (same
 * id) with per-item results, so a partial import never fails the whole batch.
 */

const EXPORT_VERSION = 1;

export interface ExportEnvelope {
  version: number;
  exported_at: string;
  profiles: Profile[];
}

export interface ImportOutcome {
  imported: string[];
  skipped: { id: string; reason: string }[];
}

/** Build the export envelope from full Profile objects. */
export function buildExport(profiles: Profile[]): ExportEnvelope {
  return {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    profiles
  };
}

/**
 * Parse + validate an export envelope (JSON string). Throws on structural
 * errors; returns the inner profile list on success.
 */
export function parseImport(text: string): Profile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('import file is not valid JSON');
  }
  const env = parsed as Partial<ExportEnvelope>;
  if (typeof env.version !== 'number' || !Array.isArray(env.profiles)) {
    throw new Error('import file is not a Foxmask export (missing version/profiles)');
  }
  if (env.version > EXPORT_VERSION) {
    throw new Error(`export version ${env.version} is newer than supported (${EXPORT_VERSION})`);
  }
  return env.profiles;
}

const REQUIRED_FP_FIELDS = ['os', 'userAgent', 'platform', 'screen', 'timezone'] as const;

function validFingerprint(fp: unknown): fp is Fingerprint {
  if (typeof fp !== 'object' || fp === null) return false;
  const rec = fp as Record<string, unknown>;
  return REQUIRED_FP_FIELDS.every((key) => key in rec);
}

/**
 * Import profiles into the db: new ids are inserted verbatim (fingerprint
 * preserved), existing ids are skipped. Returns per-item outcomes.
 */
export function importProfiles(db: DatabaseSync, profiles: Profile[]): ImportOutcome {
  const imported: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const p of profiles) {
    const id = typeof p.id === 'string' && p.id !== '' ? p.id : randomUUID();
    if (getProfile(db, id)) {
      skipped.push({ id, reason: 'duplicate id' });
      continue;
    }
    if (!validFingerprint(p.fingerprint)) {
      skipped.push({ id, reason: `fingerprint schema v${FINGERPRINT_SCHEMA_VERSION} required` });
      continue;
    }
    const input: CreateProfileInput = {
      name: typeof p.name === 'string' && p.name !== '' ? p.name : 'Imported profile',
      group_id: p.group_id || 'default',
      tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
      note: typeof p.note === 'string' ? p.note : '',
      startup_urls: Array.isArray(p.startup_urls)
        ? p.startup_urls.filter((u): u is string => typeof u === 'string')
        : [],
      raw_proxy: typeof p.raw_proxy === 'string' ? p.raw_proxy : '',
      fingerprint: p.fingerprint
    };
    createProfile(db, { ...input, id });
    imported.push(id);
  }

  return { imported, skipped };
}

/** Convenience: full round-trip — parse text and insert. */
export function importFromText(db: DatabaseSync, text: string): ImportOutcome {
  return importProfiles(db, parseImport(text));
}

/** Load all profiles as domain objects (for the export button). */
export function exportAll(db: DatabaseSync, listAll: (db: DatabaseSync) => ProfileRow[]): ExportEnvelope {
  return buildExport(listAll(db).map(rowToProfile));
}
