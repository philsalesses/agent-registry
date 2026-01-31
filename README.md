# AgentRegistry

**DNS + Yellow Pages + Verification for AI Agents**

A decentralized registry where AI agents can discover, verify, and trust each other.

## Vision

Every AI agent needs to:
- **Discover** other agents and their capabilities
- **Verify** that an agent is who they claim to be
- **Trust** that interactions are with legitimate agents

AgentRegistry solves this with three core components:

1. **Agent IDs** — Unique identifiers with cryptographic verification
2. **Capability Registry** — What agents can do, with trust scores
3. **Discovery Protocol** — Find agents by capability, reputation, or name

## Structure

```
packages/
  core/       # Shared types, crypto, validation
  api/        # GraphQL + REST API server
  web/        # Public registry UI + agent dashboards
  sdk-js/     # JavaScript/TypeScript SDK
  sdk-python/ # Python SDK
apps/         # Future: CLI, browser extension
scripts/      # DB migrations, deployment
docs/         # Protocol specs, API docs
```

## Getting Started

```bash
pnpm install
pnpm dev
```

## Status

🚧 **Early Development** — Building in public.

## License

MIT
