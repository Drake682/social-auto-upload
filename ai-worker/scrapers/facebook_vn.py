import logging
import os
from typing import Any

from .base import AsyncHTTPClient, ScraperConfigError, rapidapi_headers

logger = logging.getLogger(__name__)


class FacebookVNTrendScraper:
    def __init__(self):
        self.client = AsyncHTTPClient()
        self.api_key = os.getenv("FB_API_KEY") or os.getenv("RAPIDAPI_KEY")
        self.api_url = os.getenv("FACEBOOK_VN_API_URL") or os.getenv("FACEBOOK_API_URL")
        self.api_host = os.getenv("FACEBOOK_API_HOST")
        self.query = os.getenv("FACEBOOK_TREND_QUERY", "viral")

    async def fetch(self, region: str = "vn") -> list[dict[str, Any]]:
        if not self.api_url or not self.api_key:
            logger.warning("Facebook VN trend API config missing; skipping Facebook VN crawl")
            return []

        try:
            payload = await self.client.get_json(
                self.api_url,
                headers=rapidapi_headers(self.api_key, self.api_host),
                params={"q": self.query, "region": region, "country": region.upper()},
            )
            return self.normalize(payload, region)
        except ScraperConfigError:
            logger.warning("Facebook VN RapidAPI configuration missing; skipping Facebook VN crawl")
            return []
        except Exception as exc:
            logger.warning("Facebook VN trend crawl failed: %s", exc)
            return []

    def normalize(self, payload: Any, region: str) -> list[dict[str, Any]]:
        items = self._extract_items(payload)
        trends: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            title = item.get("title") or item.get("keyword") or item.get("name") or item.get("caption")
            if not title:
                continue
            views = item.get("views") or item.get("view_count") or item.get("volume") or item.get("count")
            trends.append(
                {
                    "platform": "facebook",
                    "region": region,
                    "keyword": str(title)[:200],
                    "title": str(title)[:500],
                    "views": self._float_or_none(views),
                    "volume": self._float_or_none(views),
                    "trend_type": "video",
                    "source_url": str(item.get("url") or item.get("link") or "")[:500] or None,
                }
            )
        return trends

    def _extract_items(self, payload: Any) -> list[Any]:
        if isinstance(payload, list):
            return payload
        if not isinstance(payload, dict):
            return []
        for key in ("data", "items", "results", "trends", "posts", "videos"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                nested = self._extract_items(value)
                if nested:
                    return nested
        return []

    def _float_or_none(self, value: Any) -> float | None:
        if value is None:
            return None
        try:
            return float(str(value).replace(",", ""))
        except (TypeError, ValueError):
            return None
