from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import urlparse

import requests

from uploader.core.browser_manager import redact_sensitive

logger = logging.getLogger(__name__)

PROXY_GATEWAY_TIMEOUT_SECONDS = int(os.getenv("PROXY_GATEWAY_TIMEOUT_SECONDS", "10"))


def _extract_proxy_url(payload: Any) -> str | None:
    if isinstance(payload, str):
        value = payload.strip()
        return value or None

    if not isinstance(payload, dict):
        return None

    for key in ("proxy", "proxy_url", "url", "server"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    protocol = str(payload.get("protocol") or "http").strip() or "http"
    host = payload.get("host") or payload.get("ip")
    port = payload.get("port")
    username = payload.get("username") or payload.get("user")
    password = payload.get("password") or payload.get("pass")

    if not host or not port:
        return None

    auth = ""
    if username and password:
        auth = f"{username}:{password}@"
    elif username:
        auth = f"{username}@"

    return f"{protocol}://{auth}{host}:{port}"


def _is_valid_proxy_url(proxy_url: str) -> bool:
    parsed = urlparse(proxy_url)
    return parsed.scheme in {"http", "https", "socks4", "socks5"} and bool(parsed.hostname and parsed.port)


def get_active_proxy() -> str | None:
    """Fetch one approved egress proxy URL from the configured gateway.

    Returns a Playwright-compatible URL like http://user:pass@host:port.
    Returns None when gateway config is missing or unavailable, allowing local network fallback.
    """
    gateway_url = os.getenv("PROXY_GATEWAY_URL", "").strip()
    gateway_key = os.getenv("PROXY_GATEWAY_KEY", "").strip()

    if not gateway_url:
        logger.info("Proxy gateway disabled; using local network")
        return None

    headers = {}
    if gateway_key:
        headers["X-Internal-Key"] = gateway_key

    try:
        response = requests.get(gateway_url, headers=headers, timeout=PROXY_GATEWAY_TIMEOUT_SECONDS)
        if response.status_code == 405:
            response = requests.post(gateway_url, headers=headers, timeout=PROXY_GATEWAY_TIMEOUT_SECONDS)

        if response.status_code >= 400:
            logger.warning(
                "Proxy gateway returned non-2xx status=%s body=%s",
                response.status_code,
                response.text[:500],
            )
            return None

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type.lower():
            proxy_url = _extract_proxy_url(response.json())
        else:
            proxy_url = _extract_proxy_url(response.text)

        if not proxy_url:
            logger.warning("Proxy gateway response did not include proxy URL")
            return None

        if not _is_valid_proxy_url(proxy_url):
            logger.warning("Proxy gateway returned invalid proxy URL: %s", redact_sensitive(proxy_url))
            return None

        logger.info("Proxy gateway returned active proxy: %s", redact_sensitive(proxy_url))
        return proxy_url
    except requests.exceptions.RequestException as exc:
        logger.warning("Proxy gateway request failed: %s", redact_sensitive(exc))
        return None
    except Exception as exc:
        logger.warning("Proxy gateway unexpected error: %s", redact_sensitive(exc), exc_info=True)
        return None
