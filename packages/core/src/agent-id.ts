import { generateKeypair, toBase64, fromBase64, sign, verify, generateId } from './crypto';
import type { AgentId } from './types';

export interface AgentKeyPair {
  agentId: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Generate a new agent identity with keypair
 */
export async function createAgentIdentity(
  name: string,
  type: AgentId['type'] = 'assistant'
): Promise<{ agent: Omit<AgentId, 'createdAt'>; keypair: AgentKeyPair }> {
  const { privateKey, publicKey } = await generateKeypair();
  const agentId = generateId('ag_', 16);

  return {
    agent: {
      id: agentId,
      name,
      publicKey: toBase64(publicKey),
      type,
    },
    keypair: {
      agentId,
      publicKey: toBase64(publicKey),
      privateKey: toBase64(privateKey),
    },
  };
}

/**
 * Sign a message as an agent
 */
export async function signAsAgent(
  message: string,
  privateKeyBase64: string
): Promise<string> {
  const privateKey = fromBase64(privateKeyBase64);
  const messageBytes = new TextEncoder().encode(message);
  const signature = await sign(messageBytes, privateKey);
  return toBase64(signature);
}

/**
 * Verify a message signature from an agent
 */
export async function verifyAgentSignature(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string
): Promise<boolean> {
  const publicKey = fromBase64(publicKeyBase64);
  const signature = fromBase64(signatureBase64);
  const messageBytes = new TextEncoder().encode(message);
  return verify(signature, messageBytes, publicKey);
}

/**
 * Create a signed attestation payload
 */
export async function createSignedAttestation(
  attesterId: string,
  subjectId: string,
  claim: { type: 'capability' | 'identity' | 'behavior'; capabilityId?: string; value: boolean | number | string },
  privateKeyBase64: string
): Promise<{ attestation: object; signature: string }> {
  const attestation = {
    id: generateId('att_', 16),
    attesterId,
    subjectId,
    claim,
    createdAt: new Date().toISOString(),
  };

  const message = JSON.stringify(attestation);
  const signature = await signAsAgent(message, privateKeyBase64);

  return { attestation, signature };
}
