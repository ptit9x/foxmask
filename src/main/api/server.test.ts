import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { closeDb, openDb } from '../db/db';
import { generateFingerprint } from '../fingerprint/generate';
import type { Profile } from '../types/profile';
import { AlreadyRunningError, type LaunchResult } from '../launcher/launch';
import type { ProxyCheckResult } from '../proxy/check';
import { buildServer, isLoopback, type ApiDeps, type LauncherStatus } from './server';

/**
 * API v1 tests — everything via fastify.inject (no real listen, no Electron).
 * DB is a fresh in-memory sqlite per test; the launcher is a fake backed by a
 * Map that mimics AlreadyRunningError semantics; checkProxy is a stub.
 */

/** Fake launcher: in-memory running map + call recording for assertions. */
class FakeLauncher {
  readonly started: Profile[] = [];
  readonly stopped: string[] = [];
  private readonly running = new Map<string, LaunchResult>();

  async start(profile: Profile): Promise<LaunchResult> {
    this.started.push(profile);
    if (this.running.has(profile.id)) throw new AlreadyRunningError(profile.id);
    const result: LaunchResult = {
      profileId: profile.id,
      wsEndpoint: `ws://127.0.0.1:9999/devtools/browser/${profile.id}`,
      debugPort: 9999,
      startedAt: new Date().toISOString()
    };
    this.running.set(profile.id, result);
    return result;
  }

  async stop(id: string): Promise<boolean> {
    this.stopped.push(id);
    return this.running.delete(id);
  }

  getStatus(id: string): LauncherStatus {
    const last = this.running.get(id);
    return {
      running: this.running.has(id),
      wsEndpoint: last?.wsEndpoint ?? null,
      debugPort: last?.debugPort ?? null,
      startedAt: last?.startedAt ?? null
    };
  }
}

const OK_PROXY: ProxyCheckResult = {
  ok: true,
  ip: '1.2.3.4',
  latencyMs: 42,
  geo: { country: 'Vietnam', countryCode: 'VN', city: 'Hanoi', timezone: 'Asia/Ho_Chi_Minh' }
};
const FAIL_PROXY: ProxyCheckResult = { ok: false, error: 'connect ETIMEDOUT 1.2.3.4:1080' };

/** Reconfigurable checkProxy stub: result defaults to OK_PROXY. */
function stubCheckProxy() {
  const calls: string[] = [];
  let result: ProxyCheckResult = OK_PROXY;
  const fn = async (raw: string): Promise<ProxyCheckResult> => {
    calls.push(raw);
    return result;
  };
  return {
    fn,
    calls,
    setResult: (r: ProxyCheckResult) => {
      result = r;
    }
  };
}

let db: DatabaseSync;
let launcher: FakeLauncher;
let proxy: ReturnType<typeof stubCheckProxy>;
let app: FastifyInstance;

function makeApp(): FastifyInstance {
  const deps: ApiDeps = { db, launcher, checkProxy: proxy.fn };
  return buildServer(deps);
}

/** POST a profile and return its id. */
async function seedProfile(name = 'shop-01'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/profiles', payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

beforeEach(() => {
  db = openDb(':memory:');
  launcher = new FakeLauncher();
  proxy = stubCheckProxy();
  app = makeApp();
});

afterEach(async () => {
  await app.close();
  closeDb(db);
});

describe('GET /health', () => {
  it('answers ok outside the /api/v1 prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('isLoopback', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.0.0.0', true],
    ['127.255.255.254', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['::FFFF:127.3.0.4', true],
    ['192.168.1.5', false],
    ['10.0.0.2', false],
    ['::ffff:8.8.8.8', false],
    ['fe80::1', false],
    ['localhost', false],
    ['', false],
    [null, false],
    [undefined, false]
  ])('%s → %s', (addr, expected) => {
    expect(isLoopback(addr as string | null | undefined)).toBe(expected);
  });
});

describe('POST /api/v1/profiles', () => {
  it('creates a profile (201) with a generated fingerprint and defaults', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: { name: 'shop-01', tags: ['work'], startup_urls: ['https://example.com'] }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('shop-01');
    expect(body.data.group_id).toBe('default');
    expect(body.data.tags).toEqual(['work']);
    expect(body.data.startup_urls).toEqual(['https://example.com']);
    expect(body.data.fingerprint.os).toBe('windows'); // os default
    expect(body.data.fingerprint.userAgent).toMatch(/Windows/i);
  });

  it('honors os + seed (deterministic fingerprint)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: { name: 'mac', os: 'macos', seed: 'seed-a' }
    });
    expect(res.statusCode).toBe(201);
    const fp = res.json().data.fingerprint;
    expect(fp.os).toBe('macos');
    expect(fp.userAgent).toMatch(/Macintosh/i);

    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: { name: 'mac2', os: 'macos', seed: 'seed-a' }
    });
    expect(again.json().data.fingerprint).toEqual(fp);
  });

  it('rejects a missing name with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/profiles', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });

  it('rejects a bad os with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: { name: 'x', os: 'sunos' }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });
});

describe('GET /api/v1/profiles (list)', () => {
  it('paginates with defaults page=1 page_size=30 and omits fingerprint detail', async () => {
    for (let i = 1; i <= 3; i++) await seedProfile(`p-${i}`);
    const res = await app.inject({ method: 'GET', url: '/api/v1/profiles' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(3);
    expect(body.data.rows).toHaveLength(3);
    expect(body.data.last_page).toBe(1);
    for (const row of body.data.rows) {
      expect(row.fingerprint).toBeUndefined();
      expect(row.fingerprint_json).toBeUndefined();
      expect(Array.isArray(row.tags)).toBe(true);
    }
    // default sort is newest-first; same-ms inserts tie-break on id, so only
    // assert membership + no fingerprint leakage here
    expect(body.data.rows.map((r: { name: string }) => r.name).sort()).toEqual([
      'p-1',
      'p-2',
      'p-3'
    ]);
  });

  it('applies page/page_size/search params', async () => {
    for (let i = 1; i <= 5; i++) await seedProfile(`alpha-${i}`);
    await seedProfile('beta-1');

    // sort=2 is name asc — deterministic across same-ms inserts
    const page2 = await app.inject({
      method: 'GET',
      url: '/api/v1/profiles?page=2&page_size=2&sort=2'
    });
    const body2 = page2.json().data;
    expect(body2.total).toBe(6);
    expect(body2.last_page).toBe(3);
    expect(body2.rows.map((r: { name: string }) => r.name)).toEqual(['alpha-3', 'alpha-4']);

    const search = await app.inject({ method: 'GET', url: '/api/v1/profiles?search=beta' });
    expect(search.json().data.total).toBe(1);
    expect(search.json().data.rows[0].name).toBe('beta-1');
  });
});

describe('GET /api/v1/profiles/:id', () => {
  it('returns the full profile with parsed fingerprint', async () => {
    const id = await seedProfile('full');
    const res = await app.inject({ method: 'GET', url: `/api/v1/profiles/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(id);
    expect(body.data.fingerprint).toBeDefined();
    expect(typeof body.data.fingerprint.userAgent).toBe('string');
  });

  it('404s unknown ids with the envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/profiles/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ success: false, message: 'not found' });
  });
});

describe('PUT /api/v1/profiles/:id', () => {
  it('updates scalar and array fields', async () => {
    const id = await seedProfile('before');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/profiles/${id}`,
      payload: { name: 'after', note: 'hi', tags: ['a', 'b'], raw_proxy: 'socks5://1.2.3.4:1080' }
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.name).toBe('after');
    expect(data.note).toBe('hi');
    expect(data.tags).toEqual(['a', 'b']);
    expect(data.raw_proxy).toBe('socks5://1.2.3.4:1080');
  });

  it('ignores a fingerprint field in the payload (not updatable via PUT)', async () => {
    const id = await seedProfile('keep-fp');
    const before = (await app.inject({ method: 'GET', url: `/api/v1/profiles/${id}` })).json()
      .data.fingerprint;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/profiles/${id}`,
      payload: { name: 'renamed', fingerprint: { os: 'linux', userAgent: 'FAKE/1.0' } }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('renamed');
    expect(res.json().data.fingerprint).toEqual(before);
  });

  it('404s unknown ids', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/profiles/nope',
      payload: { name: 'x' }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().success).toBe(false);
  });
});

describe('POST /api/v1/profiles/:id/regenerate', () => {
  it('changes the fingerprint but not the name', async () => {
    const id = await seedProfile('stable-name');
    const before = (await app.inject({ method: 'GET', url: `/api/v1/profiles/${id}` })).json()
      .data;
    // create used a random seed; regenerate with a pinned one and compare
    // against the generator directly (fully deterministic)
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/profiles/${id}/regenerate`,
      payload: { seed: 'regen-seed-1' }
    });
    expect(res.statusCode).toBe(200);
    const after = res.json().data;
    expect(after.name).toBe(before.name);
    expect(after.fingerprint).toEqual(generateFingerprint({ os: 'windows', seed: 'regen-seed-1' }));
    expect(after.fingerprint).not.toEqual(before.fingerprint);
  });

  it('regenerates deterministically for a given os+seed', async () => {
    const id = await seedProfile('det');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/profiles/${id}/regenerate`,
      payload: { os: 'linux', seed: 'seed-x' }
    });
    expect(res.json().data.fingerprint.os).toBe('linux');
    expect(res.json().data.fingerprint.userAgent).toMatch(/Linux/i);
  });

  it('404s unknown ids', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles/nope/regenerate',
      payload: {}
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/v1/profiles/:id', () => {
  it('deletes an existing profile', async () => {
    const id = await seedProfile('gone');
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/profiles/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    const after = await app.inject({ method: 'GET', url: `/api/v1/profiles/${id}` });
    expect(after.statusCode).toBe(404);
  });

  it('404s unknown ids', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/profiles/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().success).toBe(false);
  });
});

describe('start / status / stop lifecycle', () => {
  it('start → running status → stop → not running', async () => {
    const id = await seedProfile('run');

    const start = await app.inject({ method: 'POST', url: `/api/v1/profiles/${id}/start` });
    expect(start.statusCode).toBe(200);
    const startBody = start.json();
    expect(startBody.success).toBe(true);
    expect(startBody.data).toMatchObject({ profileId: id, wsEndpoint: expect.any(String), debugPort: 9999 });
    expect(startBody.data.startedAt).toBeDefined();
    expect(launchedProfile(launcher).id).toBe(id); // launcher got the full profile

    const status = await app.inject({ method: 'GET', url: `/api/v1/profiles/${id}/status` });
    expect(status.json().data).toMatchObject({ running: true, debugPort: 9999 });

    const stop = await app.inject({ method: 'POST', url: `/api/v1/profiles/${id}/stop` });
    expect(stop.statusCode).toBe(200);
    expect(stop.json().success).toBe(true);

    const after = await app.inject({ method: 'GET', url: `/api/v1/profiles/${id}/status` });
    expect(after.json().data.running).toBe(false);
  });

  it('double-start answers 200 with "already running" and current status', async () => {
    const id = await seedProfile('dbl');
    const first = await app.inject({ method: 'POST', url: `/api/v1/profiles/${id}/start` });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: `/api/v1/profiles/${id}/start` });
    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('already running');
    expect(body.data.running).toBe(true);
    expect(body.data.wsEndpoint).toBe(first.json().data.wsEndpoint);
  });

  it('start on an unknown profile 404s', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/profiles/nope/start' });
    expect(res.statusCode).toBe(404);
  });

  it('stop on an unknown profile 404s', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/profiles/nope/stop' });
    expect(res.statusCode).toBe(404);
  });

  it('status for a never-started profile reports not running with nulls', async () => {
    const id = await seedProfile('idle');
    const res = await app.inject({ method: 'GET', url: `/api/v1/profiles/${id}/status` });
    expect(res.json().data).toEqual({
      running: false,
      wsEndpoint: null,
      debugPort: null,
      startedAt: null
    });
  });
});

function launchedProfile(l: FakeLauncher): Profile {
  expect(l.started).toHaveLength(1);
  return l.started[0];
}

describe('POST /api/v1/proxies/check', () => {
  it('passes a successful check through as {success, data}', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/proxies/check',
      payload: { raw: 'socks5://1.2.3.4:1080' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: OK_PROXY });
    expect(proxy.calls).toEqual(['socks5://1.2.3.4:1080']);
  });

  it('passes a failed check through as {success:false, message} (still HTTP 200)', async () => {
    proxy.setResult(FAIL_PROXY);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/proxies/check',
      payload: { raw: 'http://bad:3128' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, data: null, message: FAIL_PROXY.error });
  });

  it('400s when raw is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/proxies/check', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });
});

describe('unknown routes & envelope', () => {
  it('unknown API routes 404 in the envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nothing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ success: false, message: 'not found' });
  });
});
