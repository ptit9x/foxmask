import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Page } from 'playwright-core';
import { Launcher } from '../launcher/launch';
import { generateFingerprint } from '../fingerprint/generate';
import type { Profile } from '../types/profile';

/**
 * Opt-in network verification suite: launches a real Chromium with a generated
 * fingerprint and checks what fingerprinting sites actually observe.
 *
 * Skipped unless FOXMASK_VERIFY_NET=1 (live network + real browser):
 *   FOXMASK_VERIFY_NET=1 npx vitest run src/main/verify
 */

const RUN = process.env.FOXMASK_VERIFY_NET === '1';

const SETTLE = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** browserleaks renders dimensions with U+00D7 (1536×864); normalize to ASCII. */
const normalizeBody = (s: string): string => s.replace(/\u00d7/g, 'x');

describe.skipIf(!RUN)('fingerprint network verification', () => {
  let launcher: Launcher;

  beforeAll(async () => {
    process.env.FOXMASK_HOME = mkdtempSync(path.join(os.tmpdir(), 'foxmask-verify-'));
    launcher = new Launcher({ headless: true });
    try {
      const { chromium } = await import('playwright-core');
      console.log(`[verify] FOXMASK_HOME=${process.env.FOXMASK_HOME}`);
      console.log(`[verify] chromium executable: ${chromium.executablePath()}`);
    } catch (err) {
      console.warn(`[verify] playwright chromium unavailable: ${err}`);
    }
    return undefined;
  });

  afterAll(async () => {
    for (const id of launcher.listRunning()) await launcher.stop(id);
  });

  function makeProfile(idSuffix: string, seed: string): Profile {
    const now = new Date().toISOString();
    return {
      id: `verify-${idSuffix}`,
      name: `verify-${idSuffix}`,
      group_id: 'default',
      tags: [],
      note: '',
      startup_urls: [],
      raw_proxy: '',
      fingerprint: generateFingerprint({ os: 'windows', seed }),
      created_at: now,
      updated_at: now
    };
  }

  async function withProfile(
    seed: string,
    fn: (page: Page) => Promise<void>,
    idSuffix = seed
  ): Promise<void> {
    const profile = makeProfile(idSuffix, seed);
    const { profileId } = await launcher.start(profile);
    try {
      const ctx = launcher.getContext(profileId);
      if (!ctx) throw new Error(`no context for ${profileId}`);
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await fn(page);
    } finally {
      await launcher.stop(profileId);
    }
  }

  /** goto with soft-fail: warn + skip on navigation errors (not assertion errors). */
  async function gotoOrSkip(page: Page, url: string, settleMs: number): Promise<void> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (err) {
      console.warn(`[verify] navigation to ${url} failed: ${err}`);
      await SETTLE(settleMs);
      throw new Error(`SKIP:navigation to ${url} failed`);
    }
    await SETTLE(settleMs);
  }

  test('browserleaks/javascript shows spoofed values', async () => {
    const seed = 'js-check';
    const fp = generateFingerprint({ os: 'windows', seed });
    await withProfile(
      seed,
      async (page) => {
        await gotoOrSkip(page, 'https://browserleaks.com/javascript', 3000);
        const body = normalizeBody(await page.evaluate(() => document.body.innerText));
        const expected: Array<[string, string]> = [
          ['userAgent', fp.userAgent],
          ['platform', fp.platform],
          ['timezone', fp.timezone],
          ['screen', `${fp.screen.width}x${fp.screen.height}`],
          ['hardwareConcurrency', String(fp.hardwareConcurrency)]
        ];
        const misses = expected.filter(([, v]) => !body.includes(v));
        for (const [label, v] of expected) {
          if (body.includes(v)) console.log(`[verify] js ${label}: matched "${v}"`);
        }
        expect(
          misses.map(([l]) => l),
          `missing: ${misses.map(([, v]) => v).join(' | ')}`
        ).toHaveLength(0);
      },
      'javascript'
    );
  }, 90_000);

  test('browserleaks/webgl shows spoofed gpu', async () => {
    const seed = 'webgl-check';
    const fp = generateFingerprint({ os: 'windows', seed });
    await withProfile(
      seed,
      async (page) => {
        await gotoOrSkip(page, 'https://browserleaks.com/webgl', 3000);
        const body = await page.evaluate(() => document.body.innerText);
        for (const v of [fp.webgl.vendor, fp.webgl.renderer]) {
          console.log(`[verify] webgl looking for "${v}": ${body.includes(v) ? 'MATCHED' : 'MISSING'}`);
        }
        const misses = [fp.webgl.vendor, fp.webgl.renderer].filter((v) => !body.includes(v));
        expect(misses, `missing: ${misses.join(' | ')}`).toHaveLength(0);
      },
      'webgl'
    );
  }, 90_000);

  test('webrtc public IP not leaked', async () => {
    let realIp = '';
    try {
      realIp = (await fetch('https://api.ipify.org').then((r) => r.text())).trim();
    } catch (err) {
      console.warn(`[verify] ipify fetch failed: ${err}`);
      return test.skip(true as never);
    }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(realIp)) {
      console.warn(`[verify] realIp "${realIp}" is not IPv4 — skipping`);
      return test.skip(true as never);
    }
    console.log(`[verify] real public IP (node fetch): ${realIp}`);
    await withProfile(
      'webrtc-check',
      async (page) => {
        await gotoOrSkip(page, 'https://browserleaks.com/webrtc', 8000);
        const body = await page.evaluate(() => document.body.innerText);
        // NOTE: "Your Remote IP" is the HTTP egress IP (server-side view), NOT a
        // WebRTC leak — every site sees it regardless of WebRTC. The WebRTC-
        // observed IPs are the ones under "Your WebRTC IP" / "Public IP Address".
        const secIdx = body.indexOf('Your WebRTC IP');
        const webrtcSection = secIdx >= 0 ? body.slice(secIdx, body.indexOf('Session Description', secIdx)) : '';
        const sectionIps = [...new Set(webrtcSection.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])];
        console.log(`[verify] webrtc section public IPs: ${JSON.stringify(sectionIps)}`);
        console.log(`[verify] whole page contains realIp ${realIp}: ${body.includes(realIp)}`);
        // With no proxy configured, srflx candidates must be dropped: the WebRTC
        // section must expose no public IPv4 at all (mDNS/placeholder only).
        expect(
          sectionIps,
          `WebRTC section leaked public IPs (${realIp} among them: ${sectionIps.includes(realIp)})`
        ).toHaveLength(0);
      },
      'webrtc'
    );
  }, 90_000);

  test('ipify via browser', async () => {
    let realIp = '';
    try {
      realIp = (await fetch('https://api.ipify.org').then((r) => r.text())).trim();
    } catch {
      realIp = '';
    }
    const seed = 'ipify-check';
    await withProfile(
      seed,
      async (page) => {
        await gotoOrSkip(page, 'https://api.ipify.org', 1000);
        const text = (await page.evaluate(() => document.body.innerText)).trim();
        console.log(`[verify] browser IP: ${text} | node realIp: ${realIp} | same: ${text === realIp}`);
        expect(text).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
      },
      'ipify'
    );
  }, 90_000);

  test('creepjs loads (soft)', async () => {
    const seed = 'creepjs-check';
    await withProfile(
      seed,
      async (page) => {
        await gotoOrSkip(page, 'https://abrahamjuliot.github.io/creepjs/', 20_000);
        const txt = await page.evaluate(() => document.body.innerText.slice(0, 3000));
        fs.mkdirSync('scripts', { recursive: true });
        fs.writeFileSync('scripts/creepjs-snapshot.txt', txt);
        console.log(`[verify] creepjs snapshot saved (${txt.length} chars)`);
        expect(txt.length).toBeGreaterThan(500);
      },
      'creepjs'
    );
  }, 90_000);
});
