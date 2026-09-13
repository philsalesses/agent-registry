import type { Context, MiddlewareHandler } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import {
  ANS_BLOCK,
  REGISTER_FIX,
  buildRequestMessage,
  hashApiKey,
  isApiKey,
  verifyRequestSignature,
  HANDLE_REGEX,
} from 'ans-core';
import { db } from '../db';
import { agents, apiKeys, requestNonces, type ApiKeyScope } from '../db/schema';
import { config } from '../config';
import { teach } from './errors';

/**
 * One middleware family for every authenticated route (docs/DESIGN.md section 4
 * auth legend, section 14.6 and 14.7).
 *
 *   signed:  X-Agent-Id, X-Agent-Timestamp (unix ms, 5 min skew), X-Agent-Nonce
 *            (required on POST/PATCH/PUT/DELETE), X-Agent-Signature = base64
 *            Ed25519 over `${METHOD}:${pathname}:${timestamp}:${rawBodyText}`
 *   session: Authorization: Bearer <HMAC session token> (web UI)
 *   apikey:  Authorization: Bearer ak_... (MCP HTTP clients), scope-checked
 *
 * `X-Agent-Private-Key` is refused everywhere with 400 private_key_in_header.
 */

export type AuthMethod = 'signed' | 'session' | 'apikey';

export interface AuthAgent {
  id: string;
  method: AuthMethod;
  /** api key id when method = 'apikey' */
  keyId?: string;
  scopes?: ApiKeyScope[];
}

export type AgentRow = typeof agents.$inferSelect;

declare module 'hono' {
  interface ContextVariableMap {
    agent: AuthAgent;
    rawBody: string;
    /** the agent row the request is acting on, set by requireOwner */
    resolvedAgent: AgentRow;
  }
}

export interface RequireAgentOptions {
  /** required api-key scopes (ignored for signed and session) */
  scopes?: ApiKeyScope[];
  /** which methods may authenticate this route */
  allow: AuthMethod[];
  /** signed with the current key only: sessions and api keys refused (alias for allow: ['signed']) */
  keyOnly?: boolean;
  /** POST /v1/agents is exempt from the nonce check (14.7) */
  skipNonce?: boolean;
}

export const TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
export const NONCE_TTL_MS = 10 * 60 * 1000;
const NONCE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const PRIVATE_KEY_HEADER = 'X-Agent-Private-Key';

const privateKeyFix = {
  docs: ANS_BLOCK.docs,
  url: `${config.publicWebUrl}/docs/auth`,
  next: 'Sign the request instead: X-Agent-Id, X-Agent-Timestamp, X-Agent-Nonce, X-Agent-Signature over `${METHOD}:${pathname}:${timestamp}:${body}` (ans-sdk and ans-mcp do this for you)',
};

// ---------------------------------------------------------------------------
// Raw body
// ---------------------------------------------------------------------------

/**
 * The request body exactly as sent. Read from a clone of the raw request so
 * handlers can still call c.req.json(). Cached on the context.
 */
export async function getRawBody(c: Context): Promise<string> {
  const cached = c.get('rawBody') as string | undefined;
  if (cached !== undefined) return cached;
  let text = '';
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.raw.body) {
    text = await c.req.raw.clone().text();
  }
  c.set('rawBody', text);
  return text;
}

// ---------------------------------------------------------------------------
// Private key header refusal (also mounted globally in app.ts)
// ---------------------------------------------------------------------------

export const rejectPrivateKeyHeader: MiddlewareHandler = async (c, next) => {
  if (c.req.header(PRIVATE_KEY_HEADER) !== undefined) {
    return teach(c, 400, 'private_key_in_header', 'Never send a private key to the registry. The header was ignored and this request was refused.', { fix: privateKeyFix });
  }
  await next();
};

// ---------------------------------------------------------------------------
// Agent lookup
// ---------------------------------------------------------------------------

/** Resolve an `ag_` id or a handle (with or without a leading @) to the agent row. */
export async function resolveAgent(idOrHandle: string): Promise<AgentRow | null> {
  if (!idOrHandle) return null;
  const raw = idOrHandle.trim();
  if (raw.startsWith('ag_')) {
    const row = await db.query.agents.findFirst({ where: eq(agents.id, raw) });
    return row ?? null;
  }
  const handle = (raw.startsWith('@') ? raw.slice(1) : raw).toLowerCase();
  if (!HANDLE_REGEX.test(handle)) return null;
  const row = await db.query.agents.findFirst({ where: eq(agents.handle, handle) });
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Session tokens (moved from routes/auth.ts; the auth route imports these)
// ---------------------------------------------------------------------------

export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

async function hmacKey(usage: 'sign' | 'verify'): Promise<CryptoKey> {
  if (!config.sessionSecret || (config.isProduction && config.sessionSecret.length < 32)) {
    throw new Error('session secret is not loaded (ensureSecrets() must run before serving)');
  }
  return crypto.subtle.importKey('raw', new TextEncoder().encode(config.sessionSecret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** Format: base64(JSON{agentId, exp}) + '.' + base64(HMAC-SHA256) */
export async function createSessionToken(agentId: string, ttlMs: number = SESSION_DURATION_MS): Promise<string> {
  const payloadB64 = btoa(JSON.stringify({ agentId, exp: Date.now() + ttlMs }));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey('sign'), new TextEncoder().encode(payloadB64));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${payloadB64}.${sigB64}`;
}

export async function verifySessionToken(token: string): Promise<{ valid: boolean; agentId?: string }> {
  try {
    const [payloadB64, sigB64] = token.split('.');
    if (!payloadB64 || !sigB64) return { valid: false };
    const signature = Uint8Array.from(atob(sigB64), (ch) => ch.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await hmacKey('verify'), signature, new TextEncoder().encode(payloadB64));
    if (!ok) return { valid: false };
    const payload = JSON.parse(atob(payloadB64)) as { agentId?: string; exp?: number };
    if (typeof payload.agentId !== 'string' || typeof payload.exp !== 'number' || payload.exp < Date.now()) return { valid: false };
    return { valid: true, agentId: payload.agentId };
  } catch {
    return { valid: false };
  }
}

// ---------------------------------------------------------------------------
// Nonces
// ---------------------------------------------------------------------------

let lastNoncePrune = 0;

/** Insert the nonce; false when it was already used. Prunes rows older than 10 min opportunistically. */
export async function consumeNonce(agentId: string, nonce: string, now: Date = new Date()): Promise<boolean> {
  const inserted = await db
    .insert(requestNonces)
    .values({ agentId, nonce, createdAt: now })
    .onConflictDoNothing()
    .returning({ nonce: requestNonces.nonce });
  if (now.getTime() - lastNoncePrune > 60_000) {
    lastNoncePrune = now.getTime();
    void db.delete(requestNonces).where(lt(requestNonces.createdAt, new Date(now.getTime() - NONCE_TTL_MS))).catch(() => undefined);
  }
  return inserted.length === 1;
}

// ---------------------------------------------------------------------------
// requireAgent
// ---------------------------------------------------------------------------

function detectMethod(c: Context): AuthMethod | null {
  if (c.req.header('X-Agent-Signature') !== undefined || c.req.header('X-Agent-Id') !== undefined) return 'signed';
  const authz = c.req.header('Authorization');
  if (authz && /^Bearer\s+/i.test(authz)) {
    const token = authz.replace(/^Bearer\s+/i, '').trim();
    return token.startsWith('ak_') ? 'apikey' : 'session';
  }
  return null;
}

function bearer(c: Context): string {
  return (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

export function requireAgent(opts: RequireAgentOptions): MiddlewareHandler {
  const allow = new Set<AuthMethod>(opts.keyOnly ? ['signed'] : opts.allow);
  const allowedList = Array.from(allow).join(', ');

  return async (c, next) => {
    if (c.req.header(PRIVATE_KEY_HEADER) !== undefined) {
      return teach(c, 400, 'private_key_in_header', 'Never send a private key to the registry. The header was ignored and this request was refused.', { fix: privateKeyFix });
    }

    const method = detectMethod(c);
    if (!method) {
      return teach(c, 401, 'unauthorized', `This route needs authentication (${allowedList})`, {
        fix: { ...REGISTER_FIX, next: 'Sign the request with your agent key, or send Authorization: Bearer ak_... from an API key' },
      });
    }
    if (!allow.has(method)) {
      const why = opts.keyOnly
        ? 'This route must be signed with the agent\'s current key; sessions and API keys are refused'
        : `Authentication method '${method}' is not accepted here (accepted: ${allowedList})`;
      return teach(c, 403, 'forbidden', why, { fix: { docs: ANS_BLOCK.docs } });
    }

    if (method === 'signed') {
      const agentId = c.req.header('X-Agent-Id') ?? '';
      const timestamp = c.req.header('X-Agent-Timestamp') ?? '';
      const nonce = c.req.header('X-Agent-Nonce') ?? '';
      const signature = c.req.header('X-Agent-Signature') ?? '';
      if (!agentId || !timestamp || !signature) {
        return teach(c, 401, 'unauthorized', 'Signed requests need X-Agent-Id, X-Agent-Timestamp and X-Agent-Signature', { fix: privateKeyFix });
      }
      const ts = Number(timestamp);
      if (!/^\d{10,16}$/.test(timestamp) || !Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_SKEW_MS) {
        return teach(c, 401, 'timestamp_skew', 'X-Agent-Timestamp must be unix milliseconds within 5 minutes of the registry clock', {
          details: { serverTime: Date.now(), receivedTimestamp: timestamp, maxSkewMs: TIMESTAMP_SKEW_MS },
          fix: { docs: ANS_BLOCK.docs },
        });
      }
      const needsNonce = NONCE_METHODS.has(c.req.method) && !opts.skipNonce;
      if (needsNonce && (!nonce || nonce.length < 8 || nonce.length > 128)) {
        return teach(c, 401, 'unauthorized', 'X-Agent-Nonce (8 to 128 chars, unique per request) is required on signed POST, PATCH, PUT and DELETE requests', { fix: { docs: ANS_BLOCK.docs } });
      }

      const agent = await resolveAgent(agentId);
      if (!agent) {
        return teach(c, 401, 'unauthorized', `Unknown agent ${agentId}`, { fix: REGISTER_FIX });
      }
      const rawBody = await getRawBody(c);
      const message = buildRequestMessage({ method: c.req.method, pathname: c.req.path, timestamp, body: rawBody });
      const ok = await verifyRequestSignature(agent.publicKey, message, signature);
      if (!ok) {
        return teach(c, 401, 'invalid_signature', 'X-Agent-Signature does not verify against the agent\'s public key', {
          details: { signed: '${METHOD}:${pathname}:${timestamp}:${rawBodyText}', method: c.req.method, pathname: c.req.path, bodyBytes: rawBody.length },
          fix: { docs: ANS_BLOCK.docs },
        });
      }
      if (needsNonce) {
        const fresh = await consumeNonce(agent.id, nonce);
        if (!fresh) {
          return teach(c, 401, 'nonce_reused', 'X-Agent-Nonce was already used by this agent in the last 10 minutes', { fix: { docs: ANS_BLOCK.docs } });
        }
      }
      c.set('agent', { id: agent.id, method: 'signed' });
      return next();
    }

    if (method === 'session') {
      const result = await verifySessionToken(bearer(c));
      if (!result.valid || !result.agentId) {
        return teach(c, 401, 'unauthorized', 'Session token is invalid or expired', { fix: { docs: ANS_BLOCK.docs, url: `${config.publicWebUrl}/login` } });
      }
      const agent = await db.query.agents.findFirst({ where: eq(agents.id, result.agentId), columns: { id: true } });
      if (!agent) return teach(c, 401, 'unauthorized', 'Session agent no longer exists');
      c.set('agent', { id: agent.id, method: 'session' });
      return next();
    }

    // apikey
    const token = bearer(c);
    if (!isApiKey(token)) {
      return teach(c, 401, 'unauthorized', 'Malformed API key', { fix: { docs: ANS_BLOCK.docs } });
    }
    const keyHash = hashApiKey(token);
    const key = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)) });
    if (!key) {
      return teach(c, 401, 'unauthorized', 'API key is unknown or revoked', { fix: { docs: ANS_BLOCK.docs, next: 'Mint a new key: POST /v1/agents/:id/keys (signed with the agent key) or `npx -y ans-mcp keys create`' } });
    }
    const granted = key.scopes ?? [];
    const missing = (opts.scopes ?? []).filter((s) => !granted.includes(s));
    if (missing.length > 0) {
      return teach(c, 403, 'forbidden', `API key lacks scope${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`, {
        details: { required: opts.scopes, granted },
        fix: { docs: ANS_BLOCK.docs, next: `Mint a key with --scopes ${(opts.scopes ?? []).join(',')}` },
      });
    }
    void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id)).catch(() => undefined);
    c.set('agent', { id: key.agentId, method: 'apikey', keyId: key.id, scopes: granted });
    return next();
  };
}

// ---------------------------------------------------------------------------
// requireOwner and requireAdmin
// ---------------------------------------------------------------------------

/**
 * After requireAgent: the authenticated agent must equal the agent named by the
 * path param (an id or a handle). Sets c.get('resolvedAgent').
 */
export function requireOwner(paramName: string = 'id'): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get('agent') as AuthAgent | undefined;
    if (!auth) return teach(c, 401, 'unauthorized', 'Authenticate first');
    const target = await resolveAgent(c.req.param(paramName) ?? '');
    if (!target) return teach(c, 404, 'not_found', `Agent ${c.req.param(paramName)} not found`);
    if (target.id !== auth.id) {
      return teach(c, 403, 'forbidden', 'You can only act on your own agent', { details: { authenticated: auth.id, target: target.id } });
    }
    c.set('resolvedAgent', target);
    return next();
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** X-Admin-Secret must equal ADMIN_SECRET (constant-time). 503 when the secret is unset. */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (!config.adminSecret) {
    return teach(c, 503, 'internal', 'Admin routes are disabled: ADMIN_SECRET is not configured');
  }
  const provided = c.req.header('X-Admin-Secret') ?? '';
  if (!provided || !constantTimeEqual(provided, config.adminSecret)) {
    return teach(c, 403, 'forbidden', 'X-Admin-Secret is missing or wrong');
  }
  return next();
};

/** True when the current request authenticated as `agentId` (any method). */
export function isAuthenticatedAs(c: Context, agentId: string): boolean {
  const auth = c.get('agent') as AuthAgent | undefined;
  return !!auth && auth.id === agentId;
}

/** Utility for SQL callers that need "now" as a UTC-safe timestamp literal. */
export const utcNow = () => sql`${new Date().toISOString()}::timestamp`;
