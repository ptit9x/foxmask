import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { closeDb, openDb } from '../db/db';
import type { Profile } from '../types/profile';
import { AlreadyRunningError, type LaunchResult } from '../launcher/launch';
import type { ProxyCheckResult } from '../proxy/check';
import type { LauncherStatus } from '../api/server';
import { registerIpcHandlers, type IpcMainLike, type IpcServices } from './handlers';

/**
 * IPC handler tests — everything through a fake ipcMainLike (no Electron).
 * DB is a fresh in-memory sqlite per test; the launcher is a fake backed by a
 * Map; checkProxy is a stub; app info is fixed. No file here may import
 * 'electron'.
 */

/** Fake ipcMain: captures registrations so tests can invoke them directly. */
class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(
    channel: string,
    fn: (event: unknown, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, fn);
  }
}

/** Fake launcher: in-memory running map + call recording for assertions. */
class FakeLauncher {
  readonly started: Profile[] = [];
  readonly stopped: string[] = [];
  /** When set, start() rejects with this instead of launching. */
  startError: Error | null = null;
  private readonly running = new Map<string, LaunchResult>();

  async start(profile: Profile): Promise<LaunchResult> {
    this.started.push(profile);
    if (this.startError) throw this.startError;
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
  ip: '9.9.9.9',
  latencyMs: 77,
  geo: { country: 'Vietnam', countryCode: 'VN', city: 'Hanoi', timezone: 'Asia/Ho_Chi_Minh' }
};
const FAIL_PROXY: ProxyCheckResult = { ok: false, error: 'connect ETIMEDOUT 9.9.9.9:1080' };

const APP_INFO = { version: '0.1.0-test', apiPort: 35000, dataDir: '/tmp/foxmask-test-home' };

let db: DatabaseSync;
let launcher: FakeLauncher;
let proxyCalls: string[];
let proxyResult: ProxyCheckResult;
let ipc: FakeIpcMain;

beforeEach(() => {
  db = openDb(':memory:');
  launcher = new FakeLauncher();
  proxyCalls = [];
  proxyResult = OK_PROXY;
  const checkProxy = async (raw: string): Promise<ProxyCheckResult> => {
    proxyCalls.push(raw);
    return proxyResult;
  };
  const services: IpcServices = {
    db,
    launcher,
    checkProxy,
    ...APP_INFO
  };
  ipc = new FakeIpcMain();
  registerIpcHandlers(ipc, services);
});

afterEach(() => {
  closeDb(db);
});

/** Invoke a registered channel; mirrors ipcRenderer.invoke semantics. */
function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = ipc.handlers.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return Promise.resolve(fn({}, ...args));
}

describe('registration', () => {
  it('registers every channel exactly once', () => {
    expect([...ipc.handlers.keys()].sort()).toEqual(
      [
        'app:info',
        'fingerprints:preview',
        'profiles:create',
        'profiles:delete',
        'profiles:duplicate',
        'profiles:export',
        'profiles:get',
        'profiles:import',
        'sync:start',
        'sync:stop',
        'sync:status',
        'sync:action',
        'profiles:list',
        'profiles:start',
        'profiles:status',
        'profiles:stop',
        'proxies:check',
        'settings:get',
        'settings:set',
        'profiles:update'
      ].sort()
    );
  });
});

describe('profiles:create', () => {
  it('creates a profile with defaults and a generated fingerprint', async () => {
    const created = (await invoke('profiles:create', {
      name: 'shop-01',
      tags: ['work'],
      startup_urls: ['https://example.com']
    })) as Profile;
    expect(created.name).toBe('shop-01');
    expect(created.group_id).toBe('default');
    expect(created.tags).toEqual(['work']);
    expect(created.startup_urls).toEqual(['https://example.com']);
    expect(created.raw_proxy).toBe('');
    expect(created.fingerprint.os).toBe('windows');
    expect(created.fingerprint.userAgent).toMatch(/Windows/i);
    expect(created.created_at).toBeTruthy();
  });

  it('honors os + seed deterministically', async () => {
    const a = (await invoke('profiles:create', { name: 'a', os: 'macos', seed: 's1' })) as Profile;
    const b = (await invoke('profiles:create', { name: 'b', os: 'macos', seed: 's1' })) as Profile;
    expect(a.fingerprint).toEqual(b.fingerprint);
    expect(a.fingerprint.userAgent).toMatch(/Macintosh/i);
  });

  it('rejects an empty name with "name is required"', async () => {
    await expect(invoke('profiles:create', { name: '' })).rejects.toThrow('name is required');
    await expect(invoke('profiles:create', { name: '   ' })).rejects.toThrow('name is required');
    await expect(invoke('profiles:create', {})).rejects.toThrow('name is required');
  });
});

describe('profiles:list', () => {
  it('returns typed rows (parsed arrays/fingerprint), not stringly rows', async () => {
    await invoke('profiles:create', { name: 'p-1' });
    await invoke('profiles:create', { name: 'p-2' });
    const result = (await invoke('profiles:list', { search: 'p-' })) as {
      rows: Profile[];
      total: number;
      last_page: number;
    };
    expect(result.total).toBe(2);
    expect(result.last_page).toBe(1);
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(Array.isArray(row.tags)).toBe(true);
      expect(Array.isArray(row.startup_urls)).toBe(true);
      expect(typeof row.fingerprint.userAgent).toBe('string');
      expect('fingerprint_json' in row).toBe(false);
    }
  });
});

describe('profiles:get', () => {
  it('returns the full profile for a known id', async () => {
    const created = (await invoke('profiles:create', { name: 'full' })) as Profile;
    const got = (await invoke('profiles:get', created.id)) as Profile;
    expect(got.id).toBe(created.id);
    expect(got.name).toBe('full');
    expect(got.fingerprint).toEqual(created.fingerprint);
  });

  it('returns null for an unknown id', async () => {
    expect(await invoke('profiles:get', 'nope')).toBeNull();
  });
});

describe('profiles:update', () => {
  it('patches fields and bumps updated_at', async () => {
    const created = (await invoke('profiles:create', { name: 'before' })) as Profile;
    const updated = (await invoke('profiles:update', created.id, {
      name: 'after',
      note: 'hi',
      tags: ['a', 'b'],
      raw_proxy: 'socks5://1.2.3.4:1080'
    })) as Profile;
    expect(updated.name).toBe('after');
    expect(updated.note).toBe('hi');
    expect(updated.tags).toEqual(['a', 'b']);
    expect(updated.raw_proxy).toBe('socks5://1.2.3.4:1080');
    expect(updated.updated_at >= created.updated_at).toBe(true);
  });

  it('returns null for an unknown id', async () => {
    expect(await invoke('profiles:update', 'nope', { name: 'x' })).toBeNull();
  });
});

describe('profiles:duplicate', () => {
  it('copies with "(copy)" suffix, a fresh fingerprint and the same proxy/group/tags', async () => {
    const original = (await invoke('profiles:create', {
      name: 'shop-01',
      group_id: 'g1',
      tags: ['t1', 't2'],
      note: 'keep me',
      raw_proxy: 'socks5://1.2.3.4:1080',
      startup_urls: ['https://example.com']
    })) as Profile;

    const copy = (await invoke('profiles:duplicate', original.id)) as Profile;
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('shop-01 (copy)');
    expect(copy.group_id).toBe('g1');
    expect(copy.tags).toEqual(['t1', 't2']);
    expect(copy.note).toBe('keep me');
    expect(copy.raw_proxy).toBe('socks5://1.2.3.4:1080');
    expect(copy.startup_urls).toEqual(['https://example.com']);
    expect(copy.fingerprint.os).toBe(original.fingerprint.os);
    expect(copy.fingerprint).not.toEqual(original.fingerprint);

    // Original is untouched.
    const still = (await invoke('profiles:get', original.id)) as Profile;
    expect(still.name).toBe('shop-01');
    expect(still.fingerprint).toEqual(original.fingerprint);
  });

  it('throws "profile not found" for an unknown id', async () => {
    await expect(invoke('profiles:duplicate', 'nope')).rejects.toThrow('profile not found');
  });
});

describe('profiles:delete', () => {
  it('deletes once then reports deleted:false', async () => {
    const created = (await invoke('profiles:create', { name: 'gone' })) as Profile;
    expect(await invoke('profiles:delete', created.id)).toEqual({ deleted: true });
    expect(await invoke('profiles:get', created.id)).toBeNull();
    expect(await invoke('profiles:delete', created.id)).toEqual({ deleted: false });
  });
});

describe('profiles:start / status / stop', () => {
  it('start → status(running) → stop → status(idle)', async () => {
    const created = (await invoke('profiles:create', { name: 'run' })) as Profile;

    const result = (await invoke('profiles:start', created.id)) as LaunchResult;
    expect(result.profileId).toBe(created.id);
    expect(result.wsEndpoint).toMatch(/^ws:\/\//);
    expect(result.debugPort).toBe(9999);
    expect(result.startedAt).toBeTruthy();

    // The launcher received the FULL parsed profile (fingerprint object, not JSON).
    expect(launchedProfile(launcher).id).toBe(created.id);
    expect(launchedProfile(launcher).fingerprint.userAgent).toBe(created.fingerprint.userAgent);

    const status = (await invoke('profiles:status', created.id)) as LauncherStatus;
    expect(status).toMatchObject({ running: true, debugPort: 9999 });

    expect(await invoke('profiles:stop', created.id)).toEqual({ stopped: true });
    const after = (await invoke('profiles:status', created.id)) as LauncherStatus;
    expect(after.running).toBe(false);
  });

  it('stop of a not-running profile reports stopped:false', async () => {
    const created = (await invoke('profiles:create', { name: 'idle' })) as Profile;
    expect(await invoke('profiles:stop', created.id)).toEqual({ stopped: false });
  });

  it('status for a never-started profile is idle with nulls', async () => {
    const created = (await invoke('profiles:create', { name: 'never' })) as Profile;
    expect(await invoke('profiles:status', created.id)).toEqual({
      running: false,
      wsEndpoint: null,
      debugPort: null,
      startedAt: null
    });
  });

  it('start of an unknown id throws "profile not found"', async () => {
    await expect(invoke('profiles:start', 'nope')).rejects.toThrow('profile not found');
  });

  it('surfaces the launcher error message without carrying engine frames', async () => {
    const created = (await invoke('profiles:create', { name: 'boom' })) as Profile;
    const original = new Error('boom: chromium not found');
    launcher.startError = original;
    const err = (await invoke('profiles:start', created.id).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    // A NEW Error carrying only the underlying message — not the thrown object,
    // so the engine's stack never crosses the bridge (Electron serializes
    // message-only anyway; in-process this is the observable equivalent).
    expect(err).not.toBe(original);
    expect(err.message).toBe('boom: chromium not found');
    expect(err.stack ?? '').not.toContain('FakeLauncher');
    expect(err.stack ?? '').not.toContain('launch');
  });

  it('double-start surfaces the launcher message verbatim', async () => {
    const created = (await invoke('profiles:create', { name: 'dbl' })) as Profile;
    await invoke('profiles:start', created.id);
    await expect(invoke('profiles:start', created.id)).rejects.toThrow(
      `Profile ${created.id} is already running`
    );
  });
});

describe('proxies:check', () => {
  it('passes a successful result straight through', async () => {
    const result = (await invoke('proxies:check', 'socks5://1.2.3.4:1080')) as ProxyCheckResult;
    expect(result).toEqual(OK_PROXY);
    expect(proxyCalls).toEqual(['socks5://1.2.3.4:1080']);
  });

  it('passes a failed result through as data (not a rejected promise)', async () => {
    proxyResult = FAIL_PROXY;
    const result = (await invoke('proxies:check', 'http://bad:3128')) as ProxyCheckResult;
    expect(result).toEqual(FAIL_PROXY);
  });
});

describe('app:info', () => {
  it('returns the injected version, api port and data dir', async () => {
    expect(await invoke('app:info')).toEqual(APP_INFO);
  });
});

function launchedProfile(l: FakeLauncher): Profile {
  expect(l.started).toHaveLength(1);
  return l.started[0];
}

describe('fingerprints:preview', () => {
  it('returns a deterministic fingerprint for the same os+seed', async () => {
    const a = (await invoke('fingerprints:preview', { os: 'linux', seed: 's1' })) as {
      userAgent: string;
    };
    const b = (await invoke('fingerprints:preview', { os: 'linux', seed: 's1' })) as {
      userAgent: string;
    };
    expect(a.userAgent).toBe(b.userAgent);
    expect(a.userAgent).toContain('Linux');
  });

  it('rejects an unknown os', async () => {
    await expect(invoke('fingerprints:preview', { os: 'templeos' })).rejects.toThrow(
      /os must be one of/
    );
  });
});
