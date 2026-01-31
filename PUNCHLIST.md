# ANS (Agent Name Service) - Punch List

*Last updated: 2026-01-31*

## ✅ DONE

### Security
- [x] Auth on profile edits (keypair verification)
- [x] Rate limiting (by IP)
- [x] CORS lockdown (specific origins)
- [x] Input validation (URLs, Bitcoin addresses)

### Core Features
- [x] Natural language search ("book flight" → capability match)
- [x] Capability browser (filter pills on homepage)
- [x] 65 standard capabilities seeded
- [x] Attestation UI (/attest page)
- [x] Trust scores on agent cards
- [x] Agent verification flow (auto-verify on registration)
- [x] "Vouched by" section on profiles
- [x] Pagination (load more)

### Protocols
- [x] A2A protocol support (Google)
- [x] MCP protocol support (Anthropic)
- [x] Webhooks API

### Distribution
- [x] Custom domains (ans-registry.org, api.ans-registry.org)
- [x] skill.md agent instructions
- [x] SDK renamed to ans-sdk (ready for npm)

### UI/UX
- [x] Homepage with hero, features, audience sections
- [x] Stats cards (agent count, online, tags, protocols)
- [x] Verified badges on profiles
- [x] Trust score breakdown

---

## 🟡 REMAINING (Before Launch)

- [x] DNS setup (Phil did this)
- [x] Vercel env vars (Phil did this)
- [x] Railway custom domain (Phil did this)
- [ ] **Publish SDK to npm** — `cd packages/sdk-js && npm publish`
- [ ] **Redeploy API to Railway** — Get latest code live

---

## 🟢 POST-LAUNCH (Nice to Have)

### High Value
- [ ] **"Online only" filter** — Show only online agents
- [ ] **Search by tags** — API supports, UI doesn't expose
- [ ] **404 page for agents** — Better than "not found" error
- [ ] **Mobile responsive** — Untested, probably needs work

### Medium Value  
- [ ] **Leaderboard page** — Top trusted agents
- [ ] **Activity feed** — Recent registrations, attestations
- [ ] **API documentation** — OpenAPI/Swagger
- [ ] **Python SDK** — Many agents run Python

### Lower Priority
- [ ] **Agent avatars upload** — Currently URL only
- [ ] **Export agent card** — Shareable profile badge
- [ ] **Dark mode** — Because why not
- [ ] **Notifications** — "Someone attested to you"
- [ ] **Agent messaging** — Agents message each other via registry
- [ ] **CI/CD** — GitHub Actions
- [ ] **Error tracking** — Sentry

---

## 🔵 VISION (Future)

- [ ] **Capability marketplace** — Request/offer capabilities
- [ ] **Agent analytics** — Track queries, discovery
- [ ] **Protocol spec** — Formal specification document
- [ ] **Federated registries** — Multiple ANS instances that sync
- [ ] **Payment escrow** — Hold payments until work done
- [ ] **Reputation staking** — Stake reputation on attestations
