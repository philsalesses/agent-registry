import { REGISTER_FIX, buildRequestMessage, verifyRequestSignature, type TeachingFix } from 'ans-core';
import { DEFAULT_BASE_URL, FIVE_MINUTES_MS, isPlainObject, resolveFetch, seg, serverPath, trimBaseUrl } from './internal';
import type { GateDecision, GateReason, RequireRegisteredOptions, VerifiedCaller } from './types';

/**
 * requireRegistered: an opt-in gate that only lets registered ANS agents
 * through (docs/DESIGN.md section 8.2). Off unless you mount it.
 *
 * The caller signs its request exactly as it signs registry calls: X-Agent-Id,
 * X-Agent-Timestamp (unix ms), X-Agent-Nonce and X-Agent-Signature, a base64
 * Ed25519 signature over `${METHOD}:${pathname}:${timestamp}:${rawBody}`
 * (AgentIdentity.signRequest produces these headers). The gate fetches the
 * caller's public key and trust from GET /v1/agents/:id (cached 5 minutes) and:
 *   - 428 registration_required when the request is unsigned, stale, signed by
 *     an unknown agent, or the signature does not verify
 *   - 403 trust_below_minimum when the caller's trust score is below minTrust
 *   - 503 registry_unavailable when the registry cannot be reached
 * In 'log' mode every decision is recorded and the request always goes through.
 *
 * The gate authenticates the caller; it does not deduplicate nonces, so make
 * non-idempotent handlers idempotent on their own (for example with an Idempotency-Key).
 */

const AGENT_TTL_MS = 5 * 60 * 1000;
/** An agent id or a handle; anything else is refused without asking the registry */
const AGENT_REF = /^(?:ag_[A-Za-z0-9]{8,64}|@?[A-Za-z0-9-]{3,32})$/;
/** Unknown agents are remembered briefly so a burst of bogus ids does not hit the registry each time */
const UNKNOWN_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;

const SIGNING_HELP =
  'Sign the request with your agent key: X-Agent-Id, X-Agent-Timestamp (unix ms), X-Agent-Nonce and X-Agent-Signature over `${METHOD}:${pathname}:${timestamp}:${body}` (ans-sdk AgentIdentity.signRequest does this)';

interface CachedAgent {
  at: number;
  caller: VerifiedCaller | null;
}

export interface GateInput {
  method: string;
  /** Candidate pathnames to verify against (raw and decoded); the first that verifies wins */
  paths: string[];
  header: (name: string) => string | undefined | null;
  readBody: () => Promise<string>;
}

const REGISTRATION_FIX: TeachingFix = { ...REGISTER_FIX, next: SIGNING_HELP };

function refusalBody(reason: GateReason, minTrust: number, caller: VerifiedCaller | null, agentId: string | null): GateDecision['body'] {
  switch (reason) {
    case 'ok':
      return null;
    case 'below_min_trust':
      return {
        error: 'trust_below_minimum',
        message: `This endpoint only serves ANS agents with a trust score of at least ${minTrust}`,
        details: { required: minTrust, actual: caller?.trust.score ?? null, profile: caller?.profile ?? null },
        fix: { docs: 'https://ans-registry.org/docs/trust', next: 'Build trust with confirmed receipts from other agents, then try again' },
      };
    case 'registry_unreachable':
      return { error: 'registry_unavailable', message: 'The ANS registry could not be reached to verify the caller; try again shortly' };
    default: {
      const messages: Record<string, string> = {
        unsigned: 'This endpoint only serves registered ANS agents, and the request is not signed',
        stale_timestamp: 'X-Agent-Timestamp is missing, malformed or more than 5 minutes from this server clock',
        unknown_agent: `${agentId ?? 'The caller'} is not a registered ANS agent`,
        invalid_signature: 'X-Agent-Signature does not verify against the caller\'s registered public key',
      };
      return { error: 'registration_required', message: messages[reason] ?? 'Registration required', fix: REGISTRATION_FIX, details: { reason } };
    }
  }
}

/** The framework-neutral gate both middleware flavours use */
export function createRegistrationGate(options: RequireRegisteredOptions = {}) {
  const baseUrl = trimBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const minTrust = options.minTrust ?? 0;
  const mode = options.mode ?? 'enforce';
  const fetchImpl = resolveFetch(options.fetch);
  const cache = new Map<string, CachedAgent>();
  const inflight = new Map<string, Promise<VerifiedCaller | null>>();

  const lookup = (agentId: string, force: boolean): Promise<VerifiedCaller | null> => {
    const hit = cache.get(agentId);
    if (!force && hit && Date.now() - hit.at < (hit.caller ? AGENT_TTL_MS : UNKNOWN_TTL_MS)) return Promise.resolve(hit.caller);
    const pending = inflight.get(agentId);
    if (pending) return pending;
    const p = (async () => {
      const res = await fetchImpl(`${baseUrl}/v1/agents/${seg(agentId)}`, { headers: { Accept: 'application/json' } });
      let caller: VerifiedCaller | null = null;
      if (res.status === 404) {
        caller = null;
      } else if (!res.ok) {
        throw new Error(`registry answered ${res.status}`);
      } else {
        const doc = (await res.json()) as { agent?: Record<string, unknown>; trust?: Record<string, unknown>; urls?: Record<string, unknown> };
        const agent = isPlainObject(doc.agent) ? doc.agent : null;
        const trust = isPlainObject(doc.trust) ? doc.trust : isPlainObject(agent?.trust) ? (agent!.trust as Record<string, unknown>) : {};
        if (agent && typeof agent.id === 'string' && typeof agent.publicKey === 'string') {
          caller = {
            id: agent.id,
            handle: typeof agent.handle === 'string' ? agent.handle : null,
            name: typeof agent.name === 'string' ? agent.name : agent.id,
            publicKey: agent.publicKey,
            trust: {
              score: typeof trust.score === 'number' ? trust.score : 0,
              confidence: typeof trust.confidence === 'number' ? trust.confidence : 0,
              rank: typeof trust.rank === 'number' ? trust.rank : 0,
            },
            profile: isPlainObject(doc.urls) && typeof doc.urls.profile === 'string' ? doc.urls.profile : null,
          };
        }
      }
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(agentId, { at: Date.now(), caller });
      return caller;
    })().finally(() => inflight.delete(agentId));
    inflight.set(agentId, p);
    return p;
  };

  const decide = (input: GateInput, reason: GateReason, agentId: string | null, caller: VerifiedCaller | null): GateDecision => {
    const status: GateDecision['status'] =
      reason === 'ok' ? 200 : reason === 'below_min_trust' ? 403 : reason === 'registry_unreachable' ? 503 : 428;
    const decision: GateDecision = {
      allowed: reason === 'ok' || mode === 'log',
      status,
      reason,
      mode,
      method: input.method.toUpperCase(),
      path: input.paths[0] ?? '',
      agentId,
      caller,
      body: refusalBody(reason, minTrust, caller, agentId),
    };
    if (options.onDecision) options.onDecision(decision);
    else if (mode === 'log' && reason !== 'ok') {
      console.warn(`[ans] requireRegistered (log mode) would refuse ${decision.method} ${decision.path}: ${reason}${agentId ? ` (${agentId})` : ''}`);
    }
    return decision;
  };

  const signatureVerifies = async (publicKey: string, input: GateInput, timestamp: string, body: string, signature: string): Promise<boolean> => {
    for (const pathname of input.paths) {
      const message = buildRequestMessage({ method: input.method, pathname, timestamp, body });
      if (await verifyRequestSignature(publicKey, message, signature)) return true;
    }
    return false;
  };

  const check = async (input: GateInput): Promise<GateDecision> => {
    const agentId = (input.header('x-agent-id') ?? '').trim() || null;
    const signature = (input.header('x-agent-signature') ?? '').trim();
    const timestamp = (input.header('x-agent-timestamp') ?? '').trim();
    if (!agentId || !signature) return decide(input, 'unsigned', agentId, null);
    const ts = Number(timestamp);
    if (!/^\d{10,16}$/.test(timestamp) || !Number.isFinite(ts) || Math.abs(Date.now() - ts) > FIVE_MINUTES_MS) {
      return decide(input, 'stale_timestamp', agentId, null);
    }

    if (!AGENT_REF.test(agentId)) return decide(input, 'unknown_agent', agentId, null);

    let caller: VerifiedCaller | null;
    try {
      caller = await lookup(agentId, false);
    } catch {
      return decide(input, 'registry_unreachable', agentId, null);
    }
    if (!caller) return decide(input, 'unknown_agent', agentId, null);

    const method = input.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? '' : await input.readBody();
    let verified = await signatureVerifies(caller.publicKey, input, timestamp, body, signature);
    if (!verified) {
      // The agent may have rotated its key since it was cached
      try {
        const fresh = await lookup(agentId, true);
        if (fresh && fresh.publicKey !== caller.publicKey) {
          caller = fresh;
          verified = await signatureVerifies(caller.publicKey, input, timestamp, body, signature);
        }
      } catch {
        // keep the cached answer
      }
    }
    if (!verified) return decide(input, 'invalid_signature', agentId, null);
    if (caller.trust.score < minTrust) return decide(input, 'below_min_trust', agentId, caller);
    return decide(input, 'ok', agentId, caller);
  };

  return { check, mode, minTrust };
}

function rawPathname(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url.split('?')[0];
  }
}

function candidatePaths(...paths: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (!p) continue;
    for (const v of [p, serverPath(p)]) if (!out.includes(v)) out.push(v);
  }
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', link: '<https://ans-registry.org/skill.md>; rel="help"' },
  });
}

// ---------------------------------------------------------------------------
// Hono (typed structurally: hono is not a dependency)
// ---------------------------------------------------------------------------

/** The parts of a Hono Context the gate reads */
export interface HonoContextLike {
  req: {
    raw: Request;
    url: string;
    path: string;
    method: string;
    header(name: string): string | undefined;
    text(): Promise<string>;
  };
  set(key: string, value: unknown): void;
}

export type HonoMiddlewareLike = (c: HonoContextLike, next: () => Promise<void>) => Promise<Response | void>;

/**
 * Hono middleware: `app.use('/tasks/*', honoRequireRegistered({ minTrust: 40 }))`.
 * The verified caller is available downstream as `c.get('ansCaller')`.
 */
export function honoRequireRegistered(options: RequireRegisteredOptions = {}): HonoMiddlewareLike {
  const gate = createRegistrationGate(options);
  return async (c, next) => {
    const decision = await gate.check({
      method: c.req.method,
      paths: candidatePaths(c.req.path, rawPathname(c.req.url)),
      header: (name) => c.req.header(name),
      // A clone leaves the body unread for the handler; if something upstream already
      // read it, Hono's body cache still has the text
      readBody: async () => {
        try {
          return await c.req.raw.clone().text();
        } catch {
          return c.req.text();
        }
      },
    });
    c.set('ansGate', decision);
    if (decision.caller) c.set('ansCaller', decision.caller);
    if (decision.allowed) {
      await next();
      return;
    }
    return jsonResponse(decision.status, decision.body);
  };
}

// ---------------------------------------------------------------------------
// Express (typed structurally: express is not a dependency)
// ---------------------------------------------------------------------------

/** The parts of an Express request the gate reads */
export interface ExpressRequestLike {
  method: string;
  url: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Parsed body, when a body parser already ran */
  body?: unknown;
  /** Raw body text or bytes; set it in express.json({ verify }) so signatures check against the exact bytes */
  rawBody?: unknown;
}

/** Fields the gate reads and writes on an Express request beyond the typed ones */
type ExpressRequestState = ExpressRequestLike & { _body?: boolean; ansGate?: GateDecision; ansCaller?: VerifiedCaller };

export interface ExpressResponseLike {
  status(code: number): ExpressResponseLike;
  setHeader?(name: string, value: string): unknown;
  json(body: unknown): unknown;
}

export type ExpressMiddlewareLike = (req: ExpressRequestLike, res: ExpressResponseLike, next: (err?: unknown) => void) => void;

function headerOf(req: ExpressRequestLike, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

async function expressRawBody(req: ExpressRequestState): Promise<string> {
  const raw = req.rawBody;
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  if (req._body === true || req.body !== undefined) {
    // A body parser consumed the stream without keeping the raw text. The best
    // reconstruction is the JSON serialization, which matches clients that send
    // JSON.stringify output (ans-sdk does); set req.rawBody for exact bytes.
    if (typeof req.body === 'string') return req.body;
    const length = headerOf(req, 'content-length');
    if ((length === undefined || length === '0') && !headerOf(req, 'transfer-encoding')) return '';
    return JSON.stringify(req.body ?? null);
  }
  const stream = req as unknown as AsyncIterable<Uint8Array | string>;
  if (typeof (stream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function') return '';
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream) text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  // Keep the body usable downstream: store it and mark it parsed so body parsers skip it
  req.rawBody = text;
  const type = headerOf(req, 'content-type') ?? '';
  if (/\bjson\b/i.test(type)) {
    try {
      req.body = text ? JSON.parse(text) : {};
    } catch {
      req.body = text;
    }
  } else {
    req.body = text;
  }
  req._body = true;
  return text;
}

/**
 * Express middleware: `app.use('/tasks', expressRequireRegistered({ minTrust: 40 }))`.
 * The verified caller is available downstream as `req.ansCaller`.
 */
export function expressRequireRegistered(options: RequireRegisteredOptions = {}): ExpressMiddlewareLike {
  const gate = createRegistrationGate(options);
  return (request, res, next) => {
    const req = request as ExpressRequestState;
    const original = req.originalUrl ?? req.url;
    gate
      .check({
        method: req.method,
        paths: candidatePaths(rawPathname(original)),
        header: (name) => headerOf(req, name),
        readBody: () => expressRawBody(req),
      })
      .then((decision) => {
        req.ansGate = decision;
        if (decision.caller) req.ansCaller = decision.caller;
        if (decision.allowed) return next();
        res.setHeader?.('Link', '<https://ans-registry.org/skill.md>; rel="help"');
        res.status(decision.status).json(decision.body);
      })
      .catch(next);
  };
}
