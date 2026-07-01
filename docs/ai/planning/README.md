---
phase: planning
title: Project Planning & Task Breakdown
description: Break down work into actionable tasks and estimate timeline
---

# Project Planning & Task Breakdown

## Milestones
**What are the major checkpoints?**

- [ ] Milestone 1: [Description]
- [ ] Milestone 2: [Description]
- [ ] Milestone 3: [Description]

## Task Breakdown
**What specific work needs to be done?**

### Phase 1: Auth + License Gate
- [x] Task 1: Auth response contract + refresh-token hardening
- [x] Task 2: License activate/deactivate/status endpoints
- [x] Task 4: Global license gate guard
- [x] Task 5: Low-effort hardening — rate limits, audit logs, session list
- [x] Task 3: Frontend auth wiring
- [x] Task 6: Docs + regression verification

### Phase 2: Account Manager CRM
- [x] Task 1: Platform enum + cookie env key rename
- [x] Task 2: Soft delete + UpdateAccountDto + ListAccountsQueryDto
- [x] Task 3: POST /accounts/import-bulk
- [x] Task 4: GET /accounts/:id/health + Cron scheduler
- [x] Task 5: AccountsService unit tests
- [x] Task 6: Frontend filter + pagination + ImportBulkDialog + real health ping
- [x] Task 7: Docs + regression

### Phase 3: Trend Engine
- [x] Task 1: Trend schema migration + backend entity alignment
- [x] Task 2: Backend DTO + TrendsService + GET /trends/latest controller
- [x] Task 3: AI worker TikTok Creative Center + Facebook VN scraper modules
- [x] Task 4: AI worker scheduler, protected `/trends/sync`, run_id batch dedupe/upsert
- [x] Task 5: TrendService unit tests for filters, tenant scope, limit, legacy fallback
- [x] Task 6: Frontend Trends filters + top-10 view count cards
- [x] Task 7: Docs + regression verification

## Dependencies
**What needs to happen in what order?**

- Task dependencies and blockers
- External dependencies (APIs, services, etc.)
- Team/resource dependencies

## Timeline & Estimates
**When will things be done?**

- Estimated effort per task/phase
- Target dates for milestones
- Buffer for unknowns

## Risks & Mitigation
**What could go wrong?**

- Technical risks
- Resource risks
- Dependency risks
- Mitigation strategies

## Resources Needed
**What do we need to succeed?**

- Team members and roles
- Tools and services
- Infrastructure
- Documentation/knowledge

