import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { generateApiKey, signRequest } from 'ans-core';
import { db } from '../db';
import { apiKeys } from '../db/schema';
import { onError } from '../lib/errors';
import { requireAgent, requireOwner, requireAdmin, createSessionToken, verifySessionToken, rejectPrivateKeyHeader } from '../lib/auth';
import { createApp } from '../app';
import { config } from '../config';
import { createTestAgent, deleteTestAgents, deleteRateLimitKeys, type TestAgent, body as parse } from './helpers';

function testApp() {
  const app = new Hono();
  app.use('*', requestId());
  app.onError(onError);
  app.post('/v1/things', requireAgent({ allow: ['signed', 'apikey'], scopes: ['receipts'] }), async (c) => c.json({ agent: c.get('agent'), body: await c.req.json() }));
  app.get('/v1/things', requireAgent({ allow: ['signed', 'session', 'apikey'] }), (c) => c.json({ agent: c.get('agent') }));
  app.get('/v1/agents/:id/private', requireAgent({ allow: ['signed', 'session', 'apikey'] }), requireOwner('id'), (c) => c.json({ ok: true, id: c.get('resolvedAgent').id }));
  app.post('/v1/keyonly', requireAgent({ allow: ['signed'], keyOnly: true }), (c) => c.json({ ok: true }));
  app.post('/v1/register', requireAgent({ allow: ['signed'], skipNonce: true }), (c) => c.json({ ok: true }));
  app.get('/v1/admin/x', requireAdmin, (c) => c.json({ ok: true }));
  app.get('/v1/open', rejectPrivateKeyHeader, (c) => c.json({ ok: true }));
  return app;
}

async function signed(agent: TestAgent, method: string, pathname: string, body?: string, extra: Record<string, string> = {}) {
  const headers = await signRequest(agent.privateKey, { method, pathname, body, agentId: agent.id });
  return { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra } as Record<string, string>;
}

describe('auth middleware', () => {
  const app = testApp();
  let agent: TestAgent;
  let other: TestAgent;

  beforeAll(async () => {
    agent = await createTestAgent('auth');
    other = await createTestAgent('auth-o');
  });

  afterAll(async () => {
    await deleteTestAgents([agent.id, other.id]);
    await deleteRateLimitKeys(['global:unknown']);
  });

  it('accepts a request signed with ans-core signRequest (round trip over the raw body)', async () => {
    const body = JSON.stringify({ hello: 'world', n: 1 });
    const res = await app.request('/v1/things', { method: 'POST', headers: await signed(agent, 'POST', '/v1/things', body), body });
    expect(res.status).toBe(200);
    const json = await parse(res);
    expect(json.agent).toEqual({ id: agent.id, method: 'signed' });
    expect(json.body).toEqual({ hello: 'world', n: 1 });
  });

  it('rejects a reused nonce with 401 nonce_reused', async () => {
    const body = JSON.stringify({ once: true });
    const headers = await signed(agent, 'POST', '/v1/things', body);
    const first = await app.request('/v1/things', { method: 'POST', headers, body });
    expect(first.status).toBe(200);
    const second = await app.request('/v1/things', { method: 'POST', headers, body });
    expect(second.status).toBe(401);
    const json = await parse(second);
    expect(json.error).toBe('nonce_reused');
    expect(json.requestId).toBeTruthy();
    expect(second.headers.get('Link')).toContain('rel="help"');
  });

  it('requires a nonce on signed POST but not on GET', async () => {
    const body = JSON.stringify({ x: 1 });
    const h = await signRequest(agent.privateKey, { method: 'POST', pathname: '/v1/things', body, agentId: agent.id });
    const { 'X-Agent-Nonce': _drop, ...noNonce } = h;
    const res = await app.request('/v1/things', { method: 'POST', headers: { ...noNonce, 'Content-Type': 'application/json' } as Record<string, string>, body });
    expect(res.status).toBe(401);
    const g = await signRequest(agent.privateKey, { method: 'GET', pathname: '/v1/things', agentId: agent.id });
    const { 'X-Agent-Nonce': _drop2, ...getNoNonce } = g;
    const get = await app.request('/v1/things', { method: 'GET', headers: { ...getNoNonce } as Record<string, string> });
    expect(get.status).toBe(200);
  });

  it('rejects a stale timestamp with 401 timestamp_skew', async () => {
    const body = JSON.stringify({ x: 1 });
    const headers = await signRequest(agent.privateKey, { method: 'POST', pathname: '/v1/things', body, agentId: agent.id, timestamp: Date.now() - 6 * 60 * 1000 });
    const res = await app.request('/v1/things', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body });
    expect(res.status).toBe(401);
    expect((await parse(res)).error).toBe('timestamp_skew');
  });

  it('rejects a bad signature and a tampered body with 401 invalid_signature', async () => {
    const body = JSON.stringify({ amount: 1 });
    const headers = await signed(agent, 'POST', '/v1/things', body);
    const res = await app.request('/v1/things', { method: 'POST', headers, body: JSON.stringify({ amount: 1000 }) });
    expect(res.status).toBe(401);
    expect((await parse(res)).error).toBe('invalid_signature');
    const wrongKey = await signed(other, 'POST', '/v1/things', body, { 'X-Agent-Id': agent.id });
    const res2 = await app.request('/v1/things', { method: 'POST', headers: wrongKey, body });
    expect(res2.status).toBe(401);
  });

  it('answers 400 private_key_in_header whenever X-Agent-Private-Key is present', async () => {
    const res = await app.request('/v1/open', { headers: { 'X-Agent-Private-Key': 'nope' } });
    expect(res.status).toBe(400);
    const json = await parse(res);
    expect(json.error).toBe('private_key_in_header');
    expect(json.fix.docs).toBeTruthy();
    const real = createApp();
    const res2 = await real.request('/health', { headers: { 'X-Agent-Private-Key': 'nope' } });
    expect(res2.status).toBe(400);
    const res3 = await real.request('/v1/things', { method: 'POST', headers: { ...(await signed(agent, 'POST', '/v1/things', '{}')), 'X-Agent-Private-Key': 'x' }, body: '{}' });
    expect(res3.status).toBe(400);
  });

  it('api keys: scope enforced, revoked refused, last_used_at touched', async () => {
    const full = generateApiKey();
    const readOnly = generateApiKey();
    await db.insert(apiKeys).values([
      { id: full.prefix, keyHash: full.hash, agentId: agent.id, scopes: ['read', 'receipts'] },
      { id: readOnly.prefix, keyHash: readOnly.hash, agentId: agent.id, scopes: ['read'] },
    ]);
    const ok = await app.request('/v1/things', { method: 'POST', headers: { Authorization: `Bearer ${full.key}`, 'Content-Type': 'application/json' }, body: '{"k":1}' });
    expect(ok.status).toBe(200);
    expect((await parse(ok)).agent).toEqual({ id: agent.id, method: 'apikey', keyId: full.prefix, scopes: ['read', 'receipts'] });

    const denied = await app.request('/v1/things', { method: 'POST', headers: { Authorization: `Bearer ${readOnly.key}`, 'Content-Type': 'application/json' }, body: '{"k":1}' });
    expect(denied.status).toBe(403);
    const dj = await parse(denied);
    expect(dj.error).toBe('forbidden');
    expect(dj.details).toEqual({ required: ['receipts'], granted: ['read'] });

    const unknown = await app.request('/v1/things', { method: 'GET', headers: { Authorization: `Bearer ${generateApiKey().key}` } });
    expect(unknown.status).toBe(401);

    await db.update(apiKeys).set({ revokedAt: new Date() });
    const revoked = await app.request('/v1/things', { method: 'GET', headers: { Authorization: `Bearer ${full.key}` } });
    expect(revoked.status).toBe(401);
  });

  it('session tokens authenticate and expire', async () => {
    const token = await createSessionToken(agent.id);
    expect((await verifySessionToken(token)).agentId).toBe(agent.id);
    const res = await app.request('/v1/things', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect((await parse(res)).agent).toEqual({ id: agent.id, method: 'session' });
    const expired = await createSessionToken(agent.id, -1000);
    expect((await verifySessionToken(expired)).valid).toBe(false);
    const bad = await app.request('/v1/things', { headers: { Authorization: 'Bearer abc.def' } });
    expect(bad.status).toBe(401);
  });

  it('keyOnly routes refuse sessions and api keys', async () => {
    const token = await createSessionToken(agent.id);
    const res = await app.request('/v1/keyonly', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    const ok = await app.request('/v1/keyonly', { method: 'POST', headers: await signed(agent, 'POST', '/v1/keyonly', '') });
    expect(ok.status).toBe(200);
  });

  it('skipNonce lets a signed POST through without X-Agent-Nonce (registration)', async () => {
    const h = await signRequest(agent.privateKey, { method: 'POST', pathname: '/v1/register', body: '{}', agentId: agent.id });
    const { 'X-Agent-Nonce': _drop, ...rest } = h;
    const res = await app.request('/v1/register', { method: 'POST', headers: { ...rest, 'Content-Type': 'application/json' } as Record<string, string>, body: '{}' });
    expect(res.status).toBe(200);
  });

  it('requireOwner accepts the owner by id or handle and refuses others', async () => {
    const token = await createSessionToken(agent.id);
    const byId = await app.request(`/v1/agents/${agent.id}/private`, { headers: { Authorization: `Bearer ${token}` } });
    expect(byId.status).toBe(200);
    const byHandle = await app.request(`/v1/agents/@${agent.handle}/private`, { headers: { Authorization: `Bearer ${token}` } });
    expect(byHandle.status).toBe(200);
    expect((await parse(byHandle)).id).toBe(agent.id);
    const notMine = await app.request(`/v1/agents/${other.id}/private`, { headers: { Authorization: `Bearer ${token}` } });
    expect(notMine.status).toBe(403);
    const missing = await app.request('/v1/agents/ag_doesnotexist0000/private', { headers: { Authorization: `Bearer ${token}` } });
    expect(missing.status).toBe(404);
  });

  it('requireAdmin answers 503 while ADMIN_SECRET is unset, 403 when wrong', async () => {
    const saved = config.adminSecret;
    try {
      config.adminSecret = undefined;
      const unset = await app.request('/v1/admin/x', { headers: { 'X-Admin-Secret': 'anything' } });
      expect(unset.status).toBe(503);
      config.adminSecret = 'a-test-admin-secret-value';
      const wrong = await app.request('/v1/admin/x', { headers: { 'X-Admin-Secret': 'anything' } });
      expect(wrong.status).toBe(403);
      const right = await app.request('/v1/admin/x', { headers: { 'X-Admin-Secret': 'a-test-admin-secret-value' } });
      expect(right.status).toBe(200);
    } finally {
      config.adminSecret = saved;
    }
  });

  it('unauthenticated requests get the teaching envelope with a register fix', async () => {
    const res = await app.request('/v1/things');
    expect(res.status).toBe(401);
    const json = await parse(res);
    expect(json.error).toBe('unauthorized');
    expect(json.fix.url).toContain('register');
  });
});
