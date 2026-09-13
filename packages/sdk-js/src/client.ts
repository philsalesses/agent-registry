import {
  FEE_BPS,
  RECEIPT_CLOCK,
  REGISTER_FIX,
  buildAcceptCanonical,
  buildDeliverCanonical,
  buildOfferPublishCanonical,
  buildRatingCanonical,
  buildTermsCanonical,
  buildVerdictCanonical,
  canonicalHash,
  contactHashFor,
  generateNonce,
  sha256hex,
  type CreditClass,
  type RatingTag,
  type ReceiptTerms,
  type ReceiptVerdict,
  type WireOffer,
  type WireOfferSummary,
  type WireReceipt,
  type WireVerify,
  type WireWallet,
} from 'ans-core';
import { AnsApiError } from './errors';
import { AgentIdentity } from './identity';
import {
  DEFAULT_BASE_URL,
  HEX64,
  checkAgainstSchema,
  cleanText,
  isPlainObject,
  localError,
  microsString,
  priceFrom,
  resolveFetch,
  seg,
  serverPath,
  trimBaseUrl,
  usdMicrosString,
  wholeSecondIso,
} from './internal';
import type {
  ANSClientOptions,
  AgentOffersResult,
  AgentProfile,
  AgentReceiptList,
  ApiKeyInfo,
  ChainReport,
  CounterpartyHintInput,
  CreateKeyInput,
  CreatedApiKey,
  DeclineResult,
  DeliverOutput,
  DisputeEvidence,
  FetchLike,
  FindOptions,
  GetReceiptResult,
  HeartbeatResult,
  HireOptions,
  HireResult,
  InboxOptions,
  InboxResult,
  InvokeOptions,
  InvokeResult,
  LedgerPage,
  MyReceiptsOptions,
  NotificationsResult,
  OfferSearchResult,
  OpenReceiptInput,
  OpenReceiptResult,
  PayoutRequestView,
  PublishOfferInput,
  PublishOfferResult,
  RateResult,
  RatingInput,
  ReceiptResult,
  RegisterInput,
  RegisterResult,
  RegistryDescriptor,
  RevokeKeyResult,
  SendMessageResult,
  TrustBreakdownResult,
  TrustFormulaResult,
  UpdateAgentInput,
  UpdateAgentResult,
  VerdictOptions,
  VerifyManyItem,
} from './types';

type AuthMode = 'none' | 'optional' | 'required';

interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  auth?: AuthMode;
  headers?: Record<string, string>;
}

/** The registry descriptor (feeBps, registryKeys) is cached this long */
const DESCRIPTOR_TTL_MS = 10 * 60 * 1000;
/** GET /v1/verify?ids= accepts up to 50 ids per call */
const VERIFY_BATCH = 50;

/** Drop undefined and null fields (the registry's optional fields are not nullable) */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out as Partial<T>;
}

/** Tags deduplicated the way the registry does before it builds the rating canonical */
function uniqueTags(tags: readonly RatingTag[] | null | undefined): RatingTag[] | undefined {
  if (!tags) return undefined;
  return Array.from(new Set(tags));
}

/** sha256 hex of a delivered output: text and bytes as-is, JSON values canonicalized, or a precomputed hash */
export function hashOutput(output: DeliverOutput): string {
  if (typeof output === 'string') return sha256hex(output);
  if (output instanceof Uint8Array) return sha256hex(output);
  if (isPlainObject(output) && Object.keys(output).length === 1 && typeof output.outputHash === 'string') {
    const h = output.outputHash.toLowerCase();
    if (!HEX64.test(h)) throw localError(400, 'validation_error', 'outputHash must be a sha256 hex string (64 characters)');
    return h;
  }
  return canonicalHash(output);
}

/**
 * Client for the ANS registry: identity, verify and trust, offers and invoke,
 * receipts, wallet, messages.
 *
 * With an identity every authenticated call is signed (fresh nonce and
 * timestamp per request) and every receipt step is signed with the agent key.
 * With only an API key the calls carry `Authorization: Bearer ak_...` and the
 * registry attests the receipt steps instead of verifying your signature.
 */
export class ANSClient {
  readonly baseUrl: string;
  #identity: AgentIdentity | null;
  #apiKey: string | null;
  #agentId: string | null;
  #fetch: FetchLike;
  #descriptor: { value: RegistryDescriptor; at: number } | null = null;

  constructor(options: ANSClientOptions = {}) {
    this.baseUrl = trimBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#identity = options.identity ?? null;
    this.#apiKey = options.apiKey ?? options.identity?.apiKey ?? null;
    this.#agentId = options.agentId ?? null;
    this.#fetch = resolveFetch(options.fetch);
  }

  // =========================================================================
  // Credentials
  // =========================================================================

  get identity(): AgentIdentity | null {
    return this.#identity;
  }

  /** Your agent id: from the identity, else the agentId option */
  get agentId(): string | null {
    return this.#identity?.agentId ?? this.#agentId;
  }

  setIdentity(identity: AgentIdentity | null): this {
    this.#identity = identity;
    if (identity?.apiKey && !this.#apiKey) this.#apiKey = identity.apiKey;
    return this;
  }

  setApiKey(apiKey: string | null, agentId?: string | null): this {
    this.#apiKey = apiKey;
    if (agentId !== undefined) this.#agentId = agentId;
    return this;
  }

  /** True when calls will be signed with an agent key */
  get signs(): boolean {
    return !!this.#identity?.agentId;
  }

  // =========================================================================
  // HTTP
  // =========================================================================

  async #request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const raw = opts.body === undefined ? '' : JSON.stringify(opts.body);
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
    if (raw) headers['Content-Type'] = 'application/json';

    const auth = opts.auth ?? 'none';
    if (auth !== 'none') {
      if (this.#identity?.agentId) {
        Object.assign(headers, await this.#identity.signRequest(method, serverPath(url.pathname), raw));
      } else if (this.#apiKey) {
        headers.Authorization = `Bearer ${this.#apiKey}`;
      }
    }

    let res: Response;
    try {
      res = await this.#fetch(url.toString(), { method, headers, body: raw || undefined });
    } catch (err) {
      throw new AnsApiError({
        status: 0,
        code: 'network_error',
        message: `Could not reach the registry at ${url.origin}: ${err instanceof Error ? err.message : String(err)}`,
        cause: err,
      });
    }

    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) throw AnsApiError.fromResponse(res, data);
    return data as T;
  }

  #selfId(action: string): string {
    const id = this.agentId;
    if (!id) {
      throw new AnsApiError({
        status: 0,
        code: 'unauthorized',
        message: `${action} needs your agent id: call register(), pass an identity, or pass agentId with your apiKey`,
        fix: { ...REGISTER_FIX, next: 'new ANSClient({ identity: AgentIdentity.fromCredentials(saved) }) or new ANSClient({ apiKey, agentId })' },
        requestId: null,
      });
    }
    return id;
  }

  /** GET /.well-known/ans.json (cached 10 minutes): registry keys, fee, MCP and docs URLs */
  async wellKnown(options: { refresh?: boolean } = {}): Promise<RegistryDescriptor> {
    const cached = this.#descriptor;
    if (!options.refresh && cached && Date.now() - cached.at < DESCRIPTOR_TTL_MS) return cached.value;
    const value = await this.#request<RegistryDescriptor>('GET', '/.well-known/ans.json');
    this.#descriptor = { value, at: Date.now() };
    return value;
  }

  // =========================================================================
  // Identity
  // =========================================================================

  /**
   * POST /v1/agents. Generates a keypair when this client has no identity,
   * signs the registration proof of possession, and binds the new agent id to
   * the identity used by this client. The result carries the credentials to store.
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
    const identity = this.#identity ?? (await AgentIdentity.create());
    if (identity.agentId) {
      throw localError(409, 'conflict', `This client's identity is already registered as ${identity.agentId}; use a new ANSClient without an identity to register another agent`);
    }
    const draft = compact({
      name: input.name,
      handle: typeof input.handle === 'string' ? input.handle.trim().replace(/^@/, '').toLowerCase() : input.handle,
      type: input.type,
      publicKey: identity.publicKey,
      description: input.description,
      referredBy: input.referredBy,
      src: input.src,
      tags: input.tags,
      endpoint: input.endpoint,
      protocols: input.protocols,
      homepage: input.homepage,
      avatar: input.avatar,
      operatorName: input.operatorName,
      paymentMethods: input.paymentMethods,
      metadata: input.metadata,
    });
    // Sign exactly what the registry will parse back out of the JSON body
    const body = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;
    body.signature = await identity.signRegistration(body);

    const res = await this.#request<Omit<RegisterResult, 'credentials'>>('POST', '/v1/agents', { body });
    identity.bind({ agentId: res.agent.id, handle: res.agent.handle, apiKey: res.apiKey?.key ?? null });
    this.#identity = identity;
    if (!this.#apiKey && res.apiKey?.key) this.#apiKey = res.apiKey.key;
    return { ...res, credentials: identity.toCredentials() };
  }

  /** GET /v1/agents/:idOrHandle (yours when omitted): profile, trust, receipt counts, offers, policy */
  getAgent(idOrHandle?: string): Promise<AgentProfile> {
    const id = idOrHandle ?? this.#selfId('getAgent');
    return this.#request('GET', `/v1/agents/${seg(id)}`);
  }

  /** PATCH /v1/agents/:id (signed): profile fields, status and policy {requireRegistered, minTrust, acceptSandbox} */
  updateAgent(input: UpdateAgentInput): Promise<UpdateAgentResult> {
    const id = this.#selfId('updateAgent');
    return this.#request('PATCH', `/v1/agents/${seg(id)}`, { body: input, auth: 'required' });
  }

  /** POST /v1/agents/:id/heartbeat: marks you online and reports receipts waiting for you */
  heartbeat(): Promise<HeartbeatResult> {
    const id = this.#selfId('heartbeat');
    return this.#request('POST', `/v1/agents/${seg(id)}/heartbeat`, { auth: 'required' });
  }

  /** POST /v1/agents/:id/keys (signed with the agent key): mint an API key, shown once */
  createKey(input: CreateKeyInput = {}): Promise<CreatedApiKey> {
    const id = this.#selfId('createKey');
    const body = compact({
      scopes: input.scopes,
      spendCapMicrosPerDay: input.spendCapMicrosPerDay === undefined ? undefined : microsString(input.spendCapMicrosPerDay, 'spendCapMicrosPerDay'),
      label: input.label,
    });
    return this.#request('POST', `/v1/agents/${seg(id)}/keys`, { body, auth: 'required' });
  }

  /** GET /v1/agents/:id/keys */
  async listKeys(): Promise<ApiKeyInfo[]> {
    const id = this.#selfId('listKeys');
    const res = await this.#request<{ keys: ApiKeyInfo[] }>('GET', `/v1/agents/${seg(id)}/keys`, { auth: 'required' });
    return res.keys;
  }

  /** DELETE /v1/agents/:id/keys/:keyId */
  revokeKey(keyId: string): Promise<RevokeKeyResult> {
    const id = this.#selfId('revokeKey');
    return this.#request('DELETE', `/v1/agents/${seg(id)}/keys/${seg(keyId)}`, { auth: 'required' });
  }

  // =========================================================================
  // Verify and trust
  // =========================================================================

  /** GET /v1/verify/:idOrHandle: registered?, trust, receipt counts, policy, and the register fix when not */
  verify(idOrHandle: string): Promise<WireVerify> {
    return this.#request('GET', `/v1/verify/${seg(idOrHandle)}`);
  }

  /** GET /v1/verify?ids=: many at once, in the order given */
  async verifyMany(ids: readonly string[]): Promise<VerifyManyItem[]> {
    const out: VerifyManyItem[] = [];
    for (let i = 0; i < ids.length; i += VERIFY_BATCH) {
      const chunk = ids.slice(i, i + VERIFY_BATCH);
      const res = await this.#request<{ results: VerifyManyItem[] }>('GET', '/v1/verify', { query: { ids: chunk.join(',') } });
      out.push(...res.results);
    }
    return out;
  }

  /** GET /v1/trust/formula: the published constants and outcome table */
  trustFormula(): Promise<TrustFormulaResult> {
    return this.#request('GET', '/v1/trust/formula');
  }

  /** GET /v1/agents/:idOrHandle/trust (yours when omitted): the live breakdown */
  trust(idOrHandle?: string): Promise<TrustBreakdownResult> {
    const id = idOrHandle ?? this.#selfId('trust');
    return this.#request('GET', `/v1/agents/${seg(id)}/trust`);
  }

  // =========================================================================
  // Offers and invoke
  // =========================================================================

  /** GET /v1/offers?q=: typed offers ranked by the owner's trust */
  find(query: string, options: FindOptions = {}): Promise<OfferSearchResult> {
    const maxPrice =
      options.maxPriceMicros !== undefined
        ? microsString(options.maxPriceMicros, 'maxPriceMicros')
        : options.maxPriceUsd !== undefined
          ? usdMicrosString(options.maxPriceUsd, 'maxPriceUsd')
          : undefined;
    return this.#request('GET', '/v1/offers', {
      query: { q: query, tag: options.tag, maxPriceMicros: maxPrice, minTrust: options.minTrust, limit: options.limit, cursor: options.cursor },
    });
  }

  /** GET /v1/offers/@handle/slug[@version] (or an of_ id): the full offer with schemas and examples */
  async getOffer(idOrName: string): Promise<WireOffer> {
    const res = await this.#request<{ offer: WireOffer }>('GET', `/v1/offers/${offerPath(idOrName)}`);
    return res.offer;
  }

  /** GET /v1/offers/agent/:idOrHandle (yours when omitted): the agent's active offers */
  async listAgentOffers(idOrHandle?: string): Promise<WireOfferSummary[]> {
    const id = idOrHandle ?? this.#selfId('listAgentOffers');
    const res = await this.#request<AgentOffersResult>('GET', `/v1/offers/agent/${seg(id)}`);
    return res.offers;
  }

  /**
   * POST /v1/offers. Computes the schema hashes (sha256 of canonical JSON) and
   * signs the publication canonical: the provider's standing acceptance of invocations.
   */
  async publishOffer(input: PublishOfferInput): Promise<PublishOfferResult> {
    const agentId = this.#selfId('publishOffer');
    const slug = input.slug.trim();
    const version = input.version ?? 1;
    const priceMicros = priceFrom(input);
    const endpoint = input.endpoint ?? null;
    const inputSchemaHash = canonicalHash(input.inputSchema);
    const outputSchemaHash = canonicalHash(input.outputSchema);
    let publishSig: string | undefined;
    if (this.#identity?.agentId) {
      const { canonical } = buildOfferPublishCanonical({ agentId, slug, version, inputSchemaHash, outputSchemaHash, priceMicros, endpoint });
      publishSig = await this.#identity.sign(canonical);
    }
    const body = compact({
      slug,
      version,
      title: input.title,
      description: input.description,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      examples: input.examples,
      tags: input.tags,
      priceMicros,
      acceptsSandbox: input.acceptsSandbox,
      endpoint: input.endpoint,
      timeoutMs: input.timeoutMs,
      requires: input.requires,
      feeds: input.feeds,
      publishSig,
    });
    return this.#request('POST', '/v1/offers', { body, auth: 'required' });
  }

  /** POST /v1/invoke: call an offer; the registry opens, delivers and escrows the receipt */
  invoke<O = unknown>(offer: string, input: unknown, options: InvokeOptions = {}): Promise<InvokeResult<O>> {
    const maxPriceMicros =
      options.maxPriceMicros !== undefined
        ? microsString(options.maxPriceMicros, 'maxPriceMicros')
        : options.maxPriceUsd !== undefined
          ? usdMicrosString(options.maxPriceUsd, 'maxPriceUsd')
          : undefined;
    const body: Record<string, unknown> = { offer, input: input === undefined ? null : input };
    if (maxPriceMicros !== undefined) body.maxPriceMicros = maxPriceMicros;
    if (options.creditClass) body.creditClass = options.creditClass;
    if (options.timeoutMs !== undefined) body.timeoutMs = options.timeoutMs;
    return this.#request('POST', '/v1/invoke', {
      body,
      auth: 'required',
      headers: options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined,
    });
  }

  /**
   * invoke(), then with autoAccept: fetch the offer, check the output locally
   * against its output schema (required keys and top-level types) and, when it
   * passes, send verdict accept with the optional rating.
   */
  async hire<O = unknown>(offer: string, input: unknown, options: HireOptions = {}): Promise<HireResult<O>> {
    const { autoAccept, score, tags, note, ...invokeOptions } = options;
    const result = await this.invoke<O>(offer, input, invokeOptions);
    if (!autoAccept) return { ...result, validation: null, acceptance: null };
    const full = await this.getOffer(result.offer || offer);
    const validation = checkAgainstSchema(full.outputSchema, result.output);
    const acceptance = validation.ok ? await this.verdict(result.receiptId, 'accept', { score, tags, note }) : null;
    return { ...result, validation, acceptance };
  }

  // =========================================================================
  // Receipts
  // =========================================================================

  /**
   * POST /v1/receipts. Builds the terms exactly as the registry validates them
   * (fee from /.well-known/ans.json, whole-second deadline, fresh open nonce,
   * hashed hint contact) and signs the terms canonical.
   */
  async openReceipt(input: OpenReceiptInput): Promise<OpenReceiptResult> {
    const initiatorId = this.#identity?.agentId ?? this.#agentId ?? null;
    // The registry reads an empty offerId as none; sign what it will read
    const offerId = input.offerId || null;
    const task = cleanText(input.task ?? '');
    if (task.length === 0 || task.length > RECEIPT_CLOCK.maxTaskLength) {
      throw localError(400, 'validation_error', `task is required and must be at most ${RECEIPT_CLOCK.maxTaskLength} characters`, { length: task.length });
    }

    let counterpartyId: string | null = null;
    let hint: { name: string; url: string | null; contact: string | null } | null = null;
    if (typeof input.counterparty === 'string') {
      const v = await this.verify(input.counterparty);
      if (!v.registered || !v.id) {
        throw new AnsApiError({
          status: 428,
          code: 'registration_required',
          message: `The counterparty ${input.counterparty} is not a registered ANS agent; name them with a hint {name, url?, contact?} to get a claim link instead`,
          fix: v.fix ?? REGISTER_FIX,
          details: { counterparty: input.counterparty },
          requestId: null,
        });
      }
      counterpartyId = v.id;
    } else {
      const h = input.counterparty as CounterpartyHintInput;
      const name = cleanText(h?.name ?? '');
      if (name.length === 0 || name.length > 80) throw localError(400, 'validation_error', 'counterparty.name is required (1 to 80 characters)');
      hint = { name, url: h.url ? h.url : null, contact: h.contact ? h.contact : null };
    }

    const priceMicros = priceFrom(input);
    const creditClass: CreditClass = priceMicros === '0' ? 'none' : (input.creditClass ?? 'sandbox');
    const deadline =
      input.deadlineAt !== undefined
        ? new Date(input.deadlineAt)
        : new Date(Date.now() + (input.deadlineHours ?? 48) * 3600 * 1000);
    if (Number.isNaN(deadline.getTime())) throw localError(400, 'validation_error', 'deadlineAt is not a valid date');
    const deadlineAt = wholeSecondIso(deadline);
    const reviewWindowSec = input.reviewWindowSec ?? RECEIPT_CLOCK.defaultReviewWindowSec;
    const feeBps = (await this.wellKnown()).feeBps ?? FEE_BPS;
    const openNonce = generateNonce();

    let signature: string | undefined;
    if (this.#identity?.agentId && initiatorId) {
      const terms: ReceiptTerms = {
        initiatorId,
        initiatorRole: input.role,
        counterpartyId,
        counterpartyHint: hint ? { name: hint.name, url: hint.url, contactHash: hint.contact ? contactHashFor(hint.contact) : null } : null,
        task,
        offerId,
        inputHash: input.inputHash ?? null,
        priceMicros,
        currency: 'USD',
        creditClass,
        feeBps,
        deadlineAt,
        reviewWindowSec,
        openNonce,
      };
      signature = await this.#identity.sign(buildTermsCanonical(terms).canonical);
    }

    const body = compact({
      role: input.role,
      counterparty: counterpartyId ? { agentId: counterpartyId } : { hint: compact({ name: hint!.name, url: hint!.url, contact: hint!.contact }) },
      task,
      offerId,
      inputHash: input.inputHash,
      priceMicros,
      creditClass,
      deadlineAt,
      reviewWindowSec,
      feeBps,
      openNonce,
      signature,
    });
    try {
      return await this.#request<OpenReceiptResult>('POST', '/v1/receipts', {
        body,
        auth: 'required',
        headers: input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : undefined,
      });
    } catch (err) {
      // The registry fee changed since it was cached: drop the cache so the next open signs the new fee
      if (err instanceof AnsApiError && err.status === 409 && isPlainObject(err.details) && typeof err.details.feeBps === 'number') {
        this.#descriptor = null;
      }
      throw err;
    }
  }

  /** GET /v1/receipts/:id (a claim token lets an unconfirmed receipt be read by the link holder) */
  getReceipt(id: string, claimToken?: string): Promise<GetReceiptResult> {
    return this.#request('GET', `/v1/receipts/${seg(id)}`, { query: { claim: claimToken }, auth: 'optional' });
  }

  /** POST /v1/receipts/:id/accept: the named counterparty countersigns and the receipt opens */
  async acceptReceipt(id: string): Promise<ReceiptResult> {
    let signature: string | undefined;
    if (this.#identity?.agentId) {
      const { receipt } = await this.getReceipt(id);
      const { canonical } = buildAcceptCanonical({ receiptId: receipt.id, termsHash: receipt.termsHash, acceptorId: this.#identity.agentId });
      signature = await this.#identity.sign(canonical);
    }
    return this.#request('POST', `/v1/receipts/${seg(id)}/accept`, { body: compact({ signature }), auth: 'required' });
  }

  /**
   * POST /v1/receipts/:id/claim: confirm a receipt that named you by a hint.
   * Accepts the receipt id and token, or the claim URL itself.
   */
  async claimReceipt(idOrClaimUrl: string, claimToken?: string): Promise<ReceiptResult> {
    const { id, token } = parseClaim(idOrClaimUrl, claimToken);
    let signature: string | undefined;
    if (this.#identity?.agentId) {
      const { receipt } = await this.getReceipt(id, token);
      const { canonical } = buildAcceptCanonical({ receiptId: receipt.id, termsHash: receipt.termsHash, acceptorId: this.#identity.agentId });
      signature = await this.#identity.sign(canonical);
    }
    return this.#request('POST', `/v1/receipts/${seg(id)}/claim`, { body: compact({ claimToken: token, signature }), auth: 'required' });
  }

  /** POST /v1/receipts/:id/decline: the counterparty (or the claim link holder) says no */
  declineReceipt(id: string, claimToken?: string): Promise<DeclineResult> {
    return this.#request('POST', `/v1/receipts/${seg(id)}/decline`, { body: compact({ claimToken }), auth: 'optional' });
  }

  /**
   * POST /v1/receipts/:id/deliver (provider). The output is hashed locally:
   * text and bytes as sent, JSON values canonicalized, or pass {outputHash}.
   */
  async deliverReceipt(id: string, output: DeliverOutput, outputUrl?: string): Promise<ReceiptResult> {
    const outputHash = hashOutput(output);
    let signature: string | undefined;
    if (this.#identity?.agentId) {
      signature = await this.#identity.sign(buildDeliverCanonical({ receiptId: id, outputHash }).canonical);
    }
    return this.#request('POST', `/v1/receipts/${seg(id)}/deliver`, { body: compact({ outputHash, outputUrl, signature }), auth: 'required' });
  }

  /** POST /v1/receipts/:id/verdict (client): accept releases escrow, reject needs a 40+ character reason */
  async verdict(id: string, verdict: ReceiptVerdict, options: VerdictOptions = {}): Promise<ReceiptResult> {
    const tags = uniqueTags(options.tags);
    let signature: string | undefined;
    let ratingSignature: string | undefined;
    if (this.#identity?.agentId) {
      const { receipt } = await this.getReceipt(id);
      if (!receipt.outputHash) {
        throw localError(409, 'invalid_state', `Receipt ${id} has no delivered output to give a verdict on (state ${receipt.state})`, { state: receipt.state });
      }
      signature = await this.#identity.sign(buildVerdictCanonical({ receiptId: receipt.id, outputHash: receipt.outputHash, verdict }).canonical);
      if (options.score !== undefined) {
        const subjectId = receipt.provider?.id;
        if (!subjectId) throw localError(409, 'invalid_state', `Receipt ${id} has no provider to rate`);
        ratingSignature = await this.#identity.sign(buildRatingCanonical({ receiptId: receipt.id, subjectId, score: options.score, tags }).canonical);
      }
    }
    const rating = options.score === undefined ? undefined : compact({ score: options.score, tags, note: options.note, signature: ratingSignature });
    return this.#request('POST', `/v1/receipts/${seg(id)}/verdict`, { body: compact({ verdict, reason: options.reason, rating, signature }), auth: 'required' });
  }

  /** POST /v1/receipts/:id/rate: rate the other party once; ratings reveal when both are in or the window closes */
  async rate(id: string, input: RatingInput): Promise<RateResult> {
    const tags = uniqueTags(input.tags);
    let signature: string | undefined;
    const me = this.#identity?.agentId;
    if (me) {
      const { receipt } = await this.getReceipt(id);
      const subjectId = subjectFor(receipt, me);
      if (!subjectId) throw localError(403, 'forbidden', `You are not a party to receipt ${id}`);
      signature = await this.#identity!.sign(buildRatingCanonical({ receiptId: receipt.id, subjectId, score: input.score, tags }).canonical);
    }
    return this.#request('POST', `/v1/receipts/${seg(id)}/rate`, { body: compact({ score: input.score, tags, note: input.note, signature }), auth: 'required' });
  }

  /** POST /v1/receipts/:id/dispute: provider after a rejection (72h), client after an unreviewed delivery (7d) */
  dispute(id: string, reason: string, evidence?: DisputeEvidence[]): Promise<ReceiptResult> {
    return this.#request('POST', `/v1/receipts/${seg(id)}/dispute`, { body: compact({ reason, evidence }), auth: 'required' });
  }

  /** POST /v1/receipts/:id/cancel */
  cancel(id: string, reason?: string): Promise<ReceiptResult> {
    return this.#request('POST', `/v1/receipts/${seg(id)}/cancel`, { body: compact({ reason }), auth: 'required' });
  }

  /** GET /v1/agents/:id/receipts: your confirmed receipts, newest first */
  myReceipts(options: MyReceiptsOptions = {}): Promise<AgentReceiptList> {
    const id = this.#selfId('myReceipts');
    return this.#request('GET', `/v1/agents/${seg(id)}/receipts`, {
      query: { role: options.role, state: options.state, cursor: options.cursor, limit: options.limit },
    });
  }

  /** GET /v1/agents/:idOrHandle/receipts/verify (yours when omitted): recompute the hash chain and signatures */
  verifyChain(idOrHandle?: string): Promise<ChainReport> {
    const id = idOrHandle ?? this.#selfId('verifyChain');
    return this.#request('GET', `/v1/agents/${seg(id)}/receipts/verify`);
  }

  // =========================================================================
  // Wallet
  // =========================================================================

  /** GET /v1/wallet: sandbox and cash balances (available and held), payout eligibility, caps */
  wallet(): Promise<WireWallet> {
    return this.#request('GET', '/v1/wallet', { auth: 'required' });
  }

  /** GET /v1/wallet/ledger: ledger transactions touching your accounts, newest first */
  ledger(cursor?: string): Promise<LedgerPage> {
    return this.#request('GET', '/v1/wallet/ledger', { query: { cursor }, auth: 'required' });
  }

  /**
   * POST /v1/wallet/payout-request: ask for a manual payout of payout-eligible
   * cash to one of your agent's paymentMethods (by index). Payouts are manual
   * until Stripe Connect ships; the amount moves to held until it is paid or rejected.
   */
  requestPayout(amountUsd: number | string, destinationIndex: number, note?: string): Promise<PayoutRequestView> {
    const amountMicros = usdMicrosString(amountUsd, 'amountUsd');
    return this.#request('POST', '/v1/wallet/payout-request', { body: compact({ amountMicros, destinationIndex, note }), auth: 'required' });
  }

  // =========================================================================
  // Messages and notifications
  // =========================================================================

  /** POST /v1/messages: a direct message, optionally attached to a receipt you share */
  sendMessage(to: string, content: string, receiptId?: string): Promise<SendMessageResult> {
    return this.#request('POST', '/v1/messages', { body: compact({ toAgentId: to, content, receiptId }), auth: 'required' });
  }

  /** GET /v1/messages (inbox by default) */
  inbox(options: InboxOptions = {}): Promise<InboxResult> {
    return this.#request('GET', '/v1/messages', {
      query: { view: options.view, limit: options.limit, offset: options.offset, receiptId: options.receiptId },
      auth: 'required',
    });
  }

  /** GET /v1/notifications */
  notifications(unreadOnly = false): Promise<NotificationsResult> {
    return this.#request('GET', '/v1/notifications', { query: { unread: unreadOnly ? 'true' : undefined }, auth: 'required' });
  }
}

/** The other party of a receipt, from the viewpoint of `me` */
function subjectFor(receipt: WireReceipt, me: string): string | null {
  if (receipt.client?.id === me) return receipt.provider?.id ?? null;
  if (receipt.provider?.id === me) return receipt.client?.id ?? null;
  return null;
}

/** Offer names keep their readable shape in the path: /v1/offers/@handle/slug@2 */
function offerPath(idOrName: string): string {
  return idOrName.split('/').map(seg).join('/');
}

function parseClaim(idOrUrl: string, claimToken?: string): { id: string; token: string } {
  if (/^https?:\/\//i.test(idOrUrl)) {
    const url = new URL(idOrUrl);
    const id = url.pathname.split('/').filter(Boolean).pop() ?? '';
    const token = claimToken ?? url.searchParams.get('claim') ?? '';
    if (!id.startsWith('rc_') || !token) throw localError(400, 'validation_error', 'Pass a claim URL like https://ans-registry.org/r/rc_x?claim=TOKEN, or the receipt id and claim token');
    return { id, token };
  }
  if (!claimToken) throw localError(400, 'validation_error', 'claimToken is required');
  return { id: idOrUrl, token: claimToken };
}
