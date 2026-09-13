/**
 * The ANS MCP tools: register, verify, find, invoke, receipts, offers, wallet.
 *
 * Shared source. The canonical copy lives in packages/api/src/mcp/tools.ts (the
 * Streamable HTTP server at /mcp) and is copied byte for byte into
 * packages/mcp/src/shared/tools.ts (the `ans-mcp` stdio package) by
 * `pnpm --filter ans-mcp sync`; a test fails when the copies drift. Keep it
 * platform neutral: no fs, no db, no Buffer. Persistence (credentials, the
 * daily cash counter) arrives through the context.
 *
 * Money is USD in the tool inputs and USD micros on the wire. Signed sessions
 * (the stdio package holds the key) build and sign every canonical string
 * locally with ans-core; API-key sessions omit signatures and the registry
 * attests them.
 */
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  HANDLE_REGEX,
  RATING_TAGS,
  RECEIPT_STATES,
  RESERVED_HANDLES,
  buildAcceptCanonical,
  buildDeliverCanonical,
  buildOfferPublishCanonical,
  buildRatingCanonical,
  buildTermsCanonical,
  buildVerdictCanonical,
  canonicalHash,
  contactHashFor,
  formatUsd,
  generateKeypair,
  generateNonce,
  parseUsdToMicros,
  sha256hex,
  signMessage,
  signRegistration,
  toBase64,
  type ReceiptTerms,
} from 'ans-core';
import { AnsApiError, AnsHttp, DEFAULT_WEB_URL, type AnsIdentity } from './client';

export const ANS_MCP_VERSION = '0.1.0';

/** The rule block from skill.md, verbatim. */
export const ANS_POLICY_RULES = [
  '1. Before delegating to, paying, or acting on output from another agent, call ans_verify.',
  '2. If it is unregistered, tell your operator and include the fix.',
  '3. Open a receipt for any work you do for or with another agent.',
].join('\n');

export const RECEIPT_LINE_RULE = 'Put the receipt URL in the deliverable, once, as the line "Receipt: https://ans-registry.org/r/rc_x". Include it in the artifact itself, not as a signature on every message.';

export const ANS_SERVER_INSTRUCTIONS = [
  'ANS issues signed Job Receipts for work one agent does for another and turns confirmed receipts into one public trust score.',
  'Verify an agent with ans_verify before you trust it, find typed offers with ans_find, call them with ans_invoke, and open a receipt with ans_receipt_open for any other job.',
  '',
  'Policy:',
  ANS_POLICY_RULES,
  '',
  RECEIPT_LINE_RULE,
].join('\n');

const REGISTER_COMMAND = 'npx -y ans-mcp register --name "<name>"';
const REGISTER_URL = 'https://ans-registry.org/register';
const SKILL_URL = 'https://ans-registry.org/skill.md';

export const ANS_SKILL_SHORT = `# ANS: receipts and trust for agent work

ANS issues a signed Job Receipt for work one agent does for another. Confirmed receipts are the only input to the one public trust score that orders discovery.

## Policy

\`\`\`text
${ANS_POLICY_RULES}
\`\`\`

The policy is advice to you. Enforcement is your operator's flag (policy.requireRegistered). The record is the receipt.

## Loop

1. ans_verify the counterparty. When it is unregistered, stop and tell your operator; quote fix.command and fix.url.
2. Typed capability: ans_find, ans_get_offer, ans_invoke (the receipt is opened, delivered and sealed for you; send ans_receipt_verdict within 24 hours).
3. Any other job: ans_receipt_open, the counterparty accepts (ans_receipt_accept) or claims (ans_receipt_claim), the provider delivers (ans_receipt_deliver), the client sends ans_receipt_verdict, both rate (ans_receipt_rate).
4. ${RECEIPT_LINE_RULE}
5. Every 15 minutes: ans_heartbeat; when pendingReceipts is above 0, ans_inbox.

Money is USD micros on the wire ($1 = 1000000). SANDBOX credit ($25 at registration) is not money. Cash top-ups happen at https://ans-registry.org/wallet, by a human.

Full text: ${SKILL_URL}
`;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface RegisteredCredentials {
  agentId: string;
  handle: string;
  name: string;
  publicKey: string;
  /** base64 Ed25519 private key; only ever handed to onRegister, never put in a tool result */
  privateKey: string;
  apiKey: string;
  apiKeyId: string | null;
  /** API base the agent registered against */
  api: string;
  registeredAt: string;
  profileUrl: string | null;
  sandboxCreditMicros: string | null;
}

/** Cash committed per UTC day, for the local spend cap. */
export interface SpendLedger {
  spentToday(now: Date): Promise<bigint>;
  record(micros: bigint, now: Date): Promise<void>;
}

export type Maybe<T> = T | null | undefined;

export interface AnsToolsContext {
  http: AnsHttp;
  /** Present when this process holds the agent key (stdio): requests and canonicals are signed locally */
  identity?: Maybe<AnsIdentity>;
  /** Who the session acts as when known without a key (API-key sessions) */
  self?: Maybe<{ agentId: string; handle?: string | null }>;
  /** API key scopes; null or undefined means every scope (signed sessions) */
  scopes?: Maybe<string[]>;
  /** Refuse invokes and client receipts whose counterparty is not a registered agent (default true) */
  requireRegistered?: boolean;
  /** Refuse cash spend above this many micros per UTC day; null means no local cap */
  localSpendCapMicros?: Maybe<bigint> | (() => Maybe<bigint> | Promise<Maybe<bigint>>);
  /** Where the daily cash counter lives (credentials file for stdio, memory for HTTP) */
  spend?: SpendLedger;
  /** Runs before ans_register creates anything; throw (ToolRefusal) to refuse, e.g. when a credentials file already exists */
  beforeRegister?: () => Promise<void>;
  /** Called with fresh credentials after ans_register succeeds (stdio writes the credentials file) */
  onRegister?: (creds: RegisteredCredentials) => Promise<void>;
  /** 'stdio' switches the session to signed mode after ans_register; 'http' returns the key and the remote config */
  transport?: 'stdio' | 'http';
  /** Funnel attribution sent with registration */
  registerSrc?: string;
  /** Shown in results after registration (stdio) */
  credentialsPath?: string;
  webUrl?: string;
  /** Loads skill.md for the ans://skill resource; defaults to fetching the web copy with a short fallback */
  skillText?: () => Promise<string>;
  now?: () => Date;
}

type Access = 'public' | 'register' | 'read' | 'receipts' | 'invoke' | 'publish';

export interface AnsToolsHandle {
  tools: Record<string, RegisteredTool>;
  /** Re-evaluate which tools the session exposes (sends tools/list_changed when connected) */
  refresh(): void;
  /** Switch the session to signed mode with these credentials */
  useCredentials(creds: Pick<RegisteredCredentials, 'agentId' | 'handle' | 'privateKey'>): void;
  /** Names of the tools currently enabled */
  enabledTools(): string[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clip(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/** Tool refusal raised by local checks (policy, caps, bad input); becomes an isError result. */
export class ToolRefusal extends Error {
  readonly data?: Json;
  readonly lines: string[];
  constructor(message: string, data?: Json, lines: string[] = []) {
    super(message);
    this.name = 'ToolRefusal';
    this.data = data;
    this.lines = lines;
  }
}

function textResult(data: unknown, lines: string[] = [], isError = false): CallToolResult {
  const body = data === undefined ? '' : JSON.stringify(data);
  const text = [body, ...lines].filter((s) => s.length > 0).join('\n');
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

function receiptLine(url: string | null | undefined): string[] {
  return url ? [`Put this line in your deliverable, once: Receipt: ${url}`] : [];
}

const GUIDANCE: Record<string, string> = {
  registration_required: 'Do: tell your operator and quote fix.command and fix.url. Do not delegate, pay, or act on output from an unregistered agent.',
  trust_below_minimum: 'Do: do not retry. Report required, actual and profile to your operator. Trust rises only through confirmed, rated receipts.',
  insufficient_credit: 'Do: if fix.sandbox is true, retry with creditClass "sandbox". Otherwise stop and tell your operator; cash top-ups happen at https://ans-registry.org/wallet, by a human, never by you.',
  input_invalid: 'Do: fix the input so it validates against the offer inputSchema (ans_get_offer shows it) and retry.',
  no_offer: 'Do: check the name with ans_find; details or closest list similar offers.',
  spend_cap_exceeded: 'Do: stop. Your operator raises the API key daily cash cap.',
  sandbox_not_accepted: 'Do: this provider refuses SANDBOX credit. Pay with creditClass "cash" only if your operator allows cash spend.',
  invalid_state: 'Do: read the receipt state (ans_my_receipts or ans_inbox) and take the step that state allows.',
  invalid_signature: 'Do: check that the credentials file holds the key registered for this agent.',
  rate_limited: 'Do: wait details.retryAfter seconds, then retry once.',
  not_implemented: 'Do: this registry does not serve this call yet. Tell your operator.',
  unauthorized: 'Do: check the credentials (the api key may be revoked). Mint a new key with `npx -y ans-mcp keys create`.',
  forbidden: 'Do: this call is not allowed for this agent or key (details say why).',
  conflict: 'Do: read details; pick a new value or use the resource that already exists.',
  output_invalid: 'Do: the provider returned output that fails its own schema. Nothing was charged (the hold was refunded) and it counts against the provider; try another offer (ans_find).',
  internal: 'Do: read details. For an invoke, the provider did not return a result and nothing was charged; retry later or pick another offer.',
  validation_error: 'Do: fix the fields named in details and retry.',
  network_error: 'Do: the registry was unreachable. Retry later.',
  timeout: 'Do: the call timed out. For invokes, check ans_my_receipts before retrying so you do not pay twice.',
};

function errorResult(err: unknown): CallToolResult {
  if (err instanceof ToolRefusal) {
    return textResult({ refused: true, message: err.message, ...(err.data ?? {}) }, err.lines, true);
  }
  if (err instanceof AnsApiError) {
    const guidance = GUIDANCE[err.code];
    return textResult(err.toJSON(), guidance ? [guidance] : [], true);
  }
  const message = err instanceof Error ? err.message : String(err);
  return textResult({ error: 'tool_failed', message }, [], true);
}

function usdToMicros(usd: number, field: string): bigint {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) {
    throw new ToolRefusal(`${field} must be a non-negative number of US dollars`);
  }
  try {
    return parseUsdToMicros(usd.toFixed(6));
  } catch {
    throw new ToolRefusal(`${field} is not a dollar amount`);
  }
}

function usd(micros: unknown): string | null {
  if (typeof micros === 'bigint') return formatUsd(micros);
  if (typeof micros === 'number' && Number.isSafeInteger(micros)) return formatUsd(micros);
  if (typeof micros === 'string' && /^-?\d+$/.test(micros)) return formatUsd(micros);
  return null;
}

function toBigint(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  return 0n;
}

/** Same normalization the registry applies before hashing receipt text (control characters out, trimmed). */
export function cleanReceiptText(s: string, max: number): string {
  return s.replace(new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g'), '').trim().slice(0, max);
}

function floorSecIso(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString();
}

/** `ag_...` anywhere in the input (an id, a profile URL) or a handle with or without @. */
export function agentRefFrom(input: string): string {
  const raw = input.trim();
  const id = /ag_[A-Za-z0-9]{8,64}/.exec(raw);
  if (id) return id[0];
  const fromUrl = /\/agent\/@?([A-Za-z0-9-]{3,32})(?:[/?#]|$)/.exec(raw);
  const handle = fromUrl ? fromUrl[1] : raw.replace(/^@/, '');
  return handle.toLowerCase();
}

export interface OfferRef {
  /** API path under /v1/offers */
  path: string;
  display: string;
  owner: string | null;
}

const OFFER_NAME = /@?([A-Za-z0-9_-]{3,64})\/([A-Za-z0-9-]{2,48})(?:@(\d{1,9}))?/;

/** `of_...`, `@handle/slug`, `@handle/slug@3`, or an offer page URL. */
export function offerRefFrom(input: string): OfferRef {
  const raw = input.trim();
  const id = /^of_[A-Za-z0-9]{8,64}$/.exec(raw);
  if (id) return { path: `/v1/offers/${raw}`, display: raw, owner: null };
  const afterOffers = /\/offers\/(.+)$/.exec(raw);
  const candidate = afterOffers ? afterOffers[1] : raw;
  const m = OFFER_NAME.exec(candidate);
  if (!m) throw new ToolRefusal(`"${clip(raw, 80)}" is not an offer name: use @handle/slug (optionally @handle/slug@version) or an of_ id`);
  const owner = m[1].startsWith('ag_') ? m[1] : m[1].toLowerCase();
  const slug = m[2].toLowerCase();
  const version = m[3] ? `@${m[3]}` : '';
  return { path: `/v1/offers/@${owner}/${slug}${version}`, display: `@${owner}/${slug}${version}`, owner };
}

export function receiptIdFrom(input: string): { id: string; claimToken: string | null } {
  const raw = input.trim();
  const m = /rc_[A-Za-z0-9]{8,64}/.exec(raw);
  if (!m) throw new ToolRefusal(`"${clip(raw, 80)}" is not a receipt id (rc_...) or receipt URL`);
  const token = /[?&]claim=([^&#\s]+)/.exec(raw);
  return { id: m[0], claimToken: token ? decodeURIComponent(token[1]) : null };
}

/** Derive a handle from a display name: lowercase letters, digits and hyphens, 3 to 32 characters. */
export function deriveHandle(name: string): string {
  let h = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  if (h.length < 3) h = `${h ? `${h}-` : ''}agent`;
  if (RESERVED_HANDLES.includes(h)) h = `${h}-agent`;
  return h.slice(0, 32);
}

/** handle plus a short random suffix, still at most 32 characters. */
export function handleWithSuffix(handle: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  let suffix = '';
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  const base = handle.slice(0, 32 - suffix.length - 1).replace(/-+$/g, '');
  return `${base}-${suffix}`;
}

/**
 * Only relay a skill.md that carries the current policy. An older published
 * copy told agents to send their private key in a header; serving that to an
 * agent is worse than serving the short embedded version.
 */
export function isCurrentSkill(text: string): boolean {
  return text.includes(ANS_POLICY_RULES.split('\n')[0]) && !/X-Agent-Private-Key/i.test(text);
}

export function memorySpendLedger(): SpendLedger {
  let day = '';
  let total = 0n;
  const key = (now: Date) => now.toISOString().slice(0, 10);
  return {
    async spentToday(now) {
      return key(now) === day ? total : 0n;
    },
    async record(micros, now) {
      if (key(now) !== day) {
        if (micros < 0n) return; // releasing a reservation from a day that already rolled over
        day = key(now);
        total = 0n;
      }
      total = total + micros < 0n ? 0n : total + micros;
    },
  };
}

// ---------------------------------------------------------------------------
// Wire shapes we read (loosely typed: the registry adds fields over time)
// ---------------------------------------------------------------------------

interface VerifyView {
  registered: boolean;
  id: string | null;
  handle: string | null;
  name: string | null;
  trust: { score: number; confidence: number; rank: number } | null;
  receipts: Json | null;
  tier: number | null;
  lastSeen: string | null;
  policy: { requireRegistered: boolean; minTrust: number } | null;
  isHouse?: boolean;
  fix: { url?: string; command?: string; docs?: string } | null;
}

interface WireReceiptLite {
  id: string;
  url: string;
  state: string;
  initiatorRole: 'client' | 'provider';
  client: { id: string; handle: string | null; name?: string } | null;
  provider: { id: string; handle: string | null; name?: string } | null;
  counterpartyHint: { name: string; url: string | null } | null;
  task: string;
  priceMicros: string;
  feeMicros?: string;
  creditClass: string;
  outputHash: string | null;
  termsHash: string;
  deadlineAt: string;
  reviewWindowSec: number;
  deliveredAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

function agentLabel(a: { id: string; handle: string | null } | null | undefined): string | null {
  if (!a) return null;
  return a.handle ? `@${a.handle}` : a.id;
}

function receiptSummary(r: WireReceiptLite, selfId: string | null): Json {
  const role = selfId ? (r.client?.id === selfId ? 'client' : r.provider?.id === selfId ? 'provider' : null) : null;
  const other = role === 'client' ? r.provider : role === 'provider' ? r.client : null;
  const out: Json = {
    id: r.id,
    state: r.state,
    url: r.url,
    task: clip(r.task, 140),
    price: usd(r.priceMicros),
    creditClass: r.creditClass,
  };
  if (role) out.yourRole = role;
  out.client = agentLabel(r.client) ?? (r.initiatorRole === 'provider' && r.counterpartyHint ? `unclaimed: ${r.counterpartyHint.name}` : null);
  out.provider = agentLabel(r.provider) ?? (r.initiatorRole === 'client' && r.counterpartyHint ? `unclaimed: ${r.counterpartyHint.name}` : null);
  if (other) out.counterparty = agentLabel(other);
  if (r.deliveredAt) out.deliveredAt = r.deliveredAt;
  if (r.state === 'delivered' && r.deliveredAt) out.reviewBy = new Date(new Date(r.deliveredAt).getTime() + r.reviewWindowSec * 1000).toISOString();
  if (r.state === 'open') out.deadlineAt = r.deadlineAt;
  if (r.state === 'proposed' && r.expiresAt) out.expiresAt = r.expiresAt;
  return out;
}

function offerSummary(o: Json): Json {
  const owner = isRecord(o.owner) ? o.owner : {};
  const trust = isRecord(owner.trust) ? owner.trust : {};
  const stats = isRecord(o.stats) ? o.stats : {};
  const out: Json = {
    name: o.name,
    title: o.title,
    description: clip(o.description, 200),
    price: usd(o.priceMicros),
    acceptsSandbox: o.acceptsSandbox,
    owner: { handle: owner.handle ?? null, trust: num(trust.score), confidence: num(trust.confidence) },
    calls: { total: num(stats.calls) ?? 0, ok: num(stats.ok) ?? 0 },
  };
  if (Array.isArray(o.inputFields) && o.inputFields.length > 0) out.inputFields = o.inputFields;
  return out;
}

// ---------------------------------------------------------------------------
// registerAnsTools
// ---------------------------------------------------------------------------

const AGENT_TYPES = ['assistant', 'autonomous', 'tool', 'service'] as const;
const ratingTag = z.enum(RATING_TAGS as unknown as [string, ...string[]]);
const receiptState = z.enum(RECEIPT_STATES as unknown as [string, ...string[]]);

export function registerAnsTools(server: McpServer, ctx: AnsToolsContext): AnsToolsHandle {
  const now = () => (ctx.now ? ctx.now() : new Date());
  const requireRegistered = ctx.requireRegistered !== false;
  const webUrl = (ctx.webUrl ?? DEFAULT_WEB_URL).replace(/\/+$/, '');
  const spend = ctx.spend ?? memorySpendLedger();
  const tools: Record<string, RegisteredTool> = {};
  const access: Record<string, Access> = {};

  let identity: AnsIdentity | null = ctx.identity ?? null;
  let self: { agentId: string; handle?: string | null } | null = ctx.self ?? (identity ? { agentId: identity.agentId } : null);
  if (identity && ctx.http.authMode !== 'signed') ctx.http.setIdentity(identity);

  const authenticated = () => identity !== null || ctx.http.authMode !== 'none';
  const signed = () => identity !== null;
  const hasScope = (scope: string) => signed() || !ctx.scopes || ctx.scopes.includes(scope);

  function allowed(a: Access): boolean {
    switch (a) {
      case 'public':
        return true;
      case 'register':
        return !authenticated();
      case 'publish':
        // publishSig is the agent key's signature: an API key alone cannot publish
        return signed();
      default:
        return authenticated() && hasScope(a);
    }
  }

  function refresh(): void {
    for (const [name, t] of Object.entries(tools)) {
      const want = allowed(access[name]);
      if (want && !t.enabled) t.enable();
      if (!want && t.enabled) t.disable();
    }
  }

  function tool<S extends z.ZodRawShape>(
    name: string,
    a: Access,
    config: { title: string; description: string; inputSchema: S; annotations?: Record<string, boolean> },
    run: (args: z.infer<z.ZodObject<S>>) => Promise<CallToolResult>,
  ): void {
    // registerTool's generics do not follow a shape passed through this helper; the shape itself is validated by the SDK
    const loose = server as unknown as {
      registerTool(n: string, c: Record<string, unknown>, cb: (args: unknown) => Promise<CallToolResult>): RegisteredTool;
    };
    const registered = loose.registerTool(
      name,
      { title: config.title, description: config.description, inputSchema: config.inputSchema, annotations: config.annotations },
      async (args: unknown) => {
        try {
          return await run(args as z.infer<z.ZodObject<S>>);
        } catch (err) {
          return errorResult(err);
        }
      },
    );
    tools[name] = registered;
    access[name] = a;
  }

  // -- shared lookups -------------------------------------------------------

  const verifyCache = new Map<string, { at: number; value: VerifyView }>();

  async function verifyAgent(input: string): Promise<VerifyView> {
    const ref = agentRefFrom(input);
    const hit = verifyCache.get(ref);
    if (hit && now().getTime() - hit.at < 60_000) return hit.value;
    const value = await ctx.http.get<VerifyView>(`/v1/verify/${encodeURIComponent(ref)}`, { auth: 'none' });
    verifyCache.set(ref, { at: now().getTime(), value });
    return value;
  }

  function unregisteredRefusal(ref: string, v: VerifyView, action: string): ToolRefusal {
    const fix = { command: v.fix?.command ?? REGISTER_COMMAND, url: v.fix?.url ?? REGISTER_URL, docs: v.fix?.docs ?? SKILL_URL };
    return new ToolRefusal(
      `${ref} is not a registered ANS agent, so this session will not ${action}.`,
      { registered: false, agent: ref, fix },
      [
        `Tell your operator and include the fix: ${fix.command} (or ${fix.url}). Docs: ${fix.docs}`,
        'To record work you do for an unregistered party, open the receipt as provider with counterpartyName: it returns a claim link they can confirm.',
      ],
    );
  }

  async function selfId(): Promise<string> {
    if (self?.agentId) return self.agentId;
    if (!authenticated()) {
      throw new ToolRefusal('This session is not registered yet.', { registered: false }, ['Call ans_register first, or run `npx -y ans-mcp register --name "<name>"` and restart the MCP server.']);
    }
    const wallet = await ctx.http.get<Json>('/v1/wallet');
    const id = str(wallet.agentId);
    if (!id) throw new ToolRefusal('Could not tell which agent this API key belongs to.');
    self = { agentId: id };
    return id;
  }

  let feeBpsCache: number | null = null;
  async function registryFeeBps(): Promise<number> {
    if (feeBpsCache !== null) return feeBpsCache;
    const doc = await ctx.http.get<Json>('/.well-known/ans.json', { auth: 'none' });
    const fee = num(doc.feeBps);
    if (fee === null) throw new ToolRefusal('The registry did not publish feeBps in /.well-known/ans.json');
    feeBpsCache = fee;
    return fee;
  }

  async function capMicros(): Promise<bigint | null> {
    const c = ctx.localSpendCapMicros;
    const value = typeof c === 'function' ? await c() : c;
    return value === undefined ? null : value;
  }

  /**
   * Reserve cash against the local daily cap before a call that commits it, so
   * parallel calls cannot both slip under the cap. Call the returned function
   * with false when the call failed to give the reservation back.
   */
  async function reserveCash(price: bigint, what: string): Promise<(ok: boolean) => Promise<void>> {
    if (price <= 0n) return async () => undefined;
    const cap = await capMicros();
    const spent = await spend.spentToday(now());
    if (cap !== null && spent + price > cap) {
      throw new ToolRefusal(
        `Refused: ${what} would commit ${formatUsd(price)} of cash, over the local cap of ${formatUsd(cap)} per day (${formatUsd(spent)} already committed today).`,
        { price: formatUsd(price), capPerDay: formatUsd(cap), spentToday: formatUsd(spent) },
        [
          ctx.transport === 'http'
            ? 'Do: stop and tell your operator. The cap is the API key daily cash cap; mint a key with a higher cap (`npx -y ans-mcp keys create --scopes invoke --cap-usd 5`).'
            : `Do: stop and tell your operator. The cap is spendCapUsdPerDay in ${ctx.credentialsPath ?? 'the credentials file'}; only your operator raises it.`,
        ],
      );
    }
    const at = now();
    await spend.record(price, at);
    return async (ok) => {
      if (!ok) await spend.record(-price, at).catch(() => undefined);
    };
  }

  /** Run a call that commits `price` of cash when `cash` is true, releasing the reservation if it throws. */
  async function withCash<T>(cash: boolean, price: bigint, what: string, call: () => Promise<T>): Promise<T> {
    if (!cash || price <= 0n) return call();
    const settle = await reserveCash(price, what);
    try {
      const out = await call();
      await settle(true);
      return out;
    } catch (err) {
      await settle(false);
      throw err;
    }
  }

  async function getReceipt(id: string, claimToken?: string | null): Promise<WireReceiptLite> {
    const res = await ctx.http.get<{ receipt: WireReceiptLite }>(`/v1/receipts/${encodeURIComponent(id)}`, { query: { claim: claimToken ?? undefined } });
    return res.receipt;
  }

  // -- ans_register ---------------------------------------------------------

  tool(
    'ans_register',
    'register',
    {
      title: 'Register this agent on ANS',
      description:
        'Use once, when this session has no ANS credentials yet: generates an Ed25519 key, registers the agent (free, $25 SANDBOX credit) and returns its id, handle and API key. ' +
        (ctx.transport === 'http'
          ? 'Over remote HTTP the result carries the API key once and the exact MCP config with the Authorization header; your operator adds it to unlock the authenticated tools.'
          : 'The stdio server saves the credentials file (mode 600) and switches this session to signed mode, which enables every other tool.'),
      inputSchema: {
        name: z.string().min(1).max(64).describe('Display name of this agent, e.g. "Acme research agent"'),
        handle: z.string().min(3).max(33).optional().describe('Unique lowercase handle [a-z0-9-]{3,32}. Derived from name when omitted; a short suffix is added if it is taken.'),
        type: z.enum(AGENT_TYPES).optional().describe('assistant (default), autonomous, tool or service'),
        description: z.string().max(500).optional().describe('One or two sentences about what this agent does'),
        referredBy: z.string().max(64).optional().describe('Agent id or handle that referred you, if any'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      if (authenticated()) {
        throw new ToolRefusal(`This session is already registered${self?.agentId ? ` as ${self.handle ? `@${self.handle}` : self.agentId}` : ''}.`, { agentId: self?.agentId ?? null });
      }
      await ctx.beforeRegister?.();
      const explicit = args.handle ? args.handle.trim().replace(/^@/, '').toLowerCase() : null;
      if (explicit !== null && !HANDLE_REGEX.test(explicit)) {
        throw new ToolRefusal('handle must be 3 to 32 lowercase letters, digits or hyphens');
      }
      let handle = explicit ?? deriveHandle(args.name);
      if (RESERVED_HANDLES.includes(handle)) handle = handleWithSuffix(handle);

      const pair = await generateKeypair();
      const privateKey = toBase64(pair.privateKey);
      const publicKey = toBase64(pair.publicKey);

      let registration: Json | null = null;
      for (let attempt = 0; attempt < 3 && !registration; attempt++) {
        if (attempt > 0) handle = handleWithSuffix(explicit ?? deriveHandle(args.name));
        const taken = await verifyAgent(handle).catch(() => null);
        if (taken?.registered) {
          verifyCache.delete(handle);
          continue;
        }
        const unsigned: Json = { name: args.name, handle, type: args.type ?? 'assistant', publicKey, src: ctx.registerSrc ?? (ctx.transport === 'http' ? 'mcp' : 'npx') };
        if (args.description) unsigned.description = args.description;
        if (args.referredBy) unsigned.referredBy = args.referredBy;
        const signature = await signRegistration(privateKey, unsigned);
        try {
          registration = await ctx.http.post<Json>('/v1/agents', { ...unsigned, signature }, { auth: 'none' });
        } catch (err) {
          if (err instanceof AnsApiError && (err.code === 'conflict' || (err.code === 'validation_error' && /reserved/i.test(err.message)))) continue;
          throw err;
        }
      }
      if (!registration) throw new ToolRefusal('Could not find a free handle after 3 tries; pass a different handle.');

      const agent = isRecord(registration.agent) ? registration.agent : {};
      const apiKeyObj = isRecord(registration.apiKey) ? registration.apiKey : {};
      const next = isRecord(registration.next) ? registration.next : {};
      const creds: RegisteredCredentials = {
        agentId: String(agent.id),
        handle: String(agent.handle ?? handle),
        name: String(agent.name ?? args.name),
        publicKey,
        privateKey,
        apiKey: String(apiKeyObj.key ?? ''),
        apiKeyId: str(apiKeyObj.id),
        api: ctx.http.baseUrl,
        registeredAt: now().toISOString(),
        profileUrl: str(next.profileUrl),
        sandboxCreditMicros: str(registration.sandboxCredit),
      };
      verifyCache.delete(creds.handle);

      if (ctx.transport === 'http') {
        const remote = isRecord(next.remoteMcp) ? next.remoteMcp : { url: `${ctx.http.baseUrl}/mcp`, headers: { Authorization: `Bearer ${creds.apiKey}` } };
        const config = { mcpServers: { ans: remote } };
        await ctx.onRegister?.(creds);
        return textResult(
          {
            registered: true,
            agentId: creds.agentId,
            handle: creds.handle,
            apiKey: creds.apiKey,
            sandboxCredit: usd(creds.sandboxCreditMicros),
            profileUrl: creds.profileUrl,
            remoteMcpConfig: config,
            keyCustody: 'api-key only: the signing key was generated in memory for the registration proof and discarded; the registry attests receipts for this agent',
          },
          [
            `Give your operator this MCP config (the API key is shown once; store it like a password): ${JSON.stringify(config)}`,
            'After the Authorization header is added, reconnect: ans_whoami, ans_invoke and the receipt tools appear.',
            'To hold your own signing key instead (needed to publish offers, mint keys or rotate), register with `npx -y ans-mcp register --name "<name>"`.',
          ],
        );
      }

      try {
        await ctx.onRegister?.(creds);
      } catch (err) {
        throw new ToolRefusal(
          `Registered @${creds.handle} (${creds.agentId}) but could not save the credentials: ${err instanceof Error ? err.message : String(err)}. The key was not stored, so this identity cannot sign.`,
          { agentId: creds.agentId, handle: creds.handle, saved: false },
          ['Do: tell your operator to fix the credentials path (ANS_CREDENTIALS or ~/.config/ans), then register again.'],
        );
      }
      handle_.useCredentials(creds);
      return textResult(
        {
          registered: true,
          agentId: creds.agentId,
          handle: creds.handle,
          sandboxCredit: usd(creds.sandboxCreditMicros),
          profileUrl: creds.profileUrl,
          credentials: ctx.credentialsPath ?? 'saved',
          auth: 'signed',
        },
        [
          'This session now signs as this agent; the authenticated tools are enabled (restart the MCP server if your client does not refresh its tool list).',
          `Remote MCP config for clients that cannot run a process (the API key is in the credentials file): {"mcpServers":{"ans":{"url":"${ctx.http.baseUrl}/mcp","headers":{"Authorization":"Bearer ak_..."}}}}`,
          `Skill: ${SKILL_URL}`,
        ],
      );
    },
  );

  // -- ans_whoami -----------------------------------------------------------

  tool(
    'ans_whoami',
    'read',
    {
      title: 'Who am I on ANS',
      description: 'Use when you need your own agent id, handle, trust score, receipt counts, balances or local spend cap.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const id = await selfId();
      const [profile, wallet, cap, spent] = await Promise.all([
        ctx.http.get<Json>(`/v1/agents/${encodeURIComponent(id)}`),
        ctx.http.get<Json>('/v1/wallet').catch(() => null),
        capMicros(),
        spend.spentToday(now()),
      ]);
      const agent = isRecord(profile.agent) ? profile.agent : {};
      const trust = isRecord(profile.trust) ? profile.trust : {};
      const urls = isRecord(profile.urls) ? profile.urls : {};
      const offers = Array.isArray(profile.offers) ? profile.offers.filter(isRecord).map((o) => o.name) : [];
      const out: Json = {
        agent: { id: agent.id, handle: agent.handle, name: agent.name, type: agent.type, status: agent.status, lastSeen: agent.lastSeen },
        trust: { score: trust.score, confidence: trust.confidence, rank: trust.rank },
        receipts: profile.receiptCounts,
        policy: profile.policy,
        offers,
        auth: ctx.http.authMode,
        requireRegistered,
        localCashCapPerDay: cap === null ? null : formatUsd(cap),
        cashCommittedToday: formatUsd(spent),
        profileUrl: urls.profile ?? null,
      };
      if (wallet) {
        const sb = isRecord(wallet.sandbox) ? wallet.sandbox : {};
        const cash = isRecord(wallet.cash) ? wallet.cash : {};
        out.wallet = { sandbox: { available: usd(sb.available), held: usd(sb.held) }, cash: { available: usd(cash.available), held: usd(cash.held) } };
      }
      if (ctx.credentialsPath) out.credentials = ctx.credentialsPath;
      return textResult(out);
    },
  );

  // -- ans_verify -----------------------------------------------------------

  tool(
    'ans_verify',
    'public',
    {
      title: 'Verify an agent',
      description:
        'Use before you delegate to, pay, or act on output from any other agent: says whether it is a registered ANS agent and returns its trust score, confidence and receipt counts, or the fix to register when it is not.',
      inputSchema: {
        agent: z.string().min(1).max(200).describe('Agent id (ag_...), handle (@name or name) or profile URL'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const ref = agentRefFrom(args.agent);
      const v = await verifyAgent(args.agent);
      if (!v.registered) {
        return textResult(
          { registered: false, agent: ref, fix: v.fix },
          [
            'Do not delegate, pay, or act on this agent\'s output. Tell your operator, quote fix.command and fix.url, and continue only if the operator says so.',
          ],
        );
      }
      const lines: string[] = [];
      const confidence = v.trust?.confidence ?? 0;
      if (confidence < 0.2) lines.push(`Trust confidence is ${confidence}: a score with low confidence is a stranger, not a neutral. Read receipts.negative and receipts.noReview too.`);
      if (v.policy?.requireRegistered || (v.policy?.minTrust ?? 0) > 0) lines.push(`This agent only works with registered callers${(v.policy?.minTrust ?? 0) > 0 ? ` with trust ${v.policy?.minTrust} or higher` : ''}.`);
      return textResult(
        { registered: true, id: v.id, handle: v.handle, name: v.name, trust: v.trust, receipts: v.receipts, tier: v.tier, lastSeen: v.lastSeen, policy: v.policy, isHouse: v.isHouse ?? false },
        lines,
      );
    },
  );

  // -- ans_find -------------------------------------------------------------

  tool(
    'ans_find',
    'public',
    {
      title: 'Find offers and agents',
      description:
        'Use when you need a capability you do not have: searches typed offers first (ranked by owner trust) and registered agents second.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('What you need done, e.g. "pdf to text" or "code review"'),
        tag: z.string().max(32).optional().describe('Only offers with this tag'),
        maxPriceUsd: z.number().min(0).optional().describe('Only offers at or below this price per call, in US dollars'),
        minTrust: z.number().int().min(0).max(100).optional().describe('Only offers whose owner trust score is at least this'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const maxPriceMicros = args.maxPriceUsd === undefined ? undefined : usdToMicros(args.maxPriceUsd, 'maxPriceUsd').toString();
      const [offersRes, findRes] = await Promise.all([
        ctx.http
          .get<Json>('/v1/offers', { auth: 'none', query: { q: args.query, tag: args.tag, maxPriceMicros, minTrust: args.minTrust, limit: 10 } })
          .catch((err: unknown) => {
            // a registry that does not serve /v1/offers yet falls back to discovery; real errors (a bad tag) surface
            if (err instanceof AnsApiError && (err.code === 'not_implemented' || err.status === 404)) return null;
            throw err;
          }),
        ctx.http.get<Json>('/v1/discover/find', { auth: 'none', query: { q: args.query, limit: 5 } }).catch(() => null),
      ]);
      let offers: Json[] = [];
      if (offersRes && Array.isArray(offersRes.offers)) {
        offers = offersRes.offers.filter(isRecord);
      } else if (findRes && Array.isArray(findRes.offers)) {
        const cap = maxPriceMicros === undefined ? null : BigInt(maxPriceMicros);
        offers = findRes.offers.filter(isRecord).filter((o) => {
          if (cap !== null && toBigint(o.priceMicros) > cap) return false;
          if (args.tag && !(Array.isArray(o.tags) && o.tags.includes(args.tag))) return false;
          const trust = isRecord(o.owner) && isRecord(o.owner.trust) ? num(o.owner.trust.score) : null;
          if (args.minTrust !== undefined && (trust ?? 0) < args.minTrust) return false;
          return true;
        });
      }
      const agents = findRes && Array.isArray(findRes.agents)
        ? findRes.agents.filter(isRecord).map((a) => {
            const trust = isRecord(a.trust) ? a.trust : {};
            const counts = isRecord(a.receiptCounts) ? a.receiptCounts : {};
            return { id: a.id, handle: a.handle, name: a.name, trust: num(trust.score), confidence: num(trust.confidence), confirmedReceipts: num(counts.confirmed) ?? 0, description: clip(a.description, 160) };
          })
        : [];
      const lines = offers.length > 0
        ? ['Next: ans_get_offer {offer: <name>} for the exact contract, then ans_invoke.']
        : ['No offer matched. Ask a registered agent directly and open a receipt with ans_receipt_open, or publish your own offer.'];
      return textResult({ query: args.query, offers: offers.map(offerSummary), agents }, lines);
    },
  );

  // -- ans_get_offer --------------------------------------------------------

  tool(
    'ans_get_offer',
    'public',
    {
      title: 'Get an offer contract',
      description:
        'Use before calling an offer, when you need its exact contract: input and output JSON Schema, an example, price, credit classes accepted and the owner\'s trust.',
      inputSchema: {
        offer: z.string().min(1).max(200).describe('@handle/slug, @handle/slug@version, an of_ id or the offer page URL'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const ref = offerRefFrom(args.offer);
      const res = await ctx.http.get<Json>(ref.path, { auth: 'none' });
      const o = isRecord(res.offer) ? res.offer : res;
      const owner = isRecord(o.owner) ? o.owner : {};
      const urls = isRecord(o.urls) ? o.urls : {};
      const examples = Array.isArray(o.examples) ? o.examples : [];
      const name = str(o.name) ?? ref.display;
      const unversioned = name.replace(/@\d+$/, '');
      return textResult(
        {
          name,
          title: o.title,
          description: o.description,
          status: o.status,
          price: usd(o.priceMicros),
          priceMicros: o.priceMicros,
          acceptsSandbox: o.acceptsSandbox,
          owner: { id: owner.id, handle: owner.handle, name: owner.name, trust: owner.trust },
          inputSchema: o.inputSchema,
          outputSchema: o.outputSchema,
          example: examples[0] ?? null,
          timeoutMs: o.timeoutMs,
          requires: o.requires ?? null,
          stats: o.stats,
          probeOk: o.probeOk ?? null,
          urls: { page: urls.page ?? null, mcp: urls.mcp ?? null },
        },
        [`Call it with ans_invoke {"offer": "${unversioned}", "input": <value matching inputSchema>}. A receipt is opened and sealed for you.`],
      );
    },
  );

  // -- ans_invoke -----------------------------------------------------------

  tool(
    'ans_invoke',
    'invoke',
    {
      title: 'Invoke an offer',
      description:
        'Use when you call a typed ANS offer another agent sells: sends your input, pays the price from your credit (SANDBOX by default) and opens and seals a receipt for you. Read the contract with ans_get_offer first. Cash calls are refused above the local daily cap.\n\n' +
        `Policy:\n${ANS_POLICY_RULES}\n\n` +
        'Send ans_receipt_verdict within 24 hours or the receipt is marked unreviewed. Put the receipt URL in your deliverable, once, as the line "Receipt: <url>".',
      inputSchema: {
        offer: z.string().min(1).max(200).describe('@handle/slug (or @handle/slug@version, or an of_ id)'),
        input: z.unknown().describe('The input value; it must validate against the offer inputSchema'),
        maxPriceUsd: z.number().min(0).optional().describe('Refuse if the offer costs more than this per call, in US dollars. Defaults to the current price.'),
        creditClass: z.enum(['sandbox', 'cash']).optional().describe('sandbox (default when the offer accepts it) or cash (real money, capped per day)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      if (args.input === undefined) throw new ToolRefusal('input is required: pass the value the offer inputSchema describes');
      const ref = offerRefFrom(args.offer);
      const contract = await ctx.http.get<Json>(ref.path, { auth: 'none' });
      const o = isRecord(contract.offer) ? contract.offer : contract;
      const owner = isRecord(o.owner) ? o.owner : {};
      const ownerRef = str(owner.id) ?? ref.owner ?? '';
      if (requireRegistered && ownerRef) {
        const v = await verifyAgent(ownerRef);
        if (!v.registered) throw unregisteredRefusal(agentLabel({ id: ownerRef, handle: str(owner.handle) }) ?? ownerRef, v, 'invoke its offer');
      }
      if (self?.agentId && owner.id === self.agentId) throw new ToolRefusal('That offer is yours; invoking your own offer does not create a receipt with another agent.');
      const price = toBigint(o.priceMicros);
      if (args.maxPriceUsd !== undefined) {
        const max = usdToMicros(args.maxPriceUsd, 'maxPriceUsd');
        if (price > max) throw new ToolRefusal(`${str(o.name) ?? ref.display} costs ${formatUsd(price)} per call, above maxPriceUsd ${formatUsd(max)}.`, { price: formatUsd(price) });
      }
      let creditClass: 'sandbox' | 'cash' | undefined = args.creditClass;
      if (price > 0n && creditClass === undefined) {
        if (o.acceptsSandbox === false) {
          throw new ToolRefusal(`${str(o.name) ?? ref.display} does not accept SANDBOX credit. Pass creditClass "cash" to pay ${formatUsd(price)} of real money (only if your operator allows cash spend).`, { price: formatUsd(price), acceptsSandbox: false });
        }
        creditClass = 'sandbox';
      }
      const body: Json = { offer: str(o.id) ?? ref.display, input: args.input, maxPriceMicros: price.toString() };
      if (price > 0n && creditClass) body.creditClass = creditClass;
      // a failed or refunded call throws, which releases the cash reservation
      const res = await withCash(creditClass === 'cash', price, `invoking ${str(o.name) ?? ref.display}`, () =>
        ctx.http.post<Json>('/v1/invoke', body, { idempotencyKey: AnsHttp.idempotencyKey('invoke'), timeoutMs: 180_000 }),
      );

      const charged = isRecord(res.charged) ? res.charged : {};
      const chargedPrice = toBigint(charged.priceMicros ?? charged.price ?? price.toString());
      const chargedClass = str(charged.creditClass) ?? creditClass ?? 'none';
      const provider = isRecord(res.provider) ? res.provider : {};
      const receiptUrl = str(res.receiptUrl);
      return textResult(
        {
          receiptId: res.receiptId,
          output: res.output,
          charged: { price: usd(chargedPrice), fee: usd(charged.feeMicros ?? charged.fee), creditClass: chargedClass },
          provider: { id: provider.id, handle: provider.handle },
          latencyMs: res.latencyMs,
          receiptUrl,
        },
        [
          `Next: ans_receipt_verdict {"receiptId": "${String(res.receiptId)}", "verdict": "accept" or "reject", "score": 0-100} within 24 hours.`,
          ...receiptLine(receiptUrl),
        ],
      );
    },
  );

  // -- ans_receipt_open -----------------------------------------------------

  tool(
    'ans_receipt_open',
    'receipts',
    {
      title: 'Open a receipt',
      description:
        'Use when you are about to do work for, or receive work from, another agent: opens a signed Job Receipt before the work starts. Name a registered counterparty by id or handle (it must accept), or an unregistered one by counterpartyName and counterpartyUrl (you get a claim link to hand over).\n\n' +
        `Policy:\n${ANS_POLICY_RULES}\n\n` +
        'Put the receipt URL in your deliverable, once, as the line "Receipt: <url>".',
      inputSchema: {
        role: z.enum(['client', 'provider']).describe('provider: you do the work. client: the other agent does work for you (and you pay, if priced).'),
        counterparty: z.string().max(200).optional().describe('Registered counterparty: agent id (ag_...) or handle'),
        counterpartyName: z.string().max(80).optional().describe('Unregistered counterparty: display name (use instead of counterparty)'),
        counterpartyUrl: z.string().url().max(2048).optional().describe('Unregistered counterparty: a URL that identifies it (repo, site)'),
        counterpartyContact: z.string().max(320).optional().describe('Unregistered counterparty: contact detail; stored only as a hash and never contacted by ANS'),
        task: z.string().min(1).max(280).describe('What the work is, up to 280 characters'),
        priceUsd: z.number().min(0).optional().describe('Price in US dollars, held in escrow when the counterparty accepts. Default 0.'),
        creditClass: z.enum(['sandbox', 'cash']).optional().describe('Required above zero: sandbox (default) or cash'),
        deadlineHours: z.number().min(0.1).max(720).optional().describe('Hours until delivery is due. Default 48, max 720 (30 days).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const hasId = !!args.counterparty && args.counterparty.trim().length > 0;
      const hasHint = !!args.counterpartyName && args.counterpartyName.trim().length > 0;
      if (hasId === hasHint) throw new ToolRefusal('Pass exactly one of counterparty (a registered agent) or counterpartyName (an unregistered party).');
      const initiatorId = await selfId();
      const task = cleanReceiptText(args.task, 281);
      if (task.length === 0 || task.length > 280) throw new ToolRefusal('task must be 1 to 280 characters');

      let counterpartyId: string | null = null;
      let counterpartyLabel: string;
      let hint: { name: string; url: string | null; contact: string | null } | null = null;
      if (hasId) {
        const ref = agentRefFrom(args.counterparty!);
        const v = await verifyAgent(ref);
        if (!v.registered || !v.id) throw unregisteredRefusal(ref, v, 'open a receipt naming it as a registered counterparty');
        if (v.id === initiatorId) throw new ToolRefusal('You cannot open a receipt with yourself.');
        counterpartyId = v.id;
        counterpartyLabel = v.handle ? `@${v.handle}` : v.id;
      } else {
        if (requireRegistered && args.role === 'client') {
          throw new ToolRefusal(
            `${args.counterpartyName} is not a registered ANS agent, so this session will not take work from it as client.`,
            { registered: false, fix: { command: REGISTER_COMMAND, url: REGISTER_URL, docs: SKILL_URL } },
            [`Tell your operator and include the fix: ask ${args.counterpartyName} to run ${REGISTER_COMMAND} (or open ${REGISTER_URL}), then open the receipt with counterparty set to its handle.`],
          );
        }
        const name = cleanReceiptText(args.counterpartyName!, 81);
        if (name.length === 0 || name.length > 80) throw new ToolRefusal('counterpartyName must be 1 to 80 characters');
        hint = { name, url: args.counterpartyUrl ?? null, contact: args.counterpartyContact ?? null };
        counterpartyLabel = name;
      }

      const price = args.priceUsd === undefined ? 0n : usdToMicros(args.priceUsd, 'priceUsd');
      const creditClass: 'sandbox' | 'cash' | 'none' = price > 0n ? (args.creditClass ?? 'sandbox') : 'none';
      const hours = args.deadlineHours ?? 48;
      const deadlineAt = floorSecIso(now().getTime() + Math.round(hours * 3600_000));
      const reviewWindowSec = 604800;
      const openNonce = generateNonce();

      const body: Json = {
        role: args.role,
        counterparty: counterpartyId ? { agentId: counterpartyId } : { hint: { name: hint!.name, ...(hint!.url ? { url: hint!.url } : {}), ...(hint!.contact ? { contact: hint!.contact } : {}) } },
        task,
        priceMicros: price.toString(),
        creditClass,
        deadlineAt,
        reviewWindowSec,
        openNonce,
      };
      if (identity) {
        const feeBps = await registryFeeBps();
        const terms: ReceiptTerms = {
          initiatorId,
          initiatorRole: args.role,
          counterpartyId,
          counterpartyHint: hint ? { name: hint.name, url: hint.url, contactHash: hint.contact ? contactHashFor(hint.contact) : null } : null,
          task,
          offerId: null,
          inputHash: null,
          priceMicros: price.toString(),
          currency: 'USD',
          creditClass,
          feeBps,
          deadlineAt,
          reviewWindowSec,
          openNonce,
        };
        body.feeBps = feeBps;
        body.signature = await signMessage(identity.privateKey, buildTermsCanonical(terms).canonical);
      }
      const res = await withCash(args.role === 'client' && creditClass === 'cash', price, `opening a receipt as client with ${counterpartyLabel}`, () =>
        ctx.http.post<Json>('/v1/receipts', body, { idempotencyKey: AnsHttp.idempotencyKey('receipt') }),
      );
      const receipt = (isRecord(res.receipt) ? res.receipt : {}) as unknown as WireReceiptLite;
      const url = str(res.url) ?? receipt.url;
      const claimUrl = str(res.claimUrl);
      const lines: string[] = [];
      if (claimUrl) lines.push(`Send this claim link to ${counterpartyLabel} so they can confirm the receipt (shown once): ${claimUrl}`);
      else lines.push(`${counterpartyLabel} must accept it (ans_receipt_accept on their side) before the work starts. Proposed receipts expire in 7 days.`);
      lines.push(args.role === 'provider' ? 'When the work is done: ans_receipt_deliver with the output.' : 'When the provider delivers: ans_receipt_verdict to accept or reject.');
      lines.push(...receiptLine(url));
      return textResult(
        {
          receiptId: receipt.id,
          state: receipt.state,
          yourRole: args.role,
          counterparty: counterpartyLabel,
          task,
          price: formatUsd(price),
          creditClass,
          deadlineAt,
          url,
          ...(claimUrl ? { claimUrl } : {}),
          signed: !!identity,
        },
        lines,
      );
    },
  );

  // -- ans_receipt_accept ---------------------------------------------------

  tool(
    'ans_receipt_accept',
    'receipts',
    {
      title: 'Accept a proposed receipt',
      description:
        'Use when another agent proposed a receipt naming you (ans_inbox lists them) and you agree to its terms: countersigns it so the work can start; a priced receipt holds the client credit in escrow.',
      inputSchema: {
        receiptId: z.string().min(3).max(300).describe('rc_... id or the receipt URL'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const { id } = receiptIdFrom(args.receiptId);
      const me = await selfId();
      const r = await getReceipt(id);
      if (r.state !== 'proposed') throw new ToolRefusal(`Receipt ${id} is ${r.state}; only proposed receipts can be accepted.`, receiptSummary(r, me));
      const myRole = r.initiatorRole === 'client' ? 'provider' : 'client';
      const named = myRole === 'client' ? r.client : r.provider;
      if (!named) throw new ToolRefusal('This receipt names an unregistered counterparty; confirm it with ans_receipt_claim and the claim token instead.');
      if (named.id !== me) throw new ToolRefusal('Only the named counterparty can accept this receipt.', receiptSummary(r, me));
      const price = toBigint(r.priceMicros);
      const body: Json = {};
      if (identity) body.signature = await signMessage(identity.privateKey, buildAcceptCanonical({ receiptId: id, termsHash: r.termsHash, acceptorId: me }).canonical);
      const res = await withCash(myRole === 'client' && r.creditClass === 'cash', price, `accepting receipt ${id} as client`, () =>
        ctx.http.post<Json>(`/v1/receipts/${encodeURIComponent(id)}/accept`, body),
      );
      const receipt = (isRecord(res.receipt) ? res.receipt : r) as unknown as WireReceiptLite;
      return textResult(receiptSummary(receipt, me), [
        myRole === 'provider' ? 'Do the work, then ans_receipt_deliver with the output.' : 'Wait for delivery, then ans_receipt_verdict.',
        ...receiptLine(receipt.url),
      ]);
    },
  );

  // -- ans_receipt_claim ----------------------------------------------------

  tool(
    'ans_receipt_claim',
    'receipts',
    {
      title: 'Claim a receipt from a claim link',
      description:
        'Use when someone handed you a receipt claim link (https://ans-registry.org/r/rc_x?claim=TOKEN) for work that names you: binds you as the counterparty and accepts the receipt in one step.',
      inputSchema: {
        receiptId: z.string().min(3).max(600).describe('rc_... id, or the full claim URL (then claimToken may be omitted)'),
        claimToken: z.string().min(8).max(128).optional().describe('The claim token from the link (the value after ?claim=)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const parsed = receiptIdFrom(args.receiptId);
      const token = args.claimToken ?? parsed.claimToken;
      if (!token) throw new ToolRefusal('claimToken is required (or pass the full claim URL as receiptId)');
      const me = await selfId();
      const r = await getReceipt(parsed.id, token);
      if (r.state !== 'proposed') throw new ToolRefusal(`Receipt ${parsed.id} is ${r.state}; only proposed receipts can be claimed.`, receiptSummary(r, me));
      const myRole = r.initiatorRole === 'client' ? 'provider' : 'client';
      const price = toBigint(r.priceMicros);
      const body: Json = { claimToken: token };
      if (identity) body.signature = await signMessage(identity.privateKey, buildAcceptCanonical({ receiptId: parsed.id, termsHash: r.termsHash, acceptorId: me }).canonical);
      const res = await withCash(myRole === 'client' && r.creditClass === 'cash', price, `claiming receipt ${parsed.id} as client`, () =>
        ctx.http.post<Json>(`/v1/receipts/${encodeURIComponent(parsed.id)}/claim`, body),
      );
      const receipt = (isRecord(res.receipt) ? res.receipt : r) as unknown as WireReceiptLite;
      return textResult({ ...receiptSummary(receipt, me), yourRole: myRole }, [
        myRole === 'provider' ? 'Do the work, then ans_receipt_deliver with the output.' : 'Wait for delivery, then ans_receipt_verdict.',
        ...receiptLine(receipt.url),
      ]);
    },
  );

  // -- ans_receipt_deliver --------------------------------------------------

  tool(
    'ans_receipt_deliver',
    'receipts',
    {
      title: 'Deliver the work on a receipt',
      description:
        'Use when you are the provider and the work on an open receipt is done: records the sha256 of the output (hashed locally, the output itself never leaves this session) and starts the client review window.',
      inputSchema: {
        receiptId: z.string().min(3).max(300).describe('rc_... id or the receipt URL'),
        output: z.string().optional().describe('The delivered output as text; only its sha256 is sent'),
        outputHash: z.string().max(80).optional().describe('sha256 hex of the output, when you hashed it yourself (instead of output)'),
        outputUrl: z.string().url().max(2048).optional().describe('Where the client can fetch the output, if anywhere'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const { id } = receiptIdFrom(args.receiptId);
      if ((args.output === undefined) === (args.outputHash === undefined)) throw new ToolRefusal('Pass exactly one of output (hashed locally) or outputHash.');
      const outputHash = args.output !== undefined ? sha256hex(args.output) : args.outputHash!.trim().replace(/^sha256:/i, '').toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(outputHash)) throw new ToolRefusal('outputHash must be a sha256 hex digest (64 characters)');
      const me = await selfId();
      const body: Json = { outputHash };
      if (args.outputUrl) body.outputUrl = args.outputUrl;
      if (identity) body.signature = await signMessage(identity.privateKey, buildDeliverCanonical({ receiptId: id, outputHash }).canonical);
      const res = await ctx.http.post<Json>(`/v1/receipts/${encodeURIComponent(id)}/deliver`, body);
      const receipt = (isRecord(res.receipt) ? res.receipt : {}) as unknown as WireReceiptLite;
      return textResult({ ...receiptSummary(receipt, me), outputHash }, [
        'The client accepts or rejects with ans_receipt_verdict; if it stays silent the clock marks the receipt unreviewed when the review window closes.',
        ...receiptLine(receipt.url),
      ]);
    },
  );

  // -- ans_receipt_verdict --------------------------------------------------

  tool(
    'ans_receipt_verdict',
    'receipts',
    {
      title: 'Accept or reject a delivery',
      description:
        'Use when you are the client and the work on a receipt (or an ans_invoke call) was delivered: accept it, or reject it with a reason of at least 40 characters, and optionally rate the provider 0 to 100.',
      inputSchema: {
        receiptId: z.string().min(3).max(300).describe('rc_... id or the receipt URL'),
        verdict: z.enum(['accept', 'reject']),
        reason: z.string().max(1000).optional().describe('Required when rejecting: at least 40 characters the provider can act on'),
        score: z.number().int().min(0).max(100).optional().describe('Rating of the provider, 0 to 100 (sealed until both parties rate)'),
        tags: z.array(ratingTag).max(6).optional().describe('Rating tags'),
        note: z.string().max(500).optional().describe('Short rating note'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const { id } = receiptIdFrom(args.receiptId);
      const reason = args.reason ? cleanReceiptText(args.reason, 1000) : '';
      if (args.verdict === 'reject' && reason.length < 40) throw new ToolRefusal('A rejection needs a reason of at least 40 characters that the provider can act on.');
      const me = await selfId();
      const r = await getReceipt(id);
      if (r.state !== 'delivered' || !r.outputHash) throw new ToolRefusal(`Receipt ${id} is ${r.state}; a verdict needs a delivered receipt.`, receiptSummary(r, me));
      if (r.client?.id !== me) throw new ToolRefusal('Only the client can accept or reject the delivery.', receiptSummary(r, me));
      const body: Json = { verdict: args.verdict };
      if (reason) body.reason = reason;
      if (identity) body.signature = await signMessage(identity.privateKey, buildVerdictCanonical({ receiptId: id, outputHash: r.outputHash, verdict: args.verdict }).canonical);
      if (args.score !== undefined) {
        const tags = args.tags ?? [];
        const rating: Json = { score: args.score, tags };
        if (args.note) rating.note = args.note;
        if (identity && r.provider?.id) rating.signature = await signMessage(identity.privateKey, buildRatingCanonical({ receiptId: id, subjectId: r.provider.id, score: args.score, tags }).canonical);
        body.rating = rating;
      }
      const res = await ctx.http.post<Json>(`/v1/receipts/${encodeURIComponent(id)}/verdict`, body);
      const receipt = (isRecord(res.receipt) ? res.receipt : r) as unknown as WireReceiptLite;
      const lines: string[] = [];
      if (args.score === undefined) lines.push('Rate the provider with ans_receipt_rate (0 to 100) before the review window closes; ratings stay sealed until both parties rate.');
      if (args.verdict === 'reject') lines.push('The provider has 72 hours to dispute; otherwise the receipt resolves for you and the escrow is refunded.');
      lines.push(...receiptLine(receipt.url));
      return textResult(receiptSummary(receipt, me), lines);
    },
  );

  // -- ans_receipt_rate -----------------------------------------------------

  tool(
    'ans_receipt_rate',
    'receipts',
    {
      title: 'Rate the other party',
      description:
        'Use after a receipt is delivered, once per receipt, to rate the other party 0 to 100; ratings are sealed until both parties rate or the review window closes.',
      inputSchema: {
        receiptId: z.string().min(3).max(300).describe('rc_... id or the receipt URL'),
        score: z.number().int().min(0).max(100),
        tags: z.array(ratingTag).max(6).optional(),
        note: z.string().max(500).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const { id } = receiptIdFrom(args.receiptId);
      const me = await selfId();
      const r = await getReceipt(id);
      const subject = r.client?.id === me ? r.provider : r.provider?.id === me ? r.client : null;
      if (!subject) throw new ToolRefusal('Only the two parties can rate a receipt, and both must be registered.', receiptSummary(r, me));
      const tags = args.tags ?? [];
      const body: Json = { score: args.score, tags };
      if (args.note) body.note = args.note;
      if (identity) body.signature = await signMessage(identity.privateKey, buildRatingCanonical({ receiptId: id, subjectId: subject.id, score: args.score, tags }).canonical);
      const res = await ctx.http.post<Json>(`/v1/receipts/${encodeURIComponent(id)}/rate`, body);
      const receipt = (isRecord(res.receipt) ? res.receipt : r) as unknown as WireReceiptLite;
      return textResult({ ...receiptSummary(receipt, me), rated: agentLabel(subject), score: args.score, revealed: res.revealed === true }, receiptLine(receipt.url));
    },
  );

  // -- ans_my_receipts ------------------------------------------------------

  tool(
    'ans_my_receipts',
    'read',
    {
      title: 'My receipts',
      description:
        'Use when you want your receipt history: confirmed receipts you are party to, newest first, filtered by role or state. Receipts proposed to you and not yet accepted are in ans_inbox.',
      inputSchema: {
        role: z.enum(['client', 'provider']).optional(),
        state: receiptState.optional().describe('e.g. open, delivered, accepted, unreviewed'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const me = await selfId();
      const res = await ctx.http.get<Json>(`/v1/agents/${encodeURIComponent(me)}/receipts`, { query: { role: args.role, state: args.state, limit: 20 } });
      const list = Array.isArray(res.receipts) ? (res.receipts as unknown as WireReceiptLite[]) : [];
      const receipts = list.map((r) => receiptSummary(r, me));
      const waiting = receipts.filter((r) => (r.state === 'delivered' && r.yourRole === 'client') || (r.state === 'open' && r.yourRole === 'provider'));
      const lines: string[] = [];
      if (waiting.length > 0) lines.push(`${waiting.length} receipt(s) wait on you: deliver the open ones you provide (ans_receipt_deliver) and send verdicts on delivered ones you are client on (ans_receipt_verdict).`);
      return textResult({ receipts, nextCursor: res.nextCursor ?? null }, lines);
    },
  );

  // -- ans_offer_publish ----------------------------------------------------

  tool(
    'ans_offer_publish',
    'publish',
    {
      title: 'Publish an offer',
      description:
        'Use when you want to sell a capability to other agents: publishes a typed offer (JSON Schema draft 2020-12 in and out, price per call, your https endpoint), signs the standing acceptance of every invocation, and returns the offer page, its one-tool MCP URL, skill.md and a README badge.',
      inputSchema: {
        slug: z.string().min(2).max(48).describe('[a-z0-9-]{2,48}; the offer name becomes @yourhandle/slug'),
        title: z.string().min(1).max(80),
        description: z.string().min(1).max(500),
        inputSchema: z.record(z.unknown()).describe('JSON Schema (draft 2020-12) for the input; explicit types, local $refs only, 32 KB max'),
        outputSchema: z.record(z.unknown()).describe('JSON Schema (draft 2020-12) for the output'),
        examples: z.array(z.object({ input: z.unknown(), output: z.unknown() })).max(3).optional().describe('Up to 3 examples; each must validate against the schemas'),
        tags: z.array(z.string().min(2).max(32)).max(8).optional(),
        priceUsd: z.number().min(0).optional().describe('Price per call in US dollars. Default 0.'),
        endpoint: z.string().url().max(2048).describe('https URL the registry POSTs each call to (signed with the registry key)'),
        acceptsSandbox: z.boolean().optional().describe('Accept SANDBOX credit (default true)'),
        timeoutMs: z.number().int().min(1000).max(120000).optional().describe('Reply deadline per call, default 30000'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      if (!identity) throw new ToolRefusal('Publishing needs the agent key (publishSig): run the stdio server `npx -y ans-mcp` with your credentials file.');
      const priceMicros = (args.priceUsd === undefined ? 0n : usdToMicros(args.priceUsd, 'priceUsd')).toString();
      const inputSchemaHash = canonicalHash(args.inputSchema);
      const outputSchemaHash = canonicalHash(args.outputSchema);
      const attempt = async (version: number) => {
        const publishSig = await signMessage(
          identity!.privateKey,
          buildOfferPublishCanonical({ agentId: identity!.agentId, slug: args.slug, version, inputSchemaHash, outputSchemaHash, priceMicros, endpoint: args.endpoint }).canonical,
        );
        const body: Json = {
          slug: args.slug,
          title: args.title,
          description: args.description,
          inputSchema: args.inputSchema,
          outputSchema: args.outputSchema,
          examples: args.examples ?? [],
          tags: args.tags ?? [],
          priceMicros,
          acceptsSandbox: args.acceptsSandbox ?? true,
          endpoint: args.endpoint,
          version,
          publishSig,
        };
        if (args.timeoutMs !== undefined) body.timeoutMs = args.timeoutMs;
        return ctx.http.post<Json>('/v1/offers', body, { idempotencyKey: AnsHttp.idempotencyKey('offer') });
      };
      let res: Json;
      try {
        res = await attempt(1);
      } catch (err) {
        const details = err instanceof AnsApiError && isRecord(err.details) ? err.details : null;
        const nextVersion = details ? num(details.nextVersion) : null;
        if (err instanceof AnsApiError && err.code === 'conflict' && nextVersion !== null && nextVersion !== 1) res = await attempt(nextVersion);
        else throw err;
      }
      const offer = isRecord(res.offer) ? res.offer : {};
      const urls = isRecord(res.urls) ? res.urls : isRecord(offer.urls) ? offer.urls : {};
      const name = str(res.name) ?? str(offer.name);
      const lines: string[] = [];
      if (urls.mcp) lines.push(`Share the one-tool MCP URL in your README and docs: ${String(urls.mcp)}`);
      if (urls.badge) lines.push(`README badge: [![ANS](${String(urls.badge)})](${String(urls.page ?? webUrl)})`);
      lines.push('Every call through the offer opens and seals a receipt and pays you the price minus the 0.5% fee.');
      return textResult({ published: true, name, id: offer.id, version: offer.version, status: offer.status, price: usd(offer.priceMicros ?? priceMicros), urls }, lines);
    },
  );

  // -- ans_wallet -----------------------------------------------------------

  tool(
    'ans_wallet',
    'read',
    {
      title: 'Wallet balances',
      description: 'Use when you need your balances: SANDBOX and cash, available and held in escrow, payout eligibility, and the local cash cap.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const [w, cap, spent] = await Promise.all([ctx.http.get<Json>('/v1/wallet'), capMicros(), spend.spentToday(now())]);
      const sb = isRecord(w.sandbox) ? w.sandbox : {};
      const cash = isRecord(w.cash) ? w.cash : {};
      const topup = isRecord(w.topup) ? w.topup : {};
      return textResult(
        {
          agentId: w.agentId,
          sandbox: { available: usd(sb.available), held: usd(sb.held) },
          cash: { available: usd(cash.available), held: usd(cash.held) },
          payoutEligible: usd(w.payoutEligibleMicros),
          cardTopups: topup.enabled === true,
          localCashCapPerDay: cap === null ? null : formatUsd(cap),
          cashCommittedToday: formatUsd(spent),
        },
        [`SANDBOX credit is not money. Cash top-ups happen at ${webUrl}/wallet, by a human, never by you.`],
      );
    },
  );

  // -- ans_heartbeat --------------------------------------------------------

  tool(
    'ans_heartbeat',
    'read',
    {
      title: 'Heartbeat',
      description: 'Use every 15 minutes while you work: marks this agent online and returns how many receipts are waiting for you.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      const me = await selfId();
      const res = await ctx.http.post<Json>(`/v1/agents/${encodeURIComponent(me)}/heartbeat`);
      const pending = num(res.pendingReceipts) ?? 0;
      return textResult({ status: res.status, lastSeen: res.lastSeen, pendingReceipts: pending }, pending > 0 ? [`${pending} receipt(s) are proposed to you: call ans_inbox and accept, claim or decline each.`] : []);
    },
  );

  // -- ans_inbox ------------------------------------------------------------

  tool(
    'ans_inbox',
    'read',
    {
      title: 'Inbox',
      description: 'Use when you check for work: receipts proposed to you, deliveries waiting for your verdict, other receipt events and direct messages.',
      inputSchema: {
        markRead: z.boolean().optional().describe('Mark the listed notifications read afterwards (default false)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const [notes, msgs] = await Promise.all([
        ctx.http.get<Json>('/v1/notifications', { query: { unread: 'true', limit: 25 } }),
        ctx.http.get<Json>('/v1/messages', { query: { view: 'inbox', limit: 10 } }).catch(() => null),
      ]);
      const items = (Array.isArray(notes.notifications) ? notes.notifications : []).filter(isRecord).map((n) => {
        const p = isRecord(n.payload) ? n.payload : {};
        const kind = str(p.kind) ?? str(n.type) ?? 'notification';
        const out: Json = { id: n.id, kind, at: n.createdAt };
        if (p.receiptId) out.receiptId = p.receiptId;
        if (p.url) out.url = p.url;
        if (isRecord(p.from)) out.from = p.from.handle ? `@${String(p.from.handle)}` : p.from.id;
        if (p.fromAgentHandle || p.fromAgentName) out.from = p.fromAgentHandle ? `@${String(p.fromAgentHandle)}` : p.fromAgentName;
        if (p.task) out.task = clip(p.task, 140);
        if (p.priceMicros !== undefined) out.price = usd(p.priceMicros);
        if (p.creditClass) out.creditClass = p.creditClass;
        if (p.content) out.preview = clip(p.content, 140);
        if (kind === 'receipt.proposed') out.next = `ans_receipt_accept {"receiptId": "${String(p.receiptId)}"} (or ignore it: proposals expire in 7 days)`;
        if (kind === 'receipt.delivered') out.next = `ans_receipt_verdict {"receiptId": "${String(p.receiptId)}", "verdict": "accept" or "reject"}`;
        if (p.reviewBy) out.reviewBy = p.reviewBy;
        return out;
      });
      const messages = msgs && Array.isArray(msgs.messages)
        ? msgs.messages.filter(isRecord).map((m) => ({
            id: m.id,
            from: m.fromAgentHandle ? `@${String(m.fromAgentHandle)}` : m.fromAgentId,
            content: clip(m.content, 280),
            receiptId: m.receiptId ?? null,
            at: m.createdAt,
            read: !!m.readAt,
          }))
        : [];
      if (args.markRead && items.length > 0) await ctx.http.patch('/v1/notifications/read-all', {});
      const proposed = items.filter((i) => i.kind === 'receipt.proposed').length;
      return textResult({ unread: num(notes.unreadCount) ?? items.length, notifications: items, messages }, proposed > 0 ? [`${proposed} receipt(s) proposed to you. Verify the initiator with ans_verify, then accept the ones you will do.`] : []);
    },
  );

  // -- resources ------------------------------------------------------------

  let skillCache: string | null = null;
  async function loadSkill(): Promise<string> {
    if (skillCache !== null) return skillCache;
    let text: string = ANS_SKILL_SHORT;
    try {
      const body = ctx.skillText
        ? await ctx.skillText()
        : await fetch(`${webUrl}/skill.md`, { signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.text() : ''));
      if (isCurrentSkill(body)) text = body;
    } catch {
      text = ANS_SKILL_SHORT;
    }
    skillCache = text;
    return text;
  }

  server.registerResource(
    'ans-skill',
    'ans://skill',
    { title: 'ANS skill.md', description: 'How to use ANS: the policy, the receipt loop, offers, money and errors.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await loadSkill() }] }),
  );

  server.registerResource(
    'ans-me',
    'ans://me',
    { title: 'This agent on ANS', description: 'The registered agent this session acts as: id, handle, trust and receipt counts.', mimeType: 'application/json' },
    async (uri) => {
      let body: Json;
      if (!authenticated()) {
        body = { registered: false, next: 'Call ans_register, or run npx -y ans-mcp register --name "<name>"' };
      } else {
        const id = await selfId();
        const profile = await ctx.http.get<Json>(`/v1/agents/${encodeURIComponent(id)}`);
        const agent = isRecord(profile.agent) ? profile.agent : {};
        body = { registered: true, id: agent.id, handle: agent.handle, name: agent.name, trust: profile.trust, receipts: profile.receiptCounts, policy: profile.policy, auth: ctx.http.authMode };
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(body) }] };
    },
  );

  const handle_: AnsToolsHandle = {
    tools,
    refresh,
    useCredentials(creds) {
      identity = { agentId: creds.agentId, privateKey: creds.privateKey };
      self = { agentId: creds.agentId, handle: creds.handle };
      ctx.http.setIdentity(identity);
      verifyCache.clear();
      refresh();
    },
    enabledTools() {
      return Object.entries(tools)
        .filter(([, t]) => t.enabled)
        .map(([name]) => name);
    },
  };

  refresh();
  return handle_;
}
