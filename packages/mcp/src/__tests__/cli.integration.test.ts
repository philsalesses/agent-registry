import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildAcceptCanonical, buildVerdictCanonical, sha256hex, signMessage, signRequest } from 'ans-core';
// The API under test (a dev-time relative import; the published package never depends on packages/api)
import { createApp } from '../../../api/src/app';
import { deleteMcpTestData, receiptSignaturesForTest } from '../../../api/src/mcp/test-support';
import { createTestAgent, deleteRateLimitKeys, type TestAgent } from '../../../api/src/__tests__/helpers';

/**
 * End to end against a live API on a random port (DATABASE_URL, e.g.
 * agent_registry_t_mcp): the built CLI registers under a temp HOME, whoami and
 * verify read it back, and the SDK client drives the stdio server in signed
 * mode (receipt canonicals signed locally) and in unregistered mode
 * (ans_register writes the credentials file and switches the session).
 *
 * Build first: pnpm --filter ans-mcp build
 */

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', '..', 'dist', 'cli.js');
const RATE_PREFIXES = ['register:ip:', 'global:', 'receipt:', 'hint:'];

type Json = Record<string, any>;

let base = '';
let server: ReturnType<typeof serve> | null = null;
const agentIds = new Set<string>();
const temps: string[] = [];
const clients: Client[] = [];

function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('ANS_') || k === 'DATABASE_URL') continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

function runCli(args: string[], extra: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: childEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolveRun({ code: code ?? -1, stdout, stderr }));
  });
}

async function stdioClient(home: string): Promise<Client> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI], env: childEnv({ HOME: home, ANS_API_URL: base }), stderr: 'pipe' });
  const client = new Client({ name: 'ans-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Json = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  const text = res.content[0].text;
  return { isError: res.isError === true, text, json: JSON.parse(text.split('\n')[0]) as Json };
}

async function signedFetch(agent: TestAgent, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers = await signRequest(agent.privateKey, { method, pathname: path, body: raw, agentId: agent.id });
  const res = await fetch(base + path, { method, headers: { ...headers, ...(raw ? { 'Content-Type': 'application/json' } : {}) } as Record<string, string>, body: raw || undefined });
  return { status: res.status, json: (await res.json()) as Json };
}

describe.skipIf(!process.env.DATABASE_URL)('ans-mcp against a live API', () => {
  let homeA = '';
  let homeB = '';
  let registeredA: Json = {};
  let counterparty: TestAgent;

  beforeAll(async () => {
    if (!existsSync(CLI)) throw new Error(`${CLI} is missing: run pnpm --filter ans-mcp build first`);
    await deleteRateLimitKeys(RATE_PREFIXES);
    const app = createApp();
    await new Promise<void>((ready) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        base = `http://127.0.0.1:${info.port}`;
        ready();
      });
    });
    homeA = await mkdtemp(join(tmpdir(), 'ans-mcp-home-a-'));
    homeB = await mkdtemp(join(tmpdir(), 'ans-mcp-home-b-'));
    temps.push(homeA, homeB);
    counterparty = await createTestAgent('mcpc');
    agentIds.add(counterparty.id);
  });

  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => undefined);
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    await deleteMcpTestData(Array.from(agentIds));
    await deleteRateLimitKeys(RATE_PREFIXES);
    for (const d of temps) await rm(d, { recursive: true, force: true });
  });

  it('register --json registers, prints the configs and writes credentials with mode 600', async () => {
    const res = await runCli(['register', '--name', 'MCP Test', '--json'], { HOME: homeA, ANS_API_URL: base });
    expect(res.stderr).toBe('');
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as Json;
    registeredA = out;
    agentIds.add(out.agentId);
    expect(out.agentId).toMatch(/^ag_/);
    expect(out.handle).toMatch(/^mcp-test/);
    expect(out.apiKey).toMatch(/^ak_/);
    expect(out.sandboxCredit).toBe('$25.00');
    expect(out.mcp.claudeCode).toContain('npx -y ans-mcp');
    expect(out.mcp.json.mcpServers.ans.command).toBe('npx');
    expect(out.mcp.remote.mcpServers.ans.headers.Authorization).toBe(`Bearer ${out.apiKey}`);
    expect(res.stdout).not.toContain('privateKey');

    const path = join(homeA, '.config', 'ans', 'credentials.json');
    expect(out.credentialsPath).toBe(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const creds = JSON.parse(await readFile(path, 'utf8')) as Json;
    expect(creds).toMatchObject({ agentId: out.agentId, handle: out.handle, apiKey: out.apiKey, api: base, spendCapUsdPerDay: 0 });
    expect(Buffer.from(creds.privateKey, 'base64')).toHaveLength(32);
    expect(Buffer.from(creds.publicKey, 'base64')).toHaveLength(32);
    expect(new Date(creds.registeredAt).toISOString()).toBe(creds.registeredAt);
  });

  it('refuses to register over existing credentials without --force', async () => {
    const res = await runCli(['register', '--name', 'MCP Test'], { HOME: homeA, ANS_API_URL: base });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('credentials already exist');
  });

  it('whoami reads the agent back with a signed request', async () => {
    const json = await runCli(['whoami', '--json'], { HOME: homeA });
    expect(json.code).toBe(0);
    const who = JSON.parse(json.stdout) as Json;
    expect(who.agentId).toBe(registeredA.agentId);
    expect(who.trust.score).toBe(50);
    expect(who.api).toBe(base);
    const human = await runCli(['whoami'], { HOME: homeA });
    expect(human.code).toBe(0);
    expect(human.stdout).toContain(`@${registeredA.handle}`);
  });

  it('verify exits 0 for a registered agent and 3 for an unknown one', async () => {
    const yes = await runCli(['verify', registeredA.handle, '--json'], { HOME: homeA });
    expect(yes.code).toBe(0);
    expect(JSON.parse(yes.stdout).id).toBe(registeredA.agentId);
    const no = await runCli(['verify', '@no-such-agent-zz9'], { HOME: homeA });
    expect(no.code).toBe(3);
    expect(no.stdout).toContain('NOT a registered ANS agent');
  });

  it('keys create mints a scoped, capped key (signed with the agent key)', async () => {
    const res = await runCli(['keys', 'create', '--scopes', 'read,invoke', '--cap-usd', '5', '--json'], { HOME: homeA });
    expect(res.stderr).toBe('');
    expect(res.code).toBe(0);
    const key = JSON.parse(res.stdout) as Json;
    expect(key.key).toMatch(/^ak_/);
    expect(key.scopes).toEqual(['read', 'invoke']);
    expect(key.spendCapMicrosPerDay).toBe('5000000');
    expect(key.remoteMcp.mcpServers.ans.url).toBe(`${base}/mcp`);
  });

  it('the stdio server runs in signed mode and verifies the new agent', async () => {
    const client = await stdioClient(homeA);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('ans_register');
    for (const n of ['ans_whoami', 'ans_verify', 'ans_find', 'ans_invoke', 'ans_receipt_open', 'ans_offer_publish', 'ans_inbox']) expect(names).toContain(n);

    const verified = await call(client, 'ans_verify', { agent: registeredA.handle });
    expect(verified.isError).toBe(false);
    expect(verified.json).toMatchObject({ registered: true, id: registeredA.agentId, handle: registeredA.handle });

    const who = await call(client, 'ans_whoami');
    expect(who.json.agent.id).toBe(registeredA.agentId);
    expect(who.json.auth).toBe('signed');

    const me = await client.readResource({ uri: 'ans://me' });
    expect(JSON.parse((me.contents[0] as { text: string }).text)).toMatchObject({ registered: true, id: registeredA.agentId });
  });

  it('signs receipt canonicals locally: open, accept, deliver, verdict, rate', async () => {
    const client = await stdioClient(homeA);

    const opened = await call(client, 'ans_receipt_open', { role: 'provider', counterparty: counterparty.handle, task: 'Translate the release notes into French' });
    expect(opened.isError).toBe(false);
    expect(opened.json).toMatchObject({ state: 'proposed', signed: true, yourRole: 'provider' });
    expect(opened.text).toContain(`Put this line in your deliverable, once: Receipt: ${opened.json.url}`);
    const id = opened.json.receiptId as string;

    const view = await signedFetch(counterparty, 'GET', `/v1/receipts/${id}`);
    expect(view.status).toBe(200);
    const acceptSig = await signMessage(counterparty.privateKey, buildAcceptCanonical({ receiptId: id, termsHash: view.json.receipt.termsHash, acceptorId: counterparty.id }).canonical);
    const accepted = await signedFetch(counterparty, 'POST', `/v1/receipts/${id}/accept`, { signature: acceptSig });
    expect(accepted.status).toBe(200);
    expect(accepted.json.receipt.state).toBe('open');

    const output = 'Notes de version: corrections et nouvelles fonctions.';
    const delivered = await call(client, 'ans_receipt_deliver', { receiptId: id, output });
    expect(delivered.isError).toBe(false);
    expect(delivered.json).toMatchObject({ state: 'delivered', outputHash: sha256hex(output) });

    const verdictSig = await signMessage(counterparty.privateKey, buildVerdictCanonical({ receiptId: id, outputHash: sha256hex(output), verdict: 'accept' }).canonical);
    const verdict = await signedFetch(counterparty, 'POST', `/v1/receipts/${id}/verdict`, { verdict: 'accept', signature: verdictSig });
    expect(verdict.status).toBe(200);
    expect(verdict.json.receipt.state).toBe('accepted');

    const rated = await call(client, 'ans_receipt_rate', { receiptId: opened.json.url, score: 88, tags: ['on_time'] });
    expect(rated.isError).toBe(false);
    expect(rated.json).toMatchObject({ rated: `@${counterparty.handle}`, score: 88 });

    // real Ed25519 signatures made inside the stdio process, not registry attestations
    const sigs = await receiptSignaturesForTest(id);
    expect(sigs?.state).toBe('accepted');
    expect(sigs?.initiatorSig.startsWith('attested:')).toBe(false);
    expect(sigs?.deliverSig?.startsWith('attested:')).toBe(false);
    expect(sigs?.ratings).toHaveLength(1);
    expect(sigs?.ratings[0].signature.startsWith('attested:')).toBe(false);

    const mine = await call(client, 'ans_my_receipts', { role: 'provider' });
    expect(mine.json.receipts.map((r: Json) => r.id)).toContain(id);
  });

  it('opens a signed hint receipt with a claim link, and refuses an unregistered counterparty as client', async () => {
    const client = await stdioClient(homeA);
    const hint = await call(client, 'ans_receipt_open', {
      role: 'provider',
      counterpartyName: 'Acme release bot',
      counterpartyUrl: 'https://github.com/acme/release',
      counterpartyContact: 'Ops@Acme.example',
      task: 'Draft the changelog for 2.4',
    });
    expect(hint.isError).toBe(false);
    expect(hint.json.signed).toBe(true);
    expect(hint.json.claimUrl).toContain(`/r/${hint.json.receiptId}?claim=`);
    expect(hint.text).toContain('Send this claim link to Acme release bot');

    const refused = await call(client, 'ans_receipt_open', { role: 'client', counterpartyName: 'Unknown bot', task: 'Write my tests' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Tell your operator and include the fix');
  });

  it('without credentials the stdio server offers ans_register, which writes the file and switches to signed mode', async () => {
    const client = await stdioClient(homeB);
    const before = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(before).toEqual(['ans_find', 'ans_get_offer', 'ans_register', 'ans_verify']);

    const reg = await call(client, 'ans_register', { name: 'MCP Stdio Test' });
    expect(reg.isError).toBe(false);
    expect(reg.json).toMatchObject({ registered: true, auth: 'signed' });
    agentIds.add(reg.json.agentId);
    expect(reg.text).not.toContain('privateKey');

    const path = join(homeB, '.config', 'ans', 'credentials.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const creds = JSON.parse(await readFile(path, 'utf8')) as Json;
    expect(creds).toMatchObject({ agentId: reg.json.agentId, handle: reg.json.handle, api: base, spendCapUsdPerDay: 0 });

    const after = (await client.listTools()).tools.map((t) => t.name);
    expect(after).not.toContain('ans_register');
    expect(after).toContain('ans_whoami');
    const who = await call(client, 'ans_whoami');
    expect(who.json.agent.id).toBe(reg.json.agentId);
    expect(who.json.auth).toBe('signed');
  });
});
