import { fromBase64, toBase64, toBase64Url, sign, verify, randomBytes, utf8ToBytes } from './crypto';
import { canonicalize, sha256hex } from './canonical';

export type SignedRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface RequestMessageInput {
  method: string;
  pathname: string;
  timestamp: string | number;
  /** Raw body text exactly as sent, or empty string / undefined when there is no body */
  body?: string | null;
}

/**
 * The string an agent signs for a signed API request:
 * `${METHOD}:${pathname}:${timestamp}:${rawBodyText}`
 * This matches verifyAgentRequest in the API and the SDK client.
 */
export function buildRequestMessage(input: RequestMessageInput): string {
  const method = input.method.toUpperCase();
  const body = input.body ?? '';
  return `${method}:${input.pathname}:${String(input.timestamp)}:${body}`;
}

export interface SignedRequestHeaders {
  'X-Agent-Id'?: string;
  'X-Agent-Timestamp': string;
  'X-Agent-Nonce': string;
  'X-Agent-Signature': string;
}

export interface SignRequestOptions {
  method: string;
  pathname: string;
  /** Raw body text exactly as it will be sent; omit or '' for no body */
  body?: string | null;
  /** Included as X-Agent-Id when provided */
  agentId?: string;
  /** Override the timestamp (unix ms); defaults to Date.now() */
  timestamp?: number;
  /** Override the nonce; defaults to base64url of 16 random bytes */
  nonce?: string;
}

/**
 * Produce the signed-request headers for an API call.
 * The caller adds X-Agent-Id (or passes agentId here).
 */
export async function signRequest(
  identityPrivateKeyBase64: string,
  options: SignRequestOptions
): Promise<SignedRequestHeaders> {
  const timestamp = String(options.timestamp ?? Date.now());
  const nonce = options.nonce ?? generateNonce();
  const message = buildRequestMessage({
    method: options.method,
    pathname: options.pathname,
    timestamp,
    body: options.body,
  });
  const signature = await signMessage(identityPrivateKeyBase64, message);
  const headers: SignedRequestHeaders = {
    'X-Agent-Timestamp': timestamp,
    'X-Agent-Nonce': nonce,
    'X-Agent-Signature': signature,
  };
  if (options.agentId) headers['X-Agent-Id'] = options.agentId;
  return headers;
}

/**
 * Verify a request signature (base64 Ed25519 over the message) against a base64 public key
 */
export async function verifyRequestSignature(
  publicKeyBase64: string,
  message: string,
  signatureBase64: string
): Promise<boolean> {
  try {
    const publicKey = fromBase64(publicKeyBase64);
    const signature = fromBase64(signatureBase64);
    return await verify(signature, utf8ToBytes(message), publicKey);
  } catch {
    return false;
  }
}

/**
 * Sign an arbitrary UTF-8 message with a base64 private key; returns base64 signature
 */
export async function signMessage(privateKeyBase64: string, message: string): Promise<string> {
  const privateKey = fromBase64(privateKeyBase64);
  const signature = await sign(utf8ToBytes(message), privateKey);
  return toBase64(signature);
}

/**
 * Verify a base64 signature over a UTF-8 message with a base64 public key
 */
export async function verifyMessage(
  publicKeyBase64: string,
  message: string,
  signatureBase64: string
): Promise<boolean> {
  return verifyRequestSignature(publicKeyBase64, message, signatureBase64);
}

/**
 * base64url of 16 random bytes
 */
export function generateNonce(): string {
  return toBase64Url(randomBytes(16));
}

export const REGISTRATION_MESSAGE_PREFIX = 'register:';

/**
 * Registration proof of possession: the registrant signs
 * 'register:' + sha256hex(canonicalize(body without its `signature` field)).
 */
export function buildRegistrationMessage(body: Record<string, unknown>): string {
  const { signature: _signature, ...rest } = body;
  return REGISTRATION_MESSAGE_PREFIX + sha256hex(canonicalize(rest));
}

/**
 * Sign a registration body; returns the base64 signature to place in body.signature
 */
export async function signRegistration(
  privateKeyBase64: string,
  body: Record<string, unknown>
): Promise<string> {
  return signMessage(privateKeyBase64, buildRegistrationMessage(body));
}

/**
 * Verify the proof of possession on a registration body (body.publicKey, body.signature)
 */
export async function verifyRegistration(body: Record<string, unknown>): Promise<boolean> {
  const publicKey = body.publicKey;
  const signature = body.signature;
  if (typeof publicKey !== 'string' || typeof signature !== 'string') return false;
  return verifyRequestSignature(publicKey, buildRegistrationMessage(body), signature);
}
