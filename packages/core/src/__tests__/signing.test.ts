import { describe, it, expect } from 'vitest';
import { generateKeypair, toBase64 } from '../crypto';
import { signAsAgent, verifyAgentSignature } from '../agent-id';
import {
  buildRequestMessage,
  signRequest,
  verifyRequestSignature,
  buildRegistrationMessage,
  signRegistration,
  verifyRegistration,
  generateNonce,
} from '../signing';
import { sha256hex, canonicalize } from '../canonical';

describe('request signing', () => {
  it('builds the exact message the API verifies', () => {
    expect(buildRequestMessage({ method: 'post', pathname: '/v1/receipts', timestamp: 1700000000000, body: '{"a":1}' }))
      .toBe('POST:/v1/receipts:1700000000000:{"a":1}');
    expect(buildRequestMessage({ method: 'GET', pathname: '/v1/wallet', timestamp: '1' })).toBe('GET:/v1/wallet:1:');
  });

  it('round trips signRequest -> verifyRequestSignature', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const priv = toBase64(privateKey);
    const pub = toBase64(publicKey);
    const body = '{"task":"review"}';
    const headers = await signRequest(priv, { method: 'POST', pathname: '/v1/receipts', body, agentId: 'ag_x' });
    expect(headers['X-Agent-Id']).toBe('ag_x');
    expect(headers['X-Agent-Nonce']).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Number(headers['X-Agent-Timestamp'])).toBeGreaterThan(1_600_000_000_000);

    const message = buildRequestMessage({
      method: 'POST',
      pathname: '/v1/receipts',
      timestamp: headers['X-Agent-Timestamp'],
      body,
    });
    expect(await verifyRequestSignature(pub, message, headers['X-Agent-Signature'])).toBe(true);
    // the legacy helper agrees
    expect(await verifyAgentSignature(message, headers['X-Agent-Signature'], pub)).toBe(true);
    // tampered body fails
    const bad = buildRequestMessage({ method: 'POST', pathname: '/v1/receipts', timestamp: headers['X-Agent-Timestamp'], body: '{}' });
    expect(await verifyRequestSignature(pub, bad, headers['X-Agent-Signature'])).toBe(false);
    // garbage signature does not throw
    expect(await verifyRequestSignature(pub, message, '!!!')).toBe(false);
  });

  it('legacy signAsAgent output verifies with verifyRequestSignature', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const sig = await signAsAgent('hello', toBase64(privateKey));
    expect(await verifyRequestSignature(toBase64(publicKey), 'hello', sig)).toBe(true);
  });

  it('nonces are 16 random bytes base64url', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toHaveLength(22);
    expect(a).not.toBe(b);
  });
});

describe('registration proof of possession', () => {
  it('builds register: + sha256 of canonical body without signature', () => {
    const body = { name: 'A', publicKey: 'pk', type: 'assistant', signature: 'x' };
    const expected = 'register:' + sha256hex(canonicalize({ name: 'A', publicKey: 'pk', type: 'assistant' }));
    expect(buildRegistrationMessage(body)).toBe(expected);
    expect(buildRegistrationMessage({ type: 'assistant', publicKey: 'pk', name: 'A' })).toBe(expected);
  });

  it('signRegistration -> verifyRegistration round trips and rejects a swapped key', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const other = await generateKeypair();
    const body: Record<string, unknown> = { name: 'A', publicKey: toBase64(publicKey), type: 'assistant' };
    const signature = await signRegistration(toBase64(privateKey), body);
    expect(await verifyRegistration({ ...body, signature })).toBe(true);
    expect(await verifyRegistration({ ...body, publicKey: toBase64(other.publicKey), signature })).toBe(false);
    expect(await verifyRegistration({ ...body, name: 'B', signature })).toBe(false);
  });
});
