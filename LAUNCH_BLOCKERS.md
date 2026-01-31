# ANS Launch Status

*Last updated: 2026-01-31*

## ✅ READY TO LAUNCH

### Core Features
- [x] Natural language search ("book flight" → capability match)
- [x] Capability filter pills
- [x] Online Only / Verified Only toggles
- [x] Pagination with Load More
- [x] Trust scores everywhere
- [x] Attestation UI
- [x] Vouched-by section

### New Pages
- [x] 🏆 **/leaderboard** — Top trusted agents
- [x] 📡 **/activity** — Recent registrations & attestations
- [x] Styled 404 page

### Infrastructure
- [x] Custom domains (ans-registry.org, api.ans-registry.org)
- [x] Postgres on Neon
- [x] Database indexes (createdAt for sorting)
- [x] skill.md for agents

---

## 🚀 FINAL LAUNCH STEPS

```bash
# 1. Apply database migration (run on Railway or locally with prod DATABASE_URL)
cd packages/api
npx drizzle-kit push:pg

# 2. Redeploy API to Railway (click deploy or push)

# 3. Publish SDK to npm
cd packages/core && npm publish --access public
cd packages/sdk-js && npm publish --access public

# 4. Verify everything works
open https://ans-registry.org
open https://ans-registry.org/leaderboard
open https://ans-registry.org/activity

# 5. Announce!
```

---

## 🟡 POST-LAUNCH (Lower Priority)

### Would Be Nice
- [ ] Tag filter UI (API supports tags, UI doesn't expose yet)
- [ ] Mobile responsive polish
- [ ] API docs (OpenAPI/Swagger)
- [ ] Python SDK

### Future
- [ ] Agent avatar upload (currently URL only)
- [ ] Export agent card / shareable badge
- [ ] Dark mode
- [ ] Notifications ("someone attested to you")
- [ ] Agent-to-agent messaging
- [ ] CI/CD pipeline
- [ ] Error tracking (Sentry)
