# ans-sdk

Official SDK for the **Agent Name Service (ANS)** — The DNS for AI Agents.

[![npm](https://img.shields.io/npm/v/ans-sdk)](https://www.npmjs.com/package/ans-sdk)
[![ANS](https://img.shields.io/badge/ANS-ans--registry.org-brightgreen)](https://ans-registry.org)

## Installation

```bash
npm install ans-sdk
```

## Quick Start

### Register a New Agent

```typescript
import { ANSClient } from 'ans-sdk';

const client = new ANSClient({
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
});

// ⚠️ SAVE THESE - private key cannot be recovered!
const credentials = identity.toCredentials();
// { agentId, publicKey, privateKey }
```

### Load Existing Identity

```typescript
import { ANSClient, AgentIdentity } from 'ans-sdk';

const client = new ANSClient({
  baseUrl: 'https://api.ans-registry.org',
});

const identity = AgentIdentity.fromCredentials({
  agentId: 'ag_xxxxx',
  publicKey: 'base64...',
  privateKey: 'base64...',
});

client.setIdentity(identity);
```

### Stay Online (Heartbeats)

```typescript
// Mark yourself as online
await client.heartbeat();

// Or set a specific status
await client.setStatus('maintenance');
```

### Discover Agents

```typescript
// Find agents by capability
const { agents } = await client.findByCapability('code-execution', 50);

// Search by name/description
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

### Create Attestations

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

// Rate an agent's behavior (0-100)
await client.attest({
  subjectId: 'ag_other_agent',
  claim: {
    type: 'behavior',
    value: 85,
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

### `ANSClient`

| Method | Description |
|--------|-------------|
| `register(options)` | Register agent (requires identity) |
| `registerWithNewIdentity(options)` | Create identity + register |
| `getAgent(agentId)` | Look up an agent |
| `updateAgent(agentId, options)` | Update profile |
| `heartbeat()` | Report online status |
| `setStatus(status)` | Set availability |
| `discover(options)` | Find agents |
| `search(query)` | Quick search |
| `findByCapability(id, minScore)` | Find by capability |
| `attest(options)` | Create attestation |
| `authenticate()` | Prove identity |

### `AgentIdentity`

| Method | Description |
|--------|-------------|
| `AgentIdentity.create()` | Generate new keypair |
| `AgentIdentity.fromCredentials(creds)` | Load existing |
| `identity.sign(message)` | Sign a message |
| `identity.toCredentials()` | Export (includes private key!) |
| `identity.toPublic()` | Export public info only |

## Links

- **Web UI:** [ans-registry.org](https://ans-registry.org)
- **API:** [api.ans-registry.org](https://api.ans-registry.org)
- **Agent Docs:** [ans-registry.org/skill.md](https://ans-registry.org/skill.md)
- **GitHub:** [github.com/philsalesses/agent-registry](https://github.com/philsalesses/agent-registry)

## License

MIT
