import type { DatabaseSync } from 'node:sqlite';
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  rowToProfile,
  updateProfile,
  type ListProfilesOptions,
  type ListProfilesResult,
  type UpdateProfileInput
} from '../db/profiles';
import { generateFingerprint } from '../fingerprint/generate';
import { getSettings, saveSettings, type AppSettings } from '../settings/settings';
import { buildExport, importFromText, type ExportEnvelope, type ImportOutcome } from '../transfer/transfer';
import type { Fingerprint } from '../types/fingerprint';
import type { LaunchResult } from '../launcher/launch';
import type { CheckProxyFn, LauncherLike, LauncherStatus } from '../api/server';
import type { ProxyCheckResult } from '../proxy/check';
import type { Profile } from '../types/profile';

/**
 * Typed IPC bridge handlers (invoke-style request/response).
 *
 * Plain module — must never import 'electron' so it stays testable in
 * vitest. registerIpcHandlers takes any ipcMainLike satisfying
 * { handle(channel, fn) }; electron's real ipcMain matches structurally.
 * All rows are converted with rowToProfile before returning so the renderer
 * never sees stringly rows.
 */

/**
 * Structural ipcMain slice: register an invoke handler for a channel.
 * Args are any[] to match electron's own ipcMain.handle typings, letting
 * strongly-typed wrapped handlers below stay assignable.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export interface IpcMainLike {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  handle(channel: string, fn: (event: unknown, ...args: any[]) => unknown): void;
}

/** Services the handlers need; AppServices from services.ts satisfies this. */
export interface IpcServices {
  db: DatabaseSync;
  launcher: LauncherLike;
  checkProxy: CheckProxyFn;
  /** App version (from electron's app.getVersion() in main, fixed in tests). */
  version: string;
  /** Port the local API server actually bound. */
  apiPort: number;
  /** Root data dir (~/.foxmask or FOXMASK_HOME). */
  dataDir: string;
}

/** Info about the running app served over the app:info channel. */
export interface AppInfoResult {
  version: string;
  apiPort: number;
  dataDir: string;
}

/** List result with rows fully converted to domain Profiles. */
export interface ProfileListResult {
  rows: Profile[];
  total: number;
  last_page: number;
}

/**
 * Renderer payload for profiles:create. Unlike the db-level
 * CreateProfileInput it carries no fingerprint — the handler generates one
 * from the optional os/seed, mirroring POST /api/v1/profiles.
 */
export interface CreateProfileRequest {
  name: string;
  group_id?: string;
  tags?: string[];
  note?: string;
  startup_urls?: string[];
  raw_proxy?: string;
  /** Fingerprint OS; defaults to 'windows'. */
  os?: string;
  /** Deterministic fingerprint seed; random when omitted. */
  seed?: string;
}

const OS_VALUES: ReadonlySet<string> = new Set(['windows', 'macos', 'linux', 'android']);

/**
 * Wrap a handler: any thrown error is re-thrown as a plain Error carrying only
 * the underlying message — no stack, no engine internals leak to the renderer
 * (fastify-style error hygiene).
 */
function wrap<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult
): (event: unknown, ...args: TArgs) => Promise<TResult> {
  return async (_event: unknown, ...args: TArgs): Promise<TResult> => {
    try {
      return await fn(...args);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  };
}

/** Extract a string arg (undefined when not a string). */
function strArg(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Validate a renderer-supplied profile name. */
function requireName(name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('name is required');
  }
  return name.trim();
}

/** Fetch the profile row or throw 'profile not found'. */
function requireProfile(services: IpcServices, id: string): Profile {
  const row = getProfile(services.db, id);
  if (!row) throw new Error('profile not found');
  return rowToProfile(row);
}

/**
 * Register every Foxmask IPC channel on ipcMainLike. Handlers are plain
 * closures over services; re-registering a channel replaces the previous
 * handler (ipcMain.handle semantics).
 */
export function registerIpcHandlers(ipcMainLike: IpcMainLike, services: IpcServices): void {
  ipcMainLike.handle(
    'profiles:list',
    wrap((opts?: ListProfilesOptions): ProfileListResult => {
      const result: ListProfilesResult = listProfiles(services.db, opts ?? {});
      return { ...result, rows: result.rows.map(rowToProfile) };
    })
  );

  ipcMainLike.handle(
    'profiles:get',
    wrap((id: string): Profile | null => {
      const row = getProfile(services.db, id);
      return row ? rowToProfile(row) : null;
    })
  );

  ipcMainLike.handle(
    'profiles:create',
    wrap((input: CreateProfileRequest): Profile => {
      const name = requireName(input?.name);
      const os = input?.os ?? 'windows';
      if (typeof os !== 'string' || !OS_VALUES.has(os)) {
        throw new Error(`os must be one of ${[...OS_VALUES].join(', ')}`);
      }
      const fingerprint = generateFingerprint({
        os: os as Profile['fingerprint']['os'],
        seed: strArg(input?.seed)
      });
      const row = createProfile(services.db, {
        name,
        group_id: strArg(input?.group_id),
        tags: Array.isArray(input?.tags) ? input.tags : undefined,
        note: strArg(input?.note),
        startup_urls: Array.isArray(input?.startup_urls) ? input.startup_urls : undefined,
        raw_proxy: strArg(input?.raw_proxy),
        fingerprint
      });
      return rowToProfile(row);
    })
  );

  ipcMainLike.handle(
    'profiles:update',
    wrap((id: string, patch: UpdateProfileInput): Profile | null => {
      const row = updateProfile(services.db, id, patch ?? {});
      return row ? rowToProfile(row) : null;
    })
  );

  ipcMainLike.handle(
    'profiles:delete',
    wrap((id: string): { deleted: boolean } => {
      return { deleted: deleteProfile(services.db, id) };
    })
  );

  ipcMainLike.handle(
    'profiles:duplicate',
    wrap((id: string): Profile => {
      const source = requireProfile(services, id);
      // Fresh seed → a brand-new fingerprint; proxy/group/tags/note/urls carry over.
      const fingerprint = generateFingerprint({ os: source.fingerprint.os });
      const row = createProfile(services.db, {
        name: `${source.name} (copy)`,
        group_id: source.group_id,
        tags: source.tags,
        note: source.note,
        startup_urls: source.startup_urls,
        raw_proxy: source.raw_proxy,
        fingerprint
      });
      return rowToProfile(row);
    })
  );

  ipcMainLike.handle(
    'profiles:start',
    wrap(async (id: string): Promise<LaunchResult> => {
      const profile = requireProfile(services, id);
      return services.launcher.start(profile);
    })
  );

  ipcMainLike.handle(
    'profiles:stop',
    wrap(async (id: string): Promise<{ stopped: boolean }> => {
      return { stopped: await services.launcher.stop(id) };
    })
  );

  ipcMainLike.handle(
    'profiles:status',
    wrap((id: string): LauncherStatus => {
      return services.launcher.getStatus(id);
    })
  );

  ipcMainLike.handle(
    'proxies:check',
    wrap(async (raw: string): Promise<ProxyCheckResult> => {
      return services.checkProxy(raw);
    })
  );

  ipcMainLike.handle(
    'fingerprints:preview',
    wrap((input: { os?: string; seed?: string }): Fingerprint => {
      const os = input?.os ?? 'windows';
      if (typeof os !== 'string' || !OS_VALUES.has(os)) {
        throw new Error(`os must be one of ${[...OS_VALUES].join(', ')}`);
      }
      return generateFingerprint({
        os: os as Profile['fingerprint']['os'],
        seed: strArg(input?.seed)
      });
    })
  );

  ipcMainLike.handle(
    'app:info',
    wrap((): AppInfoResult => {
      return { version: services.version, apiPort: services.apiPort, dataDir: services.dataDir };
    })
  );

  ipcMainLike.handle(
    'settings:get',
    wrap((): AppSettings => {
      return getSettings(services.db);
    })
  );

  ipcMainLike.handle(
    'profiles:export',
    wrap((): ExportEnvelope => {
      const result = listProfiles(services.db, { page: 1, page_size: 100000 });
      return buildExport(result.rows.map(rowToProfile));
    })
  );

  ipcMainLike.handle(
    'profiles:import',
    wrap((text: string): ImportOutcome => {
      if (typeof text !== 'string' || text.trim() === '') {
        throw new Error('import text is required');
      }
      return importFromText(services.db, text);
    })
  );

  ipcMainLike.handle(
    'settings:set',
    wrap((patch: Partial<AppSettings>): AppSettings => {
      return saveSettings(services.db, patch ?? {});
    })
  );
}
