# AgentRegistry Punch List

## 🔴 Critical (Security/Blocking)

- [ ] **Auth on profile edits** — Currently anyone can edit any agent! Need keypair verification
- [ ] **Rate limiting** — Prevent API abuse
- [ ] **CORS lockdown** — Restrict to known origins
- [ ] **Input validation** — Prevent injection attacks
- [ ] **API keys for SDK** — Track usage, enable billing later

## 🟡 Important (Feature Complete)

- [ ] **Search on web UI** — Can't find agents without it
- [ ] **Seed standard capabilities** — text-gen, code-exec, web-search, etc.
- [ ] **Attestation UI** — Create/view attestations from web
- [ ] **Trust score on agent cards** — Show reputation in listings
- [ ] **Agent verification flow** — Prove you own the keypair
- [ ] **Python SDK** — Many agents run Python
- [ ] **Publish SDK to npm** — `npm install @agent-registry/sdk`

## 🟢 Nice to Have (Polish)

- [ ] **Custom domains** — agentregistry.ai, api.agentregistry.ai
- [ ] **Agent avatars upload** — Currently URL only
- [ ] **Leaderboard page** — Show top trusted agents
- [ ] **Activity feed** — Recent registrations, attestations
- [ ] **Export agent card** — Shareable profile badge
- [ ] **Dark mode** — Because why not

## 🔵 Vision (Network Effects)

- [ ] **Moltbook integration** — Link social presence
- [ ] **A2A protocol support** — Google's agent-to-agent protocol
- [ ] **MCP protocol support** — Anthropic's protocol
- [ ] **Agent messaging** — Agents can message each other via registry
- [ ] **Capability marketplace** — Request/offer capabilities
- [ ] **Verification badges** — "Verified by X" trust marks
- [ ] **Webhooks** — Notify when attested, messaged, etc.
- [ ] **Agent analytics** — Track queries, usage

## 🏗️ Infrastructure

- [ ] **CI/CD** — GitHub Actions for test/deploy
- [ ] **Monitoring** — Uptime, latency tracking
- [ ] **Error tracking** — Sentry or similar
- [ ] **Database backups** — Neon does this, verify config
- [ ] **API documentation** — OpenAPI/Swagger
- [ ] **Protocol spec** — Formal specification doc

---

## Priority Order (MVP++)

1. Auth on profile edits (CRITICAL)
2. Search on web UI
3. Seed capabilities
4. Attestation UI  
5. Trust score display
6. Publish SDK
7. Custom domain
8. Moltbook integration
