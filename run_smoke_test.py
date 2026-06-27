"""One-shot E2E smoke data injector for SocialFlow upload workers.

Usage:
    python run_smoke_test.py --platform facebook --cookie-file test_cookie.json
    python run_smoke_test.py --platform tiktok --cookie-file test_cookie.json
    python run_smoke_test.py --platform shopee --cookie-file test_cookie.json --product-ref https://shopee.vn/test-product

The cookie file may contain either:
  - a Playwright cookie list JSON: [{"name": "...", "value": "...", ...}]
  - an object with cookies/cookie: {"cookies": [...]}
  - a raw Cookie header string: name=value; other=value
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import types
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Keep local smoke encryption compatible with docker-compose defaults.
os.environ.setdefault("ENCRYPTION_KEY", "dev_encryption_key_change_in_prod")

# Local smoke script shim: uploader/__init__.py imports conf.BASE_DIR,
# but dev machines may not have conf.py. Runtime containers still use real conf.py.
if "conf" not in sys.modules:
    conf_stub = types.ModuleType("conf")
    conf_stub.BASE_DIR = Path(__file__).resolve().parent
    sys.modules["conf"] = conf_stub

from uploader.facebook_uploader.crypto_utils import encrypt_session_data
from uploader.facebook_uploader.upload_models import UploadJob, UploadJobStatus

DB_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://socialflow:socialflow_dev@localhost:5432/socialflow",
)
DEFAULT_VIDEO_URL = "/app/videoFile/test_video.mp4"
DEFAULT_COOKIE_DOMAINS = {
    "facebook": ".facebook.com",
    "tiktok": ".tiktok.com",
    "shopee": ".shopee.vn",
}
ENDPOINTS = {
    "facebook": "http://localhost:5000/upload/facebook",
    "tiktok": "http://localhost:5000/upload/tiktok",
    "shopee": "http://localhost:5000/upload/shopee",
}


def _load_cookie_payload(cookie_file: Path, platform: str) -> list[dict[str, Any]]:
    if not cookie_file.exists():
        raise FileNotFoundError(
            f"Cookie file not found: {cookie_file}. Create it and paste test account cookies first."
        )

    raw = cookie_file.read_text(encoding="utf-8").strip()
    if not raw:
        raise ValueError(f"Cookie file is empty: {cookie_file}")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None

    if isinstance(parsed, list):
        return [_normalize_cookie_dict(c, platform) for c in parsed]

    if isinstance(parsed, dict):
        cookies = parsed.get("cookies") or parsed.get("cookie")
        if isinstance(cookies, list):
            return [_normalize_cookie_dict(c, platform) for c in cookies]
        raise ValueError("Cookie JSON object must include cookies[] or cookie[]")

    return _parse_cookie_header(raw, platform)


def _normalize_cookie_dict(cookie: dict[str, Any], platform: str) -> dict[str, Any]:
    if not isinstance(cookie, dict):
        raise ValueError("Each cookie item must be an object")
    name = cookie.get("name")
    value = cookie.get("value")
    if not name or value is None:
        raise ValueError("Each cookie item must include name and value")

    normalized: dict[str, Any] = {
        "name": str(name),
        "value": str(value),
        "domain": cookie.get("domain") or DEFAULT_COOKIE_DOMAINS[platform],
        "path": cookie.get("path") or "/",
        "secure": bool(cookie.get("secure", True)),
    }
    for key in ("expires", "httpOnly", "sameSite"):
        if key in cookie:
            normalized[key] = cookie[key]
    return normalized


def _parse_cookie_header(raw: str, platform: str) -> list[dict[str, Any]]:
    cookies: list[dict[str, Any]] = []
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        if not name:
            continue
        cookies.append(
            {
                "name": name,
                "value": value.strip(),
                "domain": DEFAULT_COOKIE_DOMAINS[platform],
                "path": "/",
                "secure": True,
            }
        )
    if not cookies:
        raise ValueError("Raw Cookie header did not contain any name=value pairs")
    return cookies


def _ensure_smoke_user(conn, user_id: int) -> None:
    now = datetime.utcnow()
    conn.execute(
        text(
            """
            INSERT INTO users (
                id, email, password_hash, display_name, role, is_active, created_at, updated_at
            )
            VALUES (
                :id, :email, :password_hash, :display_name, :role, :is_active, :created_at, :updated_at
            )
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            "id": user_id,
            "email": f"smoke-{user_id}@socialflow.local",
            "password_hash": "smoke-test-disabled",
            "display_name": "Smoke Test User",
            "role": "operator",
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        },
    )


def _upsert_account(
    conn,
    account_id: int,
    user_id: int,
    platform: str,
    account_name: str,
    encrypted_session: str,
    proxy_url: str | None,
) -> None:
    now = datetime.utcnow()
    conn.execute(
        text(
            """
            INSERT INTO accounts (
                id, user_id, platform, account_name, session_data, proxy_url, status, created_at, updated_at
            )
            VALUES (
                :id, :user_id, :platform, :account_name, :session_data, :proxy_url, :status, :created_at, :updated_at
            )
            ON CONFLICT (id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                platform = EXCLUDED.platform,
                account_name = EXCLUDED.account_name,
                session_data = EXCLUDED.session_data,
                proxy_url = EXCLUDED.proxy_url,
                status = EXCLUDED.status,
                updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "id": account_id,
            "user_id": user_id,
            "platform": platform,
            "account_name": account_name,
            "session_data": encrypted_session,
            "proxy_url": proxy_url,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        },
    )


def _insert_video_job(conn, video_job_id: uuid.UUID, user_id: int, video_url: str) -> None:
    now = datetime.utcnow()
    conn.execute(
        text(
            """
            INSERT INTO video_jobs (
                id, user_id, topic, status, progress, video_url, created_at, updated_at
            )
            VALUES (
                :id, :user_id, :topic, :status, :progress, :video_url, :created_at, :updated_at
            )
            """
        ),
        {
            "id": str(video_job_id),
            "user_id": user_id,
            "topic": "E2E Smoke Test",
            "status": "done",
            "progress": 100,
            "video_url": video_url,
            "created_at": now,
            "updated_at": now,
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Inject one SocialFlow uploader smoke test job")
    parser.add_argument("--platform", choices=sorted(ENDPOINTS), default="facebook")
    parser.add_argument("--cookie-file", default="test_cookie.json")
    parser.add_argument("--account-id", type=int, default=9999)
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--account-name", default="smoke-test-account")
    parser.add_argument("--proxy-url", default=None)
    parser.add_argument("--video-url", default=DEFAULT_VIDEO_URL)
    parser.add_argument(
        "--caption",
        default="Hệ thống SocialFlow AI Auto Post Test 🚀 #socialflow",
    )
    parser.add_argument(
        "--affiliate-comment",
        default="Link mua hàng E2E: https://shopee.vn/test-product",
    )
    args = parser.parse_args()

    cookie_file = Path(args.cookie_file)
    cookies = _load_cookie_payload(cookie_file, args.platform)
    encrypted_session = encrypt_session_data(json.dumps(cookies, ensure_ascii=False))

    engine = create_engine(DB_URL, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine)
    video_job_id = uuid.uuid4()
    upload_job_id = uuid.uuid4()

    with engine.begin() as conn:
        _ensure_smoke_user(conn, args.user_id)
        _upsert_account(
            conn=conn,
            account_id=args.account_id,
            user_id=args.user_id,
            platform=args.platform,
            account_name=args.account_name,
            encrypted_session=encrypted_session,
            proxy_url=args.proxy_url,
        )
        _insert_video_job(conn, video_job_id, args.user_id, args.video_url)

    session = SessionLocal()
    try:
        upload_job = UploadJob(
            id=upload_job_id,
            video_job_id=video_job_id,
            account_id=args.account_id,
            caption=args.caption,
            proxy_url=args.proxy_url,
            affiliate_comment=args.affiliate_comment,
            status=UploadJobStatus.PENDING,
        )
        session.add(upload_job)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    endpoint = ENDPOINTS[args.platform]
    print("[SUCCESS] E2E smoke data inserted into PostgreSQL.")
    print("-" * 60)
    print(f"Platform: {args.platform}")
    print(f"Account ID: {args.account_id}")
    print(f"Video Job ID: {video_job_id}")
    print(f"Upload Job ID: {upload_job_id}")
    print("-" * 60)
    print("Trigger:")
    print(
        "curl -X POST "
        f"{endpoint} "
        "-H \"Content-Type: application/json\" "
        f"-d '{{\"upload_job_id\": \"{upload_job_id}\"}}'"
    )
    print("\nWatch logs:")
    print("docker compose logs -f flask_uploader")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
