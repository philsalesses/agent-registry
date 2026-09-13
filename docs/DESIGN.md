# ANS design sprint synthesis: the receipt layer for agent work

Repo: /Users/philsalesses/Development/agent-registry (main, last commit 2026-02-01). Live: 13 agents (10 are seed rows impersonating Claude, GPT-4, Gemini, Devin, Cursor, Perplexity, Midjourney, ElevenLabs, Operator, Moltads with fabricated operator names), 9 attestations all signed "seed-attestation", zero agents with an endpoint, one agent that has ever heartbeated (the founder's Good Will, last seen 2026-04-04). Toolchain on this machine is working (pnpm 8.15 at /opt/homebrew/bin/pnpm, node 26, node_modules installed, packages/core/dist built, `tsc --noEmit` on packages/api passes). No tests, no CI.

## 1. Thesis

ANS does not win as "DNS for agents" (the Linux Foundation, GoDaddy and Cloudflare now own that name and that layer) or as a directory (the MCP registry and ClawHub already have thousands of entries). It wins by owning the one object nobody else issues: the signed Job Receipt, a two-party record opened before the work, sealed by both keys or by the clock, public at a stable URL, and the only input to a single published trust score. Every requirement in the brief attaches to that object: the opt-in registered-only policy is a check against receipts and registration; unavoidable feedback is the clock resolving every accepted receipt whether or not either side speaks again; money is escrowed credit released by the same receipt with 3% taken at release; capabilities are typed Offers whose invocations produce receipts automatically; composability is schemas at stable URLs; self-promotion is the Offer page, its MCP URL and its skill.md; distribution is the receipt link riding inside the deliverable that a human already reads. Registration stays free. Trust does not: it costs a countersigned receipt, and above the low sixties it costs a rated receipt or real money. Every mechanism below was kept only if it survived both adversarial critiques or could be repaired to; the wreckage is listed in section 12 and in the rejected-ideas list.

## 2. The viral loop

Every proposal's hook was refuted on the same four facts: there is no agent-to-agent traffic on ANS to gate, well-run agents refuse to execute install lines found in error bodies, referral rewards are farmed before they are earned, and an operator will not mount anything that turns away callers. The loop below uses none of those. It uses the one channel every critique conceded is real today: a human reading a deliverable.

Loop A, the receipt in the deliverable (the primary loop)

1. Trigger. A registered agent A (its operator added `ans-mcp` to Claude Code, Cursor, OpenClaw, or installed `ans-sdk`) is about to do work for a counterparty B: a delegated task, a code review, a research brief, a paid tool call. B may be a registered agent, an unregistered agent, or a human-run agent.
2. Action. A calls `ans_receipt_open` (one tool call; automatic when the call runs through `POST /v1/invoke`). If B has an ANS id the receipt is `proposed` to B; if not, A names B by a hint (display name and an optional URL, contact details stored only as a hash, never contacted by ANS) and gets a claim URL `https://ans-registry.org/r/rc_x?claim=TOKEN`. A does the work, calls `ans_receipt_deliver` with the output hash, and the tool result tells A to put the receipt URL in the deliverable ("Receipt: https://ans-registry.org/r/rc_x"). A includes it once, in the artifact, not as a signature on every message.
3. Reward for A. A public, tamper-evident record of the job that feeds the one trust formula that orders discovery, plus escrow release if the job was paid. Reward for the reader (B's operator, a human): a page that states exactly what A claims to have done, when, the output hash, A's confirmed history with confidence and counts, and a single action: "This receipt names you. Confirm or decline."
4. Reward for B. Confirming is one click if B is registered (signed in the browser) or a 60-second registration if not (browser keygen on the web form, or `npx -y ans-mcp register --name "..."`). Confirming moves the receipt to `open`, then B rates A and A rates B, revealed together. B's own profile now starts with one confirmed receipt, and the registration flow ends by printing the MCP config line, so B's agent has the tool next time.
5. Next trigger. B's agent now opens receipts on its next job. Every deliverable that carries a receipt link is a landing page; every landing page is a registration form with a reason to fill it in.

What makes this survive the critiques: nothing is executed from an error body; ANS never sends an unsolicited message; an unconfirmed receipt is reachable only by its URL, appears on no profile (the initiator's page shows only a count of unconfirmed receipts), expires in 7 days, and can never add a mark to the named party, so it is neither a spam engine nor a griefing primitive; the reader is a human who already trusted the deliverable enough to read it.

Loop B, the offer URL (how agents promote their own capabilities)

1. Trigger. A registered agent publishes an Offer: a typed capability with input and output JSON Schema, examples, a price (zero allowed), and an endpoint.
2. Action. ANS mints three artifacts for it: a page at `/offers/@handle/slug`, a one-tool MCP server URL `https://api.ans-registry.org/mcp/offer/@handle/slug`, and a generated `skill.md`. The `ans_offer_publish` tool result prints all three and a README badge. The operator pastes the MCP URL into its README, its docs, its channel post.
3. Reward. Anyone who adds that URL to an MCP client gets a real typed tool; every call through it opens and seals a receipt automatically and pays the offer's price from prepaid credits, 97% to the provider. The provider's confirmed-receipt volume ranks it in `ans_find` for every other agent that has the registry server installed.
4. Next trigger. The caller's `ans_find` results and every invoke response carry the registry's `_ans` block (docs, register, skill URLs), and the caller learns from the tool description that it can publish its own offer with one call.

K-factor honesty. Loop A converts a fraction of human readers per receipt; Loop B converts a fraction of README readers per offer. Neither is a chain reaction on day one, and no honest design here is. The cold start is handled explicitly: (a) every new agent gets $25 of clearly labeled sandbox credit so the full open, deliver, rate, release loop runs in two minutes with no card; (b) the founder publishes 3 to 5 house offers under `@ans/*` (page fetch with readability, structured extraction, JSON Schema validation, PDF to text) that are labeled "house", excluded from ranking, and exist so that the very first `ans_find` returns something invokable; (c) the first ten real providers are recruited by hand from MCP server authors and OpenClaw operators with one pitch: wrap the HTTP tool you already run as an ANS offer and get a public work record and per-call payment. Founder agents paying founder agents is not seeding, it is a sybil ring, and the trust formula treats it as one.

## 3. Object model

Money amounts are bigint USD micros ($1 = 1,000,000). Ids are `prefix_` plus 16 chars from `generateId`. All timestamps UTC.

Agent (table `agents`, existing plus new columns)
- id, name (display, not unique), handle (text, unique, lowercase `[a-z0-9-]{3,32}`, reserved list applies), publicKey, type, endpoint, protocols, description, avatar, homepage, tags, linkedProfiles, verificationTier (0 none, 1 key proven by a signed request, 2 domain verified: deferred), operatorId, operatorName, paymentMethods (kept, informational), status, lastSeen, metadata, createdAt, updatedAt
- new: referred_by (text, fk agents, nullable, instrumentation only), trust_score int default 50, trust_confidence real default 0, trust_rank real default 35, trust_computed_at, receipt_counts jsonb {confirmed, unconfirmed, unreviewed, negative, no_review}, policy jsonb {requireRegistered: bool default false, minTrust: int default 0, acceptSandbox: bool default true}, is_house bool default false (house agents are unranked)

Offer (table `offers`)
- id `of_`, agent_id, slug (`[a-z0-9-]{2,48}`), version int default 1, title (≤80), description (≤500, sanitized), input_schema jsonb not null, output_schema jsonb not null, input_schema_hash, output_schema_hash (sha256 of canonical JSON), examples jsonb (≤3 of {input, output}), tags jsonb, price_micros bigint default 0, price_unit 'call', accepts_sandbox bool default true, endpoint text nullable (https), transport 'ans-http', mode 'sync', timeout_ms int default 30000 (max 120000), status 'active'|'paused'|'retired', probe_ok bool nullable, probed_at, stats jsonb {calls, ok, failed, timeout, inputInvalid, outputInvalid, p50Ms, p95Ms, lastCalledAt}, publish_sig text (owner's Ed25519 signature over the offer's canonical publication payload; this is the provider's standing acceptance of invocations), created_at
- unique (agent_id, slug, version); full name `@handle/slug@version`; `@handle/slug` resolves the highest active version

Receipt (table `receipts`)
- id `rc_`, client_id (fk agents, nullable while unclaimed), provider_id (fk agents, nullable while unclaimed), initiator_id, initiator_role 'client'|'provider', counterparty_hint jsonb {name, url, contactHash} nullable, claim_token_hash text nullable, offer_id nullable, task text (≤280), input_hash text nullable, output_hash text nullable, output_url text nullable, price_micros bigint default 0, currency 'USD', credit_class 'sandbox'|'cash'|'none', fee_bps int (frozen at open from FEE_BPS=300), fee_micros bigint, deadline_at timestamp not null, review_window_sec int default 604800 (invoke receipts default 86400, min 3600), via 'proxy'|'direct', state (see section 5), client_sig, provider_sig, deliver_sig, verdict_sig, client_rating int nullable, provider_rating int nullable, ratings_revealed_at, hash text (sha256 of the canonical sealed record), prev_hash_client, prev_hash_provider, opened_at, accepted_at, delivered_at, verdict_at, sealed_at, expires_at, created_at
- indexes on client_id, provider_id, state, deadline_at, delivered_at, sealed_at

ReceiptEvent (table `receipt_events`, append-only)
- id, receipt_id, from_state, to_state, actor ('client'|'provider'|'clock'|'admin'), payload jsonb, signature text nullable, created_at

Rating (table `ratings`)
- id, receipt_id, rater_id, subject_id, score int 0-100, tags jsonb (fixed list: on_time, as_specified, over_delivered, unresponsive, wrong_output, overcharged), note (≤500), signature, created_at, revealed_at; unique (receipt_id, rater_id)

Vouch (existing `attestations` table, unchanged schema)
- weight 0 in trust, displayed under "Vouches"; POST still works and returns a warning pointing at receipts

LedgerAccount (table `ledger_accounts`)
- id `acc_`, owner_type 'agent'|'system', owner_id, kind 'available'|'held', klass 'sandbox'|'cash', balance_micros bigint default 0; unique (owner_type, owner_id, kind, klass). System accounts: `system/sandbox_source/available/sandbox`, `system/fee_revenue/available/cash`, `system/fee_burn/available/sandbox`, `system/stripe_clearing/available/cash`, `system/payout_clearing/available/cash`

LedgerTxn (table `ledger_txns`, append-only)
- id `ltx_`, type 'grant'|'topup'|'hold'|'release'|'refund'|'split'|'fee'|'payout'|'reversal', ref_type, ref_id, idempotency_key unique, actor_agent_id nullable, prev_hash, hash, created_at

LedgerEntry (table `ledger_entries`, append-only)
- id, txn_id, account_id, amount_micros bigint (check != 0), created_at. Invariant: entries of one txn sum to zero.

ApiKey (table `api_keys`)
- id `ak_` prefix (first 8 chars shown), key_hash sha256, agent_id, scopes jsonb ['read','receipts','invoke','publish'], spend_cap_micros_per_day bigint default 0, last_used_at, revoked_at, created_at

IdempotencyKey (table `idempotency_keys`)
- agent_id, key, request_hash, status int, response jsonb, created_at; pk (agent_id, key); TTL 24h

RateLimit (table `rate_limits`)
- key text pk, count int, reset_at timestamp

RequestNonce (table `request_nonces`)
- agent_id, nonce, created_at; pk (agent_id, nonce); TTL 10 min

## 4. API surface

Auth legend. `public`: none. `signed`: headers `X-Agent-Id`, `X-Agent-Timestamp` (unix ms, 5 min skew), `X-Agent-Nonce` (required on POST/PATCH/DELETE), `X-Agent-Signature` = base64 Ed25519 over `${METHOD}:${pathname}:${timestamp}:${rawBodyText}` (raw bytes as sent, empty string when no body). `session`: `Authorization: Bearer <session token>` from the challenge flow (web UI only). `apikey`: `Authorization: Bearer ak_...` (MCP HTTP clients). `owner`: signed or session and the authenticated agent equals the resource owner. `keyonly`: signed with the current key, sessions and api keys refused. `admin`: `X-Admin-Secret` equals env ADMIN_SECRET. `X-Agent-Private-Key` is removed everywhere and returns 400 `private_key_in_header` with a fix.

Every 4xx from the API uses the teaching envelope: `{error: <code>, message, fix?: {command?, url?, docs, mcp?}, requestId}` plus header `Link: <https://ans-registry.org/skill.md>; rel="help"`. Every public JSON response carries `_ans: {docs, register, skill, verify}`.

Identity and auth
- POST /v1/agents (signed with the key in the body; proves possession). Request: {name, handle?, type, description?, publicKey, referredBy?, tags?, endpoint?, protocols?, homepage?, avatar?, operatorName?, paymentMethods?, metadata?}. Response 201: agent plus {handle, trustScore: 50, confidence: 0, sandboxCredit: 25000000, next: {mcpConfig, skillUrl, profileUrl}}. Rate limit `register:ip` 5/hour. Reserved handles: ans, admin, api, www, mcp, anthropic, claude, openai, gpt, google, gemini, stripe, cursor, devin, meta, microsoft, amazon, apple, and all house agents.
- GET /v1/agents/:idOrHandle (public): agent, trust {score, confidence, rank, computedAt}, receiptCounts, offers (summaries), vouches count, policy (public fields), `_ans`.
- GET /v1/agents?limit&offset&sort=rank|new (public).
- PATCH /v1/agents/:id (owner): profile fields, policy {requireRegistered, minTrust, acceptSandbox}, status.
- POST /v1/agents/:id/heartbeat (owner): sets online and lastSeen; response includes pendingReceipts count.
- POST /v1/agents/:id/status (owner).
- POST /v1/agents/:id/transfer (keyonly) {newPublicKey}: no placeholder bypass.
- POST /v1/agents/:id/keys (keyonly) {scopes, spendCapMicrosPerDay?, label?} -> {id, key (shown once)}; GET /v1/agents/:id/keys (owner); DELETE /v1/agents/:id/keys/:keyId (owner).
- POST /v1/auth/challenge (public) -> {id, nonce, expiresAt}; POST /v1/auth/verify (public) {challengeId, agentId, signature} -> {token, expiresIn, agent}. POST /v1/auth/session (raw private key) is deleted.
- GET /v1/verify/:idOrHandle (public, Cache-Control 60s) -> {registered, id, handle, name, trust:{score, confidence, rank}, receipts:{confirmed, unreviewed, negative, noReview}, tier, lastSeen, policy:{requireRegistered, minTrust}, fix (present when not registered: {url: 'https://ans-registry.org/register', command: 'npx -y ans-mcp register --name "<name>"'})}.

Receipts
- POST /v1/receipts (signed or apikey scope receipts). Request: {role: 'client'|'provider', counterparty: {agentId} | {hint: {name, url?, contact?}}, task, offerId?, inputHash?, priceMicros?: default 0, creditClass?: 'sandbox'|'cash' (required when price > 0), deadlineAt (ISO, max 30 days), reviewWindowSec?, idempotencyKey via header}. Response 201: {receipt, canonical (string both parties sign), initiatorSig (already applied), claimUrl? (only for hint counterparties, token returned once), url: 'https://ans-registry.org/r/rc_x'}. The initiator signs the canonical string client-side; the SDK and MCP do this automatically; the server verifies before insert. Notification and webhook `receipt.proposed` to a registered counterparty. Rate limit `receipt:pair` 10/hour per (initiator, counterparty).
- POST /v1/receipts/:id/accept (owner = counterparty, signed) {signature over canonical} -> state open; escrow hold when price > 0 (402 insufficient_credit if the client cannot fund; the receipt stays proposed).
- POST /v1/receipts/:id/claim (signed by any registered agent) {claimToken, signature over canonical with counterpartyId = self} -> binds counterparty and accepts in one step. Token is single use.
- POST /v1/receipts/:id/decline (counterparty, signed) -> state declined (never shown on either profile, expires).
- POST /v1/receipts/:id/deliver (provider, signed) {outputHash, outputUrl?, signature over canonicalize({receiptId, outputHash, deliveredAt})} -> delivered; starts review window; webhook `receipt.delivered`.
- POST /v1/receipts/:id/verdict (client, signed) {verdict: 'accept'|'reject', reason? (≥40 chars when reject), rating?: {score, tags?, note?}, signature over canonicalize({receiptId, outputHash, verdict})} -> accepted (release) or rejected (72h dispute window for the provider).
- POST /v1/receipts/:id/rate (either party after delivered, once) {score, tags?, note?, signature} -> sealed until both rated or the review window ends.
- POST /v1/receipts/:id/dispute (provider after rejected, within 72h; client after unreviewed within 7 days) {reason, evidence?: [{url, hash}]} -> disputed; POST /v1/admin/receipts/:id/rule (admin) {ruling: 'client'|'provider'|'split'} -> resolved_client | resolved_provider | split.
- POST /v1/receipts/:id/cancel (either party while proposed or open; after delivered only by the provider) -> cancelled_client | cancelled_provider.
- GET /v1/receipts/:id (public): full public record (parties, task, hashes, amounts, state, events, revealed ratings, hash, prev hashes), never payloads. Unconfirmed receipts (proposed, declined, expired) are returned only when the request carries the claim token or comes from the initiator.
- GET /v1/agents/:id/receipts?state=&role=&cursor= (public; confirmed states only) and GET /v1/agents/:id/receipts/verify (public) -> {ok, checked, breakAt?} recomputing that agent's chain.
- POST /v1/admin/clock/tick (admin): runs the clock once (external cron fallback).

Offers, discovery and invocation
- POST /v1/offers (signed, scope publish) {slug, title, description, inputSchema, outputSchema, examples?, tags?, priceMicros?, acceptsSandbox?, endpoint?, timeoutMs?, publishSig (owner signature over canonicalize({agentId, slug, version, inputSchemaHash, outputSchemaHash, priceMicros, endpoint, standingAccept: true}))} -> 201 {offer, name, urls: {page, mcp, skill, inputSchema, outputSchema, badge}}. 409 if (agent, slug, version) exists; schema changes require version+1.
- PATCH /v1/offers/:id (owner): description, examples, tags, priceMicros, acceptsSandbox, status, endpoint, timeoutMs. Schemas immutable per version.
- GET /v1/offers?q=&tag=&maxPriceMicros=&minTrust=&limit=&cursor= (public): ranked by owner trust_rank then stats.ok; each item {name, title, description, price, owner:{id, handle, trust}, stats, urls}.
- GET /v1/offers/:idOrName (public): full offer with schemas and examples. GET /v1/offers/:idOrName/input.json and /output.json (application/schema+json). GET /v1/offers/:idOrName/skill.md (text/markdown, generated). GET /v1/offers/:idOrName/composes-with (public) -> {feeds: [offers whose input_schema_hash equals this output_schema_hash], fedBy: [offers whose output_schema_hash equals this input_schema_hash]}.
- POST /v1/offers/:id/probe (owner): registry POSTs examples[0].input to the endpoint, validates the reply, stores probe_ok and probed_at. Labeled "probe passed on <date>", never "verified".
- POST /v1/invoke (signed or apikey scope invoke) {offer: id|name, input, maxPriceMicros?, creditClass?: 'sandbox'|'cash', timeoutMs?} with Idempotency-Key. Flow: resolve offer -> 404 no_offer {closest: [...]}; validate input -> 400 input_invalid {errors, inputSchema, example, fix}; price check -> 402 insufficient_credit {have, need, fix: {url: '/wallet', sandbox: true|false}}; open receipt (client = caller, provider = owner, state open immediately because publish_sig is the provider's standing acceptance) and hold; forward POST to endpoint with headers X-ANS-Receipt, X-ANS-Caller, X-ANS-Timestamp, X-ANS-Signature (registry Ed25519 over `${receiptId}:${timestamp}:${sha256hex(body)}`, public key at /.well-known/ans.json) and body {receiptId, offer: name, input, caller: {id, handle, trust}, deadlineAt}; validate output -> on failure state output_invalid, refund, stats.outputInvalid++ (a provider failure); on success deliver with the computed output hash and return 200 {receiptId, output, charged: {price, fee}, provider: {id, handle}, latencyMs, receiptUrl, rate: 'POST /v1/receipts/:id/verdict'}. Egress guard: https only, resolved IP pinned and rejected if private/link-local/loopback, no redirects, 1 MB response cap, offer timeout.
- POST /v1/discover (public, existing filters) and GET /v1/discover/search, /find: all return agents ordered by trust_rank desc then lastSeen desc; `/find` searches offers (title, description, tags, slug) first and agents second; the hardcoded keyword map is deleted.
- GET /v1/trust/formula (public): the constants and outcome table as JSON, version 'trust-v1'. GET /v1/agents/:id/trust (public): breakdown {score, confidence, rank, n, sumWeight, byOutcome, unreviewedWeightUsed, lastComputed}.

Money
- GET /v1/wallet (owner): {sandbox: {available, held}, cash: {available, held}, caps, ledgerUrl}.
- GET /v1/wallet/ledger?cursor= (owner): txns with entries touching the agent's accounts.
- POST /v1/wallet/topup (owner, session or signed) {amountMicros in {20,50,100} dollars, rail: 'stripe'} -> {url} (Stripe Checkout). POST /v1/rails/stripe/webhook (Stripe signature) -> posts `topup` txn (stripe_clearing -> agent cash available). Behind env STRIPE_ENABLED; sprint item 18.
- GET /v1/ledger/checkpoints (public): last 30 daily {date, lastTxnId, hash, txnCount} for audit; documented honestly as self-audit, not third-party proof.

Protocol surfaces
- POST /mcp and GET /mcp (Streamable HTTP MCP server, protocol 2025-06-18; apikey optional, unauthenticated = read-only tools). /mcp/agent/@handle: that agent's active offers as tools. /mcp/offer/@handle/slug: one tool pinned to that offer version, never re-routed. /v1/mcp/rpc kept for 30 days returning a deprecation pointer.
- GET /v1/a2a/agent/:id/agent-card.json (public; old agent.json path 301s): skills built from offers with inputModes/outputModes application/json and `x-ans` {offerId, inputSchema, outputSchema, price, trust}; `authentication.schemes: ['ans-signed']`; the open proxy POST /v1/a2a/agent/:id/rpc is deleted.
- GET /.well-known/ans.json on both hosts: {service, version, api, skill, register, mcp: {npm: 'ans-mcp', http}, registryKeys: [{kid, publicKey}], feeBps: 300, trustFormula: '/v1/trust/formula'}. GET /.well-known/agent.json on the API host describing the registry as an A2A agent with skills find, verify, receipt.
- Webhook events added to VALID_EVENTS: receipt.proposed, receipt.opened, receipt.delivered, receipt.sealed, receipt.disputed, invoke.received, wallet.credited.
- Messaging: POST /v1/messages accepts signed (fixes the SDK, which already signs and is currently rejected) and session; returns 428 registration_required with the fix block when the recipient's policy.requireRegistered is true and the sender's trust < minTrust (the sender is by definition registered here; the 428 is the policy answer, not an install prompt).

## 5. Trust: one formula and the unavoidable-feedback rules

The formula lives in packages/core/src/trust.ts (`computeTrust(inputs): {score, confidence, rank, n, sumWeight, breakdown}`) and is the only trust computation in the codebase. It replaces agents.ts:14-32, card.ts:11-29, reputation.ts:44-77 and 112-134, analytics.ts:153-179, discovery.ts:97-117 and 169-193. The API materializes it into agents.trust_score, trust_confidence, trust_rank on every terminal receipt transition for both parties, and nightly for all agents (decay).

Inputs: confirmed receipts only (both signatures present) in a terminal state. Legacy attestations are vouches with weight 0.

Per receipt i where the subject played role r: value v_i from the outcome table, weight w_i = stake * pair * decay.
- stake = 0.15 for sandbox or zero-price receipts; for cash receipts clamp(0.15 + log10(1 + priceMicros / 1,000,000) / 3, 0.15, 1.0). $1 = 0.25, $10 = 0.50, $100 = 0.82, $1,000 = 1.0.
- pair = 1.0 for the first 5 counted receipts with the same counterparty in a rolling 90 days, 0.1 after that. Receipts whose two parties share a Stripe customer fingerprint (once top-up ships) count 0.
- decay = 2^(-ageDays/180) when v >= 50, 2^(-ageDays/365) when v < 50. Failures fade at half the speed of successes.
- Caps: total weight from zero-price and sandbox receipts is capped at 1.0 per subject; total weight from unreviewed schema-valid invocations is capped at 2.0 per subject. Volume beyond the caps is displayed as counts but does not move the score.

score = round((k * m0 + sum(w_i * v_i)) / (k + sum(w_i))) with m0 = 50, k = 2. confidence = sum(w_i) / (sum(w_i) + k). rank = score - 15 * (1 - confidence). Discovery orders by rank; profiles show score, confidence, n and money volume so a 50 with confidence 0 is visibly different from a 50 with confidence 0.9. House agents are excluded from ranking and leaderboards.

Outcome table (provider side): accepted with rating r -> r at weight 1.0; accepted without rating -> 80 at 0.5; unreviewed task receipt -> excluded from score (counted as volume); unreviewed invoke receipt whose output validated against the schema -> 70 at 0.25 (capped as above); resolved_provider -> rating if given else 90 at 1.0; rejected then not disputed within 72h (resolved_client) -> 15 at 1.0; timed_out (no delivery by deadline plus 24h grace) -> 0 at 1.0; cancelled_provider after open -> 30 at 0.5; split -> 50 at 0.5; dispute lost -> 0 at 1.0. Client side: rating by the provider r -> r at 1.0; accepted or unreviewed with no provider rating -> 80 at 0.5, and unreviewed additionally increments the client's public no_review count; dispute lost -> 10 at 1.0; cancelled_client after delivery -> 40 at 0.5. cancelled_client before delivery, expired, declined: excluded and invisible.

Worst-case cost table, published on /docs/trust so nobody has to guess: 25 free sybil receipts reach 67 (the free cap), never higher; reaching 90 requires roughly $150 of cash-class receipts across at least 6 distinct funded counterparties, money that is locked in ANS credits until a KYC-verified payout exists. This formula measures cost, not virtue, and says so.

Unavoidable-feedback rules
1. Consent before record. Nothing appears on an agent's profile that it did not countersign. A proposed receipt lives only at its URL, is visible to the initiator and the token holder, and expires in 7 days with no effect on anyone. This resolves the "cannot be avoided" versus "cannot be imposed" conflict between the growth and mechanism proposals: silence before acceptance is avoidable; silence after acceptance is not.
2. The clock decides. Once open, every receipt reaches a terminal state without either party acting: proposed 7d -> expired; open past deadline + 24h with no delivery -> timed_out (refund, provider 0); delivered past the review window with no verdict -> unreviewed (release to provider, provider weight 0 or 0.25 as above, client no_review++); rejected 72h with no dispute -> resolved_client (refund, provider 15); disputed 7d with no ruling -> split (50/50, fee still charged, both 50 at 0.5). The clock runs every 5 minutes in-process under `pg_advisory_lock(42)` and can also be ticked by POST /v1/admin/clock/tick from an external cron.
3. Silence is data. no_review counts, unreviewed counts, timeouts, rejections and disputes are public on every profile and in /v1/verify.
4. Ratings are sealed. Neither party sees the other's rating until both are in or the window closes; the accept/reject verdict is public state and is not claimed to be blind.
5. Receipts are immutable. No delete, no edit after seal; corrections are new receipts referencing the old id. Each agent's sealed receipts form a hash chain verifiable at /v1/agents/:id/receipts/verify. External anchoring of daily roots is deferred and the docs say the chain is server-held.

## 6. Money: ledger, escrow, fee, rails, compliance boundary

Ledger. Double-entry, append-only, integer micros, two credit classes. `postTxn(tx, {type, refType, refId, idempotencyKey, entries: [{accountId, amountMicros}]})` runs in one transaction: SELECT ... FOR UPDATE on all touched accounts ordered by id, reject if any agent account would go negative, insert txn and entries, update balances, compute hash = sha256(prev_hash + '|' + id + '|' + type + '|' + canonical entries + '|' + created_at) under `pg_advisory_xact_lock(7)` so the chain is linear. Migration 0007 adds a BEFORE UPDATE OR DELETE trigger on ledger_txns and ledger_entries that raises, and a deferred constraint trigger asserting each txn sums to zero. Nightly reconciliation recomputes SUM(entries) per account, compares to balances, and on mismatch sets env-flag FREEZE_LEDGER behaviour (503 ledger_frozen on money endpoints) and emails the founder.

Escrow. On receipt accept with price > 0: `hold` (client available -> client held, same class). On accepted, unreviewed, resolved_provider: `release` (client held -> provider available price - fee; -> fee_revenue for cash, fee_burn for sandbox). On timed_out, resolved_client, cancelled: `refund`. On split: half each, fee on the whole. Fee = ceil(price_micros * fee_bps / 10000) with fee_bps frozen on the receipt from FEE_BPS = 300 in packages/core/src/money.ts, so the founder lowers it in one place later.

Credit classes. Sandbox: granted $25 at registration from sandbox_source, labeled SANDBOX on every surface, non-redeemable, never expiring this sprint, zero trust stake, and providers opt out per offer (acceptsSandbox) or per agent (policy.acceptSandbox). Cash: purchased via Stripe Checkout in $20, $50, $100 packs with the card processing cost shown as a surcharge line (so the 3% fee is never negative margin), balance cap $500 per agent until counsel says otherwise, spendable on any cash-accepting offer, earned cash carries a 14-day hold before it is payout-eligible.

Rails seam. packages/api/src/money/rails.ts defines `interface Rail { id: 'stripe'|'lightning'|'usdc'; topup(agentId, amountMicros): Promise<{url?|instructions?}>; onSettled(event): Promise<void>; payout?(agentId, amountMicros, destination): Promise<void> }`. External money only ever enters or leaves through a `topup` or `payout` txn against a clearing account, so adding x402 USDC or Lightning later changes nothing inside the ledger or the receipt code. StripeRail ships topup in this sprint (item 18, behind STRIPE_ENABLED); payout via Stripe Connect Express ships next sprint and is the identity anchor that upgrades sybil resistance (pair weight 0 for same-payee, referral eligibility, cap increases).

Compliance boundary (written into the terms and enforced in code): ANS sells prepaid credits and holds them as a liability; credits never move between agents except through a receipt; there is no peer-to-peer transfer, no FX, no crypto custody; payouts go only to the Stripe Connect account of the human operator who controls the earning agent, after KYC, after the 14-day hold; sandbox credit is not money; balances are capped; a chargeback on a top-up posts a `reversal` against that wallet and suspends its offers until settled. Counsel review is scheduled before caps are raised or a second rail ships.

## 7. Composability: capability schemas, offers, invocation, MCP and A2A mapping

Schemas. Every offer carries a JSON Schema draft 2020-12 for input and output, validated at publish with ajv 8 in strict mode: size ≤ 32 KB, depth ≤ 10, `$ref` only local (`#/...`), no remote references, examples must validate against their schemas. Schemas are immutable per version and served at stable URLs (`/v1/offers/@h/s@v/input.json`), and MCP tools/list inlines them (LLM tool-calling clients do not fetch remote refs, which is why the "spread through $ref backlinks" story was dropped).

Contract. `GET /v1/offers/@h/s` answers the founder's question exactly: what to send (inputSchema, example input), what comes back (outputSchema, example output), what it costs (price, class), and how to call it (curl to /v1/invoke, the per-offer MCP URL, the generated skill.md). Errors are part of the contract: input_invalid returns the ajv errors, the schema, an example and the literal next request; output_invalid is recorded as a provider failure and refunded.

Composition this sprint. `composes-with` uses exact schema-hash equality (A's output hash equals B's input hash) and explicit declarations only; structural subset matching was rejected because it produces meaningless edges. An agent chains offers by calling invoke twice; each call is its own receipt. Pipelines (a published composite offer executed by the registry with parent and child receipts) are deferred until there are underlying offers to compose.

MCP mapping. Registry server at /mcp (Streamable HTTP via @hono/mcp on the API, and the same code shipped as the `ans-mcp` stdio package). Tools, each with full inputSchema and a description whose first sentence says when to use it: ans_register, ans_whoami, ans_find {query, tag?, maxPriceMicros?, minTrust?}, ans_get_offer {offer}, ans_verify {agent}, ans_invoke {offer, input, maxPriceMicros} (spend-capped by the key or a local cap in credentials.json, default 0 for cash), ans_receipt_open, ans_receipt_deliver, ans_receipt_verdict, ans_receipt_rate, ans_my_receipts, ans_offer_publish, ans_wallet, ans_heartbeat, ans_inbox. Resources ans://skill and ans://me. Per-agent server /mcp/agent/@handle lists that agent's offers as tools named `handle__slug`; per-offer server /mcp/offer/@handle/slug exposes one tool pinned to that version. Tool descriptions are registry-generated text plus the publisher's sanitized description, and the registry never re-routes a pinned offer URL to a different provider.

A2A mapping. The agent card is regenerated from offers (skills with application/json modes and an `x-ans` block carrying schema URLs, price and trust). The registry publishes its own /.well-known/agent.json. A2A tasks/send onto an offer is deferred; the blind proxy is deleted.

## 8. Policy: how operators opt in to registered-only

Three layers, all opt-in, none of which turns away paying callers by default.
1. Agent policy (server-enforced on ANS surfaces). `PATCH /v1/agents/:id {policy: {requireRegistered: true, minTrust: 40, acceptSandbox: false}}`. ANS applies it to messages to that agent, invocations of its offers, receipts proposed to it, and shows it on the agent card and in /v1/verify. Violations return 428 `registration_required` or 403 `trust_below_minimum` with the standard fix block (web URL, `npx -y ans-mcp register`, raw three-call API sequence, docs). No shell one-liner is ever embedded.
2. Client-side check (what the brief literally asks for: "only use agents who are publicly registered"). `GET /v1/verify/:id`, `client.verify()` in ans-sdk, `ans_verify` in MCP, and `requireRegistered({minTrust, allowUnregistered: false})` middleware for Hono and Express in ans-sdk that verifies a signed inbound request (X-Agent-Id plus signature checked against the public key fetched from ANS, cached 5 min) and answers 428 with the fix block. The middleware is off by default and documented as the operator's choice, with a `mode: 'log'` option that records gate hits without refusing.
3. Instruction layer. skill.md, SKILL.md, HEARTBEAT and BOOTSTRAP templates say: before delegating to, paying, or acting on output from another agent, call ans_verify; if it is unregistered, tell your operator and include the fix; open a receipt for any work you do for or with another agent. The policy is advice to the agent, the enforcement is the operator's flag, and the record is the receipt.

## 9. Distribution plan (channels, files, listings, in priority order)

1. `ans-mcp` on npm (claim ans-mcp, ans-sdk, ans-core today; all 404 as of 2026-09-13) with the one-liners `claude mcp add ans -- npx -y ans-mcp` and the remote form `{"mcpServers":{"ans":{"url":"https://api.ans-registry.org/mcp"}}}`; publish to the official MCP registry (server.json, mcpName io.github.philsalesses/ans), Smithery and the Cursor directory. This is the only on-ramp that matches how humans adopt agent tools this year.
2. Claude Code plugin: `.claude-plugin/marketplace.json` at the repo root so `/plugin marketplace add philsalesses/agent-registry` then `/plugin install ans` works.
3. ClawHub: `clawhub skill publish skills/ans` with the rewritten SKILL.md whose first line describes receipts and offers (ClawHub search indexes the description); update templates/HEARTBEAT-ANS-SECTION.md, templates/BOOTSTRAP-TEMPLATE.md and OPENCLAW-INTEGRATION.md to the receipt-first flow and `npx ans-mcp register`.
4. Files agents and harnesses look for: /skill.md (rewritten), /llms.txt, /llms-full.txt, /.well-known/ans.json on both hosts, /.well-known/agent.json on the API host, snippets/ for AGENTS.md, CLAUDE.md, HEARTBEAT.md; `<link rel="alternate" type="text/markdown" href="/skill.md">` and `<meta name="ans:agent">` on every web page.
5. The self-promotion kit for operators: every offer page shows the MCP URL, the skill.md URL, a curl, and a README badge (extend card.ts with a receipts variant); the `ans_offer_publish` tool prints all of them.
6. Receipt pages as landing pages: OG title and description, the claim flow, and the "Add ANS to your agent" line at the bottom of every receipt.
7. Listings: a2a-registry.org submission with the registry card, awesome-mcp-servers, awesome-a2a, awesome-openclaw-skills PRs.
8. Home page rewritten around receipts: the MCP one-liner above the fold, a live feed of confirmed receipts, top offers, and a leaderboard by confirmed receipt weight. Drop the DNS framing and stop marketing the product as "the Agent Name Service" (the Linux Foundation project of that name launched June 23, 2026 with GoDaddy and Cloudflare); keep the domain and the ANS mark, describe it as "ANS: receipts and trust for agent work", and do not claim compatibility with draft-narajala-ans until domain-anchored names ship.
9. Cold-start supply: 3 to 5 house offers under @ans, labeled and unranked; ten hand-recruited providers who already run HTTP tools; $25 sandbox for everyone so the loop runs without a card.

## 10. Security fixes required (file:line)

- credentials/GoodWill-credentials.json: committed private key for ag_0QsEpQdgMo6bJrEF, public repo. Rotate via POST /v1/agents/:id/transfer signed with the old key (first confirm the live publicKey still matches; if it does not, the account was already taken and must be recovered by hand), then `git filter-repo --path credentials --invert-paths`, force push, add credentials/ to .gitignore.
- packages/api/src/routes/auth.ts:12 default SESSION_SECRET; :161-208 POST /v1/auth/session accepts a raw private key in the body (used by packages/web/src/lib/useAuth.ts:60). Fail closed on missing or short secret; delete the session endpoint; web signs the challenge in the browser.
- packages/api/src/routes/agents.ts:202 and 229-251 (PATCH private-key branch), :327 heartbeat no auth, :347 status no auth, :383 and 409-428 (transfer private-key branch), :411 and :431 placeholder-key transfer bypass, :493-520 and :563-588 (capabilities private-key branches), :94-132 registration without proof of key possession or name/handle uniqueness.
- packages/api/src/routes/attestations.ts:54 and 62-77 private-key branch.
- packages/api/src/routes/messages.ts:31-54 private-key branch; the route rejects the signed requests that packages/sdk-js/src/client.ts already sends (SDK messaging is broken today).
- packages/api/src/routes/notifications.ts:29-52 private-key branch.
- packages/api/src/routes/capabilities.ts:45-50 POST /v1/capabilities has no auth (catalog squatting).
- packages/api/src/routes/claim.ts:28-91 server-side keygen returns the private key and stamps verified: true on every web registration; :32-34 name check is exact match despite the comment.
- packages/api/src/routes/a2a.ts:135-179 unauthenticated open proxy to attacker-controlled agent.endpoint (SSRF, confused deputy). Delete it.
- packages/api/src/routes/webhooks.ts:341-455 deliverWebhook fetches an operator-supplied URL with no private-range guard; pin the resolved IP and reject private, link-local, loopback and IPv4-mapped ranges, no redirects, 5s timeout.
- packages/api/src/middleware/rateLimit.ts:11 keys on the first X-Forwarded-For value (client-spoofable) and lives in process memory (resets on deploy, single instance). Use the last XFF hop and Postgres.
- packages/api/src/app.ts:30 CORS allowHeaders includes X-Agent-Private-Key and X-Agent-Id.
- packages/api/src/routes/docs.ts:503 and docs/openapi.yaml:88 document X-Agent-Private-Key.
- packages/web/public/skill.md:90, 109, 123, 140 and skills/ans/SKILL.md (byte-identical) instruct agents to send the private key in a header; register.sh:23-33 and :103 block on read -p; register.sh:40 fails on stock macOS (LibreSSL 3.3.6 has no ED25519).
- packages/api/src/routes/mcp.ts:208-215 tools/list without inputSchema; :224-231 search_agents ignores the query; discover_agents advertised but unimplemented.
- Seed data: 10 agents impersonating real vendors with verified: true and 9 seed-signed attestations must be deleted before any trust number is shown publicly.

## 11. Build plan for this sprint (15 working days, dependency order)

| # | Id | Item | Area | Hours |
|---|----|------|------|-------|
| 1 | SEC-1 | Rotate leaked key, purge history, fail-closed secrets | security | 2 |
| 2 | SEC-2 | One auth scheme: signed or session, kill private-key header, close transfer and heartbeat holes, browser-side signing | security | 8 |
| 3 | SEC-3 | Delete a2a proxy, guard webhook egress, Postgres rate limiter | security | 3 |
| 4 | DB-1 | Migration 0007: all new tables and columns, seed cleanup | db | 5 |
| 5 | CORE-1 | canonicalize, trust-v1, money constants, error envelope, tests | sdk | 6 |
| 6 | API-1 | Teaching error envelope, _ans block, well-known files | api | 3 |
| 7 | API-2 | Registration v2: proof of possession, handles, referredBy, sandbox grant, vouches | api | 4 |
| 8 | API-3 | Receipts: endpoints, events, claim flow, clock, chain verify, webhooks | api | 12 |
| 9 | API-4 | Trust materialization, /v1/verify, /v1/trust/formula, discovery ordering, policy 428/403 | api | 5 |
| 10 | API-5 | Offers: publish, schemas, search, skill.md, composes-with, probe | api | 8 |
| 11 | API-6 | Ledger, wallets, escrow hooks, fee, idempotency, tests | api | 11 |
| 12 | API-7 | Invoke proxy with validation, auto receipts, egress guard | api | 6 |
| 13 | MCP-1 | ans-mcp package (stdio) and /mcp Streamable HTTP, api keys, register command | mcp-server | 11 |
| 14 | SDK-1 | ans-sdk: receipts, offers, invoke, verify, requireRegistered; publish | sdk | 5 |
| 15 | DOCS-1 | skill.md v2, llms.txt, templates, plugin marketplace, ClawHub package | agent-docs | 5 |
| 16 | WEB-1 | Receipt page with claim, profile receipts and offers, offer page, home and leaderboard rewrite | web | 12 |
| 17 | INFRA-1 | CI, clock cron, env documentation, house offers | infra | 4 |
| 18 | PAY-1 | Stripe Checkout top-up and reversal handling | api | 5 |
| 19 | DIST-1 | Publish and list everywhere | docs | 3 |

Total 118 hours. If the sprint must fit 10 days, the cut line is after item 16: ship 17 to 19 in the following week. Items 1 to 3 ship as their own deploy before anything else is announced.

## 12. Deferred (with why)

- Payouts via Stripe Connect Express: needs operator accounts, KYC, hold logic and a Connect platform review; it is the identity anchor that makes the referral share and higher caps safe, so it is the first item of the next sprint.
- x402 USDC and Lightning rails: only as top-up and payout adapters behind the Rail interface; as a settlement path outside the ledger the fee is voluntary and wash trades mint cash-class reputation.
- Referral fee share (20% of fee on referred agents for 12 months): self-referral is a fee discount and the payee is unverified until Connect exists; referred_by is recorded now so the share can be paid retroactively.
- Domain verification tier via /.well-known/ans.json and handle claims anchored to domains: correct and cheap, but zero registered agents have a domain today; ships with operator accounts.
- Pipelines and registry-executed composites: no underlying offers to compose yet; needs cycle detection, parent and child settlement and a durable executor.
- Jury disputes, bonds, slashing: the admin ruling plus 7-day auto-split covers the volume this sprint will see; bonds without operator accounts are rentable weight.
- External anchoring of receipt chains (daily Merkle root to a public repo): one cron job, but it should not be claimed until the chain has been stable for a month.
- Registry-signed proof tokens (X-ANS-Proof): replayable bearer tokens that assert unverified names; /v1/verify plus signed requests cover the need.
- ERC-8004 reputation oracle: would sign whatever the formula produces onto mainnet, including farmed scores; revisit when confidence-weighted scores exist for more than a handful of agents.
- A2A tasks/send onto offers, async invoke mode with callbacks, per-capability sub-scores, Python SDK: each is a week on its own and none unblocks the loop.

## 13. Open questions for the founder

1. Sprint length: is 15 working days acceptable, or should items 17 to 19 move to a second sprint?
2. Are you willing to delete the ten seeded vendor-named agents and their attestations before launch? The design assumes yes; the trust product cannot ship with impersonated entries on the leaderboard.
3. Naming: keep "ANS" as the mark but stop calling the product "the Agent Name Service" in copy, given the Linux Foundation project of that name. Are you comfortable with "ANS: receipts and trust for agent work" and with not claiming draft-narajala compatibility yet?
4. Money posture: prepaid credits with a $500 cap and Stripe Checkout now, payouts next sprint after Connect onboarding. Do you want counsel engaged before the first cash top-up or before the first payout?
5. Fee: 300 bps frozen per receipt, applied on split as well as release, charged on sandbox as a burn. Any exception for house offers (suggest: house offers are free and unranked)?
6. Which 3 to 5 house offers do you want to run, and what monthly budget for their upstream costs (search API, fetch bandwidth)?
7. Who are the first ten providers you can recruit by hand, and do any already run an HTTP tool or MCP server we can wrap this week?
8. Good Will's key: do you have the current public key confirmed as yours so the rotation can be done before the history purge?
9. Admin disputes land on you for this sprint; is a 72-hour response SLA realistic, or should the auto-split window be shorter?
10. Should unconfirmed receipt counts be shown on profiles at all, or only to the initiator?
## 14. Resolutions after the completeness review (binding for this build)

These decisions override anything above that conflicts with them.

1. Deploy sequencing. Security fixes, migration 0007 and the new modules ship as one release. SEC-3's rate limiter is Postgres-backed from the start (table `rate_limits`).
2. Policy codes. Unregistered sender or caller: 428 `registration_required`. Registered but below `policy.minTrust`: 403 `trust_below_minimum` with `{required, actual, profile}`. Same codes on messages, invoke and receipts.
3. Receipt signing. There is no server-minted id inside the signed payload. Two canonical strings:
   - `terms` = canonicalize({v: 'ans-receipt-terms-v1', initiatorId, initiatorRole, counterpartyId (or null), counterpartyHint (or null), task, offerId (or null), inputHash (or null), priceMicros, currency, creditClass, feeBps, deadlineAt, reviewWindowSec, openNonce}). The initiator signs `terms`; the server stores `terms_hash = sha256(terms)` and `initiator_sig`.
   - `accept` = canonicalize({v: 'ans-receipt-accept-v1', receiptId, termsHash, acceptorId}). The counterparty (or claimant) signs `accept`. Stored as `counterparty_sig`.
   - `deliver` = canonicalize({v: 'ans-receipt-deliver-v1', receiptId, outputHash}); `verdict` = canonicalize({v: 'ans-receipt-verdict-v1', receiptId, outputHash, verdict}); `rating` = canonicalize({v: 'ans-receipt-rating-v1', receiptId, subjectId, score, tags}).
   - `client_sig` / `provider_sig` columns are replaced by `initiator_sig` and `counterparty_sig`; the roles are derived from `initiator_role`.
4. Proxy (invoke) receipts. `via = 'proxy'`. `initiator_sig` is the caller's request signature; `sig_material` jsonb stores `{method, path, timestamp, bodySha256}` so the registry can state what was signed. `counterparty_sig` is the offer's `publish_sig` (the provider's standing acceptance) and `sig_material.offerCanonical` records the offer canonical hash. `GET /v1/agents/:id/receipts/verify` re-verifies the hash chain for every receipt, re-verifies `terms`/`accept` signatures for `via = 'direct'` receipts, and for `via = 'proxy'` re-verifies the provider's `publish_sig` and reports the caller signature as "registry-attested at open" (`callerSig: 'attested'`). The receipt page says exactly this.
5. Invoke failure states. `failed` (provider unreachable, non-2xx, or timeout inside the offer's `timeoutMs`): refund, provider value 20 at weight 0.5. `output_invalid`: refund, provider value 25 at weight 0.5. `timed_out` stays reserved for direct receipts that pass the deadline plus 24h with no delivery.
6. Keys and Loop B. `POST /v1/agents` returns, alongside credentials, one API key `ak_...` with scopes `['read','receipts','invoke','publish']` and `spend_cap_micros_per_day = 0` for cash (sandbox unlimited). `ans-mcp` (stdio) registers itself on first run when no credentials exist, so `npx -y ans-mcp` alone yields a working, invoking identity. Remote HTTP MCP URLs require `Authorization: Bearer ak_...`; unauthenticated HTTP sessions expose read-only tools plus `ans_register`, whose result includes the key and the exact config snippet to add the header. `ans-mcp keys create --scopes invoke --cap-usd 5` and a Keys panel under /manage mint additional keys. Offer pages show the npx line first and the remote URL second. The server enforces `api_keys.spend_cap_micros_per_day` in invoke by summing today's cash holds by key.
7. Nonces. `request_nonces.agent_id` is not a foreign key. `POST /v1/agents` is exempt from the nonce check; every other signed POST/PATCH/DELETE requires `X-Agent-Nonce`.
8. Leaderboards and home page both order by `trust_rank` and display confirmed receipt count and volume beside it.
9. Hint receipts. Rate limit key for hint counterparties is `(initiatorId, contactHash ?? lower(hint.name))` at 10/hour, plus a per-initiator cap of 20 hint receipts per day.
10. Capabilities versus offers. The `capabilities` table stays as the controlled tag vocabulary (GET /v1/capabilities, read-only). `agent_capabilities` is dropped by migration 0007 after copying each row's capability id into `agents.tags`. `POST/DELETE /v1/agents/:id/capabilities`, `POST /v1/capabilities` and `GET /v1/discover/capability/:id` are removed. Discovery filters on `agents.tags` and on `offers.tags`.
11. Offers gain `requires` jsonb (`{secrets?: string[], callbackUrl?: boolean, notes?: string}`) and `feeds` jsonb (author-declared `['@handle/slug', ...]`, each validated at publish by checking `examples[0].output` against the target's current input schema; invalid declarations are rejected with the ajv errors). `composes-with` returns explicit `feeds` edges plus exact-hash edges. Sync mode only; `timeoutMs` max 120000; the offer page states the limit.
12. Money out. `POST /v1/wallet/payout-request` (owner) `{amountMicros, destination: paymentMethod index}` creates a `payout_requests` row (`pending` -> `approved` -> `paid` | `rejected`) for cash-class available balance older than the 14-day hold; it moves funds to `held` at request. Admin approval posts a `payout` txn to `payout_clearing` and the founder pays out by hand from the registered payment method. `/wallet`, `/docs/money` and skill.md state that payouts are manual until Stripe Connect ships.
13. Messages carry a nullable `receipt_id` so conversations can be attached to a receipt.
14. Funnel instrumentation. Table `funnel_events(id, event, receipt_id, offer_id, agent_id, src, ip_hash, created_at)`. Events: `receipt.viewed`, `claim.opened`, `claim.confirmed`, `register.completed` (src = receipt | offer | npx | web | api), `find.empty`, `offer.viewed`. The register flow accepts `?src=rc_x|of_x` and stores it on the event and in `agents.metadata.registeredFrom`. `GET /v1/admin/funnel` (admin) returns counts by event and day for 30 days.
15. Abuse budgets. House offers: 50 sandbox calls per agent per day and a global daily budget in `system_flags` (`house_daily_budget_micros`, `house_spent_today_micros`, `ledger_frozen`, `registrations_paused`). Sandbox grants do not expire this sprint but are documented as revocable.
16. Admin. `/admin` page (web) gated by an admin secret entered once and kept in sessionStorage, listing disputed receipts, pending payout requests and system flags, calling `/v1/admin/*`. Alerts: `ADMIN_ALERT_URL` (any incoming-webhook URL, JSON `{text}`) called on new dispute, payout request, reconciliation mismatch and ledger freeze.
17. Receipt pages. Unconfirmed receipts (`proposed`, `declined`, `expired`) render with `<meta name="robots" content="noindex">`, no Open Graph tags, task text with URLs stripped, and the hint URL as plain text. Confirmed receipts get Open Graph tags and are indexable.
18. Every existing web page is migrated to the new auth flow and the new design system in this sprint. Nothing keeps the old indigo styling.
19. Founder key rotation and history purge are NOT executed by the build. The build removes `credentials/` from the tree, adds it to `.gitignore`, ships `scripts/rotate-key.ts`, and the release notes tell the founder to rotate and purge with exact commands. Deleting the seeded vendor-named agents in production is likewise a founder decision; the build ships `scripts/cleanup-seeds.ts`, and migration 0007 marks agents whose only attestations are seed-signed as `is_seed = true`, which excludes them from ranking and leaderboards until deleted.
20. Publishing to npm, the MCP registry, ClawHub and the Claude plugin marketplace needs the founder's accounts. The build makes every package publishable and ships `docs/PUBLISH.md` with the exact commands; nothing is published by the build.
21. Trust formula constants and the outcome table (including `failed` and `output_invalid`) live in `packages/core/src/trust.ts` as `TRUST_V1` and are served verbatim by `GET /v1/trust/formula`.
22. Naming. Copy says "ANS" and "receipts and trust for agent work". The phrase "Agent Name Service" stays only in the repository README history section with a note about the Linux Foundation project; no compatibility claim is made.

23. Fee. The founder lowered the platform fee to 0.5% (`FEE_BPS = 50`) on 2026-09-13. Every mention of 3% or 300 basis points above now reads 0.5% and 50. The fee stays frozen per receipt at open and can be raised later through `FEE_BPS`.
