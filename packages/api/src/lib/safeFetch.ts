import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Egress guard (docs/DESIGN.md section 4 "Invoke", section 10 webhooks).
 *
 * - https only
 * - the host is resolved with node:dns lookup and every answer must be a
 *   public unicast address (private, link-local, loopback, IPv4-mapped,
 *   ULA, multicast, documentation and integer-encoded hosts are rejected)
 * - the resolved IP is PINNED: the TCP connection goes to that exact address
 *   while TLS SNI and the Host header keep the original hostname, so a DNS
 *   answer that changes between validation and connect (rebinding) cannot
 *   redirect the request. This uses undici's connector `lookup` override.
 * - no redirects (any 3xx is an error)
 * - byte cap on the response body
 * - AbortSignal timeout covering connect, headers and body
 */

export type SafeFetchErrorCode =
  | 'invalid_url'
  | 'blocked_host'
  | 'dns_failed'
  | 'timeout'
  | 'too_large'
  | 'redirect'
  | 'network';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

export interface SafeFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface SafeFetchOptions {
  /** default 10000 */
  timeoutMs?: number;
  /** default 1 MB */
  maxBytes?: number;
}

export interface SafeFetchResult {
  status: number;
  headers: Headers;
  body: Uint8Array;
  /** the pinned address the request was sent to */
  address: string;
  text(): string;
  json(): unknown;
}

export interface IpClassification {
  public: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Address classifier
// ---------------------------------------------------------------------------

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function classifyIPv4(o: number[]): IpClassification {
  const [a, b] = o;
  if (a === 0) return { public: false, reason: 'this-network (0.0.0.0/8)' };
  if (a === 10) return { public: false, reason: 'private (10.0.0.0/8)' };
  if (a === 100 && b >= 64 && b <= 127) return { public: false, reason: 'shared address space (100.64.0.0/10)' };
  if (a === 127) return { public: false, reason: 'loopback (127.0.0.0/8)' };
  if (a === 169 && b === 254) return { public: false, reason: 'link-local (169.254.0.0/16)' };
  if (a === 172 && b >= 16 && b <= 31) return { public: false, reason: 'private (172.16.0.0/12)' };
  if (a === 192 && b === 0 && o[2] === 0) return { public: false, reason: 'IETF protocol assignments (192.0.0.0/24)' };
  if (a === 192 && b === 0 && o[2] === 2) return { public: false, reason: 'documentation (192.0.2.0/24)' };
  if (a === 192 && b === 168) return { public: false, reason: 'private (192.168.0.0/16)' };
  if (a === 198 && (b === 18 || b === 19)) return { public: false, reason: 'benchmarking (198.18.0.0/15)' };
  if (a === 198 && b === 51 && o[2] === 100) return { public: false, reason: 'documentation (198.51.100.0/24)' };
  if (a === 203 && b === 0 && o[2] === 113) return { public: false, reason: 'documentation (203.0.113.0/24)' };
  if (a >= 224 && a <= 239) return { public: false, reason: 'multicast (224.0.0.0/4)' };
  if (a >= 240) return { public: false, reason: 'reserved or broadcast (240.0.0.0/4)' };
  return { public: true };
}

/** Expand an IPv6 textual address into 8 16-bit groups, or null when malformed. */
export function expandIPv6(ip: string): number[] | null {
  let s = ip.trim();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  // Embedded IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4)
  const lastColon = s.lastIndexOf(':');
  if (lastColon >= 0 && s.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function v4FromGroups(g6: number, g7: number): number[] {
  return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
}

function classifyIPv6(g: number[]): IpClassification {
  const allZero = g.every((x) => x === 0);
  if (allZero) return { public: false, reason: 'unspecified (::)' };
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return { public: false, reason: 'loopback (::1)' };
  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 (deprecated)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const inner = classifyIPv4(v4FromGroups(g[6], g[7]));
    return { public: false, reason: `IPv4-mapped or compatible address (${inner.reason ?? 'embedded IPv4'})` };
  }
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48: classify the embedded IPv4
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    const inner = classifyIPv4(v4FromGroups(g[6], g[7]));
    return inner.public ? { public: true } : { public: false, reason: `NAT64 to ${inner.reason}` };
  }
  // 6to4 2002::/16 embeds the IPv4 in groups 1-2
  if (g[0] === 0x2002) {
    const inner = classifyIPv4(v4FromGroups(g[1], g[2]));
    return inner.public ? { public: true } : { public: false, reason: `6to4 to ${inner.reason}` };
  }
  if ((g[0] & 0xfe00) === 0xfc00) return { public: false, reason: 'unique local (fc00::/7)' };
  if ((g[0] & 0xffc0) === 0xfe80) return { public: false, reason: 'link-local (fe80::/10)' };
  if ((g[0] & 0xffc0) === 0xfec0) return { public: false, reason: 'site-local (fec0::/10)' };
  if ((g[0] & 0xff00) === 0xff00) return { public: false, reason: 'multicast (ff00::/8)' };
  if (g[0] === 0x2001 && g[1] === 0x0db8) return { public: false, reason: 'documentation (2001:db8::/32)' };
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return { public: false, reason: 'discard (100::/64)' };
  return { public: true };
}

/** Classify a literal IP address. Anything that is not a public unicast address is rejected. */
export function classifyIp(ip: string): IpClassification {
  const family = isIP(ip);
  if (family === 4) {
    const o = parseIPv4(ip);
    return o ? classifyIPv4(o) : { public: false, reason: 'malformed IPv4' };
  }
  if (family === 6) {
    const g = expandIPv6(ip);
    return g ? classifyIPv6(g) : { public: false, reason: 'malformed IPv6' };
  }
  return { public: false, reason: 'not an IP address' };
}

export function isPublicIp(ip: string): boolean {
  return classifyIp(ip).public;
}

const NUMERIC_HOST = /^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+))*\.?$/i;

/**
 * Reject hostnames before DNS: localhost names, literal IPs in blocked ranges,
 * and integer, hex, octal or short-form dotted encodings (2130706433, 0x7f000001,
 * 0177.0.0.1, 127.1) that the URL parser may or may not have normalized.
 * Returns the reason, or null when the host may proceed to resolution.
 */
export function isBlockedHostname(hostname: string): string | null {
  let h = hostname.trim().toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === '') return 'empty host';
  if (h === 'localhost' || h.endsWith('.localhost')) return 'localhost';
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return 'local-only domain';
  if (isIP(h)) {
    const cls = classifyIp(h);
    return cls.public ? null : (cls.reason ?? 'blocked address');
  }
  if (NUMERIC_HOST.test(h)) {
    const quad = parseIPv4(h.replace(/\.$/, ''));
    const canonical = quad !== null && h.split('.').every((p) => /^(0|[1-9]\d{0,2})$/.test(p));
    return canonical ? null : 'integer-encoded host';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolution and fetch
// ---------------------------------------------------------------------------

export interface ResolvedTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
}

/** Resolve and validate a hostname. Every DNS answer must be public, or the whole host is rejected. */
export async function resolvePublicHost(hostname: string): Promise<ResolvedTarget> {
  const blocked = isBlockedHostname(hostname);
  if (blocked) throw new SafeFetchError('blocked_host', `Refusing to connect to ${hostname}: ${blocked}`);
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  const literal = isIP(bare);
  if (literal) return { hostname, address: bare, family: literal === 6 ? 6 : 4 };

  let answers: { address: string; family: number }[];
  try {
    answers = await lookup(bare, { all: true, verbatim: true });
  } catch (err) {
    throw new SafeFetchError('dns_failed', `Could not resolve ${hostname}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (answers.length === 0) throw new SafeFetchError('dns_failed', `No addresses for ${hostname}`);
  for (const a of answers) {
    const cls = classifyIp(a.address);
    if (!cls.public) throw new SafeFetchError('blocked_host', `Refusing to connect to ${hostname}: resolves to ${a.address} (${cls.reason})`);
  }
  const first = answers[0];
  return { hostname, address: first.address, family: first.family === 6 ? 6 : 4 };
}

function pinnedAgent(target: ResolvedTarget, timeoutMs: number): Agent {
  // net/tls connect accept a custom `lookup`; answering with the pinned address
  // means the socket goes to the validated IP while SNI and Host stay the hostname.
  type LookupCb = (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;
  const pinnedLookup = (_host: string, options: { all?: boolean }, cb: LookupCb) => {
    if (options && options.all) cb(null, [{ address: target.address, family: target.family }]);
    else cb(null, target.address, target.family);
  };
  return new Agent({
    connect: { lookup: pinnedLookup as never, timeout: timeoutMs },
    connectTimeout: timeoutMs,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    maxRedirections: 0,
  } as ConstructorParameters<typeof Agent>[0]);
}

export async function safeFetch(url: string, init: SafeFetchInit = {}, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 1024 * 1024;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafeFetchError('invalid_url', `Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new SafeFetchError('invalid_url', 'Only https URLs are allowed');
  if (parsed.username || parsed.password) throw new SafeFetchError('invalid_url', 'Credentials in URLs are not allowed');

  const target = await resolvePublicHost(parsed.hostname);
  const agent = pinnedAgent(target, timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new SafeFetchError('timeout', `Timed out after ${timeoutMs} ms`)), timeoutMs);

  try {
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(parsed.toString(), {
        method: init.method ?? 'GET',
        headers: init.headers,
        body: init.body,
        redirect: 'manual',
        signal: controller.signal,
        dispatcher: agent,
      });
    } catch (err) {
      throw toSafeFetchError(err, controller);
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => undefined);
      throw new SafeFetchError('redirect', `Redirects are not followed (got ${res.status})`);
    }

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new SafeFetchError('too_large', `Response declares ${declared} bytes, cap is ${maxBytes}`);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new SafeFetchError('too_large', `Response exceeded ${maxBytes} bytes`);
          }
          chunks.push(value);
        }
      } catch (err) {
        throw toSafeFetchError(err, controller);
      }
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      body.set(c, offset);
      offset += c.byteLength;
    }
    const headers = new Headers();
    res.headers.forEach((v, k) => headers.set(k, v));
    return {
      status: res.status,
      headers,
      body,
      address: target.address,
      text: () => new TextDecoder().decode(body),
      json: () => JSON.parse(new TextDecoder().decode(body)) as unknown,
    };
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => undefined);
  }
}

function toSafeFetchError(err: unknown, controller: AbortController): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  const reason = controller.signal.reason;
  if (reason instanceof SafeFetchError) return reason;
  if (controller.signal.aborted) return new SafeFetchError('timeout', 'Request timed out');
  const message = err instanceof Error ? (err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message) : String(err);
  return new SafeFetchError('network', message);
}
