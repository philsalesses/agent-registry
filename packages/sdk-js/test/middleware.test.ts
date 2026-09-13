import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { ANSClient, AgentIdentity, expressRequireRegistered, honoRequireRegistered, type GateDecision, type RegisterResult, type VerifiedCaller } from '../src';
import { AgentTracker, startApi, type TestApi } from './helpers';

let api: TestApi;
let agents: AgentTracker;
let caller: ANSClient;
let callerReg: RegisterResult;
const decisions: GateDecision[] = [];

function tinyApp() {
  const app = new Hono<{ Variables: { ansCaller: VerifiedCaller } }>();
  app.use('/open/*', honoRequireRegistered({ baseUrl: api.baseUrl }));
  app.use('/strict/*', honoRequireRegistered({ baseUrl: api.baseUrl, minTrust: 90 }));
  app.use('/log/*', honoRequireRegistered({ baseUrl: api.baseUrl, minTrust: 90, mode: 'log', onDecision: (d) => decisions.push(d) }));
  app.post('/open/echo', async (c) => c.json({ caller: c.get('ansCaller')?.id ?? null, body: await c.req.json() }));
  app.get('/open/whoami', (c) => c.json({ caller: c.get('ansCaller')?.handle ?? null }));
  app.post('/strict/echo', (c) => c.json({ ok: true }));
  app.post('/log/echo', (c) => c.json({ ok: true, caller: c.get('ansCaller')?.id ?? null }));
  return app;
}

async function signed(identity: AgentIdentity, method: string, path: string, body?: unknown): Promise<RequestInit> {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers: Record<string, string> = { ...(await identity.signRequest(method, path, raw)) };
  if (raw) headers['Content-Type'] = 'application/json';
  return { method, headers, body: raw || undefined };
}

beforeAll(async () => {
  api = await startApi();
  agents = new AgentTracker(api.baseUrl);
  ({ client: caller, res: callerReg } = await agents.register('sdk-gate'));
});

afterAll(async () => {
  await agents?.cleanup();
  await api?.close();
});

describe('honoRequireRegistered', () => {
  it('answers 428 registration_required to an unsigned request', async () => {
    const res = await tinyApp().request('/open/echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"hi":1}' });
    expect(res.status).toBe(428);
    const body = (await res.json()) as { error: string; fix: { url: string; command: string }; details: { reason: string } };
    expect(body.error).toBe('registration_required');
    expect(body.fix.url).toMatch(/register/);
    expect(body.fix.command).toMatch(/ans-mcp register/);
    expect(body.details.reason).toBe('unsigned');
  });

  it('lets a registered agent with a valid signature through and exposes the caller', async () => {
    const identity = caller.identity!;
    const app = tinyApp();
    const post = await app.request('/open/echo', await signed(identity, 'POST', '/open/echo', { task: 'summarize' }));
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ caller: callerReg.agent.id, body: { task: 'summarize' } });

    const get = await app.request('/open/whoami', await signed(identity, 'GET', '/open/whoami'));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ caller: callerReg.agent.handle });
  });

  it('answers 428 for unknown agents, tampered bodies and stale timestamps', async () => {
    const app = tinyApp();
    const stranger = await AgentIdentity.create();
    stranger.bind({ agentId: 'ag_NotRegistered00001' });
    const unknown = await app.request('/open/echo', await signed(stranger, 'POST', '/open/echo', { a: 1 }));
    expect(unknown.status).toBe(428);
    expect(((await unknown.json()) as { details: { reason: string } }).details.reason).toBe('unknown_agent');

    const init = await signed(caller.identity!, 'POST', '/open/echo', { amount: 1 });
    const tampered = await app.request('/open/echo', { ...init, body: JSON.stringify({ amount: 1000 }) });
    expect(tampered.status).toBe(428);
    expect(((await tampered.json()) as { details: { reason: string } }).details.reason).toBe('invalid_signature');

    const stale = await signed(caller.identity!, 'POST', '/open/echo', { a: 1 });
    (stale.headers as Record<string, string>)['X-Agent-Timestamp'] = String(Date.now() - 10 * 60 * 1000);
    const old = await app.request('/open/echo', stale);
    expect(old.status).toBe(428);
    expect(((await old.json()) as { details: { reason: string } }).details.reason).toBe('stale_timestamp');
  });

  it('answers 403 trust_below_minimum below minTrust', async () => {
    const res = await tinyApp().request('/strict/echo', await signed(caller.identity!, 'POST', '/strict/echo', {}));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; details: { required: number; actual: number; profile: string } };
    expect(body.error).toBe('trust_below_minimum');
    expect(body.details).toMatchObject({ required: 90, actual: 50 });
    expect(body.details.profile).toContain(callerReg.agent.id);
  });

  it('records and passes through in log mode', async () => {
    decisions.length = 0;
    const app = tinyApp();
    const unsigned = await app.request('/log/echo', { method: 'POST', body: '{}' });
    expect(unsigned.status).toBe(200);
    const low = await app.request('/log/echo', await signed(caller.identity!, 'POST', '/log/echo', {}));
    expect(low.status).toBe(200);
    expect(await low.json()).toEqual({ ok: true, caller: callerReg.agent.id });
    expect(decisions.map((d) => [d.reason, d.status, d.allowed])).toEqual([
      ['unsigned', 428, true],
      ['below_min_trust', 403, true],
    ]);
  });
});

describe('expressRequireRegistered', () => {
  function fakeRes() {
    const out: { status: number; body: unknown; headers: Record<string, string> } = { status: 200, body: undefined, headers: {} };
    const res = {
      status(code: number) {
        out.status = code;
        return res;
      },
      setHeader(name: string, value: string) {
        out.headers[name] = value;
      },
      json(body: unknown) {
        out.body = body;
      },
    };
    return { res, out };
  }

  function fakeReq(method: string, url: string, headers: Record<string, string>, raw: string) {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
    return {
      method,
      url,
      originalUrl: url,
      headers: lower,
      async *[Symbol.asyncIterator]() {
        if (raw) yield new TextEncoder().encode(raw);
      },
    } as Record<string, unknown> & { method: string; url: string; headers: Record<string, string> };
  }

  function run(mw: ReturnType<typeof expressRequireRegistered>, req: ReturnType<typeof fakeReq>) {
    const { res, out } = fakeRes();
    return new Promise<{ passed: boolean; out: typeof out }>((resolve, reject) => {
      mw(req, res, (err?: unknown) => (err ? reject(err) : resolve({ passed: true, out })));
      const poll = setInterval(() => {
        if (out.body !== undefined) {
          clearInterval(poll);
          resolve({ passed: false, out });
        }
      }, 5);
    });
  }

  it('refuses unsigned requests and passes signed ones, keeping the body readable', async () => {
    const mw = expressRequireRegistered({ baseUrl: api.baseUrl });
    const refused = await run(mw, fakeReq('POST', '/tasks?x=1', { 'Content-Type': 'application/json' }, '{"a":1}'));
    expect(refused.passed).toBe(false);
    expect(refused.out.status).toBe(428);

    const raw = JSON.stringify({ task: 'review' });
    const headers = { ...(await caller.identity!.signRequest('POST', '/tasks', raw)), 'Content-Type': 'application/json' };
    const req = fakeReq('POST', '/tasks?x=1', headers, raw);
    const passed = await run(mw, req);
    expect(passed.passed).toBe(true);
    expect((req.ansCaller as VerifiedCaller).id).toBe(callerReg.agent.id);
    expect(req.body).toEqual({ task: 'review' });
    expect(req.rawBody).toBe(raw);
  });
});
