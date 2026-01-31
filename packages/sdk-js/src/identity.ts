import { 
  generateKeypair, 
  toBase64, 
  fromBase64, 
  sign, 
  verify,
  generateId,
} from '@agent-registry/core';

/**
 * Manages an agent's cryptographic identity
 */
export class AgentIdentity {
  readonly agentId: string;
  readonly publicKey: string;
  private privateKey: string;

  private constructor(agentId: string, publicKey: string, privateKey: string) {
    this.agentId = agentId;
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  /**
   * Create a new agent identity with fresh keypair
   */
  static async create(): Promise<AgentIdentity> {
    const { privateKey, publicKey } = await generateKeypair();
    const agentId = generateId('ag_', 16);
    return new AgentIdentity(
      agentId,
      toBase64(publicKey),
      toBase64(privateKey)
    );
  }

  /**
   * Load an existing identity from stored credentials
   */
  static fromCredentials(credentials: {
    agentId: string;
    publicKey: string;
    privateKey: string;
  }): AgentIdentity {
    return new AgentIdentity(
      credentials.agentId,
      credentials.publicKey,
      credentials.privateKey
    );
  }

  /**
   * Sign a message with this identity
   */
  async sign(message: string): Promise<string> {
    const privateKey = fromBase64(this.privateKey);
    const messageBytes = new TextEncoder().encode(message);
    const signature = await sign(messageBytes, privateKey);
    return toBase64(signature);
  }

  /**
   * Verify a signature against a public key
   */
  static async verify(
    message: string,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    const publicKeyBytes = fromBase64(publicKey);
    const signatureBytes = fromBase64(signature);
    const messageBytes = new TextEncoder().encode(message);
    return verify(signatureBytes, messageBytes, publicKeyBytes);
  }

  /**
   * Export credentials for storage (KEEP PRIVATE KEY SAFE!)
   */
  toCredentials(): {
    agentId: string;
    publicKey: string;
    privateKey: string;
  } {
    return {
      agentId: this.agentId,
      publicKey: this.publicKey,
      privateKey: this.privateKey,
    };
  }

  /**
   * Export only public info (safe to share)
   */
  toPublic(): { agentId: string; publicKey: string } {
    return {
      agentId: this.agentId,
      publicKey: this.publicKey,
    };
  }
}
