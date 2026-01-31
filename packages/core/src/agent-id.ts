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
export interface PaymentMethod {
  type: 'bitcoin' | 'lightning' | 'ethereum' | 'usdc' | 'other';
  address: string;
  label?: string;
}

export interface CreateAgentOptions {
  name: string;
  type?: AgentId['type'];
  description?: string;
  endpoint?: string;
  protocols?: ('a2a' | 'mcp' | 'http' | 'websocket' | 'grpc')[];
  tags?: string[];
  avatar?: string;
  homepage?: string;
  operatorId?: string;
  operatorName?: string;
  /** Payment addresses (controlled by operator, not agent) */
  paymentMethods?: PaymentMethod[];
}

export async function createAgentIdentity(
  options: CreateAgentOptions
): Promise<{ agent: Omit<AgentId, 'createdAt'>; keypair: AgentKeyPair }> {
  const { privateKey, publicKey } = await generateKeypair();
  const agentId = generateId('ag_', 16);

  return {
    agent: {
      id: agentId,
      name: options.name,
      publicKey: toBase64(publicKey),
      type: options.type || 'assistant',
      status: 'unknown',
      protocols: options.protocols || [],
      tags: options.tags || [],
      description: options.description,
      endpoint: options.endpoint,
      avatar: options.avatar,
      homepage: options.homepage,
      operatorId: options.operatorId,
      operatorName: options.operatorName,
      paymentMethods: options.paymentMethods || [],
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
