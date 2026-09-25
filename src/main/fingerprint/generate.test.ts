import { describe, expect, it } from 'vitest';
import { FONTS, SCREENS } from './constants';
import { generateFingerprint } from './generate';
import { createRng } from './random';

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];

describe('generateFingerprint', () => {
  it('keeps Windows fingerprints OS-consistent over 50 iterations', () => {
    for (let i = 0; i < 50; i++) {
      const fp = generateFingerprint({ os: 'windows', seed: `win-${i}` });
      expect(fp.platform).toBe('Win32');
      expect(fp.userAgent).toContain('Windows NT 10.0');
      expect(fp.touchPoints).toBe(0);
      expect(fp.screen.width).toBeGreaterThanOrEqual(fp.screen.height * 0.6); // desktop-ish aspect
    }
  });

  it('picks macos screens from the macos pool', () => {
    for (const seed of SEEDS) {
      const fp = generateFingerprint({ os: 'macos', seed });
      const match = SCREENS.macos.find(
        (s) =>
          s.width === fp.screen.width &&
          s.height === fp.screen.height &&
          s.availHeight === fp.screen.availHeight &&
          s.devicePixelRatio === fp.screen.devicePixelRatio
      );
      expect(match).toBeDefined();
    }
  });

  it('is deterministic for a given seed (full deep equality)', () => {
    for (const seed of SEEDS) {
      expect(generateFingerprint({ os: 'linux', seed })).toEqual(
        generateFingerprint({ os: 'linux', seed })
      );
    }
  });

  it('produces different fingerprints for different seeds', () => {
    let differing = 0;
    for (let i = 0; i < 20; i++) {
      const a = generateFingerprint({ os: 'windows', seed: `s-${i}` });
      const b = generateFingerprint({ os: 'windows', seed: `s-${i + 1}` });
      const differs =
        a.userAgent !== b.userAgent ||
        a.screen.width !== b.screen.width ||
        a.screen.height !== b.screen.height ||
        JSON.stringify(a.fonts) !== JSON.stringify(b.fonts);
      if (differs) differing++;
    }
    expect(differing).toBeGreaterThanOrEqual(19); // allow at most one coincidental tie
  });

  it('only exposes fonts from the OS pool', () => {
    for (const os of ['windows', 'macos', 'linux', 'android'] as const) {
      for (const seed of SEEDS) {
        const fp = generateFingerprint({ os, seed });
        const pool = new Set(FONTS[os]);
        expect(fp.fonts.length).toBeGreaterThan(0);
        for (const font of fp.fonts) expect(pool.has(font)).toBe(true);
      }
    }
  });

  it('builds mobile-consistent android fingerprints', () => {
    for (const seed of SEEDS) {
      const fp = generateFingerprint({ os: 'android', seed });
      expect(fp.touchPoints).toBe(5);
      expect(fp.platform).toBe('Linux armv8l');
      expect(fp.userAgent).toContain('Android');
      expect(fp.userAgent).toContain('Mobile');
      expect(fp.screen.width).toBeLessThan(fp.screen.height); // portrait CSS px
      expect(fp.screen.devicePixelRatio).toBeGreaterThanOrEqual(2);
    }
  });

  it('applies the documented spoof defaults', () => {
    const fp = generateFingerprint({ os: 'windows', seed: 'defaults' });
    expect(fp.geoip).toBeNull();
    expect(fp.canvas).toBe('noise');
    expect(fp.webgl.mode).toBe('noise');
    expect(fp.audio).toBe('noise');
    expect(fp.webRtc).toEqual({ mode: 'based-on-ip', publicIp: null });
    expect(fp.doNotTrack).toBeNull();
    expect([4, 8, 12, 16]).toContain(fp.hardwareConcurrency);
    expect([4, 8]).toContain(fp.deviceMemory);
    expect(fp.languages.length).toBeGreaterThan(0);
    expect(typeof fp.timezone).toBe('string');
  });

  it('generates without an explicit seed (random UUID fallback)', () => {
    const fp = generateFingerprint({ os: 'linux' });
    expect(fp.os).toBe('linux');
    expect(fp.platform).toBe('Linux x86_64');
  });

  it('isolates RNG streams by os for the same seed', () => {
    // Same seed across OSes must not crash and must respect each OS's platform.
    const win = generateFingerprint({ os: 'windows', seed: 'same' });
    const mac = generateFingerprint({ os: 'macos', seed: 'same' });
    expect(win.platform).toBe('Win32');
    expect(mac.platform).toBe('MacIntel');
  });
});

describe('createRng', () => {
  it('returns stable floats and in-range ints', () => {
    const rng = createRng('kappa');
    const a = rng.next();
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(createRng('kappa').next()).toBe(a);
    const n = rng.int(3, 7);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(7);
    expect(() => rng.pick([])).toThrow();
  });

  it('subsets proportionally and preserves order', () => {
    const rng = createRng('subset-check');
    const sub = rng.subset([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5);
    const sorted = [...sub].sort((x, y) => x - y);
    expect(sub).toEqual(sorted);
    expect(rng.subset([1, 2, 3], 0)).toEqual([]);
    expect(rng.subset([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });
});
