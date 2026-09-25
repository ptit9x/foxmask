import { describe, expect, it } from 'vitest';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent } from 'undici';
import { buildDispatcher } from './check';
import { parseProxy } from './parse';

describe('parseProxy — valid inputs', () => {
  it('parses all four schemes with credentials', () => {
    expect(parseProxy('socks5://user:pass@1.2.3.4:1080')).toEqual({
      type: 'socks5',
      host: '1.2.3.4',
      port: 1080,
      username: 'user',
      password: 'pass'
    });
    expect(parseProxy('socks4://u@5.6.7.8:1080')).toEqual({
      type: 'socks4',
      host: '5.6.7.8',
      port: 1080,
      username: 'u',
      password: undefined
    });
    expect(parseProxy('http://user:pass@proxy.example.com:8080')).toEqual({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      username: 'user',
      password: 'pass'
    });
    expect(parseProxy('https://user:p%40ss@proxy.example.com:8443')).toEqual({
      type: 'https',
      host: 'proxy.example.com',
      port: 8443,
      username: 'user',
      password: 'p@ss' // URL-decoded
    });
  });

  it('parses all four schemes without credentials', () => {
    expect(parseProxy('socks5://1.2.3.4:1080')).toMatchObject({ type: 'socks5', host: '1.2.3.4', port: 1080 });
    expect(parseProxy('socks4://1.2.3.4:1080')).toMatchObject({ type: 'socks4', port: 1080 });
    expect(parseProxy('http://1.2.3.4:8080')).toMatchObject({ type: 'http', port: 8080 });
    expect(parseProxy('https://1.2.3.4:8443')).toMatchObject({ type: 'https', port: 8443 });
  });

  it('defaults bare host:port to http', () => {
    expect(parseProxy('1.2.3.4:8080')).toEqual({
      type: 'http',
      host: '1.2.3.4',
      port: 8080,
      username: undefined,
      password: undefined
    });
  });

  it('parses host:port with credentials (manual fallback)', () => {
    expect(parseProxy('user:pass@1.2.3.4:8080')).toEqual({
      type: 'http',
      host: '1.2.3.4',
      username: 'user',
      password: 'pass',
      port: 8080
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseProxy('  socks5://user:pass@1.2.3.4:1080  ')).toMatchObject({
      type: 'socks5',
      host: '1.2.3.4',
      port: 1080
    });
    expect(parseProxy('\nhttp://1.2.3.4:3128\t')).toMatchObject({ type: 'http', port: 3128 });
  });
});

describe('parseProxy — invalid inputs', () => {
  it('rejects missing port', () => {
    expect(parseProxy('socks5://1.2.3.4')).toBeNull();
    expect(parseProxy('http://proxy.example.com')).toBeNull();
    expect(parseProxy('1.2.3.4')).toBeNull();
  });

  it('rejects out-of-range and non-numeric ports', () => {
    expect(parseProxy('1.2.3.4:0')).toBeNull();
    expect(parseProxy('1.2.3.4:99999')).toBeNull();
    expect(parseProxy('1.2.3.4:abc')).toBeNull();
    expect(parseProxy('1.2.3.4:-1')).toBeNull();
  });

  it('rejects empty host and garbage', () => {
    expect(parseProxy('')).toBeNull();
    expect(parseProxy('   ')).toBeNull();
    expect(parseProxy('not a proxy')).toBeNull();
    expect(parseProxy('http://:8080')).toBeNull();
  });
});

describe('buildDispatcher — agent selection by proxy type', () => {
  // http AND https proxies both go through undici ProxyAgent (it handles
  // TLS-to-proxy natively); socks* go through socks-proxy-agent's http.Agent.
  const cases = [
    { raw: 'http://u:p@1.2.3.4:3128', expected: ProxyAgent },
    { raw: 'https://u:p@1.2.3.4:3129', expected: ProxyAgent },
    { raw: 'socks4://u:p@1.2.3.4:1080', expected: SocksProxyAgent },
    { raw: 'socks5://u:p@1.2.3.4:1080', expected: SocksProxyAgent }
  ] as const;

  for (const { raw, expected } of cases) {
    it(`uses ${expected.name} for ${raw.split('//')[0]}//…`, () => {
      const parsed = parseProxy(raw);
      expect(parsed).not.toBeNull();
      const dispatcher = buildDispatcher(parsed!);
      expect(dispatcher).toBeInstanceOf(expected);
    });
  }

  it('passes credentials through to the socks agent proxy URL', () => {
    const parsed = parseProxy('socks5://alice:s3cret@1.2.3.4:1080')!;
    const agent = buildDispatcher(parsed) as SocksProxyAgent;
    expect(agent.proxy.userId).toBe('alice');
    expect(agent.proxy.password).toBe('s3cret');
  });
});
