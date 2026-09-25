import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { generateFingerprint } from './generate';
import {
  buildInjectScript,
  getTzOffsetMinutes,
  getTzOffsets,
  TRANSPARENT_1x1_PNG
} from './inject';

const WIN = generateFingerprint({ os: 'windows', seed: 'task6-win' });
const WIN_BLOCK = { ...WIN, canvas: 'block' as const };

describe('buildInjectScript', () => {
  it('bakes platform, userAgent and primary language into the script', () => {
    const script = buildInjectScript(WIN);
    expect(WIN.platform).toBe('Win32');
    expect(script).toContain('Win32');
    expect(script).toContain(WIN.userAgent);
    expect(script).toContain(WIN.languages[0]);
  });

  it('is self-contained: no require(, no process., no unfilled tokens', () => {
    const script = buildInjectScript(WIN);
    expect(script).not.toContain('require(');
    expect(script).not.toContain('process.');
    for (const token of [
      '__FP_JSON__',
      '__GENERIC_FONTS_JSON__',
      '__BLANK_PNG__',
      '__WEBRTC_IP_JSON__',
      '__BATTERY_JSON__',
      '__CONNECTION_JSON__',
      '__TZ_JAN__',
      '__TZ_JUL__',
      '__NOISE_SEED__'
    ]) {
      expect(script).not.toContain(token);
    }
    // All mode branches carry typeof guards so missing globals are tolerated.
    expect(script).toContain('typeof HTMLCanvasElement');
  });

  it('is a single IIFE starting with "(" after trim', () => {
    expect(buildInjectScript(WIN).trim().startsWith('(')).toBe(true);
  });

  it('produces different scripts for different fingerprints', () => {
    const other = generateFingerprint({ os: 'windows', seed: 'task6-other' });
    expect(buildInjectScript(WIN)).not.toEqual(buildInjectScript(other));
  });

  it('is byte-identical for the same fingerprint', () => {
    expect(buildInjectScript(WIN)).toEqual(buildInjectScript(WIN));
    const again = generateFingerprint({ os: 'windows', seed: 'task6-win' });
    expect(buildInjectScript(WIN)).toEqual(buildInjectScript(again));
  });

  it('keeps only the active canvas branch (FM_BLOCK for block mode)', () => {
    const block = buildInjectScript(WIN_BLOCK);
    expect(block).toContain('FM_BLOCK');
    expect(block).toContain(TRANSPARENT_1x1_PNG);
    expect(block).not.toContain('FM_NOISE canvas');
    // noise mode (default) must not carry the block marker
    expect(buildInjectScript(WIN)).not.toContain('FM_BLOCK');
    expect(buildInjectScript(WIN)).toContain('FM_NOISE canvas');
    // real mode: neither branch is emitted
    const real = buildInjectScript({ ...WIN, canvas: 'real' as const });
    expect(real).not.toContain('FM_BLOCK');
    expect(real).not.toContain('FM_NOISE canvas');
  });

  it('bakes JS-sign timezone offsets (getTimezoneOffset convention)', () => {
    expect(getTzOffsetMinutes('UTC')).toBe(0);
    // America/New_York: UTC-5 in January, UTC-4 (DST) in July.
    // JS convention: minutes to ADD to local time to get UTC → +300 / +240.
    expect(getTzOffsets('America/New_York', 2026)).toEqual([300, 240]);
    // Asia/Ho_Chi_Minh is UTC+7 year-round → -420.
    expect(getTzOffsets('Asia/Ho_Chi_Minh', 2026)).toEqual([-420, -420]);
  });

  it('applies patched values when evaluated in a vm sandbox', () => {
    const fp = { ...WIN, timezone: 'America/New_York' };
    const script = buildInjectScript(fp);

    // Minimal browser-ish globals; everything else must be typeof-guarded.
    const Navigator = function Navigator() {};
    const Screen = function Screen() {};
    const sandbox: Record<string, unknown> = {
      Navigator,
      Screen,
      navigator: new Navigator(),
      screen: new Screen(),
      window: {}
    };
    const ctx = createContext(sandbox);
    expect(() => runInContext(script, ctx, { timeout: 5000 })).not.toThrow();

    const nav = sandbox.navigator as Record<string, unknown> & {
      plugins: { length: number };
      languages: string[];
    };
    const scr = sandbox.screen as Record<string, unknown>;
    const win = sandbox.window as Record<string, unknown>;

    expect(nav.platform).toBe('Win32');
    expect(nav.userAgent).toBe(fp.userAgent);
    expect(nav.languages).toEqual(fp.languages);
    expect(nav.language).toBe(fp.languages[0]);
    expect(nav.hardwareConcurrency).toBe(fp.hardwareConcurrency);
    expect(nav.deviceMemory).toBe(fp.deviceMemory);
    expect(nav.maxTouchPoints).toBe(fp.touchPoints);
    expect(nav.webdriver).toBe(false);
    expect(nav.plugins.length).toBe(5); // Chrome-standard PDF entries

    expect(scr.width).toBe(fp.screen.width);
    expect(scr.height).toBe(fp.screen.height);
    expect(scr.availHeight).toBe(fp.screen.availHeight);
    expect(win.devicePixelRatio).toBe(fp.screen.devicePixelRatio);

    // Patched natives must be masked as native code.
    expect(
      runInContext(
        'Object.getOwnPropertyDescriptor(Navigator.prototype, "platform").get.toString()',
        ctx
      )
    ).toContain('[native code]');

    // Timezone consistency inside the sandbox.
    expect(
      runInContext('new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset()', ctx)
    ).toBe(300);
    expect(
      runInContext('new Date(Date.UTC(2026, 6, 15)).getTimezoneOffset()', ctx)
    ).toBe(240);
    expect(
      runInContext('new Intl.DateTimeFormat().resolvedOptions().timeZone', ctx)
    ).toBe('America/New_York');
  });
});
