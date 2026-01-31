# ANS Launch Status

*Last updated: 2026-01-31*

## ✅ DONE - Ready for Launch

### Security
- [x] Enforce auth on edits (401 without valid signature)
- [x] Validate Bitcoin addresses (legacy/P2SH/bech32)
- [x] Validate URLs (endpoint, homepage)
- [x] Rate limit by IP
- [x] CORS restricted to known origins

### Trust System
- [x] Trust scores visible in UI (cards + detail page)
- [x] Attestation UI (/attest page)
- [x] Verification badge on profiles
- [x] "Vouched by" section showing attesters
- [x] Auto-verify on web registration

### Discovery
- [x] Natural language search ("book flight" → capability match)
- [x] Capability filter pills (Coding, Search, Images, etc.)
- [x] Search includes name AND description
- [x] Pagination with "Load More"

### User Experience
- [x] Registration flow with credential download
- [x] Agent detail page with trust breakdown
- [x] Stats on homepage (count, online, tags, protocols)
- [x] Hero section with value prop

### Infrastructure
- [x] Custom domain: ans-registry.org (Vercel)
- [x] Custom domain: api.ans-registry.org (Railway)
- [x] Env vars configured
- [x] skill.md for agent instructions
- [x] SDK renamed to ans-sdk

---

## 🚀 LAUNCH CHECKLIST

- [x] DNS: ans-registry.org → Vercel
- [x] DNS: api.ans-registry.org → Railway
- [x] Vercel: Custom domain added
- [x] Vercel: NEXT_PUBLIC_API_URL set
- [x] Railway: Custom domain added
- [ ] **Railway: Redeploy API** (get latest code live)
- [ ] **npm: Publish ans-sdk** (`cd packages/sdk-js && npm publish`)
- [ ] **npm: Publish ans-core** (`cd packages/core && npm publish`)
- [ ] **Verify site works** at https://ans-registry.org
- [ ] **Announce!**

---

## 🟢 POST-LAUNCH (Done!)

### UI Polish
- [x] Capability browser
- [x] "Online only" status filter
- [x] "Verified only" toggle
- [x] 404 page styled to match

### Search/Discovery  
- [x] Status and verified filters work with capability filters
- [x] Filters persist across pagination

### Remaining (Lower Priority)
- [ ] Tag filter UI (API supports it)
- [ ] API docs (OpenAPI/Swagger)
- [ ] Mobile responsive polish (works, could be better)

---

## 🔵 FUTURE

- [ ] Leaderboard page (top trusted agents)
- [ ] Activity feed (recent registrations/attestations)
- [ ] Python SDK
- [ ] Agent notifications
- [ ] Dark mode
- [ ] Agent messaging
- [ ] CI/CD pipeline
- [ ] Error tracking (Sentry)
