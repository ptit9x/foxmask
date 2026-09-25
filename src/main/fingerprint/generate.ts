import { randomUUID } from 'crypto';
import type { Fingerprint, FingerprintInput } from '../types/fingerprint';
import {
  DEVICE_MEMORY,
  FONTS,
  FONT_SUBSET_FRACTIONS,
  GPUS,
  HARDWARE_CONCURRENCY,
  LANGUAGE_STACKS,
  NAV_PLATFORM,
  SCREENS,
  TIMEZONES,
  TOUCH_POINTS,
  USER_AGENTS
} from './constants';
import { createRng } from './random';

/**
 * Deterministic fingerprint generator: same input.seed (+os) → the exact same
 * Fingerprint. When no seed is given a random UUID is used, i.e. the result is
 * only as reproducible as the persisted seed.
 */
export function generateFingerprint(input: FingerprintInput): Fingerprint {
  const os = input.os;
  const seed = input.seed ?? randomUUID();
  const rng = createRng(`${seed}::${os}`);

  const ua = rng.pick(USER_AGENTS[os]);
  const screen = rng.pick(SCREENS[os]);
  const gpu = rng.pick(GPUS[os]);
  const [fontMinFrac, fontMaxFrac] = FONT_SUBSET_FRACTIONS[os];
  const fonts = rng.subset(FONTS[os], fontMinFrac + rng.next() * (fontMaxFrac - fontMinFrac));
  const languages = rng.pick(LANGUAGE_STACKS);

  return {
    os,
    userAgent: ua,
    platform: NAV_PLATFORM[os],
    screen: {
      width: screen.width,
      height: screen.height,
      availHeight: screen.availHeight,
      devicePixelRatio: screen.devicePixelRatio
    },
    hardwareConcurrency: rng.pick(HARDWARE_CONCURRENCY[os]),
    deviceMemory: rng.pick(DEVICE_MEMORY[os]),
    languages,
    timezone: rng.pick(TIMEZONES),
    geoip: null,
    canvas: 'noise',
    webgl: { mode: 'noise', vendor: gpu.vendor, renderer: gpu.renderer },
    audio: 'noise',
    webRtc: { mode: 'based-on-ip', publicIp: null },
    fonts,
    doNotTrack: null,
    touchPoints: TOUCH_POINTS[os]
  };
}
