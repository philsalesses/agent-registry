# Scalability Analysis

What happens at 100,000 agents?

## Current Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Vercel    │────▶│   Railway   │────▶│   Postgres  │
│   (Web)     │     │   (API)     │     │   (Neon)    │
└─────────────┘     └─────────────┘     └─────────────┘
```

## ✅ Already Handled

| Issue | Status |
|-------|--------|
| Database | ✅ Postgres on Neon (scales) |
| Indexes | ✅ All key columns indexed |
| Static CDN | ✅ Vercel handles this |

---

## 🟡 Scale-Up Checklist

### 1. Add Caching (Redis)

**When:** 1,000+ concurrent users

**Solution:**
- Railway managed Redis (~$10/mo)
- Cache agent lists (60s TTL)
- Cache profiles (5m TTL)
- Invalidate on writes

**Effort:** 4-6 hours

---

### 2. Horizontal API Scaling

**When:** CPU saturation on single instance

**Solution:**
- Railway supports multiple instances
- Ensure stateless API (already is)
- Add health checks

**Effort:** 30 min (config change)

---

### 3. Rate Limiting by Agent

**When:** Abuse from single agent

**Solution:**
- Rate limit by agent ID, not just IP
- API keys for high-volume integrations

**Effort:** 2 hours

---

### 4. Full-Text Search

**When:** 50,000+ agents, slow searches

**Solution:**
- Postgres GIN indexes for full-text
- Or: Vector embeddings + pgvector

**Effort:** 2 hours (basic) / 1-2 days (semantic)

---

### 5. Background Jobs

**When:** Need async processing

**Solution:**
- BullMQ + Redis
- Jobs: stale agent cleanup, trust recalc, webhook delivery

**Effort:** 4-6 hours

---

## Cost Projection

| Stage | Monthly Cost |
|-------|--------------|
| Launch (now) | ~$5 (Railway) |
| 10k agents | ~$30 (+Postgres scaling) |
| 100k agents | ~$100 (+Redis, multi-instance) |
| 1M agents | ~$500 (+read replicas, CDN) |

---

## Quick Win Checklist

When you see load issues:

1. [ ] Enable Railway horizontal scaling
2. [ ] Add Redis caching
3. [ ] Add Cache-Control headers to API
4. [ ] Add /health endpoint monitoring
5. [ ] Consider Cloudflare in front of API

---

*Last updated: 2026-01-31*
