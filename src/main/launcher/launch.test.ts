import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import type { Profile } from '../types/profile';
import { generateFingerprint } from '../fingerprint/generate';
import type { GeoInfo } from '../geo/resolve';
import {
  AlreadyRunningError,
  Launcher,
  findFreePort,
  launcher as launcherSingleton,
  profileUserDataDir,
  type PersistentContextOptions
} from './launch';

/**
 * Launcher tests.
 *
 * UNIT tests override createContext via a subclass, so no browser is ever
 * launched and playwright-core stays lazy-imported.
 *
 * INTEGRATION tests launch the real dev Chromium (skipped when the binary is
 * missing) headless against a tmp FOXMASK_HOME, and assert the injected
 * fingerprint inside the page.
 */

/** Minimal fake BrowserContext; records calls, closes instantly. */
class FakeContext {
  readonly pagesArr: Page[] = [];
  closed = false;
  initScripts: string[] = [];
  newPages: FakePage[] = [];
  addInitScript(s: { content: string }): Promise<void> {
    this.initScripts.push(s.content);
    return Promise.resolve();
  }
  pages(): Page[] {
    return this.pagesArr;
  }
  newPage(): Promise<Page> {
    const p = new FakePage();
    this.newPages.push(p);
    return Promise.resolve(p as unknown as Page);
  }
  browser(): null {
    return null;
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class FakePage {
  urlValue = 'about:blank';
  gotos: { url: string; opts: unknown }[] = [];
  url(): string {
    return this.urlValue;
  }
  goto(url: string, opts?: unknown): Promise<null> {
    this.gotos.push({ url, opts });
    this.urlValue = url;
    return Promise.resolve(null);
  }
}

/** Launcher subclass whose createContext never touches playwright-core. */
class UnitLauncher extends Launcher {
  created: { userDataDir: string; opts: PersistentContextOptions }[] = [];
  nextContext: FakeContext | null = null;
  failNext = false;
  /** Deterministic CDP port handed out by resolveDebugPort. */
  nextDebugPort = 42424;
  /** What probeDebugEndpoint returns; null simulates a dead DevTools endpoint. */
  probeResult: string | null = `ws://127.0.0.1:42424/devtools/browser/test`;
  /** Stubbed geo per profileId; undefined → resolveProxyGeo returns null. */
  geoByProfile = new Map<string, GeoInfo | null>();

  protected async createContext(
    userDataDir: string,
    opts: PersistentContextOptions
  ): Promise<BrowserContext> {
    if (this.failNext) throw new Error('boom: launch failed');
    this.created.push({ userDataDir, opts });
    const ctx = this.nextContext ?? new FakeContext();
    this.nextContext = null;
    return ctx as unknown as BrowserContext;
  }

  /** Deterministic port — no socket binding in unit tests. */
  protected async resolveDebugPort(): Promise<number> {
    return this.nextDebugPort;
  }

  /** No real browser → no real DevTools endpoint to probe. */
  protected async probeDebugEndpoint(_port: number): Promise<string | null> {
    return this.probeResult;
  }

  /** Skip checkProxy/lookupGeo entirely — unit tests must not touch the network. */
  protected async resolveProxyGeo(profileId: string, _raw: string): Promise<GeoInfo | null> {
    return this.geoByProfile.get(profileId) ?? null;
  }
}

const SAMPLE_GEO: GeoInfo = {
  ip: '203.0.113.9',
  country: 'United States',
  countryCode: 'US',
  city: 'Los Angeles',
  timezone: 'America/Los_Angeles',
  latitude: 34.05,
  longitude: -118.24
};

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Profile 1',
    group_id: 'default',
    tags: [],
    note: '',
    startup_urls: [],
    raw_proxy: '',
    fingerprint: generateFingerprint({ os: 'windows', seed: 'unit-1' }),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

describe('Launcher unit (no browser)', () => {
  it('start returns LaunchResult with CDP endpoint info and tracks the context', async () => {
    const l = new UnitLauncher();
    const res = await l.start(makeProfile());
    expect(res.profileId).toBe('p1');
    expect(res.wsEndpoint).toBe('ws://127.0.0.1:42424/devtools/browser/test');
    expect(res.debugPort).toBe(42424);
    expect(typeof res.startedAt).toBe('string');
    expect(l.isRunning('p1')).toBe(true);
    expect(l.listRunning()).toEqual(['p1']);
  });

  it('start throws AlreadyRunningError when the profile is already running', async () => {
    const l = new UnitLauncher();
    await l.start(makeProfile({ id: 'dup' }));
    await expect(l.start(makeProfile({ id: 'dup' }))).rejects.toThrow(/already running/);
    await expect(l.start(makeProfile({ id: 'dup' }))).rejects.toBeInstanceOf(AlreadyRunningError);
    expect(l.listRunning()).toEqual(['dup']);
  });

  it('start keeps nulls (non-fatal) when the DevTools probe fails', async () => {
    const l = new UnitLauncher();
    l.probeResult = null;
    const res = await l.start(makeProfile({ id: 'dead-endpoint' }));
    expect(res.wsEndpoint).toBeNull();
    expect(res.debugPort).not.toBeNull(); // port is still picked and passed
    expect(l.isRunning('dead-endpoint')).toBe(true);
    await l.stop('dead-endpoint');
  });

  it('stop closes the context and removes it; unknown id returns false', async () => {
    const l = new UnitLauncher();
    const ctx = new FakeContext();
    l.nextContext = ctx;
    await l.start(makeProfile({ id: 'stoppable' }));
    expect(await l.stop('stoppable')).toBe(true);
    expect(ctx.closed).toBe(true);
    expect(l.isRunning('stoppable')).toBe(false);
    expect(l.listRunning()).toEqual([]);
    expect(await l.stop('stoppable')).toBe(false);
    expect(await l.stop('never-existed')).toBe(false);
  });

  it('start failure does not leave the profile marked running', async () => {
    const l = new UnitLauncher();
    l.failNext = true;
    await expect(l.start(makeProfile({ id: 'broken' }))).rejects.toThrow('boom');
    expect(l.isRunning('broken')).toBe(false);
    expect(l.listRunning()).toEqual([]);
  });

  it('passes fingerprint-derived options to createContext, incl. CDP args', async () => {
    const l = new UnitLauncher();
    l.nextDebugPort = 51515;
    const fp = generateFingerprint({ os: 'windows', seed: 'unit-2' });
    await l.start(makeProfile({ id: 'opts', fingerprint: fp }));
    const { userDataDir, opts } = l.created[0];
    expect(userDataDir).toBe(profileUserDataDir('opts'));
    expect(opts.headless).toBe(false);
    expect(opts.executablePath).toBeUndefined();
    expect(opts.proxy).toBeUndefined();
    expect(opts.timezoneId).toBe(fp.timezone);
    expect(opts.locale).toBe(fp.languages[0]);
    expect(opts.viewport).toEqual({ width: fp.screen.width, height: fp.screen.height });
    expect(opts.userAgent).toBe(fp.userAgent);
    expect(opts.args).toContain('--disable-blink-features=AutomationControlled');
    // CDP: the port picked before createContext is baked into the args.
    expect(opts.args).toContain('--remote-debugging-port=51515');
    expect(opts.args).toContain('--remote-debugging-address=127.0.0.1');
  });

  it('findFreePort returns a usable loopback port', async () => {
    const port = await findFreePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    // The port really is free: we can bind it ourselves right away.
    const net = await import('node:net');
    await new Promise<void>((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()));
    });
  });

  it('honors headless/executablePath constructor opts', async () => {
    const l = new UnitLauncher({ headless: true, executablePath: '/fake/chrome' });
    await l.start(makeProfile({ id: 'hl' }));
    expect(l.created[0].opts.headless).toBe(true);
    expect(l.created[0].opts.executablePath).toBe('/fake/chrome');
  });

  it('injects the init script built from the merged fingerprint', async () => {
    const l = new UnitLauncher();
    const ctx = new FakeContext();
    l.nextContext = ctx;
    const fp = generateFingerprint({ os: 'linux', seed: 'unit-3' });
    await l.start(makeProfile({ id: 'inj', fingerprint: fp }));
    expect(ctx.initScripts).toHaveLength(1);
    expect(ctx.initScripts[0]).toContain(fp.userAgent);
    expect(ctx.initScripts[0]).toContain(`"timezone":"${fp.timezone}"`);
  });

  it('parses proxy into launch options and applies geo override + publicIp', async () => {
    const l = new UnitLauncher();
    const ctx = new FakeContext();
    l.nextContext = ctx;
    l.geoByProfile.set('prox', SAMPLE_GEO);
    const fp = generateFingerprint({ os: 'windows', seed: 'unit-4' });
    await l.start(
      makeProfile({ id: 'prox', raw_proxy: 'http://user:pass@1.2.3.4:8080', fingerprint: fp })
    );
    expect(l.created[0].opts.proxy).toEqual({
      server: 'http://1.2.3.4:8080',
      username: 'user',
      password: 'pass'
    });
    // Geo resolved via the (stubbed) proxy IP → tz/locale derived from it.
    expect(l.created[0].opts.timezoneId).toBe('America/Los_Angeles');
    expect(l.created[0].opts.locale).toBe('en-US');
    expect(ctx.initScripts[0]).toContain(`"publicIp":"${SAMPLE_GEO.ip}"`);
    await l.stop('prox');
  });

  it('proxy with failed geo falls back to fingerprint tz and nulls publicIp', async () => {
    const l = new UnitLauncher();
    const ctx = new FakeContext();
    l.nextContext = ctx;
    l.geoByProfile.set('prox-dead', null);
    const fp = generateFingerprint({ os: 'windows', seed: 'unit-5' });
    await l.start(
      makeProfile({ id: 'prox-dead', raw_proxy: 'http://1.2.3.4:8080', fingerprint: fp })
    );
    expect(l.created[0].opts.timezoneId).toBe(fp.timezone);
    expect(l.created[0].opts.locale).toBe(fp.languages[0]);
    expect(ctx.initScripts[0]).toContain('"publicIp":null');
    await l.stop('prox-dead');
  });

  it('opens startup urls: reuses blank first page, then new pages', async () => {
    const l = new UnitLauncher();
    const ctx = new FakeContext();
    const blank = new FakePage();
    ctx.pagesArr.push(blank as unknown as Page);
    l.nextContext = ctx;
    await l.start(makeProfile({ id: 'urls', startup_urls: ['https://a.example/', 'https://b.example/'] }));
    expect(blank.gotos).toEqual([
      { url: 'https://a.example/', opts: { waitUntil: 'domcontentloaded', timeout: 30_000 } }
    ]);
    expect(ctx.newPages).toHaveLength(1);
    expect(ctx.newPages[0].gotos[0].url).toBe('https://b.example/');
  });

  it('exports a module-level singleton', () => {
    expect(launcherSingleton).toBeInstanceOf(Launcher);
  });
});

// ---------------------------------------------------------------------------
// Integration: real Chromium, headless. Skipped when the dev browser is absent.

/** Resolve the playwright-core Chromium binary without throwing. */
function chromiumPath(): string | null {
  try {
    const p = chromium.executablePath();
    return typeof p === 'string' && p !== '' && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

const CHROMIUM = chromiumPath();
const TMP_HOME = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'foxmask-launch-')), 'home');

describe('Launcher integration (real Chromium)', () => {
  beforeAll(() => {
    process.env.FOXMASK_HOME = TMP_HOME;
  });
  afterAll(() => {
    delete process.env.FOXMASK_HOME;
    fs.rmSync(path.dirname(TMP_HOME), { recursive: true, force: true });
  });

  describe.skipIf(!CHROMIUM)('fingerprint injection', () => {
    it(
      'launches headless and the page reports the merged fingerprint',
      { timeout: 60_000 },
      async () => {
        const l = new Launcher({ headless: true });
        const fp = generateFingerprint({ os: 'windows', seed: 'it-1' });
        const res = await l.start(
          makeProfile({ id: 'it-fp-check', fingerprint: fp, startup_urls: ['about:blank'] })
        );

        expect(res.debugPort).not.toBeNull();
        expect(res.wsEndpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//);
        expect(res.wsEndpoint).toContain(`127.0.0.1:${res.debugPort}`);

        const ctx = l.getContext('it-fp-check')!;
        const page = ctx.pages()[0];

        const snapshot = await page.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 32;
          const c2d = canvas.getContext('2d')!;
          const grad = c2d.createLinearGradient(0, 0, 64, 32);
          grad.addColorStop(0, '#ff0000');
          grad.addColorStop(1, '#0000ff');
          c2d.fillStyle = grad;
          c2d.fillRect(0, 0, 64, 32);
          return {
            platform: navigator.platform,
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            screenWidth: screen.width,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            webdriver: navigator.webdriver,
            canvasData: canvas.toDataURL()
          };
        });

        expect(snapshot.platform).toBe('Win32');
        expect(snapshot.userAgent).toBe(fp.userAgent);
        expect(snapshot.hardwareConcurrency).toBe(fp.hardwareConcurrency);
        expect(snapshot.screenWidth).toBe(fp.screen.width);
        // No proxy → effective tz is the fingerprint's own.
        expect(snapshot.tz).toBe(fp.timezone);
        expect(snapshot.webdriver).toBe(false);
        // Noise mode active: a real (non-empty) PNG data URL comes back.
        expect(snapshot.canvasData).toMatch(/^data:image\/png;base64,/);
        expect(snapshot.canvasData.length).toBeGreaterThan(100);

        expect(await l.stop('it-fp-check')).toBe(true);
        expect(l.isRunning('it-fp-check')).toBe(false);
      }
    );

    it(
      'canvas noise is seed-deterministic across launches',
      { timeout: 60_000 },
      async () => {
        const draw = async (l: Launcher, profileId: string): Promise<string> => {
          const fp = generateFingerprint({ os: 'windows', seed: 'det-1' });
          await l.start(
            makeProfile({ id: profileId, fingerprint: fp, startup_urls: ['about:blank'] })
          );
          const page = l.getContext(profileId)!.pages()[0];
          const data = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 32;
            const c2d = canvas.getContext('2d')!;
            const grad = c2d.createLinearGradient(0, 0, 64, 32);
            grad.addColorStop(0, '#00ff00');
            grad.addColorStop(1, '#0000ff');
            c2d.fillStyle = grad;
            c2d.fillRect(0, 0, 64, 32);
            return canvas.toDataURL();
          });
          await l.stop(profileId);
          return data;
        };

        // Same seed, different profile ids → fresh userDataDirs, same noise.
        const l = new Launcher({ headless: true });
        const first = await draw(l, 'it-det-a');
        const second = await draw(l, 'it-det-b');
        expect(first).toBe(second);
      }
    );
  });
});
