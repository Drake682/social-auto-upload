---
phase: testing
title: Testing Strategy
description: Define testing approach, test cases, and quality assurance
---

# Testing Strategy

## Test Coverage Goals
**What level of testing do we aim for?**

- Unit test coverage target (default: 100% of new/changed code)
- Integration test scope (critical paths + error handling)
- End-to-end test scenarios (key user journeys)
- Alignment with requirements/design acceptance criteria

## Unit Tests
**What individual components need testing?**

### Phase 0 Task 2 — Backend HealthModule
- [x] `backend/src/health/health.module.spec.ts` verifies `GET /health` returns top-level `{ status, timestamp }`.
- [x] Health timestamp must be valid ISO string via `new Date(timestamp).toISOString()`.
- [x] Full backend unit suite passes with `npm test -- --runInBand`.
- [x] Backend build passes with `npm run build`.

### Phase 1 Task 1 — Auth contract + refresh-token hardening
- [x] `backend/src/auth/auth.service.spec.ts` verifies register/login/refresh return `{ access_token, refresh_token, expires_in: 900 }`.
- [x] Refresh tokens are stored and found by SHA-256 digest instead of scanning all argon2 hashes.
- [x] Replay, expired, revoked, and non-existent refresh token paths remain covered.

### Phase 1 Task 2 — License activate/deactivate/status
- [x] `backend/src/license/license.service.spec.ts` verifies license activation binds key to user and device.
- [x] Status returns active `pro` limits and inactive `free` fallback.
- [x] Current-user deactivation clears user binding and disables license activations.
- [x] Legacy admin license create/validate/deactivate tests remain green with new tier enum.

### Phase 1 Task 4 — License gate guard
- [x] `backend/src/common/guards/license.guard.spec.ts` verifies public route bypass, `@SkipLicense()` bypass, active-license allow, and no-license block.
- [x] `backend/src/license/license.service.spec.ts` verifies `validateAccess()` only grants access to an active license bound to current user.
- [x] Backend build verifies global guard wiring compiles with Nest providers.

### Phase 1 Task 5 — Low-effort hardening
- [x] `backend/src/audit/audit.service.spec.ts` verifies audit events persist sanitized metadata and failures do not block main flows.
- [x] `backend/src/auth/auth.service.spec.ts` verifies login/refresh/logout audit events and session listing without token hashes.
- [x] `backend/src/license/license.service.spec.ts` verifies license activate/deactivate audit events.
- [x] Backend build verifies audit module wiring and rate-limit decorators compile.

### Phase 1 Task 3 — Frontend auth wiring
- [x] `frontend` production build verifies Login/Register/AuthStore/refresh queue compile against backend `{ access_token, refresh_token }` contract.
- [x] User normalization maps backend `display_name` to frontend `displayName` for layout display.
- [ ] No frontend unit test runner exists yet; build is current verification gate.

### Phase 2 — Account Manager CRM
- [x] `backend/src/accounts/accounts.service.spec.ts` verifies AES-256-GCM encrypted storage does not contain plaintext session data and API responses omit `session_data`.
- [x] AccountsService tests cover platform filter + pagination, tenant-scoped soft delete, JSON/CSV bulk import, partial failure reports, and health ping alive/dead/unconfigured/failure paths.
- [x] `frontend` production build verifies Accounts table, platform filter, pagination, bulk import dialog, and real health ping wiring compile cleanly.

### Phase 3 — Trend Engine
- [x] `backend/src/trends/trends.service.spec.ts` verifies platform filter returns only matching rows.
- [x] `backend/src/trends/trends.service.spec.ts` verifies region filter returns only matching rows.
- [x] `backend/src/trends/trends.service.spec.ts` verifies `limit=10` caps results.
- [x] `backend/src/trends/trends.service.spec.ts` verifies tenant-scoped latest query includes tenant rows plus global rows and excludes other tenants.
- [x] `backend/src/trends/trends.service.spec.ts` verifies legacy fallback from `title` to `keyword`, `views` to `volume`, nullable `region` to `global`, and `crawled_at` to `extracted_at`.
- [x] `frontend` production build verifies Trends platform/region filters and top-10 cards compile cleanly.
- [x] AI worker `py_compile` verifies `main.py`, `models.py`, and trend scraper modules are syntax-clean on Python 3.11.

## Integration Tests
**How do we test component interactions?**

- [x] Phase 0 Task 1: `npx ai-devkit@latest lint` validates AI docs base structure.
- [x] Phase 0 Task 1: `docker compose config` validates Docker Compose syntax, interpolation, services, networks, and volumes.
- [x] Phase 0 Task 1: `docker compose up -d postgres redis minio minio-createbucket` starts local infrastructure and provisions MinIO bucket.
- [ ] API endpoint tests
- [ ] Integration scenario 3 (failure mode / rollback)

## End-to-End Tests
**What user flows need validation?**

- [ ] User flow 1: [Description]
- [ ] User flow 2: [Description]
- [ ] Critical path testing
- [ ] Regression of adjacent features

## Test Data
**What data do we use for testing?**

- Test fixtures and mocks
- Seed data requirements
- Test database setup

## Test Reporting & Coverage
**How do we verify and communicate test results?**

- Coverage commands and thresholds (`npm run test -- --coverage`)
- Coverage gaps (files/functions below 100% and rationale)
- Links to test reports or dashboards
- Manual testing outcomes and sign-off

## Manual Testing
**What requires human validation?**

- [x] Phase 0 Task 3: `npm run build` in `frontend/` exits 0 with Vite production build output.
- [x] Phase 0 Task 3: `npm run dev -- --host 0.0.0.0 --port 5173` starts Vite dev server on port 5173.
- [x] Phase 0 Task 3: `curl http://127.0.0.1:5173` returns Vite-served `index.html`.
- [ ] UI/UX testing checklist (include accessibility)
- [ ] Browser/device compatibility
- [ ] Smoke tests after deployment

## Performance Testing
**How do we validate performance?**

- Load testing scenarios
- Stress testing approach
- Performance benchmarks

## Bug Tracking
**How do we manage issues?**

- Issue tracking process
- Bug severity levels
- Regression testing strategy

