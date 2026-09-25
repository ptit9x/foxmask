import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { BrowserContext, Page } from 'playwright-core';
import type { Profile } from '../types/profile';
import type { Fingerprint } from '../types/fingerprint';
import { buildInjectScript } from '../fingerprint/inject';
import { parseProxy } from '../proxy/parse';
import { checkProxy, type ProxyCheckOk } from '../proxy/check';
import { lookupGeo, geoToTzLocale, type GeoInfo } from '../geo/resolve';

/** Base class for launcher failures the API can map to a status code. */
export class LauncherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LauncherError';
  }
}

/** Thrown by start() when the profile is already running. */
export class AlreadyRunningError extends LauncherError {
  constructor(profileId: string) {
    super(`Profile ${profileId} is already running`);
    this.name = 'AlreadyRunningError';
  }
}

/**
 * Profile browser launcher.
 *
 * Launches one persistent Chromium context per profile via playwright-core,
 * with proxy, timezone/locale and the fingerprint injection script applied.
 * NOTE: this module must never import 'electron' — it runs in plain
 * Node/vitest (unit tests override createContext and never launch anything).
 */

export interface LaunchResult {
  profileId: string;
  /** Browser-level CDP ws endpoint from /json/version; null when the probe fails. */
  wsEndpoint: string | null;
  /** Port Chromium's remote debugging server listens on (loopback only). */
  debugPort: number | null;
  startedAt: string;
}

export interface LauncherOptions {
  executablePath?: string;
  headless?: boolean;
}

/** Options forwarded to chromium.launchPersistentContext (subset we use). */
export interface PersistentContextOptions {
  headless?: boolean;
  executablePath?: string;
  proxy?: { server: string; username?: string; password?: string };
  timezoneId?: string;
  locale?: string;
  viewport: { width: number; height: number };
  userAgent?: string;
  args: string[];
}

/** Root data dir: FOXMASK_HOME overrides ~/.foxmask (tests point it at a tmp dir). */
export function resolveDataDir(): string {
  const dir = process.env.FOXMASK_HOME ?? path.join(os.homedir(), '.foxmask');
  // Created eagerly so db open (which does not mkdir) works on a fresh install.
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Per-profile persistent user data dir: <data>/profiles/<id>. */
export function profileUserDataDir(profileId: string): string {
  return path.join(resolveDataDir(), 'profiles', profileId);
}

/** Pick a free TCP port by binding 127.0.0.1:0 and reading back the port. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error('findFreePort: no port allocated'));
      }
    });
  });
}

/** Shape of the JSON served by Chromium's /json/version endpoint. */
interface ChromeVersionInfo {
  webSocketDebuggerUrl?: string;
}

/**
 * Probe Chromium's DevTools HTTP endpoint until it answers (Chrome needs a
 * moment after the process starts). Returns the browser-level
 * webSocketDebuggerUrl, or null when the endpoint never came up (non-fatal).
 */
export async function probeDevtoolsEndpoint(
  port: number,
  tries = 10,
  intervalMs = 500
): Promise<string | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const info = (await res.json()) as ChromeVersionInfo;
        if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
      }
    } catch {
      // Chrome not listening yet — retry.
    }
  }
  return null;
}

export class Launcher {
  private readonly opts: LauncherOptions;
  private readonly contexts = new Map<string, BrowserContext>();
  /** Last LaunchResult per profileId, for status reporting (cleared on stop). */
  private readonly lastResults = new Map<string, LaunchResult>();
  /**
   * Successful checkProxy results per profileId (with the raw string they were
   * verified for), so repeated starts don't re-probe the proxy. Failures are
   * NOT cached — a later start may succeed once the network recovers.
   */
  private readonly proxyChecks = new Map<string, { raw: string; result: ProxyCheckOk }>();

  constructor(opts: LauncherOptions = {}) {
    this.opts = opts;
  }

  isRunning(profileId: string): boolean {
    return this.contexts.has(profileId);
  }

  listRunning(): string[] {
    return [...this.contexts.keys()];
  }

  /** Live context for a running profile (used by tests and later API phases). */
  getContext(profileId: string): BrowserContext | undefined {
    return this.contexts.get(profileId);
  }

  /**
   * Last launch info for a profile: running flag plus the ws endpoint and
   * debug port of the most recent start (nulls when never started/stopped).
   */
  getStatus(profileId: string): {
    running: boolean;
    wsEndpoint: string | null;
    debugPort: number | null;
    startedAt: string | null;
  } {
    const last = this.lastResults.get(profileId);
    return {
      running: this.contexts.has(profileId),
      wsEndpoint: last?.wsEndpoint ?? null,
      debugPort: last?.debugPort ?? null,
      startedAt: last?.startedAt ?? null
    };
  }

  async start(profile: Profile): Promise<LaunchResult> {
    if (this.contexts.has(profile.id)) {
      throw new AlreadyRunningError(profile.id);
    }

    const fp = profile.fingerprint;
    const proxy = parseProxy(profile.raw_proxy ?? '');

    // Effective timezone/locale: with a proxy set, derive them from the geo of
    // the proxy's public IP (resolved lazily — only when a proxy exists); on
    // any failure keep the fingerprint's own defaults. Without a proxy the
    // fingerprint defaults apply unchanged.
    let effTz = fp.timezone;
    let effLanguages = fp.languages;
    let publicIp: string | null = null;
    if (proxy) {
      const geo = await this.resolveProxyGeo(profile.id, profile.raw_proxy);
      if (geo) {
        const tzLocale = geoToTzLocale(geo);
        effTz = tzLocale.timezone;
        effLanguages = tzLocale.languages;
        publicIp = geo.ip;
      }
    }

    const merged: Fingerprint = {
      ...fp,
      timezone: effTz,
      languages: effLanguages ?? fp.languages,
      webRtc: { ...fp.webRtc, publicIp: proxy ? publicIp : null }
    };

    const userDataDir = profileUserDataDir(profile.id);

    // Pick the CDP port before launching so it can be baked into the args.
    // Chromium then serves http://127.0.0.1:<port>/json/version with the
    // browser-level ws endpoint — the only reliable way to get it for a
    // persistent context (ctx.browser() is null there).
    const debugPort = await this.resolveDebugPort();
    const ctx = await this.createContext(userDataDir, {
      headless: this.opts.headless ?? false,
      executablePath: this.opts.executablePath,
      proxy: proxy
        ? {
            server: `${proxy.type}://${proxy.host}:${proxy.port}`,
            username: proxy.username,
            password: proxy.password
          }
        : undefined,
      timezoneId: effTz,
      locale: merged.languages[0],
      viewport: { width: merged.screen.width, height: merged.screen.height },
      userAgent: merged.userAgent,
      args: [
        '--disable-blink-features=AutomationControlled',
        `--remote-debugging-port=${debugPort}`,
        '--remote-debugging-address=127.0.0.1'
      ]
    });
    this.contexts.set(profile.id, ctx);

    await ctx.addInitScript({ content: buildInjectScript(merged) });
    await this.openStartupUrls(ctx, profile.startup_urls ?? []);

    // Probe the DevTools HTTP endpoint for the browser-level ws URL. Probe
    // failure is non-fatal: the browser is up and usable either way.
    let wsEndpoint: string | null = null;
    try {
      wsEndpoint = await this.probeDebugEndpoint(debugPort);
    } catch {
      wsEndpoint = null;
    }
    if (wsEndpoint === null) {
      console.warn(
        `[foxmask] DevTools endpoint on 127.0.0.1:${debugPort} never came up for profile ${profile.id} (non-fatal)`
      );
    }

    const result: LaunchResult = {
      profileId: profile.id,
      wsEndpoint,
      debugPort,
      startedAt: new Date().toISOString()
    };
    this.lastResults.set(profile.id, result);
    return result;
  }

  /**
   * Pick the CDP debug port for the next launch. Protected so unit tests can
   * override with a deterministic port (the real one binds 127.0.0.1:0).
   */
  protected async resolveDebugPort(): Promise<number> {
    return findFreePort();
  }

  /**
   * Probe Chromium's DevTools endpoint for the browser-level ws URL.
   * Protected so unit tests can stub it (no real browser is launched there).
   */
  protected async probeDebugEndpoint(port: number): Promise<string | null> {
    return probeDevtoolsEndpoint(port);
  }

  async stop(profileId: string): Promise<boolean> {
    const ctx = this.contexts.get(profileId);
    if (!ctx) return false;
    // Remove first so the profile stops "running" immediately, even if close hangs.
    this.contexts.delete(profileId);
    try {
      await ctx.close();
    } catch {
      // context already died — it is still no longer running
    }
    return true;
  }

  /**
   * Resolve geo info for a profile's proxy: checkProxy supplies the public IP
   * (result cached per profileId), lookupGeo turns the IP into GeoInfo.
   * Returns null when the proxy is unreachable or geo lookup fails.
   */
  protected async resolveProxyGeo(profileId: string, raw: string): Promise<GeoInfo | null> {
    const cached = this.proxyChecks.get(profileId);
    let ip: string;
    if (cached && cached.raw === raw) {
      ip = cached.result.ip;
    } else {
      const check = await checkProxy(raw);
      if (!check.ok) return null;
      this.proxyChecks.set(profileId, { raw, result: check });
      ip = check.ip;
    }
    try {
      return await lookupGeo(ip);
    } catch {
      return null;
    }
  }

  /**
   * Create the persistent browser context. Protected + lazily importing
   * playwright-core so unit tests can subclass and override without ever
   * launching a browser (and without needing Electron).
   */
  protected async createContext(
    userDataDir: string,
    opts: PersistentContextOptions
  ): Promise<BrowserContext> {
    const { chromium } = await import('playwright-core');
    return chromium.launchPersistentContext(userDataDir, {
      headless: opts.headless,
      executablePath: opts.executablePath,
      proxy: opts.proxy,
      timezoneId: opts.timezoneId,
      locale: opts.locale,
      viewport: opts.viewport,
      userAgent: opts.userAgent,
      // Service workers run in their own scope where init scripts never
      // execute — they would report the real host identity (antidetect leak).
      // Blocking them is the standard tradeoff; SW-dependent sites degrade
      // gracefully to network fetches.
      serviceWorkers: 'block',
      args: opts.args
    });
  }

  /** Open startup URLs; the first URL reuses the blank initial page, later ones get new pages. */
  private async openStartupUrls(ctx: BrowserContext, urls: string[]): Promise<void> {
    let blankPageUsed = false;
    for (const raw of urls) {
      const url = raw.trim();
      if (url === '') continue;

      let page: Page | undefined;
      if (!blankPageUsed) {
        const first = ctx.pages()[0];
        if (first) {
          const u = first.url();
          if (u === 'about:blank' || u === '') {
            page = first;
            blankPageUsed = true;
          }
        }
      }
      page ??= await ctx.newPage();

      // A bad/unreachable startup URL must never fail the launch.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    }
  }
}

/** Module-level singleton the Electron main process will use (Phase D wiring). */
export const launcher = new Launcher();
