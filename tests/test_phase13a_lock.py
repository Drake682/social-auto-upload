import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import psycopg2
import psycopg2.extras
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

TEST_JOB_ID = "999e8400-e29b-41d4-a716-446655440999"
TEST_TENANT_ID = 1
TEST_USER_ID = 1
TEST_VIDEO_URL = "s3://mock"
TEST_PLATFORM = "facebook"
DEFAULT_DB_HOST = "localhost"
DEFAULT_DB_PORT = "5432"
DEFAULT_DB_NAME = "socialflow"
DEFAULT_DB_USER = "socialflow"
DEFAULT_DB_PASSWORD = "socialflow_dev"
DEFAULT_FLASK_UPLOADER_URL = "http://localhost:5409"
REQUEST_TIMEOUT_SECONDS = 10
WEBHOOK_WAIT_SECONDS = 7


@dataclass(frozen=True)
class DbConfig:
    host: str
    port: str
    dbname: str
    user: str
    password: str


class Phase13ATestError(RuntimeError):
    pass


def load_db_config() -> DbConfig:
    return DbConfig(
        host=os.getenv("DB_HOST", DEFAULT_DB_HOST),
        port=os.getenv("DB_PORT", DEFAULT_DB_PORT),
        dbname=os.getenv("DB_NAME", DEFAULT_DB_NAME),
        user=os.getenv("DB_USER", DEFAULT_DB_USER),
        password=os.getenv("DB_PASSWORD", DEFAULT_DB_PASSWORD),
    )


def get_flask_dispatch_url() -> str:
    base_url = os.getenv("FLASK_UPLOADER_URL", DEFAULT_FLASK_UPLOADER_URL).rstrip("/")
    return f"{base_url}/uploader/dispatch"


def connect_db(config: DbConfig):
    try:
        return psycopg2.connect(
            host=config.host,
            port=config.port,
            dbname=config.dbname,
            user=config.user,
            password=config.password,
            connect_timeout=10,
        )
    except psycopg2.Error as exc:
        raise Phase13ATestError(f"PostgreSQL connection failed: {exc}") from exc


def ensure_required_columns(conn) -> None:
    required_columns = {"id", "tenant_id", "user_id", "topic", "status", "video_url", "published_url", "created_at", "updated_at"}
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'video_jobs'
            """
        )
        existing_columns = {row["column_name"] for row in cursor.fetchall()}

    missing = sorted(required_columns - existing_columns)
    if missing:
        raise Phase13ATestError(
            "video_jobs missing required column(s): "
            + ", ".join(missing)
            + ". Start NestJS once with synchronize enabled or apply migration before running this test."
        )


def ensure_test_user(conn) -> None:
    now = datetime.now(timezone.utc)
    with conn.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO users (
                id, email, password_hash, display_name, role, tenant_id, is_active, created_at, updated_at
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT (id) DO NOTHING
            """,
            (
                TEST_USER_ID,
                "phase13a.lock.test@socialflow.local",
                "phase13a-test-password-hash",
                "Phase 13A Lock Test User",
                "admin",
                TEST_TENANT_ID,
                True,
                now,
                now,
            ),
        )
    conn.commit()


def cleanup_test_job(conn) -> None:
    with conn.cursor() as cursor:
        cursor.execute("DELETE FROM video_jobs WHERE id = %s", (TEST_JOB_ID,))
    conn.commit()


def insert_test_job(conn) -> None:
    now = datetime.now(timezone.utc)
    cleanup_test_job(conn)
    ensure_test_user(conn)

    with conn.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO video_jobs (
                id,
                user_id,
                tenant_id,
                topic,
                status,
                progress,
                video_url,
                scheduled_at,
                published_url,
                error_log,
                created_at,
                updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                TEST_JOB_ID,
                TEST_USER_ID,
                TEST_TENANT_ID,
                "Phase 13A Automated Lock Test",
                "done",
                100,
                TEST_VIDEO_URL,
                now,
                None,
                None,
                now,
                now,
            ),
        )
    conn.commit()
    print(f"[SETUP] Inserted video_jobs.id={TEST_JOB_ID} status=done")


def trigger_flask_dispatch() -> Dict[str, Any]:
    dispatch_url = get_flask_dispatch_url()
    payload = {
        "job_id": TEST_JOB_ID,
        "tenant_id": TEST_TENANT_ID,
        "user_id": TEST_USER_ID,
        "platform": TEST_PLATFORM,
        "video_url": TEST_VIDEO_URL,
        "caption": "Phase 13A automated callback test",
        "proxy": "mock_proxy",
        "account_cookie": "mock_cookie",
    }

    try:
        response = requests.post(dispatch_url, json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise Phase13ATestError(f"Flask dispatch request failed: {exc}") from exc

    if response.status_code != 202:
        raise Phase13ATestError(f"Expected HTTP 202 from Flask, got {response.status_code}: {response.text}")

    try:
        body = response.json()
    except ValueError as exc:
        raise Phase13ATestError(f"Flask response is not JSON: {response.text}") from exc

    if body.get("status") != "queued":
        raise Phase13ATestError(f"Expected Flask status=queued, got body={body}")
    if body.get("job_id") != TEST_JOB_ID:
        raise Phase13ATestError(f"Expected Flask job_id={TEST_JOB_ID}, got body={body}")

    print(f"[TRIGGER] Flask accepted dispatch HTTP 202 body={body}")
    return body


def fetch_video_job(conn) -> Optional[Dict[str, Any]]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
        cursor.execute(
            """
            SELECT id, status, published_url, error_log, updated_at
            FROM video_jobs
            WHERE id = %s
            """,
            (TEST_JOB_ID,),
        )
        row = cursor.fetchone()
    return dict(row) if row else None


def verify_webhook_result(conn) -> Dict[str, Any]:
    row = fetch_video_job(conn)
    if row is None:
        raise Phase13ATestError(f"video_jobs.id={TEST_JOB_ID} disappeared before verification")

    status = row.get("status")
    published_url = row.get("published_url")
    error_log = row.get("error_log")

    if status != "published":
        raise Phase13ATestError(
            f"Expected final status=published, got status={status}, published_url={published_url}, error_log={error_log}"
        )
    if not published_url:
        raise Phase13ATestError(f"Expected non-empty published_url, got row={row}")

    print(f"[VERIFY] DB row status={status} published_url={published_url}")
    return row


def run() -> int:
    config = load_db_config()
    conn = None
    passed = False

    try:
        print("[START] Phase 13A lock/webhook verification")
        print(f"[DB] host={config.host} port={config.port} db={config.dbname} user={config.user}")
        print(f"[FLASK] dispatch_url={get_flask_dispatch_url()}")

        conn = connect_db(config)
        ensure_required_columns(conn)
        insert_test_job(conn)
        trigger_flask_dispatch()

        print(f"[WAIT] Waiting {WEBHOOK_WAIT_SECONDS}s for Flask background thread and NestJS webhook update")
        time.sleep(WEBHOOK_WAIT_SECONDS)

        verify_webhook_result(conn)
        passed = True
        print("✅ PHASE 13A LOCK & WEBHOOK VERIFIED")
        return 0
    except Exception as exc:
        print(f"❌ PHASE 13A LOCK & WEBHOOK FAILED: {exc}", file=sys.stderr)
        return 1
    finally:
        if conn is not None:
            try:
                if passed:
                    cleanup_test_job(conn)
                    print(f"[TEARDOWN] Deleted test video_jobs.id={TEST_JOB_ID}")
                conn.close()
            except Exception as cleanup_exc:
                print(f"[TEARDOWN] Cleanup failed: {cleanup_exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(run())
