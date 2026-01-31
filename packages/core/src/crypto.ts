import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// Configure ed25519 to use sha512
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));

/**
 * Generate a new Ed25519 keypair for agent identity
 */
export async function generateKeypair(): Promise<{
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

/**
 * Sign a message with a private key
 */
export async function sign(
  message: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  return ed25519.signAsync(message, privateKey);
}

/**
 * Verify a signature
 */
export async function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    return await ed25519.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Encode bytes to base64
 */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Decode base64 to bytes
 */
export function fromBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

/**
 * Generate a random ID with prefix
 */
export function generateId(prefix: string, length: number = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomBytes = crypto.getRandomValues(new Uint8Array(length));
  let result = prefix;
  for (const byte of randomBytes) {
    result += chars[byte % chars.length];
  }
  return result;
}

/**
 * Hash data using SHA-512
 */
export function hash(data: Uint8Array): Uint8Array {
  return sha512(data);
}
