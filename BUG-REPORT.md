# ANS API Bug Report

**Generated:** 2026-01-31 03:53 EST  
**Tester:** Good Will (automated testing)

---

## Critical Bugs 🔴

### 1. Self-Attestation Allowed
**Endpoint:** `POST /v1/attestations`  
**Issue:** Agents can attest to themselves with any score (including 100%)  
**Impact:** Trust scores are meaningless if agents can boost their own scores  
**Fix:** Block attestations where `attesterId === subjectId`

### 2. Behavior Score Out of Range Accepted
**Endpoint:** `POST /v1/attestations`  
**Issue:** Behavior scores accept any number (tested: 999, -50)  
**Expected:** Should be 0-100  
**Fix:** Add Zod validation: `z.number().min(0).max(100)` for behavior claims

### 3. Duplicate Agent Names Allowed
**Endpoint:** `POST /v1/claim/register`  
**Issue:** Multiple agents can register with identical names (e.g., two "Good Will" agents)  
**Impact:** Impersonation risk, user confusion  
**Fix:** Add unique constraint on name or require verification for duplicate names

---

## High Priority Bugs 🟠

### 4. Session Auth Endpoint Returns 404
**Endpoint:** `POST /v1/auth/session`  
**Issue:** Returns `{"error":"Not found"}` even with valid payload  
**Expected:** Should create session token with valid agentId + privateKey  
**Note:** Might be stale deployment - code looks correct locally

### 5. Leaderboard Returns 500
**Endpoint:** `GET /v1/analytics/leaderboard`  
**Issue:** Returns `{"error":"Internal server error"}`  
**Expected:** Should return sorted list of agents by trust score

### 6. Capabilities Endpoint Returns 404
**Endpoint:** `GET /v1/agents/{id}/capabilities`  
**Issue:** Returns `{"error":"Not found"}` for existing agents  
**Expected:** Should return agent's capabilities list

### 7. Reputation Endpoint Returns 404
**Endpoint:** `GET /v1/agents/{id}/reputation`  
**Issue:** Returns `{"error":"Not found"}` for existing agents  
**Expected:** Should return trust score breakdown

### 8. Attestation Filter Not Working
**Endpoint:** `GET /v1/attestations?subjectId={id}`  
**Issue:** Returns ALL attestations instead of filtering by subject  
**Expected:** Should only return attestations for the specified subject

---

## Medium Priority Bugs 🟡

### 9. Signature Always Required in Schema
**Endpoint:** `POST /v1/attestations`  
**Issue:** `signature` field is required by Zod even when using session/header auth  
**Workaround:** Pass dummy value like "via-header"  
**Fix:** Make signature optional when other auth methods are used

### 10. Structured Discovery Returns Empty
**Endpoint:** `POST /v1/discover` with capabilities filter  
**Issue:** Capability-based discovery returns no results even when agents exist  
**Root Cause:** Agents don't have capabilities properly assigned/indexed

### 11. Missing Pagination Metadata
**Endpoint:** `GET /v1/agents`  
**Issue:** Response doesn't include total count or hasMore flag  
**Expected:** Should return `{ agents: [], total: X, hasMore: bool }`

---

## Low Priority / UX Issues 🟢

### 12. XSS in Description Stored As-Is
**Endpoint:** `POST /v1/claim/register`  
**Issue:** `<script>alert(1)</script>` stored in description field  
**Note:** OK if properly escaped on display, but should sanitize on input

### 13. Error Message Doesn't Guide Users
**Endpoint:** `PATCH /v1/agents/{id}` (unauthorized)  
**Current:** "Authentication required. Use SDK with private key or upload credentials in web UI."  
**Issue:** Doesn't mention required headers (`X-Agent-Private-Key` AND `X-Agent-Timestamp`)

### 14. Heartbeat Works Without Auth
**Endpoint:** `POST /v1/agents/{id}/heartbeat`  
**Issue:** Anyone can send heartbeat for any agent  
**Note:** May be intentional for ease of use, but allows status spoofing

---

## Passed Tests ✅

- Health check endpoint works
- Agent registration with validation
- Agent listing with pagination
- Agent lookup by ID
- 404 for non-existent agents
- Profile update with proper auth
- Auth challenge generation
- Name length validation (max 64)
- Empty name validation
- Invalid type validation
- Cross-agent update prevention
- Natural language discovery
- Analytics stats endpoint
- Attestation creation (with workaround)

---

## Test Environment

- API URL: https://api.ans-registry.org
- Test Agent: ag_0QsEpQdgMo6bJrEF (Good Will)
- Note: Some issues may be due to deployed version being out of sync with repo
