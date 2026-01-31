# Launch Blockers - Updated Status

## ✅ DONE

### Security
- [x] **Enforce auth on edits** — 401 if no valid signature/key
- [x] **Validate Bitcoin addresses** — Regex validation for legacy/P2SH/bech32
- [x] **Validate URLs** — Endpoint, homepage validated
- [x] **Rate limit by IP** — Basic rate limiting in place

### Trust System
- [x] **Trust score visible in UI** — Homepage cards + detail page
- [x] **Attestation UI** — /attest page works
- [x] **Verification badge** — Shows on agent profile when verified
- [x] **"Vouched by" display** — Shows attesters on agent detail page
- [x] **Auto-verify on registration** — Web registration auto-verifies

### User Experience
- [x] **Agent detail page shows reputation** — Trust score + breakdown
- [x] **Registration flow** — Works with credential download

### Distribution
- [x] **Custom domain** — ans-registry.org (DNS setup pending)
- [x] **Agent instructions** — skill.md for agents

---

## 🟡 REMAINING (Before Launch)

| Task | Time | Notes |
|------|------|-------|
| DNS setup | 5 min | Phil: point ans-registry.org → Vercel, api.ans-registry.org → Railway |
| Vercel env var | 2 min | Set NEXT_PUBLIC_API_URL=https://api.ans-registry.org |
| Railway custom domain | 2 min | Add api.ans-registry.org |
| Publish SDK to npm | 10 min | `npm publish` in packages/sdk-js |
| Redeploy API | 5 min | Push to Railway to get auto-verify fix live |

**Total: ~25 min**

---

## 🟢 POST-LAUNCH (Nice to Have)

- [ ] Capability browser (browse agents by capability)
- [ ] "Verified only" filter in discovery
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Search by tags
- [ ] Agent count / stats on homepage
- [ ] Notifications (someone attested to you)
- [ ] Mobile responsive polish
- [ ] 404 pages for bad agent IDs

---

## Launch Checklist

1. [ ] DNS: ans-registry.org → Vercel
2. [ ] DNS: api.ans-registry.org → Railway  
3. [ ] Vercel: Add custom domain
4. [ ] Vercel: Set NEXT_PUBLIC_API_URL env var
5. [ ] Railway: Add custom domain
6. [ ] Redeploy API (auto-verify fix)
7. [ ] Verify site works at ans-registry.org
8. [ ] Publish SDK: `cd packages/sdk-js && npm publish`
9. [ ] Announce!
