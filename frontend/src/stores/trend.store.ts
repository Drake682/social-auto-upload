import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api';

export type TrendPlatform = 'tiktok' | 'facebook' | 'youtube' | 'instagram' | 'shopee';
export type TrendRegion = 'vn' | 'global' | 'us' | 'uk';

export interface TrendItem {
  id: number;
  title: string;
  views: number;
  platform: string;
  region: string;
  crawled_at: string;
}

export interface LatestTrendsFilters {
  platform?: TrendPlatform;
  region?: TrendRegion;
  limit?: number;
}

export const useTrendStore = defineStore('trends', () => {
  const trends = ref<TrendItem[]>([]);
  const platformFilter = ref<TrendPlatform>('tiktok');
  const regionFilter = ref<TrendRegion>('vn');
  const limit = ref(10);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchLatestTrends(filters: LatestTrendsFilters = {}) {
    const platform = filters.platform ?? platformFilter.value;
    const region = filters.region ?? regionFilter.value;
    const nextLimit = filters.limit ?? limit.value;

    isLoading.value = true;
    error.value = null;

    try {
      const response = await api.get('/trends/latest', {
        params: { platform, region, limit: nextLimit },
      });
      trends.value = response.data.data;
      platformFilter.value = platform;
      regionFilter.value = region;
      limit.value = nextLimit;
    } catch (err: any) {
      error.value = err.response?.data?.msg || err.response?.data?.message || 'Failed to fetch trends';
    } finally {
      isLoading.value = false;
    }
  }

  async function setPlatformFilter(platform: TrendPlatform) {
    await fetchLatestTrends({ platform, region: regionFilter.value, limit: limit.value });
  }

  async function setRegionFilter(region: TrendRegion) {
    await fetchLatestTrends({ platform: platformFilter.value, region, limit: limit.value });
  }

  return {
    trends,
    platformFilter,
    regionFilter,
    limit,
    isLoading,
    error,
    fetchLatestTrends,
    setPlatformFilter,
    setRegionFilter,
  };
});
