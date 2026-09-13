import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { and, eq, isNull } from 'drizzle-orm';
import { hashApiKey, isApiKey } from 'ans-core';
import { db } from '../db';
import { agents, apiKeys } from '../db/schema';
import { config } from '../config';
import { AnsHttp, type FetchLike } from '../mcp/client';
import { ANS_MCP_VERSION, ANS_SERVER_INSTRUCTIONS, memorySpendLedger, registerAnsTools, type SpendLedger } from '../mcp/tools';
import { offerServerInstructions, registerOfferTools, type OfferServerTarget } from '../mcp/offer-tools';

/**
 * Streamable HTTP MCP (docs/DESIGN.md section 7 "MCP mapping", 14.6). Mounted at /mcp.
 *
 *   POST /mcp                        the registry server: every ans_* tool
 *   POST /mcp/agent/@handle          that agent's active offers as tools (handle__slug)
 *   POST /mcp/offer/@handle/slug     one tool pinned to that offer (slug@3 pins the version)
 *
 * Stateless: every POST builds a fresh server and transport, answers with JSON,
 * and closes. GET and DELETE answer 405 (no standalone SSE stream, no sessions).
 *
 * Auth: optional `Authorization: Bearer ak_...`. Without it the registry server
 * exposes the read-only tools (ans_find, ans_get_offer, ans_verify) plus
 * ans_register; with it, the tools the key's scopes allow. Tools call the API
 * in process through `app.request` (no network hop), forwarding the caller's
 * X-Forwarded-For and connection info so per-IP limits still apply.
 */

export const mcpRouter = new Hono();

type AppLike = { request: (input: string, init?: RequestInit, env?: unknown) => Response | Promise<Response> };

let appPromise: Promise<AppLike> | null = null;

/** The API app for in-process calls, imported lazily (app.ts imports this router). */
function inProcessApp(): Promise<AppLike> {
  if (!appPromise) {
    appPromise = import('../app').then((m) => m.createApp() as unknown as AppLike).catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

/** Tests only: route in-process calls to this app (null restores the lazily created one). */
export function setMcpInProcessApp(app: AppLike | null): void {
  appPromise = app ? Promise.resolve(app) : null;
}

function inProcessFetch(c: Context): FetchLike {
  const env = c.env;
  return async (url, init) => {
    const app = await inProcessApp();
    return app.request(url, init, env);
  };
}

function forwardedHeaders(c: Context): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': `ans-mcp-http/${ANS_MCP_VERSION}` };
  const xff = c.req.header('x-forwarded-for');
  if (xff) headers['X-Forwarded-For'] = xff;
  const rid = c.get('requestId') as string | undefined;
  if (rid) headers['X-Request-Id'] = rid;
  return headers;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type McpAuth =
  | { kind: 'none' }
  | { kind: 'key'; key: string; keyId: string; agentId: string; handle: string | null; scopes: string[]; capMicros: bigint }
  | { kind: 'invalid'; message: string };

export async function mcpAuthFrom(c: Context): Promise<McpAuth> {
  const authz = c.req.header('Authorization');
  if (!authz || !authz.trim()) return { kind: 'none' };
  const token = authz.replace(/^Bearer\s+/i, '').trim();
  if (!/^Bearer\s+/i.test(authz) || !isApiKey(token)) {
    return { kind: 'invalid', message: 'Authorization must be "Bearer ak_..." with an ANS API key. Remove the header for the read-only tools and ans_register.' };
  }
  const rows = await db
    .select({ key: apiKeys, handle: agents.handle })
    .from(apiKeys)
    .innerJoin(agents, eq(apiKeys.agentId, agents.id))
    .where(and(eq(apiKeys.keyHash, hashApiKey(token)), isNull(apiKeys.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { kind: 'invalid', message: 'This API key is unknown or revoked. Mint a new one with `npx -y ans-mcp keys create --scopes read,receipts,invoke`.' };
  }
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id)).catch(() => undefined);
  return {
    kind: 'key',
    key: token,
    keyId: row.key.id,
    agentId: row.key.agentId,
    handle: row.handle ?? null,
    scopes: (row.key.scopes ?? []) as string[],
    capMicros: row.key.spendCapMicrosPerDay,
  };
}

function jsonRpcError(c: Context, status: 401 | 404 | 405, message: string, headers: Record<string, string> = {}): Response {
  return c.json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, status, headers);
}

// In-memory daily cash counters per API key (the server also enforces the key cap)
const spendByKey = new Map<string, SpendLedger>();
function spendLedgerFor(keyId: string): SpendLedger {
  let ledger = spendByKey.get(keyId);
  if (!ledger) {
    if (spendByKey.size >= 10_000) spendByKey.clear();
    ledger = memorySpendLedger();
    spendByKey.set(keyId, ledger);
  }
  return ledger;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function handleWith(c: Context, server: McpServer | Server): Promise<Response> {
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(c);
    return res ?? c.body(null, 202);
  } catch (err) {
    if (err instanceof HTTPException) return err.getResponse();
    throw err;
  } finally {
    void server.close().catch(() => undefined);
  }
}

function apiClient(c: Context, apiKey: string | null): AnsHttp {
  return new AnsHttp({ baseUrl: config.publicApiUrl, apiKey, fetch: inProcessFetch(c), headers: forwardedHeaders(c) });
}

export function registryMcpServer(c: Context, auth: Exclude<McpAuth, { kind: 'invalid' }>): McpServer {
  const server = new McpServer({ name: 'ans', title: 'ANS', version: ANS_MCP_VERSION }, { instructions: ANS_SERVER_INSTRUCTIONS });
  const key = auth.kind === 'key' ? auth : null;
  registerAnsTools(server, {
    http: apiClient(c, key?.key ?? null),
    self: key ? { agentId: key.agentId, handle: key.handle } : null,
    scopes: key ? key.scopes : null,
    requireRegistered: true,
    localSpendCapMicros: key ? key.capMicros : null,
    spend: key ? spendLedgerFor(key.keyId) : undefined,
    transport: 'http',
    registerSrc: 'mcp',
    webUrl: config.publicWebUrl,
  });
  return server;
}

const METHOD_NOT_ALLOWED = 'Method not allowed: this MCP endpoint is stateless Streamable HTTP. POST JSON-RPC messages (no SSE stream, no sessions).';

function notAllowed(c: Context): Response {
  return jsonRpcError(c, 405, METHOD_NOT_ALLOWED, { Allow: 'POST' });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

mcpRouter.post('/', async (c) => {
  const auth = await mcpAuthFrom(c);
  if (auth.kind === 'invalid') return jsonRpcError(c, 401, auth.message);
  return handleWith(c, registryMcpServer(c, auth));
});

function ownerParam(raw: string | undefined): string | null {
  const owner = (raw ?? '').trim().replace(/^@/, '');
  if (/^ag_[A-Za-z0-9]{8,64}$/.test(owner)) return owner;
  const handle = owner.toLowerCase();
  return /^[a-z0-9-]{3,32}$/.test(handle) ? handle : null;
}

async function offerServer(c: Context, target: OfferServerTarget): Promise<Response> {
  const auth = await mcpAuthFrom(c);
  if (auth.kind === 'invalid') return jsonRpcError(c, 401, auth.message);
  const http = apiClient(c, auth.kind === 'key' ? auth.key : null);
  const verify = await http.get<{ registered: boolean; id: string | null; handle: string | null }>(`/v1/verify/${encodeURIComponent(target.owner)}`, { auth: 'none' });
  if (!verify.registered) return jsonRpcError(c, 404, `No registered ANS agent @${target.owner}`);
  const pinned: OfferServerTarget = { ...target, owner: verify.handle ?? verify.id ?? target.owner };
  const name = pinned.slug ? `ans-offer-${pinned.owner}-${pinned.slug}` : `ans-agent-${pinned.owner}`;
  const server = new Server(
    { name: name.slice(0, 100), version: ANS_MCP_VERSION },
    { capabilities: { tools: {} }, instructions: offerServerInstructions(pinned) },
  );
  registerOfferTools(server, { http, target: pinned, canInvoke: auth.kind === 'key', registryMcpUrl: `${config.publicApiUrl}/mcp` });
  return handleWith(c, server);
}

mcpRouter.post('/agent/:owner', async (c) => {
  const owner = ownerParam(c.req.param('owner'));
  if (!owner) return jsonRpcError(c, 404, 'Use /mcp/agent/@handle');
  return offerServer(c, { owner });
});

mcpRouter.post('/offer/:owner/:slug', async (c) => {
  const owner = ownerParam(c.req.param('owner'));
  const m = /^([a-z0-9-]{2,48})(?:@(\d{1,9}))?$/.exec((c.req.param('slug') ?? '').toLowerCase());
  if (!owner || !m) return jsonRpcError(c, 404, 'Use /mcp/offer/@handle/slug (or slug@version to pin a version)');
  return offerServer(c, { owner, slug: m[1], version: m[2] ? Number(m[2]) : null });
});

mcpRouter.get('/', notAllowed);
mcpRouter.delete('/', notAllowed);
mcpRouter.get('/agent/:owner', notAllowed);
mcpRouter.delete('/agent/:owner', notAllowed);
mcpRouter.get('/offer/:owner/:slug', notAllowed);
mcpRouter.delete('/offer/:owner/:slug', notAllowed);

export default mcpRouter;
