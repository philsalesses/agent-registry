/**
 * Offer MCP servers (docs/DESIGN.md section 7 "MCP mapping", Loop B):
 *
 *   /mcp/agent/@handle        that agent's active offers, one tool each, named handle__slug
 *   /mcp/offer/@handle/slug   exactly one tool pinned to that offer (and to @handle: never re-routed)
 *
 * Each tool's inputSchema is the offer's own JSON Schema; calling it runs
 * POST /v1/invoke as the API key holder. API only (the stdio package does not
 * ship these), built on the low-level Server because the schemas are JSON
 * Schema documents, not zod.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { formatUsd } from 'ans-core';
import { AnsApiError, AnsHttp } from './client';
import { ANS_POLICY_RULES } from './tools';

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const MAX_AGENT_TOOLS = 50;
const MAX_DESCRIPTION = 1200;

export interface OfferServerTarget {
  /** handle or ag_ id, without @ */
  owner: string;
  /** set for /mcp/offer/@handle/slug */
  slug?: string | null;
  /** set when the URL pinned a version (slug@3) */
  version?: number | null;
}

/** `handle__slug`, restricted to the MCP tool name alphabet. */
export function offerToolName(owner: string, slug: string): string {
  return `${owner}__${slug}`.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 128);
}

/** Split a tool name at its last `__` (slugs never contain underscores). */
export function slugFromToolName(name: string): string | null {
  const i = name.lastIndexOf('__');
  if (i <= 0) return null;
  const slug = name.slice(i + 2);
  return /^[a-z0-9-]{2,48}$/.test(slug) ? slug : null;
}

/**
 * MCP tool input schemas must be objects. An offer whose input schema is an
 * object is used as is (minus $schema and $id); anything else is wrapped as
 * {input: <schema>} with $defs hoisted so local refs still resolve.
 */
export function toMcpInputSchema(schema: unknown): { inputSchema: Json; wrapped: boolean } {
  const source: Json = isRecord(schema) ? { ...schema } : {};
  delete source.$schema;
  delete source.$id;
  if (source.type === 'object') return { inputSchema: source, wrapped: false };
  const hoisted: Json = {};
  for (const key of ['$defs', 'definitions']) {
    if (key in source) {
      hoisted[key] = source[key];
      delete source[key];
    }
  }
  return { inputSchema: { type: 'object', properties: { input: source }, required: ['input'], additionalProperties: false, ...hoisted }, wrapped: true };
}

function offerPath(target: { owner: string; slug: string; version?: number | null }): string {
  return `/v1/offers/@${encodeURIComponent(target.owner)}/${encodeURIComponent(target.slug)}${target.version ? `@${target.version}` : ''}`;
}

interface LoadedOffer {
  offer: Json;
  tool: Tool;
  wrapped: boolean;
}

function describe(offer: Json): string {
  const owner = isRecord(offer.owner) ? offer.owner : {};
  const trust = isRecord(owner.trust) ? owner.trust : {};
  const price = typeof offer.priceMicros === 'string' ? formatUsd(offer.priceMicros) : '$0.00';
  const who = owner.handle ? `@${String(owner.handle)}` : String(owner.id ?? 'unknown');
  const credit = offer.priceMicros === '0' ? 'free' : offer.acceptsSandbox === false ? 'cash only' : 'SANDBOX credit accepted';
  const head = `Use when you need: ${String(offer.title ?? offer.name)}. ${String(offer.description ?? '')}`.trim();
  const tail = `ANS offer ${String(offer.name)} sold by ${who} (trust ${trust.score ?? '?'}, confidence ${trust.confidence ?? '?'}) for ${price} per call, ${credit}. Each call opens and seals an ANS receipt; put the receipt URL in your deliverable, once, as the line "Receipt: <url>".`;
  const text = `${head}\n\n${tail}`;
  return text.length > MAX_DESCRIPTION ? `${head.slice(0, MAX_DESCRIPTION - tail.length - 5)}...\n\n${tail}` : text;
}

function toTool(offer: Json, ownerSegment: string): LoadedOffer {
  const { inputSchema, wrapped } = toMcpInputSchema(offer.inputSchema);
  const tool: Tool = {
    name: offerToolName(ownerSegment, String(offer.slug)),
    title: typeof offer.title === 'string' ? offer.title : undefined,
    description: describe(offer),
    inputSchema: inputSchema as Tool['inputSchema'],
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  };
  return { offer, tool, wrapped };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The full offers (with schemas) this server exposes. */
export async function loadOffers(http: AnsHttp, target: OfferServerTarget): Promise<LoadedOffer[]> {
  if (target.slug) {
    const res = await http.get<Json>(offerPath({ owner: target.owner, slug: target.slug, version: target.version }), { auth: 'none' });
    const offer = isRecord(res.offer) ? res.offer : null;
    if (!offer) return [];
    return [toTool(offer, target.owner)];
  }
  const list = await http.get<Json>(`/v1/offers/agent/${encodeURIComponent(target.owner)}`, { auth: 'none' });
  const summaries = (Array.isArray(list.offers) ? list.offers : []).filter(isRecord).slice(0, MAX_AGENT_TOOLS);
  const full = await mapLimit(summaries, 8, async (s) => {
    try {
      const res = await http.get<Json>(offerPath({ owner: target.owner, slug: String(s.slug), version: typeof s.version === 'number' ? s.version : null }), { auth: 'none' });
      return isRecord(res.offer) ? res.offer : null;
    } catch {
      return null;
    }
  });
  return full.filter((o): o is Json => o !== null).map((o) => toTool(o, target.owner));
}

function text(data: unknown, lines: string[] = [], isError = false): CallToolResult {
  const body = [JSON.stringify(data), ...lines].join('\n');
  return isError ? { content: [{ type: 'text', text: body }], isError: true } : { content: [{ type: 'text', text: body }] };
}

export interface OfferServerOptions {
  http: AnsHttp;
  target: OfferServerTarget;
  /** false when the request carried no API key: tools list, calls explain how to get a key */
  canInvoke: boolean;
  /** public MCP URL of the registry server, for the register hint */
  registryMcpUrl: string;
}

export function offerServerInstructions(target: OfferServerTarget): string {
  const what = target.slug ? `the ANS offer @${target.owner}/${target.slug}` : `the ANS offers published by @${target.owner}`;
  return [
    `Tools here call ${what}. Every call opens and seals a signed receipt and pays the price from the caller's ANS credit.`,
    '',
    'Policy:',
    ANS_POLICY_RULES,
    '',
    'Put the receipt URL in the deliverable, once, as the line "Receipt: <url>". Send a verdict within 24 hours (ans_receipt_verdict on the registry server).',
  ].join('\n');
}

export function registerOfferTools(server: Server, opts: OfferServerOptions): void {
  const { http, target } = opts;
  let cache: LoadedOffer[] | null = null;
  const load = async () => (cache ??= await loadOffers(http, target));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await load()).map((l) => l.tool) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = isRecord(request.params.arguments) ? request.params.arguments : {};
    try {
      const slug = target.slug ?? slugFromToolName(name);
      if (!slug || (target.slug && name !== offerToolName(target.owner, target.slug))) {
        return text({ error: 'unknown_tool', message: `No tool named ${name} on this server` }, [], true);
      }
      if (!opts.canInvoke) {
        return text(
          { error: 'unauthorized', message: 'Calling an offer spends ANS credit, so this MCP server needs Authorization: Bearer ak_... (scope invoke).' },
          [
            'Tell your operator: register once with `npx -y ans-mcp register --name "<name>"` (or the ans_register tool at ' + opts.registryMcpUrl + '), then add the header "Authorization": "Bearer ak_..." to this MCP server config.',
          ],
          true,
        );
      }
      // Re-read the contract at call time: pinned to @owner (and the version when the URL named one), never re-routed.
      const res = await http.get<Json>(offerPath({ owner: target.owner, slug, version: target.version }), { auth: 'none' });
      const offer = isRecord(res.offer) ? res.offer : {};
      const owner = isRecord(offer.owner) ? offer.owner : {};
      if (owner.handle !== target.owner && owner.id !== target.owner) {
        return text({ error: 'forbidden', message: `The offer no longer belongs to @${target.owner}; this pinned tool refuses to call anyone else.` }, [], true);
      }
      const { wrapped } = toMcpInputSchema(offer.inputSchema);
      const input = wrapped ? args.input : args;
      const body: Json = { offer: String(offer.id), input, maxPriceMicros: String(offer.priceMicros ?? '0') };
      const result = await http.post<Json>('/v1/invoke', body, { idempotencyKey: AnsHttp.idempotencyKey('mcp-offer'), timeoutMs: 180_000 });
      const charged = isRecord(result.charged) ? result.charged : {};
      const receiptUrl = typeof result.receiptUrl === 'string' ? result.receiptUrl : null;
      return text(
        {
          output: result.output,
          receiptId: result.receiptId,
          receiptUrl,
          charged: {
            price: typeof charged.priceMicros === 'string' ? formatUsd(charged.priceMicros) : null,
            fee: typeof charged.feeMicros === 'string' ? formatUsd(charged.feeMicros) : null,
            creditClass: charged.creditClass ?? null,
          },
        },
        [
          `Send a verdict within 24 hours: POST /v1/receipts/${String(result.receiptId)}/verdict, or ans_receipt_verdict on ${opts.registryMcpUrl}.`,
          ...(receiptUrl ? [`Put this line in your deliverable, once: Receipt: ${receiptUrl}`] : []),
        ],
      );
    } catch (err) {
      if (err instanceof AnsApiError) return text(err.toJSON(), [], true);
      return text({ error: 'tool_failed', message: err instanceof Error ? err.message : String(err) }, [], true);
    }
  });
}
