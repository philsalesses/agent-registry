import { buildInvokeForwardMessage, verifyMessage } from 'ans-core';
import { DEFAULT_BASE_URL, FIVE_MINUTES_MS, isPlainObject, resolveFetch } from './internal';
import type { InvokeCaller, InvokeHandler, ServeOptions } from './types';

/** Registry keys are cached this long */
const KEYS_TTL_MS = 10 * 60 * 1000;
/** A failed verification refetches the keys at most this often, so forged requests cannot hammer the registry */
const FORCED_REFRESH_MIN_MS = 30 * 1000;

interface RegistryKey {
  kid: string | null;
  publicKey: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function refuse(status: number, error: string, message: string): Response {
  return json(status, { error, message });
}

/** X-ANS-Timestamp as unix milliseconds (the registry sends unix ms; seconds and ISO strings are tolerated) */
function parseTimestamp(value: string): number | null {
  const v = value.trim();
  if (/^\d{1,16}$/.test(v)) {
    const n = Number(v);
    return v.length <= 10 ? n * 1000 : n;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function toKeys(list: unknown[]): RegistryKey[] {
  const out: RegistryKey[] = [];
  for (const k of list) {
    if (typeof k === 'string' && k) out.push({ kid: null, publicKey: k });
    else if (isPlainObject(k) && typeof k.publicKey === 'string' && k.publicKey) {
      out.push({ kid: typeof k.kid === 'string' ? k.kid : null, publicKey: k.publicKey });
    }
  }
  return out;
}

/** Keys named by the request's key id first, then the rest */
function ordered(keys: RegistryKey[], kid: string | null): RegistryKey[] {
  if (!kid) return keys;
  return [...keys.filter((k) => k.kid === kid), ...keys.filter((k) => k.kid !== kid)];
}

function callerFrom(value: unknown, header: string | null): InvokeCaller {
  if (isPlainObject(value) && typeof value.id === 'string') {
    return {
      id: value.id,
      handle: typeof value.handle === 'string' ? value.handle : null,
      trust: typeof value.trust === 'number' ? value.trust : null,
    };
  }
  return { id: header ?? '', handle: null, trust: null };
}

/**
 * A fetch-style handler for an offer endpoint: `(request: Request) => Promise<Response>`.
 *
 * The registry forwards each invocation as a POST carrying X-ANS-Receipt,
 * X-ANS-Timestamp (unix ms) and X-ANS-Signature: an Ed25519 signature by the
 * registry over `${receiptId}:${timestamp}:${sha256hex(body)}`. serve() checks
 * the timestamp is within 5 minutes, verifies the signature against the
 * registryKeys of /.well-known/ans.json (cached 10 minutes, refetched once when
 * verification fails), and only then calls your handler. Whatever the handler
 * returns is sent back as JSON; return a Response to control the reply yourself.
 * The registry validates that output against the offer's output schema.
 *
 * Runs wherever Request and Response exist: @hono/node-server
 * (`serve({ fetch: handle })`), Hono (`app.post('/ans', (c) => handle(c.req.raw))`),
 * Bun, Deno, Cloudflare Workers, Next.js route handlers.
 */
export function serve<I = unknown, O = unknown>(handler: InvokeHandler<I, O>, options: ServeOptions = {}): (request: Request) => Promise<Response> {
  const fetchImpl = resolveFetch(options.fetch);
  const keysUrl = options.registryKeysUrl ?? `${DEFAULT_BASE_URL}/.well-known/ans.json`;
  const maxAgeMs = options.maxAgeMs ?? FIVE_MINUTES_MS;
  const pinned = options.registryKeys ? toKeys(options.registryKeys) : null;

  let cache: { keys: RegistryKey[]; at: number } | null = null;
  let inflight: Promise<RegistryKey[]> | null = null;
  let lastForced = 0;

  const fetchKeys = (): Promise<RegistryKey[]> => {
    if (!inflight) {
      inflight = (async () => {
        const res = await fetchImpl(keysUrl, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`registry keys: HTTP ${res.status} from ${keysUrl}`);
        const doc = (await res.json()) as { registryKeys?: unknown };
        const keys = Array.isArray(doc.registryKeys) ? toKeys(doc.registryKeys) : [];
        if (keys.length === 0) throw new Error(`registry keys: no registryKeys in ${keysUrl}`);
        cache = { keys, at: Date.now() };
        return keys;
      })().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };

  const getKeys = async (force: boolean): Promise<RegistryKey[]> => {
    if (pinned) return pinned;
    if (!force && cache && Date.now() - cache.at < KEYS_TTL_MS) return cache.keys;
    return fetchKeys();
  };

  const verifiedBy = async (keys: RegistryKey[], message: string, signature: string): Promise<boolean> => {
    for (const key of keys) {
      if (await verifyMessage(key.publicKey, message, signature)) return true;
    }
    return false;
  };

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return refuse(405, 'method_not_allowed', 'Offer endpoints accept POST from the ANS registry');

    const receiptId = request.headers.get('x-ans-receipt') ?? '';
    const timestamp = request.headers.get('x-ans-timestamp') ?? '';
    const signature = request.headers.get('x-ans-signature') ?? '';
    const kid = request.headers.get('x-ans-registry-key-id');
    if (!receiptId || !timestamp || !signature) {
      return refuse(401, 'invalid_signature', 'Missing X-ANS-Receipt, X-ANS-Timestamp or X-ANS-Signature: only the ANS registry calls this endpoint');
    }
    const ts = parseTimestamp(timestamp);
    if (ts === null || Math.abs(Date.now() - ts) > maxAgeMs) {
      return refuse(401, 'timestamp_skew', 'X-ANS-Timestamp is malformed or more than 5 minutes from this server clock');
    }

    const raw = await request.text();
    const message = buildInvokeForwardMessage({ receiptId, timestamp, body: raw });

    let ok = false;
    try {
      ok = await verifiedBy(ordered(await getKeys(false), kid), message, signature);
      if (!ok && !pinned && Date.now() - lastForced > FORCED_REFRESH_MIN_MS) {
        lastForced = Date.now();
        ok = await verifiedBy(ordered(await getKeys(true), kid), message, signature);
      }
    } catch {
      return refuse(503, 'registry_keys_unavailable', 'Could not load the ANS registry public keys to verify this request');
    }
    if (!ok) return refuse(401, 'invalid_signature', 'X-ANS-Signature does not verify against the ANS registry keys');

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return refuse(400, 'bad_request', 'The invocation body is not valid JSON');
    }
    if (!isPlainObject(body)) return refuse(400, 'bad_request', 'The invocation body must be a JSON object');
    if (body.receiptId !== receiptId) return refuse(400, 'bad_request', 'The body receiptId does not match X-ANS-Receipt');

    let output: O | Response;
    try {
      output = await handler({
        receiptId,
        offer: typeof body.offer === 'string' ? body.offer : '',
        input: body.input as I,
        caller: callerFrom(body.caller, request.headers.get('x-ans-caller')),
        deadlineAt: typeof body.deadlineAt === 'string' ? body.deadlineAt : '',
        probe: body.probe === true || request.headers.get('x-ans-probe') === '1',
        request,
      });
    } catch (err) {
      options.onError?.(err);
      return refuse(500, 'handler_failed', 'The offer handler failed');
    }
    if (output instanceof Response) return output;
    return json(200, output === undefined ? null : output);
  };
}
