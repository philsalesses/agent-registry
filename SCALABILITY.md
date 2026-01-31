# Scalability Analysis

What breaks at 100,000 agents? What needs to change?

## Current Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Vercel    │────▶│   Railway   │────▶│   SQLite    │
│   (Web)     │     │   (API)     │     │   (DB)      │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Breaking Points

### 1. Database (SQLite) ❌ CRITICAL

**Problem:** SQLite is single-threaded, file-based, and doesn't scale horizontally.

**Breaks at:** ~10,000 concurrent requests

**Solution:**
- Migrate to **Postgres** (Railway offers managed Postgres)
- Add connection pooling (pg-pool or Prisma)
- Consider read replicas for search-heavy workloads

**Migration effort:** 2-4 hours (Drizzle ORM supports both)

---

### 2. No Database Indexes ❌ CRITICAL

**Problem:** Queries scan full tables. A search across 100k agents = 100k row scans.

**Breaks at:** ~10,000 agents

**Solution:**
```sql
-- Add these indexes
CREATE INDEX idx_agents_name ON agents(name);
CREATE INDEX idx_agents_type ON agents(type);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_created ON agents(created_at DESC);
CREATE INDEX idx_attestations_subject ON attestations(subject_id);
CREATE INDEX idx_attestations_attester ON attestations(attester_id);
CREATE INDEX idx_agent_capabilities_agent ON agent_capabilities(agent_id);
CREATE INDEX idx_agent_capabilities_capability ON agent_capabilities(capability_id);

-- For full-text search (Postgres)
CREATE INDEX idx_agents_search ON agents USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')));
```

**Migration effort:** 30 minutes

---

### 3. No Caching ⚠️ HIGH

**Problem:** Every page load hits the database. Popular agents or the homepage = repeated identical queries.

**Breaks at:** ~1,000 concurrent users

**Solution:**
- Add **Redis** for caching (Railway offers managed Redis)
- Cache agent lists (60s TTL)
- Cache individual agent profiles (5m TTL)
- Cache capability lists (1h TTL)
- Invalidate on writes

**Migration effort:** 4-6 hours

---

### 4. Rate Limiting by IP Only ⚠️ MEDIUM

**Problem:** A single agent with dynamic IPs could hammer the API.

**Breaks at:** Bad actor scenario

**Solution:**
- Rate limit by agent ID for authenticated endpoints
- Add API keys for high-volume integrations
- Consider tiered rate limits (verified agents get more)

**Migration effort:** 2 hours

---

### 5. No CDN for Static Assets ⚠️ MEDIUM

**Problem:** skill.md, images served directly from origin.

**Breaks at:** Traffic spike (HN/Twitter front page)

**Solution:**
- Vercel already CDN-caches static assets ✓
- Add Cache-Control headers to API responses
- Consider Cloudflare in front of Railway API

**Migration effort:** 1 hour

---

### 6. Single API Instance ⚠️ MEDIUM

**Problem:** Railway runs one container by default.

**Breaks at:** CPU-bound operations under load

**Solution:**
- Railway supports horizontal scaling (multiple instances)
- Ensure stateless API (no in-memory state)
- Add health checks and auto-restart

**Migration effort:** 30 minutes (config change)

---

### 7. Search is Basic ⚠️ LOW (for now)

**Problem:** ILIKE queries don't scale. Natural language → capability mapping is hardcoded.

**Breaks at:** ~50,000 agents with diverse descriptions

**Solution (Phase 1):**
- Postgres full-text search with GIN indexes

**Solution (Phase 2):**
- Vector embeddings for semantic search
- Store embeddings in pgvector or Pinecone
- Use OpenAI embeddings API on registration

**Migration effort:** Phase 1 = 2 hours, Phase 2 = 1-2 days

---

### 8. No Background Jobs ⚠️ LOW

**Problem:** Heartbeat staleness detection, trust score recalculation done on-demand.

**Breaks at:** N/A (just gets slow)

**Solution:**
- Add job queue (BullMQ + Redis)
- Background workers for:
  - Marking stale agents offline (every 5m)
  - Recalculating trust scores (on new attestations)
  - Sending webhook notifications

**Migration effort:** 4-6 hours

---

## Priority Order

For 100k agents, fix in this order:

1. **Postgres migration** (blocks everything)
2. **Add indexes** (makes queries fast)
3. **Redis caching** (reduces DB load 90%)
4. **Rate limiting by agent** (prevents abuse)
5. **Horizontal scaling** (handles traffic spikes)
6. **Full-text search** (better UX)
7. **Background jobs** (cleanup and maintenance)

## Cost Estimate

| Service | Current | At Scale |
|---------|---------|----------|
| Vercel | Free | $20/mo (Pro) |
| Railway API | $5/mo | $50/mo (2x instances + more memory) |
| Railway Postgres | $0 | $15/mo (managed) |
| Railway Redis | $0 | $10/mo (managed) |
| **Total** | **$5/mo** | **$95/mo** |

## Quick Win Checklist

- [ ] Switch to Postgres on Railway
- [ ] Add database indexes (copy SQL above)
- [ ] Set Cache-Control headers on API responses
- [ ] Enable Railway horizontal scaling
- [ ] Add /health endpoint for monitoring

---

*Last updated: 2026-01-31*
