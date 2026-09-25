import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  AlreadyRunningError,
  findFreePort,
  resolveDataDir,
  type LaunchResult
} from '../launcher/launch';
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  rowToProfile,
  updateProfile,
  type UpdateProfileInput
} from '../db/profiles';
import { generateFingerprint } from '../fingerprint/generate';
import type { ProxyCheckResult } from '../proxy/check';
import type { Profile, ProfileRow } from '../types/profile';

/**
 * Local REST API (v1).
 *
 * Fastify server exposing profile CRUD, browser launch control and proxy
 * checking, wrapped in a GPM-style envelope {success, data, message}.
 * Loopback-only: every /api/v1 route is guarded by a preHandler that rejects
 * non-loopback client addresses with 403.
 *
 * All dependencies (db, launcher, checkProxy) are injected — this module must
 * never import 'electron' so it stays testable in plain Node/vitest.
 */

/** Default API port (GPM-compatible). */
export const DEFAULT_PORT = 35000;

/** Status snapshot the API serves for a profile (Launcher.getStatus shape). */
export interface LauncherStatus {
  running: boolean;
  wsEndpoint: string | null;
  debugPort: number | null;
  startedAt: string | null;
}

/** Structural slice of Launcher the API needs; test fakes satisfy this. */
export interface LauncherLike {
  start(profile: Profile): Promise<LaunchResult>;
  stop(profileId: string): Promise<boolean>;
  getStatus(profileId: string): LauncherStatus;
}

/** Injected proxy checker (src/main/proxy/check.ts or a test stub). */
export type CheckProxyFn = (raw: string, timeoutMs?: number) => Promise<ProxyCheckResult>;

export interface ApiDeps {
  db: DatabaseSync;
  launcher: LauncherLike;
  checkProxy: CheckProxyFn;
}

const OS_VALUES: ReadonlySet<string> = new Set(['windows', 'macos', 'linux', 'android']);

/**
 * True when the address is IPv4 loopback (127.0.0.0/8), IPv6 loopback (::1,
 * including a zone index like ::1%eth0) or a v4-mapped IPv6 loopback
 * (::ffff:127.x.x.x). Everything else — LAN, public, v4-mapped public — false.
 */
export function isLoopback(addr: string | null | undefined): boolean {
  if (!addr) return false;
  let a = addr.trim().toLowerCase();
  const zone = a.indexOf('%');
  if (zone !== -1) a = a.slice(0, zone);
  if (a.startsWith('::ffff:')) a = a.slice('::ffff:'.length);
  return a === '::1' || a.startsWith('127.');
}

/** List-row shape: everything except the fingerprint, arrays parsed. */
interface LightProfileRow extends Omit<ProfileRow, 'tags' | 'startup_urls' | 'fingerprint_json'> {
  tags: string[];
  startup_urls: string[];
}

/** Strip the fingerprint and parse the JSON array columns for list responses. */
function toLightRow(row: ProfileRow): LightProfileRow {
  return {
    id: row.id,
    name: row.name,
    group_id: row.group_id,
    tags: JSON.parse(row.tags),
    note: row.note,
    startup_urls: JSON.parse(row.startup_urls),
    raw_proxy: row.raw_proxy,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}

/** string → itself, undefined → undefined (anything else is rejected earlier). */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Parse an integer query param with a fallback; rejects non-integers/low values. */
function intParam(value: unknown, fallback: number, min: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

/** 4xx/5xx envelope sender. */
function fail(reply: FastifyReply, code: number, message: string): FastifyReply {
  return reply.code(code).send({ success: false, data: null, message });
}

/** Fetch the profile row or answer 404; returns null when the reply was sent. */
function requireProfile(
  deps: ApiDeps,
  id: string,
  reply: FastifyReply
): ProfileRow | null {
  const row = getProfile(deps.db, id);
  if (!row) {
    fail(reply, 404, 'not found');
    return null;
  }
  return row;
}

/**
 * Build the Fastify instance (not listening). Routes live under /api/v1 with
 * the loopback guard; /health is unprefixed and unguarded.
 */
export function buildServer(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // Keep every error — including fastify's own JSON/validation errors — in
  // the envelope so clients always parse the same shape.
  app.setErrorHandler((err: Error & { statusCode?: number }, _request, reply) => {
    fail(reply, err.statusCode ?? 500, err.message);
  });
  app.setNotFoundHandler((_request, reply) => {
    fail(reply, 404, 'not found');
  });

  app.get('/health', async () => ({ ok: true }));

  app.register(
    async (scope) => {
      // Loopback-only guard for every v1 route.
      scope.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!isLoopback(request.ip)) {
          return fail(reply, 403, 'forbidden: loopback only');
        }
      });

      scope.get('/profiles', async (request) => {
        const q = (request.query ?? {}) as Record<string, string | undefined>;
        const sortRaw = Number(q.sort);
        const sort = (
          Number.isInteger(sortRaw) && sortRaw >= 0 && sortRaw <= 3 ? sortRaw : 0
        ) as 0 | 1 | 2 | 3;
        const result = listProfiles(deps.db, {
          page: intParam(q.page, 1, 1),
          page_size: intParam(q.page_size, 30, 1),
          search: q.search?.trim() || undefined,
          sort
        });
        return { success: true, data: { ...result, rows: result.rows.map(toLightRow) } };
      });

      scope.get('/profiles/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const row = requireProfile(deps, id, reply);
        if (!row) return reply;
        return { success: true, data: rowToProfile(row) };
      });

      scope.post('/profiles', async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>;

        const name = body.name;
        if (typeof name !== 'string' || name.trim() === '') {
          return fail(reply, 400, 'name is required');
        }
        const os = body.os ?? 'windows';
        if (typeof os !== 'string' || !OS_VALUES.has(os)) {
          return fail(reply, 400, `os must be one of ${[...OS_VALUES].join(', ')}`);
        }
        for (const field of ['tags', 'startup_urls'] as const) {
          if (body[field] !== undefined && !isStringArray(body[field])) {
            return fail(reply, 400, `${field} must be an array of strings`);
          }
        }

        const fingerprint = generateFingerprint({
          os: os as Profile['fingerprint']['os'],
          seed: str(body.seed)
        });
        const row = createProfile(deps.db, {
          name: name.trim(),
          group_id: str(body.group_id),
          tags: isStringArray(body.tags) ? body.tags : undefined,
          note: str(body.note),
          startup_urls: isStringArray(body.startup_urls) ? body.startup_urls : undefined,
          raw_proxy: str(body.raw_proxy),
          fingerprint
        });
        return reply.code(201).send({ success: true, data: rowToProfile(row) });
      });

      scope.put('/profiles/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const row = requireProfile(deps, id, reply);
        if (!row) return reply;
        const body = (request.body ?? {}) as Record<string, unknown>;

        for (const field of ['tags', 'startup_urls'] as const) {
          if (body[field] !== undefined && !isStringArray(body[field])) {
            return fail(reply, 400, `${field} must be an array of strings`);
          }
        }

        // The fingerprint is intentionally NOT accepted here — it is only
        // changed via POST /profiles/:id/regenerate.
        const patch: UpdateProfileInput = {};
        if (str(body.name) !== undefined) patch.name = str(body.name);
        if (str(body.group_id) !== undefined) patch.group_id = str(body.group_id);
        if (str(body.note) !== undefined) patch.note = str(body.note);
        if (str(body.raw_proxy) !== undefined) patch.raw_proxy = str(body.raw_proxy);
        if (isStringArray(body.tags)) patch.tags = body.tags;
        if (isStringArray(body.startup_urls)) patch.startup_urls = body.startup_urls;

        const updated = updateProfile(deps.db, id, patch);
        if (!updated) return fail(reply, 404, 'not found');
        return { success: true, data: rowToProfile(updated) };
      });

      scope.post('/profiles/:id/regenerate', async (request, reply) => {
        const { id } = request.params as { id: string };
        const row = requireProfile(deps, id, reply);
        if (!row) return reply;
        const body = (request.body ?? {}) as Record<string, unknown>;

        const current = rowToProfile(row);
        const os = body.os === undefined ? current.fingerprint.os : body.os;
        if (typeof os !== 'string' || !OS_VALUES.has(os)) {
          return fail(reply, 400, `os must be one of ${[...OS_VALUES].join(', ')}`);
        }
        const fingerprint = generateFingerprint({
          os: os as Profile['fingerprint']['os'],
          seed: str(body.seed)
        });
        const updated = updateProfile(deps.db, id, { fingerprint });
        if (!updated) return fail(reply, 404, 'not found');
        return { success: true, data: rowToProfile(updated) };
      });

      scope.delete('/profiles/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!deleteProfile(deps.db, id)) return fail(reply, 404, 'not found');
        return { success: true, data: null, message: '' };
      });

      scope.post('/profiles/:id/start', async (request, reply) => {
        const { id } = request.params as { id: string };
        const row = requireProfile(deps, id, reply);
        if (!row) return reply;
        try {
          const result = await deps.launcher.start(rowToProfile(row));
          return { success: true, data: result };
        } catch (err) {
          if (err instanceof AlreadyRunningError) {
            // Idempotent-style 200: report the existing run instead of erroring.
            return {
              success: true,
              data: { profileId: id, ...deps.launcher.getStatus(id) },
              message: 'already running'
            };
          }
          throw err;
        }
      });

      scope.post('/profiles/:id/stop', async (request, reply) => {
        const { id } = request.params as { id: string };
        const row = requireProfile(deps, id, reply);
        if (!row) return reply;
        const stopped = await deps.launcher.stop(id);
        return { success: true, data: { profileId: id, stopped } };
      });

      scope.get('/profiles/:id/status', async (request) => {
        const { id } = request.params as { id: string };
        return { success: true, data: deps.launcher.getStatus(id) };
      });

      scope.post('/proxies/check', async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>;
        const raw = body.raw;
        if (typeof raw !== 'string' || raw.trim() === '') {
          return fail(reply, 400, 'raw is required');
        }
        const timeoutMs = typeof body.timeout_ms === 'number' ? body.timeout_ms : undefined;
        const result = await deps.checkProxy(raw, timeoutMs);
        if (result.ok) return { success: true, data: result };
        // A failed connectivity check is a valid answer, not a transport error.
        return { success: false, data: null, message: result.error };
      });
    },
    { prefix: '/api/v1' }
  );

  return app;
}

/**
 * Start the API on 127.0.0.1. When the preferred port is taken (EADDRINUSE)
 * fall back to a free port picked by binding a net server to :0. The chosen
 * port is written to <dataDir>/http.port so external tools can discover it.
 * Returns the port plus a close() that shuts the server down.
 */
export async function startApiServer(
  deps: ApiDeps,
  port: number = DEFAULT_PORT
): Promise<{ port: number; close: () => Promise<void> }> {
  const app = buildServer(deps);
  try {
    await app.listen({ host: '127.0.0.1', port });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') throw err;
    await app.listen({ host: '127.0.0.1', port: await findFreePort() });
  }

  const address = app.server.address();
  if (!address || typeof address !== 'object') {
    await app.close();
    throw new Error('startApiServer: server has no listen address');
  }

  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'http.port'), String(address.port), 'utf8');

  return { port: address.port, close: () => app.close() };
}
