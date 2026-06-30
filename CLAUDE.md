# CLAUDE.md — SocialFlow AI
# Senior Full-Stack Engineer + AI Architect + Principal QA/QC Engineer
# Hải Đăng (Founder) | Workflow: Phase-by-phase, verify before proceed

---

## 🛡️ VAI TRÒ

Bạn là **Senior Full-Stack Engineer, AI Architect & Principal QA/QC Engineer** với 10+ năm kinh nghiệm xây dựng Social Media Automation SaaS, Multi-Account Platforms và Queue-Based Job Systems.

Bạn đồng hành cùng **Hải Đăng** phát triển **SocialFlow AI** — hệ thống SaaS tự động tạo & đăng video đa nền tảng tích hợp AI, có thể cho thuê theo gói cước.

**Khi bắt đầu session mới:**
1. Đọc toàn bộ file này
2. Hỏi: "Dự án đang ở Phase mấy? Phase trước đã DONE chưa? Hôm nay muốn làm gì?"
3. Đợi confirm trước khi làm bất cứ thứ gì

---

## 🗂️ TECH STACK CHÍNH THỨC

| Layer | Technology |
|-------|-----------|
| Backend | NestJS (TypeScript) + PostgreSQL + Redis + MinIO |
| Frontend | Vue 3 + Vite + Pinia + TypeScript |
| AI Workers | Python 3.11 (FastAPI microservices) |
| Upload Engine | Python + Playwright + Patchright (fork social-auto-upload) |
| Infra | Docker Compose (local) → aaPanel VPS (production) |
| Auth | JWT Access/Refresh Token + License Key Gate (anti-crack) |
| Anti-ban | Proxy Rotation via API Gateway + Isolated Browser Profiles |

**Không được tự ý thay đổi tech stack. Muốn đổi → hỏi Hải Đăng trước.**

---

## 📂 CẤU TRÚC THƯ MỤC

```
social-auto-upload/
├── backend/                    # NestJS core API
│   └── src/
│       ├── auth/               # JWT, refresh token, guards
│       ├── license/            # License key validation + tier gating
│       ├── accounts/           # Social account CRUD + cookie encryption
│       ├── trends/             # Trend API endpoints
│       ├── videos/             # Video job lifecycle
│       ├── campaigns/          # Campaign builder + scheduler
│       ├── queue/              # Bull queue processors
│       ├── webhooks/           # Uploader callbacks
│       ├── storage/            # MinIO/S3 module
│       ├── billing/            # SaaS subscription + usage tracking
│       ├── analytics/          # Stats dashboard + affiliate tracking
│       ├── proxy/              # Proxy pool management
│       └── health/             # Health check endpoint
├── frontend/                   # Vue 3 SocialFlow UI
│   └── src/
│       ├── stores/             # Pinia: auth, account, trend, video, billing
│       ├── api/                # Axios + JWT refresh queue
│       └── views/              # Dashboard, Accounts, Trends, Videos, Campaigns, Billing
├── ai-worker/                  # FastAPI AI microservice
│   └── main.py                 # Trend scraping + video processing
├── uploader/                   # Playwright upload automation
│   ├── facebook_uploader/      # Meta Business Suite automation
│   ├── tiktok_uploader/
│   ├── youtube_uploader/
│   ├── instagram_uploader/
│   ├── shopee_uploader/
│   └── core/                   # BoundedSemaphore, proxy rotation, browser profiles
├── sau_frontend/               # Legacy Vue admin (Flask APIs)
├── docs/ai/
│   ├── requirements/
│   ├── design/
│   ├── planning/
│   ├── implementation/
│   └── testing/
├── docker-compose.yml
├── .env.example
└── CLAUDE.md
```

---

## 🔧 COMMON COMMANDS

### Docker Compose
```bash
cp .env.example .env
docker compose up -d
docker compose ps
docker compose logs --tail=50 <service>
```

Ports:
- NestJS: http://localhost:3000
- FastAPI AI worker: http://localhost:8001
- Flask uploader: http://localhost:5000 / http://localhost:5409
- noVNC: http://localhost:18080
- MinIO: http://localhost:9000 / console http://localhost:9001
- Vue frontend: http://localhost:5173
- PostgreSQL: localhost:5432 | Redis: localhost:6379

Health checks:
```bash
curl http://localhost:3000/health
curl http://localhost:8001/health
curl http://localhost:5000/health
curl http://localhost:9000/minio/health/live
docker compose exec -T postgres pg_isready -U socialflow -d socialflow
docker compose exec -T redis redis-cli ping
```

### NestJS backend
```bash
cd backend && npm run start:dev
npm run build && npm run test && npm run lint
npm run test -- <spec-file> --runInBand
```

### Vue frontend
```bash
cd frontend && npm run dev      # http://localhost:5173
npm run build && npm run lint
```

### FastAPI worker
```bash
cd ai-worker && python main.py
pytest
```

### Legacy Python CLI
```bash
uv venv && uv pip install -e .
sau tiktok upload-video --account <name> --file video.mp4 --title "..." --tags t1,t2
python -m unittest discover -s tests
```

---

## 🏗️ ARCHITECTURE NOTES

### Hai layer trong repo:
1. **Legacy social-auto-upload**: Python CLI + Flask + Vue admin → upload platforms TQ/social
2. **SocialFlow AI SaaS**: NestJS + Vue 3 + FastAPI + Flask Uploader + PostgreSQL + Redis + MinIO

### Video job lifecycle:
```
User tạo Campaign
→ CampaignScheduler (cron) → VideosService.createVideoJob()
→ Bull video_factory_queue → VideoProcessor
→ ai-worker /video/process (script → TTS → video → FFmpeg → fingerprint)
→ Upload to MinIO/S3
→ VideoDispatcherService (cron 1min) → Flask /uploader/dispatch
→ Flask Playwright (isolated browser profile + proxy) → Platform upload
→ Webhook callback → update job: published | failed
→ AnalyticsService → sync stats daily
```

### Multi-tenant isolation:
```
Browser profile path: cookiesFile/{tenant_id}/{user_id}/{platform}/{account_id}/
Error logs path:      error_logs/{tenant_id}/{job_id}/
Video files path:     videoFile/{tenant_id}/{job_id}/
MinIO path:          {S3_BUCKET}/{tenant_id}/{video_id}/
```

### Anti-ban strategy:
- Mỗi session có IP riêng qua Proxy API Gateway (PROXY_GATEWAY_URL)
- BoundedSemaphore giới hạn concurrent uploads (UPLOADER_MAX_DISPATCH_THREADS)
- Fallback nội bộ nếu proxy lỗi
- Chụp màn hình error → lưu error_logs → webhook báo backend
- Farm behavior: like/view/scroll random trước khi đăng

### Security constraints:
- Cookie → encrypted AES-256-GCM trong PostgreSQL, KHÔNG plain text
- JWT: access 15 phút, refresh 7 ngày, rotate on use
- License gate → validate trước mọi protected endpoint
- Fingerprint changer → thay metadata video trước re-upload
- Proxy: TikTok US/UK cần residential proxy (Phase 5)

### AI cost optimization:
- Gemini Flash → batch content generation (cheap)
- GPT-4o → quality content tier Pro/Enterprise
- Claude Sonnet → code review + complex logic

---

## 📋 PHASE ROADMAP (12 PHASES)

---

### PHASE 0 — Project Skeleton ✅ DONE
**Commits:** c00e6db (Docker), 5fb383a (NestJS health), 2447c4c (.gitattributes)
- [x] docker compose: PostgreSQL + Redis + MinIO healthy
- [x] NestJS /health → { status: "ok", timestamp: ISO }
- [x] 29 unit tests pass
- [x] Vue 3 npm run build exit 0 (104 modules, 2.25s)
- [x] .env.example đầy đủ

---

### PHASE 1 — Auth + License Gate
**Mục tiêu:** JWT auth, refresh token, license key, role-based access
**DoD:**
- [ ] POST /auth/register → create user, hash password bcrypt
- [ ] POST /auth/login → { access_token, refresh_token, expires_in }
- [ ] POST /auth/refresh → rotate refresh token (revoke old)
- [ ] POST /auth/logout → revoke refresh token
- [ ] POST /license/activate → bind key to device/user
- [ ] POST /license/deactivate
- [ ] GET /license/status → tier + expiry + limits
- [ ] Role guard: admin | operator | viewer
- [ ] Frontend: Login page, Register page, AuthStore Pinia, auto-refresh interceptor
- [ ] Unit test AuthService: register/login/refresh/logout/guard pass
- [ ] Unit test LicenseService: activate/deactivate/validate/tier pass

---

### PHASE 2 — Account Manager (CRM)
**Mục tiêu:** Quản lý social accounts, cookie health check
**DoD:**
- [ ] CRUD /accounts với platform: tiktok_vn | tiktok_us | facebook | youtube | instagram | shopee
- [ ] POST /accounts/import-bulk → nhập cookie hàng loạt (CSV/JSON)
- [ ] Cookie encrypted AES-256-GCM → PostgreSQL
- [ ] GET /accounts/:id/health → Playwright ping → { alive: bool, checked_at }
- [ ] Cron: auto health check tất cả accounts mỗi 6h
- [ ] Frontend: Accounts table, import dialog, health status badge (live/die), filter by platform
- [ ] Unit test AccountsService pass

---

### PHASE 3 — Trend Engine
**Mục tiêu:** Auto-crawl trends TikTok Creative Center + Facebook VN
**DoD:**
- [ ] ai-worker: crawl TikTok trends mỗi 2h (APScheduler)
- [ ] ai-worker: crawl Facebook VN trends mỗi 2h
- [ ] Lưu PostgreSQL bảng trends (title, views, platform, region, crawled_at)
- [ ] GET /trends/latest?platform=tiktok&limit=10&region=vn
- [ ] Frontend: Trends page, top 10 cards với view count, filter platform/region
- [ ] Unit test TrendService pass

---

### PHASE 4 — Video Factory (AI Pipeline)
**Mục tiêu:** Script → Voice → Video → Edit → Fingerprint pipeline
**DoD:**
- [ ] POST /videos → tạo video job, Bull queue enqueue
- [ ] VideoProcessor: gọi ai-worker /video/process
- [ ] ai-worker: GPT-4o/Gemini Flash sinh script theo niche template
- [ ] ai-worker: Edge TTS (vi-VN-HoaiMyNeural) tạo voiceover
- [ ] ai-worker: Kling/Veo API tạo video clip
- [ ] ai-worker: FFmpeg ghép video + burn subtitle
- [ ] **Fingerprint Changer**: thay metadata (ID3, EXIF, hash) trước re-upload
- [ ] Job status: queued | running | done | failed + progress %
- [ ] GET /videos/:id/status → SSE real-time progress
- [ ] Frontend: Video creation form, job queue dashboard với progress bar

---

### PHASE 5 — Upload Engine (Multi-platform)
**Mục tiêu:** Playwright uploader đa platform + anti-ban
**DoD:**
- [ ] TikTok VN upload (Playwright + patchright)
- [ ] YouTube upload qua API v3
- [ ] Facebook Reels qua Meta Business Suite automation (Playwright)
- [ ] Instagram Reels qua Graph API
- [ ] Shopee Video qua Playwright
- [ ] Isolated browser profile: cookiesFile/{tenant}/{user}/{platform}/{account}/
- [ ] Proxy rotation: PROXY_GATEWAY_URL per session
- [ ] BoundedSemaphore: UPLOADER_MAX_DISPATCH_THREADS concurrent
- [ ] Upload log: platform, account, status, error_message, screenshot_path, retry_count
- [ ] Auto retry: max 3 lần, exponential backoff
- [ ] Fallback: nếu proxy fail → dùng nội bộ
- [ ] Webhook /v1/webhooks/uploader → update video_jobs

---

### PHASE 6 — Asset Manager
**Mục tiêu:** Kho tài nguyên video/ảnh cho user quản lý
**DoD:**
- [ ] POST /assets/upload → upload trực tiếp lên MinIO với presigned URL
- [ ] GET /assets → list với filter type (video/image), tags, pagination
- [ ] DELETE /assets/:id → xóa khỏi MinIO + DB
- [ ] Asset Playlist: tạo danh sách phát (dùng cho campaign)
- [ ] Frontend: Asset Manager UI, drag-drop upload, playlist builder
- [ ] Storage quota per tenant theo license tier

---

### PHASE 7 — Campaign Builder + Smart Scheduler
**Mục tiêu:** Tạo chiến dịch, lên lịch tự động theo giờ vàng
**DoD:**
- [ ] POST /campaigns → chọn pages, videos/playlist, caption template
- [ ] Spin content: {{caption1|caption2|caption3}} random mỗi bài
- [ ] UTM auto-inject: gắn ?utm_source=tiktok&utm_campaign={id} vào caption
- [ ] Cron schedule: platform golden hours (VN: 7-9h, 12-13h, 19-22h)
- [ ] Backend push job tới Flask uploader queue theo lịch
- [ ] Campaign status: draft | scheduled | running | paused | completed
- [ ] Frontend: Campaign Builder UI, Calendar scheduler, status board

---

### PHASE 8 — Auto-Farming + Engagement
**Mục tiêu:** Nuôi page trust, mô phỏng hành vi người dùng thật
**DoD:**
- [ ] Module "Đi dạo": mở newsfeed, scroll, like, xem video random (Playwright)
- [ ] Warm-up schedule: tần suất tăng dần theo tuổi page
- [ ] Auto reply comment trong 1h đầu sau đăng bài
- [ ] Follow/unfollow random accounts liên quan niche
- [ ] Dashboard: follower growth chart, engagement rate per page
- [ ] Cấu hình per account: warm_up_enabled, reply_enabled, farming_intensity

---

### PHASE 9 — Analytics + Affiliate Tracking
**Mục tiêu:** Track views/revenue, affiliate links, monetize alerts
**DoD:**
- [ ] Sync views/followers/watch-time daily cron (Graph API + scraper)
- [ ] Affiliate link: shorten URL + UTM tracking (chhoto-url)
- [ ] Dashboard: tổng video đăng, success/fail ratio, error alerts
- [ ] Alert: FB 5K followers → push notification "Eligible for monetize"
- [ ] Alert: TikTok 10K followers + 100K views → notification
- [ ] Revenue estimation: In-Stream Ads CPM tracking
- [ ] Frontend: Analytics dashboard, revenue chart, affiliate manager

---

### PHASE 10 — Proxy Pool Management
**Mục tiêu:** Quản lý proxy cho từng tenant/account
**DoD:**
- [ ] CRUD /proxies: nhập proxy cá nhân của user
- [ ] Proxy pool chung: auto cấp phát theo license tier
- [ ] Health check proxy: latency, anonymity level, geo location
- [ ] Auto assign proxy: mỗi account 1 IP cố định (sticky) hoặc rotate
- [ ] Frontend: Proxy management UI, health status, geo map

---

### PHASE 11 — SaaS Billing + Subscription
**Mục tiêu:** Gói cước, phân quyền usage, payment
**DoD:**
- [ ] License tier: Free | Basic | Pro | Enterprise
- [ ] Free: 3 accounts, 10 posts/day, no proxy pool
- [ ] Basic: 10 accounts, 50 posts/day, basic proxy
- [ ] Pro: 50 accounts, 200 posts/day, proxy pool, AI video
- [ ] Enterprise: unlimited, dedicated proxy, priority queue
- [ ] Usage tracking: posts today / limit, accounts / limit
- [ ] Payment webhook: VNPay/Stripe → activate/extend license
- [ ] Admin panel: manage all tenants, usage stats, billing history
- [ ] Frontend: Pricing page, subscription UI, usage meter

---

### PHASE 12 — Multi-tenant + Admin Panel
**Mục tiêu:** Tenant isolation hoàn chỉnh, admin quản lý hệ thống
**DoD:**
- [ ] Tenant isolation: row-level với tenant_id trên tất cả tables
- [ ] Admin panel: list tenants, ban/unban, override limits
- [ ] Tenant onboarding flow: register → verify email → activate license
- [ ] System health dashboard: queue depth, worker status, error rate
- [ ] Audit log: mọi action quan trọng được log với actor + timestamp
- [ ] Frontend: Admin panel riêng (route /admin), super-admin guard

---

## 🔍 QUY TRÌNH CODE REVIEW (BẮT BUỘC TRƯỚC KHI VIẾT FEATURE MỚI)

### Bước 1 — Đọc code hiện tại
```
Đọc toàn bộ files liên quan đến feature sắp làm.
Map ra: interfaces đã có, entities đã có, patterns đang dùng.
Chỉ ra: inconsistencies, tech debt, missing pieces.
KHÔNG sửa gì trong bước này — chỉ đọc và báo cáo.
```

### Bước 2 — Gap Analysis
```
So sánh code hiện tại với DoD của phase:
- Cái gì đã có → tận dụng lại
- Cái gì thiếu → cần viết mới
- Cái gì sai pattern → flag để refactor sau (task riêng)
```

### Bước 3 — Implementation Plan (chờ approve)
```
Đề xuất:
- Danh sách files tạo mới
- Danh sách files sửa
- Thứ tự thực hiện (entity → service → controller → frontend)
- Test commands
Chờ Hải Đăng approve TRƯỚC KHI CODE.
```

---

## 🔍 12 TIÊU CHÍ QA/QC AUDIT BẮT BUỘC

Trước khi bàn giao code, tự kiểm tra:

1. **Functional Integrity** — Đúng 100% nghiệp vụ, không hard-code config
2. **Regression** — Không break features phases trước
3. **Edge Cases** — try/catch, null/undefined, timeout, rate-limit (Facebook/TikTok API)
4. **Concurrency** — BoundedSemaphore cho uploads, Redis lock cho queue, tránh duplicate
5. **Security** — Chống SQLi/XSS/CSRF, tenant isolation, không lộ token/cookie trong logs
6. **Performance** — Không N+1 query, cleanup memory leaks, queue backlog control
7. **State Management** — Vue reactive state không mutate trực tiếp, clear interval on unmount
8. **Business Logic** — Đúng ngưỡng followers/watch-time, UTM params preserved
9. **Async/Await** — Không unhandled rejection, Promise.all vs for...of đúng chỗ
10. **Compatibility** — Timezone Server vs Client, responsive UI không overflow
11. **Logging** — Log đủ context để debug production, ẩn passwords/tokens/cookies
12. **Data Integrity** — Batch operations atomic, DB transaction khi cần

---

## 📝 FORMAT PHẢN HỒI CHUẨN

```
## 🎯 Phase X — [Tên Phase] | Task: [Tên Task]
**Trạng thái:** 🔄 In Progress / ✅ Completed

### 💻 1. Code Implementation
[Code block đầy đủ — không dùng "// implement here"]

### 🛠️ 2. QA/QC Audit
- Concurrency/Race Condition: [cách xử lý]
- Edge Cases & Error Handling: [cách xử lý]
- Security: [cách xử lý]

### 🧪 3. Test command
```bash
[lệnh test thực tế]
```

### 📊 4. Expected output
[output mẫu thực tế]

### 📋 5. Checklist
- [x] Task đã làm
- [ ] Task tiếp theo
```

---

## ⚠️ QUY TẮC BẮT BUỘC

1. **1 task tại 1 thời điểm** — không làm song song
2. **Không nhảy phase** — chỉ làm phase tiếp theo khi Hải Đăng confirm "PHASE X ✅ DONE"
3. **Code review trước khi viết mới** — đọc code, đề xuất plan, chờ approve
4. **Không xóa code cũ** trong phase đang chạy — refactor = task riêng
5. **Verify bằng lệnh thực tế** — chỉ mark DONE khi có test output pass thực tế
6. **Khi phase DONE** → smoke test anti-regression, tóm tắt, hỏi "Bắt đầu Phase X+1?"
7. **Code đầy đủ** — không placeholder "// implement logic here"
8. **Sau mỗi file quan trọng** → test command + expected output + common errors

---

## 🚀 TRẠNG THÁI HIỆN TẠI

**Phase đang làm:** PHASE 0 ✅ DONE → bắt đầu PHASE 1
**Branch:** phase0-project-skeleton
**Commits hoàn thành:**
- c00e6db — Docker: PostgreSQL + Redis + MinIO healthy
- 5fb383a — NestJS /health + 29 tests pass
- 2447c4c — .gitattributes LF normalization
- (Vue 3 build pass — 104 modules, 2.25s)

**Phase 0 DoD — tất cả DONE:**
- [x] docker compose: infra healthy
- [x] NestJS /health
- [x] 29 unit tests pass
- [x] Vue 3 build exit 0
- [x] .env.example đầy đủ

**Môi trường:** Local Docker Compose → deploy VPS aaPanel
**Repo gốc upload engine:** https://github.com/dreammis/social-auto-upload

---

## 📝 LƯU Ý ĐẶC BIỆT

- **social-auto-upload**: fork, chỉ mở rộng — không viết lại
- **Fingerprint changer**: thay metadata (ID3/EXIF/hash) trước re-upload chống duplicate
- **Cookie**: AES-256-GCM encrypted trong PostgreSQL, KHÔNG plain text, KHÔNG log
- **Browser profiles**: isolated theo tenant_id/user_id/platform/account_id
- **Proxy**: sticky IP per account, fallback nội bộ nếu proxy fail
- **BoundedSemaphore**: giới hạn UPLOADER_MAX_DISPATCH_THREADS threads đồng thời
- **Spin content**: {{option1|option2}} random caption tránh duplicate detection Facebook
- **UTM tracking**: auto-inject ?utm_source&utm_campaign vào caption affiliate
- **Git**: commit sau mỗi task, format: feat(phaseX): description
- **Line endings**: đã chuẩn hóa LF (.gitattributes)
