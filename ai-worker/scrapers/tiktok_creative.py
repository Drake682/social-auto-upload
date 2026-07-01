import logging
import os
from typing import Any

from .base import AsyncHTTPClient, ScraperConfigError, rapidapi_headers

logger = logging.getLogger(__name__)

TIKTOK_CREATIVE_URL = "https://ads.tiktok.com/creative_radar_api/v1/popular_trend/list"


class TikTokCreativeCenterScraper:
    def __init__(self):
        self.client = AsyncHTTPClient()
        self.api_key = os.getenv("TIKTOK_API_KEY") or os.getenv("RAPIDAPI_KEY")
        self.api_url = os.getenv("TIKTOK_CREATIVE_API_URL") or os.getenv("TIKTOK_API_URL") or TIKTOK_CREATIVE_URL
        self.api_host = os.getenv("TIKTOK_API_HOST")
        self.cookie = os.getenv("TIKTOK_CREATIVE_COOKIE")
        self.user_agent = os.getenv(
            "TIKTOK_CREATIVE_USER_AGENT",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        )

    async def fetch(self, region: str = "vn") -> list[dict[str, Any]]:
        if not self.api_key and not self.cookie:
            logger.warning("TikTok trend API credentials missing; skipping TikTok Creative Center crawl")
            return []

        headers = self._headers()
        params = {
            "period": os.getenv("TIKTOK_TREND_PERIOD", "7"),
            "page": "1",
            "limit": os.getenv("TIKTOK_TREND_LIMIT", "50"),
            "country_code": region.upper(),
        }

        try:
            payload = await self.client.get_json(self.api_url, headers=headers, params=params)
            return self.normalize(payload, region)
        except ScraperConfigError:
            logger.warning("TikTok RapidAPI configuration missing; skipping TikTok crawl")
            return []
        except Exception as exc:
            logger.warning("TikTok Creative Center crawl failed: %s", exc)
            return []

    def _headers(self) -> dict[str, str]:
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/json, text/plain, */*",
        }
        if self.cookie:
            headers["Cookie"] = self.cookie
        if self.api_key:
            headers.update(rapidapi_headers(self.api_key, self.api_host))
        return headers

    def normalize(self, payload: Any, region: str) -> list[dict[str, Any]]:
        items = self._extract_items(payload)
        trends: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            title = item.get("title") or item.get("keyword") or item.get("hashtag_name") or item.get("name")
            if not title:
                continue
            views = item.get("views") or item.get("view_count") or item.get("volume") or item.get("video_views")
            trends.append(
                {
                    "platform": "tiktok",
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
        for key in ("list", "data", "items", "results", "trends", "hashtags", "videos"):
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
