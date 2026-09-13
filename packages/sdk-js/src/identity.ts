import * as ed25519 from '@noble/ed25519';
import {
  fromBase64,
  generateKeypair,
  hash as sha512,
  signMessage,
  signRegistration,
  signRequest as coreSignRequest,
  toBase64,
  sign as signBytes,
  verifyMessage,
  type SignedRequestHeaders,
} from 'ans-core';

// ans-core configures this when it loads; keep the SDK correct even if it did not.
if (!ed25519.etc.sha512Sync) {
  ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...messages));
}

/** Everything needed to act as an agent. Keep the private key secret. */
export interface AgentCredentials {
  agentId: string;
  /** base64 Ed25519 private key (32-byte seed) */
  privateKey: string;
  /** base64 Ed25519 public key */
  publicKey: string;
  handle?: string | null;
  /** `ak_...` API key minted at registration, if you kept it */
  apiKey?: string | null;
}

export interface AgentCredentialsInput {
  agentId: string;
  privateKey: string;
  /** Derived from the private key when omitted; checked against it when given */
  publicKey?: string;
  handle?: string | null;
  apiKey?: string | null;
}

/** Standard padded base64 (accepts base64url and missing padding); null when invalid */
function normalizeBase64(value: string): string | null {
  try {
    return toBase64(fromBase64(value));
  } catch {
    return null;
  }
}

function seedFrom(privateKeyBase64: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(privateKeyBase64);
  } catch {
    throw new Error('AgentIdentity: privateKey is not valid base64');
  }
  // 64-byte secret keys (seed followed by public key) carry the seed first
  if (bytes.length === 64) bytes = bytes.slice(0, 32);
  if (bytes.length !== 32) throw new Error('AgentIdentity: privateKey must be a base64 Ed25519 key (32 bytes)');
  return bytes;
}

/**
 * An agent's Ed25519 identity. The private key lives in a private field: it is
 * never serialized by JSON.stringify or shown by console.log. Export it on
 * purpose with toCredentials().
 */
export class AgentIdentity {
  #privateKey: string;
  #publicKey: string;
  #agentId: string | null;
  #handle: string | null;
  #apiKey: string | null;

  private constructor(privateKey: string, publicKey: string, agentId: string | null, handle: string | null, apiKey: string | null) {
    this.#privateKey = privateKey;
    this.#publicKey = publicKey;
    this.#agentId = agentId;
    this.#handle = handle;
    this.#apiKey = apiKey;
  }

  /** A fresh keypair. It has no agentId until ANSClient.register() binds one. */
  static async create(): Promise<AgentIdentity> {
    const pair = await generateKeypair();
    return new AgentIdentity(toBase64(pair.privateKey), toBase64(pair.publicKey), null, null, null);
  }

  /** Load stored credentials (for example ~/.ans/credentials.json) */
  static fromCredentials(input: AgentCredentialsInput): AgentIdentity {
    if (!input || typeof input.agentId !== 'string' || input.agentId.length === 0) {
      throw new Error('AgentIdentity.fromCredentials: agentId is required');
    }
    if (typeof input.privateKey !== 'string') throw new Error('AgentIdentity.fromCredentials: privateKey is required');
    const seed = seedFrom(input.privateKey);
    const derived = toBase64(ed25519.getPublicKey(seed));
    if (input.publicKey !== undefined && normalizeBase64(input.publicKey) !== derived) {
      throw new Error('AgentIdentity.fromCredentials: publicKey does not match privateKey');
    }
    return new AgentIdentity(toBase64(seed), derived, input.agentId, input.handle ?? null, input.apiKey ?? null);
  }

  /** Verify a base64 Ed25519 signature over a UTF-8 message */
  static verify(message: string, signature: string, publicKey: string): Promise<boolean> {
    return verifyMessage(publicKey, message, signature);
  }

  /** `ag_...` once registered, otherwise null */
  get agentId(): string | null {
    return this.#agentId;
  }

  /** base64 Ed25519 public key */
  get publicKey(): string {
    return this.#publicKey;
  }

  get handle(): string | null {
    return this.#handle;
  }

  get apiKey(): string | null {
    return this.#apiKey;
  }

  /**
   * Attach the registry id (and optionally handle and API key) to this keypair.
   * ANSClient.register() calls this; an identity that already has an agentId cannot be rebound.
   */
  bind(agent: { agentId: string; handle?: string | null; apiKey?: string | null }): this {
    if (this.#agentId && this.#agentId !== agent.agentId) {
      throw new Error(`AgentIdentity: already bound to ${this.#agentId}`);
    }
    this.#agentId = agent.agentId;
    if (agent.handle !== undefined) this.#handle = agent.handle;
    if (agent.apiKey !== undefined) this.#apiKey = agent.apiKey;
    return this;
  }

  /** base64 Ed25519 signature over a UTF-8 string or raw bytes */
  async sign(message: string | Uint8Array): Promise<string> {
    if (typeof message === 'string') return signMessage(this.#privateKey, message);
    return toBase64(await signBytes(message, fromBase64(this.#privateKey)));
  }

  /**
   * Signed-request headers (X-Agent-Id, X-Agent-Timestamp, X-Agent-Nonce,
   * X-Agent-Signature) over `${METHOD}:${pathname}:${timestamp}:${body}`.
   * Pass the raw body text exactly as it will be sent ('' or omitted for none).
   */
  async signRequest(method: string, pathname: string, body?: string | null): Promise<SignedRequestHeaders & { 'X-Agent-Id': string }> {
    const agentId = this.#agentId;
    if (!agentId) throw new Error('AgentIdentity: no agentId yet; register the identity first');
    const headers = await coreSignRequest(this.#privateKey, { method, pathname, body: body ?? '', agentId });
    return { ...headers, 'X-Agent-Id': agentId };
  }

  /** The registration proof of possession (ans-core signRegistration) over a POST /v1/agents body */
  signRegistration(body: Record<string, unknown>): Promise<string> {
    return signRegistration(this.#privateKey, body);
  }

  /** Everything needed to restore this identity. Contains the private key. */
  toCredentials(): AgentCredentials {
    if (!this.#agentId) throw new Error('AgentIdentity: no agentId yet; register the identity before exporting credentials');
    const out: AgentCredentials = { agentId: this.#agentId, privateKey: this.#privateKey, publicKey: this.#publicKey };
    if (this.#handle) out.handle = this.#handle;
    if (this.#apiKey) out.apiKey = this.#apiKey;
    return out;
  }

  /** Public fields only; the private key is never serialized */
  toJSON(): { agentId: string | null; handle: string | null; publicKey: string } {
    return { agentId: this.#agentId, handle: this.#handle, publicKey: this.#publicKey };
  }
}
