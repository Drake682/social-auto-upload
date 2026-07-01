import json
import os
import sys
from pathlib import Path

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DEFAULT_DISPATCH_URL = "http://127.0.0.1:5000/uploader/dispatch"
DEFAULT_VIDEO_URL = "s3://socialflow-media/tenants/1/raw/input.mp4"
DEFAULT_JOB_ID = "vnc-e2e-test-001"
REQUEST_TIMEOUT_SECONDS = 5


def load_cookie_payload() -> str:
    cookie_json = os.getenv("FACEBOOK_COOKIE_JSON", "").strip()
    cookie_file = os.getenv("FACEBOOK_COOKIE_FILE", "").strip()

    if cookie_json:
        parsed = json.loads(cookie_json)
        return json.dumps(parsed, ensure_ascii=False)

    if cookie_file:
        path = Path(cookie_file).expanduser().resolve()
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return json.dumps(parsed, ensure_ascii=False)

    raise RuntimeError(
        "Missing Facebook cookies. Set FACEBOOK_COOKIE_JSON or FACEBOOK_COOKIE_FILE. "
        "Refusing to persist live session cookies in repository test file."
    )


def build_payload() -> dict:
    return {
        "job_id": os.getenv("PLAYWRIGHT_E2E_JOB_ID", DEFAULT_JOB_ID),
        "tenant_id": int(os.getenv("PLAYWRIGHT_E2E_TENANT_ID", "1")),
        "user_id": int(os.getenv("PLAYWRIGHT_E2E_USER_ID", "1")),
        "platform": "facebook",
        "video_url": os.getenv("PLAYWRIGHT_E2E_VIDEO_URL", DEFAULT_VIDEO_URL),
        "caption": os.getenv("PLAYWRIGHT_E2E_CAPTION", "Test video đăng tự động bằng Playwright! #auto #viral"),
        "proxy": os.getenv("PLAYWRIGHT_E2E_PROXY", ""),
        "account_cookie": load_cookie_payload(),
    }


def main() -> int:
    url = os.getenv("FLASK_DISPATCH_URL", DEFAULT_DISPATCH_URL)
    print(f"[DISPATCH] Sending payload to Flask Uploader: {url}")

    try:
        payload = build_payload()
        response = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text}")
        return 0 if response.status_code == 202 else 1
    except Exception as exc:
        print(f"Connection or dispatch error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
