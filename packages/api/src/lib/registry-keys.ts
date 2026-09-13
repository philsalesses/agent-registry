import { generateKeypair, toBase64, fromBase64, sha256hex, signMessage, verifyMessage } from 'ans-core';
import { config } from '../config';

/**
 * The registry's own Ed25519 keypair. Used to sign invoke forwards
 * (X-ANS-Signature) and published at /.well-known/ans.json as registryKeys.
 */
export interface RegistryKeys {
  kid: string;
  publicKey: string; // base64
  privateKey: string; // base64
}

let cached: Promise<RegistryKeys> | null = null;

function kidFor(publicKeyBase64: string): string {
  return `reg-${sha256hex(fromBase64(publicKeyBase64)).slice(0, 12)}`;
}

async function load(): Promise<RegistryKeys> {
  if (config.registryPrivateKey && config.registryPublicKey) {
    // Validate the pair by a sign/verify round trip so a misconfiguration fails at boot, not on first invoke.
    const probe = await signMessage(config.registryPrivateKey, 'ans-registry-key-probe');
    const ok = await verifyMessage(config.registryPublicKey, 'ans-registry-key-probe', probe);
    if (!ok) throw new Error('REGISTRY_PRIVATE_KEY does not match REGISTRY_PUBLIC_KEY');
    return { kid: kidFor(config.registryPublicKey), publicKey: config.registryPublicKey, privateKey: config.registryPrivateKey };
  }
  if (config.isProduction) throw new Error('registry keys are not loaded (ensureSecrets() must run before serving)');
  const pair = await generateKeypair();
  const publicKey = toBase64(pair.publicKey);
  if (process.env.ANS_QUIET !== '1') {
    console.warn(`[registry-keys] using an EPHEMERAL registry keypair (kid ${kidFor(publicKey)}); signatures will not survive a restart`);
  }
  return { kid: kidFor(publicKey), publicKey, privateKey: toBase64(pair.privateKey) };
}

export function getRegistryKeys(): Promise<RegistryKeys> {
  if (!cached) cached = load();
  return cached;
}

/** Base64 Ed25519 signature by the registry over `message`. */
export async function signRegistry(message: string): Promise<string> {
  const keys = await getRegistryKeys();
  return signMessage(keys.privateKey, message);
}

export async function verifyRegistrySignature(message: string, signatureBase64: string): Promise<boolean> {
  const keys = await getRegistryKeys();
  return verifyMessage(keys.publicKey, message, signatureBase64);
}

/** The public JSON for /.well-known/ans.json registryKeys */
export async function registryPublicJson(): Promise<{ kid: string; publicKey: string; alg: 'Ed25519' }> {
  const keys = await getRegistryKeys();
  return { kid: keys.kid, publicKey: keys.publicKey, alg: 'Ed25519' };
}
