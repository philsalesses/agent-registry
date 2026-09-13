import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildInvokeForwardMessage, generateKeypair, signMessage, toBase64 } from 'ans-core';
import { getRegistryKeys, signRegistry } from '../../api/src/lib/registry-keys';
import { serve, type InvokeRequest } from '../src';
import { startApi, type TestApi } from './helpers';

interface Forward {
  receiptId?: string;
  timestamp?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

async function keypair() {
  const pair = await generateKeypair();
  return { publicKey: toBase64(pair.publicKey), privateKey: toBase64(pair.privateKey) };
}

/** A forward exactly as the registry builds it (lib/offers callProvider) */
async function forward(sign: (message: string) => Promise<string>, f: Forward = {}): Promise<Request> {
  const receiptId = f.receiptId ?? 'rc_TestForward0001';
  const body = JSON.stringify(
    f.body ?? {
      receiptId,
      offer: '@sdk-provider/word-count@1',
      input: { text: 'one two three' },
      caller: { id: 'ag_CallerCallerCall', handle: 'sdk-caller', trust: 50 },
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    },
  );
  const timestamp = f.timestamp ?? String(Date.now());
  const signature = await sign(buildInvokeForwardMessage({ receiptId, timestamp, body }));
  return new Request('http://provider.test/ans/word-count', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-ANS-Receipt': receiptId, 'X-ANS-Caller': 'ag_CallerCallerCall', 'X-ANS-Timestamp': timestamp, 'X-ANS-Signature': signature, ...(f.headers ?? {}) },
    body,
  });
}

const wordCount = (req: InvokeRequest<{ text: string }>) => ({ words: req.input.text.split(/\s+/).filter(Boolean).length, caller: req.caller.handle, offer: req.offer });

describe('serve() with pinned registry keys', () => {
  it('runs the handler for a correctly signed forward and returns its JSON', async () => {
    const registry = await keypair();
    const seen: InvokeRequest<{ text: string }>[] = [];
    const handle = serve<{ text: string }>((req) => {
      seen.push(req);
      return wordCount(req);
    }, { registryKeys: [{ kid: 'reg-test', publicKey: registry.publicKey }] });

    const res = await handle(await forward((m) => signMessage(registry.privateKey, m)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ words: 3, caller: 'sdk-caller', offer: '@sdk-provider/word-count@1' });
    expect(seen).toHaveLength(1);
    expect(seen[0].receiptId).toBe('rc_TestForward0001');
    expect(seen[0].caller).toEqual({ id: 'ag_CallerCallerCall', handle: 'sdk-caller', trust: 50 });
    expect(seen[0].probe).toBe(false);
  });

  it('rejects a bad signature without calling the handler', async () => {
    const registry = await keypair();
    const impostor = await keypair();
    let calls = 0;
    const handle = serve(() => {
      calls++;
      return { ok: true };
    }, { registryKeys: [registry.publicKey] });

    const forged = await handle(await forward((m) => signMessage(impostor.privateKey, m)));
    expect(forged.status).toBe(401);
    expect(await forged.json()).toMatchObject({ error: 'invalid_signature' });

    // A valid signature over a different body does not carry over
    const good = await forward((m) => signMessage(registry.privateKey, m));
    const tampered = new Request(good.url, { method: 'POST', headers: good.headers, body: (await good.text()).replace('three', 'four') });
    expect((await handle(tampered)).status).toBe(401);

    const unsigned = await handle(new Request('http://provider.test/', { method: 'POST', body: '{}' }));
    expect(unsigned.status).toBe(401);
    expect(calls).toBe(0);
  });

  it('rejects stale timestamps, mismatched receipt ids and non-POST requests', async () => {
    const registry = await keypair();
    const handle = serve(() => ({ ok: true }), { registryKeys: [registry.publicKey] });
    const sign = (m: string) => signMessage(registry.privateKey, m);

    const stale = await handle(await forward(sign, { timestamp: String(Date.now() - 6 * 60 * 1000) }));
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ error: 'timestamp_skew' });

    const mismatch = await handle(await forward(sign, { receiptId: 'rc_HeaderReceipt01', body: { receiptId: 'rc_OtherReceipt001', input: {} } }));
    expect(mismatch.status).toBe(400);

    expect((await handle(new Request('http://provider.test/', { method: 'GET' }))).status).toBe(405);
  });

  it('answers 500 without leaking the error when the handler throws, and passes a returned Response through', async () => {
    const registry = await keypair();
    const errors: unknown[] = [];
    const failing = serve(() => {
      throw new Error('database password is hunter2');
    }, { registryKeys: [registry.publicKey], onError: (e) => errors.push(e) });
    const res = await failing(await forward((m) => signMessage(registry.privateKey, m)));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('hunter2');
    expect(errors).toHaveLength(1);

    const custom = serve(() => new Response('{"queued":true}', { status: 202, headers: { 'content-type': 'application/json' } }), { registryKeys: [registry.publicKey] });
    const passthrough = await custom(await forward((m) => signMessage(registry.privateKey, m)));
    expect(passthrough.status).toBe(202);
  });
});

describe('serve() with keys from /.well-known/ans.json', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await startApi();
  });

  afterAll(async () => {
    await api?.close();
  });

  it('verifies a forward signed by the registry key it publishes', async () => {
    let fetches = 0;
    const counting = (input: string, init?: RequestInit) => {
      fetches++;
      return fetch(input, init);
    };
    const handle = serve<{ text: string }>(wordCount, { registryKeysUrl: `${api.baseUrl}/.well-known/ans.json`, fetch: counting });
    const { kid } = await getRegistryKeys();

    const first = await handle(await forward(signRegistry, { headers: { 'X-ANS-Registry-Key-Id': kid } }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ words: 3 });
    const second = await handle(await forward(signRegistry));
    expect(second.status).toBe(200);
    expect(fetches).toBe(1); // cached

    const impostor = await keypair();
    const forged = await handle(await forward((m) => signMessage(impostor.privateKey, m)));
    expect(forged.status).toBe(401);
    expect(fetches).toBe(2); // refetched once after the failed verification
  });

  it('answers 503 when the registry keys cannot be loaded', async () => {
    const handle = serve(() => ({ ok: true }), { registryKeysUrl: 'http://127.0.0.1:1/.well-known/ans.json' });
    const registry = await keypair();
    const res = await handle(await forward((m) => signMessage(registry.privateKey, m)));
    expect(res.status).toBe(503);
  });
});
