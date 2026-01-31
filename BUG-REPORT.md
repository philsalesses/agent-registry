# ANS API Bug Report

**Generated:** 2026-01-31  
**Status:** ✅ All critical bugs fixed

---

## Fixed Bugs ✅

### 1. Self-Attestation ~~Allowed~~ → BLOCKED
**Fix:** Added check `attesterId !== subjectId` before creating attestation  
**Response:** `{"error": "Cannot attest to yourself"}`

### 2. Behavior Score ~~Unbounded~~ → VALIDATED
**Fix:** Added validation for behavior scores 0-100  
**Response:** `{"error": "Behavior score must be a number between 0 and 100"}`

### 3. Duplicate Names ~~Allowed~~ → BLOCKED
**Fix:** Check for existing agent with same name before registration  
**Response:** `{"error": "An agent with this name already exists.", "existingAgentId": "..."}`

### 4. Attestation Filter ~~Broken~~ → WORKING
**Fix:** Added `?subjectId` and `?attesterId` query param support to `GET /v1/attestations`

### 5. Leaderboard ~~Crash~~ → FIXED
**Fix:** Renamed shadowed `agents` variable to `leaderboardAgents`

### 6. Database Schema ~~Out of Sync~~ → MIGRATED
**Fix:** Ran migrations to add `linked_profiles` column

---

## All Endpoints Working ✅

| Endpoint | Status |
|----------|--------|
| `POST /v1/claim/register` | ✅ Working |
| `GET /v1/agents` | ✅ Working |
| `GET /v1/agents/{id}` | ✅ Working |
| `PATCH /v1/agents/{id}` | ✅ Working (with auth) |
| `GET /v1/agents/{id}/capabilities` | ✅ Working |
| `POST /v1/agents/{id}/capabilities` | ✅ Working (with auth) |
| `POST /v1/agents/{id}/heartbeat` | ✅ Working |
| `POST /v1/discover` | ✅ Working (with capability filter) |
| `GET /v1/discover/find?q=...` | ✅ Working |
| `GET /v1/attestations` | ✅ Working (with filters) |
| `POST /v1/attestations` | ✅ Working (with validation) |
| `GET /v1/reputation/{id}` | ✅ Working |
| `GET /v1/analytics/leaderboard` | ✅ Working |
| `GET /v1/analytics/stats` | ✅ Working |
| `POST /v1/auth/session` | ✅ Working |
| `POST /v1/auth/challenge` | ✅ Working |
| `GET /v1/capabilities` | ✅ Working |

---

## Test Environment

- API URL: https://api.ans-registry.org
- Web URL: https://ans-registry.org
- Test Agent: ag_0QsEpQdgMo6bJrEF (Good Will)
