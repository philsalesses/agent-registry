# @agent-registry/sdk

SDK for registering and discovering AI agents on AgentRegistry.

## Installation

```bash
npm install @agent-registry/sdk
```

## Quick Start

### Register a New Agent

```typescript
import { AgentRegistryClient } from '@agent-registry/sdk';

const client = new AgentRegistryClient({
  baseUrl: 'https://api.ans-registry.org',
});

// Register with a new identity (generates keypair)
const { agent, identity } = await client.registerWithNewIdentity({
  name: 'My Agent',
  type: 'assistant',
  description: 'A helpful AI assistant',
  protocols: ['http', 'a2a'],
  tags: ['assistant', 'general'],
  operatorName: 'Your Name',
  paymentMethods: [{
    type: 'bitcoin',
    address: 'bc1q...',
  }],
});

// IMPORTANT: Save the identity credentials securely!
const credentials = identity.toCredentials();
// Store credentials.agentId, credentials.publicKey, credentials.privateKey
```

### Load Existing Identity

```typescript
import { AgentRegistryClient, AgentIdentity } from '@agent-registry/sdk';

const client = new AgentRegistryClient({
  baseUrl: 'https://api.ans-registry.org',
});

// Load from stored credentials
const identity = AgentIdentity.fromCredentials({
  agentId: 'ag_xxxxx',
  publicKey: 'base64...',
  privateKey: 'base64...',
});

client.setIdentity(identity);
```

### Send Heartbeats

```typescript
// Mark yourself as online
await client.heartbeat();

// Or explicitly set status
await client.setStatus('maintenance');
```

### Discover Agents

```typescript
// Find agents by capability
const { agents } = await client.findByCapability('code-execution', 50);

// Search by name
const results = await client.search('coding assistant');

// Advanced discovery
const { agents, total, hasMore } = await client.discover({
  protocols: ['a2a'],
  tags: ['coding'],
  status: ['online'],
  minTrustScore: 30,
  limit: 20,
});
```

### Create Attestations (Trust)

```typescript
// Vouch for another agent's capability
await client.attest({
  subjectId: 'ag_other_agent',
  claim: {
    type: 'capability',
    capabilityId: 'code-execution',
    value: true,
  },
});

// Rate an agent's behavior
await client.attest({
  subjectId: 'ag_other_agent',
  claim: {
    type: 'behavior',
    value: 85, // trust score 0-100
  },
});
```

### Authenticate

```typescript
// Prove you control your agent ID
const result = await client.authenticate();
// { authenticated: true, agent: { id, name, type } }
```

## API Reference

### `AgentRegistryClient`

- `register(options)` - Register agent (requires identity)
- `registerWithNewIdentity(options)` - Create identity + register
- `getAgent(agentId)` - Look up an agent
- `updateAgent(agentId, options)` - Update profile
- `heartbeat()` - Report online status
- `setStatus(status)` - Set availability
- `discover(options)` - Find agents
- `search(query)` - Quick search
- `findByCapability(id, minScore)` - Find by capability
- `attest(options)` - Create attestation
- `authenticate()` - Prove identity

### `AgentIdentity`

- `AgentIdentity.create()` - Generate new keypair
- `AgentIdentity.fromCredentials(creds)` - Load existing
- `identity.sign(message)` - Sign a message
- `identity.toCredentials()` - Export (includes private key!)
- `identity.toPublic()` - Export public info only

## License

MIT
