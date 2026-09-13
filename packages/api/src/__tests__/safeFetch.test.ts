import { describe, it, expect } from 'vitest';
import { classifyIp, isPublicIp, isBlockedHostname, expandIPv6, safeFetch, SafeFetchError } from '../lib/safeFetch';

describe('safeFetch address classifier', () => {
  it.each([
    ['0.0.0.0', false],
    ['10.1.2.3', false],
    ['100.64.0.1', false],
    ['100.128.0.1', true],
    ['127.0.0.1', false],
    ['127.255.255.254', false],
    ['169.254.169.254', false],
    ['172.15.255.255', true],
    ['172.16.0.1', false],
    ['172.31.255.255', false],
    ['172.32.0.1', true],
    ['192.0.0.1', false],
    ['192.0.2.1', false],
    ['192.168.1.1', false],
    ['198.18.0.1', false],
    ['198.51.100.7', false],
    ['203.0.113.9', false],
    ['224.0.0.1', false],
    ['239.255.255.255', false],
    ['240.0.0.1', false],
    ['255.255.255.255', false],
    ['8.8.8.8', true],
    ['1.1.1.1', true],
    ['93.184.216.34', true],
  ])('IPv4 %s public=%s', (ip, expected) => {
    expect(isPublicIp(ip)).toBe(expected);
  });

  it.each([
    ['::', false],
    ['::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:10.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['::ffff:8.8.8.8', false],
    ['::8.8.8.8', false],
    ['64:ff9b::10.0.0.1', false],
    ['64:ff9b::8.8.8.8', true],
    ['2002:0a00:0001::1', false],
    ['2002:0808:0808::1', true],
    ['fc00::1', false],
    ['fd12:3456::1', false],
    ['fe80::1', false],
    ['fe80::1%en0', false],
    ['fec0::1', false],
    ['ff02::1', false],
    ['2001:db8::1', false],
    ['100::1', false],
    ['2606:4700:4700::1111', true],
    ['2001:4860:4860::8888', true],
  ])('IPv6 %s public=%s', (ip, expected) => {
    expect(isPublicIp(ip)).toBe(expected);
  });

  it('explains why an address is blocked', () => {
    expect(classifyIp('10.0.0.1').reason).toMatch(/private/);
    expect(classifyIp('::ffff:169.254.1.1').reason).toMatch(/mapped/);
    expect(classifyIp('not-an-ip').public).toBe(false);
  });

  it('expands IPv6 forms', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('::ffff:192.168.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0001]);
    expect(expandIPv6('1::2::3')).toBeNull();
    expect(expandIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });

  it.each([
    ['localhost', 'localhost'],
    ['foo.localhost', 'localhost'],
    ['printer.local', 'local-only'],
    ['2130706433', 'integer-encoded'],
    ['0x7f000001', 'integer-encoded'],
    ['0x7f.0.0.1', 'integer-encoded'],
    ['0177.0.0.1', 'integer-encoded'],
    ['127.1', 'integer-encoded'],
    ['127.0.0.1', 'loopback'],
    ['[::1]', 'loopback'],
    ['10.0.0.1', 'private'],
  ])('blocks hostname %s (%s)', (host, reason) => {
    expect(isBlockedHostname(host)).toMatch(new RegExp(reason));
  });

  it('lets ordinary public hostnames and literal public IPs through to resolution', () => {
    expect(isBlockedHostname('example.com')).toBeNull();
    expect(isBlockedHostname('api.ans-registry.org.')).toBeNull();
    expect(isBlockedHostname('8.8.8.8')).toBeNull();
    expect(isBlockedHostname('[2606:4700:4700::1111]')).toBeNull();
  });
});

describe('safeFetch guard (no network)', () => {
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return e instanceof SafeFetchError ? e.code : `other:${String(e)}`;
    }
  };

  it('requires https', async () => {
    expect(await codeOf(safeFetch('http://example.com/'))).toBe('invalid_url');
    expect(await codeOf(safeFetch('ftp://example.com/'))).toBe('invalid_url');
    expect(await codeOf(safeFetch('not a url'))).toBe('invalid_url');
    expect(await codeOf(safeFetch('https://user:pw@example.com/'))).toBe('invalid_url');
  });

  it('refuses loopback, private, link-local, mapped and integer-encoded hosts before connecting', async () => {
    for (const url of [
      'https://localhost/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://10.0.0.1/x',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::ffff:10.0.0.1]/',
      'https://2130706433/',
      'https://0x7f000001/',
      'https://0177.0.0.1/',
      'https://[fe80::1]/',
      'https://[fd00::1]/',
    ]) {
      expect(await codeOf(safeFetch(url, {}, { timeoutMs: 1000 })), url).toBe('blocked_host');
    }
  });

  it('reports DNS failures as dns_failed', async () => {
    expect(await codeOf(safeFetch('https://this-host-does-not-exist.invalid/', {}, { timeoutMs: 2000 }))).toBe('dns_failed');
  });
});
