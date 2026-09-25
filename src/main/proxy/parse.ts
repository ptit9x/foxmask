/** Proxy schemes Foxmask understands; bare host:port is treated as http. */
export type ProxyType = 'socks5' | 'socks4' | 'http' | 'https';

export interface ParsedProxy {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const KNOWN_SCHEMES = new Set(['socks5', 'socks4', 'http', 'https']);

/** True when port is an integer in the valid TCP range (1-65535). */
function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Normalize a URL-parsed credential: '' means absent, %-sequences decoded. */
function cred(value: string): string | undefined {
  if (value === '') return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fromUrl(url: URL): ParsedProxy | null {
  const type = url.protocol.replace(':', '') as ProxyType;
  if (!KNOWN_SCHEMES.has(type)) return null;

  const port = Number(url.port);
  if (!isValidPort(port)) return null;
  if (url.hostname === '') return null;

  return {
    type,
    host: url.hostname,
    port,
    username: cred(url.username),
    password: cred(url.password)
  };
}

/** Parse '[user[:pass]@]host:port' without a scheme; defaults to http. */
function fromBare(text: string): ParsedProxy | null {
  let creds = '';
  let hostPort = text;
  const at = text.lastIndexOf('@');
  if (at !== -1) {
    creds = text.slice(0, at);
    hostPort = text.slice(at + 1);
  }

  const colon = hostPort.lastIndexOf(':');
  if (colon === -1) return null;

  const host = hostPort.slice(0, colon);
  const port = Number(hostPort.slice(colon + 1));
  if (host === '' || !isValidPort(port)) return null;

  let username: string | undefined;
  let password: string | undefined;
  if (creds !== '') {
    const sep = creds.indexOf(':');
    username = sep === -1 ? creds : creds.slice(0, sep);
    password = sep === -1 ? undefined : creds.slice(sep + 1);
  }

  return { type: 'http', host, port, username, password };
}

/**
 * Parse a proxy connection string into a structured result.
 * Accepts 'scheme://[user[:pass]@]host:port' (socks5/socks4/http/https)
 * and bare '[user[:pass]@]host:port' (defaults to http).
 * Returns null for anything malformed.
 */
export function parseProxy(raw: string): ParsedProxy | null {
  const text = raw.trim();
  if (text === '') return null;

  if (text.includes('://')) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    return fromUrl(url);
  }
  return fromBare(text);
}
