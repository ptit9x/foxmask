import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGeoCache, geoToTzLocale, lookupGeo } from './resolve';

const GEO_PAYLOAD = {
  status: 'success',
  country: 'Vietnam',
  countryCode: 'VN',
  city: 'Hanoi',
  timezone: 'Asia/Ho_Chi_Minh',
  lat: 21.03,
  lon: 105.85
};

const EXPECTED_GEO = {
  ip: '1.2.3.4',
  country: 'Vietnam',
  countryCode: 'VN',
  city: 'Hanoi',
  timezone: 'Asia/Ho_Chi_Minh',
  latitude: 21.03,
  longitude: 105.85
};

/** Build a fake fetch returning `body` with the given HTTP status. */
function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: RequestInfo | URL) => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  clearGeoCache();
});

describe('lookupGeo', () => {
  it('maps a successful ip-api response to GeoInfo (lat/lon renamed)', async () => {
    const fetchImpl = fakeFetch(GEO_PAYLOAD);
    const geo = await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch);
    expect(geo).toEqual(EXPECTED_GEO);
    // Query hits ip-api with the fields filter.
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('ip-api.com/json/1.2.3.4');
    expect(url).toContain('fields=');
  });

  it('returns null on non-200 status', async () => {
    const fetchImpl = fakeFetch({ ...GEO_PAYLOAD, status: 'success' }, 500);
    expect(await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it("returns null when payload status is 'fail'", async () => {
    const fetchImpl = fakeFetch({ status: 'fail', message: 'private range' });
    expect(await lookupGeo('192.168.1.1', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('caches results: second lookup does not call fetch again', async () => {
    const fetchImpl = fakeFetch(GEO_PAYLOAD);
    const first = await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch);
    const second = await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first).toEqual(EXPECTED_GEO);
    expect(second).toEqual(EXPECTED_GEO);
  });

  it('different ips are cached separately', async () => {
    const fetchImpl = fakeFetch(GEO_PAYLOAD);
    await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch);
    await lookupGeo('5.6.7.8', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('expired entries refetch (ttlMs=20 + real sleep)', async () => {
    const fetchImpl = fakeFetch(GEO_PAYLOAD);
    await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch, { ttlMs: 20 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 25));
    await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch, { ttlMs: 20 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('failed lookups are not cached', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? new Response(JSON.stringify({ status: 'fail' }), { status: 200 })
        : new Response(JSON.stringify(GEO_PAYLOAD), { status: 200 });
    });
    expect(await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await lookupGeo('1.2.3.4', fetchImpl as unknown as typeof fetch)).toEqual(EXPECTED_GEO);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('geoToTzLocale', () => {
  it('maps US to en-US stack with timezone passthrough', () => {
    expect(geoToTzLocale({ ...EXPECTED_GEO, countryCode: 'US', timezone: 'America/New_York' })).toEqual({
      timezone: 'America/New_York',
      languages: ['en-US', 'en']
    });
  });

  it('maps VN to Vietnamese stack with English fallback', () => {
    expect(geoToTzLocale({ ...EXPECTED_GEO, timezone: 'Asia/Ho_Chi_Minh' }).languages).toEqual([
      'vi-VN',
      'vi',
      'en-US',
      'en'
    ]);
  });

  it('maps JP to Japanese stack', () => {
    expect(geoToTzLocale({ ...EXPECTED_GEO, countryCode: 'JP', timezone: 'Asia/Tokyo' })).toEqual({
      timezone: 'Asia/Tokyo',
      languages: ['ja-JP', 'ja', 'en-US', 'en']
    });
  });

  it('falls back to en-US for unknown country codes', () => {
    expect(geoToTzLocale({ ...EXPECTED_GEO, countryCode: 'ZZ', timezone: 'Etc/UTC' }).languages).toEqual([
      'en-US',
      'en'
    ]);
  });

  it("falls back to 'UTC' when timezone is empty", () => {
    expect(geoToTzLocale({ ...EXPECTED_GEO, countryCode: 'US', timezone: '' }).timezone).toBe('UTC');
  });
});
