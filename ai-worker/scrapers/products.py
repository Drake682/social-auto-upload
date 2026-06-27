import json
import logging
import re
from html import unescape
from typing import Any
from urllib.parse import urlparse

from .base import AsyncHTTPClient

logger = logging.getLogger(__name__)


class ProductScraperAPI:
    def __init__(self):
        self.client = AsyncHTTPClient()
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }

    async def fetch_shopee_product(self, url: str) -> dict[str, Any] | None:
        return await self._fetch_product_page(url, "shopee")

    async def fetch_tiktok_product(self, url: str) -> dict[str, Any] | None:
        return await self._fetch_product_page(url, "tiktok")

    async def _fetch_product_page(self, url: str, platform: str) -> dict[str, Any] | None:
        try:
            html = await self.client.get_text(url, headers=self.headers)
            name = self._extract_meta(html, ["og:title", "twitter:title", "title"])
            price = self._extract_price(html)
            if not name:
                logger.warning("%s product scrape found no product name for %s", platform, url)
                return None
            return {
                "platform": platform,
                "product_url": url,
                "product_name": name[:500],
                "price": price,
                "commission_rate": None,
            }
        except Exception as exc:
            logger.error("%s product scrape failed for %s: %s", platform, url, exc, exc_info=True)
            return None

    def detect_platform(self, url: str) -> str:
        host = urlparse(url).netloc.lower()
        if "shopee" in host:
            return "shopee"
        if "tiktok" in host:
            return "tiktok"
        raise ValueError("Unsupported product URL platform; expected Shopee or TikTok Shop URL")

    def _extract_meta(self, html: str, names: list[str]) -> str | None:
        for name in names:
            if name == "title":
                match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
                if match:
                    return self._clean_text(match.group(1))
                continue
            pattern = (
                r"<meta[^>]+(?:property|name)=['\"]" + re.escape(name) +
                r"['\"][^>]+content=['\"]([^'\"]+)['\"][^>]*>"
            )
            match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
            if match:
                return self._clean_text(match.group(1))
        return None

    def _extract_price(self, html: str) -> float | None:
        meta_price = self._extract_meta(
            html,
            ["product:price:amount", "og:price:amount", "twitter:data1"],
        )
        if meta_price:
            parsed = self._parse_price(meta_price)
            if parsed is not None:
                return parsed

        ld_json_prices = self._extract_json_ld_prices(html)
        if ld_json_prices:
            return ld_json_prices[0]

        match = re.search(r"(?:price|priceAmount|salePrice)['\"]?\s*[:=]\s*['\"]?([0-9][0-9.,]*)", html, re.IGNORECASE)
        if match:
            return self._parse_price(match.group(1))
        return None

    def _extract_json_ld_prices(self, html: str) -> list[float]:
        prices: list[float] = []
        for match in re.finditer(
            r"<script[^>]+type=['\"]application/ld\+json['\"][^>]*>(.*?)</script>",
            html,
            re.IGNORECASE | re.DOTALL,
        ):
            try:
                payload = json.loads(unescape(match.group(1)).strip())
            except json.JSONDecodeError:
                continue
            stack = payload if isinstance(payload, list) else [payload]
            while stack:
                current = stack.pop()
                if isinstance(current, dict):
                    offers = current.get("offers")
                    if isinstance(offers, dict):
                        parsed = self._parse_price(offers.get("price") or offers.get("lowPrice"))
                        if parsed is not None:
                            prices.append(parsed)
                    stack.extend(value for value in current.values() if isinstance(value, (dict, list)))
                elif isinstance(current, list):
                    stack.extend(current)
        return prices

    def _parse_price(self, value: Any) -> float | None:
        if value is None:
            return None
        text = re.sub(r"[^0-9.,]", "", str(value))
        if not text:
            return None
        if text.count(",") > 0 and text.count(".") == 0:
            text = text.replace(",", "")
        else:
            text = text.replace(",", "")
        try:
            return float(text)
        except ValueError:
            return None

    def _clean_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", unescape(text)).strip()
