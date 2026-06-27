import logging
import os
from typing import Any

import httpx

from .base import AsyncHTTPClient, ScraperConfigError, rapidapi_headers

logger = logging.getLogger(__name__)


class TrendScraperAPI:
    def __init__(self):
        self.client = AsyncHTTPClient()
        self.rapidapi_key = os.getenv("RAPIDAPI_KEY")
        self.tiktok_api_url = os.getenv("TIKTOK_API_URL")
        self.tiktok_api_host = os.getenv("TIKTOK_API_HOST")
        self.facebook_api_url = os.getenv("FACEBOOK_API_URL")
        self.facebook_api_host = os.getenv("FACEBOOK_API_HOST")

    async def fetch_tiktok_trends(self) -> list[dict[str, Any]]:
        if not self.tiktok_api_url:
            logger.warning("TIKTOK_API_URL not configured; skipping TikTok trend sync")
            return []
        try:
            payload = await self.client.get_json(
                self.tiktok_api_url,
                headers=rapidapi_headers(self.rapidapi_key, self.tiktok_api_host),
            )
            return self._normalize_trends(payload, "tiktok")
        except ScraperConfigError:
            logger.warning("TikTok trend API config missing; skipping")
            return []
        except Exception as exc:
            logger.error("TikTok trend fetch failed: %s", exc, exc_info=True)
            return []

    async def fetch_facebook_trends(self) -> list[dict[str, Any]]:
        if not self.facebook_api_url:
            logger.warning("FACEBOOK_API_URL not configured; skipping Facebook trend sync")
            return []
        try:
            payload = await self.client.get_json(
                self.facebook_api_url,
                headers=rapidapi_headers(self.rapidapi_key, self.facebook_api_host),
                params={"q": os.getenv("FACEBOOK_TREND_QUERY", "viral")},
            )
            return self._normalize_trends(payload, "facebook")
        except ScraperConfigError:
            logger.warning("Facebook trend API config missing; skipping")
            return []
        except httpx.HTTPStatusError as exc:
            response_text = exc.response.text[:1000] if exc.response is not None else ""
            logger.error(
                "Facebook trend fetch HTTP %s failed: %s response=%s",
                exc.response.status_code if exc.response is not None else "unknown",
                exc,
                response_text,
                exc_info=True,
            )
            return []
        except Exception as exc:
            logger.error("Facebook trend fetch failed: %s", exc, exc_info=True)
            return []

    def _normalize_trends(self, payload: Any, platform: str) -> list[dict[str, Any]]:
        items = self._extract_items(payload)
        trends: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            keyword = (
                item.get("keyword")
                or item.get("hashtag")
                or item.get("tag")
                or item.get("title")
                or item.get("name")
                or item.get("caption")
            )
            if not keyword:
                continue
            volume = item.get("volume") or item.get("views") or item.get("view_count") or item.get("count")
            trend_type = item.get("trend_type") or item.get("type") or "video"
            if trend_type not in {"video", "audio"}:
                trend_type = "audio" if "audio" in str(trend_type).lower() or "music" in str(trend_type).lower() else "video"
            trends.append(
                {
                    "platform": platform,
                    "keyword": str(keyword)[:200],
                    "volume": self._float_or_none(volume),
                    "trend_type": trend_type,
                    "source_url": str(item.get("url") or item.get("link") or "")[:500] or None,
                }
            )
        return trends

    def _extract_items(self, payload: Any) -> list[Any]:
        if isinstance(payload, list):
            return payload
        if not isinstance(payload, dict):
            return []
        for key in ("data", "items", "results", "trends", "hashtags", "videos"):
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
