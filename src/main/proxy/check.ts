import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent, fetch as undiciFetch, type Dispatcher as UndiciDispatcher } from 'undici';
import { parseProxy, type ParsedProxy } from './parse';

export type { ParsedProxy };
export { parseProxy };

export interface ProxyCheckGeo {
  country?: string;
  countryCode?: string;
  city?: string;
  timezone?: string;
  lat?: number;
  lon?: number;
}

export interface ProxyCheckOk {
  ok: true;
  ip: string;
  latencyMs: number;
  geo?: ProxyCheckGeo;
}

export interface ProxyCheckFail {
  ok: false;
  error: string;
}

export type ProxyCheckResult = ProxyCheckOk | ProxyCheckFail;

/** Minimal shape of a dispatcher undici fetch accepts (ProxyAgent or SocksProxyAgent). */
type Dispatcher = InstanceType<typeof ProxyAgent> | InstanceType<typeof SocksProxyAgent>;

/** undici's fetch dispatcher option expects its own Dispatcher type; SocksProxyAgent (a Node http.Agent) is accepted at runtime. */
function asUndiciDispatcher(d: Dispatcher): UndiciDispatcher {
  return d as unknown as UndiciDispatcher;
}

/** Release sockets held by either agent kind; never throws. */
async function closeDispatcher(d: Dispatcher): Promise<void> {
  try {
    if (d instanceof SocksProxyAgent) {
      d.destroy();
    } else {
      await d.close();
    }
  } catch {
    // cleanup is best effort
  }
}

/**
 * Build the undici dispatcher for a parsed proxy: http/https go through
 * undici's ProxyAgent (it handles TLS-to-proxy natively), socks4/socks5 go
 * through socks-proxy-agent's http.Agent-compatible SocksProxyAgent.
 */
export function buildDispatcher(parsed: ParsedProxy): Dispatcher {
  const auth =
    parsed.username !== undefined
      ? `${encodeURIComponent(parsed.username)}:${encodeURIComponent(parsed.password ?? '')}@`
      : '';
  const proxyUrl = `${parsed.type}://${auth}${parsed.host}:${parsed.port}`;

  if (parsed.type === 'socks4' || parsed.type === 'socks5') {
    return new SocksProxyAgent(proxyUrl);
  }
  return new ProxyAgent({ uri: proxyUrl });
}

/** Extract a readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Check proxy connectivity end to end:
 * 1. Fetch https://api.ipify.org through the proxy and measure latency.
 * 2. Best effort geo lookup for that IP via http://ip-api.com (never fails the check).
 * Both fetches are bounded by AbortSignal.timeout.
 */
export async function checkProxy(raw: string, timeoutMs = 10000): Promise<ProxyCheckResult> {
  let dispatcher: Dispatcher;
  try {
    const parsed = parseProxy(raw);
    if (!parsed) return { ok: false, error: `Invalid proxy string: "${raw}"` };
    dispatcher = buildDispatcher(parsed);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }

  try {
    const started = Date.now();
    const ipRes = await undiciFetch('https://api.ipify.org', {
      dispatcher: asUndiciDispatcher(dispatcher),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const latencyMs = Date.now() - started;
    if (!ipRes.ok) return { ok: false, error: `IP check failed: HTTP ${ipRes.status}` };
    const ip = (await ipRes.text()).trim();
    if (ip === '') return { ok: false, error: 'IP check returned an empty body' };

    // Geo is non-fatal: a failure just means the result carries no geo field.
    let geo: ProxyCheckGeo | undefined;
    try {
      const geoRes = await undiciFetch(`http://ip-api.com/json/${ip}`, {
        dispatcher: asUndiciDispatcher(dispatcher),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (geoRes.ok) {
        const data = (await geoRes.json()) as {
          status?: string;
          country?: string;
          countryCode?: string;
          city?: string;
          timezone?: string;
          lat?: number;
          lon?: number;
        };
        if (data.status === 'success') {
          geo = {
            country: data.country,
            countryCode: data.countryCode,
            city: data.city,
            timezone: data.timezone,
            lat: data.lat,
            lon: data.lon
          };
        }
      }
    } catch {
      // geo lookup is best effort
    }

    return { ok: true, ip, latencyMs, geo };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  } finally {
    await closeDispatcher(dispatcher);
  }
}
