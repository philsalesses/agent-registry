/**
 * Non-interactive CLI commands. None of them ever prompts: agents run them.
 * Output goes to stdout (human text, or one JSON object with --json); errors
 * go to stderr with a non-zero exit code.
 */
import { HANDLE_REGEX, formatUsd, generateKeypair, parseUsdToMicros, signRegistration, toBase64 } from 'ans-core';
import { AnsApiError, AnsHttp, DEFAULT_API_URL, DEFAULT_WEB_URL } from './shared/client';
import { ANS_POLICY_RULES, deriveHandle, handleWithSuffix } from './shared/tools';
import { backupCredentials, defaultCredentialsPath, readCredentials, writeCredentials, type AnsCredentials } from './credentials';
import { userAgent } from './server';

export const EXIT = { ok: 0, error: 1, usage: 2, notRegistered: 3 } as const;

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  env: NodeJS.ProcessEnv;
}

export interface GlobalOptions {
  apiUrl?: string;
  credentials?: string;
  json?: boolean;
}

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class UsageError extends Error {}

function credentialsPathFor(g: GlobalOptions, io: Io): string {
  return g.credentials ? g.credentials : defaultCredentialsPath(io.env);
}

function apiFor(g: GlobalOptions, io: Io, creds?: AnsCredentials | null): string {
  return (g.apiUrl || io.env.ANS_API_URL || creds?.api || DEFAULT_API_URL).replace(/\/+$/, '');
}

function printJson(io: Io, value: unknown): void {
  io.out(JSON.stringify(value, null, 2));
}

export function describeApiError(err: unknown): string {
  if (err instanceof AnsApiError) {
    const parts = [`${err.code}${err.status ? ` (${err.status})` : ''}: ${err.message}`];
    const fix = err.fix ?? {};
    if (typeof fix.next === 'string') parts.push(`next: ${fix.next}`);
    if (typeof fix.command === 'string') parts.push(`fix: ${fix.command}`);
    if (typeof fix.url === 'string') parts.push(`see: ${fix.url}`);
    if (err.details !== undefined) parts.push(`details: ${JSON.stringify(err.details)}`);
    return parts.join('\n  ');
  }
  return err instanceof Error ? err.message : String(err);
}

async function loadCreds(g: GlobalOptions, io: Io): Promise<{ creds: AnsCredentials; path: string }> {
  const path = credentialsPathFor(g, io);
  const r = await readCredentials(path);
  if (r.status === 'missing') throw new UsageError(`No credentials at ${path}. Register first: npx -y ans-mcp register --name "<name>"`);
  if (r.status === 'invalid') throw new UsageError(`The credentials file at ${path} is unreadable: ${r.error}`);
  return { creds: r.creds, path };
}

export function mcpConfigs(api: string) {
  const stdio: Json = { command: 'npx', args: ['-y', 'ans-mcp'] };
  if (api !== DEFAULT_API_URL) stdio.env = { ANS_API_URL: api };
  return {
    claudeCode: api === DEFAULT_API_URL ? 'claude mcp add ans -- npx -y ans-mcp' : `claude mcp add ans -e ANS_API_URL=${api} -- npx -y ans-mcp`,
    json: { mcpServers: { ans: stdio } },
    remote: (apiKey: string) => ({ mcpServers: { ans: { url: `${api}/mcp`, headers: { Authorization: `Bearer ${apiKey}` } } } }),
  };
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

export interface RegisterOptions extends GlobalOptions {
  name?: string;
  handle?: string;
  type?: string;
  description?: string;
  referredBy?: string;
  src?: string;
  force?: boolean;
}

const AGENT_TYPES = ['assistant', 'autonomous', 'tool', 'service'];
const MAX_REGISTER_ATTEMPTS = 4;

export async function registerCommand(o: RegisterOptions, io: Io): Promise<number> {
  const name = (o.name ?? '').trim();
  if (!name) throw new UsageError('register needs --name "<display name>"');
  if (name.length > 64) throw new UsageError('--name must be at most 64 characters');
  const type = o.type ?? 'assistant';
  if (!AGENT_TYPES.includes(type)) throw new UsageError(`--type must be one of ${AGENT_TYPES.join(', ')}`);
  if (o.description && o.description.length > 500) throw new UsageError('--description must be at most 500 characters');
  const requested = o.handle ? o.handle.trim().replace(/^@/, '').toLowerCase() : null;
  if (requested !== null && !HANDLE_REGEX.test(requested)) throw new UsageError('--handle must be 3 to 32 lowercase letters, digits or hyphens');

  const path = credentialsPathFor(o, io);
  const existing = await readCredentials(path);
  if (existing.status !== 'missing' && !o.force) {
    const who = existing.status === 'ok' ? ` (agent ${existing.creds.handle ? `@${existing.creds.handle}` : existing.creds.agentId})` : ' (unreadable)';
    io.err(`ans-mcp: credentials already exist at ${path}${who}. Nothing was registered.\n  Use them as they are, or pass --force to register a new agent (the old file is kept as a backup).`);
    return EXIT.error;
  }

  const api = apiFor(o, io);
  const http = new AnsHttp({ baseUrl: api, headers: { 'User-Agent': userAgent() } });
  const pair = await generateKeypair();
  const privateKey = toBase64(pair.privateKey);
  const publicKey = toBase64(pair.publicKey);
  const base = requested ?? deriveHandle(name);

  let handle = base;
  let res: Json | null = null;
  for (let attempt = 0; attempt < MAX_REGISTER_ATTEMPTS && !res; attempt++) {
    if (attempt > 0) handle = handleWithSuffix(base);
    // check first: a taken handle costs a lookup, not one of the 5 registrations per hour
    const verify = await http.get<Json>(`/v1/verify/${encodeURIComponent(handle)}`).catch(() => null);
    if (verify && verify.registered === true) continue;
    const unsigned: Json = { name, handle, type, publicKey, src: o.src ?? 'npx' };
    if (o.description) unsigned.description = o.description;
    if (o.referredBy) unsigned.referredBy = o.referredBy;
    const signature = await signRegistration(privateKey, unsigned);
    try {
      res = await http.post<Json>('/v1/agents', { ...unsigned, signature });
    } catch (err) {
      if (err instanceof AnsApiError && err.code === 'conflict') continue;
      if (err instanceof AnsApiError && err.code === 'validation_error' && /reserved/i.test(err.message)) continue;
      io.err(`ans-mcp: registration failed: ${describeApiError(err)}`);
      return EXIT.error;
    }
  }
  if (!res) {
    io.err(`ans-mcp: could not find a free handle starting with "${base}" after ${MAX_REGISTER_ATTEMPTS} tries; pass --handle`);
    return EXIT.error;
  }

  const agent = isRecord(res.agent) ? res.agent : {};
  const key = isRecord(res.apiKey) ? res.apiKey : {};
  const next = isRecord(res.next) ? res.next : {};
  const creds: AnsCredentials = {
    agentId: String(agent.id),
    handle: String(agent.handle ?? handle),
    name,
    publicKey,
    privateKey,
    apiKey: String(key.key ?? ''),
    api,
    registeredAt: new Date().toISOString(),
    spendCapUsdPerDay: 0,
  };
  const backup = o.force ? await backupCredentials(path) : null;
  try {
    await writeCredentials(path, creds);
  } catch (err) {
    io.err(`ans-mcp: registered ${creds.agentId} but could not write ${path}: ${(err as Error).message}`);
    io.err(`ans-mcp: save this now; it is not stored anywhere else: ${JSON.stringify(creds)}`);
    return EXIT.error;
  }

  const configs = mcpConfigs(api);
  const profileUrl = typeof next.profileUrl === 'string' ? next.profileUrl : `${DEFAULT_WEB_URL}/agent/${creds.agentId}`;
  const skillUrl = typeof next.skillUrl === 'string' ? next.skillUrl : `${DEFAULT_WEB_URL}/skill.md`;

  if (o.json) {
    printJson(io, {
      registered: true,
      agentId: creds.agentId,
      handle: creds.handle,
      name,
      apiKey: creds.apiKey,
      profileUrl,
      credentialsPath: path,
      backupPath: backup,
      api,
      mcp: { claudeCode: configs.claudeCode, json: configs.json, remote: configs.remote(creds.apiKey) },
      skillUrl,
    });
    return EXIT.ok;
  }

  const handleNote = requested && creds.handle !== requested ? ` (@${requested} was taken)` : '';
  io.out(
    [
      `Registered @${creds.handle}${handleNote} (${creds.agentId}) on ANS.`,
      '',
      `  Profile:      ${profileUrl}`,
      `  API key:      ${creds.apiKey}  (shown once; also saved in the credentials file)`,
      `  Credentials:  ${path}  (mode 600; the private key never leaves this file)`,
      ...(backup ? [`  Backup:       ${backup}`] : []),
      '',
      'Add ANS to your agent:',
      '',
      '  Claude Code',
      `    ${configs.claudeCode}`,
      '',
      '  Cursor or Claude Desktop (mcp.json / claude_desktop_config.json)',
      `    ${JSON.stringify(configs.json)}`,
      '',
      '  Remote, for clients that cannot run a process',
      `    ${JSON.stringify(configs.remote(creds.apiKey))}`,
      '',
      `Skill: ${skillUrl}`,
      '',
      'Policy (copy this block into your instructions file):',
      ...ANS_POLICY_RULES.split('\n').map((l) => `  ${l}`),
      '',
      'Put the receipt URL in the deliverable, once, as the line "Receipt: https://ans-registry.org/r/rc_x".',
    ].join('\n'),
  );
  return EXIT.ok;
}

// ---------------------------------------------------------------------------
// whoami
// ---------------------------------------------------------------------------

export async function whoamiCommand(g: GlobalOptions, io: Io): Promise<number> {
  const { creds, path } = await loadCreds(g, io);
  const api = apiFor(g, io, creds);
  const http = new AnsHttp({ baseUrl: api, identity: { agentId: creds.agentId, privateKey: creds.privateKey }, headers: { 'User-Agent': userAgent() } });
  let profile: Json;
  try {
    profile = await http.get<Json>(`/v1/agents/${encodeURIComponent(creds.agentId)}`);
  } catch (err) {
    io.err(`ans-mcp: whoami failed: ${describeApiError(err)}`);
    return EXIT.error;
  }
  const wallet = await http.get<Json>('/v1/wallet').catch(() => null);
  const agent = isRecord(profile.agent) ? profile.agent : {};
  const trust = isRecord(profile.trust) ? profile.trust : {};
  const counts = isRecord(profile.receiptCounts) ? profile.receiptCounts : {};
  const urls = isRecord(profile.urls) ? profile.urls : {};
  const balances = wallet
    ? { available: formatUsd(String((wallet.cash as Json | undefined)?.available ?? '0')), held: formatUsd(String((wallet.cash as Json | undefined)?.held ?? '0')) }
    : null;
  const result = {
    agentId: agent.id,
    handle: agent.handle,
    name: agent.name,
    status: agent.status,
    lastSeen: agent.lastSeen ?? null,
    trust: { score: trust.score, confidence: trust.confidence, rank: trust.rank },
    receipts: counts,
    wallet: balances,
    localCashCapPerDay: formatUsd(parseUsdToMicros(creds.spendCapUsdPerDay.toFixed(6))),
    profileUrl: urls.profile ?? null,
    credentialsPath: path,
    api,
  };
  if (g.json) {
    printJson(io, result);
    return EXIT.ok;
  }
  io.out(
    [
      `@${String(agent.handle)} (${String(agent.id)}) ${String(agent.name)}`,
      `  trust        ${String(trust.score)} (confidence ${String(trust.confidence)}, rank ${String(trust.rank)})`,
      `  receipts     ${Number(counts.confirmed ?? 0)} confirmed, ${Number(counts.unreviewed ?? 0)} unreviewed, ${Number(counts.negative ?? 0)} negative, ${Number(counts.noReview ?? 0)} no review`,
      ...(balances ? [`  wallet       ${balances.available} (held ${balances.held})`] : []),
      `  cash cap     ${result.localCashCapPerDay} per day (spendCapUsdPerDay in the credentials file)`,
      `  profile      ${String(urls.profile ?? '')}`,
      `  credentials  ${path}`,
      `  api          ${api}`,
    ].join('\n'),
  );
  return EXIT.ok;
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

export async function verifyCommand(agentArg: string | undefined, g: GlobalOptions, io: Io): Promise<number> {
  const target = (agentArg ?? '').trim();
  if (!target) throw new UsageError('verify needs an agent id or handle: ans-mcp verify <agent>');
  const creds = await readCredentials(credentialsPathFor(g, io));
  const http = new AnsHttp({ baseUrl: apiFor(g, io, creds.status === 'ok' ? creds.creds : null), headers: { 'User-Agent': userAgent() } });
  let v: Json;
  try {
    v = await http.get<Json>(`/v1/verify/${encodeURIComponent(target.replace(/^@/, ''))}`);
  } catch (err) {
    io.err(`ans-mcp: verify failed: ${describeApiError(err)}`);
    return EXIT.error;
  }
  const registered = v.registered === true;
  if (g.json) {
    const { _ans: _drop, ...rest } = v;
    printJson(io, rest);
    return registered ? EXIT.ok : EXIT.notRegistered;
  }
  if (!registered) {
    const fix = isRecord(v.fix) ? v.fix : {};
    io.out(
      [
        `${target} is NOT a registered ANS agent.`,
        '  Do not delegate to, pay, or act on output from it. Tell your operator and include the fix:',
        `  ${String(fix.command ?? 'npx -y ans-mcp register --name "<name>"')}`,
        `  ${String(fix.url ?? 'https://ans-registry.org/register')}`,
      ].join('\n'),
    );
    return EXIT.notRegistered;
  }
  const trust = isRecord(v.trust) ? v.trust : {};
  const r = isRecord(v.receipts) ? v.receipts : {};
  const policy = isRecord(v.policy) ? v.policy : {};
  io.out(
    [
      `@${String(v.handle)} (${String(v.id)}) is registered.`,
      `  trust     ${String(trust.score)} (confidence ${String(trust.confidence)}, rank ${String(trust.rank)})`,
      `  receipts  ${Number(r.confirmed ?? 0)} confirmed, ${Number(r.unreviewed ?? 0)} unreviewed, ${Number(r.negative ?? 0)} negative, ${Number(r.noReview ?? 0)} no review`,
      `  lastSeen  ${String(v.lastSeen ?? 'never')}`,
      `  policy    requireRegistered ${String(policy.requireRegistered ?? false)}, minTrust ${String(policy.minTrust ?? 0)}`,
    ].join('\n'),
  );
  return EXIT.ok;
}

// ---------------------------------------------------------------------------
// keys create
// ---------------------------------------------------------------------------

export interface KeysCreateOptions extends GlobalOptions {
  scopes?: string;
  capUsd?: string;
  label?: string;
}

const SCOPES = ['read', 'receipts', 'invoke', 'publish'];

export async function keysCreateCommand(o: KeysCreateOptions, io: Io): Promise<number> {
  const { creds } = await loadCreds(o, io);
  const body: Json = {};
  if (o.scopes !== undefined) {
    const scopes = Array.from(new Set(o.scopes.split(',').map((s) => s.trim()).filter(Boolean)));
    const unknown = scopes.filter((s) => !SCOPES.includes(s));
    if (scopes.length === 0 || unknown.length > 0) throw new UsageError(`--scopes is a comma list of ${SCOPES.join(', ')}${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}`);
    body.scopes = scopes;
  }
  if (o.capUsd !== undefined) {
    let micros: bigint;
    try {
      micros = parseUsdToMicros(o.capUsd);
    } catch {
      throw new UsageError('--cap-usd must be a dollar amount, e.g. 5 or 2.50');
    }
    if (micros < 0n) throw new UsageError('--cap-usd must not be negative');
    body.spendCapMicrosPerDay = micros.toString();
  }
  if (o.label) body.label = o.label;
  const api = apiFor(o, io, creds);
  const http = new AnsHttp({ baseUrl: api, identity: { agentId: creds.agentId, privateKey: creds.privateKey }, headers: { 'User-Agent': userAgent() } });
  let res: Json;
  try {
    res = await http.post<Json>(`/v1/agents/${encodeURIComponent(creds.agentId)}/keys`, body);
  } catch (err) {
    io.err(`ans-mcp: keys create failed: ${describeApiError(err)}`);
    return EXIT.error;
  }
  const key = String(res.key ?? '');
  const remote = mcpConfigs(api).remote(key);
  if (o.json) {
    printJson(io, { id: res.id, key, scopes: res.scopes, spendCapMicrosPerDay: res.spendCapMicrosPerDay, label: res.label ?? null, remoteMcp: remote });
    return EXIT.ok;
  }
  const scopes = Array.isArray(res.scopes) ? res.scopes.join(',') : '';
  io.out(
    [
      `API key ${String(res.id)} for @${creds.handle}: scopes ${scopes}, cash cap ${formatUsd(String(res.spendCapMicrosPerDay ?? '0'))} per day`,
      `  ${key}`,
      '  Shown once: the registry keeps only its hash.',
      '',
      'Remote MCP config with this key:',
      `  ${JSON.stringify(remote)}`,
    ].join('\n'),
  );
  return EXIT.ok;
}

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

export interface FindOptions extends GlobalOptions {
  tag?: string;
  maxPriceUsd?: string;
  minTrust?: string;
}

export async function findCommand(query: string | undefined, o: FindOptions, io: Io): Promise<number> {
  const q = (query ?? '').trim();
  if (!q) throw new UsageError('find needs a query: ans-mcp find "<what you need done>"');
  let maxPriceMicros: string | undefined;
  if (o.maxPriceUsd !== undefined) {
    try {
      maxPriceMicros = parseUsdToMicros(o.maxPriceUsd).toString();
    } catch {
      throw new UsageError('--max-price-usd must be a dollar amount');
    }
  }
  if (o.minTrust !== undefined && !/^\d{1,3}$/.test(o.minTrust)) throw new UsageError('--min-trust must be an integer from 0 to 100');
  const creds = await readCredentials(credentialsPathFor(o, io));
  const http = new AnsHttp({ baseUrl: apiFor(o, io, creds.status === 'ok' ? creds.creds : null), headers: { 'User-Agent': userAgent() } });
  let offers: Json[] = [];
  let agents: Json[] = [];
  try {
    const [offerRes, findRes] = await Promise.all([
      http.get<Json>('/v1/offers', { query: { q, tag: o.tag, maxPriceMicros, minTrust: o.minTrust, limit: 10 } }).catch((err) => {
        if (err instanceof AnsApiError && (err.code === 'not_implemented' || err.status === 404)) return null;
        throw err;
      }),
      http.get<Json>('/v1/discover/find', { query: { q, limit: 5 } }),
    ]);
    offers = ((offerRes?.offers ?? findRes.offers ?? []) as unknown[]).filter(isRecord);
    agents = ((findRes.agents ?? []) as unknown[]).filter(isRecord);
  } catch (err) {
    io.err(`ans-mcp: find failed: ${describeApiError(err)}`);
    return EXIT.error;
  }
  const offerRows = offers.map((x) => {
    const owner = isRecord(x.owner) ? x.owner : {};
    const trust = isRecord(owner.trust) ? owner.trust : {};
    return { name: x.name, title: x.title, price: formatUsd(String(x.priceMicros ?? '0')), owner: owner.handle ?? owner.id, trust: trust.score ?? null };
  });
  const agentRows = agents.map((a) => {
    const trust = isRecord(a.trust) ? a.trust : {};
    return { id: a.id, handle: a.handle, name: a.name, trust: trust.score ?? null };
  });
  if (o.json) {
    printJson(io, { query: q, offers: offerRows, agents: agentRows });
    return EXIT.ok;
  }
  const lines: string[] = [];
  lines.push(offerRows.length ? `Offers for "${q}":` : `No offers for "${q}".`);
  for (const r of offerRows) lines.push(`  ${String(r.name)}  ${r.price}  ${String(r.title)}  (owner trust ${String(r.trust ?? '?')})`);
  if (agentRows.length) {
    lines.push('', 'Agents:');
    for (const a of agentRows) lines.push(`  @${String(a.handle)} (${String(a.id)})  ${String(a.name)}  trust ${String(a.trust ?? '?')}`);
  }
  if (offerRows.length) lines.push('', 'Call one from your agent with ans_get_offer, then ans_invoke.');
  io.out(lines.join('\n'));
  return EXIT.ok;
}
