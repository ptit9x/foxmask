/** Geo information for an IP, as used across Foxmask. */
export interface GeoInfo {
  ip: string;
  country: string;
  countryCode: string;
  city: string;
  timezone: string;
  latitude: number;
  longitude: number;
}

export interface LookupGeoOptions {
  /** Cache TTL in milliseconds; defaults to 5 minutes. */
  ttlMs?: number;
}

/** Minimal fetch shape so tests can inject a fake. */
type FetchLike = (url: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>;

// In-memory TTL cache: ip -> { geo, expiresAt }. Only successful lookups are
// cached; failures return null without caching so the next call refetches.
const cache = new Map<string, { geo: GeoInfo; expiresAt: number }>();

const DEFAULT_TTL_MS = 5 * 60 * 1000;

const FIELDS = 'status,country,countryCode,city,timezone,lat,lon';

/** Drop all cached geo entries (used by tests and manual invalidation). */
export function clearGeoCache(): void {
  cache.clear();
}

/**
 * Look up geo information for an IP via ip-api.com.
 * Returns null on network errors, non-200 responses, or status !== 'success'.
 * Results are cached in memory for ttlMs (default 5 min).
 */
export async function lookupGeo(
  ip: string,
  fetchImpl: FetchLike = fetch,
  opts: LookupGeoOptions = {}
): Promise<GeoInfo | null> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.geo;
  }

  try {
    const res = await fetchImpl(`http://ip-api.com/json/${ip}?fields=${FIELDS}`);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      status?: string;
      country?: string;
      countryCode?: string;
      city?: string;
      timezone?: string;
      lat?: number;
      lon?: number;
    };
    if (data.status !== 'success') return null;

    const geo: GeoInfo = {
      ip,
      country: data.country ?? '',
      countryCode: data.countryCode ?? '',
      city: data.city ?? '',
      timezone: data.timezone ?? '',
      latitude: data.lat ?? 0,
      longitude: data.lon ?? 0
    };

    cache.set(ip, { geo, expiresAt: Date.now() + ttlMs });
    return geo;
  } catch {
    return null;
  }
}

/** Timezone + language stack derived from geo, for profile consistency. */
export interface TzLocale {
  timezone: string;
  languages: string[];
}

// Primary locale + English fallback per country, e.g. VN -> Vietnamese then English.
const COUNTRY_LANGUAGES: Record<string, string[]> = {
  US: ['en-US', 'en'],
  VN: ['vi-VN', 'vi', 'en-US', 'en'],
  DE: ['de-DE', 'de', 'en-US', 'en'],
  GB: ['en-GB', 'en-US', 'en'],
  FR: ['fr-FR', 'fr', 'en-US', 'en'],
  JP: ['ja-JP', 'ja', 'en-US', 'en'],
  KR: ['ko-KR', 'ko', 'en-US', 'en'],
  CN: ['zh-CN', 'zh', 'en-US', 'en'],
  SG: ['en-SG', 'en-US', 'en'],
  AU: ['en-AU', 'en-US', 'en'],
  RU: ['ru-RU', 'ru', 'en-US', 'en'],
  BR: ['pt-BR', 'pt', 'en-US', 'en'],
  ES: ['es-ES', 'es', 'en-US', 'en'],
  IT: ['it-IT', 'it', 'en-US', 'en'],
  NL: ['nl-NL', 'nl', 'en-US', 'en'],
  SE: ['sv-SE', 'sv', 'en-US', 'en'],
  CA: ['en-CA', 'fr-CA', 'en-US', 'en'],
  IN: ['hi-IN', 'en-IN', 'en-US', 'en'],
  TH: ['th-TH', 'th', 'en-US', 'en'],
  MY: ['ms-MY', 'en-MY', 'en-US', 'en']
};

const FALLBACK_LANGUAGES = ['en-US', 'en'];

/**
 * Derive timezone and language stack from geo info. Timezone passes through
 * from geo.timezone ('UTC' when empty); unknown countries get the en-US stack.
 */
export function geoToTzLocale(geo: GeoInfo): TzLocale {
  return {
    timezone: geo.timezone === '' ? 'UTC' : geo.timezone,
    languages: COUNTRY_LANGUAGES[geo.countryCode] ?? FALLBACK_LANGUAGES
  };
}
