import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { LaunchResult } from '../launcher/launch';
import type { LauncherStatus } from '../api/server';
import type { Profile } from '../types/profile';
import { createServices, disposeServices, getServices } from './services';

/**
 * services.ts tests — createServices with fully injected fakes (no real db
 * file, no real API server, no Electron). The lazy getServices/disposeServices
 * singleton is exercised separately with fakes via reset for state coverage.
 */

/** Fake db handle proving identity across getServices calls. */
const fakeDb = { mark: 'db' } as unknown as DatabaseSync;

/** Minimal fake launcher satisfying the structural slice. */
const fakeLauncher = {
  start: async (profile: Profile): Promise<LaunchResult> => ({
    profileId: profile.id,
    wsEndpoint: null,
    debugPort: null,
    startedAt: new Date().toISOString()
  }),
  stop: async (): Promise<boolean> => false,
  getStatus: (id: string): LauncherStatus => ({
    running: false,
    wsEndpoint: null,
    debugPort: null,
    startedAt: null,
    ...(id ? {} : {})
  })
};

describe('createServices (injected fakes)', () => {
  it('opens the db under the resolved data dir and reuses one instance', async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const s = await createServices({
      openDb: (p) => {
        opened.push(p);
        return fakeDb;
      },
      closeDb: (d) => closed.push(String((d as unknown as { mark: string }).mark)),
      launcher: fakeLauncher,
      startApiServer: async () => ({ port: 35123, close: async () => {} })
    });

    expect(s.db).toBe(fakeDb);
    expect(s.launcher).toBe(fakeLauncher);
    expect(s.apiPort).toBe(35123);
    expect(opened).toHaveLength(1);

    await s.dispose();
    expect(closed).toEqual(['db']);
  });

  it('starts the API server on the default port 35000 when the port is free', async () => {
    const ports: number[] = [];
    const s = await createServices({
      openDb: () => fakeDb,
      closeDb: () => {},
      launcher: fakeLauncher,
      startApiServer: async (_deps, port) => {
        ports.push(port ?? -1);
        return { port: 35000, close: async () => {} };
      }
    });
    expect(ports).toEqual([35000]);
    await s.dispose();
  });

  it('captures the actually bound port (fallback when 35000 is taken)', async () => {
    const s = await createServices({
      openDb: () => fakeDb,
      closeDb: () => {},
      launcher: fakeLauncher,
      startApiServer: async () => ({ port: 49152, close: async () => {} })
    });
    expect(s.apiPort).toBe(49152);
    await s.dispose();
  });

  it('dispose closes the API server before the db and propagates db errors', async () => {
    const order: string[] = [];
    const s = await createServices({
      openDb: () => fakeDb,
      closeDb: () => {
        order.push('db');
        throw new Error('already closed');
      },
      launcher: fakeLauncher,
      startApiServer: async () => ({
        port: 1,
        close: async () => {
          order.push('server');
        }
      })
    });
    await expect(s.dispose()).rejects.toThrow('already closed');
    expect(order).toEqual(['server', 'db']);
  });

  it('exposes the data dir it resolved', async () => {
    const s = await createServices({
      openDb: () => fakeDb,
      closeDb: () => {},
      launcher: fakeLauncher,
      startApiServer: async () => ({ port: 35000, close: async () => {} })
    });
    expect(typeof s.dataDir).toBe('string');
    expect(s.dataDir.length).toBeGreaterThan(0);
    await s.dispose();
  });
});

describe('getServices / disposeServices singleton', () => {
  it('initializes once, returns the same instance, and dispose is safe to repeat', async () => {
    // Inject fakes so no real files/ports are touched.
    const a = getServices({
      openDb: () => fakeDb,
      closeDb: () => {},
      launcher: fakeLauncher,
      startApiServer: async () => ({ port: 35000, close: async () => {} })
    });
    const b = getServices();
    expect(b).toBe(a);

    await disposeServices();
    await disposeServices(); // safe when already disposed

    // After disposal a fresh instance can be created.
    const c = getServices({
      openDb: () => fakeDb,
      closeDb: () => {},
      launcher: fakeLauncher,
      startApiServer: async () => ({ port: 35000, close: async () => {} })
    });
    expect(c).not.toBe(a);
    await disposeServices();
  });
});
