// Seeded, deterministic PRNG utilities.
// A fingerprint must be fully reproducible from its seed string, so all
// randomness in the generator flows through createRng.

/** cyrb128 string hash → 4x 32-bit seeds. Small, fast, well-distributed. */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Proportional subset preserving order; minFrac 0 → empty array. */
  subset<T>(arr: readonly T[], minFrac: number): T[];
}

/** mulberry32 PRNG wrapped with the helpers the generator needs. */
export function createRng(seed: string): Rng {
  const seeds = cyrb128(seed);
  let a = seeds[0];
  let calls = 0;

  function next(): number {
    calls++;
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    if (max < min) throw new Error(`invalid range [${min}, ${max}]`);
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick() from empty array');
    return arr[int(0, arr.length - 1)];
  }

  function subset<T>(arr: readonly T[], minFrac: number): T[] {
    if (minFrac <= 0) return [];
    const frac = Math.min(1, minFrac + next() * (1 - minFrac));
    const out: T[] = [];
    for (const item of arr) {
      if (next() < frac) out.push(item);
    }
    if (out.length === 0 && arr.length > 0 && minFrac > 0) out.push(pick(arr));
    return out;
  }

  return { next, int, pick, subset };
}
