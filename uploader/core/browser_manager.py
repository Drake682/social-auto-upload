"""Shared Playwright browser manager for reliable persistent sessions.

This module intentionally does not hide automation signals or spoof browser
fingerprints. It centralizes legitimate reliability controls: persistent profile
storage, explicit proxy config, user-selected locale/timezone, timeout defaults,
and sensitive-value redaction for logs/errors.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar
from urllib.parse import unquote, urlparse

logger = logging.getLogger(__name__)

DEFAULT_LOCALE = os.getenv("BROWSER_LOCALE", "vi-VN")
DEFAULT_TIMEZONE_ID = os.getenv("BROWSER_TIMEZONE_ID", "Asia/Ho_Chi_Minh")
DEFAULT_PROFILE_ROOT = Path(os.getenv("BROWSER_PROFILE_ROOT", "/app/cookiesFile"))
DEFAULT_VIEWPORT = {"width": 1920, "height": 1080}
DEFAULT_USER_AGENT = os.getenv(
    "BROWSER_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36",
)

T = TypeVar("T")

LOG_CONTEXT_KEYS = ("job_id", "tenant_id", "platform")
DEFAULT_LOG_CONTEXT = {"job_id": "-", "tenant_id": "-", "platform": "-"}
STRUCTURED_LOG_FORMAT = (
    "%(asctime)s %(levelname)s %(name)s "
    "job_id=%(job_id)s tenant_id=%(tenant_id)s platform=%(platform)s %(message)s"
)
_LOG_CONTEXT: contextvars.ContextVar[dict[str, str]] = contextvars.ContextVar(
    "browser_log_context",
    default=DEFAULT_LOG_CONTEXT,
)

_SECRET_KEY_RE = re.compile(
    r"(cookie|cookies|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|password|passwd|secret)",
    re.IGNORECASE,
)
_SECRET_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(https?://[^:/\s]+:)([^@/\s]+)(@[^\s]+)", re.IGNORECASE), r"\1***REDACTED***\3"),
    (re.compile(r"(socks5?h?://[^:/\s]+:)([^@/\s]+)(@[^\s]+)", re.IGNORECASE), r"\1***REDACTED***\3"),
    (re.compile(r"(proxy[_-]?authorization\s*[:=]\s*)([^\s,;]+)", re.IGNORECASE), r"\1***REDACTED***"),
    (re.compile(r"(authorization\s*[:=]\s*bearer\s+)([a-z0-9._\-]+)", re.IGNORECASE), r"\1***REDACTED***"),
    (re.compile(r"((?:access|refresh|session|auth)[_-]?token\s*[:=]\s*)([^\s,;]+)", re.IGNORECASE), r"\1***REDACTED***"),
    (re.compile(r"((?:cookie|set-cookie)\s*[:=]\s*)([^\n]+)", re.IGNORECASE), r"\1***REDACTED***"),
    (
        re.compile(
            r"([\"'](?:cookie|cookies|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|password|passwd|secret)[\"']\s*:\s*[\"'])(.*?)([\"'])",
            re.IGNORECASE,
        ),
        r"\1***REDACTED***\3",
    ),
]


class StructuredLogContextFilter(logging.Filter):
    """Attach stable tracing fields to every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        context = _LOG_CONTEXT.get()
        for key in LOG_CONTEXT_KEYS:
            if not hasattr(record, key):
                setattr(record, key, context.get(key) or "-")
        return True


_LOG_FILTER = StructuredLogContextFilter()


def configure_structured_logging() -> None:
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format=STRUCTURED_LOG_FORMAT)

    formatter = logging.Formatter(STRUCTURED_LOG_FORMAT)
    for handler in root_logger.handlers:
        if _LOG_FILTER not in handler.filters:
            handler.addFilter(_LOG_FILTER)
        current_format = getattr(handler.formatter, "_fmt", "") if handler.formatter else ""
        if "%(job_id)s" not in current_format or "%(tenant_id)s" not in current_format or "%(platform)s" not in current_format:
            handler.setFormatter(formatter)

    if _LOG_FILTER not in logger.filters:
        logger.addFilter(_LOG_FILTER)


configure_structured_logging()


def set_browser_log_context(
    job_id: str | int | None = None,
    tenant_id: str | int | None = None,
    platform: str | None = None,
) -> contextvars.Token[dict[str, str]]:
    current = dict(_LOG_CONTEXT.get())
    if job_id is not None:
        current["job_id"] = str(job_id)
    if tenant_id is not None:
        current["tenant_id"] = str(tenant_id)
    if platform is not None:
        current["platform"] = platform or "-"
    return _LOG_CONTEXT.set(current)


def reset_browser_log_context(token: contextvars.Token[dict[str, str]]) -> None:
    _LOG_CONTEXT.reset(token)


def _redact_object(value: Any) -> Any:
    if isinstance(value, dict):
        safe: dict[Any, Any] = {}
        looks_like_cookie = {"name", "value", "domain", "path"}.issubset({str(key) for key in value.keys()})
        for key, item in value.items():
            key_text = str(key)
            if _SECRET_KEY_RE.search(key_text) or (looks_like_cookie and key_text == "value"):
                safe[key] = "***REDACTED***"
            else:
                safe[key] = _redact_object(item)
        return safe
    if isinstance(value, (list, tuple, set)):
        return [_redact_object(item) for item in value]
    return value


def redact_sensitive(value: Any) -> str:
    """Return a log-safe string with common credentials removed."""
    try:
        if isinstance(value, (dict, list, tuple, set)):
            text = json.dumps(_redact_object(value), default=str, ensure_ascii=False)
        else:
            text = str(value)
    except Exception:
        text = "<unprintable>"

    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _safe_profile_name(account_id: str | int) -> str:
    raw = str(account_id or "default")
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", raw).strip("._")
    return safe or "default"


def _normalize_proxy(proxy_url: str | None) -> dict[str, str] | None:
    if not proxy_url:
        return None
    parsed = urlparse(proxy_url)
    if not parsed.scheme or not parsed.hostname or not parsed.port:
        raise ValueError("Invalid proxy_url format; expected http://user:pass@host:port")

    config: dict[str, str] = {
        "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}",
    }
    if parsed.username:
        config["username"] = unquote(parsed.username)
    if parsed.password:
        config["password"] = unquote(parsed.password)
    return config


@dataclass
class BrowserSession:
    playwright: Any
    context: Any
    page: Any
    user_data_dir: Path
    browser: Any | None = None

    def close(self) -> None:
        try:
            try:
                browser = self.browser or (self.context.browser if self.context else None)
            except Exception:
                browser = None
            try:
                if self.context:
                    self.context.close()
                    logger.info("Browser context closed")
            except Exception as exc:
                logger.warning("Browser context cleanup failed: %s", redact_sensitive(exc), exc_info=True)
        finally:
            try:
                if browser:
                    browser.close()
                    logger.info("Browser process closed")
            except Exception as exc:
                logger.warning("Browser process cleanup failed: %s", redact_sensitive(exc), exc_info=True)
            finally:
                try:
                    if self.playwright:
                        self.playwright.stop()
                        logger.info("Playwright driver stopped")
                except Exception as exc:
                    logger.warning("Playwright cleanup failed: %s", redact_sensitive(exc), exc_info=True)
                finally:
                    try:
                        if self.user_data_dir.exists():
                            shutil.rmtree(self.user_data_dir, ignore_errors=True)
                            logger.info("Temporary browser profile removed: %s", self.user_data_dir)
                    except Exception as exc:
                        logger.warning("Temporary browser profile cleanup failed %s: %s", self.user_data_dir, redact_sensitive(exc))


class BrowserManager:
    """Create persistent Playwright contexts for uploaders.

    The manager keeps real browser storage per account. It does not apply stealth
    plugins, fingerprint randomization, webdriver patches, or WebRTC overrides.
    """

    def __init__(
        self,
        playwright: Any,
        account_id: str | int,
        proxy_url: str | None = None,
        headless: bool = True,
        locale: str | None = None,
        timezone_id: str | None = None,
        user_agent: str | None = None,
        viewport: dict[str, int] | None = None,
        profile_root: str | Path | None = None,
        action_timeout_ms: int = 30000,
    ):
        self.playwright = playwright
        self.account_id = account_id
        self.proxy_url = proxy_url
        self.headless = headless
        self.locale = locale or DEFAULT_LOCALE
        self.timezone_id = timezone_id or DEFAULT_TIMEZONE_ID
        self.user_agent = user_agent or DEFAULT_USER_AGENT
        self.viewport = viewport or DEFAULT_VIEWPORT
        self.profile_root = Path(profile_root) if profile_root else DEFAULT_PROFILE_ROOT
        self.action_timeout_ms = action_timeout_ms
        self._profile_suffix = uuid.uuid4().hex[:8]

    @property
    def user_data_dir(self) -> Path:
        return self.profile_root / f"profile_{_safe_profile_name(self.account_id)}_{self._profile_suffix}"

    def _launch_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "headless": self.headless,
            "locale": self.locale,
            "timezone_id": self.timezone_id,
            "viewport": self.viewport,
            "user_agent": self.user_agent,
            "args": [
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        }
        proxy_config = _normalize_proxy(self.proxy_url)
        if proxy_config:
            kwargs["proxy"] = proxy_config
            logger.info("Browser proxy configured: %s", proxy_config["server"])
        return kwargs

    def launch_persistent_session(self, cookies: list[dict] | None = None) -> BrowserSession:
        """Launch Chromium persistent context and return first page session."""
        self.user_data_dir.mkdir(parents=True, exist_ok=True)
        context = None
        try:
            context = self.playwright.chromium.launch_persistent_context(
                user_data_dir=str(self.user_data_dir),
                **self._launch_kwargs(),
            )
            context.set_default_timeout(self.action_timeout_ms)
            if cookies:
                context.add_cookies(cookies)
                logger.info("Loaded %d cookies into persistent browser profile", len(cookies))
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(self.action_timeout_ms)
            logger.info("Browser profile active: %s", self.user_data_dir)
            return BrowserSession(
                playwright=self.playwright,
                context=context,
                browser=getattr(context, "browser", None),
                page=page,
                user_data_dir=self.user_data_dir,
            )
        except Exception as exc:
            try:
                if context:
                    context.close()
            except Exception as cleanup_exc:
                logger.warning("Browser launch cleanup failed: %s", redact_sensitive(cleanup_exc), exc_info=True)
            try:
                if self.user_data_dir.exists():
                    shutil.rmtree(self.user_data_dir, ignore_errors=True)
            except Exception as cleanup_exc:
                logger.warning("Browser launch profile cleanup failed: %s", redact_sensitive(cleanup_exc), exc_info=True)
            raise RuntimeError(f"Browser launch failed: {redact_sensitive(exc)}") from exc

    @staticmethod
    def with_backoff(
        action: Callable[[], T],
        attempts: int = 3,
        base_delay: float = 0.5,
        on_retry: Callable[[int, Exception], None] | None = None,
    ) -> T:
        """Run an action with small exponential backoff for flaky DOM timing."""
        last_exc: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                return action()
            except Exception as exc:  # pragma: no cover - caller decides retry scope
                last_exc = exc
                if attempt >= attempts:
                    break
                if on_retry:
                    on_retry(attempt, exc)
                time.sleep(base_delay * (2 ** (attempt - 1)))
        raise last_exc or RuntimeError("Backoff action failed")
