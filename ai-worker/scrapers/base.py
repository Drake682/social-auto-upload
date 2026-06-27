import logging
import os
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


class ScraperConfigError(RuntimeError):
    pass


class AsyncHTTPClient:
    def __init__(self, timeout_seconds: float | None = None):
        self.timeout_seconds = timeout_seconds or float(os.getenv("SCRAPER_TIMEOUT_SECONDS", "15"))

    @retry(
        retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=2, min=2, max=10),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def get_json(self, url: str, *, headers: dict[str, str] | None = None, params: dict[str, Any] | None = None) -> Any:
        async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=True) as client:
            response = await client.get(url, headers=headers, params=params)
            if response.status_code in {408, 429, 500, 502, 503, 504}:
                response.raise_for_status()
            response.raise_for_status()
            return response.json()

    @retry(
        retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=2, min=2, max=10),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def get_text(self, url: str, *, headers: dict[str, str] | None = None) -> str:
        async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            if response.status_code in {408, 429, 500, 502, 503, 504}:
                response.raise_for_status()
            response.raise_for_status()
            return response.text


def rapidapi_headers(api_key: str | None, host: str | None = None) -> dict[str, str]:
    if not api_key:
        raise ScraperConfigError("RAPIDAPI_KEY is required for trend API calls")
    headers = {"X-RapidAPI-Key": api_key}
    if host:
        headers["X-RapidAPI-Host"] = host
    return headers
