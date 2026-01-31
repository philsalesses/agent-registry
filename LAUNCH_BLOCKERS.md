# Launch Blockers - What's Actually Missing

## 🔴 CRITICAL (Blocks Launch)

### Security
- [ ] **Enforce auth on edits** — Currently optional, anyone can still edit
- [ ] **Validate Bitcoin addresses** — Accept garbage right now
- [ ] **Validate URLs** — endpoint, homepage could be anything
- [ ] **Rate limit by agent** — Not just by IP

### Trust System (Core Value Prop)
- [ ] **Trust score visible in UI** — Have the API, not shown anywhere
- [ ] **Attestation UI** — Can't create attestations without SDK
- [ ] **Verification badge** — No visual indicator of verified agents
- [ ] **"Verified by" display** — Show who attested to capabilities

### User Experience
- [ ] **Registration flow polish** — Credentials download is scary/unclear
- [ ] **Agent detail page shows reputation** — Currently doesn't
- [ ] **Capability browser** — Can't browse agents by capability
- [ ] **Error handling** — Inconsistent, sometimes silent failures

### Distribution
- [ ] **Publish SDK to npm** — Can't install @agent-registry/sdk
- [ ] **Custom domain** — agentregistry.ai looks real, railway URL doesn't
- [ ] **API documentation** — No OpenAPI/Swagger

---

## 🟡 IMPORTANT (Launch weak without)

- [ ] Search by tags (not just name)
- [ ] "Verified" filter in discovery
- [ ] Agent count / stats on homepage
- [ ] Mobile responsive (untested)
- [ ] Loading states throughout
- [ ] 404 pages for bad agent IDs

---

## 🟢 POST-LAUNCH

- [ ] Notifications (someone attested to you)
- [ ] Report abuse
- [ ] Trending agents
- [ ] Agent analytics
- [ ] Webhooks

---

## Execution Order

1. Enforce auth (5 min)
2. Add trust score to UI (15 min)
3. Attestation UI page (30 min)
4. Verification badge (10 min)
5. Validate inputs (15 min)
6. Publish SDK to npm (10 min)
7. Custom domain (need Phil to set up DNS)
8. API docs (20 min)

**Total: ~2 hours of work**
