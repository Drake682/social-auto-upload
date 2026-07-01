from typing import Any

from .facebook_vn import FacebookVNTrendScraper
from .tiktok_creative import TikTokCreativeCenterScraper


class TrendScraperAPI:
    def __init__(self):
        self.tiktok = TikTokCreativeCenterScraper()
        self.facebook_vn = FacebookVNTrendScraper()

    async def fetch_tiktok_trends(self) -> list[dict[str, Any]]:
        return await self.tiktok.fetch(region="vn")

    async def fetch_facebook_trends(self) -> list[dict[str, Any]]:
        return await self.facebook_vn.fetch(region="vn")
