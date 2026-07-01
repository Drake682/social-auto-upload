---
phase: implementation
title: Implementation Guide
description: Technical implementation notes, patterns, and code guidelines
---

# Implementation Guide

## Development Setup
**How do we get started?**

- Phase 0 Task 1 configures local Docker infrastructure in `docker-compose.yml` and `.env.example`.
- `docker compose up -d postgres redis minio minio-createbucket` starts PostgreSQL, Redis, MinIO, and bucket provisioning for local development.
- Required local defaults are documented in `.env.example`; copy to `.env` and replace placeholder secrets before production use.

## Code Structure
**How is the code organized?**

- Phase 0 Task 2 uses existing NestJS backend in `backend/`; no new scaffold was needed because NestJS project, package scripts, and modules already existed.
- `backend/src/health/health.module.ts` owns `HealthController` and exposes `GET /health`.
- `backend/src/app.module.ts` wires `TypeOrmModule` from `DB_*` env vars and `BullModule` from `REDIS_*` env vars.
- `backend/src/common/interceptors/transform.interceptor.ts` leaves `/health` unwrapped so uptime checks receive the exact response contract.

## Implementation Notes
**Key technical details to remember:**

### Core Features
- Phase 1 Task 1 keeps `argon2` for password hashing and returns auth tokens using the API contract `{ access_token, refresh_token, expires_in }`.
- Phase 1 Task 1 stores refresh tokens as deterministic SHA-256 hex digests for direct database lookup, while keeping random opaque refresh tokens on the wire.
- Phase 1 Task 2 defines license tiers as `free | basic | pro | enterprise`, adds user-bound license activation, current-user deactivation, and `/license/status` tier-limit reporting.
- Phase 1 Task 4 adds a global `LicenseGuard` after JWT and role guards; public routes and license bootstrap/admin routes are exempt through `@Public()` / `@SkipLicense()` metadata.
- Phase 1 Task 5 adds best-effort audit logging for auth/license events, rate limits `/auth/refresh` and `/license/activate`, and exposes `GET /auth/sessions` without refresh token hashes.
- Phase 1 Task 3 aligns Vue auth store and Axios refresh queue with backend snake_case token contract and normalizes backend `display_name` to frontend `displayName`.
- Feature 3: Implementation approach

### Patterns & Best Practices
- Auth token responses are normalized in `AuthService._tokenResponse()` to prevent endpoint-specific response drift.
- Refresh token lookup uses Node `crypto` only; no extra package dependency.
- Common utilities/helpers

## Integration Points
**How do pieces connect?**

- Phase 0 Task 3 verifies the Vue 3 frontend in `frontend/` builds with `npm run build`.
- `frontend/vite.config.ts` runs Vite dev server on host `0.0.0.0`, port `5173`.
- Frontend package scripts are `dev`, `build`, `preview`, and `lint` in `frontend/package.json`.

## Error Handling
**How do we handle failures?**

- Error handling strategy
- Logging approach
- Retry/fallback mechanisms

## Performance Considerations
**How do we keep it fast?**

- Optimization strategies
- Caching approach
- Query optimization
- Resource management

## Security Notes
**What security measures are in place?**

- Authentication/authorization
- Input validation
- Data encryption
- Secrets management

